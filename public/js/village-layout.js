import { VILLAGE } from './terrain.js';

// 마을 건물 배치 + 충돌 (THREE 의존 없음 → 서버/테스트에서도 import 가능)
//
// 건물 로컬 좌표: x = 오른쪽, z = 앞쪽(문이 있는 쪽). 건물은 항상 마을 중앙(광장)을 바라보게 놓인다.
// 시작 지점(0,0)은 광장 한가운데이고, 시작 시 -z 방향을 보고 있으므로 "뒤편" = +z 쪽.

const TAU = Math.PI * 2;
export const INN_DIST = 47;          // 여관: 시작 지점에서 +z(뒤편)로 47칸
export const LAYOUT_RADIUS = 135;    // 이 밖에는 건물이 없음 (충돌 검사 빠른 탈출용)

// 건물 종류별 충돌 상자 (로컬 좌표, 크기는 w x d)
const FOOT = {
  A: [{ x: 0, z: 0, w: 9.8, d: 8.8 }],      // 튜더식 2층집 (붉은 지붕)
  B: [{ x: 0, z: 0, w: 7.4, d: 7.4 }],      // 휘어진 지붕의 탑
  C: [{ x: 0, z: 0, w: 12.2, d: 9.4 }],     // 4층 연립 건물
  D: [{ x: 0, z: 0, w: 8.6, d: 7.6 }],      // 작은 오두막 (갈색 지붕)
  INN: [
    { x: 0, z: 0, w: 30.6, d: 18.6 },       // 본관
    { x: -18.2, z: 4.6, w: 9, d: 9 },       // 탑
    { x: 19, z: 4.7, w: 9.8, d: 8.8 },      // 별관
  ],
};

// ---------- 집 안쪽 (1층만 들어갈 수 있음) ----------
// w, d = 벽 중심선 기준 방 크기, h = 1층 높이(천장), dw/dh = 문 너비/높이. 문은 항상 앞쪽(+z) 벽 가운데.
export const ROOM = {
  A: { w: 8.4, d: 7.4, h: 3.8, dw: 1.7, dh: 2.9 },
  B: { w: 6.4, d: 6.4, h: 4.0, dw: 1.7, dh: 2.9 },
  C: { w: 11.6, d: 8.8, h: 4.2, dw: 1.8, dh: 2.9 },
  D: { w: 7.8, d: 6.8, h: 3.6, dw: 1.6, dh: 2.8 },
  INN: { w: 30, d: 18, h: 5.0, dw: 3.0, dh: 3.8 },
};
const WALL_T = 0.3;            // 벽 충돌 반두께
const FLOOR_Y = 0.05;          // 바닥 윗면 높이 (땅 기준)
export { FLOOR_Y };

