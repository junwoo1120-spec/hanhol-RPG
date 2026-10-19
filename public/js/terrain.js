export const WATER_LEVEL = 0;

const MAP_SCALE = 1.25;       // 맵 크기 배율 (1이면 이전 크기, 2면 두 배)
const K = 4 / MAP_SCALE;      // 실제 좌표 -> 설계 좌표 배율
const HEIGHT_SCALE = 0.6;     // 지형 높이 배율

// 외곽 산맥 (한 겹의 매끈한 높은 벽)
const RING_START = 1100 * MAP_SCALE;   // 벽이 솟기 시작하는 반지름
const RING_END = 1300 * MAP_SCALE;     // 벽이 최대 높이에 도달하는 반지름
const RING_H = 700;                    // 벽 높이

export const PLAY_RADIUS = Math.round(1130 * MAP_SCALE);   // 플레이어가 갈 수 있는 최대 반지름
export const VILLAGE = { x: 0, z: 0, r: 150, blend: 110, h: 10 };

// 나침반에 표시할 지형 (설계 좌표를 실제 좌표로 자동 변환)
const lm = (name, vx, vz) => ({ name, x: Math.round(vx / K), z: Math.round(vz / K) });
export const LANDMARKS = [
  lm('시작마을', 0, 0),
  lm('바다', -380, -2850),
  lm('정글', -3060, -880),
  lm('화산', -2500, 900),
  lm('설원', -1000, 2750),
  lm('평원', 1580, 2300),
  lm('사막', 2950, 0),
];

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// 색 (0 평원, 1 사막, 2 정글, 3 화산, 4 설원, 5 바다/해안)
const PAL = [
  [0.36, 0.62, 0.25],
  [0.86, 0.74, 0.44],
  [0.07, 0.32, 0.11],
  [0.18, 0.16, 0.15],   // 화산지대: 어두운 돌 색 (텍스처가 덮어씀)
  [0.94, 0.97, 1.0],
  [0.80, 0.74, 0.50],
];
const SAND = [0.80, 0.74, 0.50], FLOOR = [0.10, 0.22, 0.32];
const ROCK = [0.50, 0.50, 0.52], SNOW = [0.95, 0.97, 1.0], LAVA = [1.0, 0.65, 0.10];
const DIRT = [0.45, 0.33, 0.20];

// 지역 배치 (설계 좌표: 중심 x, z / 가로·세로 반경)
const REGIONS = [
  { t: 0, x: 150,   z: -250,  rx: 1750, rz: 1850 },  // 중앙 평원
  { t: 0, x: 1580,  z: 2300,  rx: 1000, rz: 1250 },  // 남동 평원
  { t: 1, x: 2950,  z: 0,     rx: 1250, rz: 2000 },  // 사막
  { t: 2, x: -3060, z: -880,  rx: 1040, rz: 720 },   // 정글 (0.8배, 서북쪽에 고정)
  { t: 3, x: -2500, z: 760,   rx: 2025, rz: 1415 },  // 화산지대 (정글이 줄어든 만큼 확장)
  { t: 4, x: -1000, z: 2750,  rx: 2000, rz: 1400 },  // 설원
  { t: 5, x: -380,  z: -2850, rx: 3300, rz: 1100 },  // 바다·해안
];

// 화산: 큰 화산 하나만 (1.3배)
// R = 산 폭, H = 산 높이, crater = 분화구 반지름 (용암이 고이는 곳)
const CONES = [
  { x: -2500, z: 900, R: 939, H: 442, crater: 143, fill: 0.45 },
];

// 설원 산: 2개, 낮게
const PEAKS = [
  { x: -800,  z: 2950, R: 600, H: 240 },
  { x: -1900, z: 2400, R: 500, H: 190 },
];

