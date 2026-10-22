// 자연 오브젝트를 게임 월드(청크)에 올리는 매니저.
//
//  - 청크마다 InstancedMesh를 만들면 드로우콜이 청크 수 x 종류 수로 폭증하므로, "종류+변종+LOD"별로 월드 전체가 공유하는 풀(InstancedMesh) 하나씩만 둔다.
//  - 청크가 생기면 배치 계산(nature-placement.js)을 프레임 예산(ms) 안에서 조금씩 돌려 데이터만 저장하고(행렬 미리 계산),
//    카메라가 일정 거리 움직이거나 방향이 바뀌거나 청크가 바뀌면 풀을 다시 채운다(repack): 거리별 LOD 선택, 생략 거리 밖/뒤쪽 제외.
//  - GPU 자원은 풀에만 있어서 청크 제거는 데이터만 지우면 된다(청크 경계에서 깜빡임/누수 없음).
import { createPlacer, composeMatrix, drawRule, CHUNK } from './nature-placement.js';

const REPACK_MOVE = 4;            // 이만큼 움직이면 다시 채움 (유닛)
const REPACK_TURN = 15 * Math.PI / 180;   // 시야 방향이 이만큼 바뀌면 다시 채움
const REPACK_MIN_MS = 120;        // 다시 채우기 최소 간격
const CONE_MARGIN = 35 * Math.PI / 180;   // 화면 시야각 바깥 여유 (방향 갱신 15도 < 여유 35도 이므로 가장자리에서 안 비어 보임)
const NEAR_ALL = 12;              // 이 안쪽은 방향과 상관없이 모두 그림

