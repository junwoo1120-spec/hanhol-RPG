// 토끼 (화면에 그리는 부분): 저폴리 모델 + 6가지 모션(대기·걷기·달리기·점프·공격·피격) + 서버 상태 따라가기
//
// - 모델은 전부 코드로 만들어요 (이미지·glTF 파일 없음). 몸 부위(뼈대)마다 지오메트리를 하나로 합쳐서
//   토끼 한 마리가 메시 10개 정도예요 (약 2,000 폴리곤). 지오메트리·재질은 모든 토끼가 같이 써요.
// - 위치·추적·공격·체력은 서버(server.js + rabbit-ai.mjs)가 정하고, 여기서는 서버가 보낸 목록을 부드럽게 따라가며 그려요.
// - 크기·체력 같은 설정값은 rabbit-ai.mjs 맨 위 RABBIT 에 있어요.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RABBIT } from './rabbit-ai.mjs';

// ================= 해시 / 난수 (같은 입력이면 항상 같은 값) =================
function h32(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const TAU = Math.PI * 2;
const sm01 = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// ================= 모델 =================
const COL = {
  fur: 0xdad7e8, furLight: 0xf0edf8, furDark: 0xb3afc6, furShade: 0x9e9ab4,
  earIn: 0xcfaec3, nose: 0xd99aa8, eye: 0x07070c, glint: 0xffffff, tooth: 0xf6f1e2, claw: 0x8f8ba3,
};

const V3 = THREE.Vector3, Q = THREE.Quaternion, M4 = THREE.Matrix4, EU = THREE.Euler;

function place(geo, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  geo.applyMatrix4(new M4().compose(new V3(...p), new Q().setFromEuler(new EU(...r)), new V3(...s)));
  return geo;
}
const blob = (p, s, detail = 1, r) => place(new THREE.IcosahedronGeometry(1, detail), p, r, s);
const box = (p, s, r) => place(new THREE.BoxGeometry(s[0], s[1], s[2]), p, r);

// a -> b 를 잇는 원기둥
function limb(a, b, r0, r1, sides = 6) {
  const A = new V3(...a), B = new V3(...b);
  const geo = new THREE.CylinderGeometry(r1, r0, A.distanceTo(B), sides, 1);
  const q = new Q().setFromUnitVectors(new V3(0, 1, 0), B.clone().sub(A).normalize());
  geo.applyMatrix4(new M4().compose(A.clone().add(B).multiplyScalar(0.5), q, new V3(1, 1, 1)));
  return geo;
}
// base 에서 dir 방향으로 뻗는 뿔 (털 뭉치·발톱)
function spike(base, dir, len, r, sides = 4) {
  const d = new V3(...dir).normalize();
  const geo = new THREE.ConeGeometry(r, len, sides);
  const q = new Q().setFromUnitVectors(new V3(0, 1, 0), d);
  geo.applyMatrix4(new M4().compose(new V3(...base).addScaledVector(d, len / 2), q, new V3(1, 1, 1)));
  return geo;
}
// 납작한 뾰족 귀 (넓은 면이 앞을 봄)
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
  add(geo, color, jit = 0.002) { this.parts.push({ geo, color, jit }); return this; }
  bake() {
    const list = [];
    this.parts.forEach(({ geo, color, jit }) => {
      const g = geo.index ? geo.toNonIndexed() : geo;
      if (jit > 0) {
        const p = g.attributes.position;
        const q = (n) => Math.round(n * 4000);
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
let LOD_GEO = null;   // 멀리 있을 때 쓰는 통짜 모델 (메시 1개)

// 모든 좌표는 "발바닥 중앙이 (0,0,0), 앞쪽이 +z, 위쪽이 +y" 인 몸 기준이에요. 귀 끝까지 높이 약 0.4m.
function template() {
  if (TEMPLATE) return TEMPLATE;
  const defs = [];
  const bone = (name, parent, pivot) => { const b = new BoneDef(name, parent, pivot); defs.push(b); return b; };

  const body = bone('body', null, [0, 0.16, 0]);
  const head = bone('head', 'body', [0, 0.2, 0.15]);
  const tail = bone('tail', 'body', [0, 0.2, -0.22]);

  // ---------- 몸통: 웅크린 자세, 뒤가 큰 둥근 몸 ----------
  body
    .add(blob([0, 0.16, -0.01], [0.105, 0.098, 0.175], 1), COL.fur, 0.003)         // 몸통
    .add(blob([0, 0.155, 0.1], [0.088, 0.09, 0.1], 1), COL.furLight, 0.003)        // 가슴 (밝은 털)
    .add(blob([0, 0.17, -0.12], [0.112, 0.11, 0.105], 1), COL.fur, 0.003)          // 엉덩이
    .add(blob([0, 0.1, 0.0], [0.09, 0.05, 0.15], 0), COL.furLight, 0.002)          // 배
    // 가슴 털 뭉치 (뾰족뾰족)
    .add(spike([0, 0.14, 0.17], [0, -0.7, 1], 0.06, 0.028), COL.furLight, 0.001)
    .add(spike([-0.04, 0.12, 0.165], [-0.4, -1, 0.7], 0.055, 0.024), COL.furLight, 0.001)
    .add(spike([0.04, 0.12, 0.165], [0.4, -1, 0.7], 0.055, 0.024), COL.furLight, 0.001)
    // 등 털 (뒤로 누운 뾰족 털)
    .add(spike([0, 0.255, 0.08], [0, 0.6, -1], 0.07, 0.028), COL.furDark, 0.001)
    .add(spike([0, 0.268, -0.02], [0, 0.6, -1], 0.07, 0.03), COL.furDark, 0.001)
    .add(spike([0, 0.275, -0.12], [0, 0.5, -1], 0.065, 0.028), COL.furDark, 0.001);
  for (const sx of [-1, 1]) {
    body
      .add(spike([sx * 0.095, 0.2, 0.0], [sx * 1, 0.1, -0.7], 0.06, 0.024), COL.furDark, 0.001)   // 옆구리 털
      .add(spike([sx * 0.1, 0.16, -0.08], [sx * 1, 0, -0.8], 0.06, 0.024), COL.furDark, 0.001);
  }

  // ---------- 머리 ----------
  head
    .add(blob([0, 0.25, 0.22], [0.077, 0.07, 0.085], 1), COL.fur, 0.003)            // 머리통
    .add(blob([0, 0.232, 0.288], [0.04, 0.036, 0.042], 0), COL.furLight, 0.002)     // 주둥이
    .add(blob([0, 0.243, 0.328], [0.013, 0.011, 0.01], 0), COL.nose, 0)             // 코
    .add(box([-0.008, 0.211, 0.316], [0.011, 0.02, 0.006]), COL.tooth, 0)           // 앞니
    .add(box([0.008, 0.211, 0.316], [0.011, 0.02, 0.006]), COL.tooth, 0)
    .add(blob([0, 0.208, 0.29], [0.03, 0.016, 0.03], 0), COL.furShade, 0.001)       // 턱 그늘
    // 이마 털 (뾰족하게 솟음)
    .add(spike([0, 0.315, 0.2], [0, 1, -0.2], 0.05, 0.022), COL.furLight, 0.001)
    .add(spike([-0.03, 0.305, 0.21], [-0.4, 1, -0.2], 0.04, 0.02), COL.furLight, 0.001)
    .add(spike([0.03, 0.305, 0.21], [0.4, 1, -0.2], 0.04, 0.02), COL.furLight, 0.001);
  for (const sx of [-1, 1]) {
    head
      .add(blob([sx * 0.052, 0.262, 0.272], [0.021, 0.026, 0.016], 0), COL.eye, 0)                    // 까만 눈
      .add(blob([sx * 0.056, 0.27, 0.283], [0.006, 0.007, 0.004], 0), COL.glint, 0)                   // 눈 반짝임
      .add(box([sx * 0.052, 0.292, 0.268], [0.05, 0.011, 0.02], [0, 0, sx * 0.38]), COL.furShade, 0.001)   // 화난 눈썹
      // 볼 털 (뒤쪽 바깥으로 뾰족)
      .add(spike([sx * 0.068, 0.236, 0.2], [sx * 1, -0.1, -0.55], 0.065, 0.026), COL.furLight, 0.001)
      .add(spike([sx * 0.062, 0.222, 0.215], [sx * 0.9, -0.5, -0.4], 0.055, 0.022), COL.furLight, 0.001)
      .add(spike([sx * 0.045, 0.211, 0.245], [sx * 0.8, -0.6, 0.1], 0.04, 0.018), COL.furLight, 0.001);
  }

  // ---------- 귀 (길고 뾰족. 뿌리에서 회전) ----------
  for (const sx of [-1, 1]) {
    const nm = sx > 0 ? 'L' : 'R';
    const E = [sx * 0.045, 0.3, 0.17];
    const ear = bone('ear' + nm, 'head', E);
    ear
      .add(blade(E, [sx * 0.18, 1, -0.3], 0.25, 0.04, 0.3), COL.fur, 0.002)
      .add(blade([E[0] + sx * 0.002, E[1] + 0.005, E[2] + 0.008], [sx * 0.18, 1, -0.3], 0.2, 0.024, 0.3), COL.earIn, 0.001);
  }

  // ---------- 앞다리 (짧고 작음) ----------
  for (const sx of [-1, 1]) {
    const nm = sx > 0 ? 'L' : 'R';
    const S = [sx * 0.058, 0.13, 0.1], P = [sx * 0.058, 0.026, 0.145];
    const fore = bone('fore' + nm, 'body', S);
    fore
      .add(limb(S, P, 0.03, 0.022, 6), COL.fur, 0.002)
      .add(blob([P[0], 0.017, P[2] + 0.018], [0.03, 0.018, 0.04], 0), COL.furLight, 0.001)    // 발
      .add(spike([P[0] - 0.012, 0.014, P[2] + 0.05], [0, -0.2, 1], 0.02, 0.006), COL.claw, 0)  // 발톱
      .add(spike([P[0] + 0.012, 0.014, P[2] + 0.05], [0, -0.2, 1], 0.02, 0.006), COL.claw, 0);
  }

  // ---------- 뒷다리 (크고 튼튼한 허벅지 + 긴 발) ----------
  for (const sx of [-1, 1]) {
    const nm = sx > 0 ? 'L' : 'R';
    const HIP = [sx * 0.1, 0.17, -0.1], ANK = [sx * 0.1, 0.05, -0.15];
    const hind = bone('hind' + nm, 'body', HIP);
    hind
      .add(blob([sx * 0.108, 0.165, -0.1], [0.068, 0.088, 0.105], 1), COL.fur, 0.003)         // 허벅지
      .add(blob([sx * 0.112, 0.19, -0.12], [0.05, 0.05, 0.06], 0), COL.furLight, 0.002);      // 허벅지 위 밝은 털
    const foot = bone('foot' + nm, 'hind' + nm, ANK);
    foot
      .add(limb([sx * 0.104, 0.12, -0.1], ANK, 0.04, 0.026, 6), COL.fur, 0.002)               // 종아리
      .add(blob([sx * 0.1, 0.028, -0.07], [0.032, 0.026, 0.115], 0), COL.furLight, 0.002)     // 긴 발바닥
      .add(spike([sx * 0.1, 0.026, 0.04], [0, -0.1, 1], 0.025, 0.012), COL.claw, 0);          // 발톱
  }

  // ---------- 꼬리 (폭신폭신한 뭉치) ----------
  tail
    .add(blob([0, 0.225, -0.255], [0.058, 0.06, 0.06], 1), COL.furLight, 0.003)
    .add(spike([0, 0.27, -0.26], [0, 1, -0.4], 0.05, 0.026), COL.furLight, 0.001)
    .add(spike([0, 0.235, -0.3], [0, 0.3, -1], 0.05, 0.026), COL.furLight, 0.001)
    .add(spike([-0.04, 0.25, -0.27], [-1, 0.5, -0.4], 0.045, 0.024), COL.furLight, 0.001)
    .add(spike([0.04, 0.25, -0.27], [1, 0.5, -0.4], 0.045, 0.024), COL.furLight, 0.001);

  defs.forEach((d) => d.bake());
  // 멀리 있는 토끼용: 모든 부위를 기본 자세로 합친 메시 1개
  LOD_GEO = mergeGeometries(defs.map((d) => d.geo.clone().translate(d.pivot[0], d.pivot[1], d.pivot[2])), false);
  TEMPLATE = defs;
  MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  MAT_HIT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, emissive: 0xff2a14, emissiveIntensity: 0.9 });
  return TEMPLATE;
}

// 토끼 한 마리 만들기 (원점 = 발바닥, 앞쪽 = +z)
export function buildRabbit() {
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
  const lod = new THREE.Mesh(LOD_GEO, MAT);
  lod.visible = false;
  root.add(lod);
  const seed = Math.random() * 100;
  root.userData.rig = {
    b: bones, meshes, lod, far: false,
    t: Math.random() * 20, ph: 0, w: 0, rb: 0, seed,
    bodyY0: bones.body.position.y,
    sw: -1,   // 공격 모션 진행 시간 (-1 = 안 하는 중)
    jt: -1,   // 점프 모션 진행 시간
    ht: -1,   // 피격 모션 진행 시간
    nextJump: 3 + Math.random() * 9,
    flash: 0, hit: false,
  };
  return root;
}

// 가까이는 자세히(부위별 메시, 애니메이션), 멀리는 통짜 메시 1개로 (렉 줄이기)
export function setRabbitFar(g, far) {
  const r = g.userData.rig;
  if (r.far === far) return;
  r.far = far;
  r.lod.visible = far;
  r.b.body.visible = !far;   // 다른 부위는 전부 body 의 자식이라 같이 숨겨져요
}

// ================= 모션 =================
// speed: 지금 이동 속도(m/s). 0 근처 = 대기, 걷기(깡충깡충) ~1~2, 달리기 3.5 이상
export function animateRabbit(g, dt, speed) {
  const r = g.userData.rig, b = r.b;
  r.t += dt;
  const t = r.t, seed = r.seed;

  r.w += (Math.min(1, speed / 0.5) - r.w) * (1 - Math.exp(-10 * dt));              // 움직이는 중인 정도
  r.rb += (sm01((speed - 2.6) / 1.6) - r.rb) * (1 - Math.exp(-8 * dt));            // 달리는 중인 정도
  const w = r.w, run = r.rb, idle = 1 - w;
  r.ph += dt * TAU * speed / (0.9 + 0.2 * Math.min(speed, 9));                     // 깡충 한 번 = 위상 2π (속도가 빠르면 한 번에 멀리)
  const s = Math.sin(r.ph), c = Math.cos(r.ph);
  const air = Math.max(0, s), gnd = Math.max(0, -s);

  // 귀 떨림 (가끔 쫑긋)
  const tw = (k) => Math.max(0, Math.sin(t * 0.43 + seed * k) - 0.9) * 10 * Math.sin(t * 28 + k) * 0.18;

  // ---- 기본 자세: 대기 + 걷기/달리기 (깡충깡충) ----
  const P = {
    bodyY: air * (0.05 + 0.1 * run) * w, bodyZ: 0,
    pitch: -c * (0.12 + 0.2 * run) * w * (s > 0 ? 1 : 0.35),
    sqY: 1 + Math.sin(t * 2.2 + seed) * 0.02 * idle - 0.08 * gnd * w + 0.05 * air * w, sqXZ: 1,
    headX: Math.sin(t * 0.9 + seed) * 0.06 * idle + Math.sin(t * 14) * 0.012 * idle * Math.max(0, Math.sin(t * 0.7 + seed)),   // 킁킁
    headY: Math.sin(t * 0.5 + seed * 2) * 0.4 * idle,
    earX: -(0.2 * w + 0.6 * run) + Math.sin(r.ph * 2) * 0.08 * w, spread: 0.1 * idle + 0.04,
    foreL: (-0.9 * air + 0.3 * gnd) * (0.5 + 0.5 * run) * w, foreR: 0,
    hindL: (0.95 * air - 0.5 * gnd) * w, hindR: 0,
    footL: (0.7 * air - 0.15 * gnd) * w, footR: 0,
    tailX: Math.sin(r.ph + 1) * 0.25 * w + Math.sin(t * 3 + seed) * 0.04 * idle,
    twL: tw(1.7), twR: tw(2.9),
  };
  P.headX -= P.pitch * 0.5;
  P.foreR = P.foreL; P.hindR = P.hindL; P.footR = P.footL;

  // ---- 가만히 있다가 가끔 폴짝 (점프 모션) ----
  if (r.jt < 0 && r.sw < 0 && idle > 0.9 && !r.far && t > r.nextJump) { r.jt = 0; r.nextJump = t + 6 + Math.random() * 10; }

  // ---- 점프: 웅크림 → 도약 → 착지 ----
  if (r.jt >= 0) {
    r.jt += dt;
    const u = r.jt / 0.62;
    if (u >= 1) r.jt = -1;
    else {
      const crouch = u < 0.2 ? sm01(u / 0.2) : u < 0.3 ? 1 - sm((u - 0.2) / 0.1) : 0;
      const au = (u - 0.25) / 0.55, a = au > 0 && au < 1 ? Math.sin(Math.PI * au) : 0;
      const land = u > 0.8 ? Math.sin(Math.PI * (u - 0.8) / 0.2) : 0;
      P.bodyY = 0.26 * a - 0.02 * crouch;
      P.pitch = crouch * 0.15 + (a > 0 ? -0.45 * Math.cos(Math.PI * au) : 0);
      P.sqY = 1 - 0.18 * crouch - 0.12 * land + 0.06 * a;
      P.foreL = P.foreR = -1.0 * a + 0.3 * crouch;
      P.hindL = P.hindR = 1.0 * a - 0.7 * crouch;
      P.footL = P.footR = 0.8 * a;
      P.earX = -0.7 * a - 0.2 * crouch;
      P.headX = -0.2 * a;
      P.headY = 0;
      P.tailX = -0.3 * a;
    }
  }
  function sm(x) { return sm01(x); }

  // ---- 공격: 뒷다리로 일어서서 앞발로 할퀴며 앞으로 덮침 ----
  if (r.sw >= 0) {
    r.sw += dt;
    const u = r.sw / 0.5;
    if (u >= 1) r.sw = -1;
    else {
      const rise = u < 0.3 ? sm01(u / 0.3) : u < 0.5 ? 1 : 1 - sm01((u - 0.5) / 0.5);
      const lung = u < 0.3 ? 0 : u < 0.55 ? sm01((u - 0.3) / 0.25) : 1 - sm01((u - 0.55) / 0.45);
      const hitL = sm01((u - 0.3) / 0.15) - sm01((u - 0.55) / 0.4);
      const hitR = sm01((u - 0.38) / 0.15) - sm01((u - 0.6) / 0.4);
      P.pitch = -0.75 * rise;
      P.bodyY = 0.06 * rise;
      P.bodyZ = 0.1 * lung;
      P.sqY = 1; P.sqXZ = 1;
      P.foreL = -1.5 * rise + 1.7 * hitL;
      P.foreR = -1.5 * rise + 1.7 * hitR;
      P.hindL = P.hindR = -0.3 * rise;
      P.footL = P.footR = 0;
      P.headX = 0.35 * lung - 0.2 * rise;
      P.headY = 0;
      P.earX = -0.5 * rise;
      P.tailX = -0.3 * rise;
    }
  }

  // ---- 피격: 움찔 (몸이 눌리고 뒤로 밀리며 귀가 뒤로 눕고 앞발을 당김) ----
  if (r.ht >= 0) {
    r.ht += dt;
    const u = r.ht / 0.35;
    if (u >= 1) r.ht = -1;
    else {
      const k = u < 0.25 ? u / 0.25 : 1 - sm01((u - 0.25) / 0.75);
      P.bodyZ -= 0.07 * k;
      P.pitch += -0.2 * k;
      P.sqY -= 0.18 * k;
      P.sqXZ += 0.08 * k;
      P.earX -= 0.9 * k;
      P.headX += 0.3 * k;
      P.foreL += 0.4 * k; P.foreR += 0.4 * k;
      P.hindL -= 0.3 * k; P.hindR -= 0.3 * k;
      P.tailX += 0.3 * k;
    }
  }

  // ---- 뼈대에 적용 ----
  b.body.position.y = r.bodyY0 + P.bodyY;
  b.body.position.z = P.bodyZ;
  b.body.rotation.x = P.pitch;
  b.body.scale.set(P.sqXZ, P.sqY, P.sqXZ);
  b.head.rotation.x = P.headX;
  b.head.rotation.y = P.headY;
  b.earL.rotation.x = P.earX + P.twL; b.earR.rotation.x = P.earX + P.twR;
  b.earL.rotation.z = -(P.spread + P.twL); b.earR.rotation.z = P.spread + P.twR;
  b.foreL.rotation.x = P.foreL; b.foreR.rotation.x = P.foreR;
  b.hindL.rotation.x = P.hindL; b.hindR.rotation.x = P.hindR;
  b.footL.rotation.x = P.footL; b.footR.rotation.x = P.footR;
  b.tail.rotation.x = P.tailX;

  // 맞았을 때 잠깐 붉게
  if (r.flash > 0) {
    r.flash -= dt;
    if (!r.hit) { r.hit = true; for (const m of r.meshes) m.material = MAT_HIT; }
    if (r.flash <= 0) { r.hit = false; for (const m of r.meshes) m.material = MAT; }
  }
}

// ================= 서버가 보낸 토끼를 화면에 그리기 =================
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

const LOD_NEAR = 35, LOD_FAR = 45;   // 이 거리(m)보다 멀면 단순 모델로 바꿈

export function createRabbitWorld({ scene, camera, T, WATER_LEVEL }) {
  const map = new Map();   // 토끼 id -> { obj, bar, x, z, ry, tx, tz, tr, hp, atkN, mode, sp, far }
  const barGeo = new THREE.PlaneGeometry(1, 1);
  const barBgMat = new THREE.MeshBasicMaterial({ color: 0x120404, transparent: true, opacity: 0.9, depthTest: false, fog: false });
  const barFgMat = new THREE.MeshBasicMaterial({ color: 0xff1111, depthTest: false, fog: false });
  const BAR_W = 0.6, BAR_H = 0.07;

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
        const obj = buildRabbit();
        obj.scale.setScalar(RABBIT.SCALE);
        const bar = makeBar();
        scene.add(obj, bar);
        e = { obj, bar, x, z, ry, tx: x, tz: z, tr: ry, hp, atkN, mode, sp: 0, far: false };
        map.set(id, e);
      }
      const rig = e.obj.userData.rig;
      e.tx = x; e.tz = z; e.tr = ry;
      if (hp < e.hp) { rig.flash = 0.18; rig.ht = 0; }                       // 맞음 → 붉게 + 움찔
      if (atkN !== e.atkN) { rig.sw = 0; e.atkN = atkN; }                    // 공격 모션 시작
      if (e.mode === 0 && mode !== 0 && rig.jt < 0 && rig.sw < 0) rig.jt = 0;   // 맞고 나서 덮쳐오기 시작할 때 폴짝
      e.mode = mode;
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
      // 카메라에서 멀면 통짜 모델 + 애니메이션 생략 (가까워지면 다시 자세히). 경계에서 깜빡이지 않게 히스테리시스
      const cx = e.x - camera.position.x, cz = e.z - camera.position.z, d2 = cx * cx + cz * cz;
      const farNow = e.far ? d2 > LOD_NEAR * LOD_NEAR : d2 > LOD_FAR * LOD_FAR;
      if (farNow !== e.far) { e.far = farNow; setRabbitFar(e.obj, farNow); }
      if (!e.far) animateRabbit(e.obj, dt, e.sp);

      // 체력바: 맞아서 체력이 줄었을 때만 머리 위에 표시 (카메라를 향함)
      const show = e.hp < RABBIT.HP;
      e.bar.visible = show;
      if (show) {
        const ratio = Math.max(0, e.hp / RABBIT.HP);
        e.bar.position.set(e.x, y + 0.4 * RABBIT.SCALE + 0.25, e.z);
        e.bar.quaternion.copy(camera.quaternion);
        const fg = e.bar.userData.fg;
        fg.scale.x = BAR_W * ratio;
        fg.position.x = -BAR_W / 2 + (BAR_W * ratio) / 2;
      }
    }
  }

  return { onSnapshot, update };
}
