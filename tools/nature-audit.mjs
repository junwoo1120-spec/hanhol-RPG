// 전체 맵 검증(실제 terrain.js + 실제 배치 코드를 node에서 실행). THREE/GPU/브라우저 없이 확인 가능한 항목만 다룬다.
//   실행: node tools/nature-audit.mjs [시드=12345] [청크 간격=2]
import { makeTerrain, PLAY_RADIUS, WATER_LEVEL, VILLAGE } from '../public/js/terrain.js';
import { createPlacer, RULES, GIANT_CELL } from '../public/js/nature-placement.js';
import { SPECIES, FAMILIES, buildSpecies } from '../public/js/nature-geo.js';

const SEED = Number(process.argv[2]) || 12345, STRIDE = Number(process.argv[3]) || 2;
const T = makeTerrain(SEED), P = createPlacer(T, SEED);
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ 실패:', m); } return c; };
const sec = (t) => console.log('\n■ ' + t);
const names = ['plains', 'jungle', 'desert', 'volcano', 'snow'];
const lab = { plains: '평원', jungle: '정글', desert: '사막', volcano: '화산', snow: '설원', coast: '해안', shallow: '얕은 물' };
const allowed = {}; for (const [b, L] of Object.entries(RULES)) { allowed[b] = new Set(); for (const arr of Object.values(L)) for (const e of arr) allowed[b].add(e.id); }

// ---- 전체 맵 스캔 ----
const t0 = Date.now(), items = []; let nChunks = 0;
const R = Math.ceil(PLAY_RADIUS / 32) + 1;
for (let cx = -R; cx <= R; cx += STRIDE) for (let cz = -R; cz <= R; cz += STRIDE) {
  if (Math.hypot(cx * 32 + 16, cz * 32 + 16) > PLAY_RADIUS) continue;
  nChunks++;
  for (const o of P.placeChunk(cx, cz)) { o.cx = cx; o.cz = cz; items.push(o); }
}
console.log(`시드 ${SEED}: 청크 ${nChunks}개(간격 ${STRIDE}) / 오브젝트 ${items.length}개 / ${((Date.now() - t0) / 1000).toFixed(1)}초`);

// 위치별 지역 분류
const where = (o) => {
  const s = P.site(o.x, o.z);
  const w = [s.plain, s.jungle, s.desert, s.volc, s.snow]; let k = 0; for (let i = 1; i < 5; i++) if (w[i] > w[k]) k = i;
  return { s, dom: names[k], wk: w[k] };
};
for (const o of items) Object.assign(o, where(o));

sec('1. 오브젝트가 올바른 지형에 있는가');
{
  let edgeMix = 0, bad = 0, badPure = 0, pure = 0, tot = 0, wet = 0, deep = 0; const badBy = {};
  for (const o of items) {
    tot++;
    const under = o.biome === 'shallow';
    if (o.s.h < WATER_LEVEL - 0.7 && !under) wet++;
    if (o.s.h < -7) deep++;
    if (o.s.village > 0.35 || o.s.pool > 0.02) bad++;   // 배치 판정은 후보 중심 기준(0.25)이고 꽃/버섯 무리는 최대 1.4m 퍼지므로 경계 오차 허용
    const region = (o.biome === 'coast' || o.biome === 'shallow') ? o.biome : o.dom;
    const al = allowed[o.biome];
    if (!al || !al.has(o.id)) { bad++; badBy[o.id + '@' + o.biome] = 1; }
    // 지역이 한 가지로 뚜렷한(0.85↑) 곳에서는 그 지역 표에 없는 종류가 나오면 안 됨
    if (o.biome !== 'coast' && o.biome !== 'shallow' && o.wk > 0.85) { pure++; if (o.biome !== o.dom && !allowed[o.dom].has(o.id)) { const own = [o.s.plain, o.s.jungle, o.s.desert, o.s.volc, o.s.snow][names.indexOf(o.biome)]; if (own < 0.12) badPure++; else edgeMix++; } }
  }
  ok(bad === 0, `규칙 표에 없는 종류/마을·용암 위 배치 ${bad}개 ${Object.keys(badBy).slice(0, 5)}`);
  ok(badPure === 0, `뚜렷한 지역(0.85↑)에서 자기 지역 비중 0.12 미만인 다른 지역 종류 ${badPure}개`);
  ok(wet === 0, `수면 아래인데 shallow가 아닌 오브젝트 ${wet}개`);
  ok(deep === 0, `수심 7m보다 깊은 곳 오브젝트 ${deep}개`);
  console.log(`  전체 ${tot}개 중 규칙 위반 ${bad}, 뚜렷한 지역(${pure}개) 내 위반 ${badPure}, 경계 혼합(지역 경계에서 다른 지역 비중 0.12~0.33) ${edgeMix}개`);
  // 지역 x 종류 표
  const byReg = {};
  for (const o of items) { const r = (o.biome === 'coast' || o.biome === 'shallow') ? o.biome : o.biome; (byReg[r] ||= {})[o.id] = (byReg[r][o.id] || 0) + 1; }
  for (const r of Object.keys(byReg)) { const e = Object.entries(byReg[r]).sort((a, b) => b[1] - a[1]); console.log(`  [${lab[r]}] ${e.reduce((s, x) => s + x[1], 0)}개 · 종류 ${e.length}/${allowed[r].size} · 상위: ${e.slice(0, 4).map((x) => x[0] + ' ' + x[1]).join(', ')}`); }
  const missing = []; for (const r of Object.keys(allowed)) for (const id of allowed[r]) if (!(byReg[r] && byReg[r][id])) missing.push(r + ':' + id);
  console.log('  한 번도 안 나온 (지역:종류):', missing.length ? missing.join(', ') : '없음');
}