// 가구 배치: 집 중심 기준 (x 오른쪽, z 앞쪽=문 쪽). ry = 회전, 기본 앞면은 +z. solid=false 면 통과 가능.
// w,d = 회전 전 바닥 크기. 의자는 앉는 사람이 +z 쪽을 바라봄.
const PI = Math.PI;
const NS = false;   // not solid
export const INTERIOR = {
  A: [
    { k: 'fireplace', x: 0, z: -2.85, w: 2.8, d: 1.1 },
    { k: 'shelf', x: -3.7, z: -0.3, ry: PI / 2, w: 2.6, d: 0.5 },
    { k: 'bed', x: 2.95, z: -1.85, w: 1.7, d: 3.0, cloth: 'clothR' },
    { k: 'stand', x: 1.75, z: -3.15, w: 0.55, d: 0.55 },
    { k: 'rug', x: -1.0, z: 0.5, w: 3.0, d: 2.4, solid: NS },
    { k: 'table', x: -1.0, z: 0.4, w: 1.8, d: 1.0 },
    { k: 'chair', x: -1.0, z: -0.55, w: 0.55, d: 0.55 },
    { k: 'chair', x: -1.0, z: 1.35, ry: PI, w: 0.55, d: 0.55 },
    { k: 'lamp', x: 3.4, z: 2.7, w: 0.5, d: 0.5 },
    { k: 'chandelier', x: -1.0, z: 0.4, solid: NS },
    { k: 'sconce', x: -3.93, z: 2.2, ry: PI / 2, solid: NS },
    { k: 'sconce', x: 3.93, z: 0.9, ry: -PI / 2, solid: NS },
  ],
  B: [
    { k: 'shelf', x: 0, z: -2.7, w: 2.8, d: 0.5 },
    { k: 'shelf', x: -2.7, z: 0.4, ry: PI / 2, w: 2.6, d: 0.5 },
    { k: 'shelf', x: 2.7, z: 0.4, ry: -PI / 2, w: 2.6, d: 0.5 },
    { k: 'desk', x: 0, z: -1.45, w: 2.0, d: 0.9 },
    { k: 'chair', x: 0, z: -0.5, ry: PI, w: 0.55, d: 0.55 },
    { k: 'rug', x: 0, z: 0.9, w: 2.6, d: 2.2, solid: NS },
    { k: 'lamp', x: -1.8, z: 2.3, w: 0.5, d: 0.5 },
    { k: 'chest', x: 2.1, z: 2.3, ry: PI, w: 1.0, d: 0.7 },
    { k: 'chandelier', x: 0, z: 0.9, solid: NS },
    { k: 'sconce', x: 1.9, z: 2.93, ry: PI, solid: NS },
  ],
  C: [
    { k: 'bed', x: -4.3, z: -2.6, w: 1.7, d: 3.0, cloth: 'clothB' },
    { k: 'bed', x: -2.0, z: -2.6, w: 1.7, d: 3.0, cloth: 'clothR' },
    { k: 'stand', x: -3.15, z: -3.85, w: 0.55, d: 0.55 },
    { k: 'wardrobe', x: 3.2, z: -3.7, w: 2.0, d: 0.8 },
    { k: 'shelf', x: 5.3, z: -0.6, ry: -PI / 2, w: 2.6, d: 0.5 },
    { k: 'fireplace', x: -5.0, z: 1.3, ry: PI / 2, w: 2.6, d: 1.1 },
    { k: 'rug', x: -1.6, z: 1.3, w: 3.6, d: 2.6, solid: NS },
    { k: 'table', x: -1.6, z: 1.3, w: 2.4, d: 1.2 },
    { k: 'chair', x: -2.4, z: 0.1, w: 0.55, d: 0.55 },
    { k: 'chair', x: -0.8, z: 0.1, w: 0.55, d: 0.55 },
    { k: 'chair', x: -2.4, z: 2.5, ry: PI, w: 0.55, d: 0.55 },
    { k: 'chair', x: -0.8, z: 2.5, ry: PI, w: 0.55, d: 0.55 },
    { k: 'desk', x: 4.2, z: 3.35, ry: PI, w: 2.2, d: 1.0 },
    { k: 'chair', x: 4.2, z: 2.3, w: 0.55, d: 0.55 },
    { k: 'lamp', x: -5.0, z: 3.6, w: 0.5, d: 0.5 },
    { k: 'lamp', x: 5.0, z: 1.5, w: 0.5, d: 0.5 },
    { k: 'chandelier', x: -1.6, z: 1.3, solid: NS },
    { k: 'sconce', x: -3.0, z: 4.13, ry: PI, solid: NS },
    { k: 'sconce', x: 3.0, z: 4.13, ry: PI, solid: NS },
    { k: 'sconce', x: 0, z: -4.13, solid: NS },
  ],
  D: [
    { k: 'bed', x: -2.7, z: 0.3, w: 1.7, d: 3.0, cloth: 'clothB' },
    { k: 'stove', x: 1.9, z: -2.65, w: 1.6, d: 1.0 },
    { k: 'wardrobe', x: -0.4, z: -2.75, w: 1.6, d: 0.8 },
    { k: 'rug', x: 1.7, z: 0.4, w: 2.8, d: 2.2, solid: NS },
    { k: 'table', x: 1.7, z: 0.3, w: 1.4, d: 1.0 },
    { k: 'chair', x: 0.5, z: 0.3, ry: PI / 2, w: 0.55, d: 0.55 },
    { k: 'chair', x: 2.9, z: 0.3, ry: -PI / 2, w: 0.55, d: 0.55 },
    { k: 'barrel', x: 3.1, z: 2.3, w: 0.9, d: 0.9 },
    { k: 'crate', x: 2.0, z: 2.6, w: 0.9, d: 0.9 },
    { k: 'lamp', x: -3.1, z: 2.6, w: 0.5, d: 0.5 },
    { k: 'sconce', x: 3.2, z: -3.13, solid: NS },
    { k: 'sconce', x: -3.63, z: -1.8, ry: PI / 2, solid: NS },
  ],
  INN: [
    // 술집 (오른쪽 안쪽)
    { k: 'backbar', x: 7.5, z: -8.45, w: 10, d: 0.5 },
    { k: 'bar', x: 7.5, z: -4.6, w: 10, d: 1.3 },
    { k: 'stool', x: 3.5, z: -2.9, w: 0.5, d: 0.5 },
    { k: 'stool', x: 5.5, z: -2.9, w: 0.5, d: 0.5 },
    { k: 'stool', x: 7.5, z: -2.9, w: 0.5, d: 0.5 },
    { k: 'stool', x: 9.5, z: -2.9, w: 0.5, d: 0.5 },
    { k: 'stool', x: 11.5, z: -2.9, w: 0.5, d: 0.5 },
    { k: 'barrel', x: 13.8, z: -6.4, w: 0.9, d: 0.9 },
    { k: 'barrel', x: 13.8, z: -4.9, w: 0.9, d: 0.9 },
    { k: 'fireplace', x: -3.5, z: -8.1, w: 3.6, d: 1.1 },
    // 식탁들
    { k: 'rug', x: -3.5, z: 1.4, w: 4.4, d: 3.2, solid: NS },
    { k: 'table', x: -3.5, z: 1.4, w: 2.2, d: 1.2 },
    { k: 'chair', x: -4.3, z: 0.3, w: 0.55, d: 0.55 },
    { k: 'chair', x: -2.7, z: 0.3, w: 0.55, d: 0.55 },
    { k: 'chair', x: -4.3, z: 2.5, ry: PI, w: 0.55, d: 0.55 },
    { k: 'chair', x: -2.7, z: 2.5, ry: PI, w: 0.55, d: 0.55 },
    { k: 'rug', x: 4.8, z: 2.4, w: 4.2, d: 3.0, solid: NS },
    { k: 'table', x: 4.8, z: 2.4, w: 2.2, d: 1.2 },
    { k: 'chair', x: 4.0, z: 1.3, w: 0.55, d: 0.55 },
    { k: 'chair', x: 5.6, z: 1.3, w: 0.55, d: 0.55 },
    { k: 'chair', x: 4.0, z: 3.5, ry: PI, w: 0.55, d: 0.55 },
    { k: 'chair', x: 5.6, z: 3.5, ry: PI, w: 0.55, d: 0.55 },
    { k: 'round', x: 10.0, z: 1.2, w: 1.6, d: 1.6 },
    { k: 'stool', x: 8.8, z: 1.2, w: 0.5, d: 0.5 },
    { k: 'stool', x: 11.2, z: 1.2, w: 0.5, d: 0.5 },
    { k: 'stool', x: 10.0, z: 2.4, w: 0.5, d: 0.5 },
    { k: 'stool', x: 10.0, z: 0.0, w: 0.5, d: 0.5 },
    { k: 'table', x: 9.5, z: 6.0, w: 2.0, d: 1.1 },
    { k: 'chair', x: 8.7, z: 5.0, w: 0.55, d: 0.55 },
    { k: 'chair', x: 10.3, z: 5.0, w: 0.55, d: 0.55 },
    { k: 'chair', x: 8.7, z: 7.0, ry: PI, w: 0.55, d: 0.55 },
    { k: 'chair', x: 10.3, z: 7.0, ry: PI, w: 0.55, d: 0.55 },
    { k: 'table', x: -7.0, z: -3.2, w: 2.0, d: 1.1 },
    { k: 'chair', x: -7.7, z: -4.2, w: 0.55, d: 0.55 },
    { k: 'chair', x: -6.3, z: -4.2, w: 0.55, d: 0.55 },
    { k: 'chair', x: -7.7, z: -2.2, ry: PI, w: 0.55, d: 0.55 },
    { k: 'chair', x: -6.3, z: -2.2, ry: PI, w: 0.55, d: 0.55 },
    // 침대 칸 (왼쪽 안쪽, 칸막이 뒤)
    { k: 'screen', x: -11.65, z: -4.2, w: 6.2, d: 0.2 },
    { k: 'bed', x: -13.6, z: -6.9, w: 1.7, d: 3.0, cloth: 'clothR' },
    { k: 'bed', x: -11.2, z: -6.9, w: 1.7, d: 3.0, cloth: 'clothB' },
    { k: 'bed', x: -8.8, z: -6.9, w: 1.7, d: 3.0, cloth: 'clothR' },
    { k: 'stand', x: -12.4, z: -8.4, w: 0.55, d: 0.55 },
    { k: 'stand', x: -10.0, z: -8.4, w: 0.55, d: 0.55 },
    // 벽가 가구
    { k: 'wardrobe', x: -14.35, z: 1.5, ry: PI / 2, w: 2.4, d: 0.8 },
    { k: 'chest', x: -14.3, z: 5.5, ry: PI / 2, w: 1.2, d: 0.7 },
    { k: 'shelf', x: 14.5, z: 3.0, ry: -PI / 2, w: 3.0, d: 0.5 },
    { k: 'shelf', x: 14.5, z: 6.4, ry: -PI / 2, w: 3.0, d: 0.5 },
    { k: 'lamp', x: -14.1, z: 8.1, w: 0.5, d: 0.5 },
    { k: 'lamp', x: 14.1, z: 8.1, w: 0.5, d: 0.5 },
    // 조명
    { k: 'chandelier', x: -3.5, z: 1.4, solid: NS },
    { k: 'chandelier', x: 4.8, z: 2.4, solid: NS },
    { k: 'chandelier', x: 10.0, z: 1.2, solid: NS },
    { k: 'chandelier', x: 9.5, z: 6.0, solid: NS },
    { k: 'chandelier', x: -7.0, z: -3.2, solid: NS },
    { k: 'chandelier', x: -11.2, z: -6.5, solid: NS },
    { k: 'sconce', x: -3.2, z: 8.73, ry: PI, solid: NS },
    { k: 'sconce', x: 3.2, z: 8.73, ry: PI, solid: NS },
    { k: 'sconce', x: 0.4, z: -8.73, solid: NS },
    { k: 'sconce', x: 14.73, z: -1.0, ry: -PI / 2, solid: NS },
    { k: 'sconce', x: -14.73, z: 4.0, ry: PI / 2, solid: NS },
  ],
};

