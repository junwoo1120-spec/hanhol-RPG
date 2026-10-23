// 자연 오브젝트 공통 베이스: 순수 JS 지오메트리 생성기 (THREE 의존 없음 → node에서도 테스트 가능)
//
// 구조
//  - 프리미티브(Buf, addTube, addLathe, addLoft, addBlob)  : 모든 모델이 공유하는 공통 부품
//  - 베이스 빌더 9종(tree, rock, grass, flower, mushroom, stump, plant, vine)  : 파라미터로 파생 모델 생성
//  - SPECIES : 파생 종류별 파라미터 프리셋 (예: tree_oak, tree_pine ... 모두 buildTree 하나에서 나옴)
//  - FAMILIES: 재질 묶음(텍스처 2층 + 색 보정 + 거칠기). 한 모델 = 지오메트리 1개 + 재질 1개 = 드로우콜 1개
//
// 정점 속성: position, normal, uv(미터 단위), color(AO/그라데이션), nat = (바람 가중치[units], 강조색 마스크, 텍스처층 0/1)
// 같은 seed로 LOD0/LOD1을 만들면 난수 소비 순서가 같아서 같은 실루엣이 유지됩니다.

export const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const col = (c) => (typeof c === 'number' ? [c, c, c] : c);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const R = (r, [a, b]) => a + (b - a) * r();            // 범위 샘플
const RI = (r, [a, b]) => Math.round(a + (b - a) * r());

function h3(x, y, z, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1103515245) ^ Math.imul(s, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function noise3(x, y, z, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const c = (a, b, d) => h3(ix + a, iy + b, iz + d, s);
  return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
              lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

// ====================== 프리미티브 ======================
class Buf {
  constructor() { this.P = []; this.NR = []; this.UV = []; this.C = []; this.NA = []; this.I = []; this.meta = {}; }
  get n() { return this.P.length / 3; }
  v(x, y, z, u, w, c, wind = 0, mask = 0, surf = 0, nrm = null) {
    this.P.push(x, y, z); this.UV.push(u, w); this.C.push(c[0], c[1], c[2]); this.NA.push(wind, mask, surf);
    if (nrm) this.NR.push(nrm[0], nrm[1], nrm[2]); else this.NR.push(NaN, NaN, NaN);
    return this.n - 1;
  }
  tri(a, b, c) { this.I.push(a, b, c); }
}

// 일부 정점(start~끝)을 크기·기울임·회전·이동 (버섯 군락, 쓰러진 통나무 등)
function xform(b, start, { s = 1, ta = 0, az = 0, yaw = 0, ox = 0, oy = 0, oz = 0 } = {}) {
  const dx = Math.cos(az), dz = Math.sin(az);
  const k = [dz, 0, -dx];                         // up × dir
  const ct = Math.cos(ta), st = Math.sin(ta), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const rot = (v) => {
    const kv = dot(k, v), kx = cross(k, v);
    let r = [v[0] * ct + kx[0] * st + k[0] * kv * (1 - ct), v[1] * ct + kx[1] * st + k[1] * kv * (1 - ct), v[2] * ct + kx[2] * st + k[2] * kv * (1 - ct)];
    return [r[0] * cy + r[2] * sy, r[1], -r[0] * sy + r[2] * cy];
  };
  for (let i = start; i < b.n; i++) {
    const p = rot([b.P[i * 3] * s, b.P[i * 3 + 1] * s, b.P[i * 3 + 2] * s]);
    b.P[i * 3] = p[0] + ox; b.P[i * 3 + 1] = p[1] + oy; b.P[i * 3 + 2] = p[2] + oz;
    if (!Number.isNaN(b.NR[i * 3])) {
      const q = rot([b.NR[i * 3], b.NR[i * 3 + 1], b.NR[i * 3 + 2]]);
      b.NR[i * 3] = q[0]; b.NR[i * 3 + 1] = q[1]; b.NR[i * 3 + 2] = q[2];
    }
    b.NA[i * 3] *= s;                              // 바람 가중치(units)도 크기 따라감
  }
}

// 곡선을 따라 가는 관 (줄기, 가지, 뿌리, 덩굴). o: {col(t,u,p), wind(p,t), surf, mask, cap}
function addTube(b, pts, radii, seg, o = {}) {
  const m = pts.length, cf = o.col || (() => [1, 1, 1]), wf = o.wind || (() => 0);
  const surf = o.surf ?? 0, mask = o.mask ?? 0, circ = TAU * Math.max(...radii);
  let nPrev = null, acc = 0, tLast = [0, 1, 0];
  const rings = [];
  for (let i = 0; i < m; i++) {
    const a = pts[Math.max(i - 1, 0)], c = pts[Math.min(i + 1, m - 1)];
    const t = norm(sub(c, a)); tLast = t;
    let nv;
    if (!nPrev) nv = norm(cross(Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], t));
    else { const d = dot(nPrev, t); nv = norm([nPrev[0] - t[0] * d, nPrev[1] - t[1] * d, nPrev[2] - t[2] * d]); }
    nPrev = nv;
    const bv = cross(t, nv);
    if (i > 0) acc += Math.hypot(...sub(pts[i], pts[i - 1]));
    const tt = m > 1 ? i / (m - 1) : 0, start = b.n;
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * TAU, cs = Math.cos(th), sn = Math.sin(th);
      const d = [nv[0] * cs + bv[0] * sn, nv[1] * cs + bv[1] * sn, nv[2] * cs + bv[2] * sn];
      const rr = radii[i] * (o.rib ? 1 + o.rib[1] * Math.cos(o.rib[0] * th) : 1);
      b.v(pts[i][0] + d[0] * rr, pts[i][1] + d[1] * rr, pts[i][2] + d[2] * rr,
          (j / seg) * circ, acc, col(cf(tt, j / seg, pts[i])), wf(pts[i], tt), o.maskFn ? o.maskFn(tt, j / seg, pts[i]) : mask, surf, o.rib ? null : d);
    }
    rings.push(start);
  }
  for (let i = 0; i < m - 1; i++) for (let j = 0; j < seg; j++) {
    const A = rings[i] + j, B = A + 1, C = rings[i + 1] + j + 1, D = rings[i + 1] + j;
    b.tri(A, B, C); b.tri(A, C, D);
  }
  if (o.cap !== false) {
    const p = pts[m - 1], ci = b.v(p[0], p[1], p[2], 0, acc, col(cf(1, 0, p)), wf(p, 1), mask, surf, tLast);
    for (let j = 0; j < seg; j++) b.tri(ci, rings[m - 1] + j, rings[m - 1] + j + 1);
  }
}

// 회전체 (버섯 갓/대, 그루터기, 소나무 층). prof: [[r, y, 색(숫자|[r,g,b]), 바람, 마스크, 층], ...] 아래→위
function addLathe(b, prof, seg, o = {}) {
  const cx = o.cx || 0, cz = o.cz || 0, n = prof.length, rings = [];
  const circ = TAU * Math.max(...prof.map((p) => p[0]));
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = prof[Math.max(i - 1, 0)], c = prof[Math.min(i + 1, n - 1)];
    const tr = c[0] - a[0], ty = c[1] - a[1], l = Math.hypot(tr, ty) || 1;
    const nr = ty / l, ny = -tr / l;
    if (i > 0) acc += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]);
    const start = b.n, p = prof[i];
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * TAU, cs = Math.cos(th), sn = Math.sin(th);
      const r = p[0] * (o.radial ? o.radial(th, i) : 1), y = p[1] + (o.yfn ? o.yfn(th, i) : 0);
      b.v(cx + r * cs, y, cz + r * sn, (j / seg) * circ, acc, col(p[2] ?? 1), p[3] || 0, p[4] || 0, p[5] ?? (o.surf ?? 0), [nr * cs, ny, nr * sn]);
    }
    rings.push(start);
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const A = rings[i] + j, B = A + 1, C = rings[i + 1] + j + 1, D = rings[i + 1] + j;
    b.tri(A, D, C); b.tri(A, C, B);
  }
}

// 잎/꽃잎/풀잎 띠. rows: [{l:[x,y,z], r:[x,y,z]}...] (마지막 행 l==r 이면 뾰족한 끝). o.face: 앞면이 향할 방향
function addLoft(b, rows, o = {}) {
  const base = b.n, cf = o.col || (() => [1, 1, 1]), wf = o.wind || (() => 0);
  let acc = 0, prevMid = null;
  const uw = o.uw ?? 0.1;
  rows.forEach((row, i) => {
    const mid = scl(add(row.l, row.r), 0.5);
    if (prevMid) acc += Math.hypot(...sub(mid, prevMid));
    prevMid = mid;
    const t = i / (rows.length - 1);
    b.v(row.l[0], row.l[1], row.l[2], (o.u0 || 0), (o.v0 || 0) + acc, col(cf(t)), wf(mid, t), o.mask || 0, o.surf || 0);
    b.v(row.r[0], row.r[1], row.r[2], (o.u0 || 0) + uw, (o.v0 || 0) + acc, col(cf(t)), wf(mid, t), o.mask || 0, o.surf || 0);
  });
  const r0 = rows[0], r1 = rows[1];
  const Wv = sub(r0.r, r0.l), F = sub(scl(add(r1.l, r1.r), 0.5), scl(add(r0.l, r0.r), 0.5));
  const flip = dot(cross(F, Wv), o.face || [0, 1, 0]) < 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const A = base + i * 2, B = A + 1, C = A + 3, D = A + 2;
    const tipDeg = Math.hypot(...sub(rows[i + 1].l, rows[i + 1].r)) < 1e-6;
    if (!flip) { b.tri(A, C, B); if (!tipDeg) b.tri(A, D, C); } else { b.tri(A, B, C); if (!tipDeg) b.tri(A, C, D); }
  }
}

// 지그재그 폭의 휘어진 잎 (야자, 나무고사리). o: {base, az, el, len, wd, nr, droop, u0, v0, col, wind}
function addFrond(b, o) {
  const d = [Math.cos(o.az) * Math.cos(o.el), Math.sin(o.el), Math.sin(o.az) * Math.cos(o.el)], sd = [-Math.sin(o.az), 0, Math.cos(o.az)], rr = [];
  for (let i = 0; i < o.nr; i++) {
    const u = i / (o.nr - 1), c = [o.base[0] + d[0] * o.len * u, o.base[1] + d[1] * o.len * u - o.droop * o.len * u * u, o.base[2] + d[2] * o.len * u];
    const w = (i === o.nr - 1 ? 0 : (i % 2 ? 0.55 : 1)) * o.wd * 0.5 * Math.sin(Math.PI * (0.12 + 0.88 * u));
    rr.push({ l: sub(c, scl(sd, w)), r: add(c, scl(sd, w)) });
  }
  addLoft(b, rr, { face: [0, 1, 0], uw: o.wd, u0: o.u0, v0: o.v0, surf: 1, col: o.col, wind: o.wind });
}

