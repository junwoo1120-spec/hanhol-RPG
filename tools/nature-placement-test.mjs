// 4단계 검증: 지형별 자연 오브젝트 배치 + 월드 매니저 (THREE 없이 가짜 kit으로)
//   실행: node tools/nature-placement-test.mjs
import { makeTerrain, PLAY_RADIUS, WATER_LEVEL, VILLAGE, LANDMARKS } from '../public/js/terrain.js';
import { createPlacer, composeMatrix, drawRule, RULES, SKIP_HANG, GIANT_CELL, CHUNK, L_GIANT, L_TREE, L_MID, L_GROUND } from '../public/js/nature-placement.js';
import { createNatureWorld } from '../public/js/nature-world.js';
import { SPECIES, buildSpecies } from '../public/js/nature-geo.js';

let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log('  ✗ 실패:', msg); } };
const sec = (t) => console.log('\n■ ' + t);
const SEED = 12345;
const T = makeTerrain(SEED);
const P = createPlacer(T, SEED);
const key = (o) => `${o.id}|${o.x.toFixed(4)}|${o.z.toFixed(4)}`;
const names = ['plains', 'jungle', 'desert', 'volcano', 'snow'];
const labels = { plains: '평원', jungle: '정글', desert: '사막', volcano: '화산', snow: '설원' };
const layerName = ['대표', '나무', '중간', '바닥'];

// 지역별 대표 청크 고르기 (한 지역이 0.85 이상 + 육지 + 마을/용암/얼음 아님)
const pick = Object.fromEntries(names.map((n) => [n, []]));
for (let cx = -42; cx <= 42; cx++) for (let cz = -42; cz <= 42; cz++) {
  const x = cx * 32 + 16, z = cz * 32 + 16; if (Math.hypot(x, z) > PLAY_RADIUS - 60) continue;
  const s = P.site(x, z), w = [s.plain, s.jungle, s.desert, s.volc, s.snow]; let k = 0; for (let i = 1; i < 5; i++) if (w[i] > w[k]) k = i;
  if (w[k] > 0.85 && s.h > 5 && s.village < 0.05 && s.pool < 0.01 && s.ice < 0.2) pick[names[k]].push([cx, cz]);
}
const sample = (n, m = 40) => { const a = pick[n]; const st = Math.max(1, Math.floor(a.length / m)); return a.filter((_, i) => i % st === 0).slice(0, m); };

// ---------------------------------------------------------------
sec('1. 결정성: 같은 시드 → 같은 결과 (청크를 다시 불러와도 같은 위치)');
{
  const [cx, cz] = sample('jungle', 5)[2];
  const a = JSON.stringify(P.placeChunk(cx, cz));
  P.resetCaches();
  const b = JSON.stringify(P.placeChunk(cx, cz));
  ok(a === b, '캐시를 비운 뒤 다시 만들면 동일해야 함');
  // 이웃 청크를 먼저/나중에 만들어도 같은 결과 (생성 순서 무관)
  const P2 = createPlacer(T, SEED);
  for (const [dx, dz] of [[1, 1], [-1, 0], [0, -1], [1, -1], [-1, 1]]) P2.placeChunk(cx + dx, cz + dz);
  ok(JSON.stringify(P2.placeChunk(cx, cz)) === a, '이웃 청크 생성 순서와 무관해야 함');
  // 제너레이터를 잘게 나눠 실행해도 동일
  const g = P.chunkGenerator(cx, cz); let r, steps = 0; P.resetCaches(); do { r = g.next(); steps++; } while (!r.done);
  ok(JSON.stringify(r.value) === a, '프레임 분산(제너레이터) 실행도 동일');
  console.log(`  청크 (${cx},${cz}) 오브젝트 ${JSON.parse(a).length}개, 분산 단계 ${steps}번`);
  const P3 = createPlacer(T, SEED + 1);
  ok(JSON.stringify(P3.placeChunk(cx, cz)) !== a, '다른 시드는 다른 배치');
}

