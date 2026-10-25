import { VILLAGE } from './terrain.js';

// 마을 건물 배치 + 집 안(방) + 문 + 충돌 (THREE 의존 없음 → 서버/테스트에서도 import 가능)
//
// ■ 구조
//  - 마을 집(여관 제외)은 겉모습만 있는 장식 건물. 문을 열면 안쪽은 검은색이고, "집 들어가기"를 누르면
//    땅 밑 멀리 있는 방(ROOMS)으로 순간이동한다. 방은 집 겉모습의 2.5배 크기(가로·세로·높이). 방 안 출구에서 "밖으로 나가기".
//  - 여관 1층은 진짜 실내(문을 열고 걸어 들어감). 계단은 서쪽 벽에 있고, 계단 앞에서 "계단 올라가기"를 누르면
//    2층 복도 방(기존 복도의 2배)으로 이동. 복도의 방문마다 "집 들어가기"로 객실 방에 들어감.
//  - 방의 창문은 실제 바깥 풍경이 보임: 방마다 마을 바깥 둘레(RING_R)에 "유령 위치"를 정해 두고,
//    그 위치에서 본 실제 월드를 창문 자리에 그려 넣는다 (main.js 의 포털 렌더링).
//
// 건물 로컬 좌표: x = 오른쪽, z = 앞쪽(문이 있는 쪽). 건물은 항상 마을 중앙(광장)을 바라보게 놓인다.
// 시작 지점(0,0)은 광장 한가운데이고, 시작 시 -z 방향을 보고 있으므로 "뒤편" = +z 쪽.

const TAU = Math.PI * 2;
export const INN_DIST = 47;          // 여관: 시작 지점에서 +z(뒤편)로 47칸
export const LAYOUT_RADIUS = 135;    // 이 밖에는 건물이 없음 (충돌 검사 빠른 탈출용)

// 건물 종류별 겉모습 충돌 상자 (로컬 좌표, 크기는 w x d)
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



// ---------- 건물(겉모습) 크기 ----------
// w, d = 벽 중심선 기준 크기, h = 1층 높이, dw/dh = 겉모습 문 너비/높이. 문은 항상 앞쪽(+z) 벽 가운데.
export const ROOM = {
  A: { w: 8.4, d: 7.4, h: 3.8, dw: 1.7, dh: 2.9 },
  B: { w: 6.4, d: 6.4, h: 4.0, dw: 1.7, dh: 2.9 },
  C: { w: 11.6, d: 8.8, h: 4.2, dw: 1.8, dh: 2.9 },
  D: { w: 7.8, d: 6.8, h: 3.6, dw: 1.6, dh: 2.8 },
  INN: { w: 30, d: 18, h: 5.0, dw: 3.0, dh: 3.8 },
};
const WALL_T = 0.3;            // 벽 충돌 반두께
export const FLOOR_Y = 0.05;   // 바닥 윗면 높이 (땅 기준)
export const ROOM_Y = -400;    // 방은 땅 밑 이 높이부터 100칸씩 아래로 쌓여 있음 → 땅 위에서는 안 보임
const ROOM_GAP = 100;
const RING_R = 128;            // 창밖 풍경용 유령 위치: 마을 중심에서 이만큼 떨어진 둘레

// ---------- 방(집 안 공간) 크기: 겉모습의 2.5배 (가로·세로·높이), 복도는 기존 복도의 2배 ----------
const SC = 2.5;
const OLD_GUEST = { w: 8.0, d: 6.4, h: 3.6 };
export const INT = {};
for (const [t, o] of [['A', ROOM.A], ['B', ROOM.B], ['C', ROOM.C], ['D', ROOM.D], ['GUEST', OLD_GUEST]]) {
  INT[t] = { w: o.w * SC, d: o.d * SC, h: o.h * SC, ew: 3.4, eh: 5.8, exitWall: 'f' };   // ew/eh = 나가는 문 크기
}
INT.CORR = { w: 59, d: 8, h: 8, ew: 3.4, eh: 5.8, exitWall: 'r' };   // 기존 복도(29.5 x 4 x 4)의 2배. 출구(계단 내려가기)는 동쪽 끝

// 여관 1층 안: 계단은 서쪽(-x) 벽을 따라 있음. 계단 꼭대기는 벽 + 문(장식)이고, 계단 앞 안내로 복도 방에 이동
export const INN2 = {
  stairs: { x0: -14.75, x1: -12.0, zb: 7.0, zt: 2.0, n: 14 },
  floorY: 5.05,                       // 계단 꼭대기 층 높이 (장식)
  h: 4.0,
  doorW: 3.2, doorH: 5.6,             // 복도 방문 크기 (복도가 2배라서 문도 2배)
  doorX: [-21, -7, 7, 21],            // 복도 양쪽 방문 위치 (복도 중심 기준 x)
};

