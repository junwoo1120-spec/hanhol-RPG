// 자연 오브젝트 배치 계산 (순수 JS, THREE 의존 없음 → node에서 테스트 가능)
//
// 핵심 아이디어
//  - 월드를 "층(layer)"별 셀 격자로 나누고, 셀마다 후보 1개를 (시드, 층, 셀 좌표) 해시로 만든다. 후보 위치는 셀 안에서 완전히 무작위라 규칙적인 격자로 보이지 않는다.
//  - 후보는 청크와 무관하게 항상 같은 결과를 낸다(순수 함수). 오브젝트는 "자기 위치가 속한 청크"만 내보내므로 경계 중복/누락이 없다.
//  - 큰 것(거대 나무 > 나무 > 중간) 끼리는 우선순위로 겹침을 정리하고, 잔디/꽃 같은 작은 것은 큰 것의 발밑을 피한다.
//  - 지형 판정은 T.height / T.detail 원본으로 한다 (청크 메시 해상도와 무관).
//
//   const placer = createPlacer(T, seed);
//   const gen = placer.chunkGenerator(cx, cz);     // 제너레이터: 한 단계씩 실행해 프레임에 분산 가능
//   const items = placer.placeChunk(cx, cz);       // 한 번에 (테스트용)
import { SPECIES } from './nature-geo.js';
import { WATER_LEVEL, VILLAGE, PLAY_RADIUS, coneRatio } from './terrain.js';

export const CHUNK = 32;                       // main.js의 S와 같아야 함
export const SKIP_HANG = new Set(['vine_hanging', 'vine_thick', 'vine_climbing', 'icicle']); // 매달리는 것/벽 타는 것은 이번 단계에서 배치하지 않음

// ---------- 지역별 개수 배율 (1 = 그대로, 0.5 = 절반) ----------
// tree: 나무(선인장 제외), rock: 일반 바위(거대 바위 지형·얼음 결정·바닥 눈더미 제외)
export const DENSITY = {
  volcano: { tree: 1 / 2, rock: 1 / 3 },
  snow:    { tree: 1 / 2, rock: 1 / 4 },
  desert:  { tree: 1,     rock: 1 / 2 },   // 사막은 선인장 외 나무를 아예 만들지 않음 (decide 참고)
  plains:  { tree: 3 / 5, rock: 1 },
};
export const CONE_CLEAR = 1.0;   // 화산 원뿔(옆면+분화구) 안쪽은 자연 오브젝트 없음. 1 = 산 가장자리까지

// ---------- 충돌 (플레이어가 통과하지 못하는 것) ----------
export const BLOCK_BIG_ROCKS = true;                      // false로 바꾸면 나무만 막힘
const PASSABLE = new Set(['rock_pebbles', 'ash_mound', 'ash_patch', 'icicle']);   // 작은 돌/낮은 더미: 통과 가능
const BIG_ROCK_FP = 0.9;                                  // 발밑 반지름이 이보다 작은 바위는 "작은 돌"로 보고 통과 가능
// 오브젝트 하나의 충돌 반지름 (0이면 통과 가능)
export function solidRadius(it) {
  if (it.biome === 'shallow') return 0;                   // 물속 산호 등은 막지 않음
  const base = SPECIES[it.id].base;
  if (base === 'tree') return Math.max(0.3, it.fp * 0.3);                       // 나무: 몸통 정도만 막음 (수관 아래는 걸어다닐 수 있음)
  if (BLOCK_BIG_ROCKS && base === 'rock' && !PASSABLE.has(it.id) && it.fp >= BIG_ROCK_FP) return it.fp * 0.7;
  return 0;
}

// ---------- 층 설정 ----------
export const L_GIANT = 0, L_TREE = 1, L_MID = 2, L_GROUND = 3;
export const GIANT_CELL = 260;                // 정글 대표(거대) 나무 간격. 값을 키우면 더 드물어짐
const CELL = [GIANT_CELL, 8.5, 5, 2.4];
const NVAR = [2, 4, 3, 2];                     // 층별 변종 수 (드로우콜 절약: 작은 것은 변종 적게)
const MAXFP = [8, 5.2, 2.2, 0];                // 층별 최대 발밑 반지름(겹침 검사 창 크기 계산용)