sec('2. 청크 경계: 중복/누락 없음 (32칸 청크 9개 합 == 96칸 큰 청크 1개)');
for (const n of names) {
  const [cx, cz] = sample(n, 10)[4];
  const bx = Math.floor(cx / 3) * 3, bz = Math.floor(cz / 3) * 3;
  const small = new Map(); let dup = 0, outside = 0;
  for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) {
    for (const o of P.placeChunk(bx + dx, bz + dz)) {
      const k = key(o); if (small.has(k)) dup++; small.set(k, o);
      const x0 = (bx + dx) * 32, z0 = (bz + dz) * 32;
      if (!(o.x >= x0 && o.x < x0 + 32 && o.z >= z0 && o.z < z0 + 32)) outside++;
    }
  }
  const big = P.placeChunk(bx / 3, bz / 3, 96);
  const bigKeys = new Set(big.map(key));
  let missing = 0; for (const k of small.keys()) if (!bigKeys.has(k)) missing++;
  ok(dup === 0, `${labels[n]}: 중복 ${dup}개`);
  ok(outside === 0, `${labels[n]}: 청크 밖 오브젝트 ${outside}개`);
  ok(missing === 0 && big.length === small.size, `${labels[n]}: 작은 청크 합(${small.size}) != 큰 청크(${big.length})`);
  console.log(`  ${labels[n]}: ${small.size}개, 중복 ${dup}, 경계 밖 ${outside}, 불일치 ${missing}`);
}

sec('3. 겹침/규칙: 큰 오브젝트끼리 겹치지 않음, 지형 조건 지킴');
{
  let pairs = 0, overlap = 0, worst = 1e9, bad = { slope: 0, water: 0, village: 0, lava: 0, hang: 0, range: 0, biome: 0, height: 0 };
  const allowed = {}; for (const [b, t] of Object.entries(RULES)) { allowed[b] = new Set(); for (const arr of Object.values(t)) for (const e of arr) allowed[b].add(e.id); }
  const treeMaxG = { plains: 0.7, jungle: 0.7, desert: 0.6, snow: 0.7, volcano: 0.65 };
  let checked = 0;
  for (const n of names) {
    const items = [];
    for (const [cx, cz] of sample(n, 14)) for (const o of P.placeChunk(cx, cz)) items.push(o);
    // 큰 오브젝트(대표/나무/중간) 쌍 검사. 샘플 청크는 흩어져 있어도 같은 청크 내/경계 쌍은 포함됨
    const big = items.filter((o) => o.layer <= L_MID && o.fp > 0);
    big.sort((a, b) => a.x - b.x);
    for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length && big[j].x - big[i].x < 12; j++) {
      const d = Math.hypot(big[i].x - big[j].x, big[i].z - big[j].z); pairs++;
      const gap = d - big[i].fp - big[j].fp; worst = Math.min(worst, gap);
      if (gap < -0.01) overlap++;
    }
    for (const o of items) {
      checked++;
      const s = P.site(o.x, o.z);
      if (SKIP_HANG.has(o.id)) bad.hang++;
      if (Math.hypot(o.x, o.z) > PLAY_RADIUS) bad.range++;
      if (!allowed[o.biome] || !allowed[o.biome].has(o.id)) bad.biome++;
      const base = SPECIES[o.id].base;
      if (o.biome !== 'shallow' && s.h < WATER_LEVEL + 0.2) bad.water++;
      if (o.biome === 'shallow' && s.h > WATER_LEVEL) bad.water++;
      if (1 - Math.min(1, Math.max(0, (Math.hypot(o.x - VILLAGE.x, o.z - VILLAGE.z) - VILLAGE.r * 0.9) / (VILLAGE.r + VILLAGE.blend * 0.6 - VILLAGE.r * 0.9))) > 0.3) bad.village++;
      if (s.pool > 0.03) bad.lava++;
      if (base === 'tree' && o.layer === L_TREE && s.g > (treeMaxG[o.biome] ?? 0.7) + 0.35) bad.slope++;   // 후보 위치와 묻힘 보정 위치 차이 여유
      if (s.h > 300) bad.height++;
    }
  }
  console.log(`  검사 ${checked}개, 큰 오브젝트 근접 쌍 ${pairs}, 최소 여유 ${worst.toFixed(2)}`);
  ok(overlap === 0, `큰 오브젝트 겹침 ${overlap}쌍`);
  for (const [k, v] of Object.entries(bad)) ok(v === 0, `규칙 위반 ${k}: ${v}개`);
  console.log('  위반:', JSON.stringify(bad));
}

