// 고릴라 (화면에 그리는 부분): 저폴리 모델 + 모션(대기·네 발 걷기·달리기·드러밍·내려치기·피격·쓰러짐) + 서버 상태 따라가기
//
// - 모델은 전부 코드로 만들어요 (이미지·glTF 파일 없음). 몸 부위(뼈대)마다 지오메트리를 하나로 합쳐서 한 마리가 메시 18개 정도예요.
// - 팔다리는 IK(관절 두 개짜리 계산)로 움직여요: 걸을 때 주먹·발이 땅을 짚고, 드러밍 땐 주먹이 가슴을 쳐요.
// - 위치·추적·공격·체력은 서버(server.js + gorilla-ai.mjs)가 정하고, 여기서는 서버가 보낸 목록을 부드럽게 따라가며 그려요.
// - 크기·체력·속도 같은 설정값은 gorilla-ai.mjs 맨 위 GORILLA 에 있어요. (키는 GORILLA.HEIGHT_MUL)

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GORILLA } from './gorilla-ai.mjs';

// ================= 해시 / 난수 (같은 입력이면 항상 같은 값) =================
function h32(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sm01 = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;

// ================= 뼈대 치수 (모델 좌표: 발바닥 중앙이 (0,0,0), 앞쪽 +z, 위쪽 +y, 왼쪽 +x) =================
// 두 발로 서면 키 약 3.45 → GORILLA.STAND_H(사람의 1.5배 = 3.6m)에 맞게 통째로 키워요.
const MODEL_H = 3.45;
const HIP_Y = 1.30;          // 골반(몸통이 도는 곳) 높이 (서 있을 때)
const TORSO_L = 1.25;        // 골반 ~ 어깨 높이 차
const SH_X = 0.80;           // 어깨 x
const A1 = 1.0, A2 = 0.85;   // 윗팔 · 아랫팔 길이
const FIST = 0.27;           // 손목 ~ 주먹 바닥
const LEG_X = 0.40, HIP_Z = -0.05;
const L1 = 0.58, L2 = 0.60;  // 허벅지 · 종아리 길이
const ANK = 0.12;            // 발목 높이

// ================= 순수 계산: 팔다리 IK + 자세 (THREE 를 쓰지 않아요) =================
// 팔다리 각도 φ = 아래쪽(0,-1,0) 벡터를 x축으로 φ 만큼 돌린 방향 (φ>0 이면 아래-뒤쪽, φ<0 이면 아래-앞쪽)
function ik2(l1, l2, dy, dz, kneeFwd, out) {
  const D = Math.hypot(dy, dz);
  const Dc = clamp(D, Math.abs(l1 - l2) + 0.003, l1 + l2 - 0.003);
  const ph = Math.atan2(-dz, -dy);
  const a = Math.acos(clamp((l1 * l1 + Dc * Dc - l2 * l2) / (2 * l1 * Dc), -1, 1));
  const b = Math.acos(clamp((l2 * l2 + Dc * Dc - l1 * l1) / (2 * l2 * Dc), -1, 1));
  if (kneeFwd) { out[0] = ph - a; out[1] = ph + b; } else { out[0] = ph + a; out[1] = ph - b; }
  return out;
}
const TH_Q = 0.85, TH_U = 0.08;   // 네 발일 때 · 일어섰을 때 몸통이 앞으로 기운 각도
const H_Q = 1.12, H_U = 1.26;     // 골반 높이
const WALK_OFF = [0.0, 0.5, 0.25, 0.75];   // 왼뒤·오른뒤·왼앞·오른앞 (걸을 때: 대각선 순서)
const GALLOP_OFF = [0.0, 0.0, 0.5, 0.5];   // 달릴 때: 뒷발 둘이 같이, 앞발 둘이 같이 (깡충)

// P: { t, sp(모델 m/s), w(움직이는 정도 0~1), run(0~1), ph(걸음 위상), up(일어선 정도 0~1), drumW, drumT, atkT(-1=안 함), hitK(0~1) }
// o: 결과 (몸 높이·기울기·머리·턱 + 팔(arm[0]=왼,[1]=오른) · 다리(leg) 각도)
export function solveGorilla(P, o) {
  const { t, sp, w, run, ph, up, drumW, drumT, atkT, hitK } = P;
  const idle = 1 - w;
  const sw = Math.sin(TAU * ph), cw = Math.cos(TAU * ph);

  // --- 몸통 ---
  let th = lerp(TH_Q, TH_U, up) + 0.07 * run * sw * (1 - up) - 0.25 * hitK;
  let H = lerp(H_Q, H_U, up) - 0.05 * run * (1 - up) + 0.035 * Math.sin(TAU * 2 * ph) * w * (1 - up) + 0.10 * run * Math.max(0, sw) * (1 - up);
  H += 0.012 * Math.sin(t * 1.9) * idle;                       // 숨쉬기
  let bodyZ = -0.12 * hitK;
  let headX = -th * 0.82 + 0.12 + 0.05 * Math.sin(t * 0.7) * idle - 0.22 * run * (1 - up);
  let headY = 0.35 * Math.sin(t * 0.45 + 1.3) * idle * (1 - up);
  let jaw = 0.04 + 0.03 * Math.sin(t * 1.9) * idle + 0.25 * hitK;
  let chest = 1 + 0.012 * Math.sin(t * 1.9) * idle;

  // --- 공격: 일어서서 팔을 번쩍 들었다가 내려찍기 ---
  let atkE = 0, atkS = 0;   // atkE = 팔 드는 정도, atkS = 내려찍는 정도
  if (atkT >= 0) {
    const W = GORILLA.ATTACK_WINDUP;
    const rise = sm01(atkT / (W - 0.11));              // 팔을 번쩍 듦
    const slam = sm01((atkT - (W - 0.11)) / 0.11);      // 내려찍음 → 주먹이 땅에 닿는 순간 = 서버가 피해를 주는 순간(W)
    const back = sm01((atkT - (W + 0.2)) / 0.4);        // 자세를 풂
    atkE = rise * (1 - slam);
    atkS = slam * (1 - back);
    th += 0.45 * atkS - 0.12 * atkE;
    H += 0.05 * atkS;
    jaw += 0.5 * Math.max(atkE, atkS);
    headX += -0.35 * atkE + 0.35 * atkS;
  }
  // --- 드러밍: 가슴을 번갈아 두드리며 포효 ---
  if (drumW > 0) {
    const beat = drumT * 8.6;   // 한 손이 초당 약 4.3번 → 번갈아 쳐서 초당 8.6번 쿵쿵
    th += 0.02 * Math.sin(beat * 2) * drumW;
    headX += (-0.34 + 0.05 * Math.sin(beat * 2)) * drumW;
    headY += 0.22 * Math.sin(drumT * 3.1) * drumW;
    jaw += (0.62 + 0.08 * Math.sin(beat * 2)) * drumW;
    chest += 0.03 * Math.max(0, Math.sin(beat * 2)) * drumW;
    H += 0.025 * Math.abs(Math.sin(beat)) * drumW;
  }

  // --- 어깨 위치 (몸 기준 좌표) ---
  const cT = Math.cos(th), sT = Math.sin(th);
  const Sy = H + TORSO_L * cT, Sz = bodyZ + TORSO_L * sT;

  // --- 걸음 (4발) ---
  const stride = 2.0 + 0.55 * sp;
  const sl = Math.min(1.1, stride * 0.3);
  const duty = 0.62 - 0.14 * run;
  const off = [0, 1, 2, 3].map((i) => lerp(WALK_OFF[i], GALLOP_OFF[i], run));
  const gait = (i, base, slx, liftH) => {
    const u = (((ph + off[i]) % 1) + 1) % 1;
    if (u < duty) return [base + slx * (1 - 2 * (u / duty)), 0];
    const s = (u - duty) / (1 - duty);
    return [base + slx * (-1 + 2 * sm01(s)), Math.sin(Math.PI * s) * liftH];
  };

  const IK = [0, 0];
  // 다리 (0=왼, 1=오른)  ※ gait 번호: 왼뒤 0, 오른뒤 1, 왼앞 2, 오른앞 3
  for (let k = 0; k < 2; k++) {
    const g = gait(k, 0.10, sl * w, 0.20 + 0.12 * run);
    const stand = [0.10 + 0.02 * (k ? -1 : 1), 0];   // 서 있을 때 발 위치
    const fz = lerp(stand[0], g[0], w);
    const fy = ANK + g[1] * w * (1 - up);
    ik2(L1, L2, fy - H, fz - HIP_Z, true, IK);
    const leg = o.leg[k];
    leg.t = IK[0]; leg.s = IK[1] - IK[0]; leg.f = -IK[1] + (g[1] > 0.02 ? -0.35 * (g[1] / 0.3) : 0.0);
  }
  // 팔 (0=왼, 1=오른)
  for (let k = 0; k < 2; k++) {
    // 네 발로 짚을 때: 주먹이 땅에 닿는 손목 높이 FIST
    const g = gait(2 + k, Sz + 0.10, sl * 0.72 * w, 0.26 + 0.14 * run);
    const quadZ = lerp(Sz + 0.10, g[0], w);
    const quadY = FIST + g[1] * w;
    let ty = quadY, tz = quadZ, fistW = 0, splay = 0.06 * (1 - up);
    // 서 있을 때(일어섰는데 아무 동작 없음): 팔을 자연스럽게 내림
    const hangY = Sy - (A1 + A2) * 0.93, hangZ = Sz + 0.12;
    ty = lerp(ty, hangY, up);
    tz = lerp(tz, hangZ, up);
    // 드러밍: 주먹이 번갈아 가슴을 침 (왼손 위상 0, 오른손 위상 π)
    if (drumW > 0) {
      const e = 0.5 + 0.5 * Math.cos(drumT * 4.3 * TAU + (k ? Math.PI : 0));   // 1 = 가슴에 닿는 순간
      const sharp = Math.pow(e, 3);
      const cy = Sy - 0.50, cz = Sz + 0.52;                       // 가슴 앞
      const dy = cy + 0.34 * (1 - sharp), dz = cz + 0.46 * (1 - sharp);
      ty = lerp(ty, dy, drumW);
      tz = lerp(tz, dz, drumW);
      fistW = drumW;
      splay = lerp(splay, -0.26, drumW);
    }
    // 공격: 머리 위로 들었다가 앞으로 내려찍음
    if (atkE > 0 || atkS > 0) {
      const uy = Sy + 0.75, uz = Sz - 0.05;     // 번쩍 든 위치
      const dy2 = FIST + 0.05, dz2 = Sz + 1.35;  // 내려찍은 위치(땅)
      const ay = lerp(lerp(ty, uy, atkE), dy2, atkS), az = lerp(lerp(tz, uz, atkE), dz2, atkS);
      const aw = Math.max(atkE, atkS);
      ty = lerp(ty, ay, aw > 0 ? 1 : 0);
      tz = lerp(tz, az, aw > 0 ? 1 : 0);
      splay = lerp(splay, 0.04, aw);
    }
    // 맞았을 때: 팔이 뒤로 휘청
    if (hitK > 0) { tz -= 0.5 * hitK; ty += 0.25 * hitK; }
    ik2(A1, A2, ty - Sy, tz - Sz, false, IK);
    const arm = o.arm[k];
    arm.u = IK[0] - th; arm.f = IK[1] - IK[0];
    // 주먹 방향: 땅을 짚을 땐 수평 바닥, 드러밍·공격 땐 앞쪽을 향하게
    const fistWorld = lerp(0, -1.0, Math.max(fistW, Math.max(atkE, atkS) * 0.8));
    arm.h = fistWorld - IK[1];
    arm.z = splay;
  }

  o.H = H; o.bodyZ = bodyZ; o.th = th; o.headX = headX; o.headY = headY; o.jaw = jaw; o.chest = chest;
  return o;
}
export const newPose = () => ({ H: 0, bodyZ: 0, th: 0, headX: 0, headY: 0, jaw: 0, chest: 1, arm: [{ u: 0, f: 0, h: 0, z: 0 }, { u: 0, f: 0, h: 0, z: 0 }], leg: [{ t: 0, s: 0, f: 0 }, { t: 0, s: 0, f: 0 }] });

// ================= 모델 =================
const COL = {
  fur: 0x2c2825, furDark: 0x1c1917, furLight: 0x403a36,
  silver: 0x9c9a95, silverDark: 0x7b7974,
  skin: 0x191614, skinLight: 0x2d2622, brow: 0x0f0d0c,
  teeth: 0xece4cc, eye: 0x6b3a0e, pupil: 0x030303, gum: 0x5c1f26, nail: 0x0d0b0a,
};

const V3 = THREE.Vector3, Q = THREE.Quaternion, M4 = THREE.Matrix4, EU = THREE.Euler;
function place(geo, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  geo.applyMatrix4(new M4().compose(new V3(...p), new Q().setFromEuler(new EU(...r)), new V3(...s)));
  return geo;
}
const blob = (p, s, detail = 2, r) => place(new THREE.IcosahedronGeometry(1, detail), p, r, s);
// a -> b 를 잇는 원기둥 (r0 = a쪽 반지름, r1 = b쪽 반지름)
function limb(a, b, r0, r1, sides = 7) {
  const A = new V3(...a), B = new V3(...b);
  const geo = new THREE.CylinderGeometry(r1, r0, A.distanceTo(B), sides, 1);   // 위쪽(+y)이 b 쪽으로 돌아가요 → 위쪽 반지름 = r1
  const q = new Q().setFromUnitVectors(new V3(0, 1, 0), B.clone().sub(A).normalize());
  geo.applyMatrix4(new M4().compose(A.clone().add(B).multiplyScalar(0.5), q, new V3(1, 1, 1)));
  return geo;
}
// base 에서 dir 방향으로 뻗는 뿔 (털 뭉치·이빨·발톱)
function spike(base, dir, len, r, sides = 5) {
  const d = new V3(...dir).normalize();
  const geo = new THREE.ConeGeometry(r, len, sides);
  const q = new Q().setFromUnitVectors(new V3(0, 1, 0), d);
  geo.applyMatrix4(new M4().compose(new V3(...base).addScaledVector(d, len / 2), q, new V3(1, 1, 1)));
  return geo;
}

class BoneDef {
  constructor(name, parent, pivot) { this.name = name; this.parent = parent; this.pivot = pivot; this.parts = []; this.geo = null; }
  add(geo, color, jit = 0.012) { this.parts.push({ geo, color, jit }); return this; }
  bake() {
    const list = [];
    this.parts.forEach(({ geo, color, jit }) => {
      const g = geo.index ? geo.toNonIndexed() : geo;
      if (jit > 0) {
        const p = g.attributes.position;
        const q = (n) => Math.round(n * 600);
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

let TEMPLATE = null, MAT = null, MAT_HIT = null;

function template() {
  if (TEMPLATE) return TEMPLATE;
  const defs = [];
  const bone = (name, parent, pivot) => { const b = new BoneDef(name, parent, pivot); defs.push(b); return b; };

  const body = bone('body', null, [0, HIP_Y, 0]);                 // 골반 (위아래로 움직임)
  const torso = bone('torso', 'body', [0, HIP_Y, 0]);             // 몸통 (앞뒤로 기움)
  const head = bone('head', 'torso', [0, 2.72, 0.18]);
  const jaw = bone('jaw', 'head', [0, 2.80, 0.46]);

  // ---------- 몸통: 술통 같은 가슴 + 넓은 어깨, 등은 은빛(실버백) ----------
  torso
    .add(blob([0, 1.62, 0.04], [0.62, 0.54, 0.54]), COL.fur)                 // 배
    .add(blob([0, 2.18, 0.06], [0.78, 0.64, 0.58]), COL.fur)                 // 가슴
    .add(blob([0, 2.20, 0.43], [0.46, 0.44, 0.20]), COL.skinLight, 0.008)    // 털 없는 가슴 살갗
    .add(blob([0, 2.62, -0.04], [0.86, 0.32, 0.52]), COL.fur)                // 어깨 근육
    .add(blob([0, 2.32, -0.30], [0.66, 0.56, 0.30]), COL.silver)             // 등 (은빛)
    .add(blob([0, 1.98, -0.34], [0.58, 0.40, 0.26]), COL.silverDark)
    .add(blob([0, 1.50, -0.38], [0.55, 0.38, 0.30]), COL.silverDark)         // 엉덩이 쪽 은빛
    .add(blob([0, 1.42, -0.10], [0.58, 0.40, 0.48]), COL.fur);               // 엉덩이
  // 털 뭉치 (어깨·등)
  for (let k = 0; k < 7; k++) {
    const sx = k % 2 ? 1 : -1, y = 2.62 - Math.floor(k / 2) * 0.28;
    torso.add(spike([sx * (0.52 - Math.floor(k / 2) * 0.05), y, -0.12], [sx * 0.5, 0.2, -0.85], 0.26, 0.085), COL.furLight, 0.01);
  }
  for (let k = 0; k < 5; k++) torso.add(spike([(k - 2) * 0.17, 2.50 - k * 0.04, -0.52], [(k - 2) * 0.12, 0.25, -1], 0.24, 0.08), COL.silver, 0.01);
  for (let k = 0; k < 4; k++) torso.add(spike([(k - 1.5) * 0.18, 2.05, -0.58], [(k - 1.5) * 0.12, -0.1, -1], 0.22, 0.075), COL.silverDark, 0.01);

  // ---------- 머리: 튀어나온 이마 능선, 정수리 볏, 깊게 파인 눈, 큰 송곳니 ----------
  head
    .add(blob([0, 3.0, 0.26], [0.39, 0.38, 0.43]), COL.furDark)              // 머리통
    .add(blob([0, 3.24, 0.08], [0.10, 0.13, 0.30]), COL.furDark)             // 정수리 볏
    .add(blob([0, 3.03, 0.58], [0.30, 0.07, 0.13]), COL.brow, 0.006)        // 이마 능선 (튀어나온 눈썹뼈)
    .add(blob([0, 2.93, 0.52], [0.28, 0.26, 0.22]), COL.skin, 0.006)         // 얼굴
    .add(blob([0, 2.84, 0.66], [0.27, 0.21, 0.23]), COL.skinLight, 0.006)    // 주둥이
    .add(blob([0, 2.76, 0.52], [0.30, 0.10, 0.22]), COL.furDark)             // 턱수염 쪽
    .add(blob([-0.27, 2.82, 0.36], [0.12, 0.17, 0.17]), COL.furDark)         // 구레나룻
    .add(blob([0.27, 2.82, 0.36], [0.12, 0.17, 0.17]), COL.furDark);
  for (const sx of [-1, 1]) {
    head
      .add(blob([sx * 0.38, 2.97, 0.16], [0.05, 0.09, 0.07], 1), COL.skin, 0.004)                  // 귀
      .add(blob([sx * 0.14, 3.0, 0.62], [0.065, 0.045, 0.045], 1), COL.brow, 0.003)                 // 눈구멍
      .add(blob([sx * 0.14, 2.99, 0.655], [0.036, 0.03, 0.022], 1), COL.eye, 0)                      // 눈 (호박색)
      .add(blob([sx * 0.14, 2.99, 0.672], [0.018, 0.02, 0.012], 0), COL.pupil, 0)                    // 눈동자
      .add(blob([sx * 0.065, 2.885, 0.855], [0.05, 0.032, 0.03], 1), COL.brow, 0.002)               // 콧구멍
      .add(spike([sx * 0.105, 2.80, 0.84], [0, -1, 0.15], 0.11, 0.024, 5), COL.teeth, 0)            // 위 송곳니
      .add(blob([sx * 0.05, 3.2, 0.34], [0.06, 0.05, 0.1], 1), COL.furDark, 0.006);                  // 머리털
  }
  for (let k = 0; k < 5; k++) head.add(spike([(k - 2) * 0.09, 3.22 - Math.abs(k - 2) * 0.03, 0.02], [(k - 2) * 0.1, 0.3, -1], 0.20, 0.065), COL.furDark, 0.008);   // 뒷머리 털
  jaw
    .add(blob([0, 2.735, 0.68], [0.19, 0.07, 0.20]), COL.skinLight, 0.005)   // 아래턱
    .add(blob([0, 2.775, 0.70], [0.14, 0.03, 0.15], 1), COL.gum, 0)            // 입 안
    .add(spike([-0.085, 2.78, 0.83], [0, 1, 0.1], 0.09, 0.02, 5), COL.teeth, 0)   // 아래 송곳니
    .add(spike([0.085, 2.78, 0.83], [0, 1, 0.1], 0.09, 0.02, 5), COL.teeth, 0);

  // ---------- 팔 (왼 +x / 오른 -x): 어깨 → 팔꿈치 → 손목(주먹) ----------
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R';
    const S = [sx * SH_X, 2.55, 0], E = [sx * SH_X, 1.55, 0], Wr = [sx * SH_X, 0.70, 0];
    const up = bone('up' + nm, 'torso', S);
    up
      .add(blob([S[0], S[1], S[2]], [0.34, 0.34, 0.34]), COL.fur)
      .add(limb(S, E, 0.27, 0.22), COL.fur, 0.008)
      .add(blob([S[0] + sx * 0.02, 2.15, 0.04], [0.28, 0.30, 0.27]), COL.fur);
    for (let k = 0; k < 4; k++) up.add(spike([S[0] + sx * 0.14, 2.30 - k * 0.20, -0.10], [sx * 0.35, -0.55, -0.75], 0.20, 0.07), COL.furLight, 0.01);
    const fore = bone('fore' + nm, 'up' + nm, E);
    fore
      .add(blob([E[0], E[1], E[2]], [0.23, 0.23, 0.23]), COL.fur)
      .add(limb(E, Wr, 0.23, 0.17), COL.fur, 0.008)
      .add(blob([E[0], 1.15, 0.0], [0.24, 0.30, 0.23]), COL.fur);
    for (let k = 0; k < 4; k++) fore.add(spike([E[0] + sx * 0.08, 1.42 - k * 0.18, -0.12], [sx * 0.15, -0.7, -0.7], 0.20, 0.065), COL.furLight, 0.01);
    const fist = bone('fist' + nm, 'fore' + nm, Wr);
    fist
      .add(blob([Wr[0], 0.70, 0], [0.15, 0.13, 0.15]), COL.furDark)                              // 손목
      .add(blob([Wr[0], 0.58, 0.05], [0.19, 0.15, 0.21]), COL.skinLight, 0.006)                  // 주먹
      .add(blob([Wr[0], 0.50, 0.14], [0.17, 0.07, 0.12], 1), COL.skin, 0.004)                    // 말아 쥔 손가락
      .add(blob([Wr[0] - sx * 0.15, 0.55, 0.12], [0.05, 0.06, 0.09], 1), COL.skinLight, 0.003);  // 엄지
    for (let k = 0; k < 4; k++) fist.add(blob([Wr[0] + (k - 1.5) * 0.075, 0.53, 0.235], [0.04, 0.045, 0.045], 1), COL.skin, 0.002);   // 손가락 마디
  }

  // ---------- 다리 (짧고 굵음): 엉덩이 → 무릎 → 발목 ----------
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R';
    const Hp = [sx * LEG_X, HIP_Y, HIP_Z], K = [sx * LEG_X, 0.72, HIP_Z], An = [sx * LEG_X, ANK, HIP_Z];
    const th = bone('th' + nm, 'body', Hp);
    th
      .add(blob([Hp[0] + sx * 0.02, 1.05, HIP_Z + 0.02], [0.30, 0.36, 0.32]), COL.fur)
      .add(limb(Hp, K, 0.30, 0.23), COL.fur, 0.008);
    const sh = bone('sh' + nm, 'th' + nm, K);
    sh
      .add(blob([K[0], K[1], HIP_Z + 0.05], [0.22, 0.22, 0.22]), COL.fur)
      .add(limb(K, An, 0.22, 0.15), COL.fur, 0.008)
      .add(blob([K[0], 0.50, HIP_Z - 0.02], [0.20, 0.25, 0.21]), COL.fur);
    const ft = bone('ft' + nm, 'sh' + nm, An);
    ft
      .add(blob([An[0], 0.075, HIP_Z + 0.12], [0.17, 0.07, 0.27]), COL.skinLight, 0.005)
      .add(blob([An[0], 0.09, HIP_Z - 0.10], [0.12, 0.07, 0.10]), COL.skinLight, 0.004);
    for (let k = 0; k < 3; k++) ft.add(blob([An[0] + (k - 1) * 0.09, 0.06, HIP_Z + 0.37], [0.055, 0.045, 0.075], 1), COL.skin, 0.002);
  }

  defs.forEach((d) => d.bake());
  TEMPLATE = defs;
  MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, emissive: 0x161412 });
  MAT_HIT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, emissive: 0xff2a14, emissiveIntensity: 0.9 });
  return TEMPLATE;
}