// ---------- 방 가구 ----------
// 좌표는 방 중심 기준 (x 오른쪽, z 앞쪽), 앞면 +z. ry = 회전, solid=false 면 통과 가능. 의자는 앉는 사람이 +z 쪽을 바라봄.
const PI = Math.PI;
const NS = false;   // not solid
const BASE = {
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
    { k: 'wardrobe', x: 14.35, z: 0.2, ry: -PI / 2, w: 2.4, d: 0.8 },
    { k: 'chest', x: 14.3, z: -2.6, ry: -PI / 2, w: 1.2, d: 0.7 },
    { k: 'shelf', x: 14.5, z: 3.0, ry: -PI / 2, w: 3.0, d: 0.5 },
    { k: 'shelf', x: 14.5, z: 6.4, ry: -PI / 2, w: 3.0, d: 0.5 },
    { k: 'lamp', x: 14.1, z: 8.2, w: 0.5, d: 0.5 },
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
    { k: 'sconce', x: 14.73, z: -3.8, ry: -PI / 2, solid: NS },
    { k: 'sconce', x: -14.73, z: -1.0, ry: PI / 2, solid: NS },
  ],
  GUEST: [
    { k: 'bed', x: 2.55, z: -1.45, w: 1.7, d: 3.0, cloth: 'clothB' },
    { k: 'stand', x: 1.0, z: -2.65, w: 0.55, d: 0.55 },
    { k: 'rug', x: 0, z: 0.5, w: 3.0, d: 2.4, solid: NS },
    { k: 'table', x: -2.4, z: 0.1, w: 1.4, d: 0.9 },
    { k: 'chair', x: -2.4, z: 1.1, ry: PI, w: 0.55, d: 0.55 },
    { k: 'wardrobe', x: -3.35, z: -1.9, ry: PI / 2, w: 2.0, d: 0.8 },
    { k: 'lamp', x: 3.3, z: 2.4, w: 0.5, d: 0.5 },
    { k: 'chandelier', x: 0, z: 0.4, solid: NS },
    { k: 'sconce', x: -1.8, z: 2.93, ry: PI, solid: NS },
  ],
};

function itemRect(it) {
  const a = it.ry || 0, c = Math.cos(a), s = Math.sin(a), w = it.w || 0.5, d = it.d || 0.5;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = it.x + u * (w / 2) * c + v * (d / 2) * s, z = it.z - u * (w / 2) * s + v * (d / 2) * c;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return { x0, x1, z0, z1 };
}
// BASE 는 원래 좁은 방 기준 배치. 방이 커졌으므로: 벽에 붙어 있던 가구는 새 벽에 다시 붙이고, 가운데 가구는 위치를 2.5배로 벌린 뒤 extras 로 더 채운다.
function bigLayout(type, o, extras) {
  const n = INT[type], ohx = o.w / 2 - 0.25, ohz = o.d / 2 - 0.25, nhx = n.w / 2 - 0.25, nhz = n.d / 2 - 0.25, SNAP = 0.9;
  const base = BASE[type];
  const moved = base.map(it => {
    const r = itemRect(it), gl = r.x0 + ohx, gr = ohx - r.x1, gb = r.z0 + ohz, gf = ohz - r.z1;
    let x = it.x * SC, z = it.z * SC;
    if (gl < SNAP && gl <= gr) x = it.x + (-nhx + gl - r.x0); else if (gr < SNAP) x = it.x + (nhx - gr - r.x1);
    if (gb < SNAP && gb <= gf) z = it.z + (-nhz + gb - r.z0); else if (gf < SNAP) z = it.z + (nhz - gf - r.z1);
    return { x, z };
  });
  // 의자/의자 모양은 탁자를, 협탁은 침대를 따라감 (같이 움직여야 짝이 안 흩어짐)
  const FOLLOW = { chair: ['table', 'round', 'desk', 'bar'], stool: ['table', 'round', 'desk', 'bar'], stand: ['bed'] };
  base.forEach((it, i) => {
    const kinds = FOLLOW[it.k];
    if (!kinds) return;
    let best = -1, bd = 1e9;
    base.forEach((a2, j) => { if (!kinds.includes(a2.k)) return; const d = Math.hypot(a2.x - it.x, a2.z - it.z); if (d < bd) { bd = d; best = j; } });
    if (best >= 0 && bd < 3.2) moved[i] = { x: it.x + (moved[best].x - base[best].x), z: it.z + (moved[best].z - base[best].z) };
  });
  const out = base.map((it, i) => {
    const q = { ...it, x: moved[i].x, z: moved[i].z };
    if (it.k === 'rug') { q.w = it.w * SC; q.d = it.d * SC; }
    if (it.k === 'sconce') q.y = 4.4;
    return q;
  });
  return out.concat(extras || []);
}

