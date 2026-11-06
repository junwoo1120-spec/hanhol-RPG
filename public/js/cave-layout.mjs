// 지하 동굴 지도 (서버와 브라우저가 같이 쓰는 순수 계산 파일 — THREE 를 쓰지 않아요)
//
// - 동굴 입구는 평원 중반부 한 곳에 있고(findEntrance), 동굴 안은 그 입구 바로 밑 아주 깊은 곳(CAVE.Y)에 있어요.
//   땅 위 지형과는 전혀 상관없는 따로 떨어진 공간이라 입구에서 "동굴 들어가기"를 누르면 순간이동으로 들어가요 (집 안으로 들어가는 것과 같은 방식).
// - 모양은 둥근 방(chamber) 6개를 통로(tunnel)로 이은 형태. 방 경계는 울퉁불퉁하게 흔들어서 자연스럽게 만들어요.
// - 바닥/천장/벽 높이, 걸을 수 있는 범위, 기둥, 수정(빛), 골렘 시작 위치를 전부 여기서 정해요.

import { h32 } from './goblin-ai.mjs';

export const CAVE = {
  Y: -250,          // 동굴 바닥 높이 (땅 위 어디와도 겹치지 않게 아주 깊이)
  UNDER_Y: -100,    // 이보다 낮은 곳에 있으면 "지하"로 취급 (땅 위 몬스터는 지하 플레이어를 못 봄)
  TUNNEL_R: 5,      // 통로 반지름
  WALL_H: 9,        // 벽 근처 천장 높이
  HALL_H: 21,       // 방 한가운데 천장 높이
  CLOSE: 6,         // 벽이 바닥과 천장을 이어 닫히는 거리
};

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// 부드러운 값 노이즈 (같은 입력이면 항상 같은 값)
function vnoise(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = h32(xi, zi, s), b = h32(xi + 1, zi, s), c = h32(xi, zi + 1, s), d = h32(xi + 1, zi + 1, s);
  const top = a + (b - a) * u, bot = c + (d - c) * u;
  return top + (bot - top) * v;
}

