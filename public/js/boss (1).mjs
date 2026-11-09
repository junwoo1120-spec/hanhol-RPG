// 보스 '오크 대전사' 그리기 + 보스 터의 뼈 장식 + 화면 위 보스 체력바
// 서버가 위치·전투를 정하고, 여기서는 받아서 그려요. (계산: boss-ai.mjs, 터 위치: terrain.js 의 T.arena)
//  - 모델은 캐릭터 시트를 따라 코드로 만들었어요: 근육(가슴·복근·이두·승모근)이 살아 있는 올리브색 몸, 가시 달린 어깨 갑옷,
//    해골 버클 벨트, 너덜너덜한 붉은 천, 엄니·흉터·상투·말총머리, 구부러진 날의 큰 도끼
//  - 피부·금속·가죽·천·나무·뼈는 그림판(캔버스)으로 직접 그린 텍스처를 입혀서 때 묻고 긁힌 느낌을 냈어요 (이미지 파일 필요 없음)
//  - 동작: 숨쉬기 / 걷기(무릎·팔꿈치 접힘) / 몸을 비틀며 도끼를 머리 위로 들었다 내려찍기(드는 동안 피할 틈이 있어요) / 맞으면 붉게 번쩍 / 쓰러짐
//  - 보스 터: 어두운 흙(땅 색은 terrain.js + main.js 셰이더)에 뼈가 몇 개씩 꽂혀 있어요
//  - 전투가 시작되면(보스가 때리려 하거나 맞으면) 화면 위 가운데(나침반 아래)에 체력바가 떠요
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BOSS } from './boss-ai.mjs';
import { createSlamFx } from './slam-fx.js';