// ---------- 해시/난수/노이즈 ----------
const mix32 = (a, b, c, d) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x7f4a7c15) | 0, 0xc2b2ae35) ^ Math.imul((c + 0x165667b1) | 0, 0x27d4eb2f) ^ Math.imul((d + 0x2c1b3c6d) | 0, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
};
const rng32 = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------- 종류별 그리기 규칙 (거리별 LOD / 생략 거리) ----------
// l0: LOD0 거리, l1: LOD1 거리 (그 밖은 LOD2), cull: 이 거리 밖은 그리지 않음. big: 시야각 컬링 없이 항상 그림(큰 것)
export function drawRule(id) {
  const base = SPECIES[id].base;
  const R = (l0, l1, cull, big = false) => ({ l0, l1, cull, big });
  if (id === 'tree_jungle_giant') return R(60, 130, 230, true);
  if (id === 'rock_arch' || id === 'rock_mesa') return R(70, 130, 200, true);
  if (id === 'tree_fern' || id === 'tree_palm') return R(26, 55, 120);
  if (id === 'coral') return R(14, 30, 60);
  if (id === 'seaweed') return R(14, 30, 55);
  if (id.startsWith('cactus')) return R(26, 55, 105);
  if (id === 'rock_hoodoo') return R(30, 65, 125);
  if (base === 'tree') return R(32, 75, 165);
  if (base === 'rock') return id === 'rock_pebbles' || id === 'ash_patch' || id === 'ice_crystal' ? R(20, 40, 75) : R(28, 60, 115);
  if (base === 'stump') return R(24, 48, 85);
  if (base === 'plant') return id === 'plant_rosette' || id === 'plant_sapling' ? R(16, 34, 55) : R(18, 38, 80);
  if (base === 'grass') return id === 'reed_cattail' ? R(20, 40, 70) : R(18, 34, 58);
  if (base === 'flower') return R(14, 28, 45);
  if (base === 'mushroom') return R(12, 24, 38);
  return R(20, 40, 60);
}

// ---------- 종류별 규칙 표 ----------
// [id, 가중치, 발밑 반지름(스케일 1), 최대 경사(|∇h|), 크기 배율]
const E = (id, w, fp = 0, g = 0.9, sm = 1) => ({ id, w, fp, g, sm });
const TREE_G = 0.7;
export const RULES = {
  jungle: {
    [L_GIANT]: [E('tree_jungle_giant', 1, 7, 0.4)],
    [L_TREE]: [E('tree_jungle', 0.38, 3.2, TREE_G), E('tree_jungle_slender', 0.28, 1.4, TREE_G), E('tree_palm', 0.14, 1.4, TREE_G), E('tree_fern', 0.2, 0.9, TREE_G)],
    [L_MID]: [E('stump_jungle', 0.2, 1.0, 0.9), E('stump_cut', 0.06, 0.8, 0.9), E('log_fallen', 0.1, 1.2, 0.8), E('rock_mossy', 0.12, 1.3, 2.5), E('plant_fern_large', 0.26, 0.9, 1.0), E('plant_sapling', 0.14, 0.4, 1.0), E('roots_exposed', 0.12, 1.4, 0.8)],
    [L_GROUND]: [E('grass_broad', 0.3), E('grass_tall', 0.12), E('plant_fern', 0.18), E('plant_rosette', 0.04), E('flower_lily', 0.05), E('flower_spike', 0.05), E('flower_cluster', 0.03), E('flower_bell', 0.04),
      E('mushroom_button', 0.04), E('mushroom_toadstool', 0.03), E('mushroom_conical', 0.02), E('mushroom_cluster', 0.02), E('mushroom_giant', 0.02), E('vine_creeper', 0.03)],
  },
  plains: {
    [L_TREE]: [E('tree_oak', 0.45, 2.2, TREE_G), E('tree_birch', 0.35, 1.2, TREE_G), E('tree_wide', 0.2, 2.8, TREE_G)],
    [L_MID]: [E('plant_bush', 0.3, 0.7, 1.0), E('plant_shrub_small', 0.26, 0.5, 1.0), E('rock_boulder', 0.12, 1.0, 2.5), E('rock_mossy', 0.04, 1.3, 2.5), E('rock_slab', 0.06, 1.5, 2.5), E('rock_pebbles', 0.14, 0.3, 2.5), E('plant_rosette', 0.08, 0.3, 1.0)],
    [L_GROUND]: [E('grass_short', 0.36), E('grass_tall', 0.18), E('grass_wheat', 0.08), E('flower_daisy', 0.08), E('flower_tulip', 0.05), E('flower_bell', 0.04), E('flower_cluster', 0.03), E('flower_spike', 0.02),
      E('mushroom_button', 0.02), E('mushroom_toadstool', 0.015), E('mushroom_conical', 0.01), E('mushroom_cluster', 0.01)],
  },
  desert: {
    [L_GIANT]: [E('rock_arch', 0.85, 3.2, 0.45), E('rock_mesa', 0.15, 4.2, 0.45)],
    [L_TREE]: [E('cactus_saguaro', 0.3, 0.6, 0.6), E('cactus_column', 0.22, 0.4, 0.6), E('cactus_barrel', 0.22, 0.6, 0.6), E('cactus_prickly', 0.16, 0.6, 0.6), E('tree_dead', 0.10, 1.2, 0.6)],
    [L_MID]: [E('rock_sandstone', 0.28, 1.2, 2.5), E('rock_weathered', 0.22, 1.3, 2.5), E('rock_hoodoo', 0.12, 1.0, 2.5), E('plant_shrub_dry', 0.38, 0.6, 1.0)],
    [L_GROUND]: [E('grass_dry', 0.88), E('tumbleweed', 0.12)],
  },
  snow: {
    [L_TREE]: [E('tree_snow_pine', 0.4, 1.4, TREE_G), E('tree_snow_spruce', 0.4, 1.1, TREE_G), E('tree_snow_bare', 0.2, 1.4, TREE_G)],
    [L_MID]: [E('rock_snow', 0.4, 1.1, 2.5), E('rock_snowy', 0.25, 1.4, 3.0), E('ice_crystal', 0.25, 0.7, 2.0)],
    [L_GROUND]: [E('rock_snow', 1, 0, 2.5, 0.42)],           // 작은 눈더미
  },
  volcano: {
    [L_TREE]: [E('tree_burnt_full', 0.5, 1.1, 0.65), E('tree_burnt_partial', 0.5, 1.4, 0.65)],
    [L_MID]: [E('rock_lava', 0.2, 1.2, 3.0), E('rock_lava_ashy', 0.15, 1.5, 3.0), E('rock_basalt', 0.25, 1.4, 3.0), E('ash_mound', 0.15, 1.6, 2.0), E('stump_burnt', 0.1, 0.8, 1.2), E('log_burnt', 0.08, 1.2, 1.0), E('branch_burnt', 0.07, 0.8, 1.2)],
  },
  coast: {                                                    // 해안(수면 바로 위 모래) 전용
    [L_MID]: [E('driftwood', 0.35, 1.1, 0.8), E('rock_sea', 0.65, 1.2, 2.0)],
    [L_GROUND]: [E('reed_cattail', 1)],
  },
  shallow: {                                                  // 얕은 물 속 (수면 아래, 불투명 오브젝트만 추가)
    [L_MID]: [E('coral', 1, 0.5, 0.7)],
    [L_GROUND]: [E('seaweed', 1)],
  },
};

