// node tools/nature-geo-test.mjs  — 자연 오브젝트 지오메트리 검증 (THREE 불필요)
import { SPECIES_IDS, SPECIES, BIOMES, FAMILIES, buildSpecies } from '../public/js/nature-geo.js';

const SEEDS = [1, 2, 3, 4];
let fail = 0;
const bad = (m) => { fail++; console.log('  ✗ ' + m); };

// 실루엣 지문: 8방위 × 6높이 구간의 최대 반경 (정규화) → 변종 간 L1 거리
function sil(d) {
  const h = Math.max(d.height - d.minY, 1e-3), g = new Float32Array(48);
  for (let i = 0; i < d.vertexCount; i++) {
    const x = d.position[i * 3], y = d.position[i * 3 + 1], z = d.position[i * 3 + 2];
    const a = Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * 8) % 8, hb = Math.min(5, Math.floor(((y - d.minY) / h) * 6));
    g[a * 6 + hb] = Math.max(g[a * 6 + hb], Math.hypot(x, z) / h);
  }
  return g;
}
const l1 = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

const rows = [];
for (const id of SPECIES_IDS) {
  const S = SPECIES[id], sils = [], tris = [[], [], []], t0 = performance.now();
  let minYs = [];
  for (const seed of SEEDS) for (const lod of [0, 1, 2]) {
    const d = buildSpecies(id, seed, lod);
    tris[lod].push(d.triCount);
    for (const k of ['position', 'normal', 'uv', 'color', 'nat']) for (const v of d[k]) if (!Number.isFinite(v)) { bad(`${id} s${seed} L${lod}: ${k}에 NaN/Inf`); break; }
    let mx = 0; for (const v of d.index) mx = Math.max(mx, v);
    if (mx >= d.vertexCount) bad(`${id}: 인덱스 범위 초과`);
    // 법선 길이
    for (let i = 0; i < d.vertexCount; i++) { const l = Math.hypot(d.normal[i * 3], d.normal[i * 3 + 1], d.normal[i * 3 + 2]); if (Math.abs(l - 1) > 1e-3) { bad(`${id}: 법선 비정규화`); break; } }
    // 지면 아래로 너무 깊이 묻히지 않았는지 / 높이 상식 범위
    // 지면 접촉: 매달리는 것(덩굴/고드름) 제외, 밑면이 공중에 뜨거나(>0.06) 너무 깊이 묻히면(<-0.5) 실패
    if (!d.meta.hang) {
      if (d.minY > 0.06) bad(`${id} s${seed} L${lod}: 공중에 뜸 minY=${d.minY.toFixed(3)}`);
      if (d.minY < -0.5 * Math.max(1, d.height / 10)) bad(`${id} s${seed} L${lod}: 너무 깊이 묻힘 minY=${d.minY.toFixed(2)}`);
    }
    if (lod === 0) minYs.push(d.minY);
    // 와인딩 검사: 닫힌 입체(나무·바위)는 삼각형 법선이 중심에서 바깥을 향해야 하고,
    // 나머지는 저장된 정점 법선(해석적 법선)과 면 법선이 같은 방향이어야 함
    if (lod === 0) {
      const P = d.position, cy = (d.height + d.minY) / 2, solid = S.base === 'rock';
      let ok = 0, tot = 0;
      for (let t = 0; t < d.triCount; t++) {
        const ia = d.index[t * 3], ib = d.index[t * 3 + 1], ic = d.index[t * 3 + 2], a = ia * 3, b = ib * 3, c = ic * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (Math.hypot(nx, ny, nz) < 1e-9) continue;
        tot++;
        if (solid) { const m = [(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3 - cy, (P[a + 2] + P[b + 2] + P[c + 2]) / 3]; if (nx * m[0] + ny * m[1] + nz * m[2] > 0) ok++; }
        else { const N = d.normal; const sx = N[a] + N[b] + N[c], sy = N[a + 1] + N[b + 1] + N[c + 1], sz = N[a + 2] + N[b + 2] + N[c + 2]; if (nx * sx + ny * sy + nz * sz > 0) ok++; }
      }
      const th = solid ? 0.6 : 0.9;
      if (tot && ok / tot < th) bad(`${id} s${seed}: 와인딩 일치 ${(100 * ok / tot).toFixed(0)}% (${solid ? '바깥향' : '정점법선 일치'})`);
    }
    if (lod === 0) sils.push(sil(d));
    if (lod === 0 && seed === 1) { const e = buildSpecies(id, 1, 0); if (Buffer.compare(Buffer.from(e.position.buffer), Buffer.from(d.position.buffer))) bad(`${id}: seed 재현 실패`); }
  }
  const ms = (performance.now() - t0) / (SEEDS.length * 3);
  let dmin = 9, dsum = 0, n = 0;
  for (let i = 0; i < sils.length; i++) for (let j = i + 1; j < sils.length; j++) { const d = l1(sils[i], sils[j]); dmin = Math.min(dmin, d); dsum += d; n++; }
  rows.push({ id, base: S.base, L0: Math.round(tris[0].reduce((a, b) => a + b) / SEEDS.length), L1: Math.round(tris[1].reduce((a, b) => a + b) / SEEDS.length), L2: Math.round(tris[2].reduce((a, b) => a + b) / SEEDS.length), minY: +Math.min(...minYs).toFixed(2), 'ms/개': +ms.toFixed(2), '실루엣차이(최소)': +dmin.toFixed(3), '실루엣차이(평균)': +(dsum / n).toFixed(3) });
  if (dmin < 0.004) bad(`${id}: 변종 간 실루엣이 거의 같음 (${dmin.toFixed(4)})`);
}
console.table(rows);
// 지형별 목록 검증: 존재하는 종류만, 모든 종류가 최소 한 지형 또는 기본 베이스에 속함
for (const [k, B] of Object.entries(BIOMES)) for (const [role, ids] of Object.entries(B.roles)) for (const id of ids) if (!SPECIES[id]) bad(`${k}/${role}: ${id} 없음`);
// 대표 거대 나무는 같은 지형 일반 나무보다 확실히 커야 함
const hgt = (id) => buildSpecies(id, 1, 0).height;
const giant = hgt('tree_jungle_giant'), normal = Math.max(...['tree_jungle', 'tree_jungle_slender'].map(hgt));
console.log(`정글 대표 나무 ${giant.toFixed(1)} vs 일반 최대 ${normal.toFixed(1)} (배율 ${(giant / normal).toFixed(2)})`);
if (giant < normal * 1.8) bad('대표 나무가 충분히 크지 않음');
for (const [id, f] of Object.entries(SPECIES)) if (!FAMILIES[f.fam]) bad(id + ': 재질 없음');
console.log(fail ? `실패 ${fail}건` : '모든 검사 통과');
process.exit(fail ? 1 : 0);