export function createNatureWorld({ scene, kit, T, seed, chunkSize = CHUNK, budgetMs = 2.5 }) {
  const placer = createPlacer(T, seed);
  const chunks = new Map();       // key -> { n, slot:Uint16Array, mat:Float32Array, sty:Float32Array }
  const queue = [];               // 배치 계산 대기 { key, cx, cz }
  let running = null;             // { key, cx, cz, gen }
  const wanted = new Set();

  // 종류+변종 슬롯
  const slotIndex = new Map();
  const slots = [];               // { id, v, variant, l0, l1, cull, big, small }
  const variantCache = new Map();
  const accentCache = new Map();
  const pools = new Map();        // slot*3+lod -> { mesh, cap, n }
    let cull2 = new Float32Array(256), l0sq = new Float32Array(256), l1sq = new Float32Array(256), bigF = new Uint8Array(256);

  function slotOf(id, v, nv) {
    const k = id + ':' + v;
    let s = slotIndex.get(k);
    if (s !== undefined) return s;
    let vs = variantCache.get(id + '#' + nv);
    if (!vs) { vs = kit.getVariants(id, { count: nv }); variantCache.set(id + '#' + nv, vs); }
    const r = drawRule(id);
    s = slots.length;
    slots.push({ id, v, variant: vs[v % vs.length], rule: r });
    slotIndex.set(k, s);
    if (s >= cull2.length) {
      const n = cull2.length * 2, g = (a, T2) => { const b = new T2(n); b.set(a); return b; };
      cull2 = g(cull2, Float32Array); l0sq = g(l0sq, Float32Array); l1sq = g(l1sq, Float32Array); bigF = g(bigF, Uint8Array);
    }
    cull2[s] = r.cull * r.cull; l0sq[s] = r.l0 * r.l0; l1sq[s] = r.l1 * r.l1; bigF[s] = r.big ? 1 : 0;
    return s;
  }

  function accentRGB(hex) {
    let a = accentCache.get(hex);
    if (!a) { const c = new kit.THREE.Color(hex); a = [c.r, c.g, c.b]; accentCache.set(hex, a); }
    return a;
  }

  // 배치 결과(객체 목록) -> 청크 데이터(typed array)
  function pack(items) {
    const n = items.length;
    const d = { n, slot: new Uint16Array(n), mat: new Float32Array(n * 16), sty: new Float32Array(n * 8) };
    for (let i = 0; i < n; i++) {
      const it = items[i];
      d.slot[i] = slotOf(it.id, it.v, placer.nvar[it.layer]);
      composeMatrix(d.mat, i * 16, it);
      const st = it.style, o = i * 8;
      d.sty[o] = st.hue; d.sty[o + 1] = st.sat; d.sty[o + 2] = st.val; d.sty[o + 3] = st.phase;
      if (st.accent !== undefined) { const a = accentRGB(st.accent); d.sty[o + 4] = a[0]; d.sty[o + 5] = a[1]; d.sty[o + 6] = a[2]; }
      d.sty[o + 7] = st.accentAmt || 0;
    }
    return d;
  }

  const keyOf = (cx, cz) => cx + ',' + cz;

  function requestChunk(cx, cz) {
    const key = keyOf(cx, cz);
    if (wanted.has(key)) return;               // 이미 요청/완료됨 (청크 해상도만 바뀌는 재생성은 무시)
    wanted.add(key); queue.push({ key, cx, cz }); dirty = true;
  }
  function removeChunk(cx, cz) {
    const key = keyOf(cx, cz);
    if (!wanted.delete(key)) return;
    chunks.delete(key);
    const qi = queue.findIndex((q) => q.key === key);
    if (qi >= 0) queue.splice(qi, 1);
    if (running && running.key === key) running = null;
    dirty = true;
  }

  // 배치 계산 진행 (프레임당 예산 ms). 가까운 청크부터.
  let camCx = 0, camCz = 0;
  function pump(ms) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (!running) {
        if (!queue.length) return;
        let bi = 0, bd = Infinity;
        for (let i = 0; i < queue.length; i++) { const q = queue[i], d = (q.cx - camCx) ** 2 + (q.cz - camCz) ** 2; if (d < bd) { bd = d; bi = i; } }
        const q = queue.splice(bi, 1)[0];
        running = { key: q.key, gen: placer.chunkGenerator(q.cx, q.cz, chunkSize) };
      }
      const r = running.gen.next();
      if (r.done) { chunks.set(running.key, pack(r.value)); running = null; dirty = true; }
    }
  }

  // 풀 만들기/키우기
  function makePool(slot, lod, cap) {
    const mesh = kit.createInstanced(slots[slot].variant, cap, lod);
    mesh.frustumCulled = false;       // 풀 하나가 주변 전체를 덮으므로 인스턴스 단위 컬링은 repack에서 직접 한다
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, cap, n: 0, a: mesh.geometry.attributes.aInstA, b: mesh.geometry.attributes.aInstB };
  }
  function growPool(key, slot, lod, need) {
    const old = pools.get(key);
    let cap = Math.max(32, old ? old.cap : 32);
    while (cap < need) cap *= 2;
    if (old) { scene.remove(old.mesh); kit.disposeInstanced(old.mesh); }
    const p = makePool(slot, lod, cap);
    pools.set(key, p);
    return p;
  }

  // ----- 다시 채우기 -----
  let dirty = true, lastX = 1e9, lastZ = 1e9, lastYaw = 1e9, lastT = 0;
  let stat = { instances: 0, pools: 0, tris: 0, items: 0, chunks: 0, repacks: 0, lastRepackMs: 0 };
  const need = new Map();

  function repack(cx, cz, fx, fz, cosL, fast) {
    const t0 = performance.now();
    for (const p of pools.values()) p.n = 0;
    need.clear();
    let inst = 0;
    for (const ch of chunks.values()) {
      const slot = ch.slot, mat = ch.mat, sty = ch.sty;
      for (let i = 0, n = ch.n; i < n; i++) {
        const o = i * 16;
        const dx = mat[o + 12] - cx, dz = mat[o + 14] - cz;
        const d2 = dx * dx + dz * dz, s = slot[i];
        if (d2 > cull2[s]) continue;
        if (!bigF[s] && d2 > NEAR_ALL * NEAR_ALL) {
          if (fast && d2 > 3600) continue;                                  // 빠른 이동 중에는 60칸 밖은 생략
          if (dx * fx + dz * fz < cosL * Math.sqrt(d2)) continue;           // 시야 뒤쪽은 제외
        }
        const lod = d2 < l0sq[s] ? 0 : d2 < l1sq[s] ? 1 : 2;
        const pk = s * 3 + lod;
        let p = pools.get(pk);
        if (!p) { p = makePool(s, lod, 32); pools.set(pk, p); }
        const idx = p.n;
        if (idx >= p.cap) { need.set(pk, (need.get(pk) || p.cap) + 1); p.n++; continue; }   // 넘침: 개수만 세고 다음에 키움
        p.n++;
        const ma = p.mesh.instanceMatrix.array, po = idx * 16;
        for (let k = 0; k < 16; k++) ma[po + k] = mat[o + k];
        const so = i * 8, qa = p.a.array, qb = p.b.array, qo = idx * 4;
        qa[qo] = sty[so]; qa[qo + 1] = sty[so + 1]; qa[qo + 2] = sty[so + 2]; qa[qo + 3] = sty[so + 3];
        qb[qo] = sty[so + 4]; qb[qo + 1] = sty[so + 5]; qb[qo + 2] = sty[so + 6]; qb[qo + 3] = sty[so + 7];
        inst++;
      }
    }
    // 넘친 풀은 키운 뒤 한 번만 다시 시도 (드묾)
    if (need.size) {
      for (const [pk] of need) { const s = Math.floor(pk / 3), lod = pk % 3; growPool(pk, s, lod, (pools.get(pk).n) | 0); }
      return repack(cx, cz, fx, fz, cosL, fast);     // 새 풀(n=0)로 한 번 더 채움. 넘친 만큼 키웠으므로 다시 넘치지 않음
    }
    finish(t0, inst);
  }
  function finish(t0, inst) {
    let tris = 0, np = 0;
    for (const p of pools.values()) {
      const m = p.mesh;
      m.count = p.n; m.visible = p.n > 0;
      if (p.n > 0) {
        m.instanceMatrix.needsUpdate = true; p.a.needsUpdate = true; p.b.needsUpdate = true; np++;
        const g = m.geometry; tris += p.n * ((g.index ? g.index.count : g.attributes.position.count) / 3);
      }
    }
    stat.instances = inst; stat.pools = np; stat.tris = tris; stat.repacks++; stat.lastRepackMs = performance.now() - t0;
    dirty = false;
  }

  // 매 프레임 호출. camera: THREE.PerspectiveCamera, fast: 빠른 이동 모드
  const _d = new kit.THREE.Vector3();
  function update(camera, { fast = false, force = false } = {}) {
    camCx = Math.floor(camera.position.x / chunkSize); camCz = Math.floor(camera.position.z / chunkSize);
    if (!fast) pump(budgetMs);                         // 빠른 이동 중에는 새 청크 배치 계산을 미룸
    camera.getWorldDirection(_d);
    const len = Math.hypot(_d.x, _d.z);
    let fx = 0, fz = -1, yaw = lastYaw;
    if (len > 0.05) { fx = _d.x / len; fz = _d.z / len; yaw = Math.atan2(fx, fz); }
    const cx = camera.position.x, cz = camera.position.z;
    const now = performance.now();
    const moved = Math.hypot(cx - lastX, cz - lastZ) > REPACK_MOVE;
    let dy = Math.abs(yaw - lastYaw); if (dy > Math.PI) dy = Math.PI * 2 - dy;
    if (!force) {
      if (!(dirty || moved || dy > REPACK_TURN)) return;
      if (now - lastT < REPACK_MIN_MS) return;       // 너무 잦은 repack 방지 (dirty는 유지되어 다음 프레임에 재시도)
    }
    lastT = now; lastX = cx; lastZ = cz; lastYaw = yaw;
    // 화면 가로 반각 + 여유. 90도 이상이면 "뒤쪽 제외"를 cos로 표현 (cosL은 음수가 될 수 있음)
    const hfov = Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
    const lim = Math.min(Math.PI, hfov + CONE_MARGIN);
    repack(cx, cz, fx, fz, Math.cos(lim), fast);
    stat.chunks = chunks.size; stat.items = 0; for (const c of chunks.values()) stat.items += c.n;
  }

  return {
    requestChunk, removeChunk, update, placer,
    stats: () => ({ ...stat, queued: queue.length + (running ? 1 : 0), slots: slots.length }),
    // 테스트/디버그용: 큐를 끝까지 처리
    flush() { while (queue.length || running) pump(1000); },
    chunkItemCount: (cx, cz) => (chunks.get(keyOf(cx, cz)) || { n: -1 }).n,
    dispose() { for (const p of pools.values()) { scene.remove(p.mesh); kit.disposeInstanced(p.mesh); } pools.clear(); chunks.clear(); queue.length = 0; wanted.clear(); running = null; },
  };
}