const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ================= 텍스처 (캔버스로 직접 그림) =================
function rngOf(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
function canvasTex(seed, draw) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  draw(ctx, rngOf(seed), 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const blotches = (ctx, r, n, rgb, aMin, aMax, rMin, rMax) => {   // 번진 얼룩
  for (let i = 0; i < n; i++) {
    const x = r() * 256, y = r() * 256, rad = rMin + r() * (rMax - rMin), a = aMin + r() * (aMax - aMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(' + rgb + ',' + a.toFixed(3) + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
};
const strokes = (ctx, r, n, rgb, a, w, lMin, lMax, ang = null) => {   // 긁힌 선·결
  ctx.strokeStyle = 'rgba(' + rgb + ',' + a + ')'; ctx.lineWidth = w; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = r() * 256, y = r() * 256, l = lMin + r() * (lMax - lMin), t = ang === null ? r() * TAU : ang + (r() - 0.5) * 0.25;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(t) * l, y + Math.sin(t) * l); ctx.stroke();
  }
};
const speckle = (ctx, r, n, rgb, a) => { ctx.fillStyle = 'rgba(' + rgb + ',' + a + ')'; for (let i = 0; i < n; i++) ctx.fillRect(r() * 256, r() * 256, 1 + r() * 1.5, 1 + r() * 1.5); };

const TEX = {
  skin: () => canvasTex(11, (ctx, r) => {
    ctx.fillStyle = '#718733'; ctx.fillRect(0, 0, 256, 256);
    blotches(ctx, r, 100, '150,176,72', 0.1, 0.22, 10, 36); blotches(ctx, r, 100, '58,76,24', 0.1, 0.24, 10, 36);
    strokes(ctx, r, 46, '66,86,30', 0.45, 1.3, 20, 70);                    // 핏줄
    strokes(ctx, r, 16, '170,70,50', 0.5, 2, 8, 26);                       // 흉터
    speckle(ctx, r, 1600, '30,40,14', 0.2); speckle(ctx, r, 900, '190,210,110', 0.14);
  }),
  metal: () => canvasTex(23, (ctx, r) => {
    ctx.fillStyle = '#5a5760'; ctx.fillRect(0, 0, 256, 256);
    blotches(ctx, r, 70, '34,32,38', 0.14, 0.3, 8, 30); blotches(ctx, r, 50, '150,146,156', 0.08, 0.18, 8, 26);
    blotches(ctx, r, 26, '128,74,40', 0.12, 0.26, 6, 22);                  // 녹
    strokes(ctx, r, 140, '190,186,196', 0.3, 1, 8, 44); strokes(ctx, r, 70, '20,18,22', 0.4, 1, 6, 30);
    speckle(ctx, r, 800, '10,10,12', 0.25);
  }),
  paint: () => canvasTex(37, (ctx, r) => {                                // 어깨판의 붉은 칠 (긁히고 벗겨짐)
    ctx.fillStyle = '#92302a'; ctx.fillRect(0, 0, 256, 256);
    blotches(ctx, r, 70, '60,16,14', 0.16, 0.34, 8, 30); blotches(ctx, r, 40, '200,110,90', 0.06, 0.14, 10, 28);
    strokes(ctx, r, 90, '210,150,130', 0.3, 1.2, 12, 60); strokes(ctx, r, 40, '40,30,30', 0.5, 2, 10, 40);
    blotches(ctx, r, 18, '84,80,88', 0.5, 0.7, 5, 14);                       // 칠이 벗겨져 쇠가 보임
  }),
  cloth: () => canvasTex(41, (ctx, r) => {
    ctx.fillStyle = '#8e2d28'; ctx.fillRect(0, 0, 256, 256);
    strokes(ctx, r, 130, '176,70,60', 0.25, 1, 40, 120, Math.PI / 2); strokes(ctx, r, 130, '70,18,16', 0.3, 1, 40, 120, Math.PI / 2);
    blotches(ctx, r, 50, '30,12,10', 0.14, 0.32, 10, 34); speckle(ctx, r, 500, '20,10,8', 0.2);
  }),
  leather: () => canvasTex(53, (ctx, r) => {
    ctx.fillStyle = '#5e3e2c'; ctx.fillRect(0, 0, 256, 256);
    blotches(ctx, r, 80, '30,18,12', 0.12, 0.3, 8, 28); blotches(ctx, r, 50, '130,90,60', 0.07, 0.16, 8, 26);
    strokes(ctx, r, 70, '30,18,12', 0.45, 1, 6, 28); speckle(ctx, r, 900, '20,12,8', 0.2);
  }),
  wood: () => canvasTex(67, (ctx, r) => {
    ctx.fillStyle = '#573a28'; ctx.fillRect(0, 0, 256, 256);
    strokes(ctx, r, 110, '34,20,12', 0.4, 2, 60, 200, Math.PI / 2); strokes(ctx, r, 90, '128,90,60', 0.22, 1.5, 40, 160, Math.PI / 2);
    blotches(ctx, r, 24, '28,16,10', 0.3, 0.5, 4, 12);
  }),
  bone: () => canvasTex(71, (ctx, r) => {
    ctx.fillStyle = '#e6dcc0'; ctx.fillRect(0, 0, 256, 256);
    blotches(ctx, r, 60, '150,128,90', 0.1, 0.24, 8, 30); strokes(ctx, r, 40, '110,92,64', 0.4, 1, 6, 30); speckle(ctx, r, 500, '90,74,50', 0.2);
  }),
  blade: () => canvasTex(83, (ctx, r) => {
    ctx.fillStyle = '#a79f8f'; ctx.fillRect(0, 0, 256, 256);
    blotches(ctx, r, 70, '70,64,56', 0.12, 0.28, 8, 30); blotches(ctx, r, 40, '216,208,190', 0.08, 0.18, 8, 26);
    strokes(ctx, r, 130, '230,224,208', 0.3, 1, 10, 60); strokes(ctx, r, 60, '40,36,32', 0.5, 1.5, 8, 34);
    blotches(ctx, r, 18, '120,70,40', 0.2, 0.34, 5, 16);
  }),
};

// ---------- 재질 (보스는 한 마리라 전부 같이 번쩍이게 함) ----------
let MAT = null;
function materials() {
  if (MAT) return MAT;
  const S = (map, o = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0.0, ...o });
  MAT = {
    skin: S(TEX.skin(), { roughness: 0.72 }), skinDk: S(TEX.skin(), { color: 0x9aa890, roughness: 0.78 }),
    metal: S(TEX.metal(), { roughness: 0.55, metalness: 0.45 }), metalLt: S(TEX.metal(), { color: 0xcfcad4, roughness: 0.45, metalness: 0.5 }),
    paint: S(TEX.paint(), { roughness: 0.6, metalness: 0.25 }), cloth: S(TEX.cloth(), { roughness: 0.95, side: THREE.DoubleSide }),
    leather: S(TEX.leather(), { roughness: 0.85 }), wood: S(TEX.wood(), { roughness: 0.9 }),
    bone: S(TEX.bone(), { roughness: 0.7 }), blade: S(TEX.blade(), { roughness: 0.5, metalness: 0.4 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x2a1c18, roughness: 0.9 }),
    dark: new THREE.MeshBasicMaterial({ color: 0x120b08 }),
    scar: new THREE.MeshStandardMaterial({ color: 0xa8402e, roughness: 0.8 }),
    eye: new THREE.MeshBasicMaterial({ color: 0xffd84a }),
  };
  return MAT;
}
const flashList = () => { const m = materials(); return [m.skin, m.skinDk, m.metal, m.metalLt, m.paint, m.cloth, m.leather, m.wood, m.bone, m.blade, m.hair, m.scar]; };
const setFlash = (on) => { for (const m of flashList()) m.emissive.setHex(on ? 0x992a10 : 0x000000); };

// ================= 모델 =================
// 모델 높이 약 2.8m (× BOSS.SCALE). 앞쪽 = +z. 캐릭터의 오른손(도끼 든 쪽) = -x
const put = (m, x, y, z, parent) => { m.position.set(x, y, z); if (parent) parent.add(m); return m; };
const ell = (rx, ry, rz, mat, x, y, z, parent, seg = 12) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, seg, Math.max(6, seg - 4)), mat); m.scale.set(rx, ry, rz); return put(m, x, y, z, parent); };
const rbox = (w, h, d, r, mat, x, y, z, parent) => put(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat), x, y, z, parent);
const tube = (r0, r1, len, mat, x, y, z, parent, seg = 12) => put(new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg), mat), x, y, z, parent);   // r0 = 위쪽, r1 = 아래쪽
const spike = (r, len, mat, x, y, z, parent, seg = 7) => put(new THREE.Mesh(new THREE.ConeGeometry(r, len, seg), mat), x, y, z, parent);
const ring = (R, tr, mat, x, y, z, parent) => { const m = put(new THREE.Mesh(new THREE.TorusGeometry(R, tr, 6, 14), mat), x, y, z, parent); m.rotation.x = Math.PI / 2; return m; };

// 같은 부위(그룹)에 같은 재질로 붙은 조각들을 한 덩어리로 합쳐서 그리기 횟수를 줄임
function bake(g) {
  for (const c of [...g.children]) if (c.isGroup) bake(c);
  const buckets = new Map();
  for (const c of [...g.children]) if (c.isMesh) { c.updateMatrix(); if (!buckets.has(c.material)) buckets.set(c.material, []); buckets.get(c.material).push(c); }
  for (const [mat, list] of buckets) {
    if (list.length < 2) continue;
    const geos = list.map((m) => { const q = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); q.applyMatrix4(m.matrix); return q; });
    const merged = mergeGeometries(geos);
    for (const m of list) { g.remove(m); m.geometry.dispose(); }
    geos.forEach((q) => q.dispose());
    g.add(new THREE.Mesh(merged, mat));
  }
}