export function makeTerrain(seed) {
  const s = (Number(seed) | 0) || 1;

  const hash = (x, z) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(s, 982451653);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const noise = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, z, oct) => {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += noise(x * f + i * 17.3, z * f - i * 9.1) * amp;
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  };

  // ---- 지역 가중치 (경계는 완만하게 구불구불, 떨어진 조각이 생기지 않도록 왜곡을 약하게) ----
  const W = new Float64Array(6);
  const D = new Float64Array(REGIONS.length);
  function weights(x, z) {
    const wx = x + (fbm(x * 0.0012 + 90, z * 0.0012 + 90, 2) - 0.5) * 900;
    const wz = z + (fbm(x * 0.0012 - 90, z * 0.0012 - 40, 2) - 0.5) * 900;
    let dmin = Infinity;
    for (let i = 0; i < REGIONS.length; i++) {
      const r = REGIONS[i];
      D[i] = Math.hypot((wx - r.x) / r.rx, (wz - r.z) / r.rz);
      if (D[i] < dmin) dmin = D[i];
    }
    W.fill(0);
    let sum = 0;
    for (let i = 0; i < REGIONS.length; i++) {
      const e = Math.exp(-7 * (D[i] - dmin));
      W[REGIONS[i].t] += e;
      sum += e;
    }
    for (let t = 0; t < 6; t++) W[t] /= sum;
    return W;
  }

  // ---- 지역별 높이 (설계 좌표 기준) ----
  const plainH = (x, z) =>
    16 + (fbm(x * 0.0035 + 10, z * 0.0035, 3) - 0.5) * 44 + (fbm(x * 0.015, z * 0.015, 2) - 0.5) * 5;

  const desertH = (x, z) =>
    14 + (fbm(x * 0.004 + 200, z * 0.004, 3) - 0.5) * 32 + (fbm(x * 0.02, z * 0.02, 2) - 0.5) * 8;

  // 정글: 굴곡 완화 (완만한 구릉)
  const jungleH = (x, z) =>
    22 + (fbm(x * 0.004 - 70, z * 0.004 + 70, 3) - 0.5) * 26 + (fbm(x * 0.02, z * 0.02, 2) - 0.5) * 2;

  // 화산: 가장자리가 솟은 분화구 + 평평한 바닥 (가운데가 볼록하지 않음)
  const coneH = (c, x, z) => {
    const r = Math.hypot(x - c.x, z - c.z);
    const t = Math.max(0, 1 - Math.max(r, c.crater) / c.R);   // 분화구 안쪽은 가장자리 높이로 평평하게 취급
    const rim = c.H * Math.pow(t, 1.5);
    const bowl = c.H * 0.07 * (1 - smooth(c.crater * 0.6, c.crater, r)); // 안쪽 벽 + 평평한 바닥
    const lavaDepth = c.H * 0.07 * (1 - c.fill);   // 가장자리에서 용암 표면까지 내려간 깊이 (fill이 클수록 수위가 높음)
    return rim - Math.min(bowl, lavaDepth);        // 용암 표면은 평평하게
  };
  // 화산지대: 평지 + 큰 화산 하나
  const volcanoH = (x, z) => {
    let h = 22 + (fbm(x * 0.01, z * 0.01, 2) - 0.5) * 4;
    for (const c of CONES) h += coneH(c, x, z);
    return h;
  };

  const snowH = (x, z) => {
    let h = 26 + (fbm(x * 0.004 + 700, z * 0.004, 3) - 0.5) * 50 + (fbm(x * 0.02, z * 0.02, 2) - 0.5) * 5;
    let pk = 0;
    for (const p of PEAKS) {
      const t = Math.max(0, 1 - Math.hypot(x - p.x, z - p.z) / p.R);
      pk = Math.max(pk, p.H * Math.pow(t, 2));
    }
    return h + pk * (0.8 + 0.4 * fbm(x * 0.012 + 40, z * 0.012, 3));
  };

  const seaH = (x, z) => -45 + (fbm(x * 0.004 + 500, z * 0.004 - 500, 3) - 0.5) * 20;

  const FN = [plainH, desertH, jungleH, volcanoH, snowH, seaH];

  function height(x, z) {
    const u = x * K, v = z * K;                       // 설계 좌표
    const w = weights(u, v);
    let h = 0, sum = 0;
    for (let t = 0; t < 6; t++) {
      if (w[t] > 0.01) { h += w[t] * FN[t](u, v); sum += w[t]; }
    }
    h = (h / sum) * HEIGHT_SCALE;

    // 외곽 산맥: 다른 지형 없이 매끈한 높은 벽 한 겹
    const rr = Math.hypot(x, z);
    const edge = smooth(RING_START, RING_END, rr);
    if (edge > 0) h += (RING_H - h) * edge;

    // 시작마을 평평한 터
    const vd = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
    const vt = 1 - smooth(VILLAGE.r, VILLAGE.r + VILLAGE.blend, vd);
    if (vt > 0) h += (VILLAGE.h - h) * vt;

    return h;
  }

  function color(x, z, h) {
    const u = x * K, v = z * K;
    const w = weights(u, v);
    let c = [0, 0, 0];
    for (let t = 0; t < 6; t++) {
      c[0] += w[t] * PAL[t][0]; c[1] += w[t] * PAL[t][1]; c[2] += w[t] * PAL[t][2];
    }
    c = mix(c, SAND, 1 - smooth(1, 4, h));       // 해안은 모래
    c = mix(c, FLOOR, smooth(-1, -6, h));        // 물속은 어둡게

    // 화산 분화구 바닥 용암색 (텍스처가 없을 때를 위한 기본색)
    const vw = w[3];
    if (vw > 0.05) {
      for (const cone of CONES) {
        const r = Math.hypot(u - cone.x, v - cone.z);
        const m = (1 - smooth(cone.crater * 0.5, cone.crater * 0.68, r)) * vw;
        if (m > 0) c = mix(c, LAVA, m);
      }
    }

    // 마을 터는 흙바닥
    const vdist = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
    c = mix(c, DIRT, 1 - smooth(VILLAGE.r * 0.9, VILLAGE.r + VILLAGE.blend * 0.6, vdist));

    // 외곽 산맥: 바위색 + 꼭대기 눈
    const ring = smooth(RING_START - 50, RING_START + 100, Math.hypot(x, z));
    if (ring > 0) {
      c = mix(c, ROCK, ring);
      c = mix(c, SNOW, smooth(450, 650, h) * ring);
    }
    return c;
  }

  // 텍스처 가중치 9개:
  // [평원 잔디, 평원 흙 얼룩, 잔디 색 변화, 마을 흙, 정글 잔디, 사막 모래,
  //  화산 일반 돌, 용암 섞인 돌, 분출구 용암]
  function detail(x, z, h) {
    const u = x * K, v = z * K;
    const w = weights(u, v);
    const land = smooth(2, 5, h);                          // 해안·물속 제외
    const plain = w[0] * land;
    const jungle = w[2] * land;
    const desert = w[1] * land;

    const vdist = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
    const village = 1 - smooth(VILLAGE.r * 0.9, VILLAGE.r + VILLAGE.blend * 0.6, vdist);

    const patch = smooth(0.60, 0.70, fbm(x * 0.05 + 300, z * 0.05 - 300, 3)) * 0.85;
    const dirt = Math.min(1, patch * plain) * (1 - village);
    const grass = plain * (1 - dirt);
    const vari = fbm(x * 0.02 + 77, z * 0.02 - 77, 2);

    // 화산: 일반 돌 + 군데군데 용암 섞인 돌 + 분화구 바닥 용암
    const volc = w[3] * land;
    let rc = Infinity, crater = 143, fill = 0.45;
    for (const cone of CONES) {
      const r = Math.hypot(u - cone.x, v - cone.z);
      if (r < rc) { rc = r; crater = cone.crater; fill = cone.fill; }
    }
    // 분화구 바로 주변에는 용암 섞인 돌이 없고, 조금 떨어진 곳부터 나타남
    const rimClear = smooth(crater * 1.0, crater * 1.8, rc);
    const lavaPatch = smooth(0.58, 0.65, fbm(x * 0.03 + 500, z * 0.03 - 500, 3));
    const lavaRock = Math.min(1, lavaPatch * 0.85) * rimClear;
    // 용암은 평평한 분화구 바닥과 안쪽 벽 아래쪽에만
    const tInv = 0.5 - Math.sin(Math.asin(1 - 2 * fill) / 3);   // smooth()의 역함수
    const rp = crater * (0.6 + 0.4 * tInv);                      // 용암이 벽에 닿는 반지름 (수위에 맞춰 자동 계산)
    const pool = (1 - smooth(rp - crater * 0.08, rp, rc)) * w[3];

    return [grass, dirt, vari, village, jungle, desert, volc, lavaRock, pool];
  }

  return { height, color, detail };
}