export const HOUSES = [];   // { type, x, z, rot, k, seed, roof }
const OBBS = [];            // 충돌 상자 (월드 좌표)

function place(type, x, z, k, seed, roof, yaw = 0) {
  // 로컬 +z 가 (sinθ, cosθ) 를 향함 → 기본은 광장 쪽을 보고, yaw 만큼 살짝 틀어서 자연스럽게
  const rot = Math.atan2(VILLAGE.x - x, VILLAGE.z - z) + yaw;
  HOUSES.push({ type, x, z, rot, k, seed, roof });
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const f of FOOT[type]) {
    OBBS.push({
      cx: x + (f.x * c + f.z * s) * k,
      cz: z + (-f.x * s + f.z * c) * k,
      hw: (f.w * k) / 2, hd: (f.d * k) / 2, c, s,
    });
  }
  buildColliders(HOUSES.length - 1);
}

// ---------- 충돌 상자 (벽 + 문 + 가구) ----------
// 집은 속이 빈 상자: 사방이 벽이고 앞벽 가운데만 문 구멍. 문이 닫혀 있으면 구멍도 막힘.
const HCOLS = [];     // 집별 충돌 상자 목록
const HBOUND = [];    // 집별 대략적인 범위 { x, z, r }
const DOOR_OPEN = []; // 집별 문 열림 상태
// 여관의 탑/별관은 들어갈 수 없는 덩어리 (본관 벽 바깥쪽에 맞춰 줄여 둠)
const SOLID_EXTRA = { INN: [{ x: -19.1, z: 4.6, w: 7.2, d: 9 }, { x: 19.75, z: 4.7, w: 8.5, d: 8.8 }] };