function axeHeadGeo() {   // 구부러진 큰 도끼날 (옆모습 윤곽을 그려서 두께를 줌)
  const sh = new THREE.Shape();
  const K = 0.72;   // 전체 폭 조절
  const P = (x, y) => [x * K, y];
  sh.moveTo(...P(0.02, 0.62)); sh.lineTo(...P(0.02, 1.5)); sh.lineTo(...P(-0.1, 1.52));
  sh.quadraticCurveTo(...P(-0.55, 1.95), ...P(-1.0, 1.78));                 // 윗뿔
  sh.quadraticCurveTo(...P(-1.22, 1.38), ...P(-1.06, 1.02));                // 날(바깥 곡선)
  sh.quadraticCurveTo(...P(-1.2, 0.55), ...P(-0.88, 0.22));                 // 아랫뿔
  sh.quadraticCurveTo(...P(-0.45, 0.4), ...P(-0.1, 0.62));
  sh.lineTo(...P(0.02, 0.62));
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -0.035);
  g.scale(0.55, 0.55, 1);   // 크기 맞춤: 날 폭 약 0.5, 높이 약 0.95 (자루 좌표 0.12~1.07)
  return g;
}

function buildOrc() {
  const M = materials();
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const body = new THREE.Group(); root.add(body);
  const HIP = 1.23;   // 엉덩이 높이 (장화 밑창이 정확히 땅에 닿도록)

  // ----- 다리 -----
  const legs = [], knees = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(sx * 0.3, HIP, 0); body.add(leg);
    tube(0.25, 0.19, 0.56, M.skin, 0, -0.27, 0, leg, 14);                                   // 허벅지
    ell(0.2, 0.3, 0.2, M.skin, 0, -0.2, 0.05, leg);                                         // 앞 허벅지 근육
    ring(0.23, 0.03, M.leather, 0, -0.38, 0, leg);                                          // 허벅지 가죽끈
    const knee = new THREE.Group(); knee.position.y = -0.54; leg.add(knee);
    ell(0.19, 0.19, 0.19, M.skin, 0, 0, 0, knee);                                           // 무릎
    rbox(0.36, 0.3, 0.2, 0.06, M.metal, 0, 0.0, 0.17, knee);                                // 무릎 보호대
    spike(0.055, 0.22, M.metalLt, 0, 0.0, 0.34, knee).rotation.x = Math.PI / 2;             // 무릎 가시
    for (const dx of [-0.12, 0.12]) ell(0.025, 0.025, 0.025, M.metalLt, dx, 0.1, 0.28, knee, 6);   // 리벳
    tube(0.17, 0.14, 0.5, M.leather, 0, -0.28, 0, knee, 12);                                // 정강이
    rbox(0.3, 0.42, 0.1, 0.04, M.metal, 0, -0.28, 0.14, knee);                              // 정강이 철판
    ring(0.18, 0.025, M.metalLt, 0, -0.1, 0, knee); ring(0.16, 0.025, M.metalLt, 0, -0.44, 0, knee);
    rbox(0.38, 0.2, 0.58, 0.06, M.metal, 0, -0.56, 0.1, knee);                              // 장화
    rbox(0.34, 0.15, 0.2, 0.05, M.metalLt, 0, -0.55, 0.36, knee);                           // 앞코 철판
    rbox(0.4, 0.06, 0.62, 0.02, M.leather, 0, -0.66, 0.1, knee);                            // 밑창
    legs.push(leg); knees.push(knee);
  }

  // ----- 몸통 -----
  const torso = new THREE.Group(); torso.position.y = HIP; body.add(torso);
  ell(0.4, 0.22, 0.28, M.skin, 0, 0.02, 0, torso);                                          // 골반
  ell(0.36, 0.3, 0.26, M.skin, 0, 0.3, 0, torso);                                           // 배
  for (const [x, y] of [[-0.1, 0.16], [0.1, 0.16], [-0.1, 0.3], [0.1, 0.3], [-0.09, 0.43], [0.09, 0.43]]) ell(0.085, 0.06, 0.04, M.skinDk, x, y, 0.235, torso, 8);   // 복근
  ell(0.62, 0.42, 0.38, M.skin, 0, 0.84, 0, torso, 16);                                     // 가슴통
  for (const sx of [-1, 1]) {
    ell(0.27, 0.19, 0.16, M.skinDk, sx * 0.25, 0.86, 0.27, torso, 12);                      // 대흉근
    ell(0.22, 0.2, 0.2, M.skin, sx * 0.26, 1.2, -0.02, torso, 10);                          // 승모근
    ell(0.3, 0.36, 0.16, M.skin, sx * 0.34, 0.8, -0.24, torso, 10);                         // 광배근
    ell(0.12, 0.22, 0.12, M.skin, sx * 0.4, 0.4, 0.05, torso, 8);                           // 옆구리
  }
  ell(0.18, 0.3, 0.1, M.skinDk, 0, 0.85, -0.34, torso, 8);                                  // 척추 근육
  // 흉터
  for (const [x, y, a] of [[-0.3, 0.9, 0.55], [-0.3, 0.9, -0.55], [0.22, 0.5, 0.2]]) { const sc = rbox(0.035, 0.42, 0.03, 0.012, M.scar, x, y, 0.4, torso); sc.rotation.z = a; }
  // 벨트 + 해골 버클
  const belt = tube(0.4, 0.4, 0.15, M.leather, 0, -0.04, 0, torso, 18); belt.scale.set(1.0, 1, 0.76);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; ell(0.028, 0.028, 0.028, M.metalLt, Math.cos(a) * 0.4, -0.04, Math.sin(a) * 0.3, torso, 6); }
  rbox(0.38, 0.38, 0.09, 0.05, M.metal, 0, -0.04, 0.31, torso);                             // 버클 판
  for (const [x, y] of [[-0.15, 0.13], [0.15, 0.13], [-0.15, -0.21], [0.15, -0.21]]) ell(0.025, 0.025, 0.025, M.metalLt, x, y, 0.37, torso, 6);
  ell(0.12, 0.13, 0.08, M.bone, 0, -0.01, 0.38, torso, 10);                                 // 해골
  rbox(0.1, 0.05, 0.07, 0.015, M.bone, 0, -0.1, 0.4, torso);                                // 턱뼈
  for (const sx of [-1, 1]) ell(0.03, 0.035, 0.03, M.dark, sx * 0.05, 0.0, 0.44, torso, 6);   // 눈구멍
  // 너덜너덜한 붉은 천 (앞·뒤) + 옆 가죽 치마
  const stripes = [[-0.17, 0.5, 0.06], [-0.085, 0.62, -0.03], [0, 0.78, 0.02], [0.085, 0.58, -0.05], [0.17, 0.46, 0.04]];
  for (const [x, len, rot] of stripes) {
    const f = rbox(0.095, len, 0.025, 0.008, M.cloth, x, -0.12 - len / 2, 0.32, torso); f.rotation.z = rot;
    const t = spike(0.048, 0.14, M.cloth, x + Math.sin(rot) * len * 0.5, -0.12 - len - 0.04, 0.32, torso, 4); t.rotation.x = Math.PI; t.scale.z = 0.4;
    const b = rbox(0.1, len * 1.1, 0.025, 0.008, M.cloth, x * 1.2, -0.12 - len * 0.55, -0.3, torso); b.rotation.z = -rot;
  }
  for (const sx of [-1, 1]) { const fl = rbox(0.22, 0.46, 0.05, 0.015, M.leather, sx * 0.4, -0.3, 0.12, torso); fl.rotation.z = sx * 0.18; ring(0.025, 0.012, M.metalLt, sx * 0.4, -0.1, 0.16, torso); }
  // 가슴 가죽끈 (X 자로 교차) + 금속 버클
  const s1 = rbox(0.14, 1.12, 0.05, 0.02, M.leather, 0.05, 0.82, 0.37, torso); s1.rotation.z = -0.62;
  const s2 = rbox(0.14, 1.12, 0.05, 0.02, M.leather, 0.0, 0.82, -0.37, torso); s2.rotation.z = 0.62;
  rbox(0.11, 0.14, 0.07, 0.02, M.metal, 0.2, 1.02, 0.4, torso); rbox(0.1, 0.1, 0.06, 0.02, M.metalLt, 0.05, 0.82, 0.41, torso);

  // ----- 머리 -----
  const head = new THREE.Group(); head.position.set(0, 1.4, 0.1); torso.add(head);
  tube(0.17, 0.2, 0.26, M.skin, 0, -0.17, -0.03, head, 10);                                  // 목
  ell(0.29, 0.28, 0.31, M.skin, 0, 0, 0, head, 16);                                          // 머리통
  rbox(0.4, 0.17, 0.32, 0.07, M.skin, 0, -0.2, 0.12, head);                                  // 아래턱 (앞으로 튀어나옴)
  rbox(0.27, 0.05, 0.1, 0.02, M.dark, 0, -0.16, 0.265, head);                                // 입 안쪽
  for (const sx of [-1, 1]) {
    ell(0.1, 0.075, 0.09, M.skin, sx * 0.17, -0.05, 0.2, head, 8);                           // 광대뼈
    const br = rbox(0.2, 0.075, 0.14, 0.03, M.skinDk, sx * 0.1, 0.075, 0.23, head); br.rotation.z = -sx * 0.3;   // 찌푸린 눈썹
    ell(0.05, 0.04, 0.03, M.dark, sx * 0.1, 0.0, 0.27, head, 6);                             // 눈 그늘
    ell(0.034, 0.028, 0.02, M.eye, sx * 0.1, 0.0, 0.285, head, 6);                           // 빛나는 눈
    const tusk = spike(0.05, 0.26, M.bone, sx * 0.125, -0.12, 0.29, head, 8); tusk.rotation.x = -0.22; tusk.rotation.z = -sx * 0.12;   // 위로 솟은 엄니
    const fang = spike(0.02, 0.07, M.bone, sx * 0.06, -0.14, 0.31, head, 5); fang.rotation.x = Math.PI;
    const ear = spike(0.075, 0.34, M.skin, sx * 0.31, 0.06, -0.02, head, 6); ear.rotation.z = -sx * 1.2; ear.rotation.y = sx * 0.2;   // 뾰족한 귀
    ring(0.04, 0.012, M.metalLt, sx * 0.4, -0.04, -0.02, head).rotation.x = 0;                // 귀걸이
  }
  ell(0.07, 0.09, 0.08, M.skin, 0, -0.03, 0.31, head, 8);                                     // 코
  for (const sx of [-1, 1]) ell(0.015, 0.015, 0.015, M.dark, sx * 0.03, -0.07, 0.37, head, 5);   // 콧구멍
  const sc = rbox(0.025, 0.2, 0.02, 0.008, M.scar, -0.14, 0.02, 0.29, head); sc.rotation.z = 0.5;   // 눈가 흉터
  put(new THREE.Mesh(new THREE.SphereGeometry(0.31, 14, 8, 0, TAU, 0, 1.0), M.hair), 0, 0.0, -0.04, head);   // 머리카락(위쪽 반구)
  ell(0.105, 0.1, 0.1, M.hair, 0, 0.3, -0.06, head, 10);                                      // 상투
  ring(0.09, 0.02, M.leather, 0, 0.23, -0.06, head);                                          // 상투 묶음띠
  const pony = new THREE.Group(); pony.position.set(0, 0.26, -0.18); head.add(pony);         // 말총머리 (움직임에 따라 흔들림)
  ell(0.08, 0.08, 0.1, M.hair, 0, 0, 0, pony, 8); ell(0.075, 0.075, 0.1, M.hair, 0, -0.07, -0.13, pony, 8); ell(0.065, 0.065, 0.1, M.hair, 0, -0.17, -0.24, pony, 8);
  spike(0.06, 0.26, M.hair, 0, -0.3, -0.32, pony, 6).rotation.x = -2.6;
  ring(0.07, 0.015, M.cloth, 0, -0.03, -0.07, pony);

  // ----- 팔 + 어깨 갑옷 -----
  const arms = [], elbows = [], hands = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(sx * 0.76, 1.04, 0); torso.add(arm);
    const big = sx < 0;                                                                       // 도끼 든 쪽 어깨 갑옷이 더 큼
    ell(0.23, 0.22, 0.23, M.skin, 0, 0, 0, arm);                                              // 어깨 근육
    tube(0.2, 0.16, 0.5, M.skin, 0, -0.27, 0, arm, 14);                                       // 위팔
    ell(0.15, 0.2, 0.14, M.skin, 0, -0.25, 0.1, arm, 10); ell(0.13, 0.18, 0.12, M.skinDk, 0, -0.27, -0.1, arm, 10);   // 이두·삼두
    // 어깨 갑옷
    const R = big ? 0.46 : 0.36;
    const shell = put(new THREE.Mesh(new THREE.SphereGeometry(R, 16, 9, 0, TAU, 0, 1.25), M.metal), sx * 0.03, 0.08, 0, arm); shell.scale.set(1.15, 0.8, 1.05); shell.rotation.z = sx * 0.12;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; ell(0.026, 0.026, 0.026, M.metalLt, sx * 0.03 + Math.cos(a) * R * 1.0, 0.1, Math.sin(a) * R * 0.9, arm, 6); }   // 테두리 리벳
    const pl = rbox(R * 1.1, 0.05, R * 0.95, 0.02, M.paint, sx * 0.04, big ? 0.38 : 0.31, 0, arm); pl.rotation.z = sx * 0.12;   // 붉은 칠한 윗판
    rbox(R * 1.6, 0.1, R * 1.35, 0.03, M.metal, sx * 0.1, 0.02, 0, arm).rotation.z = sx * 0.2;                                 // 아래 겹판
    rbox(R * 1.4, 0.08, R * 1.2, 0.03, M.metalLt, sx * 0.16, -0.08, 0, arm).rotation.z = sx * 0.28;
    const sp = spike(big ? 0.11 : 0.085, big ? 0.62 : 0.42, M.blade, sx * 0.0, big ? 0.66 : 0.52, 0, arm, 8); sp.rotation.z = sx * -0.05;   // 큰 가시
    if (big) { const s2 = spike(0.07, 0.36, M.blade, -0.24, 0.5, 0.08, arm, 7); s2.rotation.z = 0.5; const s3 = spike(0.06, 0.3, M.blade, 0.2, 0.46, -0.1, arm, 7); s3.rotation.z = -0.4; }
    // 팔꿈치 + 아래팔
    const elbow = new THREE.Group(); elbow.position.y = -0.52; arm.add(elbow);
    ell(0.16, 0.16, 0.16, M.skin, 0, 0, 0, elbow, 10);
    tube(0.15, 0.115, 0.46, M.skin, 0, -0.25, 0, elbow, 12);                                  // 아래팔
    tube(0.2, 0.17, 0.32, M.metal, 0, -0.27, 0, elbow, 12);                                    // 팔뚝 보호대
    rbox(0.07, 0.3, 0.12, 0.025, M.metalLt, sx * 0.17, -0.27, 0, elbow);                       // 바깥 판
    ring(0.2, 0.025, M.leather, 0, -0.14, 0, elbow); ring(0.18, 0.025, M.leather, 0, -0.4, 0, elbow);
    for (const dy of [-0.2, -0.34]) ell(0.022, 0.022, 0.022, M.metalLt, 0, dy, 0.19, elbow, 5);
    const hand = new THREE.Group(); hand.position.y = -0.52; elbow.add(hand);
    rbox(0.26, 0.24, 0.28, 0.08, M.skin, 0, -0.1, 0.02, hand);                                 // 주먹
    for (let i = 0; i < 4; i++) ell(0.04, 0.04, 0.04, M.skinDk, -0.09 + i * 0.06, -0.17, 0.15, hand, 6);   // 손가락 마디
    ell(0.06, 0.08, 0.06, M.skin, sx * 0.14, -0.08, 0.08, hand, 6);                            // 엄지
    arms.push(arm); elbows.push(elbow); hands.push(hand);
  }

  // ----- 도끼 (오른손 = hands[0]) -----
  const axe = new THREE.Group(); axe.position.set(0, -0.1, 0.04); hands[0].add(axe);
  tube(0.045, 0.05, 1.75, M.wood, 0, 0.525, 0, axe, 8);                                        // 자루 (-0.35 ~ 1.4)
  tube(0.062, 0.062, 0.46, M.cloth, 0, 0.0, 0, axe, 8);                                        // 붉은 천 감은 손잡이
  for (const y of [0.3, 0.66, 1.3]) ring(0.058, 0.02, M.metal, 0, y, 0, axe);                  // 쇠 고리
  spike(0.065, 0.3, M.metalLt, 0, -0.5, 0, axe, 6).rotation.x = Math.PI;                      // 아래 뾰족 장식
  spike(0.06, 0.34, M.blade, 0, 1.55, 0, axe, 6);                                              // 위 뾰족 장식
  rbox(0.15, 0.6, 0.15, 0.03, M.metal, 0, 0.9, 0, axe);                                         // 날 끼우는 쇠 통
  put(new THREE.Mesh(axeHeadGeo(), M.blade), 0, 0.3, 0, axe);                                   // 도끼날 (-x 쪽으로 퍼짐)
  const back = spike(0.07, 0.4, M.metalLt, 0.2, 0.9, 0, axe, 6); back.rotation.z = -Math.PI / 2;   // 뒤쪽 뿔
  for (const [x, y] of [[-0.42, 0.8], [-0.46, 0.95], [-0.4, 0.65]]) ell(0.022, 0.035, 0.05, M.dark, x, y, 0, axe, 5);   // 날 이 빠진 자국

  root.userData = { body, torso, head, pony, legs, knees, arms, elbows, hands, axe };
  bake(root);
  return root;
}