// 이십면체 구 (잎덩어리, 바위, 덤불)
const icoCache = {};
function ico(level) {
  if (icoCache[level]) return icoCache[level];
  const t = (1 + Math.sqrt(5)) / 2;
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let l = 0; l < level; l++) {
    const cache = new Map(), nf = [];
    const mid = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; if (!cache.has(k)) { V.push(norm(scl(add(V[a], V[b]), 0.5))); cache.set(k, V.length - 1); } return cache.get(k); };
    for (const [a, b, c] of F) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    F = nf;
  }
  return (icoCache[level] = { V, F });
}
// o: {sub, noise, freq, seed, col(ny), wind(p), surf, mask, uvS, u0, v0, shape(x,y,z,d)}
function addBlob(b, c, r, o = {}) {
  const { V, F } = ico(o.sub ?? 1), base = b.n, f = o.freq || 1.5, s = o.seed || 0;
  if ((o.sub ?? 1) === 0) r = [r[0] * 1.15, r[1] * 1.15, r[2] * 1.15];   // 20면체는 구보다 작아서 보정(LOD2에서 바닥이 뜨지 않게)
  const off = [(s * 0.37) % 7, (s * 0.61) % 7, (s * 0.83) % 7];
  for (const d of V) {
    const k = o.noise ? 1 + (noise3(d[0] * f + off[0], d[1] * f + off[1], d[2] * f + off[2], s | 0) - 0.5) * 2 * o.noise : 1;
    let p = [c[0] + d[0] * r[0] * k, c[1] + d[1] * r[1] * k, c[2] + d[2] * r[2] * k];
    if (o.shape) p = o.shape(p[0], p[1], p[2], d);
    b.v(p[0], p[1], p[2], (o.u0 || 0) + p[0], (o.v0 || 0) + p[2], col(o.col ? o.col(d[1]) : 1), o.wind ? o.wind(p) : 0, o.mask || 0, o.surf || 0);
  }
  for (const [a, bb, cc] of F) b.tri(base + a, base + bb, base + cc);
}
// 작은 원판 (버섯 점, 꽃 중심)
function addDisc(b, c, nrm, r, seg, color, o = {}) {
  const u = norm(cross(nrm, Math.abs(nrm[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), w = cross(nrm, u);
  const ci = b.v(c[0], c[1], c[2], 0, 0, col(color), o.wind || 0, o.mask || 0, o.surf || 0, nrm);
  const ring = [];
  for (let j = 0; j < seg; j++) {
    const th = (j / seg) * TAU, cs = Math.cos(th) * r, sn = Math.sin(th) * r;
    ring.push(b.v(c[0] + u[0] * cs + w[0] * sn, c[1] + u[1] * cs + w[1] * sn, c[2] + u[2] * cs + w[2] * sn, cs, sn, col(color), o.wind || 0, o.mask || 0, o.surf || 0, nrm));
  }
  for (let j = 0; j < seg; j++) b.tri(ci, ring[j], ring[(j + 1) % seg]);
}

// 마무리: 법선 계산, 선택적 면분리(바위), 위쪽 법선 섞기(잎 부드러운 조명), 위쪽 면 마스크(이끼/눈)
// o: {deindex, smooth(0..1), tri(삼평면 uv), upBlend:[층0,층1], maskUp:{lo,hi,surf}}
function finish(b, o = {}) {
  const nv = b.n, P = b.P, I = b.I, nt = I.length / 3;
  const sm = new Float32Array(nv * 3), fn = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, bb = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[bb] - P[a], uy = P[bb + 1] - P[a + 1], uz = P[bb + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    fn[t * 3] = x; fn[t * 3 + 1] = y; fn[t * 3 + 2] = z;
    for (const k of [a, bb, c]) { sm[k] += x; sm[k + 1] += y; sm[k + 2] += z; }
  }
  const nrm1 = (arr, i) => (Math.hypot(arr[i], arr[i + 1], arr[i + 2]) < 1e-12 ? [0, 1, 0] : norm([arr[i], arr[i + 1], arr[i + 2]]));
  const up = o.upBlend || [0, 0], mu = o.maskUp;
  let position, normal, uv, color, nat, index, N;
  if (o.deindex) {
    N = nt * 3;
    position = new Float32Array(N * 3); normal = new Float32Array(N * 3); uv = new Float32Array(N * 2); color = new Float32Array(N * 3); nat = new Float32Array(N * 3);
    const S = o.smooth ?? 0;
    for (let t = 0; t < nt; t++) {
      const fN = nrm1(fn, t * 3);
      for (let k = 0; k < 3; k++) {
        const vi = I[t * 3 + k], d = t * 3 + k;
        const sN = nrm1(sm, vi * 3);
        const nn = nrm1([fN[0] * (1 - S) + sN[0] * S, fN[1] * (1 - S) + sN[1] * S, fN[2] * (1 - S) + sN[2] * S], 0);
        position.set(P.slice(vi * 3, vi * 3 + 3), d * 3); normal.set(nn, d * 3);
        color.set(b.C.slice(vi * 3, vi * 3 + 3), d * 3); nat.set(b.NA.slice(vi * 3, vi * 3 + 3), d * 3);
        if (o.tri) {                                  // 삼평면 uv: 면 법선이 큰 축으로 투영 → 늘어짐 방지
          const ax = Math.abs(fN[0]), ay = Math.abs(fN[1]), az = Math.abs(fN[2]);
          const x = P[vi * 3], y = P[vi * 3 + 1], z = P[vi * 3 + 2];
          if (ay >= ax && ay >= az) uv.set([x, z], d * 2); else if (ax >= az) uv.set([z, y], d * 2); else uv.set([x, y], d * 2);
        } else uv.set(b.UV.slice(vi * 2, vi * 2 + 2), d * 2);
      }
    }
    index = new Uint32Array(N); for (let i = 0; i < N; i++) index[i] = i;
  } else {
    N = nv;
    position = new Float32Array(P); normal = new Float32Array(nv * 3); uv = new Float32Array(b.UV); color = new Float32Array(b.C); nat = new Float32Array(b.NA);
    for (let i = 0; i < nv; i++) {
      const n = Number.isNaN(b.NR[i * 3]) ? nrm1(sm, i * 3) : nrm1(b.NR, i * 3);
      normal.set(n, i * 3);
    }
    index = nv < 65535 ? new Uint16Array(I) : new Uint32Array(I);
  }
  let minY = Infinity, maxY = -Infinity, maxR = 0;
  for (let i = 0; i < N; i++) {
    const surf = nat[i * 3 + 2] > 0.5 ? 1 : 0, ub = up[surf];
    let nx = normal[i * 3], ny = normal[i * 3 + 1], nz = normal[i * 3 + 2];
    if (ub) { const l = Math.hypot(nx, ny + ub, nz) || 1; nx /= l; ny = (ny + ub) / l; nz /= l; }
    normal[i * 3] = nx; normal[i * 3 + 1] = ny; normal[i * 3 + 2] = nz;
    if (mu && (mu.surf === undefined || mu.surf === surf)) nat[i * 3 + 1] = Math.max(nat[i * 3 + 1], smoothstep(mu.lo, mu.hi, ny));
    const y = position[i * 3 + 1];
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    maxR = Math.max(maxR, Math.hypot(position[i * 3], position[i * 3 + 2]));
  }
  return { position, normal, uv, color, nat, index, vertexCount: N, triCount: index.length / 3, minY, height: maxY, radius: maxR, meta: b.meta };
}

// ====================== 베이스 1: 나무 ======================
// 줄기(곡선+뿌리) + 가지(+잔가지) + 수관(blob 덩어리 | cone 층 | none). 모든 나무 종류는 이 하나에서 파생.
function buildTree(P, rand, lod) {
  const b = new Buf(), far = lod >= 2;
  const H = R(rand, P.height), TR = R(rand, P.trunkR);
  const seg = Math.max(4, far ? Math.min(P.seg, 6) : P.seg - (lod ? 3 : 0)), rings = far ? 3 : lod ? 4 : 7;
  const lean = R(rand, P.lean), leanAz = rand() * TAU, bend = R(rand, P.bend), ph = rand() * TAU;
  const L = H * P.trunkFrac;
  const spine = [], rad = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, off = lean * L * t * t, wob = bend * TR * 0.5 * t;
    spine.push([Math.cos(leanAz) * off + Math.sin(t * 4 + ph) * wob, i === 0 ? -0.3 : L * t, Math.sin(leanAz) * off + Math.cos(t * 3.3 + ph) * wob]);
    rad.push(TR * lerp(1, P.taper, t) * (1 + P.flare * Math.pow(Math.max(0, 1 - t * 4), 2)) * (1 + (P.belly || 0) * Math.sin(Math.PI * t)));
  }
  const at = (t) => { const f = clamp(t) * rings, i = Math.min(rings - 1, Math.floor(f)), u = f - i, a = spine[i], c = spine[i + 1]; return [lerp(a[0], c[0], u), lerp(a[1], c[1], u), lerp(a[2], c[2], u)]; };
  const radAt = (t) => lerp(rad[Math.min(rings, Math.floor(clamp(t) * rings))], rad[Math.min(rings, Math.floor(clamp(t) * rings) + 1)], 0.5);
  const wind = (p) => P.sway * Math.pow(clamp(p[1] / H), 2);
  const ch = P.char || 0, ribN = P.rib ? RI(rand, P.rib.n) : 0, rib = ribN ? [ribN, P.rib.amp] : null;
  const barkCol = (t, u, p) => {
    let c = 0.5 + 0.5 * smoothstep(0, 0.18, t);
    if (P.marks) c *= 1 - P.marks * smoothstep(0.6, 0.78, noise3(Math.cos(u * TAU) * 1.6 + 3, p[1] * 3.4, Math.sin(u * TAU) * 1.6, 9));
    if (rib) c *= 0.8 + 0.2 * Math.cos(ribN * u * TAU);
    if (ch) {                                                  // 탄화: 아래부터 검게 (ch=1 전체, 0.5 아래 절반)
      const m = clamp((ch * 1.25 - t) / 0.25), k = 0.1 * (0.8 + 0.6 * noise3(Math.cos(u * TAU) * 2, p[1] * 5, Math.sin(u * TAU) * 2, 17));
      return [c + (k - c) * m, c + (k * 0.95 - c) * m, c + (k * 0.9 - c) * m];
    }
    return [c, c, c];
  };
  const maskFn = P.embers ? (t, u, p) => P.embers * smoothstep(0.74, 0.9, noise3(Math.cos(u * TAU) * 2 + 7, p[1] * 4, Math.sin(u * TAU) * 2, 21)) * (1 - t * 0.6) : null;
  if (!P.noTrunk) {
    addTube(b, spine, rad, seg, { col: barkCol, wind, surf: 0, rib, maskFn, cap: !P.dome });
    if (P.dome) { const tp = spine[rings], r = rad[rings], fl = P.domeFlat; addTube(b, [tp, [tp[0], tp[1] + r * (fl ? 0.22 : 0.45), tp[2]], [tp[0], tp[1] + r * (fl ? 0.4 : 0.8), tp[2]]], fl ? [r, r * 0.9, r * 0.55] : [r, r * 0.72, r * 0.25], seg, { col: (t2, u2) => barkCol(1, u2, tp), wind, surf: 0, rib }); }
  }
  // 뿌리
  const nr = RI(rand, P.roots);
  for (let k = 0; k < nr; k++) {
    const az = (k / Math.max(1, nr)) * TAU + rand() * 0.6, d = [Math.cos(az), 0, Math.sin(az)], len = TR * R(rand, [1.6, 2.6]) * (1 + P.flare * 0.4) * (P.rootLen || 1);
    const pts = [[d[0] * TR * 0.4, 0.2, d[2] * TR * 0.4], [d[0] * len * 0.5, 0.06, d[2] * len * 0.5], [d[0] * len, -0.12, d[2] * len]];
    if (!far && !P.noTrunk) addTube(b, pts, [TR * 0.55, TR * 0.3, TR * 0.08], lod ? 3 : 4, { col: () => [0.5, 0.5, 0.5], surf: 0 });
  }
  // 가지
  const tips = [], B = P.br, nb = RI(rand, B.n);
  for (let k = 0; k < nb; k++) {
    const t = lerp(B.from, B.to, (k + rand() * 0.6) / Math.max(1, nb)), base = at(t), rb = radAt(t);
    const az = k * 2.39996 + rand() * 0.8, elev = R(rand, B.elev), len = R(rand, B.len) * H;
    const drawn = !lod || (lod === 1 && k % 2 === 0), tw = [rand(), rand()];
    if (B.elbow) {                                            // 선인장 팔: 옆으로 나갔다가 위로 꺾임
      const dh = [Math.cos(az), 0, Math.sin(az)], ra = rb * (B.rArm || 0.6), sg = Math.max(4, seg - 1);
      const p0 = [base[0] + dh[0] * rb * 0.4, base[1], base[2] + dh[2] * rb * 0.4], p1 = [p0[0] + dh[0] * len * 0.35, p0[1], p0[2] + dh[2] * len * 0.35];
      const p2 = [p1[0] + dh[0] * len * 0.12, p1[1] + len * 0.2, p1[2] + dh[2] * len * 0.12], p3 = [p2[0], p2[1] + len * 0.6, p2[2]];
      if (drawn) {
        addTube(b, [p0, p1, p2, p3], [ra, ra * 0.95, ra * 0.9, ra * 0.85], sg, { col: (t2, u2) => barkCol(0.9, u2, p3), wind, surf: 0, rib });
        addTube(b, [p3, [p3[0], p3[1] + ra * 0.45, p3[2]], [p3[0], p3[1] + ra * 0.8, p3[2]]], [ra * 0.85, ra * 0.6, ra * 0.2], sg, { col: (t2, u2) => barkCol(1, u2, p3), wind, surf: 0, rib });
      }
      tips.push({ p: p3, drawn });
      continue;
    }
    const dir = [Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)];
    const pts = [0, 1, 2, 3].map((j) => { const u = j / 3; return [base[0] + dir[0] * len * u, base[1] + dir[1] * len * u - B.droop * len * u * u, base[2] + dir[2] * len * u]; });
    const twig = B.twigs && t > 0.3;
    if (drawn) addTube(b, pts, [Math.max(0.03, rb * 0.5), rb * 0.32, rb * 0.18, 0.02], lod ? 3 : 4, { col: () => [0.75, 0.75, 0.75], wind, surf: 0 });
    if (P.snowCaps && !lod) for (const q of [pts[1], pts[2]]) addBlob(b, [q[0], q[1] + rb * 0.2 + 0.03, q[2]], [len * 0.15, len * 0.045, len * 0.15], { sub: 0, noise: 0.18, seed: k * 3 + 1, mask: 1, col: () => 1, wind });
    tips.push({ p: pts[3], drawn });
    if (twig && !lod) for (let q = 0; q < 2; q++) {
      const a2 = az + (q ? 0.9 : -0.9) + tw[q] * 0.4, l2 = len * 0.45, p0 = pts[2];
      const d2 = [Math.cos(a2) * 0.7 + dir[0] * 0.3, 0.35 + elev * 0.2, Math.sin(a2) * 0.7 + dir[2] * 0.3];
      addTube(b, [p0, [p0[0] + d2[0] * l2 * 0.5, p0[1] + d2[1] * l2 * 0.5, p0[2] + d2[2] * l2 * 0.5], [p0[0] + d2[0] * l2, p0[1] + d2[1] * l2 - 0.1 * l2, p0[2] + d2[2] * l2]], [rb * 0.14, rb * 0.09, 0.015], 3, { col: () => [0.7, 0.7, 0.7], wind, surf: 0 });
      tips.push({ p: [p0[0] + d2[0] * l2, p0[1] + d2[1] * l2, p0[2] + d2[2] * l2], drawn: false, twig: true });
    }
  }
  // 수관
  const C = P.crown, top = spine[rings];
  if (C.type === 'blob') {
    const Rb = () => R(rand, C.r) * H, blobs = [];
    blobs.push([top[0], top[1] + H * 0.03, top[2], Rb() * 1.05, 1]);
    for (const tp of tips) { const rr = Rb() * 0.85, a2 = rand(); if (!tp.twig) blobs.push([tp.p[0], tp.p[1] + rr * 0.25, tp.p[2], rr, tp.drawn || a2 < 0.0 ? 1 : 0]); }
    const nf = RI(rand, C.fill);
    for (let k = 0; k < nf; k++) { const a = rand() * TAU, d = C.spread * H * (0.4 + rand() * 0.6); blobs.push([top[0] + Math.cos(a) * d, top[1] + (rand() - 0.3) * C.spread * H * 0.8, top[2] + Math.sin(a) * d, Rb() * 0.9, k < 1 ? 1 : 0]); }
    const flat = R(rand, C.flat);
    let drawnCount = 0;
    blobs.forEach((bl, k) => {
      const bright = 0.85 + rand() * 0.3, u0 = rand() * 5, v0 = rand() * 5;
      if (far ? k > 2 : lod && (k > 5 || (k > 0 && k % 2 === 0))) return;
      drawnCount++;
      addBlob(b, [bl[0], bl[1], bl[2]], [bl[3], bl[3] * flat, bl[3]], { sub: far ? 0 : lod || k > 0 ? 1 : 2, noise: C.noise, freq: 1.6, seed: k + 3, surf: 1, u0, v0,
        col: (ny) => { const c = (0.5 + 0.5 * (ny * 0.5 + 0.5)) * bright; return [c, c, c]; }, wind });
    });
  } else if (C.type === 'cone') {
    const pexp = R(rand, [0.6, 1.4]), tiers = RI(rand, C.tiers), y0 = H * R(rand, C.bare), top2 = H * 0.97, CR = R(rand, C.R) * H, rag = C.ragged;
    for (let k = 0; k < tiers; k++) {
      const t = tiers > 1 ? k / (tiers - 1) : 0, hi = ((top2 - y0) / tiers) * 2.1, yy = lerp(y0, top2 - hi * 0.7, t);
      const Ri = CR * Math.pow(1 - t * 0.93, pexp) * (0.82 + 0.36 * rand()), c0 = at(yy / L), c = C.wobble ? [c0[0] + (rand() - 0.5) * C.wobble * H, c0[1], c0[2] + (rand() - 0.5) * C.wobble * H] : c0, bright = 0.9 + rand() * 0.2, pk = rand() * TAU, kk = 5 + Math.floor(rand() * 4);
      const w = (y) => P.sway * Math.pow(clamp(y / H), 2);
      const prof = [[Ri * 0.25, yy + hi * 0.1, 0.3 * bright, w(yy), 0, 1], [Ri, yy, 0.62 * bright, w(yy), 0, 1], [Ri * 0.6, yy + hi * 0.55, 0.85 * bright, w(yy + hi * 0.55), 0, 1], [0.0005, yy + hi, 1.0 * bright, w(yy + hi), 0, 1]];
      addLathe(b, prof, far ? 4 : lod ? 6 : 10, { cx: c[0], cz: c[2], radial: (th, i) => (i === 1 ? 1 - rag * (0.5 + 0.5 * Math.sin(th * kk + pk)) : i === 2 ? 1 - rag * 0.4 * (0.5 + 0.5 * Math.sin(th * kk + pk)) : 1) });
    }
  }
  if (C.type === 'palm') {                                   // 야자/나무고사리: 줄기 끝에서 방사형으로 퍼지는 잎
    const nf = RI(rand, C.fronds), nr = far ? 4 : lod ? 6 : 9;
    for (let k = 0; k < nf; k++) {
      const az = (k / nf) * TAU + rand() * 0.5, el = R(rand, [-0.15, 1.0]), len = R(rand, C.len), u0 = rand() * 4, v0 = rand() * 4;
      if (far && k % 2) continue;
      addFrond(b, { base: [top[0], top[1] - 0.05, top[2]], az, el, len, wd: len * 0.28, nr, droop: 0.9, u0, v0, col: (u) => { const s = 0.5 + 0.5 * u; return [s, s, s]; }, wind: (p, u) => P.sway * (0.3 + u) });
    }
  }
  if (C.type === 'pads') {                                   // 부채선인장: 납작한 타원 패드를 이어 붙임
    const np = RI(rand, C.n), size = R(rand, C.size), pads = [];
    for (let k = 0; k < np; k++) {
      const par = k ? pads[Math.floor(rand() * pads.length)] : null, sc = par ? par.sc * R(rand, [0.72, 0.92]) : 1;
      const yaw = par ? par.yaw + (rand() - 0.5) * 1.8 : rand() * TAU, rx = size * sc, ry = rx * 1.12, rz = rx * 0.17;
      const ax = par ? [Math.cos(par.yaw), 0, -Math.sin(par.yaw)] : [0, 0, 0], j = par ? (rand() - 0.5) * par.rx * 1.1 : 0;
      const pos = par ? [par.pos[0] + ax[0] * j, par.pos[1] + par.ry * 0.85 + ry * 0.55, par.pos[2] + ax[2] * j] : [top[0], top[1] + ry * 0.85, top[2]];
      const ta = (rand() - 0.5) * 0.5, taz = rand() * TAU, start = b.n;
      addBlob(b, [0, 0, 0], [rx, ry, rz], { sub: far ? 0 : 1, noise: 0.06, seed: k + 7, col: (ny) => { const c = 0.65 + 0.35 * (ny * 0.5 + 0.5); return [c, c, c]; }, wind: () => P.sway * 0.4 });
      xform(b, start, { ta, az: taz, yaw, ox: pos[0], oy: pos[1], oz: pos[2] });
      pads.push({ pos, rx, ry, yaw, sc });
    }
  }
  b.meta = { coll: P.coll ?? TR * 1.05, kind: 'tree' };
  return b;
}

// ====================== 베이스 2: 바위 ======================
// 이십면체 + 3D 노이즈 변형 + 납작/뾰족/층리. 면분리(각진 정도는 smooth로 조절) + 삼평면 uv.
// 확장: arch(사암 아치), stack(메사/후두 적층), invert(고드름처럼 거꾸로 매달림)
function buildRock(P, rand, lod) {
  const b = new Buf(), r0 = R(rand, P.radius), sub = lod >= 2 ? 0 : lod ? 1 : 2;
  const stretch = [R(rand, P.sx), R(rand, P.sy), R(rand, P.sz)], seed = Math.floor(rand() * 1000), shear = (rand() - 0.5) * 2 * (P.shear || 0);
  const blob = (px, py, pz, rx, ry, rz, k, sb = sub, ft = 0) => addBlob(b, [px, py, pz], [rx, ry, rz], {
    sub: sb, noise: P.noise, freq: P.freq, seed: seed + k * 13, surf: 0,
    shape: (x, y, z, d) => {
      const yy = ft && d[1] > ft ? py + ft * ry : P.flatten > 0 && d[1] < -P.flatten ? py - P.flatten * ry : y, k2 = P.taper ? 1 - P.taper * clamp((d[1] + 1) / 2) : 1, sh = shear * (d[1] + 1) * 0.5 * ry;
      return [px + (x - px) * k2 + sh, yy, pz + (z - pz) * k2];
    },
    col: (ny) => { const c = 0.55 + 0.45 * smoothstep(-0.9, 0.5, ny); return [c, c, c]; } });
  const baseY = (ry) => ry * P.flatten - ry * 0.12;            // 밑면이 지면에서 살짝 묻히도록 (공중에 뜨지 않게)
  let colliders = null;
  if (P.arch) {
    const A = P.arch, span = R(rand, A.span), hgt = R(rand, A.height), th = R(rand, A.thick), dz = R(rand, [1.1, 1.5]), n = 10, asub = lod ? 0 : 1;
    for (const sg of [-1, 1]) blob(sg * span / 2, th * 0.7, 0, th * 1.2, th * 0.95, th * dz, sg + 3, asub);   // 기둥 발
    for (let i = 1; i < n; i++) { const a = Math.PI * (1 - i / n), w = th * (1.2 - 0.3 * Math.sin(a)); blob(Math.cos(a) * span / 2, Math.sin(a) * hgt + th * 0.7, 0, w, w * R(rand, [0.95, 1.2]), th * dz, 10 + i, asub); }
    colliders = [[-span / 2, 0, th * 1.1], [span / 2, 0, th * 1.1]];
  } else if (P.stack) {
    const S = P.stack, nl = RI(rand, S.layers), neck = Array.isArray(S.neck) ? R(rand, S.neck) : S.neck, cap = Array.isArray(S.cap) ? R(rand, S.cap) : S.cap; let y = 0;
    for (let i = 0; i < nl; i++) {
      const last = i === nl - 1, mid = i > 0 && !last;
      const rx = r0 * (S.cap && last ? cap : mid && S.neck ? neck : 1 - (S.taper || 0) * i / nl) * R(rand, [0.92, 1.08]), ry = rx * R(rand, S.thick);
      const fl = P.flatten;
      blob((rand() - 0.5) * r0 * 0.12, fl ? y + ry * (fl - 0.05) : y + ry * 0.9, (rand() - 0.5) * r0 * 0.12, rx * stretch[0], ry, rx * stretch[2], i, sub, S.ftAll ? fl : last ? (S.flatTop || 0) : 0);
      y += fl ? ry * 2 * fl * 0.97 : ry * (S.step || 1.55);
    }
  } else {
    const parts = [[0, 0, 1]], nch = RI(rand, P.chips);
    for (let k = 0; k < nch; k++) { const a = rand() * TAU, d = r0 * R(rand, [1.0, 1.7]); parts.push([Math.cos(a) * d, Math.sin(a) * d, R(rand, [0.25, 0.5])]); }
    const ng = P.group ? RI(rand, P.group) : 0;
    for (let k = 0; k < ng; k++) { const a = rand() * TAU, d = r0 * R(rand, [0.7, 1.5]); parts.push([Math.cos(a) * d, Math.sin(a) * d, R(rand, [0.4, 0.8])]); }
    parts.forEach(([px, pz, sc], k) => { const r = r0 * sc, ry = r * stretch[1] * (k ? R(rand, [0.7, 1.2]) : 1); blob(px, baseY(ry), pz, r * stretch[0], ry, r * stretch[2], k, k ? Math.min(sub, P.chipSub ?? 1) : sub); });
  }
  // 층리(색 줄무늬): 정점 높이에 따라 밝기 변화
  if (P.strata) for (let i = 0; i < b.n; i++) { const st = 1 - P.strata * 0.55 * (0.5 + 0.5 * Math.sin(b.P[i * 3 + 1] * 9 + noise3(b.P[i * 3], 0, b.P[i * 3 + 2], 5) * 3)); b.C[i * 3] *= st; b.C[i * 3 + 1] *= st; b.C[i * 3 + 2] *= st; }
  if (P.invert) xform(b, 0, { ta: Math.PI });
  b.meta = { coll: P.arch ? 0 : r0 * Math.max(stretch[0], stretch[2]) * 0.85, colliders, hang: !!P.invert, kind: 'rock' };
  return b;
}

// ====================== 베이스 3: 잔디/풀 ======================
function buildGrass(P, rand, lod) {
  const b = new Buf(), nB = RI(rand, P.blades), rows = lod ? 2 : P.rows, hRef = P.height[1];
  for (let k = 0; k < nB; k++) {
    const a = rand() * TAU, d = Math.sqrt(rand()) * P.spread, bx = Math.cos(a) * d, bz = Math.sin(a) * d, az = rand() * TAU;
    let f = [lerp(Math.cos(az), Math.cos(a), P.outward), lerp(Math.sin(az), Math.sin(a), P.outward)];
    const fl = Math.hypot(f[0], f[1]) || 1; f = [f[0] / fl, f[1] / fl];
    const h = R(rand, P.height) * (1 - P.edge * (d / P.spread)), w = P.width * (0.8 + 0.4 * rand()), curl = P.curl * (0.6 + 0.8 * rand()), shade = 0.85 + 0.3 * rand();
    const u0 = rand() * 5, v0 = rand() * 5, hasHead = P.bulge ? rand() < (P.headFrac ?? 1) : false;
    if (lod && k % 5 >= (lod >= 2 ? 1 : 3)) continue;
    const side = [-f[1], f[0]], rr = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows, cy = h * t - 0.05, cf = curl * h * t * t + P.lean * h * t, hw = 0.5 * w * (1 - Math.pow(t, P.taper)) * (lod ? 1.4 : 1) + (hasHead && t > 0.7 ? P.bulge * 0.5 * Math.sin(Math.PI * (t - 0.7) / 0.3) : 0);
      const cx = bx + f[0] * cf, cz = bz + f[1] * cf;
      rr.push({ l: [cx - side[0] * hw, cy, cz - side[1] * hw], r: [cx + side[0] * hw, cy, cz + side[1] * hw] });
    }
    addLoft(b, rr, { face: [f[0], 0.3, f[1]], u0, v0, uw: w, col: (t) => { const s = shade * (0.4 + 0.6 * t); return hasHead && P.headCol && t > 0.72 ? [P.headCol[0] * s, P.headCol[1] * s, P.headCol[2] * s] : [s, s, s]; }, wind: (p, t) => P.sway * t * t * (h / hRef) });
  }
  b.meta = { coll: 0, kind: 'grass' };
  return b;
}