// ---------- 입구 위치: 시작 마을에서 여관 반대편(앞쪽)으로 평원을 걸어 나가면 나오는 평평한 곳 ----------
// 여관은 시작 지점에서 +z(뒤편)에 있어요(village-layout.js INN_DIST). 그래서 동굴은 -z 쪽(앞)으로 약 330칸.
// 그 방향이 막혀 있으면(물·산 등) 가장 가까운 각도·거리의 평평한 평원을 골라요.
export const CAVE_DIR = { x: 0, z: -1 };      // 마을 중심에서 동굴 쪽 방향 (여관의 반대)
export const PIT_R = 8.5;                       // 땅 위 구멍(검은 원) 반지름. 이 안으로 뛰어들면 동굴로 들어가요
export function findEntrance(T, seed, WATER_LEVEL, VILLAGE) {
  const isPlain = (x, z) => {
    const h = T.height(x, z);
    if (h < WATER_LEVEL + 2.5) return false;
    const d = T.detail(x, z, h);
    return d[0] + d[1] > 0.9 && d[3] < 0.02;
  };
  const base = Math.atan2(CAVE_DIR.z, CAVE_DIR.x);
  const cand = [];
  for (let da = -40; da <= 40; da += 2) {
    for (let R = 290; R <= 430; R += 10) {
      const a = base + da * Math.PI / 180;
      cand.push({ x: Math.round(VILLAGE.x + Math.cos(a) * R), z: Math.round(VILLAGE.z + Math.sin(a) * R), score: Math.abs(da) * 0.6 + Math.abs(R - 330) * 0.05 });
    }
  }
  cand.sort((p, q) => p.score - q.score);
  for (const flat of [2.0, 3.2]) {      // 먼저 아주 평평한 곳, 없으면 조금 덜 평평한 곳
    for (const c of cand) {
      if (!isPlain(c.x, c.z)) continue;
      let ok = true, lo = T.height(c.x, c.z), hi = lo;
      for (let k = 0; k < 16 && ok; k++) {
        const px = c.x + Math.cos(k * Math.PI / 8) * 15, pz = c.z + Math.sin(k * Math.PI / 8) * 15;
        ok = isPlain(px, pz);
        const h = T.height(px, pz); lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      if (ok && hi - lo <= flat) return { x: c.x, z: c.z };
    }
  }
  return null;
}

// ---------- 동굴 종류별 설정 ----------
// makeCaveLayout(ent, seed, id) 가 id 번째 설정을 써요. 없는 id 는 0번(기본 동굴)으로 대신해요.
// (이 블록은 한 번 실수로 지워졌어서 0번만 처음 값 그대로 다시 적어 둠. 다른 종류가 있었다면 여기에 다시 추가해야 해요.)
const CAVE_VARIANTS = [
  {
    Y: CAVE.Y,
    // 방들 (지역 좌표: 입구 밑 방이 (0,0))
    rooms: [
      { id: 'entry', x: 0, z: 0, r: 22 },
      { id: 'hall', x: 62, z: 72, r: 50 },
      { id: 'west', x: -70, z: 52, r: 30 },
      { id: 'east', x: 128, z: 28, r: 28 },
      { id: 'south', x: 18, z: 158, r: 30 },
      { id: 'far', x: 124, z: 142, r: 26 },
    ],
    tunnels: [[0, 1], [0, 2], [1, 3], [1, 4], [1, 5], [2, 4]],
    pillarCount: { hall: 8, west: 3, east: 3, south: 3, far: 2 },
    perRoom: [4, 9, 4, 4, 4, 4],                                   // 방마다 수정 덩어리 수
    spawnCount: { hall: 8, west: 4, east: 3, south: 3, far: 2 },   // 골렘 20마리
    colors: [0x5fe3ff, 0x6a8cff, 0xb48cff, 0x62ffb8, 0x7fd0ff],    // 수정 색
  },
];

// ---------- 동굴 지도 ----------
export function makeCaveLayout(ent, seed, id = 0) {
  const V = CAVE_VARIANTS[id] || CAVE_VARIANTS[0];
  const sd = ((Number(seed) | 0) || 1) + id * 1000;
  const ox = ent.x, oz = ent.z, Y = V.Y;
  const TR = CAVE.TUNNEL_R;

  // 방들 (경계를 울퉁불퉁하게 만드는 값 p1,p2 를 붙임)
  const rooms = V.rooms.map((r, i) => ({ ...r, p1: h32(i, 1, sd + 11) * TAU, p2: h32(i, 2, sd + 11) * TAU }));
  const tunnels = V.tunnels;
  const hallRoom = rooms.find((r) => r.id === 'hall');

  const roomR = (d, th) => d.r * (1 + 0.11 * Math.sin(3 * th + d.p1) + 0.07 * Math.sin(5 * th + d.p2));
  function sdfL(x, z) {   // 경계까지의 거리 (음수 = 동굴 안쪽)
    let s = 1e9;
    for (const d of rooms) {
      const dx = x - d.x, dz = z - d.z;
      const v = Math.hypot(dx, dz) - roomR(d, Math.atan2(dz, dx));
      if (v < s) s = v;
    }
    for (const [i, j] of tunnels) {
      const a = rooms[i], b = rooms[j];
      const abx = b.x - a.x, abz = b.z - a.z;
      const t = clamp01(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz));
      const v = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)) - TR;
      if (v < s) s = v;
    }
    return s;
  }
  const sdf = (x, z) => sdfL(x - ox, z - oz);

  // 바닥 높이: 완만하게 울퉁불퉁
  const floorAt = (x, z) => {
    const lx = x - ox, lz = z - oz;
    return Y + 0.9 * (vnoise(lx * 0.045, lz * 0.045, sd + 1) - 0.5) + 0.3 * (vnoise(lx * 0.19, lz * 0.19, sd + 2) - 0.5);
  };
  // 눈에 보이는 바닥 / 천장 (벽 가까이에서 바닥은 솟고 천장은 내려와 CLOSE 거리에서 딱 만나 닫힘)
  const ceilTop = (lx, lz, s) => {
    const k = sstep(0, 14, -s);
    return Y + CAVE.WALL_H + (CAVE.HALL_H - CAVE.WALL_H) * k + 6.4 * (vnoise(lx * 0.06, lz * 0.06, sd + 3) - 0.5) * k;
  };
  function rockF(x, z) {
    const s = sdf(x, z), lx = x - ox, lz = z - oz, t = clamp01(s / CAVE.CLOSE), w = 1 - (1 - t) * (1 - t);
    const f = floorAt(x, z);
    return f + (Y + CAVE.WALL_H - f) * w + 1.4 * (vnoise(lx * 0.35, lz * 0.35, sd + 4) - 0.5) * w * (1 - t);
  }
  function rockC(x, z) {
    const s = sdf(x, z), lx = x - ox, lz = z - oz, t = clamp01(s / CAVE.CLOSE), w = t * t * (3 - 2 * t);
    const top = ceilTop(lx, lz, s);
    return top + (Y + CAVE.WALL_H - top) * w + 1.6 * (vnoise(lx * 0.3, lz * 0.3, sd + 5) - 0.5) * (1 - t);
  }
  const ceilAt = (x, z) => rockC(x, z);

  // ---- 기둥 (돌기둥) + 큰 수정 덩어리: 걸을 때 부딪힘 ----
  const pillars = [];
  const pillarCount = V.pillarCount;
  rooms.forEach((d, ri) => {
    const n = pillarCount[d.id] || 0;
    let tries = 0;
    for (let k = 0; k < n && tries < 200; tries++) {
      const a = h32(ri, tries, sd + 21) * TAU, rr = Math.sqrt(h32(ri, tries, sd + 22)) * d.r * 0.7;
      const x = ox + d.x + Math.cos(a) * rr, z = oz + d.z + Math.sin(a) * rr, pr = 1.1 + h32(ri, tries, sd + 23) * 1.0;
      if (sdf(x, z) > -12) continue;
      if (pillars.some((p) => Math.hypot(p.x - x, p.z - z) < 14)) continue;
      pillars.push({ x, z, r: pr, big: false }); k++;
    }
  });
  // 큰 수정 덩어리 (큰 방 가운데): 빛도 내고 길도 막음
  const bigX = ox + hallRoom.x + 8, bigZ = oz + hallRoom.z - 6;
  pillars.push({ x: bigX, z: bigZ, r: 2.2, big: true });

  // ---- 빛나는 수정 클러스터 ----
  const COLORS = V.colors;
  const crystals = [];
  const perRoom = V.perRoom;
  rooms.forEach((d, ri) => {
    for (let k = 0; k < perRoom[ri]; k++) {
      const th = (k + h32(ri, k, sd + 31) * 0.8) / perRoom[ri] * TAU;
      const inset = 2.4 + h32(ri, k, sd + 32) * 1.6;
      const x = ox + d.x + Math.cos(th) * (roomR(d, th) - inset), z = oz + d.z + Math.sin(th) * (roomR(d, th) - inset);
      crystals.push({ x, z, ci: ri === 0 ? 0 : Math.floor(h32(ri, k, sd + 33) * COLORS.length), size: 0.8 + h32(ri, k, sd + 34) * 0.9 });
    }
  });
  tunnels.forEach(([i, j], ti) => {   // 통로 중간 벽가에도 작은 수정
    const a = rooms[i], b = rooms[j];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len, side = h32(ti, 5, sd + 35) < 0.5 ? -1 : 1;
    crystals.push({ x: ox + mx + nx * side * (TR - 1.6), z: oz + mz + nz * side * (TR - 1.6), ci: Math.floor(h32(ti, 6, sd + 36) * COLORS.length), size: 0.7 });
  });
  crystals.push({ x: bigX, z: bigZ, ci: 0, size: 2.3, big: true });   // 큰 수정 (위 기둥과 같은 자리)
  for (const [ex_, ez_] of [[-4.2, 3.4], [4.6, -2.6], [0.6, -5.2]]) crystals.push({ x: ox + ex_, z: oz + ez_, ci: 4, size: 0.9, exitMark: true });   // 출구 표시 수정
  for (const c of crystals) { c.y = floorAt(c.x, c.z); c.color = COLORS[c.ci]; }
  // 빛 목록 (수정 + 출구 기둥의 햇빛)
  const lights = crystals.map((c) => ({ x: c.x, y: c.y + 1.2 * c.size, z: c.z, color: c.color, rad: 15 + 7 * c.size, k: c.big ? 2.4 : 1.5 }));   // 동굴은 어둡고 빛은 수정에서만

  // ---- 입구/출구 ----
  const entryPos = { x: ox + 5, z: oz + 8 };
  const entry = { x: entryPos.x, y: floorAt(entryPos.x, entryPos.z), z: entryPos.z, yaw: Math.atan2(-(hallRoom.x - 5), -(hallRoom.z - 8)) };
  const exit = { x: ox, z: oz, y: floorAt(ox, oz), reach: 3.8 };

  // ---- 골렘 시작 위치 20곳 ----
  const spawnCount = V.spawnCount;
  const spawns = [];
  rooms.forEach((d, ri) => {
    const n = spawnCount[d.id] || 0;
    let tries = 0;
    for (let k = 0; k < n && tries < 400; tries++) {
      const a = h32(ri, tries, sd + 41) * TAU, rr = Math.sqrt(h32(ri, tries, sd + 42)) * d.r * 0.7;
      const x = ox + d.x + Math.cos(a) * rr, z = oz + d.z + Math.sin(a) * rr;
      if (sdf(x, z) > -9) continue;
      if (pillars.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 3.5)) continue;
      if (spawns.some((p) => Math.hypot(p.x - x, p.z - z) < 10)) continue;
      spawns.push({ x, z }); k++;
    }
  });

  // ---- 충돌 / 카메라 ----
  function collide(x, z, pr) {
    for (let it = 0; it < 4; it++) {
      const s = sdf(x, z);
      if (s > -pr) {
        const e = 0.5, gx = sdf(x + e, z) - sdf(x - e, z), gz = sdf(x, z + e) - sdf(x, z - e), gl = Math.hypot(gx, gz) || 1;
        const push = s + pr;
        x -= (gx / gl) * push; z -= (gz / gl) * push;
      }
      for (const p of pillars) {
        const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz), m = p.r + pr;
        if (d < m) { const u = d > 1e-4 ? 1 / d : 0; x = p.x + (u ? dx * u : 1) * m; z = p.z + (u ? dz * u : 0) * m; }
      }
    }
    return { x, z };
  }
  function clampCamera(x, y, z) {
    const c = collide(x, z, 0.7);
    return { x: c.x, y: Math.min(ceilAt(c.x, c.z) - 0.5, Math.max(floorAt(c.x, c.z) + 0.4, y)), z: c.z };
  }

  // 그릴 범위
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const d of rooms) { x0 = Math.min(x0, d.x - d.r * 1.2); x1 = Math.max(x1, d.x + d.r * 1.2); z0 = Math.min(z0, d.z - d.r * 1.2); z1 = Math.max(z1, d.z + d.r * 1.2); }
  const bounds = { x0: ox + x0 - 8, x1: ox + x1 + 8, z0: oz + z0 - 8, z1: oz + z1 + 8 };

  return { id, Y, origin: { x: ox, z: oz }, seed: sd, rooms, tunnels, sdf, floorAt, rockF, rockC, ceilAt, pillars, crystals, lights, entry, exit, spawns, collide, clampCamera, bounds, vnoise: (x, z, s) => vnoise(x, z, sd + s), inside: (x, z) => sdf(x, z) < 4 };
}