// 고릴라 한 마리 만들기 (원점 = 발바닥, 앞쪽 = +z). 크기는 GORILLA.STAND_H 에 맞춰요
export function buildGorilla() {
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
  root.userData.rig = {
    b: bones, meshes, t: Math.random() * 30, ph: 0, w: 0, rb: 0, up: 0, drumW: 0, drumT: 0,
    atkT: -1, ht: -1, flash: 0, hit: false, pose: newPose(), mode: 0,
  };
  return root;
}

// ================= 모션 =================
// speed: 지금 이동 속도(m/s). mode: 서버가 알려준 상태 (0 배회, 1 추적, 2 공격, 4 드러밍)
export function animateGorilla(g, dt, speed, mode, scale) {
  const r = g.userData.rig, b = r.b, o = r.pose;
  r.t += dt;
  const sp = speed / scale;
  r.w += (Math.min(1, sp / 0.6) - r.w) * (1 - Math.exp(-9 * dt));            // 움직이는 중인 정도
  r.rb += (sm01((sp - 3.2) / 4.5) - r.rb) * (1 - Math.exp(-7 * dt));         // 달리는 중인 정도
  const stride = 2.0 + 0.55 * sp;
  r.ph = (r.ph + dt * sp / stride) % 1;
  r.mode = mode;

  // 드러밍이면 일어서고, 공격 중엔 반쯤 일어섬, 아니면 네 발
  const attacking = r.atkT >= 0;
  const upT = mode === 4 ? 1 : attacking ? 0.7 : 0;
  r.up += (upT - r.up) * (1 - Math.exp(-(upT > r.up ? 7 : 9) * dt));
  r.drumW += ((mode === 4 ? 1 : 0) - r.drumW) * (1 - Math.exp(-14 * dt));
  r.drumT = mode === 4 ? r.drumT + dt : 0;
  if (attacking) { r.atkT += dt; if (r.atkT > GORILLA.ATTACK_WINDUP + 0.75) r.atkT = -1; }
  let hitK = 0;
  if (r.ht >= 0) {
    r.ht += dt;
    const u = r.ht / 0.4;
    if (u >= 1) r.ht = -1; else hitK = u < 0.25 ? u / 0.25 : 1 - sm01((u - 0.25) / 0.75);
  }

  solveGorilla({ t: r.t, sp, w: r.w * (1 - r.drumW), run: r.rb, ph: r.ph, up: r.up, drumW: r.drumW, drumT: r.drumT, atkT: r.atkT, hitK }, o);
  applyPose(b, o);

  if (r.flash > 0) {   // 맞았을 때 잠깐 붉게
    r.flash -= dt;
    if (!r.hit) { r.hit = true; for (const m of r.meshes) m.material = MAT_HIT; }
    if (r.flash <= 0) { r.hit = false; for (const m of r.meshes) m.material = MAT; }
  }
}
function applyPose(b, o) {
  b.body.position.y = o.H;
  b.body.position.z = o.bodyZ;
  b.torso.rotation.x = o.th;
  b.torso.scale.set(1, o.chest, 1);
  b.head.rotation.x = o.headX;
  b.head.rotation.y = o.headY;
  b.jaw.rotation.x = o.jaw;
  for (let k = 0; k < 2; k++) {
    const nm = k ? 'R' : 'L', sx = k ? -1 : 1, a = o.arm[k], l = o.leg[k];
    b['up' + nm].rotation.set(a.u, 0, sx * a.z);
    b['fore' + nm].rotation.x = a.f;
    b['fist' + nm].rotation.x = a.h;
    b['th' + nm].rotation.x = l.t;
    b['sh' + nm].rotation.x = l.s;
    b['ft' + nm].rotation.x = l.f;
  }
}

