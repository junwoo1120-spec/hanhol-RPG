import * as THREE from 'three';
import { makeTerrain, WATER_LEVEL } from './terrain.js';


const S = 32, N = 32;
const VIEW = 5, UNLOAD = VIEW + 2;

// 맵 경계: 중심 기준 각 방향 4650 유닛까지 이동 가능
const WORLD_LIMIT = 4650;


$('join').onclick = () => {
  $('join').disabled = true;
  const socket = io();
  socket.on('full', () => { $('msg').textContent = '서버가 가득 찼어요 (최대 10명)'; });
  socket.on('init', (d) => boot(socket, d));
  socket.emit('join', { nick: $('nick').value });
};

function makeLabel(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px sans-serif'; g.textAlign = 'center';
  g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(text, 128, 44);
  g.fillStyle = '#fff'; g.fillText(text, 128, 44);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sp.scale.set(3, 0.75, 1); sp.position.y = 2.6;
  return sp;
}
function makeAvatar(nick, color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.0, 4, 8),
    new THREE.MeshLambertMaterial({ color }));
  body.position.y = 0.9; g.add(body); g.add(makeLabel(nick));
  return g;
}

function boot(socket, { id, seed }) {
  $('login').style.display = 'none';
  const T = makeTerrain(seed);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa8c8e8);
  scene.fog = new THREE.Fog(0xa8c8e8, 70, VIEW * S - 8);
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 400);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 0.9));
  const sun = new THREE.DirectionalLight(0xfff2d0, 1.0); sun.position.set(80, 120, 40); scene.add(sun);

  const water = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x2f6fb5, transparent: true, opacity: 0.72 }));
  water.position.y = WATER_LEVEL; scene.add(water);

  // ---------- 청크 ----------
  const idx = [];
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const a = z * (N + 1) + x, b = a + 1, c = a + N + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const sharedIndex = new THREE.BufferAttribute(new Uint16Array(idx), 1);
  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const chunks = new Map();
  const E = 0.5;

  function buildChunk(cx, cz) {
    const V = (N + 1) * (N + 1);
    const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), col = new Float32Array(V * 3);
    let i = 0;
    for (let z = 0; z <= N; z++) for (let x = 0; x <= N; x++, i++) {
      const wx = cx * S + (x * S) / N, wz = cz * S + (z * S) / N;
      const h = T.height(wx, wz);
      // 월드 좌표 기준 유한차분 법선 -> 청크 경계에서 음영이 끊기지 않음
      let nx = T.height(wx - E, wz) - T.height(wx + E, wz), ny = 2 * E, nz = T.height(wx, wz - E) - T.height(wx, wz + E);
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      let c = T.color(wx, wz, h);
      const rock = 1 - Math.min(1, Math.max(0, (ny - 0.65) / 0.2)); // 가파르면 바위색
      c = [c[0] + (0.45 - c[0]) * rock, c[1] + (0.43 - c[1]) * rock, c[2] + (0.40 - c[2]) * rock];
      pos.set([(x * S) / N, h, (z * S) / N], i * 3);
      nor.set([nx, ny, nz], i * 3);
      col.set(c, i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(sharedIndex);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, terrainMat);
    mesh.position.set(cx * S, 0, cz * S);
    mesh.userData = { cx, cz };
    scene.add(mesh);
    chunks.set(cx + ',' + cz, mesh);
  }

  function updateChunks(px, pz) {
    const pcx = Math.floor(px / S), pcz = Math.floor(pz / S);
    for (const [k, m] of chunks) {
      if (Math.max(Math.abs(m.userData.cx - pcx), Math.abs(m.userData.cz - pcz)) > UNLOAD) {
        scene.remove(m); m.geometry.dispose(); chunks.delete(k);
      }
    }
    let best = null, bd = Infinity;               // 프레임당 가장 가까운 빈 청크 1개만 생성
    for (let dz = -VIEW; dz <= VIEW; dz++) for (let dx = -VIEW; dx <= VIEW; dx++) {
      const d = dx * dx + dz * dz;
      if (d > VIEW * VIEW || d >= bd || chunks.has((pcx + dx) + ',' + (pcz + dz))) continue;
      bd = d; best = [pcx + dx, pcz + dz];
    }
    if (best) buildChunk(best[0], best[1]);
  }

  // ---------- 플레이어 ----------
  let sx = 0, sz = 0;                              // 육지 스폰 탐색 (나선형)
  search: for (let r = 0; r < 400; r += 8)
    for (let a = 0; a < 6.28; a += 0.5) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (T.height(x, z) > 3) { sx = x; sz = z; break search; }
    }
  const me = { x: sx, z: sz, y: 0, yaw: 0, pitch: 0.45, ry: 0 };
  const myAvatar = makeAvatar('', 0xffffff); scene.add(myAvatar); // 본인은 라벨 없이
  myAvatar.children[1].visible = false;

  const keys = {};
  addEventListener('keydown', (e) => { keys[e.code] = true; });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    me.yaw -= e.movementX * 0.003;
    me.pitch = Math.min(1.2, Math.max(0.1, me.pitch + e.movementY * 0.003));
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ---------- 네트워크 ----------
  const remotes = new Map();
  socket.on('state', (list) => {
    const seen = new Set();
    for (const [pid, nick, x, y, z, ry] of list) {
      if (pid === id) continue;
      seen.add(pid);
      let r = remotes.get(pid);
      if (!r) {
        r = { g: makeAvatar(nick, 0xffa040), t: { x, y, z, ry } };
        r.g.position.set(x, y, z); scene.add(r.g); remotes.set(pid, r);
      }
      r.t = { x, y, z, ry };
    }
    for (const [pid, r] of remotes) if (!seen.has(pid)) { scene.remove(r.g); remotes.delete(pid); }
  });
  socket.on('correct', (p) => { me.x = p.x; me.z = p.z; });

  let sendTimer = 0;
  const clock = new THREE.Clock();

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.1);

    const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
    const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
    let mx = 0, mz = 0;
    if (keys.KeyW) { mx += fx; mz += fz; }
    if (keys.KeyS) { mx -= fx; mz -= fz; }
    if (keys.KeyD) { mx += rx; mz += rz; }
    if (keys.KeyA) { mx -= rx; mz -= rz; }
    const len = Math.hypot(mx, mz);
   