// ---------- 빛 계산 (바닥/벽/천장 색에 미리 구워 넣음) ----------
// n = 면이 향한 방향. 가까운 수정일수록 밝고, 수정 쪽을 향한 면일수록 밝아요.
export function bakeLight(layout, x, y, z, nx, ny, nz, out) {
  let r = 0.03, g = 0.035, b = 0.06;   // 아주 약한 푸른 기본 밝기 (수정에서 먼 곳은 거의 깜깜)
  for (const L of layout.lights) {
    const dx = L.x - x, dy = L.y - y, dz = L.z - z, d = Math.hypot(dx, dy, dz);
    if (d > L.rad * 2.2) continue;
    const f = 1 / (1 + (d / L.rad) * (d / L.rad)), a = f * f * L.k;
    const dot = d > 1e-4 ? (nx * dx + ny * dy + nz * dz) / d : 1;
    const lam = 0.3 + 0.7 * Math.max(0, dot);
    const cr = ((L.color >> 16) & 255) / 255, cg = ((L.color >> 8) & 255) / 255, cb = (L.color & 255) / 255;
    r += cr * a * lam; g += cg * a * lam; b += cb * a * lam;
  }
  out[0] = Math.min(1.5, r); out[1] = Math.min(1.5, g); out[2] = Math.min(1.5, b);
  return out;
}