// ====================== 베이스 4: 꽃 ======================
function buildFlower(P, rand, lod) {
  const b = new Buf(), heads = RI(rand, P.heads);
  for (let k = 0; k < heads; k++) {
    const az = heads === 1 ? rand() * TAU : (k / heads) * TAU + rand() * 0.6;
    const H = R(rand, P.height) * (heads === 1 ? 1 : 0.7 + 0.3 * rand());
    const lean = heads === 1 ? R(rand, P.lean) : R(rand, P.lean) * 1.5 + 0.25, bend = R(rand, P.bend);
    const dirH = [Math.cos(az), Math.sin(az)], pts = [[0, -0.05, 0]], n = 5, tans = [];
    let p = [0, -0.05, 0];
    for (let i = 1; i <= n; i++) {
      const th = lean + bend * Math.pow(i / n, 1.5), t = [Math.sin(th) * dirH[0], Math.cos(th), Math.sin(th) * dirH[1]];
      p = add(p, scl(t, H / n)); pts.push(p); tans.push(t);
    }
    addTube(b, pts, [0.011, 0.009, 0.008, 0.007, 0.007, 0.007], 3, { col: (t) => { const s = 0.55 + 0.45 * t; return [s, s, s]; }, wind: (q, t) => P.sway * t * t, surf: 0 });
    // 잎
    const nl = RI(rand, P.leaves);
    for (let i = 0; i < nl; i++) {
      const t = 0.1 + 0.4 * (i / Math.max(1, nl)) + rand() * 0.1, base = pts[Math.min(n, Math.round(t * n))], la = rand() * TAU, len = H * R(rand, [0.3, 0.5]), wd = len * 0.26;
      const el = R(rand, [0.35, 0.9]), d = [Math.cos(la) * Math.cos(el), Math.sin(el), Math.sin(la) * Math.cos(el)], sd = [-Math.sin(la), 0, Math.cos(la)];
      const rr = [0, 0.45, 0.85, 1].map((u, j) => { const c = [base[0] + d[0] * len * u, base[1] + d[1] * len * u - 0.25 * len * u * u, base[2] + d[2] * len * u]; const w = [0.2, 1, 0.7, 0][j] * wd * 0.5; return { l: sub(c, scl(sd, w)), r: add(c, scl(sd, w)) }; });
      addLoft(b, rr, { face: [0, 1, 0], uw: wd, u0: rand() * 4, v0: rand() * 4, col: (u) => { const s = 0.6 + 0.4 * u; return [s, s, s]; }, wind: (q, u) => P.sway * 0.3 * u, surf: 0 });
    }
    if (P.spike) {                                           // 라벤더/루핀: 줄기 윗부분에 작은 꽃이 층층이
      const ns = RI(rand, P.spike), W = R(rand, P.petalW), Lp = R(rand, P.petalL);
      for (let j = 0; j < ns; j++) {
        const tt = 0.45 + 0.55 * (j + 0.5) / ns, f = tt * n, i0 = Math.min(n - 1, Math.floor(f)), uu = f - i0;
        const cp = [lerp(pts[i0][0], pts[i0 + 1][0], uu), lerp(pts[i0][1], pts[i0 + 1][1], uu), lerp(pts[i0][2], pts[i0 + 1][2], uu)], ang = j * 2.4 + rand();
        const a = norm([Math.cos(ang) * 0.9 + tans[i0][0] * 0.4, 0.25 + tans[i0][1] * 0.4, Math.sin(ang) * 0.9 + tans[i0][2] * 0.4]);
        const u = norm(cross(a, Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), v = cross(a, u), hs = 1.15 - 0.7 * tt, np = 4 + (j % 2), op = R(rand, P.open);
        for (let i = 0; i < np; i++) {
          const ap = (i / np) * TAU, q = add(scl(u, Math.cos(ap)), scl(v, Math.sin(ap))), d = add(scl(a, Math.cos(op)), scl(q, Math.sin(op))), tg = norm(cross(a, q));
          const rr = [0, 0.5, 1].map((t, jj) => { const pc = add(add(cp, scl(q, Lp * 0.1 * hs)), scl(d, Lp * hs * t)); const w = [0.4, 1, 0][jj] * W * hs * 0.5; return { l: sub(pc, scl(tg, w)), r: add(pc, scl(tg, w)) }; });
          addLoft(b, rr, { face: add(scl(a, 0.6), scl(q, 0.4)), mask: 1, surf: 1, uw: W * hs, u0: rand() * 3, v0: rand() * 3, col: (t) => { const s2 = 0.75 + 0.25 * t; return [s2, s2, s2]; }, wind: () => P.sway });
        }
      }
      continue;
    }
    // 머리
    const c = pts[n], a = norm(tans[n - 1]), u = norm(cross(a, Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), v = cross(a, u);
    const np = RI(rand, P.petals), W = R(rand, P.petalW), Lp = R(rand, P.petalL), open = R(rand, P.open), rho = Lp * 0.12 + 0.01;
    const hs = heads === 1 ? 1 : 0.72, jit = rand() * TAU;
    for (let i = 0; i < np; i++) {
      const ap = (i / np) * TAU + jit + (rand() - 0.5) * 0.15, q = add(scl(u, Math.cos(ap)), scl(v, Math.sin(ap)));
      const d = add(scl(a, Math.cos(open)), scl(q, Math.sin(open))), tg = norm(cross(a, q));
      const rr = [0, 0.4, 0.8, 1].map((t, j) => {
        let pc = add(add(c, scl(q, rho * hs)), scl(d, Lp * hs * t));
        pc = add(pc, add(scl(a, P.curl * Lp * hs * t * t), scl(q, P.flare * Lp * hs * t * t)));
        const w = [0.3, 1, 0.8, 0][j] * W * hs * 0.5;
        return { l: sub(pc, scl(tg, w)), r: add(pc, scl(tg, w)) };
      });
      addLoft(b, rr, { face: add(scl(a, 0.6), scl(q, 0.4)), mask: 1, surf: 1, uw: W * hs, u0: rand() * 3, v0: rand() * 3, col: (t) => { const s = 0.7 + 0.3 * t; return [s, s, s]; }, wind: () => P.sway });
    }
    addDisc(b, add(c, scl(a, Lp * 0.05)), a, P.centerR * hs, lod ? 5 : 7, [1, 0.78, 0.15], { surf: 1, wind: P.sway });
  }
  b.meta = { coll: 0, kind: 'flower' };
  return b;
}

// ====================== 베이스 5: 버섯 ======================
function buildMushroom(P, rand, lod) {
  const b = new Buf(), count = RI(rand, P.count), seg = lod ? 6 : 9, steps = lod ? 3 : 5;
  const shape = { dome: (x) => Math.sqrt(Math.max(0, 1 - x * x)), cone: (x) => 1 - x, flat: (x) => 0.45 * (1 - Math.pow(x, 3)), bell: (x) => 1 - Math.pow(x, 1.6) }[P.shape];
  for (let k = 0; k < count; k++) {
    const start = b.n, sc = k === 0 ? 1 : R(rand, [0.45, 0.9]);
    const capR = R(rand, P.capR), capH = R(rand, P.capH), sh = R(rand, P.stemH), sr = R(rand, P.stemR);
    const cream = [0.96, 0.92, 0.8];
    addLathe(b, [[sr * 1.4, -0.03, cream.map((c) => c * 0.55), 0, 0, 0], [sr * 1.1, sh * 0.12, cream.map((c) => c * 0.85), 0, 0, 0], [sr * 0.92, sh * 0.6, cream, 0, 0, 0], [sr * P.stemTop, sh, cream.map((c) => c * 0.9), 0, 0, 0]], seg);
    const prof = [[sr * P.stemTop, sh - 0.01, [0.55, 0.42, 0.3], 0, 0, 1], [capR, sh, [0.7, 0.55, 0.4], 0, 0, 1]];
    for (let j = 1; j <= steps; j++) { const rr = 1 - j / steps, r = Math.max(rr * capR, 0.0005); prof.push([r, sh + capH * shape(rr), 0.7 + 0.3 * (1 - rr), 0, 1, 1]); }
    addLathe(b, prof, seg);
    const spots = P.spots ? RI(rand, P.spots) : 0;
    for (let q = 0; q < spots; q++) {
      const rf = R(rand, [0.15, 0.8]), ang = rand() * TAU, y = sh + capH * shape(rf) + 0.004, e = 0.02, slope = (shape(Math.min(1, rf + e)) - shape(rf)) * capH / (e * capR);
      const nn = norm([Math.cos(ang) * -slope, 1, Math.sin(ang) * -slope]);
      if (!lod) addDisc(b, [Math.cos(ang) * rf * capR, y, Math.sin(ang) * rf * capR], nn, capR * R(rand, [0.06, 0.12]), 6, [1, 1, 0.95], { surf: 1 });
    }
    const a = rand() * TAU, d = k === 0 ? 0 : R(rand, [0.5, 1.2]) * P.capR[1];
    xform(b, start, { s: sc, ta: R(rand, P.tilt) * (k ? 1.6 : 1), az: rand() * TAU, ox: Math.cos(a) * d, oz: Math.sin(a) * d });
  }
  b.meta = { coll: 0, kind: 'mushroom' };
  return b;
}

// ====================== 베이스 6: 그루터기 / 통나무 ======================
// char(0~1): 탄화 정도. 0이면 일반 목재, 1이면 숯처럼 검게.
function buildStump(P, rand, lod) {
  const b = new Buf(), r = R(rand, P.radius), h = R(rand, P.log ? P.length : P.height), seg = lod >= 2 ? 6 : lod ? 8 : 14, ph = rand() * TAU, nR = RI(rand, P.roots);
  const cm = 1 - 0.9 * (P.char || 0), W = (c) => c.map((x) => x * cm), bark = (s) => [s * cm, s * cm, s * cm], wood = W([1, 0.85, 0.6]), top = P.top;
  const prof = [[r * 1.3, -0.12, bark(0.5), 0, 0, 0], [r * 1.12, h * 0.12, bark(0.75), 0, 0, 0], [r * 1.0, h * 0.5, bark(0.95), 0, 0, 0], [r * 0.97, h * 0.92, bark(1), 0, 0, 0], [r * 0.95, h, bark(0.9), 0, 0, 0]];
  if (top === 'hollow') {
    prof.push([r * 0.72, h * 1.01, wood, 0, 0, 1], [r * 0.66, h * 0.6, W([0.3, 0.3, 0.3]), 0, 0, 0], [r * 0.6, h * 0.42, W([0.12, 0.12, 0.12]), 0, 0, 0], [0.001, h * 0.4, W([0.1, 0.1, 0.1]), 0, 0, 0]);
  } else if (top === 'broken') {
    prof.push([r * 0.72, h * 0.92, W([0.9, 0.78, 0.55]), 0, 0, 1], [r * 0.4, h * 0.82, W([0.75, 0.62, 0.42]), 0, 0, 1], [0.001, h * 0.76, W([0.6, 0.5, 0.35]), 0, 0, 1]);
  } else {
    prof.push([r * 0.8, h * 1.005, wood, 0, 0, 1], [r * 0.6, h * 1.0, wood.map((c) => c * 0.8), 0, 0, 1], [r * 0.4, h * 1.005, wood, 0, 0, 1], [r * 0.2, h * 1.0, wood.map((c) => c * 0.82), 0, 0, 1], [0.001, h * 1.005, wood, 0, 0, 1]);
  }
  const start = b.n;
  addLathe(b, prof, seg, {
    radial: (th, i) => { const k = Math.max(0, 1 - i / 3); return 1 + P.flare * Math.pow(Math.max(0, Math.sin(th * nR + ph)), 2) * k * k + 0.05 * (noise3(Math.cos(th) * 2, i, Math.sin(th) * 2, 4) - 0.5); },
    yfn: top === 'broken' ? (th, i) => (i >= 4 ? h * P.jag * (noise3(Math.cos(th) * 2.4 + 5, i * 0.5, Math.sin(th) * 2.4, 11) * 2 - 0.7) : 0) : null
  });
  const stubs = P.stubs ? RI(rand, P.stubs) : 0;
  for (let q = 0; q < stubs; q++) {
    const a = rand() * TAU, y = h * R(rand, [0.3, 0.7]), d = [Math.cos(a), 0, Math.sin(a)], l = r * R(rand, [0.5, 0.9]);
    if (lod < 2) addTube(b, [[d[0] * r * 0.85, y, d[2] * r * 0.85], [d[0] * (r + l * 0.5), y + l * 0.25, d[2] * (r + l * 0.5)], [d[0] * (r + l), y + l * 0.45, d[2] * (r + l)]], [r * 0.22, r * 0.17, r * 0.13], 5, { col: () => [0.85 * cm, 0.85 * cm, 0.85 * cm] });
  }
  if (P.log) xform(b, start, { ta: Math.PI / 2, az: 0, oy: r * 0.8, ox: -h * 0.5 });
  b.meta = { coll: P.log ? 0 : r, kind: P.log ? 'log' : 'stump' };
  return b;
}

// ====================== 베이스 7: 작은 식물 (고사리/덤불/로제트/묘목) ======================
function leafRows(base, d, sd, len, wd, droop, widths) {
  return [0, 0.35, 0.7, 1].map((u, j) => {
    const c = [base[0] + d[0] * len * u, base[1] + d[1] * len * u - droop * len * u * u, base[2] + d[2] * len * u];
    const w = widths[j] * wd * 0.5;
    return { l: sub(c, scl(sd, w)), r: add(c, scl(sd, w)) };
  });
}
function buildPlant(P, rand, lod) {
  const b = new Buf();
  const shade = (u) => { const s = 0.5 + 0.5 * u; return [s, s, s]; };
  if (P.type === 'fern') {
    const nf = RI(rand, P.fronds);
    for (let k = 0; k < nf; k++) {
      const az = (k / nf) * TAU + rand() * 0.5, el = R(rand, [0.5, 1.1]), len = R(rand, P.len), wd = len * 0.24;
      const d = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)], sd = [-Math.sin(az), 0, Math.cos(az)];
      const nr = lod ? 5 : 9, rr = [];
      for (let i = 0; i < nr; i++) {
        const u = i / (nr - 1), c = [d[0] * len * u, 0.04 + d[1] * len * u - 0.55 * len * u * u, d[2] * len * u];
        const w = (i === nr - 1 ? 0 : (i % 2 ? 0.55 : 1)) * wd * 0.5 * Math.sin(Math.PI * (0.12 + 0.88 * u));
        rr.push({ l: sub(c, scl(sd, w)), r: add(c, scl(sd, w)) });
      }
      addLoft(b, rr, { face: [0, 1, 0], uw: wd, u0: rand() * 4, v0: rand() * 4, col: shade, wind: (p, u) => P.sway * u * u });
    }
  } else if (P.type === 'rosette') {
    const nl = RI(rand, P.leaves);
    for (let k = 0; k < nl; k++) {
      const az = (k / nl) * TAU + rand() * 0.5, el = R(rand, [0.15, 0.6]), len = R(rand, P.len), wd = len * R(rand, [0.45, 0.7]);
      const d = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)], sd = [-Math.sin(az), 0, Math.cos(az)];
      addLoft(b, leafRows([0, 0.02, 0], d, sd, len, wd, 0.3, [0.35, 1, 0.8, 0]), { face: [0, 1, 0], uw: wd, u0: rand() * 4, v0: rand() * 4, col: shade, wind: (p, u) => P.sway * u * u });
    }
  } else if (P.type === 'sapling') {
    const H = R(rand, P.height), pts = [[0, -0.06, 0], [0.02, H * 0.35, 0.01], [-0.01, H * 0.7, 0.02], [0.02, H, 0]];
    addTube(b, pts, [0.025, 0.018, 0.013, 0.008], 4, { col: (t) => { const s = 0.6 + 0.4 * t; return [s, s, s]; }, wind: (p) => P.sway * Math.pow(p[1] / H, 2), surf: 1 });
    const nl = RI(rand, P.leaves);
    for (let k = 0; k < nl; k++) {
      const t = 0.3 + 0.7 * (k / nl), y = H * t, az = k * 2.4 + rand() * 0.5, el = R(rand, [0.2, 0.7]), len = R(rand, [0.18, 0.32]) * (1.1 - t * 0.4), wd = len * 0.6;
      const d = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)], sd = [-Math.sin(az), 0, Math.cos(az)];
      addLoft(b, leafRows([0.01, y, 0.01], d, sd, len, wd, 0.3, [0.3, 1, 0.8, 0]), { face: [0, 1, 0], uw: wd, u0: rand() * 4, v0: rand() * 4, col: shade, wind: (p, u) => P.sway * (y / H) * (0.5 + u) });
    }
  } else if (P.type === 'tumble') {                          // 회전초: 구 위의 호(arc)들이 엉킨 덩어리
    const Rr = R(rand, P.radius), na = RI(rand, P.arcs), np = lod >= 2 ? 4 : lod ? 5 : 8, cy = Rr * 0.85;
    for (let k = 0; k < na; k++) {
      const u = norm([rand() - 0.5, rand() - 0.5, rand() - 0.5]), v0 = norm([rand() - 0.5, rand() - 0.5, rand() - 0.5]), w = norm(cross(u, v0)), vv = cross(w, u);
      const span = R(rand, [1.8, 3.2]), ph0 = rand() * TAU, rk = Rr * R(rand, [0.7, 1.0]), shade = 0.7 + 0.3 * rand();
      if (lod && k % (lod >= 2 ? 3 : 2)) continue;
      const pts = [];
      for (let i = 0; i < np; i++) { const a = ph0 + span * i / (np - 1), rr2 = rk * (1 + 0.1 * Math.sin(i * 3 + k)); pts.push([(u[0] * Math.cos(a) + vv[0] * Math.sin(a)) * rr2, cy + (u[1] * Math.cos(a) + vv[1] * Math.sin(a)) * rr2, (u[2] * Math.cos(a) + vv[2] * Math.sin(a)) * rr2]); }
      addTube(b, pts, new Array(np).fill(0.014 * (lod ? 1.3 : 1)), 3, { col: () => [shade, shade, shade], surf: 0, cap: false, wind: () => P.sway });
    }
  } else if (P.type === 'twiggy') {                           // 마른 관목: 잎 거의 없는 가는 가지 다발
    const nt = RI(rand, P.twigs), hgt = R(rand, P.height);
    for (let k = 0; k < nt; k++) {
      const az = (k / nt) * TAU + rand() * 0.6, sp = R(rand, [0.35, 0.8]), l = hgt * R(rand, [0.7, 1.1]), dx = Math.cos(az) * sp, dz = Math.sin(az) * sp, sh = 0.7 + 0.3 * rand();
      const pts = [0, 1, 2, 3].map((j) => { const t = j / 3; return [dx * l * t * (0.5 + 0.5 * t), -0.04 + l * t, dz * l * t * (0.5 + 0.5 * t)]; });
      addTube(b, pts, [0.024, 0.017, 0.011, 0.006], 3, { col: () => [sh, sh, sh], surf: 1, wind: (p) => P.sway * Math.pow(Math.max(p[1], 0) / hgt, 2) });
      const sq = [rand(), rand(), rand()];
      if (!lod) for (let q = 0; q < 2; q++) {
        const p0 = pts[1 + q], a2 = az + (q ? 0.8 : -0.8) + sq[q] * 0.3, l2 = l * 0.45;
        addTube(b, [p0, [p0[0] + Math.cos(a2) * l2 * 0.4, p0[1] + l2 * 0.35, p0[2] + Math.sin(a2) * l2 * 0.4], [p0[0] + Math.cos(a2) * l2 * 0.8, p0[1] + l2 * 0.6, p0[2] + Math.sin(a2) * l2 * 0.8]], [0.01, 0.007, 0.004], 3, { col: () => [sh, sh, sh], surf: 1, wind: (p) => P.sway * Math.pow(Math.max(p[1], 0) / hgt, 2) });
        if (sq[2] < 0.7) { const tp = [p0[0] + Math.cos(a2) * l2 * 0.8, p0[1] + l2 * 0.6, p0[2] + Math.sin(a2) * l2 * 0.8], sd = [-Math.sin(a2), 0, Math.cos(a2)]; addLoft(b, leafRows(tp, [Math.cos(a2) * 0.6, 0.6, Math.sin(a2) * 0.6], sd, 0.12, 0.05, 0.2, [0.3, 1, 0.8, 0]), { face: [0, 1, 0], uw: 0.05, u0: rand() * 4, v0: rand() * 4, col: shade, wind: () => P.sway }); }
      }
    }
  } else if (P.type === 'kelp') {                             // 해초: 물결치는 긴 띠
    const nb = RI(rand, P.blades), nr = lod ? 4 : 7;
    for (let k = 0; k < nb; k++) {
      const a = rand() * TAU, d = Math.sqrt(rand()) * 0.25, bx = Math.cos(a) * d, bz = Math.sin(a) * d, H = R(rand, P.height), wd = R(rand, P.width), ph0 = rand() * TAU, az = rand() * TAU, u0 = rand() * 4, v0 = rand() * 4;
      const sd = [-Math.sin(az), 0, Math.cos(az)], rr = [];
      for (let i = 0; i < nr; i++) {
        const t = i / (nr - 1), cx = bx + Math.cos(az) * Math.sin(t * 3 + ph0) * 0.12 * t * H, cz = bz + Math.sin(az) * Math.sin(t * 3 + ph0) * 0.12 * t * H, cy = H * t - 0.05, hw = 0.5 * wd * Math.sin(Math.PI * (0.1 + 0.9 * t));
        rr.push({ l: [cx - sd[0] * hw, cy, cz - sd[2] * hw], r: [cx + sd[0] * hw, cy, cz + sd[2] * hw] });
      }
      addLoft(b, rr, { face: [Math.cos(az), 0, Math.sin(az)], uw: wd, u0, v0, col: (t) => { const s2 = 0.45 + 0.55 * t; return [s2, s2, s2]; }, wind: (p, t) => P.sway * t * t * H });
    }
  } else if (P.type === 'bush') {
    const R0 = R(rand, P.radius), nb = RI(rand, P.blobs), sub2 = lod >= 2 ? 0 : lod ? 1 : 2;
    const bl = [];
    for (let k = 0; k < nb; k++) { const a = rand() * TAU, d = k ? R0 * R(rand, [0.4, 0.9]) : 0, rr = R0 * R(rand, [0.45, 0.7]); bl.push([Math.cos(a) * d, rr * 0.68, Math.sin(a) * d, rr, rand() * 5, rand() * 5, 0.85 + rand() * 0.3]); }
    bl.forEach((q, k) => { if (lod && k > (lod >= 2 ? 1 : 3)) return; addBlob(b, [q[0], q[1], q[2]], [q[3], q[3] * 0.8, q[3]], { sub: k > 1 ? Math.min(sub2, 1) : sub2, noise: 0.25, freq: 1.8, seed: k + 5, surf: 0, u0: q[4], v0: q[5], col: (ny) => { const c = (0.5 + 0.5 * (ny * 0.5 + 0.5)) * q[6]; return [c, c, c]; }, wind: (p) => P.sway * Math.pow(p[1] / (R0 * 1.4), 2) }); });
    const nt = RI(rand, [3, 6]);
    for (let k = 0; k < nt; k++) { const a = rand() * TAU, l = R0 * R(rand, [0.9, 1.4]); if (!lod) addTube(b, [[0, 0, 0], [Math.cos(a) * l * 0.4, l * 0.5, Math.sin(a) * l * 0.4], [Math.cos(a) * l * 0.8, l * 0.7, Math.sin(a) * l * 0.8]], [0.03, 0.02, 0.012], 3, { col: () => [0.7, 0.7, 0.7], surf: 1 }); }
    const nbry = P.berries ? RI(rand, P.berries) : 0;
    for (let k = 0; k < nbry; k++) { const q = bl[Math.floor(rand() * bl.length)], a = rand() * TAU, e = R(rand, [0.2, 1.0]); if (!lod) addBlob(b, [q[0] + Math.cos(a) * Math.cos(e) * q[3] * 1.0, q[1] + Math.sin(e) * q[3] * 0.8, q[2] + Math.sin(a) * Math.cos(e) * q[3] * 1.0], [0.045, 0.045, 0.045], { sub: 0, surf: 0, mask: 1, col: () => 0.9 }); }
  }
  b.meta = { coll: 0, kind: 'plant' };
  return b;
}

