// 고블린 (화면에 그리는 부분): 저폴리 모델 + 애니메이션 + 서버 상태 따라가기
//
// - 모델은 전부 코드로 만들어요 (이미지·glTF 파일 없음). 몸 부위(뼈대)마다 지오메트리를 하나로 합쳐서
//   고블린 한 마리가 메시 14개 정도예요. 지오메트리·재질은 모든 고블린이 같이 써요.
// - 위치·추적·공격·체력은 서버(server.js + goblin-ai.mjs)가 정하고, 여기서는 서버가 보낸 목록을 부드럽게 따라가며 그려요.
// - 크기·체력 같은 설정값은 goblin-ai.mjs 맨 위 GOBLIN 에 있어요.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GOBLIN } from './goblin-ai.mjs';

// ================= 해시 / 난수 (같은 입력이면 항상 같은 값) =================
function h32(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const TAU = Math.PI * 2;

// ================= 모델 =================
const COL = {
  skin: 0x8ba43a, skinDark: 0x738c30, skinLight: 0xa0b84a,
  leather: 0x6a4429, leatherDark: 0x4a301e, leatherLight: 0x84593a,
  metal: 0x8d887b, eye: 0xe3b93a, pupil: 0x16100a,
  nose: 0xc28a3a, earIn: 0xb57a32, tooth: 0xeee5c6, mouth: 0x2b1511, claw: 0xd9d0aa,
};

const V3 = THREE.Vector3, Q = THREE.Quaternion, M4 = THREE.Matrix4, EU = THREE.Euler;

function place(geo, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  geo.applyMatrix4(new M4().compose(new V3(...p), new Q().setFromEuler(new EU(...r)), new V3(...s)));
  return geo;
}
const blob = (p, s, detail = 0, r) => place(new THREE.IcosahedronGeometry(1, detail), p, r, s);
const box = (p, s, r) => place(new THREE.BoxGeometry(s[0], s[1], s[2]), p, r);

// a -> b 를 잇는 원기둥 (a쪽 반지름 r0, b쪽 반지름 r1)
function limb(a, b, r0, r1, sides = 6) {
  const A = new V3(...a), B = new V3(...b);
  const geo = new THREE.CylinderGeometry(r1, r0, A.distanceTo(B), sides, 1);
  const q = new Q().setFromUnitVectors(new V3(0, 1, 0), B.clone().sub(A).normalize());
  geo.applyMatrix4(new M4().compose(A.clone().add(B).multiplyScalar(0.5), q, new V3(1, 1, 1)));
  return geo;
}
// base 에서 dir 방향으로 뻗는 뿔 (발톱·이빨·코·천 조각 끝)
function spike(base, dir, len, r, sides = 5) {
  const d = new V3(...dir).normalize();
  const geo = new THREE.ConeGeometry(r, len, sides);
  const q = new Q().setFromUnitVectors(new V3(0, 1, 0), d);
  geo.applyMatrix4(new M4().compose(new V3(...base).addScaledVector(d, len / 2), q, new V3(1, 1, 1)));
  return geo;
}
// 납작한 뾰족 귀
function blade(base, dir, len, w, thin) {
  const d = new V3(...dir).normalize();
  const geo = new THREE.ConeGeometry(w, len, 4);
  geo.scale(1, 1, thin);
  const q = new Q().setFromUnitVectors(new V3(0, 1, 0), d);
  geo.applyMatrix4(new M4().compose(new V3(...base).addScaledVector(d, len / 2), q, new V3(1, 1, 1)));
  return geo;
}

class BoneDef {
  constructor(name, parent, pivot) {
    this.name = name; this.parent = parent; this.pivot = pivot; this.parts = []; this.geo = null;
  }
  add(geo, color, jit = 0.007) { this.parts.push({ geo, color, jit }); return this; }
  bake() {
    const list = [];
    this.parts.forEach(({ geo, color, jit }, idx) => {
      const g = geo.index ? geo.toNonIndexed() : geo;
      if (jit > 0) {
        const p = g.attributes.position;
        const q = (n) => Math.round(n * 1000);
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          const kx = q(x), ky = q(y), kz = q(z);
          p.setXYZ(i, x + (h32(kx, ky, kz) - 0.5) * 2 * jit, y + (h32(ky, kz, kx + 7) - 0.5) * 2 * jit, z + (h32(kz, kx, ky + 13) - 0.5) * 2 * jit);
        }
      }
      g.translate(-this.pivot[0], -this.pivot[1], -this.pivot[2]);
      g.computeVertexNormals();
      const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      g.deleteAttribute('uv');
      list.push(g);
    });
    this.geo = mergeGeometries(list, false);
    return this;
  }
}

