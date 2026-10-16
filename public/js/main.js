import * as THREE from 'three';
import { makeTerrain, WATER_LEVEL, PLAY_RADIUS } from './terrain.js';
import { buildVillage } from './village.js';

// HTML 요소 선택 도우미
const $ = (id) => document.getElementById(id);

const S = 32;            // 청크 크기
const N = 32;            // 청크 분할 수
const VIEW = 5;          // 로딩 반경(청크 단위)
const UNLOAD = VIEW + 2;

const FAST_MULT = 100;   // 속도 배율
const RES_HIGH = N;      // 평소 청크 해상도
const RES_LOW = 8;       // 빠르게 이동할 때 청크 해상도

// 플레이어 라벨
function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;

  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#000';
  ctx.strokeText(text, 128, 44);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 128, 44);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false
    })
  );

  sprite.scale.set(3, 0.75, 1);
  sprite.position.y = 2.6;

  return sprite;
}

// 플레이어 모델
function makeAvatar(nick, color) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 1.0, 4, 8),
    new THREE.MeshLambertMaterial({ color })
  );

  body.position.y = 0.9;
  group.add(body);
  group.add(makeLabel(nick));

  return group;
}

// 서버 데이터에서 플레이어 목록을 배열로 변환
function normalizePlayers(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (data && typeof data === 'object') {
    if (Array.isArray(data.players)) return data.players;
    if (Array.isArray(data.list)) return data.list;

    return Object.entries(data).map(([pid, p]) => {
      if (Array.isArray(p)) {
        return [pid, ...p.slice(1)];
      }

      return { id: pid, ...p };
    });
  }

  console.error('알 수 없는 state 데이터 형식:', data);
  return [];
}

// 플레이어 데이터 해석
function parsePlayer(p) {
  if (Array.isArray(p)) {
    // [id, nick, x, y, z, ry]
    return {
      id: p[0],
      nick: p[1],
      x: p[2],
      y: p[3],
      z: p[4],
      ry: p[5]
    };
  }

  if (p && typeof p === 'object') {
    return {
      id: p.id ?? p.pid,
      nick: p.nick ?? p.name ?? '플레이어',
      x: p.x,
      y: p.y ?? 0,
      z: p.z,
      ry: p.ry ?? 0
    };
  }

  return null;
}

// 입장
$('join').onclick = () => {
  $('join').disabled = true;
  $('msg').textContent = '서버에 연결 중...';

  const socket = io();

  socket.on('connect', () => {
    socket.emit('join', {
      nick: $('nick').value.trim() || '플레이어'
    });
  });

  socket.on('connect_error', (err) => {
    console.error('서버 연결 오류:', err);
    $('msg').textContent = '서버 연결에 실패했습니다.';
    $('join').disabled = false;
  });

  socket.on('full', () => {
    $('msg').textContent = '서버가 가득 찼어요 (최대 10명)';
    $('join').disabled = false;
  });

  socket.on('init', (data) => {
    if (!data || !data.id) {
      console.error('잘못된 init 데이터:', data);
      $('msg').textContent = '캐릭터 초기화에 실패했습니다.';
      $('join').disabled = false;
      return;
    }

    $('msg').textContent = '';
    boot(socket, data);
  });
};