// 추가 가구 (방 크기에 맞게 더 채움)
// 탁자 + 의자 4개 + 러그 + 샹들리에 한 세트
function tableSet(x, z, w = 2.2, d = 1.2, rug = true) {
  const out = [];
  if (rug) out.push({ k: 'rug', x, z, w: w + 3.6, d: d + 3.6, solid: NS });
  out.push({ k: 'table', x, z, w, d });
  for (const dx of [-w / 4, w / 4]) {
    out.push({ k: 'chair', x: x + dx, z: z - d / 2 - 0.45, w: 0.55, d: 0.55 });
    out.push({ k: 'chair', x: x + dx, z: z + d / 2 + 0.45, ry: PI, w: 0.55, d: 0.55 });
  }
  out.push({ k: 'chandelier', x, z, solid: NS });
  return out;
}
// 둥근 탁자 + 의자(스툴) 4개
function roundSet(x, z, w = 1.8) {
  return [
    { k: 'round', x, z, w, d: w },
    ...[[w / 2 + 0.7, 0], [-w / 2 - 0.7, 0], [0, w / 2 + 0.7], [0, -w / 2 - 0.7]].map(([dx, dz]) => ({ k: 'stool', x: x + dx, z: z + dz, w: 0.5, d: 0.5 })),
    { k: 'chandelier', x, z, solid: NS },
  ];
}
const SCONCE_FRONT = (xs, hw) => xs.map(x => ({ k: 'sconce', x, z: hw, ry: PI, y: 4.4, solid: NS }));

// 추가 가구 (방이 2.5배로 커졌으니 더 채움)
const EXTRAS = {
  A: [
    { k: 'bed', x: 6.0, z: -7.4, w: 1.7, d: 3.0, cloth: 'clothB' },
    { k: 'shelf', x: 10.0, z: -1.0, ry: -PI / 2, w: 3.4, d: 0.5 },
    { k: 'shelf', x: 10.0, z: 3.0, ry: -PI / 2, w: 3.4, d: 0.5 },
    ...tableSet(4.5, 4.5, 2.2, 1.2),
    { k: 'wardrobe', x: -6.8, z: -8.55, w: 2.4, d: 0.8 },
    { k: 'desk', x: -6.8, z: 7.2, ry: PI, w: 2.2, d: 1.0 },
    { k: 'chair', x: -6.8, z: 6.0, w: 0.55, d: 0.55 },
    { k: 'chest', x: -9.7, z: 4.8, ry: PI / 2, w: 1.2, d: 0.7 },
    { k: 'lamp', x: -9.5, z: 8.0, w: 0.5, d: 0.5 },
    { k: 'lamp', x: 9.4, z: -3.4, w: 0.5, d: 0.5 },
    ...SCONCE_FRONT([-5.5, 5.5], 9.0),
  ],
  D: [
    { k: 'bed', x: -8.55, z: 5.2, w: 1.7, d: 3.0, cloth: 'clothR' },
    { k: 'shelf', x: -5.5, z: -7.95, w: 3.2, d: 0.5 },
    { k: 'shelf', x: 9.2, z: 2.0, ry: -PI / 2, w: 3.0, d: 0.5 },
    ...tableSet(-1.5, 4.2, 1.8, 1.1),
    { k: 'chest', x: 8.9, z: -2.5, ry: -PI / 2, w: 1.2, d: 0.7 },
    { k: 'barrel', x: 8.7, z: 5.6, w: 0.9, d: 0.9 },
    { k: 'lamp', x: -8.8, z: -3.5, w: 0.5, d: 0.5 },
    ...SCONCE_FRONT([-4.5, 4.5], 8.0),
  ],
  B: [
    { k: 'shelf', x: -7.5, z: -4.6, ry: PI / 2, w: 3.0, d: 0.5 },
    { k: 'shelf', x: 7.5, z: -4.6, ry: -PI / 2, w: 3.0, d: 0.5 },
    { k: 'shelf', x: -7.5, z: 5.0, ry: PI / 2, w: 3.0, d: 0.5 },
    ...roundSet(4.6, 4.8, 1.8),
    { k: 'lamp', x: -5.5, z: 6.4, w: 0.5, d: 0.5 },
    { k: 'lamp', x: 5.8, z: -6.2, w: 0.5, d: 0.5 },
    ...SCONCE_FRONT([-5.0, 5.0], 7.5),
  ],
  C: [
    { k: 'bed', x: -0.5, z: -9.2, w: 1.7, d: 3.0, cloth: 'clothB' },
    { k: 'bed', x: 3.4, z: -9.2, w: 1.7, d: 3.0, cloth: 'clothR' },
    { k: 'stand', x: 1.45, z: -10.4, w: 0.55, d: 0.55 },
    { k: 'shelf', x: 13.95, z: -6.5, ry: -PI / 2, w: 3.4, d: 0.5 },
    { k: 'shelf', x: 13.95, z: 6.6, ry: -PI / 2, w: 3.4, d: 0.5 },
    ...tableSet(6.5, 0.5, 2.6, 1.3),
    ...roundSet(-9.5, 6.8, 1.8),
    { k: 'desk', x: -2.5, z: 9.6, ry: PI, w: 2.2, d: 1.0 },
    { k: 'chair', x: -2.5, z: 8.5, w: 0.55, d: 0.55 },
    { k: 'lamp', x: -13.2, z: -4.2, w: 0.5, d: 0.5 },
    { k: 'lamp', x: 13.2, z: -9.8, w: 0.5, d: 0.5 },
    ...SCONCE_FRONT([-8.0, 8.0], 10.75),
  ],
  GUEST: [
    { k: 'bed', x: 5.9, z: -6.2, w: 1.7, d: 3.0, cloth: 'clothR' },
    { k: 'shelf', x: 0, z: -7.5, w: 3.4, d: 0.5 },
    { k: 'fireplace', x: 9.2, z: 1.0, ry: -PI / 2, w: 2.8, d: 1.1 },
    ...roundSet(-5.5, -3.0, 1.6),
    { k: 'desk', x: -6.5, z: 6.6, ry: PI, w: 2.0, d: 1.0 },
    { k: 'chair', x: -6.5, z: 5.5, w: 0.55, d: 0.55 },
    { k: 'chest', x: 9.0, z: 5.5, ry: -PI / 2, w: 1.2, d: 0.7 },
    ...SCONCE_FRONT([-4.5, 4.5], 8.0),
  ],
};

