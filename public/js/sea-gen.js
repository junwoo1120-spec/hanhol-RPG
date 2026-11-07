// 바닷속 해초·산호의 "계산만 하는" 부분 (three.js·브라우저 없이도 돌아가서 노드에서 시험 가능)
//  1) 산호 표면 텍스처 (뇌산호 / 벌집산호 / 관스펀지 / 털뭉치 손가락산호 / 부채산호 그물 / 해초 잎)
//  2) 어디에 무엇을 심을지 (흩어진 것 + 산호 군락)
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function ihash(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul((c | 0) + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
// 이어붙여도 티 안 나는 값 잡음 (u, v 는 0~1)
function tnoise(u, v, per, seed) {
  const x = u * per, y = v * per, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const h = (a, b) => ihash(((a % per) + per) % per, ((b % per) + per) % per, seed);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(h(ix, iy), h(ix + 1, iy), sx), lerp(h(ix, iy + 1), h(ix + 1, iy + 1), sx), sy);
}
// 0~1 값 -> 회색 RGBA
function pack(N, fn) {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = Math.round(clamp(fn(x, y), 0, 1) * 255), i = (y * N + x) * 4;
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
  }
  return { w: N, h: N, data };
}

// 가장 가까운 점 / 두 번째로 가까운 점 (격자 점들을 이어붙임 처리해서 찾음)
function nearest2(pts, cells, N, cs, x, y) {
  const gx0 = Math.floor(x / cs), gy0 = Math.floor(y / cs);
  let d1 = 1e9, d2 = 1e9, b = null, bdx = 0, bdy = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    let gx = gx0 + ox, gy = gy0 + oy, wx = 0, wy = 0;
    if (gx < 0) { gx += cells; wx = -N; } else if (gx >= cells) { gx -= cells; wx = N; }
    if (gy < 0) { gy += cells; wy = -N; } else if (gy >= cells) { gy -= cells; wy = N; }
    const p = pts[gy * cells + gx], dx = x - (p.x + wx), dy = y - (p.y + wy), d = Math.hypot(dx, dy);
    if (d < d1) { d2 = d1; d1 = d; b = p; bdx = dx; bdy = dy; } else if (d < d2) d2 = d;
  }
  return { d1, d2, b, dx: bdx, dy: bdy };
}

// ---------- 1) 뇌산호: 미로처럼 길게 구불구불 이어지는 마루와 가는 골 ----------
export function genBrain(N = 256, seed = 5) {
  const r = mulberry(seed), K = 10, cand = [], waves = [];
  for (let kx = -K - 1; kx <= K + 1; kx++) for (let ky = 0; ky <= K + 1; ky++) {
    if (ky === 0 && kx <= 0) continue;
    if (Math.abs(Math.hypot(kx, ky) - K) < 0.4) cand.push([kx, ky]);
  }
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }   // 섞어서 앞에서 8개만 사용
  for (const [kx, ky] of cand.slice(0, 8)) waves.push({ kx, ky, ph: r() * TAU, a: 0.8 + 0.4 * r() });
  let sig = 0; for (const w of waves) sig += w.a * w.a * 0.5; sig = Math.sqrt(sig);
  for (const w of waves) {   // cos(A+B) = cosA cosB - sinA sinB 로 미리 계산해 둠
    w.cx = new Float32Array(N); w.sx = new Float32Array(N); w.cy = new Float32Array(N); w.sy = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      w.cx[i] = Math.cos(TAU * w.kx * i / N + w.ph); w.sx[i] = Math.sin(TAU * w.kx * i / N + w.ph);
      w.cy[i] = Math.cos(TAU * w.ky * i / N); w.sy[i] = Math.sin(TAU * w.ky * i / N);
    }
  }
  return pack(N, (x, y) => {
    let f = 0;
    for (const w of waves) f += w.a * (w.cx[x] * w.cy[y] - w.sx[x] * w.sy[y]);
    const a = Math.abs(f) / sig;
    const ridge = Math.pow(sstep(0.04, 0.8, a), 0.85);                  // 0 근처(가는 골)만 어둡고 마루는 둥글게 밝음
    return 0.08 + 0.92 * ridge + (ihash(x, y, seed) - 0.5) * 0.05;
  });
}