// ================= 보스 터의 뼈 =================
function buildBones(arena, T) {
  const M = materials();
  let s = ((arena.x * 73856093) ^ (arena.z * 19349663)) >>> 0 || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const boneGeos = [], darkGeos = [];
  const add = (geo, x, y, z, rx, ry, rz, sx = 1, sy = 1, sz = 1, list = boneGeos) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
    const g = geo.clone(); g.applyMatrix4(m); list.push(g);
  };
  const shaft = new THREE.CylinderGeometry(0.07, 0.09, 1, 7);
  const knob = new THREE.SphereGeometry(0.14, 8, 6);
  const rib = new THREE.TorusGeometry(0.55, 0.05, 6, 12, Math.PI);
  const skull = new THREE.SphereGeometry(0.3, 10, 8);
  const jaw = new THREE.BoxGeometry(0.24, 0.12, 0.26);
  const socket = new THREE.SphereGeometry(0.075, 6, 5);
  const horn = new THREE.ConeGeometry(0.07, 0.4, 6);
  const big = new THREE.ConeGeometry(0.12, 0.9, 6);

  const CLUSTERS = 18;
  for (let c = 0; c < CLUSTERS; c++) {
    const ang = rnd() * TAU, rad = Math.sqrt(0.1 + rnd() * 0.9) * (arena.r - 6);   // 터 안쪽 (보스가 서 있는 한가운데는 약간 비움)
    const cx = arena.x + Math.cos(ang) * rad, cz = arena.z + Math.sin(ang) * rad;
    const nLong = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < nLong; i++) {       // 땅에 꽂힌 긴 뼈 2~4개
      const x = cx + (rnd() - 0.5) * 3, z = cz + (rnd() - 0.5) * 3, h = T.height(x, z);
      const L = 1.1 + rnd() * 1.2, tilt = 0.15 + rnd() * 0.55, yaw = rnd() * TAU, y = h + L * 0.3;
      add(shaft, x, y, z, tilt, yaw, 0, 1, L, 1);
      const dx = Math.sin(tilt) * Math.sin(yaw) * L / 2, dz = Math.sin(tilt) * Math.cos(yaw) * L / 2, dy = Math.cos(tilt) * L / 2;
      add(knob, x + dx, y + dy, z + dz, 0, 0, 0, 1, 0.9, 1);
      add(knob, x + dx + 0.11, y + dy - 0.04, z + dz + 0.02, 0, 0, 0, 0.7, 0.7, 0.7);
    }
    if (rnd() < 0.5) {                      // 해골 하나
      const x = cx + (rnd() - 0.5) * 3, z = cz + (rnd() - 0.5) * 3, h = T.height(x, z), yaw = rnd() * TAU;
      add(skull, x, h + 0.12, z, 0, yaw, 0, 1, 0.9, 1.1);
      add(jaw, x + Math.sin(yaw) * 0.2, h + 0.0, z + Math.cos(yaw) * 0.2, 0, yaw, 0);
      for (const sx of [-1, 1]) add(socket, x + Math.sin(yaw) * 0.25 + Math.cos(yaw) * sx * 0.11, h + 0.2, z + Math.cos(yaw) * 0.25 - Math.sin(yaw) * sx * 0.11, 0, 0, 0, 1, 1.2, 0.8, darkGeos);
      if (rnd() < 0.4) { add(horn, x + Math.cos(yaw) * 0.26, h + 0.34, z - Math.sin(yaw) * 0.26, 0, 0, -0.6); add(horn, x - Math.cos(yaw) * 0.26, h + 0.34, z + Math.sin(yaw) * 0.26, 0, 0, 0.6); }
    }
    if (rnd() < 0.3) {                      // 반쯤 묻힌 갈비뼈 줄
      const x = cx + (rnd() - 0.5) * 2, z = cz + (rnd() - 0.5) * 2, yaw = rnd() * TAU, n = 4 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        const o = (i - n / 2) * 0.3, px = x + Math.cos(yaw) * o, pz = z - Math.sin(yaw) * o, k = 1 - Math.abs(i - n / 2) * 0.12;
        add(rib, px, T.height(px, pz) - 0.05, pz, 0, yaw + Math.PI / 2, 0, k, k, 1);
      }
    }
    if (rnd() < 0.15) { const x = cx + (rnd() - 0.5) * 2, z = cz + (rnd() - 0.5) * 2; add(big, x, T.height(x, z) + 0.3, z, 0.1, rnd() * TAU, 0.2); }   // 커다란 뿔/엄니 뼈
  }
  const mk = (list, mat) => { const g = mergeGeometries(list); list.forEach((q) => q.dispose()); return new THREE.Mesh(g, mat); };
  const grp = new THREE.Group();
  grp.add(mk(boneGeos, M.bone));
  if (darkGeos.length) grp.add(mk(darkGeos, M.dark));
  return grp;
}

