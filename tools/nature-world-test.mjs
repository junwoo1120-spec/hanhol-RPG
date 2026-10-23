// 월드 매니저(풀/LOD/컬링/솎기/정리) 동작 검증. 가짜 THREE 사용 → GPU 업로드/렌더링은 검증하지 않는다.
//   실행: node tools/nature-world-test.mjs
import { makeTerrain, PLAY_RADIUS } from '../public/js/terrain.js';
import { createPlacer } from '../public/js/nature-placement.js';
import { createNatureWorld } from '../public/js/nature-world.js';
let OldWorld = null; try { OldWorld = (await import('../public/js/nature-world-old.js')).createNatureWorld; } catch {}
const SEED = 12345, T = makeTerrain(SEED), P = createPlacer(T, SEED);
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ 실패:', m); } };
const names = ['plains', 'jungle', 'desert', 'volcano', 'snow']; const lab = { plains: '평원', jungle: '정글', desert: '사막', volcano: '화산', snow: '설원' };
const mkKit = () => {
  const made = []; let disposed = 0;
  const attr = (n) => ({ array: new Float32Array(n), itemSize: 4, needsUpdate: false });
  return { made, disposed: () => disposed, kit: {
    THREE: { Vector3: class { constructor() { this.x = 0; this.y = 0; this.z = 0; } }, Color: class { constructor(h) { this.r = (h >> 16 & 255) / 255; this.g = (h >> 8 & 255) / 255; this.b = (h & 255) / 255; } } },
    getVariants: (id, { count }) => Array.from({ length: count }, (_, i) => ({ id, i })),
    createInstanced: (v, cap, lod) => { const m = { count: 0, visible: true, cap, userData: { id: v.id, lod }, instanceMatrix: { array: new Float32Array(cap * 16), itemSize: 16, needsUpdate: false }, geometry: { index: { count: 30 }, attributes: { aInstA: attr(cap * 4), aInstB: attr(cap * 4), position: { count: 10 } } } }; made.push(m); return m; },
    disposeInstanced: () => { disposed++; },
  } };
};
const scene = () => { const s = new Set(); return { set: s, add: (m) => s.add(m), remove: (m) => s.delete(m) }; };
const cam = (x, z, yaw) => { const a = yaw * Math.PI / 180; return { position: { x, y: 3, z }, fov: 70, aspect: 16 / 9, getWorldDirection(v) { v.x = Math.sin(a); v.y = 0; v.z = Math.cos(a); return v; } }; };
const pick = {}; for (const n of names) pick[n] = [];
for (let cx = -42; cx <= 42; cx++) for (let cz = -42; cz <= 42; cz++) { const x = cx * 32 + 16, z = cz * 32 + 16; if (Math.hypot(x, z) > PLAY_RADIUS - 60) continue; const s = P.site(x, z), w = [s.plain, s.jungle, s.desert, s.volc, s.snow]; let k = 0; for (let i = 1; i < 5; i++) if (w[i] > w[k]) k = i; if (w[k] > 0.85 && s.h > 5 && s.village < 0.05 && s.pool < 0.01 && s.ice < 0.2) pick[names[k]].push([cx, cz]); }
const run = (W, scn, cx0, cz0) => {
  for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) if (dx * dx + dz * dz <= 25) W.requestChunk(cx0 + dx, cz0 + dz);
  W.flush(); const x = cx0 * 32 + 16, z = cz0 * 32 + 16; let worst = { instances: 0 };
  for (const yaw of [0, 90, 180, 270]) { W.update(cam(x, z, yaw), { force: true }); const s = W.stats(); if (s.instances > worst.instances) worst = { ...s, yaw }; }
  return { worst, x, z };
};

console.log('■ A. 최적화 전/후 (한 화면 최악 방향, 같은 위치·같은 시야)');
console.log('  지역   | 인스턴스 전→후 | 드로우콜 전→후 | 솎은 수 (삼각형 수는 가짜 kit이라 측정 안 함)');
for (const n of names) {
  const [cx0, cz0] = pick[n][Math.floor(pick[n].length / 2)];
  const a = mkKit(), sa = scene(), b = mkKit(), sb = scene();
  const Wn = createNatureWorld({ scene: sb, kit: b.kit, T, seed: SEED }); const rn = run(Wn, sb, cx0, cz0);
  let line = `  ${lab[n]}  | `;
  if (OldWorld) { const Wo = OldWorld({ scene: sa, kit: a.kit, T, seed: SEED }); const ro = run(Wo, sa, cx0, cz0); const o = ro.worst, w = rn.worst;
    line += `${o.instances} → ${w.instances} (${((1 - w.instances / o.instances) * 100).toFixed(0)}%↓) | ${o.pools} → ${w.pools} (${((1 - w.pools / o.pools) * 100).toFixed(0)}%↓) | ${w.thinned}`;
    ok(w.instances <= o.instances && w.pools <= o.pools, `${lab[n]}: 최적화 후가 더 많이 그림`); }
  console.log(line);
}