// 큰 종류의 발밑 반지름 찾기(작은 것이 피할 때 사용)
const FP = {};
for (const b of Object.values(RULES)) for (const arr of Object.values(b)) for (const e of arr) FP[e.id] = e.fp;
const FLAT = new Set(['ash_mound']);

export function createPlacer(T, seedIn) {
  const seed = (Number(seedIn) | 0) || 1;

  // ----- 무늬 필드(숲 덩어리/꽃밭 등): 0~1 -----
  const hv = (ix, iz, salt) => mix32(seed, salt, ix, iz) / 4294967296;
  const vnoise = (x, z, salt) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hv(ix, iz, salt), b = hv(ix + 1, iz, salt), c = hv(ix, iz + 1, salt), d = hv(ix + 1, iz + 1, salt);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const field = (x, z, scale, salt) => sstep(0.28, 0.72, vnoise(x / scale, z / scale, salt) * 0.68 + vnoise(x / scale * 2.3 + 7.1, z / scale * 2.3 - 3.7, salt + 1) * 0.32);

  // ----- 지형 샘플 (후보 1개당 1번) -----
  function site(x, z) {
    const h = T.height(x, z), e = 1.2;
    const gx = (T.height(x + e, z) - h) / e, gz = (T.height(x, z + e) - h) / e;
    const d = T.detail(x, z, h);
    return { x, z, h, gx, gz, g: Math.hypot(gx, gz), plain: d[0] + d[1], grass: d[0], dirt: d[1], village: d[3], jungle: d[4], desert: d[5], volc: d[6], lavaRock: d[7], pool: d[8], snow: d[9], rockPatch: d[10], ice: d[11] };
  }

  // ----- 후보 캐시 -----
  const candCache = new Map();
  const key = (layer, ix, iz) => layer * 268435456 + (ix + 8192) * 16384 + (iz + 8192);
  const finalCache = new Map();
  const ownerCache = { n: 0 };
  function trimCaches() {
    if (candCache.size > 24000) { candCache.clear(); finalCache.clear(); }
  }

  // 16칸 안에 수면 아래 땅이 있으면 물가
  function nearWater(x, z) {
    for (let i = 0; i < 8; i++) { const a = i * 0.7854; if (T.height(x + Math.cos(a) * 16, z + Math.sin(a) * 16) < WATER_LEVEL) return true; }
    return false;
  }

  // 지형 조건으로 어느 규칙 표를 쓸지 결정 (해안 > 얕은 물 > 지역)
  function pickBiome(s, r) {
    if (s.h < WATER_LEVEL - 0.7) return s.h > -7 ? 'shallow' : null;
    if (s.h < WATER_LEVEL + 0.3) return null;
    if (s.h < 4.0 && nearWater(s.x, s.z)) return 'coast';     // 물가의 모래만 해안 취급 (사막 저지대 등은 원래 지역으로)
    const w = [s.plain, s.jungle, s.desert, s.volc, s.snow];
    const names = ['plains', 'jungle', 'desert', 'volcano', 'snow'];
    let sum = 0; const q = [];
    for (let i = 0; i < 5; i++) { const v = Math.pow(Math.max(0, w[i]), 1.6); q.push(v); sum += v; }
    if (sum < 0.02) return null;
    let t = r * sum, k = 0;
    for (; k < 4; k++) { if (t < q[k]) break; t -= q[k]; }
    const wk = w[k];
    return { name: names[k], w: wk };
  }

  function chooseEntry(list, r, mult) {
    let sum = 0;
    for (let i = 0; i < list.length; i++) sum += list[i].w * (mult ? mult(list[i]) : 1);
    if (sum <= 0) return null;
    let t = r * sum;
    for (let i = 0; i < list.length; i++) { t -= list[i].w * (mult ? mult(list[i]) : 1); if (t < 0) return list[i]; }
    return list[list.length - 1];
  }

  // 스타일/크기 샘플 (nature.js의 randomStyle/randomScale과 같은 규칙, THREE 불필요)
  const rg = (r, [a, b]) => a + (b - a) * r();
  function styleOf(id, r) {
    const st = SPECIES[id].style;
    const o = { hue: rg(r, st.hue), sat: rg(r, st.sat), val: rg(r, st.val), phase: r() * 6.283, accentAmt: rg(r, st.accent) };
    if (st.accents) o.accent = st.accents[Math.floor(r() * st.accents.length)];
    return o;
  }

  // 정글 거대 나무와의 거리 (대표 나무 주변에 나무가 모이도록)
  function nearestGiant(x, z) {
    const c = CELL[L_GIANT], cx = Math.floor(x / c), cz = Math.floor(z / c);
    let best = Infinity, g = null;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const f = finalOf(L_GIANT, cx + dx, cz + dz);
      if (f && f.id === 'tree_jungle_giant') { const d = Math.hypot(f.x - x, f.z - z); if (d < best) { best = d; g = f; } }
    }
    return { d: best, g };
  }

  // 후보 1개의 "사전 통과" 결과(지형/밀도 판정만, 겹침 정리 전). null이면 탈락.
  function preOf(layer, ix, iz) {
    const k = key(layer, ix, iz);
    if (candCache.has(k)) return candCache.get(k);
    const r = rng32(mix32(seed, 100 + layer, ix, iz));
    const c = CELL[layer];
    const x = (ix + r()) * c, z = (iz + r()) * c;
    const prio = r(), rBiome = r(), rSpec = r(), rAcc = r(), rVar = r();
    let out = null;
    if (Math.hypot(x, z) < PLAY_RADIUS - 6) out = decide(layer, x, z, prio, rBiome, rSpec, rAcc, rVar, r);
    candCache.set(k, out);
    return out;
  }

  function decide(layer, x, z, prio, rBiome, rSpec, rAcc, rVar, r) {
    if (coneRatio(x, z) < CONE_CLEAR) return null;                   // 화산 옆면/분화구 안쪽은 비움
    const s = site(x, z);
    if (s.h > 300) return null;
    // 시작마을 / 분화구 용암 / 얼음 호수 제외
    const vil = 1 - sstep(VILLAGE.r * 0.9, VILLAGE.r + VILLAGE.blend * 0.6, Math.hypot(x - VILLAGE.x, z - VILLAGE.z));
    if (vil > 0.25 || s.pool > 0.02) return null;
    const b = pickBiome(s, rBiome);
    if (!b) return null;
    const bn = typeof b === 'string' ? b : b.name;
    const table = RULES[bn] && RULES[bn][layer];
    if (!table) return null;
    const edge = typeof b === 'string' ? 1 : sstep(0.12, 0.5, b.w);     // 지역 경계에서는 성기게
    const iceHere = s.ice > 0.3;
    let p = 0, entry = null, mult = null;

    // ---- 층/지역별 밀도 ----
    const grove = (sc, salt) => field(x, z, sc, salt);
    if (layer === L_GIANT) {
      if (bn === 'jungle') { p = 0.75 * sstep(0.55, 0.85, b.w); entry = chooseEntry(table, rSpec); if (s.h < 5 || s.h > 150) p = 0; }
      else if (bn === 'desert') { p = 0.7 * sstep(0.5, 0.8, b.w); entry = chooseEntry(table, rSpec); }
    } else if (layer === L_TREE) {
      if (bn === 'jungle') { const gd = nearestGiant(x, z); p = 1.0 * (0.4 + 0.9 * grove(60, 11)) * (1 + 1.2 * Math.exp(-Math.pow(gd.d / 45, 2))); }
      else if (bn === 'plains') p = 0.19 * (0.3 + 1.3 * grove(70, 12));                 // 평원: 성기게, 군데군데 작은 숲
      else if (bn === 'desert') p = 0.3 * (0.2 + 1.2 * grove(80, 13));
      else if (bn === 'snow') p = iceHere ? 0 : 0.55 * (0.15 + 1.2 * grove(70, 14)) * (1 - sstep(80, 130, s.h));
      else if (bn === 'volcano') p = 0.4 * (0.3 + 1.1 * grove(60, 15)) * (1 - 0.7 * s.lavaRock) * (1 - sstep(120, 200, s.h));
      entry = chooseEntry(table, rSpec);
    } else if (layer === L_MID) {
      if (bn === 'jungle') p = 0.42 * (0.4 + 0.9 * grove(35, 21));
      else if (bn === 'plains') p = 0.28 * (0.35 + 1.0 * grove(40, 22));
      else if (bn === 'desert') p = 0.3 * (0.4 + 0.9 * grove(45, 23));
      else if (bn === 'snow') { p = iceHere ? 0.1 : 0.3 * (0.4 + 0.9 * grove(40, 24)) * (1 + 1.5 * s.rockPatch); mult = iceHere ? (e) => (e.id === 'ice_crystal' ? 1 : 0) : (e) => (e.id === 'ice_crystal' ? 0 : e.id === 'rock_snowy' ? 1 + 3 * s.rockPatch : 1); }
      else if (bn === 'volcano') { p = 0.6 * (0.4 + 0.9 * grove(40, 25)); mult = (e) => (e.id === 'rock_lava' ? 0.4 + 1.8 * s.lavaRock : e.id === 'ash_mound' ? 0.6 + s.lavaRock : 1); }
      else if (bn === 'coast') p = 0.11 * (0.3 + 1.2 * grove(30, 26));
      else if (bn === 'shallow') p = 0.12 * grove(26, 27) * (s.h > -6 ? 1 : 0);        // 산호는 덩어리로
      entry = chooseEntry(table, rSpec, mult);
    } else {
      // 땅 덮개(잔디/꽃/버섯/작은 눈더미/갈대/해초): 지면 재질 + 무늬 필드로 분포. 버섯은 나무 근처 판정이 필요해서 아래 expand()에서 한 번 더 조정.
      if (bn === 'jungle') p = 0.6 * (0.55 + 0.45 * grove(18, 31));
      else if (bn === 'plains') p = 0.56 * (0.3 + 0.7 * Math.min(1, s.grass / Math.max(0.05, s.plain))) * (0.55 + 0.45 * grove(24, 32));
      else if (bn === 'desert') p = 0.11 * (0.4 + 0.9 * grove(30, 33));
      else if (bn === 'snow') p = iceHere ? 0 : 0.06 * (0.3 + 0.9 * grove(30, 34));
      else if (bn === 'coast') p = s.h < 2.4 ? 0.3 * grove(16, 35) : 0;                // 갈대는 물가 얼룩
      else if (bn === 'shallow') p = 0.2 * grove(14, 36);
      else p = 0;
      entry = chooseEntry(table, rSpec);
    }
    if (!entry || SKIP_HANG.has(entry.id)) return null;
    {
      const sp0 = SPECIES[entry.id], dn = DENSITY[bn];
      const isTree = sp0.base === 'tree' && !entry.id.startsWith('cactus') && bn !== 'shallow';
      if (bn === 'desert' && isTree) return null;                   // 사막: 선인장 외 나무 삭제
      if (dn) {
        if (isTree) p *= dn.tree;
        else if (sp0.base === 'rock' && layer === L_MID && entry.id !== 'ice_crystal') p *= dn.rock;
      }
    }
    p *= edge;
    if (rAcc >= p) return null;
    if (s.g > entry.g) return null;
    const sp = SPECIES[entry.id];
    const scale = (sp.scale[0] + (sp.scale[1] - sp.scale[0]) * r()) * entry.sm;
    return { layer, biome: bn, bw: typeof b === 'string' ? 1 : b.w, id: entry.id, fp: entry.fp * scale, x, z, prio, s, scale, rVar, entry };
  }

  // 겹침 정리: 같은/더 큰 층의 사전 통과 후보와 겹치면 우선순위가 낮은 쪽이 탈락.
  function finalOf(layer, ix, iz) {
    const k = key(layer, ix, iz);
    if (finalCache.has(k)) return finalCache.get(k);
    const me = preOf(layer, ix, iz);
    let out = me;
    if (me && layer !== L_GROUND) {
      outer:
      for (let L2 = 0; L2 <= layer; L2++) {
        const c = CELL[L2], rad = me.fp + MAXFP[L2] + 0.4;
        const x0 = Math.floor((me.x - rad) / c), x1 = Math.floor((me.x + rad) / c), z0 = Math.floor((me.z - rad) / c), z1 = Math.floor((me.z + rad) / c);
        for (let jz = z0; jz <= z1; jz++) for (let jx = x0; jx <= x1; jx++) {
          if (L2 === layer && jx === ix && jz === iz) continue;
          const o = preOf(L2, jx, jz);
          if (!o) continue;
          const stronger = L2 < layer || o.prio > me.prio;
          if (!stronger) continue;
          // 거대 나무 아래(수관)에는 일반 나무를 허용하지 않고(몸통 주변 비움), 그 밖은 발밑 반지름 합으로 판정
          const gap = o.id === 'tree_jungle_giant' && layer === L_TREE ? 0.9 : 0.3;
          if (Math.hypot(o.x - me.x, o.z - me.z) < o.fp + me.fp + gap) { out = null; break outer; }
        }
      }
    }
    finalCache.set(k, out);
    return out;
  }

  // 변환 값 계산: 위치 높이, 경사에 따른 기울임/묻힘
  function toItem(c, x, z, id, scale, rr) {
    const s = c.s;
    const sp = SPECIES[id], base = sp.base;
    const yaw = rr() * 6.2832;
    const g = s.g;
    let tilt = 0, tiltAz = 0, sink;
    // 지면 법선 쪽으로 기울이는 정도: 바위/눈더미는 지면에 붙이고, 나무/선인장은 거의 수직, 풀/꽃은 약하게
    const follow = base === 'rock' ? 0.8 : base === 'stump' ? 0.5 : base === 'tree' ? 0.12 : 0.3;
    const sm = Math.min(g, 1.2);
    // 월드 기울임 방향(−∇h) → 모델 로컬(요 회전 역변환) → (tilt, tiltAz)
    const wx = -s.gx * follow, wz = -s.gz * follow;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const lx = wx * cy - wz * sy, lz = wx * sy + wz * cy;
    tilt = Math.hypot(lx, lz); tiltAz = Math.atan2(lz, -lx);
    if (tilt > 0.5) { const k = 0.5 / tilt; tilt = 0.5; void k; }
    const jitter = (base === 'tree' || base === 'stump') ? (rr() - 0.5) * 0.08 : (rr() - 0.5) * 0.12;
    tilt += Math.abs(jitter); if (!tiltAz && jitter) tiltAz = rr() * 6.283;
    // 묻힘: 경사에서 비탈 위쪽이 파묻히도록 바닥을 낮춤
    const fp = FP[id] || 0.2;
    sink = (base === 'tree' ? 0.12 : base === 'rock' ? 0.1 : base === 'stump' ? 0.08 : 0.02) * scale + sm * fp * scale * (base === 'rock' ? 0.35 : 0.5);
    if (FLAT.has(id)) sink *= 0.4;
    const underwater = c.biome === 'shallow';
    const y = (underwater ? T.height(x, z) : s.h) - sink;
    const ss = styleOf(id, rr);
    return { id, v: Math.floor(c.rVar * NVAR[c.layer]) % NVAR[c.layer], x, y, z, yaw, scale, tilt, tiltAz, style: ss, layer: c.layer, biome: c.biome, fp: fp * scale };
  }

  // 후보 1개 → 실제 오브젝트(들). 꽃/버섯/풀은 작은 무리로 퍼뜨림.
  function expand(c, ix, iz, blockers) {
    const rr = rng32(mix32(seed, 200 + c.layer, ix, iz));
    const out = [];
    const id = c.id, base = SPECIES[id].base;
    if (c.layer !== L_GROUND) { out.push(toItem(c, c.x, c.z, id, c.scale, rr)); return out; }
    // 땅 덮개: 큰 오브젝트 발밑 피하기 + 버섯 위치 조정
    const clumpable = (base === 'flower' && id !== 'flower_cluster') || (base === 'mushroom' && id !== 'mushroom_cluster') || id === 'grass_tall' || id === 'grass_wheat';
    const n = clumpable ? 1 + Math.floor(rr() * (base === 'mushroom' ? 3 : base === 'flower' ? 4 : 2)) : 1;
    for (let i = 0; i < n; i++) {
      let x = c.x, z = c.z, s = c.s;
      if (i > 0) { const a = rr() * 6.2832, d = 0.25 + rr() * (base === 'grass' ? 1.1 : 0.8); x += Math.cos(a) * d; z += Math.sin(a) * d; s = site(x, z); if (s.g > 1.0 || s.h < WATER_LEVEL + 0.2 && c.biome !== 'shallow') continue; }
      if (blockers && blocked(blockers, x, z)) continue;
      const cc = i > 0 ? { ...c, s } : c;
      const sc = i > 0 ? (SPECIES[id].scale[0] + (SPECIES[id].scale[1] - SPECIES[id].scale[0]) * rr()) * c.entry.sm : c.scale;
      out.push(toItem(cc, x, z, id, sc, rr));
    }
    return out;
  }
  const blocked = (list, x, z) => { for (let i = 0; i < list.length; i++) { const o = list[i]; const r = o.fp + 0.25; const dx = o.x - x, dz = o.z - z; if (dx * dx + dz * dz < r * r) return true; } return false; };

  // 근처에 있는 최종 큰 오브젝트 목록 (땅 덮개가 피하거나 버섯이 모일 곳 판단)
  function bigNear(x, z, rad) {
    const res = [];
    for (let L2 = 0; L2 <= L_MID; L2++) {
      const c = CELL[L2], r2 = rad + MAXFP[L2];
      const x0 = Math.floor((x - r2) / c), x1 = Math.floor((x + r2) / c), z0 = Math.floor((z - r2) / c), z1 = Math.floor((z + r2) / c);
      for (let jz = z0; jz <= z1; jz++) for (let jx = x0; jx <= x1; jx++) { const f = finalOf(L2, jx, jz); if (f) res.push(f); }
    }
    return res;
  }

  // 한 청크의 오브젝트를 층 순서대로, 셀 한 줄(row)마다 yield 하면서 만든다. (프레임당 계산 시간을 잘게 나누기 위해)
  function* chunkGenerator(cx, cz, S = CHUNK) {
    const x0 = cx * S, z0 = cz * S, x1 = x0 + S, z1 = z0 + S;
    const items = [];
    trimCaches();
    const range = (layer, m) => { const c = CELL[layer]; return [Math.floor((x0 - m) / c), Math.floor((x1 - 1e-6 + m) / c), Math.floor((z0 - m) / c), Math.floor((z1 - 1e-6 + m) / c)]; };
    // 1) 대표/나무/중간 층: 이 청크 안의 것을 만든다
    for (let layer = L_GIANT; layer <= L_MID; layer++) {
      const [ix0, ix1, iz0, iz1] = range(layer, 0);
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const f = finalOf(layer, ix, iz);
          if (!f || !(f.x >= x0 && f.x < x1 && f.z >= z0 && f.z < z1)) continue;
          for (const it of expand(f, ix, iz, null)) items.push(it);
          yield;
        }
      }
    }
    // 2) 바닥 덮개가 가장자리에서 피할 이웃 청크의 큰 오브젝트를 미리 계산해 둔다 (캐시를 줄 단위로 채워서 한 프레임에 몰리지 않게)
    for (let layer = L_GIANT; layer <= L_MID; layer++) {
      const [ix0, ix1, iz0, iz1] = range(layer, 5.4 + MAXFP[layer]);
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) { finalOf(layer, ix, iz); yield; }
    }
    // 3) 바닥 덮개(잔디/꽃/버섯/눈더미/갈대/해초): 큰 오브젝트 발밑을 피하고, 무리를 지어 퍼뜨림
    const [gx0, gx1, gz0, gz1] = range(L_GROUND, 1.6);
    let gc = 0;
    for (let iz = gz0; iz <= gz1; iz++) {
      for (let ix = gx0; ix <= gx1; ix++) {
        if ((++gc & 3) === 0) yield;                     // 네 칸마다 양보
        const pre = preOf(L_GROUND, ix, iz);
        if (!pre) continue;
        if (pre.x < x0 - 1.6 || pre.x >= x1 + 1.6 || pre.z < z0 - 1.6 || pre.z >= z1 + 1.6) continue;   // 무리가 퍼져도 이 청크에 못 닿음
        const blockers = bigNear(pre.x, pre.z, 2.2 + 1.6);
        const base = SPECIES[pre.id].base;
        if (base === 'mushroom') {
          // 버섯: 나무/그루터기 근처에서 잘 나오고(평원은 훨씬 제한적), 무늬 필드가 높은 곳에 모임
          let near = 0;
          for (const o of blockers) { const b = SPECIES[o.id].base; if ((b === 'tree' || b === 'stump') && Math.hypot(o.x - pre.x, o.z - pre.z) < o.fp + 5) { near = 1; break; } }
          const dense = field(pre.x, pre.z, 16, 41);
          const keep = pre.biome === 'plains' ? (near ? 0.55 : 0.08) * dense : (near ? 1 : 0.3) * (0.4 + 0.6 * dense);
          if (rng32(mix32(seed, 300, ix, iz))() >= keep) continue;
        } else if (base === 'flower' && pre.biome !== 'coast') {
          const meadow = field(pre.x, pre.z, 22, 42);               // 꽃밭: 꽃은 꽃밭 필드가 높은 곳에 몰림
          if (rng32(mix32(seed, 301, ix, iz))() >= 0.25 + 0.75 * meadow) continue;
        } else if (pre.id === 'grass_wheat') {
          if (rng32(mix32(seed, 302, ix, iz))() >= field(pre.x, pre.z, 30, 43)) continue;
        } else if (pre.biome === 'plains' && base === 'grass') {
          if (rng32(mix32(seed, 303, ix, iz))() < pre.s.dirt * 0.8) continue;   // 흙 얼룩 위에는 풀이 적게
        }
        for (const it of expand(pre, ix, iz, blockers)) if (it.x >= x0 && it.x < x1 && it.z >= z0 && it.z < z1) items.push(it);
      }
    }
    return items;
  }

  function placeChunk(cx, cz, S = CHUNK) {
    const g = chunkGenerator(cx, cz, S);
    let r; do { r = g.next(); } while (!r.done);
    return r.value;
  }

  // 3x3 이웃 청크가 서로 독립적으로 만들어져도 같은 결과인지 검증할 때 쓰는 캐시 초기화
  function resetCaches() { candCache.clear(); finalCache.clear(); }

  return { chunkGenerator, placeChunk, site, resetCaches, preOf, finalOf, cells: CELL, nvar: NVAR, seed };
}