// 복도 방(가로 59 x 세로 8 x 높이 8): 긴 벽(북 z=-4, 남 z=+4)에 방문 4개씩, 문 사이에 큰 창
const CORR_DOOR_X = INN2.doorX;
const CORR_ITEMS = [
  { k: 'rug', x: 0, z: 0, w: 52, d: 3.6, solid: NS },
  ...[-21, -7, 7, 21].map(x => ({ k: 'chandelier', x, z: 0, solid: NS })),
  ...CORR_DOOR_X.flatMap(x => [
    { k: 'sconce', x: x + 3.2, z: -3.73, y: 4.4, solid: NS },
    { k: 'sconce', x: x + 3.2, z: 3.73, ry: PI, y: 4.4, solid: NS },
  ]),
  { k: 'lamp', x: -27.6, z: -2.6, w: 0.5, d: 0.5 }, { k: 'lamp', x: -27.6, z: 2.6, w: 0.5, d: 0.5 },
  { k: 'stand', x: -14, z: -3.3, w: 0.55, d: 0.55 }, { k: 'stand', x: 0, z: 3.3, ry: PI, w: 0.55, d: 0.55 },
  { k: 'stand', x: 14, z: -3.3, w: 0.55, d: 0.55 }, { k: 'stand', x: -14, z: 3.3, ry: PI, w: 0.55, d: 0.55 },
  { k: 'chest', x: 0, z: -3.2, w: 1.4, d: 0.8 }, { k: 'chest', x: 14, z: 3.2, ry: PI, w: 1.4, d: 0.8 },
];

export const INTERIOR = {
  A: bigLayout('A', ROOM.A, EXTRAS.A),
  B: bigLayout('B', ROOM.B, EXTRAS.B),
  C: bigLayout('C', ROOM.C, EXTRAS.C),
  D: bigLayout('D', ROOM.D, EXTRAS.D),
  GUEST: bigLayout('GUEST', OLD_GUEST, EXTRAS.GUEST),
  CORR: CORR_ITEMS,
  INN: BASE.INN,        // 여관 1층은 진짜 실내라서 크기를 키우지 않음
};