let TEMPLATE = null;
let MAT = null;
let MAT_HIT = null;   // 맞았을 때 잠깐 붉게

// 모든 좌표는 "발바닥 중앙이 (0,0,0), 앞쪽이 +z, 위쪽이 +y" 인 몸 기준이에요. 키는 약 1.2m.
function template() {
  if (TEMPLATE) return TEMPLATE;
  const defs = [];
  const bone = (name, parent, pivot) => { const b = new BoneDef(name, parent, pivot); defs.push(b); return b; };

  const HIP = [0, 0.5, 0];
  const torso = bone('torso', null, HIP);
  const head = bone('head', 'torso', [0, 0.86, 0.1]);

  // ---------- 몸통 ----------
  torso
    .add(blob([0, 0.5, 0.02], [0.135, 0.085, 0.105], 1), COL.skin)           // 골반
    .add(blob([0, 0.59, 0.035], [0.125, 0.11, 0.1], 1), COL.skin)            // 배
    .add(blob([0, 0.76, 0.075], [0.175, 0.19, 0.13], 1), COL.skin)           // 가슴
    .add(limb([0, 0.82, 0.08], [0, 0.89, 0.1], 0.055, 0.045, 6), COL.skin)   // 목
    // 허리띠 + 버클
    .add(place(new THREE.CylinderGeometry(0.152, 0.152, 0.07, 8), [0, 0.53, 0.03], [0, 0, 0], [1, 1, 0.82]), COL.leatherDark, 0.004)
    .add(box([0, 0.53, 0.128], [0.085, 0.07, 0.02]), COL.metal, 0.002)
    .add(box([0, 0.53, 0.14], [0.042, 0.032, 0.02]), COL.leatherDark, 0)
    // 가죽 조끼: 어깨 덮개·앞판·뒤판 + 목 둘레
    .add(place(new THREE.CylinderGeometry(0.115, 0.19, 0.09, 7, 1, true), [0, 0.86, 0.085]), COL.leatherLight, 0.01)
    .add(box([0, 0.72, -0.075], [0.21, 0.27, 0.03], [-0.08, 0, 0]), COL.leather, 0.006);
  for (const sx of [-1, 1]) {
    torso
      .add(box([sx * 0.145, 0.865, 0.07], [0.16, 0.045, 0.15], [0, 0, sx * -0.38]), COL.leatherLight, 0.006)
      .add(box([sx * 0.105, 0.72, 0.17], [0.085, 0.23, 0.025], [0.18, 0, sx * 0.12]), COL.leather, 0.006)
      .add(spike([sx * 0.125, 0.61, 0.185], [sx * 0.1, -1, 0.1], 0.1, 0.03, 4), COL.leather, 0.004)
      .add(spike([sx * 0.085, 0.61, 0.19], [0, -1, 0.15], 0.075, 0.025, 4), COL.leather, 0.004)
      // 허리 옆 천 조각
      .add(box([sx * 0.14, 0.43, 0.07], [0.1, 0.15, 0.02], [0, sx * 0.95, sx * 0.2]), COL.leather, 0.006)
      .add(spike([sx * 0.15, 0.36, 0.07], [sx * 0.2, -1, 0], 0.07, 0.03, 4), COL.leather, 0.004);
  }
  torso
    // 앞 가리개 (끝이 뾰족하게 찢어진 천)
    .add(box([0, 0.405, 0.135], [0.16, 0.2, 0.02], [-0.12, 0, 0]), COL.leather, 0.006)
    .add(spike([-0.055, 0.31, 0.142], [0, -1, 0.1], 0.1, 0.035, 4), COL.leather, 0.004)
    .add(spike([0, 0.31, 0.142], [0, -1, 0.12], 0.16, 0.045, 4), COL.leather, 0.004)
    .add(spike([0.055, 0.31, 0.142], [0, -1, 0.1], 0.09, 0.035, 4), COL.leather, 0.004)
    // 뒤 가리개
    .add(box([0, 0.42, -0.085], [0.15, 0.17, 0.02], [0.1, 0, 0]), COL.leather, 0.006)
    .add(spike([0, 0.335, -0.09], [0, -1, -0.1], 0.1, 0.04, 4), COL.leather, 0.004);

  // ---------- 머리 ----------
  const HC = [0, 1.03, 0.17];   // 머리 중심
  const hp = (dx, dy, dz) => [HC[0] + dx, HC[1] + dy, HC[2] + dz];
  head
    .add(blob(hp(0, 0.06, -0.005), [0.158, 0.172, 0.158], 1), COL.skin, 0.01)       // 이마 넓은 머리통
    .add(blob(hp(0, -0.07, 0.05), [0.12, 0.105, 0.115], 1), COL.skin, 0.008)         // 아래 얼굴
    .add(blob(hp(0, -0.135, 0.085), [0.07, 0.05, 0.065], 0), COL.skinDark, 0.006)    // 턱
    .add(blob(hp(0, -0.04, -0.09), [0.1, 0.1, 0.08], 0), COL.skinDark, 0.006)        // 뒤통수 아래
    .add(blob(hp(0, 0.02, 0.15), [0.034, 0.03, 0.03], 0), COL.skinLight, 0.004)      // 콧대
    .add(box(hp(0, -0.098, 0.148), [0.115, 0.024, 0.03]), COL.mouth, 0)               // 입
    .add(spike(hp(0, 0.0, 0.168), [0, -0.38, 1], 0.115, 0.042, 4), COL.nose, 0.003);  // 큰 코
  for (const sx of [-1, 1]) {
    head
      .add(blob(hp(sx * 0.092, -0.035, 0.1), [0.045, 0.034, 0.045], 0), COL.skinLight, 0.004)   // 광대
      .add(box(hp(sx * 0.063, 0.062, 0.128), [0.125, 0.04, 0.06], [0, 0, sx * 0.4]), COL.skinDark, 0.004) // 찡그린 눈썹
      .add(blob(hp(sx * 0.065, 0.022, 0.135), [0.03, 0.024, 0.02], 0), COL.eye, 0)       // 노란 눈
      .add(blob(hp(sx * 0.065, 0.02, 0.152), [0.011, 0.016, 0.008], 0), COL.pupil, 0)    // 눈동자
      // 귀 (바깥 + 안쪽)
      .add(blade(hp(sx * 0.13, 0.07, -0.01), [sx * 0.92, 0.3, -0.25], 0.36, 0.095, 0.3), COL.skin, 0.004)
      .add(blade(hp(sx * 0.135, 0.065, 0.004), [sx * 0.92, 0.3, -0.25], 0.27, 0.055, 0.3), COL.earIn, 0.003)
      // 송곳니 (아래턱에서 위로 / 윗니는 아래로)
      .add(spike(hp(sx * 0.045, -0.105, 0.15), [sx * 0.05, 1, 0.25], 0.055, 0.013, 4), COL.tooth, 0)
      .add(spike(hp(sx * 0.02, -0.105, 0.155), [0, 1, 0.2], 0.03, 0.009, 4), COL.tooth, 0)
      .add(spike(hp(sx * 0.03, -0.085, 0.157), [0, -1, 0.15], 0.04, 0.009, 4), COL.tooth, 0);
  }

  // ---------- 팔 ----------
  for (const sx of [-1, 1]) {
    const nm = sx > 0 ? 'L' : 'R';
    const S = [sx * 0.2, 0.8, 0.07], E = [sx * 0.34, 0.6, 0.04], W = [sx * 0.36, 0.42, 0.17];
    const arm = bone('arm' + nm, 'torso', S);
    arm.add(blob(S, [0.062, 0.062, 0.062], 0), COL.skinDark, 0.005)
       .add(limb(S, E, 0.052, 0.042, 6), COL.skin, 0.006);
    const fore = bone('fore' + nm, 'arm' + nm, E);
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    fore.add(blob(E, [0.045, 0.045, 0.045], 0), COL.skin, 0.005)
        .add(limb(E, W, 0.042, 0.035, 6), COL.skin, 0.006)
        // 팔찌 (두껍고 주름진 가죽)
        .add(limb(lerp(E, W, 0.3), lerp(E, W, 0.62), 0.064, 0.066, 7), COL.leather, 0.004)
        .add(limb(lerp(E, W, 0.6), lerp(E, W, 0.82), 0.068, 0.062, 7), COL.leatherLight, 0.004)
        .add(limb(lerp(E, W, 0.8), lerp(E, W, 0.98), 0.062, 0.055, 7), COL.leatherDark, 0.004)
        // 손 + 발톱
        .add(blob([W[0], W[1] - 0.05, W[2] + 0.035], [0.042, 0.055, 0.04], 0), COL.skin, 0.004);
    for (const fx of [-0.026, 0, 0.026]) {
      fore.add(spike([W[0] + fx, W[1] - 0.085, W[2] + 0.055], [fx * 2, -0.75, 0.75], 0.075, 0.013, 4), COL.claw, 0.001);
    }
    fore.add(spike([W[0] - sx * 0.035, W[1] - 0.05, W[2] + 0.03], [-sx * 0.8, -0.35, 0.7], 0.06, 0.012, 4), COL.claw, 0.001);
  }

  // ---------- 다리 ----------
  for (const sx of [-1, 1]) {
    const nm = sx > 0 ? 'L' : 'R';
    const HP = [sx * 0.12, 0.5, 0], K = [sx * 0.2, 0.28, 0.14], A = [sx * 0.22, 0.12, 0.08];
    const leg = bone('leg' + nm, null, HP);
    leg.add(blob(HP, [0.07, 0.07, 0.07], 0), COL.skinDark, 0.005)
       .add(limb(HP, K, 0.07, 0.052, 6), COL.skin, 0.006);
    const shin = bone('shin' + nm, 'leg' + nm, K);
    shin.add(blob(K, [0.055, 0.055, 0.055], 0), COL.skin, 0.005)
        .add(limb(K, A, 0.05, 0.04, 6), COL.skin, 0.006)
        // 장화: 접힌 윗단 + 몸통 + 코 + 밑창
        .add(limb([sx * 0.214, 0.255, 0.1], [sx * 0.218, 0.2, 0.095], 0.088, 0.082, 7), COL.leatherLight, 0.005)
        .add(limb([sx * 0.218, 0.2, 0.095], [sx * 0.222, 0.05, 0.09], 0.074, 0.07, 7), COL.leather, 0.005)
        .add(box([sx * 0.226, 0.048, 0.168], [0.125, 0.078, 0.2], [-0.04, sx * -0.08, 0]), COL.leatherDark, 0.005)
        .add(box([sx * 0.226, 0.012, 0.17], [0.135, 0.024, 0.255], [0, sx * -0.08, 0]), COL.leatherDark, 0.003);
  }

  defs.forEach((d) => d.bake());
  TEMPLATE = defs;
  MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  MAT_HIT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, emissive: 0xff2a14, emissiveIntensity: 0.9 });
  return TEMPLATE;
}