sec('4. 격자 아님: 분포가 불규칙 (Clark-Evans R: 격자≈2.1, 무작위≈1, 군집<1) / 밀집·빈 공간');
for (const n of ['jungle', 'plains', 'desert', 'snow']) {
  const pts = []; const cells = sample(n, 30);
  for (const [cx, cz] of cells) for (const o of P.placeChunk(cx, cz)) if (o.layer === L_TREE) pts.push(o);
  // 각 청크 안에서만 최근접 거리 계산 (경계 효과 줄이기: 청크 중앙 16x16 안의 점만 기준으로, 이웃은 같은 청크 전체)
  let sum = 0, cnt = 0, area = 0;
  for (const [cx, cz] of cells) {
    const mine = pts.filter((o) => Math.floor(o.x / 32) === cx && Math.floor(o.z / 32) === cz);
    for (const o of mine) {
      if (o.x < cx * 32 + 8 || o.x > cx * 32 + 24 || o.z < cz * 32 + 8 || o.z > cz * 32 + 24) continue;
      let best = 1e9; for (const q of mine) if (q !== o) best = Math.min(best, Math.hypot(q.x - o.x, q.z - o.z));
      if (best < 1e9) { sum += best; cnt++; }
    }
    area += 1024;
  }
  const dens = pts.length / area, R = cnt ? (sum / cnt) / (0.5 / Math.sqrt(dens)) : 0;
  // 청크당 개수의 변동 (밀집/빈 공간): 변동계수
  const per = cells.map(([cx, cz]) => pts.filter((o) => Math.floor(o.x / 32) === cx && Math.floor(o.z / 32) === cz).length);
  const mean = per.reduce((a, b) => a + b, 0) / per.length, sd = Math.sqrt(per.reduce((a, b) => a + (b - mean) ** 2, 0) / per.length);
  // 후보 셀 좌표 정렬 여부: x를 셀 크기로 나눈 나머지 분포가 균등한지 (격자라면 한 곳에 몰림)
  const bins = new Array(8).fill(0); for (const o of pts) bins[Math.min(7, Math.floor(((o.x % 8.5 + 8.5) % 8.5) / 8.5 * 8))]++;
  const exp = pts.length / 8, chi = bins.reduce((a, b) => a + (b - exp) ** 2 / exp, 0);
  console.log(`  ${labels[n]}: 나무 ${pts.length}그루, R=${R.toFixed(2)}, 청크당 ${mean.toFixed(1)}±${sd.toFixed(1)} (최소 ${Math.min(...per)} 최대 ${Math.max(...per)}), 셀 위상 chi2=${chi.toFixed(1)}`);
  ok(R > 0.7 && R < 1.7, `${labels[n]}: 나무 분포 R=${R.toFixed(2)} 가 무작위 범위를 벗어남`);
  ok(sd / Math.max(mean, 0.1) > 0.2, `${labels[n]}: 밀집/빈 공간 차이가 너무 작음`);
  ok(chi < 24, `${labels[n]}: 셀 위상이 한쪽으로 쏠림(격자 느낌) chi2=${chi.toFixed(1)}`);
}

