import * as THREE from 'three';
import { makeTerrain, WATER_LEVEL, PLAY_RADIUS, LANDMARKS } from './terrain.js';
import { buildVillage } from './village.js';

// HTML 요소 선택 도우미
const $ = (id) => document.getElementById(id);

const S = 32;            // 청크 크기
const N = 32;            // 청크 분할 수
const VIEW = 5;          // 로딩 반경(청크 단위)
const UNLOAD = VIEW + 2;

const FAST_MIN = 10;     // 속도 배율 최소
const FAST_MAX = 100;    // 속도 배율 최대 (서버 한도도 100)
const RES_HIGH = N;      // 평소 청크 해상도
const RES_LOW = 8;       // 빠르게 이동할 때 청크 해상도
const PITCH_LIMIT = 1.45; // 위아래 회전 한계 (거의 수직까지)

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

  // 잔디/흙 텍스처
  const texLoader = new THREE.TextureLoader();
  const loadTex = (url) => {
    const t = texLoader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  };
  const texGrass = loadTex('/textures/grass.jpg');           // 평원: 일반 잔디
  const texGold = loadTex('/textures/grass_gold.jpg');       // 평원: 연한 누런 잔디
  const texJungle = loadTex('/textures/grass_dark.jpg');     // 정글: 진한 잔디
  const texDirt = loadTex('/textures/dirt.jpg');             // 평원: 흙 얼룩
  const texVillage = loadTex('/textures/village_dirt.jpg');  // 마을 흙바닥

  const terrainMat = new THREE.MeshLambertMaterial({
    vertexColors: true
  });

  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrass = { value: texGrass };
    shader.uniforms.uGold = { value: texGold };
    shader.uniforms.uJungle = { value: texJungle };
    shader.uniforms.uDirt = { value: texDirt };
    shader.uniforms.uVillage = { value: texVillage };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
        'attribute vec3 detail;\n' +
        'attribute vec2 detail2;\n' +
        'varying vec3 vDetail;\n' +
        'varying vec2 vDetail2;\n' +
        'varying vec2 vWorldXZ;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        'vDetail = detail;\n' +
        'vDetail2 = detail2;\n' +
        'vWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
        'uniform sampler2D uGrass;\n' +
        'uniform sampler2D uGold;\n' +
        'uniform sampler2D uJungle;\n' +
        'uniform sampler2D uDirt;\n' +
        'uniform sampler2D uVillage;\n' +
        'varying vec3 vDetail;\n' +
        'varying vec2 vDetail2;\n' +
        'varying vec2 vWorldXZ;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 p = vWorldXZ;

          // 평원: 일반 잔디 + 연한 누런 잔디
          vec3 a1 = texture2D(uGrass, p * 0.25).rgb;
          float l1 = dot(texture2D(uGrass, p * 0.04).rgb, vec3(0.333));
          vec3 g1 = a1 * (0.6 + 0.8 * l1);

          vec3 a2 = texture2D(uGold, p * 0.22).rgb;
          float l2 = dot(texture2D(uGold, p * 0.035).rgb, vec3(0.333));
          vec3 g2 = a2 * (0.6 + 0.8 * l2);

          vec3 plainCol = mix(g1, g2, smoothstep(0.35, 0.65, vDetail.z));

          // 정글: 진한 잔디
          vec3 a4 = texture2D(uJungle, p * 0.22).rgb;
          float l4 = dot(texture2D(uJungle, p * 0.035).rgb, vec3(0.333));
          vec3 jungleCol = a4 * (0.6 + 1.6 * l4);

          // 평원 흙 얼룩
          vec3 a3 = texture2D(uDirt, p * 0.2).rgb;
          float l3 = dot(texture2D(uDirt, p * 0.033).rgb, vec3(0.333));
          vec3 dirtCol = a3 * (0.6 + 1.1 * l3);

          // 마을 흙바닥
          vec3 a5 = texture2D(uVillage, p * 0.15).rgb;
          float l5 = dot(texture2D(uVillage, p * 0.03).rgb, vec3(0.333));
          vec3 villageCol = a5 * (0.7 + 0.6 * l5);

          diffuseColor.rgb = mix(diffuseColor.rgb, plainCol, clamp(vDetail.x, 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, jungleCol, clamp(vDetail2.y, 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, dirtCol, clamp(vDetail.y, 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, villageCol, clamp(vDetail2.x, 0.0, 1.0));
        }`
      );
  };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
        'attribute vec3 detail;\n' +
        'varying vec3 vDetail;\n' +
        'varying vec2 vWorldXZ;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        'vDetail = detail;\n' +
        'vWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
        'uniform sampler2D uGrass;\n' +
        'uniform sampler2D uGrass2;\n' +
        'uniform sampler2D uDirt;\n' +
        'varying vec3 vDetail;\n' +
        'varying vec2 vWorldXZ;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 p = vWorldXZ;

          vec3 a1 = texture2D(uGrass, p * 0.25).rgb;
          float l1 = dot(texture2D(uGrass, p * 0.04).rgb, vec3(0.333));
          vec3 g1 = a1 * (0.6 + 0.8 * l1);

          vec3 a2 = texture2D(uGrass2, p * 0.22).rgb;
          float l2 = dot(texture2D(uGrass2, p * 0.035).rgb, vec3(0.333));
          vec3 g2 = a2 * (0.6 + 1.6 * l2);

          vec3 gr = mix(g1, g2, smoothstep(0.35, 0.65, vDetail.z));

          vec3 a3 = texture2D(uDirt, p * 0.2).rgb;
          float l3 = dot(texture2D(uDirt, p * 0.033).rgb, vec3(0.333));
          vec3 dt = a3 * (0.6 + 1.1 * l3);

          diffuseColor.rgb = mix(diffuseColor.rgb, gr, clamp(vDetail.x, 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, dt, clamp(vDetail.y, 0.0, 1.0));
        }`
      );
  };

  const chunks = new Map();
  const E = 0.5;
  let fast = false;
  let fastMult = FAST_MAX;

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
        const det = new Float32Array(V * 3);
    const det2 = new Float32Array(V * 2);

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

        const rock = 1 - Math.min(1, Math.max(0, (ny - 0.40) / 0.2));

        c = [
          c[0] + (0.45 - c[0]) * rock,
          c[1] + (0.43 - c[1]) * rock,
          c[2] + (0.40 - c[2]) * rock
        ];

        pos.set([(x * S) / res, h, (z * S) / res], i * 3);
        nor.set([nx, ny, nz], i * 3);
                col.set(c, i * 3);
        const d = T.detail(wx, wz, h);
        det.set([d[0], d[1], d[2]], i * 3);
        det2.set([d[3], d[4]], i * 2);
      }
    }

    const geo = new THREE.BufferGeometry();

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
       geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('detail', new THREE.BufferAttribute(det, 3));
    geo.setAttribute('detail2', new THREE.BufferAttribute(det2, 2));
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

    // 배율 30 이상으로 빠르게 이동할 때만 거친 해상도 사용
    const lowMode = fast && fastMult >= 30;
    const wantRes = lowMode ? RES_LOW : RES_HIGH;
    const t0 = performance.now();
    const budget = lowMode ? 8 : 0; // 거친 모드: 프레임당 8ms까지, 평소: 1개씩

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

  // ---------- 속도 배율 패널 (오른쪽 위) ----------
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;top:8px;right:8px;z-index:5;width:190px;padding:8px;' +
    'display:flex;flex-direction:column;gap:6px;border-radius:10px;' +
    'background:rgba(0,0,0,.45);color:#fff;font:bold 13px sans-serif';

  const fastBtn = document.createElement('button');
  fastBtn.style.cssText =
    'padding:8px 10px;font-size:14px;font-weight:bold;border:0;' +
    'border-radius:8px;color:#fff;cursor:pointer';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(FAST_MIN);
  slider.max = String(FAST_MAX);
  slider.step = '5';
  slider.value = String(fastMult);

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:11px;font-weight:normal;opacity:.8';
  hint.textContent = 'F: 켜기/끄기   [ ]: 배율 조절';

  panel.append(fastBtn, slider, hint);
  document.body.appendChild(panel);

  function refreshPanel() {
    fastBtn.textContent =
      `⚡ 속도 ×${fastMult} ${fast ? 'ON' : 'OFF'}`;
    fastBtn.style.background = fast ? '#d33' : '#444';
    slider.value = String(fastMult);
  }

  function setFast(v) {
    fast = v;
    refreshPanel();
    socket.emit('fast', fast);
    fastBtn.blur();
  }

  function setMult(m) {
    fastMult = Math.max(FAST_MIN, Math.min(FAST_MAX, Math.round(m)));
    refreshPanel();
  }

  fastBtn.addEventListener('click', () => setFast(!fast));
  slider.addEventListener('input', () => setMult(Number(slider.value)));
  slider.addEventListener('change', () => slider.blur());
  refreshPanel();
  socket.emit('fast', false);

  // ---------- 나침반 (위쪽 가운데) ----------
  const compass = document.createElement('div');
  compass.style.cssText =
    'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:5;' +
    'width:min(760px,60vw);height:54px;overflow:hidden;border-radius:10px;' +
    'background:rgba(0,0,0,.45);color:#fff;pointer-events:none;' +
    'font-family:sans-serif;text-shadow:0 0 3px #000';

  const tick = document.createElement('div');
  tick.style.cssText =
    'position:absolute;left:50%;top:0;width:2px;height:100%;' +
    'background:rgba(255,255,255,.35);transform:translateX(-50%)';
  compass.appendChild(tick);

  const compassItems = [];

  function addCompassItem(text, bearing, style, landmark) {
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;transform:translateX(-50%);white-space:nowrap;' +
      'display:none;' + style;
    el.textContent = text;
    compass.appendChild(el);
    compassItems.push({ el, bearing, landmark, last: '' });
  }

  // 동서남북 (북쪽 = -z, 동쪽 = +x)
  addCompassItem('N', 0, 'top:3px;font-size:20px;font-weight:bold;color:#ff5555');
  addCompassItem('E', Math.PI / 2, 'top:3px;font-size:20px;font-weight:bold');
  addCompassItem('S', Math.PI, 'top:3px;font-size:20px;font-weight:bold');
  addCompassItem('W', Math.PI * 1.5, 'top:3px;font-size:20px;font-weight:bold');

  // 지형 이름
  for (const lm of LANDMARKS) {
    addCompassItem(lm.name, 0, 'top:30px;font-size:13px;font-weight:bold;color:#ffe9a0', lm);
  }

  document.body.appendChild(compass);

  function updateCompass() {
    const heading = -me.yaw; // 바라보는 방향 (북쪽 기준, 시계 방향)

    for (const item of compassItems) {
      let bearing = item.bearing;
      let label = null;

      if (item.landmark) {
        const dx = item.landmark.x - me.x;
        const dz = item.landmark.z - me.z;
        bearing = Math.atan2(dx, -dz);

        const dist = Math.hypot(dx, dz);
        const distText = dist >= 1000
          ? (dist / 1000).toFixed(1) + 'km'
          : Math.round(dist) + 'm';
        label = `${item.landmark.name} ${distText}`;
      }

      let diff = bearing - heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const deg = (diff * 180) / Math.PI;

      if (Math.abs(deg) > 95) {
        item.el.style.display = 'none';
        continue;
      }

      item.el.style.display = 'block';
      item.el.style.left = (50 + (deg / 100) * 50) + '%';

      if (label !== null && label !== item.last) {
        item.el.textContent = label;
        item.last = label;
      }
    }
  }

  // ---------- 키보드 및 마우스 ----------
  const keys = {};
  const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

  window.addEventListener('keydown', (e) => {
    if (ARROWS.includes(e.code)) e.preventDefault();
    keys[e.code] = true;

    if (e.repeat) return;
    if (e.code === 'KeyF') setFast(!fast);
    if (e.code === 'BracketLeft') setMult(fastMult - 10);
    if (e.code === 'BracketRight') setMult(fastMult + 10);
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
      PITCH_LIMIT,
      Math.max(-PITCH_LIMIT, me.pitch + e.movementY * 0.003)
    );
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

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
  let compassTimer = 0;
  const clock = new THREE.Clock();

  function loop() {
    requestAnimationFrame(loop);

    const dt = Math.min(clock.getDelta(), 0.1);

    // 방향키로 화면 회전 (좌우 무제한, 위아래는 거의 수직까지)
    if (keys.ArrowLeft) me.yaw += 1.8 * dt;
    if (keys.ArrowRight) me.yaw -= 1.8 * dt;
    if (keys.ArrowUp) me.pitch -= 1.5 * dt;
    if (keys.ArrowDown) me.pitch += 1.5 * dt;
    me.pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, me.pitch));

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
      const speed = (keys.ShiftLeft ? 14 : 7) * (fast ? fastMult : 1);

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

    // 3인칭 카메라 (360도 궤도 회전)
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

    // 나침반 (0.1초마다)
    compassTimer += dt;
    if (compassTimer > 0.1) {
      compassTimer = 0;
      updateCompass();
    }

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
      '클릭=마우스 잠금, WASD, Shift=달리기, 방향키=화면 회전';

    renderer.render(scene, camera);
  }

  // 초기 청크를 빠르게 생성
  updateChunks(me.x, me.z);
  updateChunks(me.x, me.z);
  updateChunks(me.x, me.z);
  updateCompass();

  loop();
}