export const HOUSES = [];   // { type, x, z, rot, k, seed, roof }
const OBBS = [];            // 겉모습 전체 상자 (자연 오브젝트 비우기용)
export const DOORS = [];    // { id, kind: 'house'|'inn'|'room', house, x, z, y, nx, nz, reach, room }
export const ROOMS = [];    // { id, door, type, R, x, y, z, ghost, windows, cols, items, ret, exitWall }
const HCOLS = [];           // 집별 충돌 상자
const HBOUND = [];          // 집별 대략적인 범위 { x, z, r }
const DOOR_OPEN = [];       // 문별 열림 상태

// 여관의 탑/별관은 들어갈 수 없는 덩어리 (본관 벽 바깥쪽에 맞춰 줄여 둠)
const SOLID_EXTRA = { INN: [{ x: -19.1, z: 4.6, w: 7.2, d: 9 }, { x: 19.75, z: 4.7, w: 8.5, d: 8.8 }] };

function place(type, x, z, k, seed, roof, yaw = 0) {
  // 로컬 +z 가 (sinθ, cosθ) 를 향함 → 기본은 광장 쪽을 보고, yaw 만큼 살짝 틀어서 자연스럽게
  const rot = Math.atan2(VILLAGE.x - x, VILLAGE.z - z) + yaw;
  HOUSES.push({ type, x, z, rot, k, seed, roof });
  const i = HOUSES.length - 1;
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const f of FOOT[type]) {
    OBBS.push({
      cx: x + (f.x * c + f.z * s) * k, cz: z + (-f.x * s + f.z * c) * k,
      hw: (f.w * k) / 2, hd: (f.d * k) / 2, c, s,
    });
  }
  buildColliders(i);
  const R = ROOM[type];
  DOORS.push({
    id: DOORS.length, kind: type === 'INN' ? 'inn' : 'house', house: i,
    x: x + Math.sin(rot) * (R.d / 2) * k, z: z + Math.cos(rot) * (R.d / 2) * k, y: VILLAGE.h,
    nx: Math.sin(rot), nz: Math.cos(rot), reach: type === 'INN' ? 4.8 : 3.3, room: -1,
  });
  DOOR_OPEN[DOORS.length - 1] = false;
}

// ---------- 충돌 상자 (땅 위 건물) ----------
function boxFor(h, lx, lz, w, d, yaw = 0, door = -1) {
  const k = h.k, c0 = Math.cos(h.rot), s0 = Math.sin(h.rot), th = h.rot + yaw;
  return {
    cx: h.x + (lx * c0 + lz * s0) * k, cz: h.z + (-lx * s0 + lz * c0) * k,
    hw: (w * k) / 2, hd: (d * k) / 2, c: Math.cos(th), s: Math.sin(th), door,
  };
}