sec('2. 정글 거대 나무 / 평원 나무 간격');
{
  const g = items.filter((o) => o.id === 'tree_jungle_giant');
  // 거대 나무는 전체 청크가 필요하므로 STRIDE와 무관하게 후보 셀로 직접 센다
  const full = []; const c = GIANT_CELL, rr = Math.ceil(PLAY_RADIUS / c) + 1;
  for (let ix = -rr; ix <= rr; ix++) for (let iz = -rr; iz <= rr; iz++) { const f = P.finalOf(0, ix, iz); if (f) full.push(f); }
  const gg = full.filter((f) => f.id === 'tree_jungle_giant');
  console.log(`  거대 나무 월드 전체 ${gg.length}그루: ` + gg.map((f) => `(${f.x.toFixed(0)},${f.z.toFixed(0)})`).join(' '));
  ok(gg.length >= 1, '거대 나무가 하나도 없음');
  let minD = Infinity; for (let i = 0; i < gg.length; i++) for (let j = i + 1; j < gg.length; j++) minD = Math.min(minD, Math.hypot(gg[i].x - gg[j].x, gg[i].z - gg[j].z));
  console.log(`  거대 나무끼리 최소 거리 ${isFinite(minD) ? minD.toFixed(0) : '-'}m`);
  ok(gg.every((f) => P.site(f.x, f.z).jungle > 0.5), '정글 밖 거대 나무');
  const hh = []; for (const f of gg) hh.push(33 * f.scale); console.log(`  거대 나무 높이(33m 기준 배율 적용) ${hh.map((x) => x.toFixed(0)).join(', ')}m`);
  // 최근접 이웃 거리
  const nn = (list) => { if (list.length < 3) return NaN; let s = 0; const cell = new Map(); const k = (x, z) => Math.floor(x / 20) + ',' + Math.floor(z / 20);
    for (const o of list) { const kk = k(o.x, o.z); (cell.get(kk) || cell.set(kk, []).get(kk)).push(o); }
    let n = 0; for (const o of list) { let best = Infinity; const cx = Math.floor(o.x / 20), cz = Math.floor(o.z / 20);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (const p of cell.get((cx + dx) + ',' + (cz + dz)) || []) if (p !== o) best = Math.min(best, Math.hypot(p.x - o.x, p.z - o.z));
      if (isFinite(best)) { s += best; n++; } } return s / n; };
  const trees = (b) => items.filter((o) => o.biome === b && SPECIES[o.id].base === 'tree' && o.layer === 1 && o.wk > 0.8 && o.dom === b);
  const area = (b) => items.filter((o) => o.biome === b && o.layer === 3 && o.wk > 0.8 && o.dom === b).length; // 보조
  const pl = trees('plains'), jg = trees('jungle');
  const chunksOf = (b) => { const s = new Set(); for (const o of items.filter((o) => o.biome === b && o.wk > 0.8 && o.dom === b)) s.add(o.cx + ',' + o.cz); return s.size; };
  const dens = (b, list) => list.length / (chunksOf(b) * 1024 * STRIDE * STRIDE / (STRIDE * STRIDE));
  console.log(`  평원 나무 ${pl.length}그루, 최근접 평균 ${nn(pl).toFixed(1)}m, 청크당 ${(pl.length / chunksOf('plains')).toFixed(2)}그루`);
  console.log(`  정글 나무 ${jg.length}그루, 최근접 평균 ${nn(jg).toFixed(1)}m, 청크당 ${(jg.length / chunksOf('jungle')).toFixed(2)}그루`);
  ok(nn(pl) > nn(jg) * 1.5, '평원 나무 간격이 정글보다 충분히 넓지 않음');
  const pc = pl.length / chunksOf('plains'), jc = jg.length / chunksOf('jungle');
  ok(pc < jc / 2, `평원 나무 밀도(${pc.toFixed(2)}/청크)가 정글(${jc.toFixed(2)}/청크)의 절반 이하가 아님`);
}