function buildColliders(i) {
  const h = HOUSES[i], R = ROOM[h.type], k = h.k;
  const c0 = Math.cos(h.rot), s0 = Math.sin(h.rot), list = [];
  const add = (lx, lz, w, d, yaw = 0, door = -1) => {
    const th = h.rot + yaw;
    list.push({
      cx: h.x + (lx * c0 + lz * s0) * k, cz: h.z + (-lx * s0 + lz * c0) * k,
      hw: (w * k) / 2, hd: (d * k) / 2, c: Math.cos(th), s: Math.sin(th), door,
    });
  };
  const W = R.w, D = R.d, DW = R.dw, T = WALL_T * 2;
  add(0, -D / 2, W + T, T);                                         // 뒷벽
  add(-W / 2, 0, T, D + T); add(W / 2, 0, T, D + T);                // 옆벽
  const x0 = -W / 2 - WALL_T, x1 = -DW / 2;                         // 앞벽: 문 구멍 양쪽
  add((x0 + x1) / 2, D / 2, x1 - x0, T); add(-(x0 + x1) / 2, D / 2, x1 - x0, T);
  add(0, D / 2, DW + 0.1, T * 0.8, 0, i);                           // 문(닫힘) - 열리면 무시
  for (const e of SOLID_EXTRA[h.type] || []) add(e.x, e.z, e.w, e.d);
  for (const it of INTERIOR[h.type]) {
    if (it.solid === false) continue;
    const q = it.k === 'chair' || it.k === 'stool' ? 0.1 : 0;      // 의자는 살짝 작게 (좁은 틈 통과)
    add(it.x, it.z, it.w - q, it.d - q, it.ry || 0);
  }
  HCOLS[i] = list;
  let r = 0;
  for (const o of list) r = Math.max(r, Math.hypot(o.cx - h.x, o.cz - h.z) + Math.hypot(o.hw, o.hd));
  HBOUND[i] = { x: h.x, z: h.z, r };
  DOOR_OPEN[i] = false;
}