// 인스턴스 행렬(열 우선 16개) 계산: kit.setInstance와 같은 오일러 'YXZ' 회전 + 균등 스케일
export function composeMatrix(out, o, t) {
  const cx = Math.cos(t.tilt ? Math.sin(t.tiltAz || 0) * t.tilt : 0), sx = Math.sin(t.tilt ? Math.sin(t.tiltAz || 0) * t.tilt : 0);
  const cz = Math.cos(t.tilt ? Math.cos(t.tiltAz || 0) * t.tilt : 0), sz = Math.sin(t.tilt ? Math.cos(t.tiltAz || 0) * t.tilt : 0);
  const cy = Math.cos(t.yaw || 0), sy = Math.sin(t.yaw || 0), k = t.scale ?? 1;
  // R = Ry * Rx * Rz
  const r00 = cy * cz + sy * sx * sz, r01 = -cy * sz + sy * sx * cz, r02 = sy * cx;
  const r10 = cx * sz, r11 = cx * cz, r12 = -sx;
  const r20 = -sy * cz + cy * sx * sz, r21 = sy * sz + cy * sx * cz, r22 = cy * cx;
  out[o] = r00 * k; out[o + 1] = r10 * k; out[o + 2] = r20 * k; out[o + 3] = 0;
  out[o + 4] = r01 * k; out[o + 5] = r11 * k; out[o + 6] = r21 * k; out[o + 7] = 0;
  out[o + 8] = r02 * k; out[o + 9] = r12 * k; out[o + 10] = r22 * k; out[o + 11] = 0;
  out[o + 12] = t.x; out[o + 13] = t.y; out[o + 14] = t.z; out[o + 15] = 1;
}