// ================= 화면 위 체력바 (나침반 바로 아래) =================
function buildHud() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);width:min(560px,72vw);z-index:6;pointer-events:none;opacity:0;transition:opacity .3s;text-align:center;font-family:inherit';
  el.innerHTML =
    '<div data-n style="color:#ffe9c8;font-size:20px;font-weight:700;letter-spacing:2px;text-shadow:0 2px 4px #000,0 0 8px #a02010;margin-bottom:4px"></div>' +
    '<div style="position:relative;height:22px;border:2px solid #1c0e0a;border-radius:5px;background:#2b1410;box-shadow:0 2px 8px rgba(0,0,0,.7);overflow:hidden">' +
      '<div data-lag style="position:absolute;left:0;top:0;bottom:0;width:100%;background:#e8a24a"></div>' +
      '<div data-fill style="position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(#ee4a38,#a8160e)"></div>' +
      '<div data-hp style="position:absolute;inset:0;line-height:22px;font-size:13px;font-weight:700;color:#fff;text-shadow:0 1px 2px #000"></div>' +
    '</div>';
  document.body.appendChild(el);
  return { el, name: el.querySelector('[data-n]'), fill: el.querySelector('[data-fill]'), lag: el.querySelector('[data-lag]'), hp: el.querySelector('[data-hp]') };
}