sec('3. 사막: 선인장 / 회전초 / 암석 아치');
{
  const d = items.filter((o) => o.biome === 'desert'); const cnt = (id) => d.filter((o) => o.id === id).length;
  const dch = new Set(d.map((o) => o.cx + ',' + o.cz)).size;
  for (const id of ['cactus_saguaro', 'cactus_column', 'cactus_barrel', 'cactus_prickly', 'tumbleweed', 'rock_hoodoo', 'rock_sandstone', 'rock_weathered']) console.log(`  ${id}: ${cnt(id)}개 (사막 청크 ${dch}개 중)`);
  const arch = [], cell = GIANT_CELL, rr = Math.ceil(PLAY_RADIUS / cell) + 1;
  for (let ix = -rr; ix <= rr; ix++) for (let iz = -rr; iz <= rr; iz++) { const f = P.finalOf(0, ix, iz); if (f && (f.id === 'rock_arch' || f.id === 'rock_mesa')) arch.push(f); }
  console.log(`  암석 아치+메사(월드 전체): ${arch.length}개 (아치 ${arch.filter((f) => f.id === 'rock_arch').length})`);
  ok(arch.length >= 1, '암석 아치가 없음');
  ok(arch.every((f) => f.s.g <= 0.45 && f.s.h > 0), '아치가 가파른 곳/물 속에 있음');
  ok(d.filter((o) => o.id.startsWith('cactus') && o.s.g > 0.6).length === 0, '선인장이 급경사에 있음');
  ok(d.filter((o) => o.id === 'tumbleweed').length > 0 && cnt('cactus_saguaro') > 0, '선인장/회전초 없음');
  // 선인장 군집: 이웃과 너무 붙지 않는지
  const cac = d.filter((o) => o.id.startsWith('cactus')); let tooClose = 0;
  for (let i = 0; i < cac.length; i++) for (let j = i + 1; j < cac.length; j++) { if (cac[i].cx !== cac[j].cx || cac[i].cz !== cac[j].cz) continue; if (Math.hypot(cac[i].x - cac[j].x, cac[i].z - cac[j].z) < 1.0) tooClose++; }
  ok(tooClose === 0, `선인장끼리 1m 이내 ${tooClose}쌍`);
}

sec('4. 설원 눈 / 화산 탄화 표면 (지오메트리/재질 확인)');
{
  const frac = (id) => { const g = buildSpecies(id, 1, 0); let m = 0, n = g.nat.length / 3; for (let i = 0; i < n; i++) if (g.nat[i * 3 + 1] > 0.5) m++; return m / n; };
  const lum = (id) => { const g = buildSpecies(id, 1, 0); let s = 0, n = g.color.length / 3; for (let i = 0; i < n; i++) s += (g.color[i * 3] + g.color[i * 3 + 1] + g.color[i * 3 + 2]) / 3; return s / n; };
  for (const id of ['tree_snow_pine', 'tree_snow_spruce', 'tree_snow_bare']) { const st = SPECIES[id].style; console.log(`  ${id}: 눈 마스크 정점 ${(frac(id) * 100).toFixed(0)}% · 강조(눈색) 강도 ${st.accent} · 윗면 눈 tint ${FAMILIES[SPECIES[id].fam].fx?.top?.[3] ?? 0}`);
    ok(frac(id) > 0.05, id + ' 눈 마스크 거의 없음'); ok(st.accents && st.accent[0] >= 0.6, id + ' 눈 강조색 약함'); }
  for (const id of ['tree_burnt_full', 'tree_burnt_partial', 'stump_burnt', 'log_burnt']) { const sp = SPECIES[id]; console.log(`  ${id}: char=${sp.P.char ?? 0} fam=${sp.fam} 평균 정점색 ${lum(id).toFixed(2)} (고목 ${lum('tree_dead').toFixed(2)})`);
    ok((sp.P.char ?? 0) > 0 && sp.fam === 'tree_burnt', id + ' 탄화 설정 없음'); ok(lum(id) < lum('tree_dead'), id + ' 정점색이 고목보다 어둡지 않음'); }
  // 눈/탄화 종류가 해당 지역에서만
  ok(!items.some((o) => /^tree_snow/.test(o.id) && o.biome !== 'snow'), '눈 나무가 설원 밖에 있음');
  ok(!items.some((o) => /burnt/.test(o.id) && o.biome !== 'volcano'), '탄 나무가 화산 밖에 있음');
}