// ====================== 베이스 8: 덩굴 ======================
// hanging(위에서 늘어짐) / climbing(줄기를 감고 오름) / creeper(바닥을 기어감). 줄기(층1)+잎(층0)
function buildVine(P, rand, lod) {
  const b = new Buf(), len = R(rand, P.length), n = lod ? 6 : 10, wob = R(rand, P.wobble || [1, 1]), turns = R(rand, P.turns || [1, 1]), hug = R(rand, P.hug || [0.4, 0.4]), ph = rand() * TAU;
  const strand = (L, scale, depth) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let p;
      if (P.type === 'hanging') p = [Math.sin(t * 5 + ph) * wob * t * L * 0.12, -L * t, Math.cos(t * 4 + ph) * wob * t * L * 0.1];
      else if (P.type === 'climbing') { const a = t * turns * TAU + ph; p = [Math.cos(a) * hug, L * t, Math.sin(a) * hug]; }
      else p = [L * t * Math.cos(ph + depth) + Math.sin(t * 6 + ph) * wob * 0.15, 0.03 + 0.02 * Math.sin(t * 9), L * t * Math.sin(ph + depth) + Math.cos(t * 5 + ph) * wob * 0.15];
      pts.push(p);
    }
    addTube(b, pts, pts.map((_, i) => 0.026 * scale * (P.thick || 1) * (1 - 0.5 * i / n)), 3, { col: () => [0.8, 0.8, 0.8], wind: (p) => P.sway * (P.type === 'hanging' ? Math.pow(Math.abs(p[1]) / L, 1.5) : 0.2), surf: 1 });
    const step = lod ? 2 : 1;
    for (let i = 1; i <= n; i += 1) {
      const az = i * 2.4 + rand() * 0.6, ln = R(rand, P.leafLen) * scale, wd = ln * 0.75, el = P.type === 'creeper' ? R(rand, [0.05, 0.3]) : R(rand, [-0.5, 0.2]);
      const d = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)], sd = [-Math.sin(az), 0, Math.cos(az)];
      const u0 = rand() * 4, v0 = rand() * 4;
      if (i % step) continue;
      if (P.leafEvery && i % P.leafEvery) continue;
      addLoft(b, leafRows(pts[i], d, sd, ln, wd, 0.2, [0.3, 1, 0.75, 0]), { face: [0, 1, 0], uw: wd, u0, v0, col: (u) => { const s = 0.55 + 0.45 * u; return [s, s, s]; }, wind: (p) => P.sway * (P.type === 'hanging' ? Math.pow(Math.abs(p[1]) / L, 1.5) : 0.3) });
    }
  };
  if (P.type === 'roots') {                                  // 땅 위로 드러난 뿌리: 중심에서 아치를 그리며 뻗어 다시 땅속으로
    const nr = RI(rand, P.count), rt = R(rand, P.rootR), np = lod ? 4 : 6;
    const root = (az, L, h, r0, sg) => {
      const dv = [Math.cos(az), 0, Math.sin(az)], pts = [], radii = [];
      for (let i = 0; i < np; i++) { const t = i / (np - 1); pts.push([dv[0] * L * t, -0.05 + h * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.9)), 0.8) * (1 - t * 0.3) - t * t * 0.15, dv[2] * L * t]); radii.push(r0 * (1 - 0.8 * t) + 0.02); }
      addTube(b, pts, radii, sg, { col: (t) => { const c = 0.6 + 0.4 * t; return [c, c, c]; }, surf: 1 });
      return pts;
    };
    for (let k = 0; k < nr; k++) {
      const az = (k / nr) * TAU + rand() * 0.7, L = len * R(rand, [0.6, 1.1]), h = L * R(rand, [0.14, 0.26]), r0 = rt * R(rand, [0.7, 1.1]), sb = [rand(), rand()];
      const pts = root(az, L, h, r0, lod ? 3 : 4);
      if (!lod) { const q = pts[3], a2 = az + (sb[0] < 0.5 ? 0.7 : -0.7); const dv = [Math.cos(a2), 0, Math.sin(a2)]; addTube(b, [q, [q[0] + dv[0] * L * 0.2, q[1] + 0.03, q[2] + dv[2] * L * 0.2], [q[0] + dv[0] * L * 0.4, q[1] - 0.1, q[2] + dv[2] * L * 0.4]], [r0 * 0.35, r0 * 0.25, 0.02], 3, { col: () => [0.8, 0.8, 0.8], surf: 1 }); }
    }
    b.meta = { coll: 0, kind: 'vine' };
    return b;
  }
  strand(len, 1, 0);
  const nbr = P.branches ? RI(rand, P.branches) : 0;
  for (let k = 0; k < nbr; k++) strand(len * R(rand, [0.4, 0.6]), 0.7, (k % 2 ? 1 : -1) * R(rand, [0.5, 1.1]));
  b.meta = { coll: 0, kind: 'vine', hang: P.type === 'hanging' };
  return b;
}