const VX = VILLAGE.x, VZ = VILLAGE.z;

// 여관 (제일 큰 집) - 시작 지점 뒤편에 딱 하나
place('INN', VX, VZ + INN_DIST, 1, 101, 'roofNavy');

// 나머지 집: 일부러 대칭을 깨고 손으로 배치. 몇 채씩 붙어 있는 동네와 외따로 떨어진 집이 섞여 있다.
// [종류, 중심에서 x, 중심에서 z, 크기, 지붕, 방향 틀기(라디안)]
const SPOTS = [
  // 광장 서쪽: 길가에 늘어선 세 채 (바짝 붙음)
  ['C', -35, -9, 1.00, 'roofNavy', 0.10],
  ['A', -33, -24, 0.95, 'roofRed', -0.15],
  ['D', -46, -33, 1.05, 'roofBrown', 0.30],
  // 광장 동쪽: 두 채가 어깨를 맞대고, 탑은 조금 떨어져 있음
  ['D', 34, -12, 1.00, 'roofBrown', -0.12],
  ['A', 36, 2, 1.05, 'roofNavy', 0.08],
  ['B', 31, 24, 1.00, 'roofNavy', 0.0],
  // 북쪽 멀리: 띄엄띄엄
  ['A', 12, -49, 1.00, 'roofRed', 0.20],
  ['C', -14, -66, 0.95, 'roofNavy', -0.25],
  ['B', 52, -52, 0.90, 'roofNavy', 0.15],
  // 동쪽 외곽: 서로 붙은 한 쌍 + 홀로 있는 오두막
  ['C', 66, -26, 1.00, 'roofNavy', 0.05],
  ['D', 79, -10, 1.00, 'roofRed', -0.35],
  // 서쪽 외곽
  ['A', -70, 6, 1.00, 'roofBrown', 0.20],
  ['B', -66, 34, 0.92, 'roofNavy', -0.10],
  // 여관 뒤쪽 멀리
  ['D', 48, 66, 1.00, 'roofBrown', -0.2],
];
SPOTS.forEach(([t, x, z, k, roof, yaw], i) => place(t, VX + x, VZ + z, k, 200 + i, roof, yaw));