function buildColliders(i) {
  const h = HOUSES[i], R = ROOM[h.type], list = [];
  if (h.type !== 'INN') {
    // 장식 건물: 겉모습 전체가 단단한 덩어리
    for (const f of FOOT[h.type]) list.push(boxFor(h, f.x, f.z, f.w, f.d));
  } else {
    // 여관 1층: 속이 빈 상자 (앞벽 가운데만 문 구멍, 문이 닫혀 있으면 구멍도 막힘)
    const W = R.w, D = R.d, DW = R.dw, T = WALL_T * 2;
    list.push(boxFor(h, 0, -D / 2, W + T, T));
    list.push(boxFor(h, -W / 2, 0, T, D + T), boxFor(h, W / 2, 0, T, D + T));
    const x0 = -W / 2 - WALL_T, x1 = -DW / 2;
    list.push(boxFor(h, (x0 + x1) / 2, D / 2, x1 - x0, T), boxFor(h, -(x0 + x1) / 2, D / 2, x1 - x0, T));
    list.push(boxFor(h, 0, D / 2, DW + 0.1, T * 0.8, 0, 0));       // 문(닫힘) - 열리면 무시. 문 번호 0
    for (const e of SOLID_EXTRA.INN) list.push(boxFor(h, e.x, e.z, e.w, e.d));
    for (const it of INTERIOR.INN) {
      if (it.solid === false) continue;
      const q = it.k === 'chair' || it.k === 'stool' ? 0.1 : 0;
      list.push(boxFor(h, it.x, it.z, it.w - q, it.d - q, it.ry || 0));
    }
    const S = INN2.stairs;                                          // 계단: 올라갈 수 없는 장식 → 단단한 덩어리
    list.push(boxFor(h, (S.x0 + S.x1) / 2, (S.zt - 0.5 + S.zb) / 2, S.x1 - S.x0, S.zb - S.zt + 0.5));
  }
  HCOLS[i] = list;
  let r = 0;
  for (const o of list) r = Math.max(r, Math.hypot(o.cx - h.x, o.cz - h.z) + Math.hypot(o.hw, o.hd));
  HBOUND[i] = { x: h.x, z: h.z, r };
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


// ---------- 방(집 안 공간) ----------
// 장식 건물/객실 문 하나당 방 하나 + 복도 방 하나. 땅 밑에 100칸 간격으로 쌓여 있음 (위로 안 보임).
// 방의 (x,z) 는 마을 바깥 둘레(RING_R)의 "유령 위치" 바로 아래. 창문은 그 유령 위치에서 본 실제 월드를 보여줌.
const TALL = new Set(['shelf', 'wardrobe', 'fireplace', 'backbar', 'stove']);

// 창문 위치 자동 배치: 키 큰 가구/촛대와 겹치지 않는 곳에만. t = 벽을 따라간 방 좌표(b/f 벽은 x, l/r 벽은 z)
function genWindows(type) {
  const R = INT[type], items = INTERIOR[type], out = [];
  const rects = items.filter(it => TALL.has(it.k)).map(it => ({ ...itemRect(it), near: 2.2 }))
    .concat(items.filter(it => it.k === 'sconce').map(it => ({ ...itemRect({ ...it, w: 1.4, d: 0.3 }), near: 0.6 })));
  const walls = [
    { id: 'b', L: R.w, dist: r => r.z0 + R.d / 2, lo: r => r.x0, hi: r => r.x1 },
    { id: 'f', L: R.w, dist: r => R.d / 2 - r.z1, lo: r => r.x0, hi: r => r.x1 },
    { id: 'l', L: R.d, dist: r => r.x0 + R.w / 2, lo: r => r.z0, hi: r => r.z1 },
    { id: 'r', L: R.d, dist: r => R.w / 2 - r.x1, lo: r => r.z0, hi: r => r.z1 },
  ];
  const w = 2.6, h = Math.max(2.4, Math.min(5.0, R.h - 4.2)), v = 2.3, half = w / 2 + 0.5;
  for (const wl of walls) {
    const L = wl.L, ts = L >= 20 ? [-0.3 * L, 0, 0.3 * L] : L >= 14 ? [-0.25 * L, 0.25 * L] : [0];
    for (const t of ts) {
      if (wl.id === 'f' && Math.abs(t) < R.ew / 2 + 2.2) continue;
      if (rects.some(r => wl.dist(r) < r.near && wl.lo(r) < t + half && wl.hi(r) > t - half)) continue;
      out.push({ wall: wl.id, t, v, w, h, kind: type === 'C' ? 's' : 'g' });
    }
  }
  return out;
}
// 복도 창문: 긴 벽 양쪽 문 사이 + 서쪽 끝
function corrWindows() {
  const out = [];
  for (const wall of ['b', 'f']) for (const t of [-14, 0, 14]) out.push({ wall, t, v: 2.2, w: 2.8, h: 4.6, kind: 'g' });
  out.push({ wall: 'l', t: 0, v: 2.2, w: 3.2, h: 4.6, kind: 'g' });
  return out;
}

function buildRoomCols(m) {
  const R = m.R, W = R.w, D = R.d, T = WALL_T * 2, list = [];
  const add = (lx, lz, w, d, yaw = 0) => list.push({ cx: m.x + lx, cz: m.z + lz, hw: w / 2, hd: d / 2, c: Math.cos(yaw), s: Math.sin(yaw), door: -1 });
  add(0, -D / 2, W + T, T); add(0, D / 2, W + T, T); add(-W / 2, 0, T, D + T); add(W / 2, 0, T, D + T);
  for (const it of m.items) {
    if (it.solid === false) continue;
    const q = it.k === 'chair' || it.k === 'stool' ? 0.1 : 0;
    add(it.x, it.z, it.w - q, it.d - q, it.ry || 0);
  }
  m.cols = list;
}

// 방 하나 만들기. alpha = 창밖 풍경을 볼 유령 위치의 각도 (마을 중심 기준)
function addRoom(type, alpha, door) {
  const id = ROOMS.length, R = INT[type], ax = VX + RING_R * Math.cos(alpha), az = VZ + RING_R * Math.sin(alpha);
  const m = {
    id, door, type, R, x: ax, y: ROOM_Y - ROOM_GAP * id, z: az, items: INTERIOR[type], exitWall: R.exitWall, ret: null,
    // 유령 위치: 방 중심이 마을 둘레 (ax, 땅, az) 에 있다고 치고, 방 앞(+z)이 마을 중앙을 보도록 돌려 놓음
    ghost: { x: ax, y: VILLAGE.h, z: az, rot: Math.atan2(-Math.cos(alpha), -Math.sin(alpha)) },
    windows: [], cols: [],
  };
  m.windows = type === 'CORR' ? corrWindows() : genWindows(type);
  buildRoomCols(m);
  ROOMS.push(m);
  return m;
}
const polar = h => Math.atan2(h.z - VZ, h.x - VX);

// 장식 건물마다 방 하나
for (const d of DOORS.slice()) {
  if (d.kind !== 'house') continue;
  const h = HOUSES[d.house], m = addRoom(h.type, polar(h), d.id);
  d.room = m.id;
  m.ret = { to: 'world', x: d.x + d.nx * 2.2, y: d.y, z: d.z + d.nz * 2.2, yaw: Math.atan2(-d.nx, -d.nz) };   // 문 앞으로 돌아옴
}

// 여관 2층 복도 방 + 방문마다 객실 방
const innH = HOUSES[0], innAlpha = polar(innH);
export const CORR_ROOM = addRoom('CORR', innAlpha, -1);
{
  const S = INN2.stairs, lx = (S.x0 + S.x1) / 2, lz = S.zb + 0.9, c = Math.cos(innH.rot), s = Math.sin(innH.rot);
  CORR_ROOM.ret = {   // 복도 → 계단 내려가기: 여관 1층 계단 앞
    to: 'world', x: innH.x + (lx * c + lz * s) * innH.k, z: innH.z + (-lx * s + lz * c) * innH.k, y: VILLAGE.h,
    yaw: Math.atan2(-s, -c),
  };
}
for (const side of [-1, 1]) for (const dx of INN2.doorX) {
  const R = CORR_ROOM.R, d = {
    id: DOORS.length, kind: 'room', house: 0, x: CORR_ROOM.x + dx, z: CORR_ROOM.z + side * R.d / 2, y: CORR_ROOM.y + FLOOR_Y,
    nx: 0, nz: -side, reach: 5.2, room: -1, lx: dx, side,
  };
  DOORS.push(d);
  DOOR_OPEN[d.id] = false;
  const g = addRoom('GUEST', innAlpha, d.id);
  d.room = g.id;
  g.ret = { to: 'room', room: CORR_ROOM.id, x: d.x, y: d.y, z: d.z + d.nz * 3.4, yaw: Math.atan2(-d.nx, -d.nz) };   // 복도 방문 앞으로 돌아옴
}

export const BUILDING_BOXES = OBBS;   // 테스트용

// ---------- 문 ----------
export function isDoorOpen(i) { return !!DOOR_OPEN[i]; }
export function setDoorOpen(i, open) { if (Number.isInteger(i) && i >= 0 && i < DOORS.length) DOOR_OPEN[i] = !!open; }
export function openDoorList() { const out = []; DOOR_OPEN.forEach((o, i) => { if (o) out.push(i); }); return out; }
export function doorInfo(i) { return DOORS[i]; }

// 플레이어(x,z,높이 y) 가까이에 있는 문 번호 (없으면 -1). 다른 층/방의 문은 높이로 걸러냄
export function nearestDoor(x, z, y) {
  let best = -1, bd = 1e9;
  for (const d of DOORS) {
    if (Math.abs(y - d.y) > 3.2) continue;
    const dist = Math.hypot(x - d.x, z - d.z);
    if (dist < d.reach && dist < bd) { bd = dist; best = d.id; }
  }
  return best;
}

// ---------- 방 안 (땅 밑 별도 공간) ----------
export function roomEntry(r) {
  const m = ROOMS[r], R = m.R, y = m.y + FLOOR_Y;
  return m.exitWall === 'r' ? { x: m.x + R.w / 2 - 3.6, y, z: m.z, yaw: Math.PI / 2 } : { x: m.x, y, z: m.z + R.d / 2 - 3.0, yaw: 0 };
}
export function roomExit(r) {   // 나가는 문 (복도는 동쪽 끝 = 계단 내려가기)
  const m = ROOMS[r], R = m.R, y = m.y + FLOOR_Y;
  return m.exitWall === 'r'
    ? { x: m.x + R.w / 2 - 0.25, y, z: m.z, reach: 5.0, text: '계단 내려가기' }
    : { x: m.x, y, z: m.z + R.d / 2 - 0.25, reach: 5.0, text: '밖으로 나가기' };
}
export function roomRet(r) { return ROOMS[r].ret; }
export function roomFloorY(r) { return ROOMS[r].y + FLOOR_Y; }
export function roomGhost(r) { const m = ROOMS[r]; return { room: { x: m.x, y: m.y, z: m.z }, ...m.ghost }; }
const _cr = { x: 0, y: 0, z: 0 };
export function clampCameraRoom(r, x, y, z) {
  const m = ROOMS[r], R = m.R, pad = 0.45;
  _cr.x = Math.max(m.x - (R.w / 2 - 0.25 - pad), Math.min(m.x + (R.w / 2 - 0.25 - pad), x));
  _cr.z = Math.max(m.z - (R.d / 2 - 0.25 - pad), Math.min(m.z + (R.d / 2 - 0.25 - pad), z));
  _cr.y = Math.max(m.y + FLOOR_Y + 0.5, Math.min(y, m.y + R.h - 0.8));
  return _cr;
}
export function roomLightPos(r) { const m = ROOMS[r]; return { x: m.x, y: m.y + m.R.h - 1.6, z: m.z, dist: Math.max(m.R.w, m.R.d) * 0.9 }; }

// ---------- 여관 (1층만 진짜 실내) ----------
function toLocal(i, x, z) {
  const h = HOUSES[i], dx = x - h.x, dz = z - h.z, c = Math.cos(h.rot), s = Math.sin(h.rot);
  return [(dx * c - dz * s) / h.k, (dx * s + dz * c) / h.k];
}
function fromLocal(i, lx, lz) {
  const h = HOUSES[i], c = Math.cos(h.rot), s = Math.sin(h.rot);
  return [h.x + (lx * c + lz * s) * h.k, h.z + (-lx * s + lz * c) * h.k];
}
// (x,z) 가 여관 안이면 집 번호(0), 아니면 -1
export function houseAt(x, z) {
  const b = HBOUND[0];
  if ((x - b.x) ** 2 + (z - b.z) ** 2 > b.r * b.r) return -1;
  const R = ROOM.INN, [lx, lz] = toLocal(0, x, z);
  return Math.abs(lx) < R.w / 2 - 0.15 && Math.abs(lz) < R.d / 2 - 0.15 ? 0 : -1;
}
// 여관 안 바닥 높이 (밖이면 null)
export function innFloor(x, z) { return houseAt(x, z) < 0 ? null : VILLAGE.h + FLOOR_Y; }
// 계단 앞 안내 (계단 올라가기): 월드 위치 + 안내가 뜰 높이
export function stairsInfo() {
  const S = INN2.stairs, [x, z] = fromLocal(0, (S.x0 + S.x1) / 2, S.zb + 0.6);
  return { x, z, y: VILLAGE.h, hy: VILLAGE.h + 2.0, reach: 4.0 };
}
// 여관 안에서 카메라를 벽/천장 밖으로 못 나가게 가둔다
const _cam = { x: 0, y: 0, z: 0 };
export function clampCameraInRoom(i, x, y, z, groundY) {
  const R = ROOM.INN, [lx, lz] = toLocal(i, x, z), pad = 0.45;
  const mx = R.w / 2 - 0.25 - pad, mz = R.d / 2 - 0.25 - pad;
  const [wx, wz] = fromLocal(i, Math.max(-mx, Math.min(mx, lx)), Math.max(-mz, Math.min(mz, lz)));
  _cam.x = wx; _cam.z = wz;
  _cam.y = Math.max(groundY + 0.5, Math.min(y, groundY + R.h - 0.8));
  return _cam;
}
// 방 안 조명 위치 (여관 1층)
export function roomLight(i) {
  return { x: HOUSES[i].x, z: HOUSES[i].z, y: ROOM.INN.h - 1.2, big: true };
}

// ---------- 충돌 ----------
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

const _out = { x: 0, z: 0 };
// 상자 목록과 부딪히면 밖으로 밀어낸다 (벽/가구를 따라 미끄러짐)
function pushOut(cols, pr) {
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

// 땅 위: 반지름 pr 인 플레이어가 건물과 겹치면 밖으로 밀어낸다
export function collideBuildings(x, z, pr = 0.4) {
  _out.x = x; _out.z = z;
  if ((x - VX) ** 2 + (z - VZ) ** 2 > LAYOUT_RADIUS * LAYOUT_RADIUS) return _out;
  for (let i = 0; i < HOUSES.length; i++) {
    const b = HBOUND[i];
    if ((x - b.x) ** 2 + (z - b.z) ** 2 > (b.r + pr + 1) ** 2) continue;
    pushOut(HCOLS[i], pr);
  }
  return _out;
}
// 방 안: 벽과 가구
export function collideRoom(r, x, z, pr = 0.4) {
  _out.x = x; _out.z = z;
  pushOut(ROOMS[r].cols, pr);
  return _out;
}