if (len > 0) {
  const sp = keys.ShiftLeft ? 14 : 7;

  const nextX = me.x + (mx / len) * sp * dt;
  const nextZ = me.z + (mz / len) * sp * dt;

  // 맵 경계 밖으로 이동하지 못하게 제한
  me.x = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, nextX));
  me.z = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, nextZ));

  me.ry = Math.atan2(mx, mz);
}

    me.y = Math.max(T.height(me.x, me.z), WATER_LEVEL - 0.8);
    myAvatar.position.set(me.x, me.y, me.z); myAvatar.rotation.y = me.ry;

    const dist = 9;
    const cx = me.x + Math.sin(me.yaw) * Math.cos(me.pitch) * dist;
    const cz = me.z + Math.cos(me.yaw) * Math.cos(me.pitch) * dist;
    const cy = Math.max(me.y + Math.sin(me.pitch) * dist + 1.5, T.height(cx, cz) + 1.5);
    camera.position.set(cx, cy, cz);
    camera.lookAt(me.x, me.y + 1.5, me.z);

    water.position.x = me.x; water.position.z = me.z;
    updateChunks(me.x, me.z);

    for (const r of remotes.values()) {
      const k = 1 - Math.exp(-12 * dt);
      r.g.position.x += (r.t.x - r.g.position.x) * k;
      r.g.position.y += (r.t.y - r.g.position.y) * k;
      r.g.position.z += (r.t.z - r.g.position.z) * k;
      r.g.rotation.y = r.t.ry;
    }

    sendTimer += dt;
    if (sendTimer > 0.05) {
      sendTimer = 0;
      socket.emit('move', { x: me.x, y: me.y, z: me.z, ry: me.ry });
    }
    $('hud').textContent = `X ${me.x.toFixed(0)}  Z ${me.z.toFixed(0)}\n청크 ${chunks.size}  접속 ${remotes.size + 1}명\n클릭=마우스 잠금, WASD, Shift=달리기`;
    renderer.render(scene, camera);
  }
  loop();
}