// ---------- 2) 벌집산호: 육각 모양으로 빽빽한 컵 + 방사형 주름 + 밝은 벽 ----------
export function genHoney(N = 256, cells = 8, seed = 9) {
  const r = mulberry(seed), cs = N / cells, pts = [];
  for (let gy = 0; gy < cells; gy++) for (let gx = 0; gx < cells; gx++) {
    const sh = gy & 1 ? 0.5 : 0;                                     // 한 줄씩 반 칸 어긋나게 = 벌집 배열
    pts.push({ x: (gx + 0.5 + sh + (r() - 0.5) * 0.3) * cs, y: (gy + 0.5 + (r() - 0.5) * 0.3) * cs, ph: r() * TAU, v: 0.9 + 0.1 * r(), n: 14 + Math.floor(r() * 5) });
  }
  return pack(N, (x, y) => {
    const q = nearest2(pts, cells, N, cs, x, y), b = q.b;
    const rn = q.d1 / (cs * 0.55);
    const wall = 1 - sstep(0.03, 0.2, (q.d2 - q.d1) / cs);           // 이웃 컵과의 경계 = 밝고 도톰한 벽
    const ribs = 0.5 + 0.5 * Math.cos(Math.atan2(q.dy, q.dx) * b.n + b.ph);
    const depth = Math.pow(sstep(0.05, 1.0, rn), 1.3);                              // 가운데로 갈수록 깊고 어두움
    const septa = ribs * sstep(0.1, 0.35, rn) * 0.36 * (1 - 0.5 * depth);               // 컵 안쪽의 방사형 주름(격벽)
    const inner = 0.04 + 0.5 * depth + septa;
    return lerp(inner, 1.0, wall * 0.92) * b.v + (ihash(x, y, seed) - 0.5) * 0.05;
  });
}

// ---------- 3) 관 스펀지: 동글동글 튀어나온 관 입구 ----------
export function genTube(N = 256, cells = 9, seed = 13) {
  const r = mulberry(seed), cs = N / cells, pts = [];
  for (let gy = 0; gy < cells; gy++) for (let gx = 0; gx < cells; gx++) {
    pts.push({ x: (gx + 0.5 + (r() - 0.5) * 0.6) * cs, y: (gy + 0.5 + (r() - 0.5) * 0.6) * cs, rad: cs * (0.24 + 0.14 * r()), v: 0.88 + 0.12 * r() });
  }
  return pack(N, (x, y) => {
    const q = nearest2(pts, cells, N, cs, x, y), b = q.b, rad = b.rad;
    const hole = sstep(rad * 0.78, rad * 1.05, q.d1);                  // 구멍 안쪽은 아주 어둡게
    const rim = 1 - 0.58 * sstep(rad * 1.1, rad * 1.9, q.d1);         // 구멍 테두리가 가장 높고 멀어질수록 낮아짐
    const gap = 0.6 + 0.4 * sstep(0, cs * 0.25, q.d2 - q.d1);          // 관과 관 사이 골
    return (0.04 + 0.96 * hole) * rim * gap * b.v + (ihash(x, y, seed) - 0.5) * 0.06;
  });
}

// ---------- 4) 털뭉치(셔닐) 손가락 산호: 짧고 통통한 손가락이 같은 방향으로 빽빽하게 겹침 ----------
export function genFinger(N = 256, seed = 17) {
  const r = mulberry(seed), buf = new Float32Array(N * N).fill(0.08);
  for (let i = 0; i < 1500; i++) {
    const cx = r() * N, cy = r() * N;
    const a = tnoise(cx / N, cy / N, 3, seed) * TAU * 1.6 + (r() - 0.5) * 0.9;      // 이웃 손가락끼리 방향이 비슷함
    const hl = 5 + r() * 7, rad = 4.2 + r() * 2.2, br = 0.74 + 0.26 * r();
    const ax = Math.cos(a) * hl, ay = Math.sin(a) * hl, ext = hl + rad * 1.7 + 1;
    for (let oy = -N; oy <= N; oy += N) for (let ox = -N; ox <= N; ox += N) {
      const ccx = cx + ox, ccy = cy + oy;
      if (ccx + ext < 0 || ccx - ext >= N || ccy + ext < 0 || ccy - ext >= N) continue;
      const x0 = Math.max(0, Math.floor(ccx - ext)), x1 = Math.min(N - 1, Math.ceil(ccx + ext));
      const y0 = Math.max(0, Math.floor(ccy - ext)), y1 = Math.min(N - 1, Math.ceil(ccy + ext));
      const sx = 2 * ax, sy = 2 * ay, L2 = sx * sx + sy * sy;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x - (ccx - ax), py = y - (ccy - ay);
        const t = clamp((px * sx + py * sy) / L2, 0, 1);
        const d = Math.hypot(px - sx * t, py - sy * t), k = y * N + x;
        if (d < rad) { const q = d / rad; buf[k] = br * (0.34 + 0.66 * Math.pow(1 - q * q, 0.6)) * (0.88 + 0.2 * t); }
        else if (d < rad * 1.6) buf[k] *= 1 - 0.38 * (1 - (d - rad) / (rad * 0.6));   // 손가락 밑 그림자
      }
    }
  }
  return pack(N, (x, y) => buf[y * N + x] + (ihash(x, y, seed) - 0.5) * 0.06);
}

