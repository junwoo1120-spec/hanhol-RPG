export const WATER_LEVEL = 0;
export const PLAY_RADIUS = 4850;                       // 플레이어가 갈 수 있는 최대 반지름
export const VILLAGE = { x: 0, z: 0, r: 300, blend: 220, h: 16 };

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
  [0.22, 0.19, 0.19],
  [0.94, 0.97, 1.0],
  [0.80, 0.74, 0.50],
];
const SAND = [0.80, 0.74, 0.50], FLOOR = [0.10, 0.22, 0.32];
const ROCK = [0.50, 0.50, 0.52], SNOW = [0.95, 0.97, 1.0], LAVA = [0.95, 0.30, 0.05];

// 지역 배치 (중심 x, z / 가로·세로 반경)
const REGIONS = [
  { t: 0, x: 150,   z: -250,  rx: 1750, rz: 1850 },  // 중앙 평원
  { t: 0, x: 1580,  z: 2300,  rx: 1000, rz: 1250 },  // 남동 평원
  { t: 1, x: 2950,  z: 0,     rx: 1250, rz: 2000 },  // 사막
  { t: 2, x: -2800, z: -700,  rx: 1300, rz: 900 },   // 정글
  { t: 3, x: -2500, z: 900,   rx: 1350, rz: 850 },   // 화산지대
  { t: 4, x: -1000, z: 2750,  rx: 2000, rz: 1400 },  // 설원
  { t: 5, x: -380,  z: -2850, rx: 3300, rz: 1100 },  // 바다·해안
];
const CONES = [
  { x: -2550, z: 800,  R: 700, H: 330, crater: 110 },
  { x: -3200, z: 1150, R: 450, H: 200, crater: 70 },
];
const PEAKS = [
  { x: -2000, z: 2250, R: 520, H: 240 },
  { x: -800,  z: 2950, R: 620, H: 300 },
  { x: -1400, z: 3450, R: 450, H: 210 },
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

  // ---- 지역 가중치 (경계는 노이즈로 구불구불, 부드럽게 섞임) ----
  const W = new Float64Array(6);
  const D = new Float64Array(REGIONS.length);
  function weights(x, z) {
    const wx = x + (fbm(x * 0.0012 + 90, z * 0.0012 + 90, 3) - 0.5) * 2400;
    const wz = z + (fbm(x * 0.0012 - 90, z * 0.0012 - 40, 3) - 0.5) * 2400;
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

  // ---- 지역별 높이 ----
  const plainH = (x, z) =>
    16 + (fbm(x * 0.0035 + 10, z * 0.0035, 3) - 0.5) * 44 + (fbm(x * 0.015, z * 0.015, 2) - 0.5) * 5;

  const desertH = (x, z) =>
    14 + (fbm(x * 0.004 + 200, z * 0.004, 3) - 0.5) * 32 + (fbm(x * 0.02, z * 0.02, 2) - 0.5) * 8;

  const jungleH = (x, z) =>
    20 + (fbm(x * 0.005 - 70, z * 0.005 + 70, 4) - 0.5) * 70 + (fbm(x * 0.03, z * 0.03, 2) - 0.5) * 6;

  const coneH = (c, x, z) => {
    const r = Math.hypot(x - c.x, z - c.z);
    const t = Math.max(0, 1 - r / c.R);
    return c.H * Math.pow(t, 1.5) - c.H * 0.2 * (1 - smooth(0, c.crater, r));
  };
  const volcanoH = (x, z) => {
    const rg = 1 - Math.abs(fbm(x * 0.005 + 300, z * 0.005 - 300, 4) * 2 - 1);
    let h = 45 + rg * rg * 110 + (fbm(x * 0.02, z * 0.02, 3) - 0.5) * 12;
    for (const c of CONES) h += coneH(c, x, z);
    return h;
  };

  const snowH = (x, z) => {
    let h = 26 + (fbm(x * 0.004 + 700, z * 0.004, 3) - 0.5) * 50 + (fbm(x * 0.02, z * 0.02, 2) - 0.5) * 5;
    let pk = 0;
    for (const p of PEAKS) {
      const t = Math.max(0, 1 - Math.hypot(x - p.x, z - p.z) / p.R);
      pk = Math.max(pk, p.H * Math.pow(t, 1.7));
    }
    return h + pk * (0.8 + 0.4 * fbm(x * 0.012 + 40, z * 0.012, 3));
  };

  const seaH = (x, z) => -45 + (fbm(x * 0.004 + 500, z * 0.004 - 500, 3) - 0.5) * 20;

  const FN = [plainH, desertH, jungleH, volcanoH, snowH, seaH];

  function height(x, z) {
    const w = weights(x, z);
    let h = 0, sum = 0;
    for (let t = 0; t < 6; t++) {
      if (w[t] > 0.01) { h += w[t] * FN[t](x, z); sum += w[t]; }
    }
    h /= sum;

    // 맵 경계 산맥 (지름 10km 원형)
    const rr = Math.hypot(x, z);
    const edge = smooth(3700, 4600, rr);
    if (edge > 0) h += edge * (140 + fbm(x * 0.006 + 999, z * 0.006, 4) * 220);
    h += smooth(5000, 5600, rr) * 300;

    // 시작마을 평평한 터
    const vd = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
    const vt = 1 - smooth(VILLAGE.r, VILLAGE.r + VILLAGE.blend, vd);
    if (vt > 0) h += (VILLAGE.h - h) * vt;

    return h;
  }

  function color(x, z, h) {
    const w = weights(x, z);
    let c = [0, 0, 0];
    for (let t = 0; t < 6; t++) {
      c[0] += w[t] * PAL[t][0]; c[1] += w[t] * PAL[t][1]; c[2] += w[t] * PAL[t][2];
    }
    c = mix(c, SAND, 1 - smooth(1, 4, h));       // 해안은 모래
    c = mix(c, FLOOR, smooth(-1, -6, h));        // 물속은 어둡게

    // 화산 분화구 용암색
    const vw = w[3];
    if (vw > 0.05) {
      for (const cone of CONES) {
        const r = Math.hypot(x - cone.x, z - cone.z);
        const m = (1 - smooth(cone.crater * 0.55, cone.crater, r)) * vw;
        if (m > 0) c = mix(c, LAVA, m);
      }
    }

    // 경계 산맥: 바위색 + 꼭대기 눈
    const ring = smooth(3800, 4400, Math.hypot(x, z));
    if (ring > 0) {
      c = mix(c, ROCK, ring);
      c = mix(c, SNOW, smooth(170, 240, h) * ring);
    }
    return c;
  }

  return { height, color };
}