// 고블린 한 마리 만들기 (원점 = 발바닥, 앞쪽 = +z)
export function buildGoblin() {
  const defs = template();
  const root = new THREE.Group();
  const bones = {}, meshes = [];
  for (const d of defs) {
    const g = new THREE.Group();
    const par = d.parent ? defs.find((x) => x.name === d.parent) : null;
    const pp = par ? par.pivot : [0, 0, 0];
    g.position.set(d.pivot[0] - pp[0], d.pivot[1] - pp[1], d.pivot[2] - pp[2]);
    const m = new THREE.Mesh(d.geo, MAT);
    meshes.push(m);
    g.add(m);
    (d.parent ? bones[d.parent] : root).add(g);
    bones[d.name] = g;
  }
  root.userData.rig = { b: bones, meshes, ph: 0, w: 0, t: 0, seed: Math.random() * 100, torsoY: bones.torso.position.y, sw: -1, flash: 0, hit: false };
  return root;
}

// 걷기·대기 애니메이션 (speed: 지금 걷는 속도 m/s)
export function animateGoblin(g, dt, speed) {
  const r = g.userData.rig, b = r.b;
  r.t += dt;
  const target = Math.min(1, speed / 0.6);
  r.w += (target - r.w) * (1 - Math.exp(-9 * dt));
  const w = r.w;
  r.ph += dt * speed * 5.2;
  const ph = r.ph, s = Math.sin(ph), c = Math.cos(ph);
  const swing = s * 0.6 * w;

  b.legL.rotation.x = swing;
  b.legR.rotation.x = -swing;
  b.shinL.rotation.x = Math.max(0, -c) * 0.9 * w;
  b.shinR.rotation.x = Math.max(0, c) * 0.9 * w;

  const idle = 1 - w;
  b.armL.rotation.x = -swing * 0.8 + Math.sin(r.t * 1.7 + r.seed) * 0.05 * idle;
  b.armR.rotation.x = swing * 0.8 + Math.sin(r.t * 1.5 + r.seed * 2) * 0.05 * idle;
  b.foreL.rotation.x = -(0.12 + 0.25 * w * (0.5 + 0.5 * Math.sin(ph + 1.2)));
  b.foreR.rotation.x = -(0.12 + 0.25 * w * (0.5 - 0.5 * Math.sin(ph + 1.2)));

  b.torso.position.y = r.torsoY + Math.abs(s) * 0.03 * w;
  b.torso.rotation.z = s * 0.06 * w;
  b.torso.rotation.y = c * 0.1 * w;
  b.torso.scale.y = 1 + Math.sin(r.t * 2.3 + r.seed) * 0.012;   // 숨쉬기

  b.head.rotation.y = Math.sin(r.t * 0.8 + r.seed) * 0.5 * idle - c * 0.05 * w;   // 대기 중 두리번
  b.head.rotation.x = Math.sin(r.t * 0.55 + r.seed * 2) * 0.1 * idle;

  // 공격 모션: 오른팔을 들었다가 내려치기
  if (r.sw >= 0) {
    r.sw += dt;
    const u = r.sw / 0.4;
    if (u >= 1) r.sw = -1;
    else {
      const sm = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
      const a = u < 0.4 ? -2.1 * sm(u / 0.4) : u < 0.65 ? -2.1 + 2.9 * sm((u - 0.4) / 0.25) : 0.8 * (1 - sm((u - 0.65) / 0.35));
      b.armR.rotation.x = a;
      b.foreR.rotation.x = -0.5;
      b.armL.rotation.x = a * 0.4;
      b.torso.rotation.x = 0.35 * Math.sin(Math.PI * u);
    }
  } else b.torso.rotation.x = 0;

  // 맞았을 때 잠깐 붉게
  if (r.flash > 0) {
    r.flash -= dt;
    if (!r.hit) { r.hit = true; for (const m of r.meshes) m.material = MAT_HIT; }
    if (r.flash <= 0) { r.hit = false; for (const m of r.meshes) m.material = MAT; }
  }
}