sec('5. 지형별 배치 결과 (청크당 평균, 샘플 40청크)');
const triOf = {}; const tri = (id, lod) => (triOf[id + lod] ??= buildSpecies(id, 1, lod).triCount);
const perBiome = {};
for (const n of names) {
  const cs = sample(n, 40), cnt = {}, byL = [0, 0, 0, 0]; let tot = 0;
  for (const [cx, cz] of cs) for (const o of P.placeChunk(cx, cz)) { cnt[o.id] = (cnt[o.id] || 0) + 1; byL[o.layer]++; tot++; }
  perBiome[n] = { cs, cnt };
  console.log(`  [${labels[n]}] 청크당 ${(tot / cs.length).toFixed(0)}개 (대표/나무/중간/바닥 ${byL.map((v) => (v / cs.length).toFixed(1)).join(' / ')})`);
  console.log('     ' + Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / cs.length).toFixed(1)}`).join(', '));
}
{
  // 대표 나무/아치 개수
  const n = Math.ceil(PLAY_RADIUS / GIANT_CELL), g = {};
  for (let ix = -n; ix <= n; ix++) for (let iz = -n; iz <= n; iz++) { const f = P.finalOf(L_GIANT, ix, iz); if (f) (g[f.id] ||= []).push([Math.round(f.x), Math.round(f.z)]); }
  for (const [id, a] of Object.entries(g)) console.log(`  월드 전체 ${id}: ${a.length}개 ${a.slice(0, 6).map((p) => `(${p})`).join(' ')}${a.length > 6 ? ' ...' : ''}`);
  ok((g.tree_jungle_giant || []).length >= 1, '정글에 대표(거대) 나무가 최소 1그루');
  ok((g.rock_arch || []).length >= 1, '사막에 암석 아치가 최소 1개');
  for (const [x, z] of g.tree_jungle_giant || []) { const s = P.site(x, z); ok(s.jungle > 0.5, `대표 나무 (${x},${z})가 정글 밖`); }
  // 해안/바다
  let coast = 0, shallow = 0, deepBad = 0, seaChunks = 0;
  for (let cx = -42; cx <= 42; cx++) for (let cz = -42; cz <= 42; cz++) {
    const x = cx * 32 + 16, z = cz * 32 + 16; if (Math.hypot(x, z) > PLAY_RADIUS - 60) continue;
    const h = T.height(x, z); if (h > -25 && h < 6 && (cx + cz) % 3 === 0) { seaChunks++; for (const o of P.placeChunk(cx, cz)) { if (o.biome === 'coast') coast++; if (o.biome === 'shallow') shallow++; } }
  }
  console.log(`  바다/해안 청크 ${seaChunks}개 샘플: 해안 오브젝트 ${coast}, 얕은 물 오브젝트 ${shallow}`);
  ok(coast > 0 && shallow > 0, '해안/얕은 물 오브젝트가 있어야 함');
  const deep = P.placeChunk(Math.floor(LANDMARKS[1].x / 32), Math.floor(LANDMARKS[1].z / 32));
  ok(deep.length === 0, `깊은 바다 한가운데에는 오브젝트 없음 (${deep.length}개)`);
  const vil = P.placeChunk(0, 0).length + P.placeChunk(-1, -1).length;
  ok(vil === 0, `시작마을 중심 청크에는 오브젝트 없음 (${vil}개)`);
}

sec('6. 행렬 계산이 three의 오일러 YXZ와 같음 + 경사에 붙음');
{
  const q = (ex, ey, ez) => { const c1 = Math.cos(ex / 2), c2 = Math.cos(ey / 2), c3 = Math.cos(ez / 2), s1 = Math.sin(ex / 2), s2 = Math.sin(ey / 2), s3 = Math.sin(ez / 2);
    return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3]; };   // three Euler 'YXZ' -> quaternion
  const mq = ([x, y, z, w], k) => [(1 - 2 * (y * y + z * z)) * k, (2 * (x * y + z * w)) * k, (2 * (x * z - y * w)) * k, 0, (2 * (x * y - z * w)) * k, (1 - 2 * (x * x + z * z)) * k, (2 * (y * z + x * w)) * k, 0, (2 * (x * z + y * w)) * k, (2 * (y * z - x * w)) * k, (1 - 2 * (x * x + y * y)) * k, 0];
  let maxErr = 0;
  for (let i = 0; i < 200; i++) {
    const t = { x: i, y: 2, z: -i, yaw: i * 0.37, scale: 0.8 + (i % 7) * 0.1, tilt: (i % 5) * 0.1, tiltAz: i * 0.9 };
    const out = new Float32Array(16); composeMatrix(out, 0, t);
    const ex = t.tilt ? Math.sin(t.tiltAz) * t.tilt : 0, ez = t.tilt ? Math.cos(t.tiltAz) * t.tilt : 0;
    const ref = mq(q(ex, t.yaw, ez), t.scale);
    for (let k = 0; k < 12; k++) maxErr = Math.max(maxErr, Math.abs(out[k] - ref[k]));
  }
  ok(maxErr < 1e-5, `composeMatrix가 three 규칙과 다름 (오차 ${maxErr})`);
  console.log(`  three 규칙과 최대 오차 ${maxErr.toExponential(1)}`);
  // 바위가 경사면 법선 쪽으로 서는지: 위쪽 벡터와 법선 사이 각도
  let n = 0, sumDeg = 0, worst = 0;
  for (const [cx, cz] of sample('snow', 40)) for (const o of P.placeChunk(cx, cz)) {
    if (SPECIES[o.id].base !== 'rock') continue; const s = P.site(o.x, o.z); if (s.g < 0.4 || s.g > 1.2) continue;
    const m = new Float32Array(16); composeMatrix(m, 0, o);
    const up = [m[4] / o.scale, m[5] / o.scale, m[6] / o.scale], nl = Math.hypot(s.gx, 1, s.gz), nrm = [-s.gx / nl, 1 / nl, -s.gz / nl];
    const ang = Math.acos(Math.min(1, up[0] * nrm[0] + up[1] * nrm[1] + up[2] * nrm[2])) * 180 / Math.PI;
    const flat = Math.acos(nrm[1]) * 180 / Math.PI;   // 안 기울였을 때 법선과의 각도
    n++; sumDeg += ang / flat; worst = Math.max(worst, ang / flat);
  }
  console.log(`  경사 0.4~1.2의 바위 ${n}개: 지면 법선과의 어긋남이 기울이지 않을 때의 평균 ${(sumDeg / Math.max(1, n) * 100).toFixed(0)}% (작을수록 지면에 붙음)`);
  ok(n > 5 && sumDeg / n < 0.6, '경사 위 바위가 지면 쪽으로 기울지 않음');
}

// ---------------------------------------------------------------
// 월드 매니저 (가짜 THREE)
const real = (id, lod) => tri(id, lod);
const mkKit = () => {
  const made = []; let disposed = 0;
  const kit = {
    THREE: { Vector3: class { constructor() { this.x = 0; this.y = 0; this.z = 0; } }, Color: class { constructor(h) { this.r = (h >> 16 & 255) / 255; this.g = (h >> 8 & 255) / 255; this.b = (h & 255) / 255; } } },
    getVariants: (id, { count }) => Array.from({ length: count }, (_, i) => ({ id, i })),
    createInstanced: (variant, cap, lod) => { const m = { count: 0, visible: true, instanceMatrix: { array: new Float32Array(cap * 16), needsUpdate: false }, cap, userData: { id: variant.id, lod }, geometry: { attributes: { aInstA: { array: new Float32Array(cap * 4), needsUpdate: false }, aInstB: { array: new Float32Array(cap * 4), needsUpdate: false } }, index: { count: real(variant.id, lod) * 3 } } }; made.push(m); return m; },
    disposeInstanced: () => { disposed++; },
  };
  return { kit, made, disposedCount: () => disposed };
};
const mkScene = () => { const s = new Set(); return { set: s, add: (m) => s.add(m), remove: (m) => s.delete(m) }; };
const mkCam = (x, z, yawDeg) => { const a = yawDeg * Math.PI / 180; return { position: { x, y: 3, z }, fov: 70, aspect: 16 / 9, getWorldDirection(v) { v.x = Math.sin(a); v.y = 0; v.z = Math.cos(a); return v; } }; };

sec('7. 월드 매니저: 청크 로드/제거, 인스턴스 풀, 거리별 LOD, 시야 컬링');
const VIEW = 5;
const budget = {};
for (const id of Object.keys(SPECIES)) for (let l = 0; l < 3; l++) tri(id, l);   // 삼각형 수 미리 계산(테스트용 가짜 kit이 쓰는 값. 시간 측정에서 제외)
for (const n of names) {
  const [cx0, cz0] = sample(n, 8)[3];
  const { kit, made, disposedCount } = mkKit(), scene = mkScene();
  const W = createNatureWorld({ scene, kit, T, seed: SEED, chunkSize: 32, budgetMs: 2.5 });
  for (let dz = -VIEW; dz <= VIEW; dz++) for (let dx = -VIEW; dx <= VIEW; dx++) if (dx * dx + dz * dz <= VIEW * VIEW) W.requestChunk(cx0 + dx, cz0 + dz);
  // 프레임 예산: update 한 번이 예산을 크게 넘지 않는지
  const cam = mkCam(cx0 * 32 + 16, cz0 * 32 + 16, 0); let maxMs = 0, frames = 0; const fms = [];
  while (W.stats().queued > 0 && frames < 5000) { const t = performance.now(); W.update(cam); const e = performance.now() - t; fms.push(e); maxMs = Math.max(maxMs, e); frames++; }
  fms.sort((a, b) => a - b); const p95 = fms[Math.floor(fms.length * 0.95)] ?? 0, p50 = fms[Math.floor(fms.length * 0.5)] ?? 0;
  W.update(cam, { force: true });
  const items = W.stats().items;
  // 4방향 중 최악 (삼각형/드로우콜)
  let worst = { tris: 0, pools: 0, inst: 0 };
  for (const yaw of [0, 90, 180, 270]) { const c = mkCam(cam.position.x, cam.position.z, yaw); W.update(c, { force: true }); const st = W.stats(); if (st.tris > worst.tris) worst = { tris: st.tris, pools: st.pools, inst: st.instances, yaw, ms: st.lastRepackMs }; }
  budget[n] = worst;
  console.log(`  [${labels[n]}] 청크 ${W.stats().chunks}개/아이템 ${items}개 → 한 화면(최악 방향) 인스턴스 ${worst.inst}, 드로우콜 ${worst.pools}, 삼각형 ${worst.tris.toLocaleString()}, repack ${worst.ms.toFixed(1)}ms, 배치 계산 프레임당 중앙 ${p50.toFixed(1)}ms / p95 ${p95.toFixed(1)}ms / 최대 ${maxMs.toFixed(1)}ms(GC·JIT 포함) (${frames}프레임)`);
  ok(frames < 5000 && W.stats().queued === 0, `${labels[n]}: 배치 큐가 비워지지 않음`);
  ok(p50 < 4.5, `${labels[n]}: 프레임당 배치 계산이 예산(2.5ms)보다 너무 김 (중앙 ${p50.toFixed(1)}ms)`);
  ok(p95 < 15, `${labels[n]}: 프레임당 배치 계산 p95 ${p95.toFixed(1)}ms`);
  ok(maxMs < 40, `${labels[n]}: 한 프레임 배치 계산 최대 ${maxMs.toFixed(1)}ms`);
  // 풀 넘침 없음 / LOD 거리 / 시야 뒤쪽 제외
  const cx = cam.position.x, cz = cam.position.z;
  const c = mkCam(cx, cz, 30); W.update(c, { force: true });
  let cap = 0, lodBad = 0, coneBad = 0, total = 0;
  const fx = Math.sin(30 * Math.PI / 180), fz = Math.cos(30 * Math.PI / 180);
  const lim = Math.min(Math.PI, Math.atan(Math.tan(70 * Math.PI / 360) * 16 / 9) + 35 * Math.PI / 180);
  for (const m of made) {
    if (!scene.set.has(m)) continue;
    if (m.count > m.cap) cap++;
    const r = drawRule(m.userData.id);
    for (let i = 0; i < m.count; i++) {
      const d = Math.hypot(m.instanceMatrix.array[i * 16 + 12] - cx, m.instanceMatrix.array[i * 16 + 14] - cz); total++;
      const lo = m.userData.lod === 0 ? 0 : m.userData.lod === 1 ? r.l0 : r.l1, hi = m.userData.lod === 0 ? r.l0 : m.userData.lod === 1 ? r.l1 : r.cull;
      if (d < lo - 0.01 || d >= hi + 0.01) lodBad++;
      if (!r.big && d > 12) { const ang = Math.acos(Math.max(-1, Math.min(1, ((m.instanceMatrix.array[i * 16 + 12] - cx) * fx + (m.instanceMatrix.array[i * 16 + 14] - cz) * fz) / d))); if (ang > lim + 1e-3) coneBad++; }
    }
  }
  ok(cap === 0, `${labels[n]}: 풀 용량 넘침 ${cap}`);
  ok(lodBad === 0, `${labels[n]}: LOD 거리 구간을 벗어난 인스턴스 ${lodBad}`);
  ok(coneBad === 0, `${labels[n]}: 시야 뒤쪽 인스턴스 ${coneBad}`);
  // 카메라가 움직이면 다시 채움, 청크 제거 시 오브젝트 사라짐
  const rp = W.stats().repacks; W.update(mkCam(cx + 30, cz, 30), { force: true }); ok(W.stats().repacks > rp, `${labels[n]}: 이동 후 repack 안 됨`);
  for (let dz = -VIEW; dz <= VIEW; dz++) for (let dx = -VIEW; dx <= VIEW; dx++) W.removeChunk(cx0 + dx, cz0 + dz);
  W.update(mkCam(cx + 31, cz, 30), { force: true });
  ok(W.stats().instances === 0 && W.chunkItemCount(cx0, cz0) === -1, `${labels[n]}: 청크 제거 후에도 오브젝트가 남음`);
  // 다시 불러오면 같은 개수
  W.requestChunk(cx0, cz0); W.flush(); ok(W.chunkItemCount(cx0, cz0) === P.placeChunk(cx0, cz0).length, `${labels[n]}: 다시 불러온 청크의 오브젝트 수가 다름`);
  W.dispose();
}
{
  const worstT = Math.max(...Object.values(budget).map((b) => b.tris)), worstD = Math.max(...Object.values(budget).map((b) => b.pools));
  console.log(`\n  최악 지역 삼각형 ${worstT.toLocaleString()} (예산 15만~25만), 드로우콜 ${worstD}`);
  ok(worstT < 260000, `삼각형 예산 초과: ${worstT}`);
  ok(worstD < 330, `드로우콜 예산 초과: ${worstD}`);
}

sec('8. 빠른 이동 모드 / 용량 키우기');
{
  const [cx0, cz0] = sample('jungle', 8)[3];
  const { kit, made, disposedCount } = mkKit(), scene = mkScene();
  const W = createNatureWorld({ scene, kit, T, seed: SEED, chunkSize: 32 });
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) W.requestChunk(cx0 + dx, cz0 + dz);
  const cam = mkCam(cx0 * 32 + 16, cz0 * 32 + 16, 0);
  W.update(cam, { fast: true, force: true }); ok(W.stats().queued === 49, `빠른 이동 중에는 새 배치 계산을 미룸 (대기 ${W.stats().queued})`);
  W.flush(); W.update(mkCam(cam.position.x + 5, cam.position.z, 0), { fast: false, force: true });
  const normal = W.stats().instances;
  W.update(mkCam(cam.position.x + 10, cam.position.z, 0), { fast: true, force: true });
  ok(W.stats().instances <= normal, '빠른 이동 중에는 그리는 개수가 늘지 않음');
  ok(made.every((m) => m.count <= m.cap), '모든 풀의 개수가 용량 이하');
  console.log(`  기본 ${normal}개 → 빠른 이동 ${W.stats().instances}개, 풀 키움으로 버린 풀 ${disposedCount()}개`);
}

console.log(`\n결과: 통과 ${passes} / 실패 ${fails}`);
process.exit(fails ? 1 : 0);