const BASES = { tree: buildTree, rock: buildRock, grass: buildGrass, flower: buildFlower, mushroom: buildMushroom, stump: buildStump, plant: buildPlant, vine: buildVine };

// ====================== 재질 묶음 ======================
// A/B 두 층 텍스처(정점의 nat.z로 선택). tile = 미터당 텍스처 반복 수(가로,세로), tint = 층 색 보정(밝기 보정 포함).
// acc: 강조색(꽃잎/버섯갓/이끼/눈) 밝기 게인 (기본 2.4)
// rough: 0.8 이상이면 Lambert, 미만이면 Phong(반짝임). wind: 재질 전체 바람 배율. double: 양면 렌더링.
export const FAMILIES = {
  tree_oak: { A: { tex: 'dirt', tile: [0.45, 0.22], tint: [2.61, 2.5, 2.54] }, B: { tex: 'grass', tile: [0.5, 0.5], tint: [2.14, 2.44, 7.28] }, rough: 0.95, wind: 1.0, double: false, fx: { bump: 0.9, mottle: 0.35, hue: 0.22, scale: 1.6, low: [0.6, 0.75, 0.5, 1.2, 0.5], top: [1.05, 1.15, 0.85, 0.15] } },
  tree_birch: { A: { tex: 'snow', tile: [0.6, 0.3], tint: [1.09, 1.03, 0.85] }, B: { tex: 'grass_gold', tile: [0.5, 0.5], tint: [1.7, 2.08, 3.53] }, rough: 0.9,  wind: 1.1, double: false, fx: { bump: 1.0, mottle: 0.4, hue: 0.3, scale: 1.8, low: [0.7, 0.75, 0.6, 1, 0.4], top: [1.04, 1.06, 0.92, 0.12] } },
  tree_pine: { A: { tex: 'dirt', tile: [0.45, 0.22], tint: [2.12, 1.99, 2.04] }, B: { tex: 'grass_dark', tile: [0.7, 0.7], tint: [3.62, 3.86, 3.71] }, acc: 2.8, rough: 0.95, wind: 0.9, double: false, fx: { bump: 0.9, mottle: 0.35, hue: 0.15, scale: 1.6, low: [0.65, 0.75, 0.55, 1, 0.4], top: [0.9, 0.97, 1.05, 0.2] } },
  tree_jungle: { A: { tex: 'dirt', tile: [0.4, 0.2], tint: [2.11, 2.12, 2.25] }, B: { tex: 'grass_dark', tile: [0.5, 0.5], tint: [3.1, 3.77, 3.58] }, rough: 0.95, wind: 1.0, double: false, fx: { bump: 1.1, mottle: 0.45, hue: 0.25, scale: 1.4, low: [0.55, 0.8, 0.45, 3, 0.65], top: [0.9, 1.1, 0.7, 0.25] } },
  tree_dead: { A: { tex: 'village_dirt', tile: [0.45, 0.22], tint: [1.71, 1.61, 1.52] }, B: { tex: 'village_dirt', tile: [0.45, 0.22], tint: [1.71, 1.61, 1.52] }, rough: 0.98, wind: 0.8, double: false, fx: { bump: 1.3, mottle: 0.35, hue: 0.1, scale: 1.8, low: [0.75, 0.72, 0.65, 0.8, 0.3], top: [1.1, 1.08, 1, 0.2] } },
  rock_gray: { A: { tex: 'rock', tile: [0.35, 0.35], tint: [7, 7, 7.2] }, B: { tex: 'rock', tile: [0.35, 0.35], tint: [7, 7, 7.2] }, acc: 2.4, rough: 0.9, wind: 0, double: false, fx: { bump: 1.6, mottle: 0.45, hue: 0.12, scale: 1.5, low: [0.7, 0.78, 0.65, 0.7, 0.45], top: [1.08, 1.07, 1, 0.15] } },
  rock_cold: { A: { tex: 'snow_rock', tile: [0.3, 0.3], tint: [2.2, 2.3, 2.5] }, B: { tex: 'snow_rock', tile: [0.3, 0.3], tint: [2.2, 2.3, 2.5] }, acc: 2.6, rough: 0.6, wind: 0, double: false, fx: { bump: 1.4, mottle: 0.35, hue: 0.1, scale: 1.5, spec: 0.6, top: [0.92, 0.96, 1, 0.35] } },
  rock_lava: { A: { tex: 'lava_rock', tile: [0.3, 0.3], tint: [5.02, 10.75, 12] }, B: { tex: 'lava_rock', tile: [0.3, 0.3], tint: [5.02, 10.75, 12] }, rough: 0.85, wind: 0, double: false, fx: { bump: 1.8, mottle: 0.35, hue: 0.05, scale: 1.6, top: [1.7, 1.65, 1.6, 0.4] } },
  rock_sand: { A: { tex: 'desert_sand', tile: [0.3, 0.3], tint: [1.19, 0.93, 0.79] }, B: { tex: 'desert_sand', tile: [0.3, 0.3], tint: [1.19, 0.93, 0.79] }, rough: 0.95, wind: 0, double: false, fx: { bump: 1.5, mottle: 0.4, hue: 0.2, scale: 1.4, band: [0.2, 2.4], low: [0.8, 0.72, 0.62, 0.6, 0.35], top: [1.06, 1.02, 0.95, 0.2] } },
  grass_green: { A: { tex: 'grass', tile: [0.6, 0.6], tint: [2.2, 2.51, 6.86] }, B: { tex: 'grass', tile: [0.6, 0.6], tint: [2.2, 2.51, 6.86] }, rough: 0.9, wind: 1.0, double: true, fx: { bump: 0.3, mottle: 0.5, hue: 0.35, scale: 0.9, low: [0.55, 0.62, 0.4, 0.18, 0.7], top: [1.12, 1.12, 0.85, 0.2] } },
  grass_dry: { A: { tex: 'grass_gold', tile: [0.6, 0.6], tint: [1.87, 1.81, 2.48] }, B: { tex: 'grass_gold', tile: [0.6, 0.6], tint: [1.87, 1.81, 2.48] }, rough: 0.9, wind: 1.1, double: true, fx: { bump: 0.3, mottle: 0.5, hue: 0.3, scale: 0.9, low: [0.6, 0.55, 0.4, 0.3, 0.6], top: [1.1, 1.08, 0.9, 0.15] } },
  grass_jungle: { A: { tex: 'grass_dark', tile: [0.6, 0.6], tint: [3.59, 3.9, 3.46] }, B: { tex: 'grass_dark', tile: [0.6, 0.6], tint: [3.59, 3.9, 3.46] }, rough: 0.8, wind: 1.0, double: true, fx: { bump: 0.3, mottle: 0.4, hue: 0.25, scale: 0.9, low: [0.5, 0.65, 0.45, 0.3, 0.6] } },
  flower: { A: { tex: 'grass_dark', tile: [0.8, 0.8], tint: [3.81, 4.14, 3.67] }, B: { tex: 'snow', tile: [1.2, 1.2], tint: [1, 1, 1] }, acc: 3.4, rough: 0.75, wind: 1.0, double: true, fx: { bump: 0.2, mottle: 0.2, hue: 0.1, scale: 1.2, low: [0.6, 0.75, 0.5, 0.15, 0.4] } },
  mushroom: { A: { tex: 'desert_sand', tile: [1.5, 1.5], tint: [1.07, 1.07, 1.03] }, B: { tex: 'village_dirt', tile: [1.5, 1.5], tint: [2.12, 2.16, 2.31] }, acc: 2.8, rough: 0.6, wind: 0, double: false, fx: { bump: 0.8, mottle: 0.3, hue: 0.1, scale: 2.0, spec: 0.6, low: [0.8, 0.75, 0.65, 0.1, 0.35] } },
  stump: { A: { tex: 'dirt', tile: [0.5, 0.25], tint: [2.45, 2.33, 2.35] }, B: { tex: 'desert_sand', tile: [1.2, 1.2], tint: [1.13, 0.91, 0.75] }, acc: 2.4, rough: 0.95, wind: 0, double: false, fx: { bump: 1.2, mottle: 0.4, hue: 0.15, scale: 1.6, low: [0.6, 0.75, 0.5, 0.5, 0.5], top: [0.85, 1.15, 0.7, 0.2] } },
  plant: { A: { tex: 'grass_dark', tile: [0.8, 0.8], tint: [3.85, 4.15, 3.74] }, B: { tex: 'dirt', tile: [0.8, 0.8], tint: [2.25, 2.1, 2.08] }, acc: 2.8, rough: 0.85, wind: 1.0, double: true, fx: { bump: 0.3, mottle: 0.4, hue: 0.3, scale: 1.2, low: [0.6, 0.72, 0.5, 0.25, 0.45] } },
  vine: { A: { tex: 'grass_dark', tile: [0.8, 0.8], tint: [3.68, 3.99, 3.54] }, B: { tex: 'dirt', tile: [0.8, 0.8], tint: [2.07, 1.92, 1.88] }, rough: 0.85, wind: 1.0, double: true, fx: { bump: 0.4, mottle: 0.4, hue: 0.25, scale: 1.2, low: [0.6, 0.72, 0.5, 0.25, 0.45] } },
};
// 텍스처별 평균 휘도(선형). 강조색 정규화에 사용 (public/textures/*.jpg 측정값)
export const TEX_MEAN_LUM = { desert_sand: 0.57, dirt: 0.10, grass: 0.245, grass_dark: 0.085, grass_gold: 0.339, ice: 0.362, lava: 0.319, lava_rock: 0.021, rock: 0.023, snow: 0.65, snow_rock: 0.114, village_dirt: 0.232 };

// ====================== 종류별 프리셋 ======================
// style: 인스턴스 색 변화 범위 {hue(라디안), sat, val, accents(hex), accent(강조 강도)}, scale: 인스턴스 크기 배율
const GREEN_MOSS = [0x4a6b2a, 0x5a7a30, 0x3f5f28];
const FLOWER_COLORS = [0xe84a5f, 0xf6c431, 0xffffff, 0xb06ad9, 0xff8fb1, 0xff8a2a, 0x6aa8ff];
const MUSH_COLORS = [0xc0392b, 0x8b5a2b, 0xe8dcc0, 0xd9822b, 0x7a4a8a];