sec('5. 버섯/잔디/꽃/그루터기는 지정 지형에만');
{
  const base = (o) => SPECIES[o.id].base; const tab = {};
  for (const o of items) { const b = base(o); if (['mushroom', 'grass', 'flower', 'stump'].includes(b) && o.id !== 'driftwood') { (tab[b] ||= {}); tab[b][o.biome] = (tab[b][o.biome] || 0) + 1; } }
  console.log('  (유목 driftwood는 해안 전용이라 그루터기 검사에서 제외)');
  for (const [b, v] of Object.entries(tab)) console.log(`  ${b}: ` + Object.entries(v).map(([k, n]) => `${lab[k]} ${n}`).join(', '));
  ok(!tab.mushroom || Object.keys(tab.mushroom).every((k) => ['jungle', 'plains'].includes(k)), '버섯이 정글/평원 밖');
  ok(!tab.flower || Object.keys(tab.flower).every((k) => ['jungle', 'plains'].includes(k)), '꽃이 정글/평원 밖');
  ok(!tab.stump || Object.keys(tab.stump).every((k) => ['jungle', 'volcano'].includes(k)), '그루터기가 정글/화산 밖');
  ok(!tab.grass || Object.keys(tab.grass).every((k) => ['jungle', 'plains', 'desert', 'coast'].includes(k)), '잔디가 설원/화산/얕은 물에 있음');
}

sec('6. 청크 이동/재생성: 중복·위치 변동 없음');
{
  const keyOf = (o) => `${o.id}|${o.x.toFixed(3)}|${o.z.toFixed(3)}`;
  let dup = 0; const seen = new Set(); for (const o of items) { const k = keyOf(o); if (seen.has(k)) dup++; seen.add(k); }
  ok(dup === 0, `전체 스캔에서 같은 위치·종류 중복 ${dup}개`);
  let outside = 0; for (const o of items) { const x0 = o.cx * 32, z0 = o.cz * 32; if (!(o.x >= x0 && o.x < x0 + 32 && o.z >= z0 && o.z < z0 + 32)) outside++; }
  ok(outside === 0, `자기 청크 밖 오브젝트 ${outside}개`);
  // 캐시가 비워져도(시야 이동 중 trimCaches) 같은 결과 + 이동 경로를 따라 걷다 돌아와도 같은 결과
  const P2 = createPlacer(T, SEED); const home = [0, 20]; const h0 = JSON.stringify(P2.placeChunk(...home));
  let moved = 0; for (let k = 0; k < 400; k++) { P2.placeChunk(home[0] + (k % 25) - 12, home[1] + Math.floor(k / 25) - 8); moved++; }
  ok(JSON.stringify(P2.placeChunk(...home)) === h0, '많이 걷고(캐시 정리 발생) 돌아온 뒤 같은 청크 결과가 다름');
  console.log(`  ${moved}청크를 걷고 돌아온 뒤 재생성 결과 동일: ${JSON.stringify(P2.placeChunk(...home)) === h0}`);
  const Pa = createPlacer(T, SEED), Pb = createPlacer(T, SEED); let diff = 0, cmp = 0;
  for (let k = 0; k < 60; k++) { const cx = ((k * 37) % 61) - 30, cz = ((k * 53) % 61) - 30; if (Math.hypot(cx, cz) > 40) continue; cmp++; if (JSON.stringify(Pa.placeChunk(cx, cz)) !== JSON.stringify(Pb.placeChunk(cz * 0 + cx, cz))) diff++; Pb.resetCaches(); }
  ok(diff === 0, `서로 다른 순서/캐시 상태의 배치기 결과 불일치 ${diff}개`);
}

sec('8. 메모리/버텍스 예산 (계산값. GPU 실측 아님)');
{
  let vb = 0, tri = [0, 0, 0], nv = 0;
  const ids = Object.keys(SPECIES);
  for (const id of ids) for (let lod = 0; lod < 3; lod++) { const g = buildSpecies(id, 1, lod); vb += g.position.byteLength + g.normal.byteLength + g.uv.byteLength + g.color.byteLength + g.nat.byteLength + g.index.byteLength; tri[lod] += g.triCount; nv++; }
  console.log(`  종류 ${ids.length} × LOD3 (변종 1개 기준) 정점 버퍼 ${(vb / 1048576).toFixed(1)}MB, 변종 최대 4개면 약 ${(vb * 4 / 1048576).toFixed(0)}MB 상한(실제로는 쓰이는 변종만 생성)`);
  console.log(`  청크 데이터: 오브젝트당 ${16 * 4 + 8 * 4 + 2}바이트 → 오브젝트 1만 개 ${(10000 * 98 / 1048576).toFixed(1)}MB`);
  console.log(`  재질: FAMILIES ${Object.keys(FAMILIES).length}개 → 셰이더 프로그램 2개(Lambert/Phong)`);
}
console.log(`\n결과: ${fails ? '실패 ' + fails + '건' : '모든 실행 항목 통과'}`);
process.exit(fails ? 1 : 0);