// ================= 서버가 보낸 고블린을 화면에 그리기 =================
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

export function createGoblinWorld({ scene, camera, T, WATER_LEVEL }) {
  const map = new Map();   // 고블린 id -> { obj, bar, x, z, ry, tx, tz, tr, hp, atkN, sp }
  const barGeo = new THREE.PlaneGeometry(1, 1);
  const barBgMat = new THREE.MeshBasicMaterial({ color: 0x1a0d0d, transparent: true, opacity: 0.85, depthTest: false, fog: false });
  const barFgMat = new THREE.MeshBasicMaterial({ color: 0xd8382a, depthTest: false, fog: false });
  const BAR_W = 0.8, BAR_H = 0.09;

  function makeBar() {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(barGeo, barBgMat); bg.scale.set(BAR_W + 0.04, BAR_H + 0.04, 1); bg.renderOrder = 998;
    const fg = new THREE.Mesh(barGeo, barFgMat); fg.scale.set(BAR_W, BAR_H, 1); fg.position.z = 0.001; fg.renderOrder = 999;
    g.add(bg, fg);
    g.userData.fg = fg;
    g.visible = false;
    return g;
  }

  // 서버가 보낸 목록: [id, x, z, 바라보는 방향, mode, hp, 공격횟수]
  function onSnapshot(list) {
    const seen = new Set();
    for (const [id, x, z, ry, mode, hp, atkN] of list) {
      seen.add(id);
      let e = map.get(id);
      if (!e) {
        const obj = buildGoblin();
        obj.scale.setScalar(GOBLIN.SCALE);
        const bar = makeBar();
        scene.add(obj, bar);
        e = { obj, bar, x, z, ry, tx: x, tz: z, tr: ry, hp, atkN, sp: 0 };
        map.set(id, e);
      }
      e.tx = x; e.tz = z; e.tr = ry;
      if (hp < e.hp) { e.obj.userData.rig.flash = 0.15; }   // 맞음
      if (atkN !== e.atkN) { e.obj.userData.rig.sw = 0; e.atkN = atkN; }   // 공격 모션 시작
      e.hp = hp;
    }
    for (const [id, e] of map) {
      if (seen.has(id)) continue;
      scene.remove(e.obj, e.bar);   // 죽었거나 멀어짐 (지오메트리·재질은 공유라 지우지 않음)
      map.delete(id);
    }
  }

  function update(dt) {
    const k = 1 - Math.exp(-12 * dt), kr = 1 - Math.exp(-10 * dt), ks = 1 - Math.exp(-10 * dt);
    for (const e of map.values()) {
      const ox = e.x, oz = e.z;
      if (Math.hypot(e.tx - e.x, e.tz - e.z) > 6) { e.x = e.tx; e.z = e.tz; }   // 순간이동(복귀)은 바로 이동
      else { e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; }
      e.ry += angDiff(e.ry, e.tr) * kr;
      const sp = dt > 0 ? Math.hypot(e.x - ox, e.z - oz) / dt : 0;
      e.sp += (Math.min(sp, 14) - e.sp) * ks;

      const y = Math.max(T.height(e.x, e.z), WATER_LEVEL - 0.8);
      e.obj.position.set(e.x, y, e.z);
      e.obj.rotation.y = e.ry;
      animateGoblin(e.obj, dt, e.sp);

      // 체력바: 맞아서 체력이 줄었을 때만 머리 위에 표시 (카메라를 향함)
      const show = e.hp < GOBLIN.HP;
      e.bar.visible = show;
      if (show) {
        const ratio = Math.max(0, e.hp / GOBLIN.HP);
        e.bar.position.set(e.x, y + 1.2 * GOBLIN.SCALE + 0.3, e.z);
        e.bar.quaternion.copy(camera.quaternion);
        const fg = e.bar.userData.fg;
        fg.scale.x = BAR_W * ratio;
        fg.position.x = -BAR_W / 2 + (BAR_W * ratio) / 2;
      }
    }
  }

  return { onSnapshot, update };
}