export const SPECIES = {
  // ----- 나무 -----
  tree_oak: { base: 'tree', fam: 'tree_oak', scale: [0.85, 1.25], style: { hue: [-0.15, 0.15], sat: [0.85, 1.15], val: [0.8, 1.15], accent: [0, 0] }, fin: { upBlend: [0, 0.45] },
    P: { height: [6.5, 9.5], trunkR: [0.28, 0.4], trunkFrac: 0.62, taper: 0.45, flare: 0.9, lean: [0, 0.18], bend: [0.4, 1.2], seg: 8, roots: [3, 5], sway: 0.3,
      br: { n: [6, 9], from: 0.38, to: 0.95, len: [0.28, 0.45], elev: [0.45, 0.9], droop: 0.12, twigs: true },
      crown: { type: 'blob', r: [0.2, 0.3], flat: [0.62, 0.85], noise: 0.22, fill: [3, 5], spread: 0.22 } } },
  tree_birch: { base: 'tree', fam: 'tree_birch', scale: [0.85, 1.2], style: { hue: [-0.2, 0.25], sat: [0.8, 1.2], val: [0.85, 1.15], accent: [0, 0] }, fin: { upBlend: [0, 0.45] },
    P: { height: [7, 10], trunkR: [0.12, 0.18], trunkFrac: 0.8, taper: 0.35, flare: 0.3, lean: [0.02, 0.22], bend: [0.8, 1.8], seg: 7, roots: [0, 2], sway: 0.4, marks: 0.75,
      br: { n: [7, 10], from: 0.35, to: 0.95, len: [0.18, 0.3], elev: [0.7, 1.2], droop: 0.06, twigs: true },
      crown: { type: 'blob', r: [0.1, 0.16], flat: [0.8, 1.1], noise: 0.3, fill: [2, 3], spread: 0.18 } } },
  tree_pine: { base: 'tree', fam: 'tree_pine', scale: [0.85, 1.3], style: { hue: [-0.1, 0.1], sat: [0.85, 1.1], val: [0.8, 1.1], accents: [0xf2f6ff], accent: [0, 1] }, fin: { upBlend: [0, 0.3], maskUp: { lo: 0.35, hi: 0.7, surf: 1 } },
    P: { height: [9, 13], trunkR: [0.25, 0.35], trunkFrac: 0.98, taper: 0.12, flare: 0.5, lean: [0, 0.08], bend: [0.2, 0.5], seg: 7, roots: [3, 4], sway: 0.25,
      br: { n: [0, 0], from: 0.4, to: 0.9, len: [0.1, 0.2], elev: [0.3, 0.6], droop: 0.1, twigs: false },
      crown: { type: 'cone', tiers: [5, 9], R: [0.14, 0.28], bare: [0.12, 0.3], ragged: 0.22, wobble: 0.06 } } },
  tree_jungle: { base: 'tree', fam: 'tree_jungle', scale: [0.85, 1.2], style: { hue: [-0.15, 0.2], sat: [0.85, 1.2], val: [0.8, 1.1], accent: [0, 0] }, fin: { upBlend: [0, 0.45] },
    P: { height: [12, 17], trunkR: [0.4, 0.6], trunkFrac: 0.82, taper: 0.55, flare: 1.6, lean: [0, 0.1], bend: [0.3, 0.8], seg: 9, roots: [5, 7], sway: 0.3,
      br: { n: [4, 6], from: 0.6, to: 1.0, len: [0.25, 0.4], elev: [0.35, 0.6], droop: 0.05, twigs: false },
      crown: { type: 'blob', r: [0.17, 0.24], flat: [0.35, 0.5], noise: 0.25, fill: [3, 4], spread: 0.3 } } },
  tree_dead: { base: 'tree', fam: 'tree_dead', scale: [0.8, 1.2], style: { hue: [-0.05, 0.05], sat: [0.8, 1.1], val: [0.75, 1.15], accent: [0, 0] }, fin: {},
    P: { height: [4.5, 7.5], trunkR: [0.2, 0.32], trunkFrac: 0.92, taper: 0.3, flare: 0.7, lean: [0.05, 0.3], bend: [0.8, 1.8], seg: 7, roots: [2, 4], sway: 0.15,
      br: { n: [8, 12], from: 0.3, to: 0.98, len: [0.25, 0.5], elev: [0.2, 0.9], droop: 0.05, twigs: true },
      crown: { type: 'none' } } },
  // ----- 바위 -----
  rock_boulder: { base: 'rock', fam: 'rock_gray', scale: [0.8, 1.3], style: { hue: [-0.08, 0.08], sat: [0.7, 1.1], val: [0.75, 1.2], accent: [0, 0] }, fin: { deindex: true, smooth: 0.3, tri: true },
    P: { radius: [0.7, 1.6], sx: [1, 1.3], sy: [0.8, 1.2], sz: [0.9, 1.25], noise: 0.22, freq: 1.3, flatten: 0.35, taper: 0, chips: [1, 3], strata: 0 } },
  rock_mossy: { base: 'rock', fam: 'rock_gray', scale: [0.8, 1.3], style: { hue: [-0.08, 0.08], sat: [0.8, 1.1], val: [0.8, 1.15], accents: GREEN_MOSS, accent: [0.5, 1] }, fin: { deindex: true, smooth: 0.45, tri: true, maskUp: { lo: 0.45, hi: 0.85 } },
    P: { radius: [0.8, 1.9], sx: [1, 1.2], sy: [0.7, 1.0], sz: [1, 1.3], noise: 0.18, freq: 1.1, flatten: 0.3, taper: 0, chips: [0, 2], strata: 0 } },
  rock_slab: { base: 'rock', fam: 'rock_gray', scale: [0.8, 1.3], style: { hue: [-0.06, 0.06], sat: [0.7, 1.1], val: [0.8, 1.2], accent: [0, 0] }, fin: { deindex: true, smooth: 0.1, tri: true },
    P: { radius: [1.0, 2.2], sx: [1.2, 1.8], sy: [0.4, 0.65], sz: [0.9, 1.3], noise: 0.16, freq: 1.6, flatten: 0.5, taper: 0, chips: [0, 2], strata: 0.6 } },
  rock_spire: { base: 'rock', fam: 'rock_gray', scale: [0.8, 1.4], style: { hue: [-0.06, 0.06], sat: [0.7, 1.1], val: [0.8, 1.2], accent: [0, 0] }, fin: { deindex: true, smooth: 0.05, tri: true },
    P: { radius: [0.5, 0.9], sx: [0.6, 1.1], sy: [1.8, 3.0], sz: [0.6, 1.1], noise: 0.32, freq: 1.6, flatten: 0.2, taper: 0.45, chips: [1, 2], strata: 0.35, shear: 0.35 } },
  rock_cluster: { base: 'rock', fam: 'rock_gray', scale: [0.8, 1.3], style: { hue: [-0.08, 0.08], sat: [0.7, 1.1], val: [0.75, 1.2], accent: [0, 0] }, fin: { deindex: true, smooth: 0.3, tri: true },
    P: { radius: [0.5, 0.9], sx: [1, 1.3], sy: [0.7, 1.0], sz: [1, 1.3], noise: 0.25, freq: 1.4, flatten: 0.3, taper: 0, chips: [1, 2], group: [2, 4], strata: 0 } },
  rock_snow: { base: 'rock', fam: 'rock_cold', scale: [0.8, 1.4], style: { hue: [-0.06, 0.06], sat: [0.8, 1.2], val: [0.8, 1.2], accents: [0xf2f6ff], accent: [0, 1] }, fin: { deindex: true, smooth: 0.05, tri: true, maskUp: { lo: 0.4, hi: 0.75 } },
    P: { radius: [0.8, 1.8], sx: [0.8, 1.1], sy: [1.1, 1.7], sz: [0.8, 1.1], noise: 0.3, freq: 1.7, flatten: 0.25, taper: 0.35, chips: [1, 3], strata: 0.2 } },
  rock_lava: { base: 'rock', fam: 'rock_lava', scale: [0.8, 1.4], style: { hue: [-0.05, 0.1], sat: [0.8, 1.3], val: [0.8, 1.2], accent: [0, 0] }, fin: { deindex: true, smooth: 0, tri: true },
    P: { radius: [0.7, 1.6], sx: [0.9, 1.3], sy: [0.7, 1.2], sz: [0.9, 1.3], noise: 0.38, freq: 2.2, flatten: 0.3, taper: 0.15, chips: [1, 3], strata: 0 } },
  rock_sandstone: { base: 'rock', fam: 'rock_sand', scale: [0.8, 1.4], style: { hue: [-0.1, 0.1], sat: [0.8, 1.2], val: [0.8, 1.15], accent: [0, 0] }, fin: { deindex: true, smooth: 0.05, tri: true },
    P: { radius: [1.0, 2.0], sx: [0.9, 1.3], sy: [0.8, 1.5], sz: [0.9, 1.3], noise: 0.2, freq: 1.5, flatten: 0.4, taper: 0.2, chips: [0, 2], strata: 1.0 } },
  // ----- 잔디/풀 -----
  grass_short: { base: 'grass', fam: 'grass_green', scale: [0.8, 1.3], style: { hue: [-0.15, 0.15], sat: [0.85, 1.15], val: [0.8, 1.2], accent: [0, 0] }, fin: { upBlend: [0.55, 0.55] },
    P: { blades: [12, 16], height: [0.25, 0.42], width: 0.05, spread: 0.18, curl: 0.35, lean: 0.1, taper: 1.3, rows: 3, outward: 0.5, edge: 0.25, sway: 0.1 } },
  grass_tall: { base: 'grass', fam: 'grass_green', scale: [0.8, 1.3], style: { hue: [-0.15, 0.15], sat: [0.85, 1.15], val: [0.8, 1.2], accent: [0, 0] }, fin: { upBlend: [0.55, 0.55] },
    P: { blades: [9, 13], height: [0.6, 1.0], width: 0.06, spread: 0.2, curl: 0.55, lean: 0.12, taper: 1.2, rows: 4, outward: 0.45, edge: 0.3, sway: 0.28 } },
  grass_dry: { base: 'grass', fam: 'grass_dry', scale: [0.8, 1.3], style: { hue: [-0.12, 0.12], sat: [0.8, 1.2], val: [0.8, 1.2], accent: [0, 0] }, fin: { upBlend: [0.55, 0.55] },
    P: { blades: [12, 18], height: [0.5, 0.95], width: 0.07, spread: 0.22, curl: 0.7, lean: 0.2, taper: 1.0, rows: 4, outward: 0.7, edge: 0.2, sway: 0.25 } },
  grass_broad: { base: 'grass', fam: 'grass_jungle', scale: [0.8, 1.3], style: { hue: [-0.15, 0.2], sat: [0.85, 1.2], val: [0.8, 1.15], accent: [0, 0] }, fin: { upBlend: [0.55, 0.55] },
    P: { blades: [5, 8], height: [0.55, 0.9], width: 0.15, spread: 0.12, curl: 0.45, lean: 0.15, taper: 1.6, rows: 4, outward: 0.8, edge: 0.15, sway: 0.2 } },
  // ----- 꽃 -----
  flower_daisy: { base: 'flower', fam: 'flower', scale: [0.8, 1.3], style: { hue: [-0.1, 0.1], sat: [0.9, 1.1], val: [0.9, 1.1], accents: FLOWER_COLORS, accent: [1, 1] }, fin: {},
    P: { heads: [1, 1], height: [0.3, 0.5], lean: [0, 0.25], bend: [0.2, 0.6], leaves: [2, 3], petals: [10, 14], petalW: [0.032, 0.042], petalL: [0.07, 0.1], open: [1.25, 1.5], curl: 0.05, flare: 0, centerR: 0.03, sway: 0.1 } },
  flower_tulip: { base: 'flower', fam: 'flower', scale: [0.8, 1.3], style: { hue: [-0.1, 0.1], sat: [0.9, 1.1], val: [0.9, 1.1], accents: FLOWER_COLORS, accent: [1, 1] }, fin: {},
    P: { heads: [1, 1], height: [0.35, 0.55], lean: [0, 0.15], bend: [0.1, 0.4], leaves: [2, 3], petals: [6, 6], petalW: [0.06, 0.08], petalL: [0.1, 0.14], open: [0.28, 0.4], curl: 0.0, flare: 0.1, centerR: 0.0, sway: 0.1 } },
  flower_bell: { base: 'flower', fam: 'flower', scale: [0.8, 1.3], style: { hue: [-0.1, 0.1], sat: [0.9, 1.1], val: [0.9, 1.1], accents: FLOWER_COLORS, accent: [1, 1] }, fin: {},
    P: { heads: [1, 1], height: [0.3, 0.5], lean: [0.1, 0.3], bend: [2.2, 2.7], leaves: [2, 3], petals: [5, 5], petalW: [0.06, 0.075], petalL: [0.08, 0.1], open: [0.4, 0.55], curl: 0, flare: 0.28, centerR: 0.0, sway: 0.12 } },
  flower_cluster: { base: 'flower', fam: 'flower', scale: [0.8, 1.3], style: { hue: [-0.1, 0.1], sat: [0.9, 1.1], val: [0.9, 1.1], accents: FLOWER_COLORS, accent: [1, 1] }, fin: {},
    P: { heads: [3, 5], height: [0.25, 0.45], lean: [0.1, 0.35], bend: [0.2, 0.6], leaves: [1, 2], petals: [5, 7], petalW: [0.026, 0.036], petalL: [0.055, 0.075], open: [1.1, 1.4], curl: 0.05, flare: 0, centerR: 0.024, sway: 0.1 } },
  // ----- 버섯 -----
  mushroom_button: { base: 'mushroom', fam: 'mushroom', scale: [0.8, 1.4], style: { hue: [-0.05, 0.05], sat: [0.9, 1.1], val: [0.9, 1.1], accents: MUSH_COLORS, accent: [1, 1] }, fin: { upBlend: [0, 0] },
    P: { shape: 'dome', count: [1, 2], capR: [0.09, 0.14], capH: [0.08, 0.12], stemH: [0.08, 0.14], stemR: [0.03, 0.04], stemTop: 0.9, tilt: [0, 0.25], spots: 0 } },
  mushroom_toadstool: { base: 'mushroom', fam: 'mushroom', scale: [0.8, 1.4], style: { hue: [-0.05, 0.05], sat: [0.9, 1.1], val: [0.9, 1.1], accents: [0xc0392b, 0xd9822b, 0xe84a5f], accent: [1, 1] }, fin: {},
    P: { shape: 'flat', count: [1, 3], capR: [0.14, 0.22], capH: [0.09, 0.14], stemH: [0.15, 0.25], stemR: [0.025, 0.04], stemTop: 0.85, tilt: [0, 0.3], spots: [4, 8] } },
  mushroom_conical: { base: 'mushroom', fam: 'mushroom', scale: [0.8, 1.4], style: { hue: [-0.05, 0.05], sat: [0.9, 1.1], val: [0.9, 1.1], accents: MUSH_COLORS, accent: [1, 1] }, fin: {},
    P: { shape: 'cone', count: [1, 3], capR: [0.06, 0.1], capH: [0.14, 0.22], stemH: [0.2, 0.36], stemR: [0.014, 0.022], stemTop: 0.8, tilt: [0, 0.35], spots: 0 } },
  mushroom_cluster: { base: 'mushroom', fam: 'mushroom', scale: [0.8, 1.4], style: { hue: [-0.05, 0.05], sat: [0.9, 1.1], val: [0.9, 1.1], accents: MUSH_COLORS, accent: [1, 1] }, fin: {},
    P: { shape: 'bell', count: [4, 6], capR: [0.07, 0.1], capH: [0.05, 0.08], stemH: [0.1, 0.18], stemR: [0.014, 0.022], stemTop: 0.8, tilt: [0.05, 0.4], spots: 0 } },
  // ----- 그루터기 / 통나무 -----
  stump_cut: { base: 'stump', fam: 'stump', scale: [0.8, 1.4], style: { hue: [-0.06, 0.06], sat: [0.85, 1.1], val: [0.8, 1.15], accents: GREEN_MOSS, accent: [0, 0.6] }, fin: { maskUp: { lo: 0.5, hi: 0.9, surf: 0 } },
    P: { radius: [0.35, 0.6], height: [0.4, 0.8], flare: 0.45, roots: [3, 5], top: 'flat', jag: 0, stubs: [0, 1] } },
  stump_broken: { base: 'stump', fam: 'stump', scale: [0.8, 1.4], style: { hue: [-0.06, 0.06], sat: [0.85, 1.1], val: [0.75, 1.1], accents: GREEN_MOSS, accent: [0, 0.6] }, fin: { maskUp: { lo: 0.5, hi: 0.9, surf: 0 } },
    P: { radius: [0.35, 0.65], height: [0.8, 1.5], flare: 0.4, roots: [3, 5], top: 'broken', jag: 0.35, stubs: [0, 2] } },
  stump_hollow: { base: 'stump', fam: 'stump', scale: [0.8, 1.4], style: { hue: [-0.06, 0.06], sat: [0.85, 1.1], val: [0.8, 1.1], accents: GREEN_MOSS, accent: [0, 0.6] }, fin: { maskUp: { lo: 0.5, hi: 0.9, surf: 0 } },
    P: { radius: [0.5, 0.8], height: [0.7, 1.2], flare: 0.55, roots: [4, 6], top: 'hollow', jag: 0, stubs: [0, 1] } },
  log_fallen: { base: 'stump', fam: 'stump', scale: [0.8, 1.3], style: { hue: [-0.06, 0.06], sat: [0.85, 1.1], val: [0.75, 1.1], accents: GREEN_MOSS, accent: [0, 0.9] }, fin: { maskUp: { lo: 0.45, hi: 0.85, surf: 0 } },
    P: { radius: [0.22, 0.38], length: [1.8, 3.2], height: [1, 1], flare: 0.15, roots: [0, 2], top: 'flat', jag: 0, stubs: [1, 3], log: true } },
  // ----- 작은 식물 -----
  plant_fern: { base: 'plant', fam: 'plant', scale: [0.8, 1.3], style: { hue: [-0.15, 0.2], sat: [0.85, 1.2], val: [0.8, 1.15], accent: [0, 0] }, fin: { upBlend: [0.4, 0.4] },
    P: { type: 'fern', fronds: [7, 11], len: [0.7, 1.2], sway: 0.18 } },
  plant_bush: { base: 'plant', fam: 'plant', scale: [0.8, 1.3], style: { hue: [-0.15, 0.2], sat: [0.85, 1.2], val: [0.8, 1.15], accents: [0xc0392b, 0x5a3a8a, 0xe8b830], accent: [0, 1] }, fin: { upBlend: [0.4, 0.4] },
    P: { type: 'bush', radius: [0.35, 0.6], blobs: [4, 6], berries: [6, 10], sway: 0.15 } },
  plant_rosette: { base: 'plant', fam: 'plant', scale: [0.8, 1.4], style: { hue: [-0.15, 0.2], sat: [0.85, 1.2], val: [0.8, 1.15], accent: [0, 0] }, fin: { upBlend: [0.4, 0.4] },
    P: { type: 'rosette', leaves: [8, 12], len: [0.22, 0.38], sway: 0.08 } },
  plant_sapling: { base: 'plant', fam: 'plant', scale: [0.8, 1.4], style: { hue: [-0.15, 0.2], sat: [0.85, 1.2], val: [0.8, 1.15], accent: [0, 0] }, fin: { upBlend: [0.4, 0.4] },
    P: { type: 'sapling', height: [0.7, 1.3], leaves: [8, 12], sway: 0.2 } },
  // ----- 덩굴 -----
  vine_hanging: { base: 'vine', fam: 'vine', scale: [0.8, 1.3], style: { hue: [-0.15, 0.2], sat: [0.85, 1.2], val: [0.8, 1.15], accent: [0, 0] }, fin: { upBlend: [0.3, 0.3] },
    P: { type: 'hanging', length: [2.5, 5], wobble: [0.5, 1.8], leafLen: [0.3, 0.5], branches: [0, 1], sway: 0.35 } },
  vine_climbing: { base: 'vine', fam: 'vine', scale: [0.8, 1.3], style: { hue: [-0.15, 0.2], sat: [0.85, 1.2], val: [0.8, 1.15], accent: [0, 0] }, fin: { upBlend: [0.3, 0.3] },
    P: { type: 'climbing', length: [2.5, 5], turns: [1.4, 3.2], hug: [0.3, 0.55], wobble: [1, 1], leafLen: [0.3, 0.5], branches: [0, 0], sway: 0.05 } },
  vine_creeper: { base: 'vine', fam: 'vine', scale: [0.8, 1.3], style: { hue: [-0.15, 0.2], sat: [0.85, 1.2], val: [0.8, 1.15], accent: [0, 0] }, fin: { upBlend: [0.3, 0.3] },
    P: { type: 'creeper', length: [1.2, 2.4], wobble: [0.6, 1.8], leafLen: [0.16, 0.26], branches: [1, 3], sway: 0.06 } },
};