// ---------- 동굴 바닥/벽/천장 메시 데이터 (면마다 평평한 색, 저폴리) ----------
// 돌려주는 값: { pos, col } (삼각형 3개 정점씩 이어 붙인 Float32Array)
export function buildCaveArrays(layout, cell = 2.5) {
  const { bounds, sdf, rockF, rockC } = layout, CL = CAVE.CLOSE;
  const nx = Math.ceil((bounds.x1 - bounds.x0) / cell), nz = Math.ceil((bounds.z1 - bounds.z0) / cell);
  const W = nx + 1;
  const F = new Float32Array(W * (nz + 1)), C = new Float32Array(W * (nz + 1)), S = new Float32Array(W * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = bounds.x0 + i * cell, z = bounds.z0 + j * cell, k = j * W + i;
    S[k] = sdf(x, z); F[k] = rockF(x, z); C[k] = rockC(x, z);
  }
  const pos = [], col = [];
  const tmp = [0, 0, 0], base = [0, 0, 0];
  const sd = layout.seed;
  function tri(ax, ay, az, bx, by, bz, cx, cy, cz, ceil) {
    let ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx_ = uy * vz - uz * vy, ny_ = uz * vx - ux * vz, nz_ = ux * vy - uy * vx;
    const l = Math.hypot(nx_, ny_, nz_) || 1; nx_ /= l; ny_ /= l; nz_ /= l;
    if (ceil) { nx_ = -nx_; ny_ = -ny_; nz_ = -nz_; }   // 천장은 아래쪽을 향한 면
    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
    // 바위 색: 푸른 회색 + 얼룩 (벽(옆면)은 조금 밝은 갈색빛, 바닥은 어둡게)
    const wall = 1 - Math.abs(ny_), n1 = layout.vnoise(mx * 0.25, mz * 0.25 + my * 0.2, 6), n2 = layout.vnoise(mx * 1.1, mz * 1.1 + my, 7);
    const v = 0.78 + 0.34 * n1 + 0.16 * (n2 - 0.5);
    base[0] = (0.30 + 0.10 * wall) * v; base[1] = (0.31 + 0.06 * wall) * v; base[2] = (0.38 - 0.03 * wall) * v;
    bakeLight(layout, mx, my, mz, nx_, ny_, nz_, tmp);
    const cr = Math.min(1, base[0] * tmp[0] * 2.2), cg = Math.min(1, base[1] * tmp[1] * 2.2), cb = Math.min(1, base[2] * tmp[2] * 2.2);
    if (ceil) { pos.push(ax, ay, az, cx, cy, cz, bx, by, bz); } else pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let q = 0; q < 3; q++) col.push(cr, cg, cb);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k00 = j * W + i, k10 = k00 + 1, k01 = k00 + W, k11 = k01 + 1;
    if (Math.min(S[k00], S[k10], S[k01], S[k11]) >= CL) continue;   // 완전히 바위 속인 칸은 안 그림
    const x0 = bounds.x0 + i * cell, x1 = x0 + cell, z0 = bounds.z0 + j * cell, z1 = z0 + cell;
    // 바닥 (위를 향함): 정점 시계 방향을 위에서 봤을 때 반시계가 되도록
    tri(x0, F[k00], z0, x0, F[k01], z1, x1, F[k10], z0, false);
    tri(x1, F[k10], z0, x0, F[k01], z1, x1, F[k11], z1, false);
    // 천장 (아래를 향함)
    tri(x0, C[k00], z0, x0, C[k01], z1, x1, C[k10], z0, true);
    tri(x1, C[k10], z0, x0, C[k01], z1, x1, C[k11], z1, true);
  }
  return { pos: new Float32Array(pos), col: new Float32Array(col) };
}