// 죽는 모션: 옆으로 털썩 쓰러져 눕고 팔다리는 축 늘어짐. f = 쓰러진 정도 (0 = 서 있음, 1 = 완전히 누움)
function deathPose(g, f, side) {
  const r = g.userData.rig, b = r.b;
  r.atkT = -1; r.ht = -1;
  b.body.position.set(0, lerp(1.12, 1.0, f), 0);
  b.torso.rotation.set(lerp(0.85, 0.35, f), 0, 0);
  b.torso.scale.set(1, 1, 1);
  b.head.rotation.set(lerp(-0.6, 0.25, f), 0.3 * side * f, 0);
  b.jaw.rotation.x = 0.5 * f;
  for (let k = 0; k < 2; k++) {
    const nm = k ? 'R' : 'L', sx = k ? -1 : 1;
    b['up' + nm].rotation.set(-0.5 * f + (k ? 0.3 : -0.1) * f, 0, sx * 0.35 * f);
    b['fore' + nm].rotation.x = 0.4 * f * (k ? 1.3 : 0.8);
    b['fist' + nm].rotation.x = 0.2 * f;
    b['th' + nm].rotation.x = (k ? -0.9 : -0.5) * f;
    b['sh' + nm].rotation.x = (k ? 1.3 : 0.9) * f;
    b['ft' + nm].rotation.x = 0.3 * f;
  }
}
const fallCurve = (k) => k >= 1 ? 1 : k < 0.8 ? (k / 0.8) ** 2 : 1 - 0.05 * Math.sin(Math.PI * (k - 0.8) / 0.2);

