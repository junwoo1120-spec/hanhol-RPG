export const WATER_LEVEL = 0;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const GRASS = [0.30, 0.55, 0.22], FOREST = [0.14, 0.38, 0.16], DESERT = [0.85, 0.75, 0.45];
const SNOW = [0.95, 0.97, 1.0], SAND = [0.80, 0.74, 0.50], FLOOR = [0.25, 0.35, 0.30];

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

  function height(x, z) {
    const c = (fbm(x * 0.0007, z * 0.0007, 4) - 0.5) * 2.4;      // 대륙 형태 (-1~1 근처)
    let h = c * 45 + (fbm(x * 0.01, z * 0.01, 4) - 0.5) * 14;      // 큰 기복 + 언덕
    const mk = smooth(0.15, 0.55, c);                               // 산맥 마스크
    const ridge = Math.max(0, 1 - Math.abs((fbm(x * 0.003 + 50, z * 0.003 + 50, 4) - 0.5) * 3.5));
    h += mk * ridge * ridge * 110;                                  // 능선형 산
    
    // 맵 경계를 둘러싸는 거대한 산맥
    const WORLD_HALF = 5000;
    const BORDER_WIDTH = 700;

    const edgeDist = Math.min(
      WORLD_HALF - Math.abs(x),
      WORLD_HALF - Math.abs(z)
    );

    // 경계에 가까울수록 산맥이 높아짐
    const edge = 1 - smooth(0, BORDER_WIDTH, edgeDist);
    const mountainNoise = fbm(x * 0.006, z * 0.006, 4);

    h += edge * (100 + mountainNoise * 150);

    return h;

    return h;
  }

  function color(x, z, h) {
    const temp = 0.5 + (fbm(x * 0.0005 + 500, z * 0.0005 - 500, 3) - 0.5) * 2.4 - Math.max(0, h) * 0.004;
    const moist = 0.5 + (fbm(x * 0.0008 - 300, z * 0.0008 + 300, 3) - 0.5) * 2.4;
    let col = GRASS;
    col = mix(col, FOREST, smooth(0.52, 0.68, moist));
    col = mix(col, DESERT, smooth(0.58, 0.70, temp) * (1 - smooth(0.40, 0.52, moist)));
    col = mix(col, SNOW, smooth(0.42, 0.30, temp));
    col = mix(col, SAND, 1 - smooth(1, 4, h));       // 해안은 모래
    col = mix(col, FLOOR, smooth(-1, -6, h));        // 물속은 어둡게
    return col;
  }

  return { height, color };
}