export const BUILDING_BOXES = OBBS;   // 테스트용

// 월드 좌표 (x,z)에서 상자까지의 가장 가까운 점 (로컬 좌표) 계산
function local(o, x, z) {
  const dx = x - o.cx, dz = z - o.cz;
  return [dx * o.c - dz * o.s, dx * o.s + dz * o.c];
}

// 건물에서 margin 안쪽이면 true (자연 오브젝트 배치에서 건물 자리를 비울 때 사용)
export function nearBuilding(x, z, margin = 0) {
  if ((x - VX) ** 2 + (z - VZ) ** 2 > LAYOUT_RADIUS * LAYOUT_RADIUS) return false;
  for (const o of OBBS) {
    const [lx, lz] = local(o, x, z);
    const ex = Math.max(Math.abs(lx) - o.hw, 0), ez = Math.max(Math.abs(lz) - o.hd, 0);
    if (ex * ex + ez * ez < margin * margin) return true;
  }
  return false;
}

// ---------- 문 ----------
export function isDoorOpen(i) { return !!DOOR_OPEN[i]; }
export function setDoorOpen(i, open) { if (Number.isInteger(i) && i >= 0 && i < HOUSES.length) DOOR_OPEN[i] = !!open; }
export function openDoorList() { const out = []; DOOR_OPEN.forEach((o, i) => { if (o) out.push(i); }); return out; }

// 문 한가운데(벽 위) 월드 좌표 + 바깥쪽 방향
export function doorInfo(i) {
  const h = HOUSES[i], R = ROOM[h.type], sn = Math.sin(h.rot), cs = Math.cos(h.rot);
  return { x: h.x + sn * (R.d / 2) * h.k, z: h.z + cs * (R.d / 2) * h.k, nx: sn, nz: cs, reach: h.type === 'INN' ? 4.8 : 3.3 };
}
// 플레이어 가까이에 있는 문 (없으면 -1)
export function nearestDoor(x, z) {
  let best = -1, bd = 1e9;
  for (let i = 0; i < HOUSES.length; i++) {
    const b = HBOUND[i];
    if ((x - b.x) ** 2 + (z - b.z) ** 2 > (b.r + 6) ** 2) continue;
    const d = doorInfo(i), dist = Math.hypot(x - d.x, z - d.z);
    if (dist < d.reach && dist < bd) { bd = dist; best = i; }
  }
  return best;
}