function boot(socket, { id, seed }) {
  $('login').style.display = 'none';

  const T = makeTerrain(seed);

  // 렌더러
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  renderer.domElement.style.position = 'fixed';
  renderer.domElement.style.inset = '0';
  renderer.domElement.style.zIndex = '0';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa8c8e8);
  scene.fog = new THREE.Fog(0xa8c8e8, 70, VIEW * S - 8);

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    400
  );

  scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 0.9));

  const sun = new THREE.DirectionalLight(0xfff2d0, 1.0);
  sun.position.set(80, 120, 40);
  scene.add(sun);

  // 물은 플레이어 주변에 배치
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({
      color: 0x2f6fb5,
      transparent: true,
      opacity: 0.72
    })
  );

  water.position.y = WATER_LEVEL;
  scene.add(water);

  // 시작마을 터 (선으로만 표시)
  buildVillage(scene);

  // 청크 공통 인덱스 (해상도별로 한 번만 만들어 재사용)
  const indexCache = {};

  function getIndex(res) {
    if (indexCache[res]) return indexCache[res];

    const idx = [];
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const a = z * (res + 1) + x;
        const b = a + 1;
        const c = a + res + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }

    indexCache[res] = new THREE.BufferAttribute(new Uint16Array(idx), 1);
    return indexCache[res];
  }

  const terrainMat = new THREE.MeshLambertMaterial({
    vertexColors: true
  });

  const chunks = new Map();
  const E = 0.5;
  let fast = false;

  // 청크 생성 (res가 클수록 정밀)
  function buildChunk(cx, cz, res) {
    const key = `${cx},${cz}`;

    const old = chunks.get(key);
    if (old) {
      scene.remove(old);
      old.geometry.dispose();
    }

    const V = (res + 1) * (res + 1);
    const pos = new Float32Array(V * 3);
    const nor = new Float32Array(V * 3);
    const col = new Float32Array(V * 3);

    let i = 0;

    for (let z = 0; z <= res; z++) {
      for (let x = 0; x <= res; x++, i++) {
        const wx = cx * S + (x * S) / res;
        const wz = cz * S + (z * S) / res;

        const h = T.height(wx, wz);

        let nx = T.height(wx - E, wz) - T.height(wx + E, wz);
        let ny = 2 * E;
        let nz = T.height(wx, wz - E) - T.height(wx, wz + E);

        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;

        let c = T.color(wx, wz, h);

        const rock = 1 - Math.min(1, Math.max(0, (ny - 0.65) / 0.2));

        c = [
          c[0] + (0.45 - c[0]) * rock,
          c[1] + (0.43 - c[1]) * rock,
          c[2] + (0.40 - c[2]) * rock
        ];

        pos.set([(x * S) / res, h, (z * S) / res], i * 3);
        nor.set([nx, ny, nz], i * 3);
        col.set(c, i * 3);
      }
    }

    const geo = new THREE.BufferGeometry();

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(getIndex(res));
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, terrainMat);
    mesh.position.set(cx * S, 0, cz * S);
    mesh.userData = { cx, cz, res };

    scene.add(mesh);
    chunks.set(key, mesh);
  }

  // 주변 청크 로딩 및 먼 청크 제거
  function updateChunks(px, pz) {
    const pcx = Math.floor(px / S);
    const pcz = Math.floor(pz / S);

    for (const [key, mesh] of chunks) {
      const distance = Math.max(
        Math.abs(mesh.userData.cx - pcx),
        Math.abs(mesh.userData.cz - pcz)
      );

      if (distance > UNLOAD) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        chunks.delete(key);
      }
    }

    const wantRes = fast ? RES_LOW : RES_HIGH;
    const t0 = performance.now();
    const budget = fast ? 8 : 0; // 빠른 모드: 프레임당 8ms까지, 평소: 1개씩

    do {
      let best = null;
      let bestDistance = Infinity;

      for (let dz = -VIEW; dz <= VIEW; dz++) {
        for (let dx = -VIEW; dx <= VIEW; dx++) {
          const distance = dx * dx + dz * dz;

          if (distance > VIEW * VIEW) continue;
          if (distance >= bestDistance) continue;

          const existing = chunks.get(`${pcx + dx},${pcz + dz}`);
          if (existing && existing.userData.res >= wantRes) continue;

          bestDistance = distance;
          best = [pcx + dx, pcz + dz];
        }
      }

      if (!best) break;
      buildChunk(best[0], best[1], wantRes);
    } while (performance.now() - t0 < budget);
  }

  // 육지 스폰 위치 찾기
  let sx = 0;
  let sz = 0;
  let foundLand = false;

  search:
  for (let r = 0; r < 400; r += 8) {
    for (let a = 0; a < Math.PI * 2; a += 0.5) {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;

      if (T.height(x, z) > WATER_LEVEL + 1) {
        sx = x;
        sz = z;
        foundLand = true;
        break search;
      }
    }
  }

  if (!foundLand) {
    console.warn(
      '스폰 주변에서 물보다 높은 지형을 찾지 못했습니다. terrain.js를 확인하세요.'
    );
  }

  const me = {
    x: sx,
    z: sz,
    y: T.height(sx, sz),
    yaw: 0,
    pitch: 0.45,
    ry: 0
  };

  const myAvatar = makeAvatar('', 0xffffff);
  myAvatar.children[1].visible = false;
  scene.add(myAvatar);

  // 키보드 및 마우스
  const keys = {};

  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
  });

  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  renderer.domElement.addEventListener('click', () => {
    renderer.domElement.requestPointerLock();
  });

  window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== renderer.domElement) return;

    me.yaw -= e.movementX * 0.003;
    me.pitch = Math.min(
      1.2,
      Math.max(0.1, me.pitch + e.movementY * 0.003)
    );
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // 속도 배율 버튼 (오른쪽 위)
  const fastBtn = document.createElement('button');
  fastBtn.style.cssText =
    'position:fixed;top:8px;right:8px;z-index:5;padding:8px 14px;' +
    'font-size:15px;font-weight:bold;border:0;border-radius:8px;' +
    'color:#fff;cursor:pointer;opacity:.9';
  document.body.appendChild(fastBtn);

  function setFast(v) {
    fast = v;
    fastBtn.textContent = fast
      ? `⚡ 속도 ×${FAST_MULT} ON (F)`
      : `⚡ 속도 ×${FAST_MULT} OFF (F)`;
    fastBtn.style.background = fast ? '#d33' : '#444';
    socket.emit('fast', fast);
    fastBtn.blur();
  }

  fastBtn.addEventListener('click', () => setFast(!fast));

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF') setFast(!fast);
  });

  setFast(false);

  // 다른 플레이어
  const remotes = new Map();

  socket.on('state', (data) => {
    const list = normalizePlayers(data);
    const seen = new Set();

    for (const rawPlayer of list) {
      const p = parsePlayer(rawPlayer);

      if (
        !p ||
        p.id == null ||
        !Number.isFinite(Number(p.x)) ||
        !Number.isFinite(Number(p.z))
      ) {
        continue;
      }

      const pid = p.id;
      const x = Number(p.x);
      const y = Number(p.y) || 0;
      const z = Number(p.z);
      const ry = Number(p.ry) || 0;

      if (String(pid) === String(id)) continue;

      seen.add(pid);

      let remote = remotes.get(pid);

      if (!remote) {
        remote = {
          g: makeAvatar(p.nick || '플레이어', 0xffa040),
          t: { x, y, z, ry }
        };

        remote.g.position.set(x, y, z);
        scene.add(remote.g);
        remotes.set(pid, remote);
      }

      remote.t = { x, y, z, ry };
    }

    for (const [pid, remote] of remotes) {
      if (!seen.has(pid)) {
        scene.remove(remote.g);
        remotes.delete(pid);
      }
    }
  });

  socket.on('correct', (p) => {
    if (!p) return;

    if (Number.isFinite(p.x)) me.x = p.x;
    if (Number.isFinite(p.z)) me.z = p.z;
  });

  // 게임 루프
  let sendTimer = 0;
  const clock = new THREE.Clock();

  function loop() {
    requestAnimationFrame(loop);

    const dt = Math.min(clock.getDelta(), 0.1);

    const fx = -Math.sin(me.yaw);
    const fz = -Math.cos(me.yaw);
    const rx = Math.cos(me.yaw);
    const rz = -Math.sin(me.yaw);

    let mx = 0;
    let mz = 0;

    if (keys.KeyW) {
      mx += fx;
      mz += fz;
    }

    if (keys.KeyS) {
      mx -= fx;
      mz -= fz;
    }

    if (keys.KeyD) {
      mx += rx;
      mz += rz;
    }

    if (keys.KeyA) {
      mx -= rx;
      mz -= rz;
    }

    const len = Math.hypot(mx, mz);

    if (len > 0) {
      const speed = (keys.ShiftLeft ? 14 : 7) * (fast ? FAST_MULT : 1);

      let px = me.x + (mx / len) * speed * dt;
      let pz = me.z + (mz / len) * speed * dt;

      // 원형 활동 범위 제한
      const pr = Math.hypot(px, pz);
      if (pr > PLAY_RADIUS) {
        px *= PLAY_RADIUS / pr;
        pz *= PLAY_RADIUS / pr;
      }

      me.x = px;
      me.z = pz;
      me.ry = Math.atan2(mx, mz);
    }

    me.y = Math.max(T.height(me.x, me.z), WATER_LEVEL - 0.8);

    myAvatar.position.set(me.x, me.y, me.z);
    myAvatar.rotation.y = me.ry;

    // 3인칭 카메라
    const dist = 9;

    const cx =
      me.x + Math.sin(me.yaw) * Math.cos(me.pitch) * dist;

    const cz =
      me.z + Math.cos(me.yaw) * Math.cos(me.pitch) * dist;

    const cy = Math.max(
      me.y + Math.sin(me.pitch) * dist + 1.5,
      T.height(cx, cz) + 1.5
    );

    camera.position.set(cx, cy, cz);
    camera.lookAt(me.x, me.y + 1.5, me.z);

    // 물과 지형
    water.position.x = me.x;
    water.position.z = me.z;

    updateChunks(me.x, me.z);

    // 다른 플레이어 위치 보간
    for (const remote of remotes.values()) {
      const k = 1 - Math.exp(-12 * dt);

      remote.g.position.x += (remote.t.x - remote.g.position.x) * k;
      remote.g.position.y += (remote.t.y - remote.g.position.y) * k;
      remote.g.position.z += (remote.t.z - remote.g.position.z) * k;
      remote.g.rotation.y = remote.t.ry;
    }

    // 서버로 이동 정보 전송
    sendTimer += dt;

    if (sendTimer > 0.05) {
      sendTimer = 0;

      socket.emit('move', {
        x: me.x,
        y: me.y,
        z: me.z,
        ry: me.ry
      });
    }

    $('hud').textContent =
      `X ${me.x.toFixed(0)}  Z ${me.z.toFixed(0)}\n` +
      `청크 ${chunks.size}  접속 ${remotes.size + 1}명\n` +
      '클릭=마우스 잠금, WASD, Shift=달리기, F=속도 ×' + FAST_MULT;

    renderer.render(scene, camera);
  }

  // 초기 청크를 빠르게 생성
  updateChunks(me.x, me.z);
  updateChunks(me.x, me.z);
  updateChunks(me.x, me.z);

  loop();
}