// ====================== 지형별 확장 ======================
// 아래 종류는 전부 위의 베이스(tree/rock/grass/flower/mushroom/stump/plant/vine)의 파라미터 변형입니다.
Object.assign(FAMILIES, {
  tree_palm: { A: { tex: 'dirt', tile: [0.5, 0.25], tint: [2.29, 2.16, 2.08] }, B: { tex: 'grass', tile: [0.5, 0.5], tint: [2.3, 2.59, 7.11] }, rough: 0.9, wind: 1.2, double: true, fx: { bump: 0.8, mottle: 0.4, hue: 0.25, scale: 1.5 } },
  tree_burnt: { A: { tex: 'dirt', tile: [0.45, 0.22], tint: [0.83, 1.08, 1.67] }, B: { tex: 'grass_gold', tile: [0.5, 0.5], tint: [0.51, 0.49, 1.56] }, acc: 3.2, rough: 0.98, wind: 0.8, double: false, fx: { bump: 1.6, mottle: 0.5, hue: 0.05, scale: 1.8, top: [1.9, 1.85, 1.8, 0.35] } },
  tree_snowbare: { A: { tex: 'dirt', tile: [0.45, 0.22], tint: [1.48, 1.56, 1.88] }, B: { tex: 'dirt', tile: [0.45, 0.22], tint: [1.48, 1.56, 1.88] }, acc: 2.8, rough: 0.95, wind: 0.9, double: false, fx: { bump: 1.4, mottle: 0.35, hue: 0.08, scale: 1.8, top: [2, 2.05, 2.2, 0.55] } },
  cactus: { A: { tex: 'grass_dark', tile: [1.0, 1.0], tint: [3.56, 3.62, 5.63] }, B: { tex: 'grass_dark', tile: [1.0, 1.0], tint: [3.56, 3.62, 5.63] }, acc: 2.6, rough: 0.75, wind: 0.15, double: false, fx: { bump: 1.0, mottle: 0.3, hue: 0.12, scale: 1.4, spec: 0.5, low: [0.8, 0.82, 0.65, 0.3, 0.35], top: [1.15, 1.12, 1, 0.25] } },
  rock_ice: { A: { tex: 'ice', tile: [0.4, 0.4], tint: [1.73, 1.64, 1.69] }, B: { tex: 'ice', tile: [0.4, 0.4], tint: [1.73, 1.64, 1.69] }, rough: 0.4, wind: 0, double: false, fx: { bump: 0.6, mottle: 0.25, hue: 0.15, scale: 1.2, spec: 1.0 } },
  rock_basalt: { A: { tex: 'lava_rock', tile: [0.3, 0.3], tint: [2.25, 5.14, 6.59] }, B: { tex: 'lava_rock', tile: [0.3, 0.3], tint: [2.25, 5.14, 6.59] }, rough: 0.85, wind: 0, double: false, fx: { bump: 1.8, mottle: 0.35, hue: 0.05, scale: 1.6, top: [1.7, 1.65, 1.6, 0.25] } },
  rock_wet: { A: { tex: 'rock', tile: [0.35, 0.35], tint: [6, 6, 6.4] }, B: { tex: 'rock', tile: [0.35, 0.35], tint: [6, 6, 6.4] }, rough: 0.5, wind: 0, double: false, fx: { bump: 1.3, mottle: 0.4, hue: 0.1, scale: 1.5, spec: 0.5, low: [0.62, 0.72, 0.55, 0.6, 0.4] } },
  ash: { A: { tex: 'village_dirt', tile: [0.4, 0.4], tint: [1.17, 1.26, 1.44] }, B: { tex: 'village_dirt', tile: [0.4, 0.4], tint: [1.17, 1.26, 1.44] }, rough: 1, wind: 0, double: false, fx: { bump: 1.0, mottle: 0.5, hue: 0.05, scale: 1.2 } },
  dry_plant: { A: { tex: 'grass_gold', tile: [0.8, 0.8], tint: [1.66, 1.55, 2.5] }, B: { tex: 'dirt', tile: [0.8, 0.8], tint: [2.25, 2.1, 2.08] }, rough: 0.9, wind: 1.1, double: true, fx: { bump: 0.3, mottle: 0.4, hue: 0.25, scale: 1.1, low: [0.65, 0.6, 0.45, 0.25, 0.4] } },
  coral: { A: { tex: 'desert_sand', tile: [1.2, 1.2], tint: [1.27, 1.02, 0.94] }, B: { tex: 'desert_sand', tile: [1.2, 1.2], tint: [1.27, 1.02, 0.94] }, rough: 0.6, wind: 0.3, double: false, fx: { bump: 1.2, mottle: 0.4, hue: 0.25, scale: 1.6 } },
  kelp: { A: { tex: 'grass_dark', tile: [0.8, 0.8], tint: [3.1, 3.6, 3.37] }, B: { tex: 'grass_dark', tile: [0.8, 0.8], tint: [3.1, 3.6, 3.37] }, rough: 0.8, wind: 1.6, double: true, fx: { bump: 0.3, mottle: 0.3, hue: 0.2, scale: 1.0, low: [0.6, 0.72, 0.5, 0.3, 0.4] } },
  driftwood: { A: { tex: 'village_dirt', tile: [0.5, 0.25], tint: [1.9, 1.9, 2.09] }, B: { tex: 'village_dirt', tile: [0.5, 0.25], tint: [1.9, 1.9, 2.09] }, rough: 1, wind: 0, double: false, fx: { bump: 1.4, mottle: 0.4, hue: 0.1, scale: 1.8, low: [0.65, 0.62, 0.58, 0.5, 0.4] } },
});
const G = SPECIES;                                       // 기존 프리셋을 복사해서 변형 (처음부터 새로 만들지 않음)
const WHITE = [0xf4f8ff, 0xe8eff8], EMBER = [0xff5a1a, 0xff7a2a], ASH = [0x6e6a66, 0x5a5753];
Object.assign(SPECIES, {
  // ===== 정글 =====
  tree_jungle_giant: { ...G.tree_jungle, scale: [0.9, 1.15],                       // 대표 거대 나무: 일반 정글 나무(12~17)보다 2배 이상
    P: { ...G.tree_jungle.P, height: [30, 38], trunkR: [1.3, 1.8], trunkFrac: 0.78, taper: 0.5, flare: 2.6, seg: 12, roots: [9, 12], rootLen: 1.8, sway: 0.35,
      br: { n: [6, 8], from: 0.55, to: 1.0, len: [0.28, 0.4], elev: [0.3, 0.55], droop: 0.05, twigs: false },
      crown: { type: 'blob', r: [0.14, 0.2], flat: [0.35, 0.5], noise: 0.25, fill: [4, 6], spread: 0.3 } } },
  tree_jungle_slender: { ...G.tree_jungle, scale: [0.9, 1.2],
    P: { ...G.tree_jungle.P, height: [12, 22], trunkR: [0.18, 0.26], trunkFrac: 0.9, taper: 0.35, flare: 0.5, lean: [0, 0.25], bend: [0.5, 1.6], roots: [2, 3], seg: 7,
      br: { n: [3, 5], from: 0.75, to: 1.0, len: [0.12, 0.2], elev: [0.5, 0.8], droop: 0.05, twigs: false },
      crown: { type: 'blob', r: [0.08, 0.16], flat: [0.5, 0.9], noise: 0.3, fill: [1, 4], spread: 0.15 } } },
  tree_palm: { base: 'tree', fam: 'tree_palm', scale: [0.85, 1.25], style: { hue: [-0.12, 0.15], sat: [0.85, 1.2], val: [0.85, 1.15], accent: [0, 0] }, fin: { upBlend: [0, 0.35] },
    P: { height: [5, 9], trunkR: [0.15, 0.22], trunkFrac: 0.95, taper: 0.55, flare: 0.35, lean: [0.1, 0.35], bend: [1, 2], seg: 7, roots: [0, 0], sway: 0.45,
      br: { n: [0, 0], from: 0.5, to: 1, len: [0.1, 0.2], elev: [0.3, 0.6], droop: 0, twigs: false }, crown: { type: 'palm', fronds: [8, 12], len: [2.2, 3.4] } } },
  tree_fern: { ...G.tree_jungle, fam: 'tree_palm', scale: [0.9, 1.3], fin: { upBlend: [0, 0.35] },
    P: { height: [1.6, 3.2], trunkR: [0.1, 0.16], trunkFrac: 0.95, taper: 0.8, flare: 0.5, lean: [0, 0.1], bend: [0.3, 0.8], seg: 6, roots: [0, 0], sway: 0.3,
      br: { n: [0, 0], from: 0.5, to: 1, len: [0.1, 0.2], elev: [0.3, 0.6], droop: 0, twigs: false }, crown: { type: 'palm', fronds: [10, 14], len: [1.0, 1.6] } } },
  stump_jungle: { ...G.stump_hollow, scale: [0.9, 1.5], style: { ...G.stump_hollow.style, accent: [0.4, 1] }, P: { ...G.stump_hollow.P, radius: [0.5, 0.9], height: [0.6, 1.3], flare: 0.9, roots: [5, 8], stubs: [1, 2] } },
  mushroom_giant: { ...G.mushroom_toadstool, scale: [0.9, 1.5],
    P: { shape: 'dome', count: [1, 1], capR: [0.3, 0.5], capH: [0.2, 0.32], stemH: [0.45, 0.8], stemR: [0.06, 0.1], stemTop: 0.7, tilt: [0, 0.15], spots: [8, 14] } },
  plant_fern_large: { ...G.plant_fern, scale: [0.9, 1.4], P: { type: 'fern', fronds: [10, 14], len: [1.2, 1.9], sway: 0.2 } },
  flower_lily: { ...G.flower_daisy, scale: [0.9, 1.3], style: { ...G.flower_daisy.style, accents: [0xff8fb1, 0xffffff, 0xf6c431, 0xe84a5f] },
    P: { heads: [1, 1], height: [0.5, 0.8], lean: [0, 0.2], bend: [0.3, 0.8], leaves: [3, 4], petals: [6, 6], petalW: [0.07, 0.09], petalL: [0.16, 0.22], open: [1.0, 1.3], curl: 0.15, flare: 0.1, centerR: 0.03, sway: 0.1 } },
  flower_spike: { ...G.flower_daisy, scale: [0.9, 1.3], style: { ...G.flower_daisy.style, accents: [0x9b59b6, 0x6aa8ff, 0xffffff, 0xff8fb1] },
    P: { heads: [1, 2], height: [0.4, 0.7], lean: [0, 0.15], bend: [0.1, 0.4], leaves: [2, 3], spike: [7, 10], petals: [4, 5], petalW: [0.03, 0.04], petalL: [0.055, 0.07], open: [1.0, 1.3], curl: 0, flare: 0, centerR: 0, sway: 0.1 } },
  roots_exposed: { ...G.vine_creeper, scale: [0.9, 1.5], fin: {}, P: { type: 'roots', count: [4, 6], rootR: [0.14, 0.24], length: [1.6, 3.2], sway: 0 } },
  vine_thick: { ...G.vine_hanging, scale: [0.9, 1.3], P: { ...G.vine_hanging.P, thick: 2.6, leafEvery: 3, leafLen: [0.25, 0.4], length: [3, 6] } },
  // ===== 평원 =====
  tree_wide: { ...G.tree_oak, scale: [0.9, 1.25],
    P: { ...G.tree_oak.P, height: [5.5, 8], trunkR: [0.35, 0.5], trunkFrac: 0.42, taper: 0.55, flare: 1.0,
      br: { n: [5, 7], from: 0.45, to: 0.95, len: [0.45, 0.7], elev: [0.15, 0.45], droop: 0.12, twigs: true },
      crown: { type: 'blob', r: [0.22, 0.3], flat: [0.45, 0.65], noise: 0.22, fill: [4, 6], spread: 0.4 } } },
  grass_wheat: { ...G.grass_dry, scale: [0.9, 1.3], P: { blades: [10, 15], height: [0.7, 1.1], width: 0.035, spread: 0.2, curl: 0.35, lean: 0.12, taper: 1.0, rows: 6, outward: 0.5, edge: 0.2, sway: 0.3, bulge: 0.08, headFrac: 1, headCol: [1, 0.82, 0.45] } },
  plant_shrub_small: { ...G.plant_bush, scale: [0.9, 1.4], P: { type: 'bush', radius: [0.18, 0.32], blobs: [3, 4], berries: [3, 6], sway: 0.12 } },
  rock_pebbles: { ...G.rock_cluster, scale: [0.8, 1.4], P: { radius: [0.12, 0.22], sx: [1, 1.3], sy: [0.6, 0.9], sz: [1, 1.3], noise: 0.25, freq: 1.4, flatten: 0.3, taper: 0, chips: [3, 5], group: [4, 7], strata: 0, chipSub: 0 } },
  // ===== 사막 =====
  cactus_saguaro: { base: 'tree', fam: 'cactus', scale: [0.8, 1.3], style: { hue: [-0.1, 0.1], sat: [0.8, 1.1], val: [0.8, 1.15], accent: [0, 0] }, fin: { upBlend: [0, 0] },
    P: { height: [3, 6], trunkR: [0.22, 0.32], trunkFrac: 1.0, taper: 0.85, flare: 0.25, lean: [0, 0.12], bend: [0, 0.3], seg: 18, roots: [0, 0], sway: 0.04, rib: { n: [6, 8], amp: 0.1 }, dome: true,
      br: { n: [1, 4], from: 0.25, to: 0.7, len: [0.15, 0.4], elev: [0, 0], droop: 0, twigs: false, elbow: true, rArm: 0.62 }, crown: { type: 'none' } } },
  cactus_column: { ...G.tree_dead, fam: 'cactus', scale: [0.8, 1.4], style: { hue: [-0.1, 0.1], sat: [0.8, 1.1], val: [0.8, 1.15], accent: [0, 0] }, fin: {},
    P: { height: [0.8, 1.5], trunkR: [0.1, 0.15], trunkFrac: 1.0, taper: 0.8, flare: 0.3, lean: [0, 0.1], bend: [0, 0.3], seg: 14, roots: [0, 0], sway: 0.04, rib: { n: [5, 6], amp: 0.14 }, dome: true,
      br: { n: [0, 1], from: 0.3, to: 0.5, len: [0.2, 0.3], elev: [0, 0], droop: 0, twigs: false, elbow: true, rArm: 0.6 }, crown: { type: 'none' } } },
  cactus_barrel: { ...G.tree_dead, fam: 'cactus', scale: [0.8, 1.4], style: { hue: [-0.1, 0.1], sat: [0.8, 1.1], val: [0.8, 1.15], accent: [0, 0] }, fin: {},
    P: { height: [0.5, 0.9], trunkR: [0.26, 0.38], trunkFrac: 1.0, taper: 0.6, belly: 0.5, flare: 0.1, lean: [0, 0.05], bend: [0, 0.1], seg: 22, roots: [0, 0], sway: 0.02, rib: { n: [9, 11], amp: 0.14 }, dome: true, domeFlat: true,
      br: { n: [0, 0], from: 0.3, to: 0.5, len: [0.2, 0.3], elev: [0, 0], droop: 0, twigs: false }, crown: { type: 'none' } } },
  cactus_prickly: { ...G.tree_dead, fam: 'cactus', scale: [0.8, 1.4], style: { hue: [-0.1, 0.1], sat: [0.8, 1.1], val: [0.8, 1.15], accent: [0, 0] }, fin: {},
    P: { height: [0.01, 0.02], trunkR: [0.04, 0.05], trunkFrac: 1.0, taper: 1, flare: 0, lean: [0, 0], bend: [0, 0], seg: 4, roots: [0, 0], sway: 0.05, noTrunk: true, coll: 0.3,
      br: { n: [0, 0], from: 0.3, to: 0.5, len: [0.2, 0.3], elev: [0, 0], droop: 0, twigs: false }, crown: { type: 'pads', n: [5, 9], size: [0.22, 0.32] } } },
  rock_arch: { ...G.rock_sandstone, scale: [1.2, 2.2], fin: { deindex: true, smooth: 0.15, tri: true },
    P: { radius: [1, 1], sx: [1, 1], sy: [1, 1], sz: [1, 1], noise: 0.26, freq: 1.7, flatten: 0, taper: 0, chips: [0, 0], strata: 1.0, arch: { span: [5, 7], height: [3.6, 5], thick: [1.1, 1.5] } } },
  rock_mesa: { ...G.rock_sandstone, scale: [1.0, 1.8],
    P: { radius: [2.5, 4], sx: [1, 1.3], sy: [1, 1], sz: [1, 1.3], noise: 0.1, freq: 1.5, flatten: 0.6, taper: 0, chips: [0, 0], strata: 1.0, stack: { layers: [4, 6], taper: 0.25, thick: [0.9, 1.3], ftAll: true } } },
  rock_hoodoo: { ...G.rock_sandstone, scale: [1.0, 1.8],
    P: { radius: [0.7, 1.1], sx: [0.9, 1.1], sy: [1, 1], sz: [0.9, 1.1], noise: 0.22, freq: 1.6, flatten: 0, taper: 0, chips: [0, 0], strata: 1.0, stack: { layers: [3, 7], neck: [0.4, 0.7], cap: [1.1, 1.5], thick: [0.7, 1.2] } } },
  rock_weathered: { ...G.rock_sandstone, style: { ...G.rock_sandstone.style, sat: [0.45, 0.8] }, fin: { deindex: true, smooth: 0.1, tri: true },
    P: { radius: [0.7, 1.6], sx: [1, 1.4], sy: [0.6, 0.9], sz: [0.9, 1.3], noise: 0.38, freq: 2.6, flatten: 0.3, taper: 0, chips: [1, 3], strata: 0.6 } },
  tumbleweed: { base: 'plant', fam: 'dry_plant', scale: [0.8, 1.4], style: { hue: [-0.12, 0.12], sat: [0.7, 1.1], val: [0.75, 1.15], accent: [0, 0] }, fin: {}, P: { type: 'tumble', radius: [0.28, 0.45], arcs: [14, 20], sway: 0.02 } },
  plant_shrub_dry: { ...G.plant_fern, fam: 'dry_plant', scale: [0.8, 1.3], style: { hue: [-0.12, 0.12], sat: [0.7, 1.1], val: [0.75, 1.15], accent: [0, 0] }, fin: {}, P: { type: 'twiggy', height: [0.7, 1.2], twigs: [9, 14], sway: 0.12 } },
  // ===== 설원 =====
  tree_snow_pine: { ...G.tree_pine, scale: [0.9, 1.3], style: { hue: [-0.05, 0.05], sat: [0.8, 1], val: [0.8, 1.05], accents: WHITE, accent: [0.85, 1] }, fin: { upBlend: [0, 0.3], maskUp: { lo: 0.3, hi: 0.6 } },
    P: { ...G.tree_pine.P, crown: { ...G.tree_pine.P.crown, ragged: 0.3 } } },
  tree_snow_spruce: { ...G.tree_pine, scale: [0.9, 1.3], style: { hue: [-0.05, 0.05], sat: [0.8, 1], val: [0.8, 1.05], accents: WHITE, accent: [0.6, 1] }, fin: { upBlend: [0, 0.3], maskUp: { lo: 0.4, hi: 0.75 } },
    P: { ...G.tree_pine.P, height: [11, 15], trunkR: [0.22, 0.3], crown: { ...G.tree_pine.P.crown, tiers: [8, 11], R: [0.1, 0.16], ragged: 0.32 } } },
  tree_snow_bare: { ...G.tree_oak, fam: 'tree_snowbare', scale: [0.9, 1.25], style: { hue: [-0.05, 0.05], sat: [0.8, 1], val: [0.8, 1.1], accents: WHITE, accent: [0.9, 1] }, fin: { maskUp: { lo: 0.4, hi: 0.7 } },
    P: { ...G.tree_oak.P, height: [6.5, 9.5], trunkFrac: 0.8, sway: 0.15, snowCaps: true, br: { n: [9, 13], from: 0.3, to: 0.98, len: [0.3, 0.5], elev: [0.5, 1.0], droop: 0.1, twigs: true }, crown: { type: 'none' } } },
  rock_snowy: { ...G.rock_snow, style: { ...G.rock_snow.style, accent: [0.9, 1] }, fin: { deindex: true, smooth: 0.05, tri: true, maskUp: { lo: 0.3, hi: 0.65 } } },
  ice_crystal: { base: 'rock', fam: 'rock_ice', scale: [0.8, 1.5], style: { hue: [-0.08, 0.08], sat: [0.9, 1.2], val: [0.9, 1.2], accent: [0, 0] }, fin: { deindex: true, smooth: 0, tri: true },
    P: { radius: [0.3, 0.55], sx: [0.45, 0.7], sy: [1.6, 3.0], sz: [0.45, 0.7], noise: 0.1, freq: 2, flatten: 0.1, taper: 0.75, chips: [2, 4], strata: 0, shear: 0.25 } },
  icicle: { base: 'rock', fam: 'rock_ice', scale: [0.8, 1.5], style: { hue: [-0.08, 0.08], sat: [0.9, 1.2], val: [0.9, 1.2], accent: [0, 0] }, fin: { deindex: true, smooth: 0, tri: true },
    P: { radius: [0.08, 0.14], sx: [0.8, 1], sy: [2.5, 4.5], sz: [0.8, 1], noise: 0.08, freq: 2, flatten: 0, taper: 0.85, chips: [2, 5], strata: 0, invert: true } },
  // ===== 화산 =====
  tree_burnt_full: { ...G.tree_dead, fam: 'tree_burnt', scale: [0.85, 1.25], style: { hue: [-0.03, 0.03], sat: [0.8, 1], val: [0.45, 1.0], accents: EMBER, accent: [0, 0.8] },
    P: { ...G.tree_dead.P, height: [4, 10], trunkFrac: 0.85, taper: 0.4, lean: [0.05, 0.4], bend: [1, 3], char: 1.0, embers: 0.9, br: { n: [3, 7], from: 0.25, to: 0.85, len: [0.12, 0.3], elev: [0.3, 0.8], droop: 0.15, twigs: false } } },
  tree_burnt_partial: { ...G.tree_dead, fam: 'tree_burnt', scale: [0.85, 1.25], style: { hue: [-0.03, 0.03], sat: [0.8, 1], val: [0.55, 1.1], accents: EMBER, accent: [0, 0.6] }, fin: { upBlend: [0, 0.4] },
    P: { ...G.tree_dead.P, height: [5.5, 8.5], trunkFrac: 0.72, char: 0.5, embers: 0.6, br: { n: [5, 7], from: 0.35, to: 0.9, len: [0.2, 0.35], elev: [0.3, 0.8], droop: 0.1, twigs: true },
      crown: { type: 'blob', r: [0.07, 0.11], flat: [0.5, 0.8], noise: 0.35, fill: [0, 1], spread: 0.15 } } },
  stump_burnt: { ...G.stump_broken, fam: 'tree_burnt', style: { ...G.stump_broken.style, accent: [0, 0] }, fin: {}, P: { ...G.stump_broken.P, radius: [0.3, 0.55], height: [0.5, 1.1], char: 1, jag: 0.4, stubs: [0, 2] } },
  log_burnt: { ...G.log_fallen, fam: 'tree_burnt', style: { ...G.log_fallen.style, accent: [0, 0] }, fin: {}, P: { ...G.log_fallen.P, char: 0.9, radius: [0.25, 0.4], length: [2.2, 4], stubs: [2, 4] } },
  branch_burnt: { ...G.log_fallen, fam: 'tree_burnt', scale: [0.8, 1.3], style: { ...G.log_fallen.style, accent: [0, 0] }, fin: {}, P: { ...G.log_fallen.P, char: 1, radius: [0.05, 0.1], length: [1, 2], stubs: [3, 5], flare: 0, roots: [0, 0] } },
  rock_lava_ashy: { ...G.rock_lava, style: { hue: [-0.05, 0.1], sat: [0.8, 1.3], val: [0.8, 1.2], accents: ASH, accent: [0.6, 1] }, fin: { deindex: true, smooth: 0, tri: true, maskUp: { lo: 0.35, hi: 0.7 } } },
  rock_basalt: { base: 'rock', fam: 'rock_basalt', scale: [0.8, 1.4], style: { hue: [-0.05, 0.05], sat: [0.7, 1.1], val: [0.8, 1.2], accent: [0, 0] }, fin: { deindex: true, smooth: 0, tri: true },
    P: { radius: [0.8, 1.6], sx: [0.8, 1.2], sy: [1.0, 1.6], sz: [0.8, 1.2], noise: 0.12, freq: 2.5, flatten: 0.1, taper: 0, chips: [2, 4], strata: 0, shear: 0.15 } },
  ash_mound: { base: 'rock', fam: 'ash', scale: [0.8, 1.5], style: { hue: [-0.05, 0.05], sat: [0.7, 1.1], val: [0.75, 1.2], accent: [0, 0] }, fin: { deindex: true, smooth: 0.9, tri: true },
    P: { radius: [1.0, 2.2], sx: [1, 1.4], sy: [0.18, 0.32], sz: [1, 1.4], noise: 0.12, freq: 1.2, flatten: 0.15, taper: 0, chips: [3, 6], strata: 0 } },
  ash_patch: { base: 'rock', fam: 'ash', scale: [0.9, 1.6], style: { hue: [-0.05, 0.05], sat: [0.7, 1.1], val: [0.7, 1.15], accent: [0, 0] }, fin: { deindex: true, smooth: 0.95, tri: true },
    P: { radius: [1.5, 3.2], sx: [1, 1.3], sy: [0.05, 0.09], sz: [1, 1.3], noise: 0.1, freq: 1.0, flatten: 0, taper: 0, chips: [0, 0], strata: 0 } },
  // ===== 바다 (수면/해저 구현은 건드리지 않음: 해안·얕은 물 장식만) =====
  driftwood: { ...G.log_fallen, fam: 'driftwood', scale: [0.8, 1.3], style: { hue: [-0.05, 0.05], sat: [0.4, 0.8], val: [0.8, 1.3], accent: [0, 0] }, fin: {}, P: { ...G.log_fallen.P, radius: [0.1, 0.22], length: [1.5, 3.2], flare: 0.1, roots: [0, 1], stubs: [2, 4] } },
  rock_sea: { ...G.rock_boulder, fam: 'rock_wet', scale: [0.8, 1.3], fin: { deindex: true, smooth: 0.5, tri: true }, P: { ...G.rock_boulder.P, radius: [0.5, 1.4], sy: [0.5, 0.8], noise: 0.2 } },
  reed_cattail: { ...G.grass_tall, scale: [0.9, 1.3], P: { blades: [8, 12], height: [1.2, 1.8], width: 0.045, spread: 0.25, curl: 0.3, lean: 0.1, taper: 1.2, rows: 6, outward: 0.4, edge: 0.2, sway: 0.3, bulge: 0.09, headFrac: 0.5, headCol: [0.55, 0.33, 0.15] } },
  seaweed: { base: 'plant', fam: 'kelp', scale: [0.8, 1.3], style: { hue: [-0.2, 0.25], sat: [0.8, 1.2], val: [0.8, 1.15], accent: [0, 0] }, fin: { upBlend: [0.3, 0.3] }, P: { type: 'kelp', blades: [5, 9], height: [0.8, 1.6], width: [0.09, 0.14], sway: 0.3 } },
  coral: { ...G.tree_dead, fam: 'coral', scale: [0.8, 1.4], style: { hue: [-0.7, 0.7], sat: [0.9, 1.4], val: [0.85, 1.2], accent: [0, 0] }, fin: {},
    P: { height: [0.4, 0.8], trunkR: [0.04, 0.06], trunkFrac: 0.3, taper: 0.8, flare: 0.3, lean: [0, 0.1], bend: [0.5, 1], seg: 5, roots: [0, 0], sway: 0.12,
      br: { n: [9, 14], from: 0.05, to: 0.95, len: [0.6, 1.1], elev: [0.4, 1.2], droop: 0, twigs: true }, crown: { type: 'none' } } },
});

