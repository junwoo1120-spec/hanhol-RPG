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

// 반지름 pr 인 플레이어가 건물과 겹치면 밖으로 밀어낸다 (벽을 따라 미끄러짐)
const _out = { x: 0, z: 0 };
export function collideBuildings(x, z, pr = 0.4) {
  _out.x = x; _out.z = z;
  if ((x - VX) ** 2 + (z - VZ) ** 2 > LAYOUT_RADIUS * LAYOUT_RADIUS) return _out;
  for (let pass = 0; pass < 2; pass++) {
    let hit = false;
    for (const o of OBBS) {
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
  return _out;
}