// ---------- 5) 부채산호: 그물 모양 (알파로 구멍) ----------
export function genNet(N = 256, seed = 29) {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const a = Math.abs(Math.sin(Math.PI * (u * 8 + 0.22 * Math.sin(v * TAU * 2))));      // 세로로 굽은 굵은 줄기
    const b = Math.abs(Math.sin(Math.PI * (v * 13 + 0.3 * Math.sin(u * TAU * 3))));      // 가로 연결 줄기
    let al = Math.max(1 - sstep(0.22, 0.3, a), 1 - sstep(0.12, 0.19, b));
    if (x < 6 && y < 6) al = 1;                                                           // 줄기(대)가 쓰는 모서리는 꽉 채움
    const g = Math.round(clamp(0.62 + 0.38 * tnoise(u, v, 12, seed), 0, 1) * 255), i = (y * N + x) * 4;
    data[i] = g; data[i + 1] = g; data[i + 2] = g; data[i + 3] = Math.round(al * 255);
  }
  return { w: N, h: N, data };
}

// ---------- 6) 해초 잎: 가운데 잎맥 + 비스듬한 잔맥 + 얼룩 (u: 폭, v: 길이) ----------
export function genBlade(W = 64, H = 256, seed = 21) {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H, e = Math.abs(u - 0.5) * 2;
    const rib = Math.exp(-Math.pow((u - 0.5) / 0.045, 2));
    const vein = Math.pow(0.5 + 0.5 * Math.cos(TAU * (v * 34 - e * 9)), 10);
    const mott = tnoise(u, v, 8, seed) * 0.6 + tnoise(u, v, 20, seed + 1) * 0.4;
    const val = clamp(0.84 + 0.2 * (mott - 0.5) - 0.34 * rib - 0.2 * vein * (1 - rib) - 0.2 * e * e, 0, 1);
    const g = Math.round(val * 255), i = (y * W + x) * 4;
    data[i] = g; data[i + 1] = g; data[i + 2] = g; data[i + 3] = 255;
  }
  return { w: W, h: H, data };
}

// ---------- 색 ----------
export const PAL = {
  weed: [0x2fa84a, 0x4cc36a, 0x1f8a5a, 0x7ac143, 0x3fa7a0, 0x9acd32],
  kelp: [0x6b8e23, 0x8a9a3a, 0x3c7a4a, 0x8a7a30, 0x4f8f5f],
  branch: [0xff6f61, 0xff9a5c, 0xffd166, 0xf78fb3, 0xc77dff, 0x7be0d6, 0xff5d8f],
  brain: [0xd8c75a, 0xb8a84a, 0x9ab34e, 0xe0a05a, 0xe8798f, 0x6fc7b8, 0xc98a5a, 0xa88ad8],
  honey: [0xff4f8b, 0xe83a73, 0xff7a45, 0xc455e0, 0xffa64d, 0xf24f4f, 0x8f6bff],
  tube: [0xff5fa2, 0xd94fd0, 0xff7f50, 0xf0425f, 0x6a8cff, 0xffb347, 0xe66ea8],
  fan: [0xc9366b, 0xa83ec9, 0xff7a3d, 0xe04a4a],
  finger: [0xff4d8d, 0xff6f91, 0xff9a3c, 0xc6e04a, 0x46d6c8, 0xa070ff, 0xffd13d],
};
// 종류 번호: 0 해초, 1 다시마, 2 가지산호, 3 뇌산호, 4 벌집·접시산호, 5 관스펀지, 6 부채산호, 7 손가락산호
export const PAL_BY_TYPE = [PAL.weed, PAL.kelp, PAL.branch, PAL.brain, PAL.honey, PAL.tube, PAL.fan, PAL.finger];
const ANCHORS = [0xff4f8b, 0xff8a3d, 0xe0c94a, 0x9a6bff, 0x3ccfbf, 0xf0708f, 0x86c04a, 0xe84a4a, 0x5c8cff];