console.log('\n■ B. 솎기가 깜빡이지 않는가 (같은 카메라 반복 / 1칸 이동)');
{
  const [cx0, cz0] = pick.plains[Math.floor(pick.plains.length / 2)]; const k = mkKit(), sc = scene(); const W = createNatureWorld({ scene: sc, kit: k.kit, T, seed: SEED });
  const r = run(W, sc, cx0, cz0); const snap = () => k.made.filter((m) => sc.set.has(m) && m.count).map((m) => { const s = []; for (let i = 0; i < m.count; i++) s.push(m.instanceMatrix.array[i * 16 + 12].toFixed(2) + ',' + m.instanceMatrix.array[i * 16 + 14].toFixed(2)); return s; }).flat().sort().join('|');
  W.update(cam(r.x, r.z, 0), { force: true }); const s1 = snap(); W.update(cam(r.x, r.z, 0), { force: true }); const s2 = snap();
  ok(s1 === s2, '같은 카메라에서 repack 결과가 달라짐(깜빡임)');
  W.update(cam(r.x + 1, r.z, 0), { force: true }); const s3 = snap(); const a = new Set(s1.split('|')), b = new Set(s3.split('|')); let flip = 0; for (const e of a) if (!b.has(e)) flip++;
  console.log(`  1칸 이동 시 사라진 인스턴스 ${flip}/${a.size} (${(flip / a.size * 100).toFixed(1)}%: 시야/거리 경계 통과분)`);
  ok(flip / a.size < 0.08, '1칸 이동에 인스턴스가 8% 넘게 바뀜');
}

console.log('\n■ C. 그리는 거리가 안개 끝(152) 이내인가');
{
  const [cx0, cz0] = pick.jungle[Math.floor(pick.jungle.length / 2)]; const k = mkKit(), sc = scene(); const W = createNatureWorld({ scene: sc, kit: k.kit, T, seed: SEED });
  const r = run(W, sc, cx0, cz0); let maxD = 0; for (const m of k.made) if (sc.set.has(m)) for (let i = 0; i < m.count; i++) maxD = Math.max(maxD, Math.hypot(m.instanceMatrix.array[i * 16 + 12] - r.x, m.instanceMatrix.array[i * 16 + 14] - r.z));
  console.log(`  그려지는 최대 거리 ${maxD.toFixed(0)}m`); ok(maxD <= 150.01, '안개 밖까지 그림');
}

console.log('\n■ D. 청크 제거/재요청: 중복 없음, 자원 정리');
{
  const [cx0, cz0] = pick.jungle[Math.floor(pick.jungle.length / 3)]; const k = mkKit(), sc = scene(); const W = createNatureWorld({ scene: sc, kit: k.kit, T, seed: SEED });
  const r = run(W, sc, cx0, cz0); const n1 = W.stats().items;
  for (let i = 0; i < 3; i++) for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) if (dx * dx + dz * dz <= 25) W.requestChunk(cx0 + dx, cz0 + dz);   // 해상도 재생성처럼 중복 요청
  W.flush(); W.update(cam(r.x, r.z, 0), { force: true }); ok(W.stats().items === n1, '같은 청크를 다시 요청했더니 오브젝트 수가 늘어남(중복)'); console.log(`  중복 요청 3회 후 아이템 ${n1} → ${W.stats().items}`);
  // 요청 직후 제거(계산 중/대기 중)
  const W2 = createNatureWorld({ scene: scene(), kit: mkKit().kit, T, seed: SEED }); W2.requestChunk(cx0, cz0); W2.update(cam(r.x, r.z, 0)); W2.removeChunk(cx0, cz0); W2.flush(); ok(W2.chunkItemCount(cx0, cz0) === -1, '계산 중 제거한 청크가 나중에 나타남');
  // 다른 곳으로 이동 → 옛 풀 정리
  const realNow = performance.now.bind(performance); let t = realNow(); performance.now = () => t;
  for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) W.removeChunk(cx0 + dx, cz0 + dz);
  W.update(cam(r.x + 5000, r.z, 0), { force: true }); const before = W.stats().freedPools;
  t += 41000; W.update(cam(r.x + 5001, r.z, 0), { force: true }); t += 1; W.update(cam(r.x + 5002, r.z, 0), { force: true });
  performance.now = realNow;
  const freed = W.stats().freedPools - before; console.log(`  이동 후 40초 경과: 풀 ${freed}개 해제 (kit.disposeInstanced 호출 ${k.disposed()}회), 남은 풀 ${[...sc.set].length}`);
  ok(freed > 0 && sc.set.size === 0, '안 쓰는 풀이 정리되지 않음');
  // 정리 후 돌아오면 다시 정상 생성
  for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) if (dx * dx + dz * dz <= 25) W.requestChunk(cx0 + dx, cz0 + dz);
  W.flush(); W.update(cam(r.x, r.z, 0), { force: true }); ok(W.stats().items === n1 && W.stats().instances > 0, '풀 정리 후 돌아왔을 때 복원되지 않음');
  W.dispose(); ok(sc.set.size === 0, 'dispose 후 장면에 풀이 남음');
}
console.log(`\n결과: ${fails ? '실패 ' + fails + '건' : '모든 실행 항목 통과'}`);
process.exit(fails ? 1 : 0);