// ================= 서버가 보낸 고릴라를 화면에 그리기 =================
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const ANIM_DIST = 140;   // 이 거리(m)보다 멀면 모션 계산을 건너뛰어요 (마지막 자세로 서 있음)

export function createGorillaWorld({ scene, camera, T, WATER_LEVEL }) {
  const map = new Map();   // 고릴라 id -> { obj, bar, x, z, ry, tx, tz, tr, hp, atkN, mode, sp, dying, dd, side }
  const SCALE = GORILLA.STAND_H / MODEL_H;
  const barGeo = new THREE.PlaneGeometry(1, 1);
  const barBgMat = new THREE.MeshBasicMaterial({ color: 0x120404, transparent: true, opacity: 0.9, depthTest: false, fog: false });
  const barFgMat = new THREE.MeshBasicMaterial({ color: 0xff1111, depthTest: false, fog: false });
  const BAR_W = 1.5, BAR_H = 0.14;

  function makeBar() {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(barGeo, barBgMat); bg.scale.set(BAR_W + 0.06, BAR_H + 0.06, 1); bg.renderOrder = 998;
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
        const obj = buildGorilla();
        obj.scale.setScalar(SCALE);
        obj.rotation.order = 'YXZ';   // 방향(y)을 돌린 뒤 쓰러지는 기울기(z)를 적용
        const bar = makeBar();
        scene.add(obj, bar);
        e = { obj, bar, x, z, ry, tx: x, tz: z, tr: ry, hp, atkN, mode, sp: 0, dying: false, dd: 0, side: 1, first: true };
        map.set(id, e);
      }
      const rig = e.obj.userData.rig;
      e.tx = x; e.tz = z; e.tr = ry;
      if (mode === 3) {   // 죽음: 쓰러지는 모션 시작 (누워 있는 동안 서버가 계속 보내줌)
        if (!e.dying) { e.dying = true; e.dd = 0; e.side = Math.random() < 0.5 ? -1 : 1; rig.atkT = -1; }
      } else if (e.dying) {   // 다시 살아남(리스폰): 자세 되돌리기
        e.dying = false; e.obj.rotation.z = 0;
      }
      if (hp < e.hp) { rig.flash = 0.18; if (mode !== 3 && rig.ht < 0) rig.ht = 0; }      // 맞음 → 붉게 + 휘청
      if (atkN !== e.atkN) { rig.atkT = 0; e.atkN = atkN; }                               // 내려치는 모션 시작
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
    const k = 1 - Math.exp(-12 * dt), kr = 1 - Math.exp(-10 * dt), ks = 1 - Math.exp(-8 * dt);
    for (const e of map.values()) {
      const ox = e.x, oz = e.z;
      if (Math.hypot(e.tx - e.x, e.tz - e.z) > 8) { e.x = e.tx; e.z = e.tz; }   // 순간이동(복귀)은 바로 이동
      else { e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; }
      e.ry += angDiff(e.ry, e.tr) * kr;
      const sp = dt > 0 ? Math.hypot(e.x - ox, e.z - oz) / dt : 0;
      e.sp += (Math.min(sp, 16) - e.sp) * ks;

      const y = Math.max(T.height(e.x, e.z), WATER_LEVEL - 0.8);
      e.obj.position.set(e.x, y, e.z);
      e.obj.rotation.y = e.ry;
      const cx = e.x - camera.position.x, cz = e.z - camera.position.z;
      const near = cx * cx + cz * cz < ANIM_DIST * ANIM_DIST;
      if (e.dying) {
        e.dd += dt;
        const f = fallCurve(e.dd / GORILLA.DEATH_FALL);
        if (near || e.first) deathPose(e.obj, f, e.side);
        e.obj.rotation.z = e.side * (Math.PI / 2) * 0.96 * f;
        e.obj.position.y = y + 0.45 * SCALE * f;
        e.bar.visible = false;
        e.first = false;
        continue;
      }
      if (near || e.first) animateGorilla(e.obj, e.first ? 0.016 : dt, e.sp, e.mode, SCALE);
      e.first = false;

      // 체력바: 맞아서 체력이 줄었을 때만 머리 위에 표시 (카메라를 향함)
      const show = e.hp < GORILLA.HP;
      e.bar.visible = show;
      if (show) {
        const ratio = clamp(e.hp / GORILLA.HP, 0, 1);
        e.bar.position.set(e.x, y + GORILLA.STAND_H + 0.55, e.z);
        e.bar.quaternion.copy(camera.quaternion);
        const fg = e.bar.userData.fg;
        fg.scale.x = Math.max(0.001, BAR_W * ratio);
        fg.position.x = -BAR_W / 2 + (BAR_W * ratio) / 2;
      }
    }
  }

  // 지도(미니맵) 등에서 쓸 위치 목록
  const positions = () => [...map.values()].filter((e) => !e.dying).map((e) => [e.x, e.z]);

  return { onSnapshot, update, positions };
}

// 개발·점검용 (모델 부품 목록 보기)
export const _template = template;