function hexToHsl(hex) {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToHex(h, s, l) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = ((t % 1) + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return (Math.round(f(h + 1 / 3) * 255) << 16) | (Math.round(f(h) * 255) << 8) | Math.round(f(h - 1 / 3) * 255);
}

// ---------- 배치 ----------
export const CELL = 7;        // 한 칸 크기 (sea-life.js 와 같아야 함)
const CG = 64;                // 군락이 놓이는 큰 격자 한 칸
const COLONY_TRY = 12;        // 군락 안에서 칸마다 심어보는 횟수
// 군락 종류별로 (가운데 / 중간 / 가장자리)에 어울리는 산호
const THEMES = [
  { core: [3, 3, 3, 4], mid: [3, 4, 7, 2], edge: [7, 2, 5] },     // 뇌산호 정원
  { core: [4, 4, 3], mid: [4, 3, 2, 5], edge: [2, 7, 5] },        // 벌집·접시산호 밭
  { core: [2, 2, 2, 7], mid: [2, 7, 4], edge: [7, 2, 6] },        // 가지산호 숲
  { core: [5, 5, 6, 3], mid: [5, 6, 7, 2], edge: [7, 2, 6] },     // 스펀지·부채산호 정원
];

// T.height(x, z) 로 바닥 높이를 받아서, 칸(ix, iz) 하나에 심을 목록을 항상 똑같이 만들어 줌
export function makeLayout({ T, WATER_LEVEL, seed }) {
  const s0 = Number(seed) | 0;
  const hash = (ix, iz, k) => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(k + 1, 2246822519) ^ Math.imul(s0, 982451653);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };

  // 군락: 큰 격자 한 칸에 최대 하나. 물이 너무 얕거나 너무 깊으면 없음
  const colonies = new Map();
  function colonyOf(gx, gz) {
    const key = gx + ',' + gz;
    if (colonies.has(key)) return colonies.get(key);
    let c = null;
    if (hash(gx, gz, 901) < 0.6) {
      const cx = (gx + 0.2 + 0.6 * hash(gx, gz, 902)) * CG, cz = (gz + 0.2 + 0.6 * hash(gx, gz, 903)) * CG;
      const depth = WATER_LEVEL - T.height(cx, cz);
      if (depth > 2.5 && depth < 34) {
        const anchor = ANCHORS[Math.floor(hash(gx, gz, 906) * ANCHORS.length) % ANCHORS.length];
        c = { gx, gz, cx, cz, rad: 8 + 8 * hash(gx, gz, 904), theme: Math.floor(hash(gx, gz, 905) * THEMES.length) % THEMES.length, hsl: hexToHsl(anchor), p1: hash(gx, gz, 907) * TAU, p2: hash(gx, gz, 908) * TAU };
      }
    }
    colonies.set(key, c);
    return c;
  }

  function scatter(ix, iz, out) {
    const patch = hash(ix >> 2, iz >> 2, 77);          // 4x4칸 구역마다 밀도가 달라서 듬성듬성 / 빽빽 차이가 남
    const dens = 0.18 + 0.82 * patch * patch;
    for (let k = 0; k < 3; k++) {
      if (hash(ix, iz, k * 7 + 1) > dens * 0.42) continue;       // 예전의 절반 밀도
      const x = (ix + hash(ix, iz, k * 7 + 2)) * CELL, z = (iz + hash(ix, iz, k * 7 + 3)) * CELL;
      const h = T.height(x, z), depth = WATER_LEVEL - h;
      if (depth < 1.8 || depth > 70) continue;
      const a = hash(ix, iz, k * 7 + 4), b = hash(ix, iz, k * 7 + 5), c = hash(ix, iz, k * 7 + 6);
      let t;
      if (depth < 16) t = a < 0.5 ? 2 + Math.floor(b * 6) : 0;                           // 얕은 곳: 산호 + 해초
      else if (depth < 40) t = a < 0.22 ? [2, 5, 6, 7][Math.floor(b * 4)] : (a < 0.6 ? 0 : 1);   // 중간
      else t = a < 0.65 ? 1 : 0;                                                          // 깊은 곳: 다시마 위주
      let sx, sy;
      if (t === 0) { sx = 0.8 + c * 0.6; sy = 0.7 + b * 1.0; }
      else if (t === 1) { sx = 0.8 + c * 0.5; sy = 0.8 + b * 0.7; }
      else { sx = sy = 0.8 + b * 1.2; if (t === 3) sy *= 0.9 + c * 0.5; }
      const pal = PAL_BY_TYPE[t];
      out.push({ t, x, y: h - 0.05, z, ry: (a * 97.3) % TAU, sx, sy, hex: pal[Math.floor(c * pal.length) % pal.length] });
    }
  }

  function colonyItems(ix, iz, out) {
    const px = (ix + 0.5) * CELL, pz = (iz + 0.5) * CELL;
    const gx0 = Math.floor(px / CG), gz0 = Math.floor(pz / CG);
    for (let dgz = -1; dgz <= 1; dgz++) for (let dgx = -1; dgx <= 1; dgx++) {
      const c = colonyOf(gx0 + dgx, gz0 + dgz);
      if (!c || Math.hypot(px - c.cx, pz - c.cz) > c.rad * 1.3 + CELL) continue;
      const th = THEMES[c.theme];
      for (let k = 0; k < COLONY_TRY; k++) {
        const salt = 200 + k * 13;
        const x = (ix + hash(ix, iz, salt + 1)) * CELL, z = (iz + hash(ix, iz, salt + 2)) * CELL;
        const dx = x - c.cx, dz = z - c.cz, ang = Math.atan2(dz, dx);
        const edge = c.rad * (0.85 + 0.15 * Math.sin(ang * 3 + c.p1) + 0.1 * Math.sin(ang * 5 + c.p2));   // 울퉁불퉁한 군락 경계
        const u = Math.hypot(dx, dz) / edge;
        if (u > 1) continue;
        if (hash(ix, iz, salt + 3) > 0.95 - 0.55 * u * u) continue;      // 가운데는 빽빽, 가장자리는 성기게
        const h = T.height(x, z), depth = WATER_LEVEL - h;
        if (depth < 1.8 || depth > 60) continue;
        const r1 = hash(ix, iz, salt + 4), r2 = hash(ix, iz, salt + 5), r3 = hash(ix, iz, salt + 6), r4 = hash(ix, iz, salt + 7);
        const zone = u < 0.4 ? th.core : u < 0.75 ? th.mid : th.edge;
        let t = zone[Math.floor(r1 * zone.length) % zone.length];
        if (u > 0.7 && r2 < 0.08) t = 0;                                   // 가장자리에 해초 조금
        let sx, sy;
        if (t === 0) { sx = 0.7 + r3 * 0.5; sy = 0.6 + r4 * 0.8; }
        else if (t === 3 || t === 4) { sx = sy = 0.9 + (1 - u) * 1.5 * r3 + 0.3 * r4; if (t === 3) sy *= 0.9 + r4 * 0.4; }   // 가운데는 큰 덩어리 산호
        else { sx = sy = 0.65 + 0.7 * r3 + 0.3 * (1 - u); }
        let hex;
        if (t === 0) hex = PAL.weed[Math.floor(r3 * PAL.weed.length) % PAL.weed.length];
        else if (r4 < 0.2) { const pal = PAL_BY_TYPE[t]; hex = pal[Math.floor(r3 * pal.length) % pal.length]; }   // 가끔 다른 색이 섞임
        else {                                                             // 군락은 같은 계열 색에서 살짝씩 다르게
          const j = (n) => hash(ix, iz, salt + n) - 0.5;
          hex = hslToHex(c.hsl[0] + j(8) * 0.07, clamp(c.hsl[1] + j(9) * 0.2, 0.35, 1), clamp(c.hsl[2] + j(10) * 0.18, 0.28, 0.72));
        }
        out.push({ t, x, y: h - 0.05, z, ry: (r1 * 311.7) % TAU, sx, sy, hex });
      }
    }
  }

  function genCell(ix, iz) {
    const out = [];
    scatter(ix, iz, out);
    colonyItems(ix, iz, out);
    return out;
  }
  return { genCell };
}