// 지형별 제작 목록 (역할별). nature-test.html 갤러리와 다음 단계 배치 규칙이 이걸 기준으로 씀
export const BIOMES = {
  jungle: { label: '정글(숲)', roles: {
    대표나무: ['tree_jungle_giant'], 나무: ['tree_jungle', 'tree_jungle_slender', 'tree_palm', 'tree_fern'], 그루터기: ['stump_jungle', 'stump_cut', 'log_fallen'],
    버섯: ['mushroom_giant', 'mushroom_button', 'mushroom_toadstool', 'mushroom_conical', 'mushroom_cluster'], '잔디·양치': ['grass_broad', 'grass_tall', 'plant_fern', 'plant_fern_large'],
    야생화: ['flower_lily', 'flower_spike', 'flower_cluster', 'flower_bell'], '뿌리·덩굴': ['roots_exposed', 'vine_hanging', 'vine_thick', 'vine_climbing', 'vine_creeper'], '바위·작은 식물': ['rock_mossy', 'plant_rosette', 'plant_sapling'] } },
  plains: { label: '평원', roles: {
    나무: ['tree_oak', 'tree_birch', 'tree_wide'], 잔디: ['grass_short', 'grass_tall', 'grass_wheat'], 야생화: ['flower_daisy', 'flower_tulip', 'flower_bell', 'flower_cluster', 'flower_spike'],
    버섯: ['mushroom_button', 'mushroom_toadstool', 'mushroom_conical', 'mushroom_cluster'], '관목·작은 식물': ['plant_bush', 'plant_shrub_small', 'plant_rosette'], 바위: ['rock_boulder', 'rock_pebbles', 'rock_slab', 'rock_mossy'] } },
  desert: { label: '사막', roles: {
    선인장: ['cactus_saguaro', 'cactus_column', 'cactus_barrel', 'cactus_prickly'], '사암 암석': ['rock_arch', 'rock_mesa', 'rock_hoodoo', 'rock_sandstone', 'rock_weathered'], '식물': ['tumbleweed', 'plant_shrub_dry', 'grass_dry'], 고목: ['tree_dead'] } },
  snow: { label: '설원', roles: { '눈 덮인 나무': ['tree_snow_pine', 'tree_snow_spruce', 'tree_snow_bare'], '바위·얼음': ['rock_snowy', 'rock_snow', 'ice_crystal', 'icicle'] } },
  volcano: { label: '화산', roles: { '탄 나무': ['tree_burnt_full', 'tree_burnt_partial'], '그루터기·고목': ['stump_burnt', 'log_burnt', 'branch_burnt'], '암석·재': ['rock_lava', 'rock_lava_ashy', 'rock_basalt', 'ash_mound', 'ash_patch'] } },
  ocean: { label: '바다(해안·얕은 물)', roles: { 해안: ['driftwood', 'rock_sea', 'reed_cattail'], '얕은 물': ['seaweed', 'coral'] } },
};

export const SPECIES_IDS = Object.keys(SPECIES);

// 한 종류 + seed + LOD → 정점 데이터. 같은 seed면 LOD0/1이 같은 실루엣.
export function buildSpecies(id, seed = 1, lod = 0) {
  const S = SPECIES[id];
  if (!S) throw new Error('알 수 없는 자연 오브젝트: ' + id);
  const rand = mulberry32((hashStr(id) ^ Math.imul(seed + 1, 2654435761)) >>> 0);
  const buf = BASES[S.base](S.P, rand, lod);
  const d = finish(buf, S.fin || {});
  d.id = id; d.family = S.fam; d.lod = lod; d.seed = seed;
  return d;
}