// ---------- 방 안 판정 / 카메라 ----------
function toLocal(i, x, z) {
  const h = HOUSES[i], dx = x - h.x, dz = z - h.z, c = Math.cos(h.rot), s = Math.sin(h.rot);
  return [(dx * c - dz * s) / h.k, (dx * s + dz * c) / h.k];
}
function fromLocal(i, lx, lz) {
  const h = HOUSES[i], c = Math.cos(h.rot), s = Math.sin(h.rot);
  return [h.x + (lx * c + lz * s) * h.k, h.z + (-lx * s + lz * c) * h.k];
}
// (x,z) 가 어느 집 방 안이면 그 집 번호, 아니면 -1
export function houseAt(x, z) {
  if ((x - VX) ** 2 + (z - VZ) ** 2 > LAYOUT_RADIUS * LAYOUT_RADIUS) return -1;
  for (let i = 0; i < HOUSES.length; i++) {
    const b = HBOUND[i];
    if ((x - b.x) ** 2 + (z - b.z) ** 2 > b.r * b.r) continue;
    const R = ROOM[HOUSES[i].type], [lx, lz] = toLocal(i, x, z);
    if (Math.abs(lx) < R.w / 2 - 0.15 && Math.abs(lz) < R.d / 2 - 0.15) return i;
  }
  return -1;
}
// 방 안에 있을 때 카메라가 벽/천장 밖으로 나가지 않게 가둔다
const _cam = { x: 0, y: 0, z: 0 };
export function clampCameraInRoom(i, x, y, z, groundY) {
  const h = HOUSES[i], R = ROOM[h.type], [lx, lz] = toLocal(i, x, z), pad = 0.45;
  const mx = R.w / 2 - 0.25 - pad, mz = R.d / 2 - 0.25 - pad;
  const [wx, wz] = fromLocal(i, Math.max(-mx, Math.min(mx, lx)), Math.max(-mz, Math.min(mz, lz)));
  _cam.x = wx; _cam.z = wz;
  _cam.y = Math.max(groundY + 0.5, Math.min(y, groundY + (R.h - 0.8) * h.k));
  return _cam;
}
// 방 가운데 위쪽 (실내 조명 위치)
export function roomLight(i) {
  const h = HOUSES[i], R = ROOM[h.type];
  return { x: h.x, z: h.z, y: (R.h - 1.2) * h.k, big: h.type === 'INN' };
}

// 반지름 pr 인 플레이어가 건물과 겹치면 밖으로 밀어낸다 (벽/가구를 따라 미끄러짐)
const _out = { x: 0, z: 0 };
export function collideBuildings(x, z, pr = 0.4) {
  _out.x = x; _out.z = z;
  if ((x - VX) ** 2 + (z - VZ) ** 2 > LAYOUT_RADIUS * LAYOUT_RADIUS) return _out;
  for (let i = 0; i < HOUSES.length; i++) {
    const b = HBOUND[i];
    if ((x - b.x) ** 2 + (z - b.z) ** 2 > (b.r + pr + 1) ** 2) continue;
    const cols = HCOLS[i];
    for (let pass = 0; pass < 3; pass++) {
      let hit = false;
      for (const o of cols) {
        if (o.door >= 0 && DOOR_OPEN[o.door]) continue;
        const [lx, lz] = local(o, _out.x, _out.z);
        const qx = Math.max(-o.hw, Math.min(o.hw, lx)), qz = Math.max(-o.hd, Math.min(o.hd, lz));
        const ex = lx - qx, ez = lz - qz, d2 = ex * ex + ez * ez;
        if (d2 >= pr * pr) continue;
        let nx, nz;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = qx + (ex / d) * pr; nz = qz + (ez / d) * pr;
        } else {                                   // 상자 안쪽 → 가까운 면으로 빼냄
          const px = o.hw - Math.abs(lx), pz = o.hd - Math.abs(lz);
          if (px < pz) { nx = Math.sign(lx || 1) * (o.hw + pr); nz = lz; }
          else { nz = Math.sign(lz || 1) * (o.hd + pr); nx = lx; }
        }
        _out.x = o.cx + nx * o.c + nz * o.s;
        _out.z = o.cz - nx * o.s + nz * o.c;
        hit = true;
      }
      if (!hit) break;
    }
  }
  return _out;
}