// ================= 서버가 보낸 보스를 화면에 그리기 =================
const ATK_WIND = 0.68, ATK_SLAM = 0.17, ATK_END = 1.4;   // 도끼 드는 시간 / 내려찍는 시간 / 전체(초). 내려찍는 순간 = 서버 피해 확정(0.85초)
// 도끼 든 오른팔의 기준 자세: θ = 어깨 회전(음수 = 앞으로 올림), el = 팔꿈치 굽힘, al = 자루가 세계 기준으로 기울어진 각(양수 = 앞쪽으로 기움)
const REST = { th: -0.45, el: -0.55, al: 0.35 }, WIND = { th: -2.3, el: -0.25, al: -0.3 }, SLAM = { th: -0.8, el: -0.3, al: 1.5 };

export function createBossWorld({ scene, camera, T, WATER_LEVEL }) {
  const arena = T.arena;
  if (!arena) return { onSnapshot() {}, update() {} };

  scene.add(buildBones(arena, T));
  const skillFx = createSlamFx(scene, T, { size: BOSS.SKILL.SIZE, telegraph: BOSS.SKILL.TELEGRAPH });   // 빨간 네모 + 땅 조각

  const obj = buildOrc();
  obj.scale.setScalar(BOSS.SCALE);
  obj.visible = false;
  scene.add(obj);
  const u = obj.userData;
  const hud = buildHud();
  hud.name.textContent = BOSS.NAME;

  const e = { has: false, x: arena.x, z: arena.z, ry: Math.PI, tx: arena.x, tz: arena.z, tr: Math.PI, mode: 0, hp: BOSS.HP, atkN: 0, skillN: 0, atkKind: 'atk', engaged: false, sp: 0, t: 0, walk: 0, atkT: -1, flash: 0, dying: false, dd: 0, lag: 1, barShow: 0 };

  // 서버가 보낸 [x, z, 방향, mode, hp, 공격횟수, 전투중] 또는 [] (멀리 있거나 사라짐)
  function onSnapshot(s) {
    if (!Array.isArray(s) || s.length < 7) { e.has = false; skillFx.cancel(); return; }
    const [x, z, ry, mode, hp, atkN, engaged, skillN = 0] = s;
    if (!e.has) { e.x = x; e.z = z; e.ry = ry; e.has = true; e.atkN = atkN; e.skillN = skillN; e.hp = hp; e.dying = mode === 3; e.dd = e.dying ? 9 : 0; if (hp < BOSS.HP) e.lag = hp / BOSS.HP; }
    e.tx = x; e.tz = z; e.tr = ry;
    if (mode === 3) { if (!e.dying) { e.dying = true; e.dd = 0; e.atkT = -1; skillFx.cancel(); } }
    else if (e.dying) { e.dying = false; e.dd = 0; e.lag = 1; }
    if (hp < e.hp && mode !== 3) e.flash = 0.14;                      // 맞음 → 붉게 번쩍
    if (atkN !== e.atkN) { e.atkT = 0; e.atkKind = 'atk'; e.atkN = atkN; }                // 공격 모션 시작
    if (skillN !== e.skillN) { e.skillN = skillN; e.atkT = 0; e.atkKind = 'skill'; skillFx.start(x, z, ry); }   // 내려찍기: 빨간 네모 + 땅 찍기 모션
    e.mode = mode; e.hp = hp; e.engaged = !!engaged;
  }

  function update(dt, me) {
    skillFx.update(dt);
    // ----- 체력바 -----
    const near = !!me && e.has && Math.hypot(me.x - e.x, me.z - e.z) < 90;
    const want = near && (e.engaged || (e.dying && e.dd < 2.2));
    e.barShow += ((want ? 1 : 0) - e.barShow) * Math.min(1, dt * 8);
    hud.el.style.opacity = e.barShow > 0.02 ? String(Math.min(1, e.barShow)) : '0';
    const ratio = clamp(e.hp / BOSS.HP, 0, 1);
    hud.fill.style.width = (ratio * 100).toFixed(1) + '%';
    e.lag += (ratio - e.lag) * Math.min(1, dt * (e.lag > ratio ? 1.6 : 12));   // 줄어든 만큼 주황색이 천천히 따라옴
    hud.lag.style.width = (clamp(e.lag, 0, 1) * 100).toFixed(1) + '%';
    hud.hp.textContent = Math.ceil(e.hp) + ' / ' + BOSS.HP;

    if (!e.has) { obj.visible = false; return; }
    obj.visible = true;

    const ox = e.x, oz = e.z;
    if (Math.hypot(e.tx - e.x, e.tz - e.z) > 8) { e.x = e.tx; e.z = e.tz; }   // 순간이동(복귀)은 바로 이동
    else { const k = 1 - Math.exp(-10 * dt); e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; }
    e.ry += angDiff(e.ry, e.tr) * (1 - Math.exp(-8 * dt));
    const sp = dt > 0 ? Math.hypot(e.x - ox, e.z - oz) / dt : 0;
    e.sp += (Math.min(sp, 10) - e.sp) * (1 - Math.exp(-8 * dt));
    e.t += dt;

    const y = Math.max(T.height(e.x, e.z), WATER_LEVEL - 0.5);
    obj.position.set(e.x, y, e.z);
    obj.rotation.y = e.ry;

    // ---- 자세 계산 ----
    const m = clamp(e.sp / 3.5, 0, 1);                      // 걷는 정도
    e.walk += dt * (2.4 + e.sp * 1.0);
    const w = e.walk, sw = Math.sin(w), cw = Math.cos(w), breath = Math.sin(e.t * 1.8);
    let hipR = 0.5 * sw * m, hipL = -0.5 * sw * m;                                   // 엉덩이 각 (양수 = 뒤로)
    let kneeR = 0.06 + m * 0.9 * Math.max(0, -cw), kneeL = 0.06 + m * 0.9 * Math.max(0, cw);   // 다리를 앞으로 내딛는 동안 무릎 접힘
    let armLth = -0.15 + 0.35 * sw * m + 0.025 * breath, armLel = -0.35 - 0.2 * m;   // 왼팔은 반대 다리와 엇갈려 흔들림
    let th = REST.th - 0.08 * sw * m + 0.02 * breath, el = REST.el, al = REST.al;     // 도끼 든 오른팔
    let torsoX = 0.03 * breath * (1 - m) + 0.06 * m, torsoY = 0, headX = 0, bodyY = 0.05 * Math.abs(sw) * m + 0.014 * breath * (1 - m), bodyZ = 0;

    if (e.dying) {
      e.dd += dt;
      const f = clamp(e.dd / BOSS.DEATH_FALL, 0, 1), ff = f * f * (3 - 2 * f);
      obj.rotation.x = -(Math.PI / 2) * 0.96 * ff;           // 뒤로 쓰러짐
      obj.position.y = y + 0.28 * BOSS.SCALE * ff;
      hipR = hipL = 0; kneeR = kneeL = 0.1 + 0.3 * ff; armLth = -0.3; armLel = -0.4; th = -0.7; el = -0.3; al = 1.6;
      torsoX = 0; bodyY = 0;
    } else {
      obj.rotation.x = 0;
      if (e.atkT >= 0) {
        e.atkT += dt;
        const t = e.atkT, sk = e.atkKind === 'skill';
        const WND = sk ? BOSS.SKILL.TELEGRAPH - ATK_SLAM : ATK_WIND, END = sk ? BOSS.SKILL.TELEGRAPH + BOSS.SKILL.RECOVER : ATK_END;   // 내려찍기: 빨간 네모 1초 뒤에 땅에 닿도록 맞춤
        if (t >= END) e.atkT = -1;
        else if (t < WND) {                              // 도끼를 머리 위로 (천천히, 피할 틈) — 몸을 뒤로 비틀며
          const a = sm(t / WND);
          th = lerp(th, WIND.th, a); el = lerp(el, WIND.el, a); al = lerp(al, WIND.al, a);
          armLth = lerp(armLth, -1.0, a); armLel = lerp(armLel, -0.8, a);
          torsoX = lerp(torsoX, sk ? -0.35 : -0.22, a); torsoY = lerp(0, sk ? -0.2 : -0.4, a); headX = -0.15 * a; bodyY += (sk ? 0.45 : 0.1) * a; bodyZ = -0.12 * a;   // 내려찍기는 더 크게 뛰어올라 들어올림
          hipR = lerp(hipR, 0.3, a); hipL = lerp(hipL, -0.25, a); kneeR = lerp(kneeR, 0.4, a); kneeL = lerp(kneeL, 0.2, a);
        } else if (t < WND + ATK_SLAM) {                 // 내려찍기 (빠르게)
          const a = clamp((t - WND) / ATK_SLAM, 0, 1), s2 = a * a;
          th = lerp(WIND.th, SLAM.th, s2); el = lerp(WIND.el, SLAM.el, s2); al = lerp(WIND.al, SLAM.al, s2);
          armLth = lerp(-1.0, -0.5, s2); armLel = -0.5;
          torsoX = lerp(sk ? -0.35 : -0.22, sk ? 0.65 : 0.5, s2); torsoY = lerp(sk ? -0.2 : -0.4, 0.35, s2); headX = lerp(-0.15, 0.3, s2); bodyY += lerp(sk ? 0.45 : 0.1, sk ? -0.2 : -0.1, s2); bodyZ = lerp(-0.12, sk ? 0.4 : 0.3, s2);
          hipR = 0.3; hipL = -0.25; kneeR = lerp(0.4, 0.7, s2); kneeL = lerp(0.2, 0.5, s2);
        } else {                                              // 천천히 자세 회복
          const a = sm((t - WND - ATK_SLAM) / (END - WND - ATK_SLAM));
          th = lerp(SLAM.th, th, a); el = lerp(SLAM.el, el, a); al = lerp(SLAM.al, al, a);
          armLth = lerp(-0.5, armLth, a); armLel = lerp(-0.5, armLel, a);
          torsoX = lerp(sk ? 0.65 : 0.5, torsoX, a); torsoY = lerp(0.35, 0, a); headX = lerp(0.3, 0, a); bodyY += lerp(sk ? -0.2 : -0.1, 0, a); bodyZ = lerp(sk ? 0.4 : 0.3, 0, a);
          hipR = lerp(0.3, hipR, a); hipL = lerp(-0.25, hipL, a); kneeR = lerp(0.7, kneeR, a); kneeL = lerp(0.5, kneeL, a);
        }
      }
    }

    // ---- 뼈대에 적용 ----
    u.body.position.set(0, bodyY, bodyZ);
    u.torso.rotation.x = torsoX; u.torso.rotation.y = torsoY;
    u.torso.scale.set(1 + 0.012 * breath, 1 + 0.018 * breath, 1 + 0.012 * breath);        // 숨 쉴 때 가슴이 부풀어 오름
    u.head.rotation.x = headX + 0.03 * breath;
    u.legs[0].rotation.x = hipR; u.legs[1].rotation.x = hipL;                                // 양수 = 다리가 뒤로
    u.knees[0].rotation.x = kneeR; u.knees[1].rotation.x = kneeL;
    u.arms[0].rotation.x = th; u.arms[0].rotation.z = -0.12; u.elbows[0].rotation.x = el;
    u.axe.rotation.x = al - th - el;                                                          // 자루의 세계 기울기 = 어깨 + 팔꿈치 + 도끼 각
    u.arms[1].rotation.x = armLth; u.arms[1].rotation.z = 0.12; u.elbows[1].rotation.x = armLel;
    u.pony.rotation.x = 0.12 * Math.sin(e.t * 2.4) + 0.4 * m + (e.atkT >= 0 ? -0.3 : 0);     // 말총머리가 흔들림

    // 맞았을 때 잠깐 붉게
    if (e.flash > 0) { e.flash -= dt; setFlash(e.flash > 0); }
  }

  return { onSnapshot, update };
}
