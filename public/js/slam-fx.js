// 땅 내려찍기 연출 (보스 '내려찍기' 와 플레이어 '내려찍기' 가 같이 써요)
//  ① 쓰기 전: 바닥에 네모(= 실제 피해 범위)가 뜨고, 안쪽 네모가 점점 커져서 가득 차는 순간 땅을 찍음
//  ② 찍는 순간: 땅이 갈라지고, 주변 땅 조각이 위로 솟았다가 가라앉음(보기용이라 부딪히지 않음) + 흙먼지
import * as THREE from 'three';

const TAU = Math.PI * 2;

// ================= 땅 내려찍기 연출 (보스 '내려찍기' · 플레이어 '내려찍기' 공용) =================
// ① 쓰기 1초 전: 바닥에 빨간 네모(= 실제 피해 범위)가 뜨고, 안쪽 네모가 점점 커져서 가득 차는 순간 땅을 찍음
// ② 찍는 순간: 땅이 갈라지고 주변 땅 조각이 위로 솟았다가 가라앉음(보기용이라 부딪히지 않음) + 흙먼지
export function createSlamFx(scene, T, opt) {
  const SIZE = opt.size, TELE = opt.telegraph, HALF = SIZE / 2, N = 16;
  const COL = opt.colors || { fill: 0xff1a0a, inner: 0xff5030, edge: 0xff2a1a };   // 보스는 빨강, 플레이어는 노랑
  const mkGrid = (n) => {
    const g = new THREE.BufferGeometry(), idx = [];
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * (n + 1) * 3), 3));
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2); }
    g.setIndex(idx);
    return g;
  };
  // 보스 기준 좌표(오른쪽 u, 앞쪽 v) → 월드 좌표. 서버 판정(boss-ai.mjs)과 같은 방향 규칙
  const toWorld = (c, u, v) => { const sn = Math.sin(c.ry), cs = Math.cos(c.ry); return [c.x + u * cs + v * sn, c.z - u * sn + v * cs]; };
  const fillGrid = (geo, c, half, yOff) => {
    const p = geo.attributes.position;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const [x, z] = toWorld(c, (i / N * 2 - 1) * half, (j / N * 2 - 1) * half);
      p.setXYZ(j * (N + 1) + i, x, T.height(x, z) + yOff, z);
    }
    p.needsUpdate = true;
  };
  const fillBorder = (geo, c, w) => {   // 네모 테두리 띠 (바깥 → 안쪽 w 만큼)
    const p = geo.attributes.position, K = 4 * N;
    for (let k = 0; k < K; k++) {
      const e = Math.floor(k / N), f = (k % N) / N;
      const a = -HALF + f * SIZE;
      const uv = e === 0 ? [a, -HALF] : e === 1 ? [HALF, a] : e === 2 ? [-a, HALF] : [-HALF, -a];
      for (const [slot, sc] of [[0, 1], [1, (HALF - w) / HALF]]) {
        const [x, z] = toWorld(c, uv[0] * sc, uv[1] * sc);
        p.setXYZ(k * 2 + slot, x, T.height(x, z) + 0.4, z);
      }
    }
    p.needsUpdate = true;
  };
  const borderGeo = (() => {
    const g = new THREE.BufferGeometry(), K = 4 * N, idx = [];
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(K * 2 * 3), 3));
    for (let k = 0; k < K; k++) { const a = k * 2, b = ((k + 1) % K) * 2; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    g.setIndex(idx);
    return g;
  })();
  const red = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const fillMat = red(COL.fill, 0.15), innerMat = red(COL.inner, 0.34), edgeMat = red(COL.edge, 0.95);
  const fill = new THREE.Mesh(mkGrid(N), fillMat), inner = new THREE.Mesh(mkGrid(N), innerMat), edge = new THREE.Mesh(borderGeo, edgeMat);
  const tele = new THREE.Group(); tele.add(fill, inner, edge); tele.visible = false;
  for (const m of [fill, inner, edge]) { m.frustumCulled = false; m.renderOrder = 6; }
  scene.add(tele);

  // 땅 조각 (인스턴스 64개: 흙덩이·바위)
  const CH = 64;
  const chunkGeo = new THREE.IcosahedronGeometry(0.5, 0);
  const chunkMat = new THREE.MeshLambertMaterial({ flatShading: true });
  const chunks = new THREE.InstancedMesh(chunkGeo, chunkMat, CH);
  chunks.frustumCulled = false; chunks.count = 0; chunks.visible = false;
  chunks.setColorAt(0, new THREE.Color(0x3b2a20));
  scene.add(chunks);
  const SOIL = [0x3b2a20, 0x4a382c, 0x33261e, 0x5b5852, 0x6b665e].map((h) => new THREE.Color(h));
  const items = [];
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), ee = new THREE.Euler(), pp = new THREE.Vector3(), ss = new THREE.Vector3();

  // 갈라진 땅 자국
  const crackMat = new THREE.MeshBasicMaterial({ color: 0x0b0705, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  let crack = null;

  // 흙먼지
  const puffs = [];
  const puffGeo = new THREE.SphereGeometry(1, 8, 6);
  for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0x80705c, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; scene.add(m); puffs.push({ m, t: 9, vx: 0, vz: 0, r: 1 }); }

  let c = null, t = 0, impacted = false, after = 0;
  const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);

  function start(x, z, ry) {
    c = { x, z, ry }; t = 0; impacted = false; after = 0;
    fillGrid(fill.geometry, c, HALF, 0.35); fillBorder(edge.geometry, c, 0.45);
    tele.visible = true;
  }
  function cancel() { c = null; tele.visible = false; }

  function impact() {
    impacted = true; tele.visible = false;
    // 땅 조각: 가운데에서 바깥으로 물결치듯 차례로 솟아오름
    items.length = 0;
    for (let i = 0; i < CH; i++) {
      const u = rnd(-HALF, HALF), v = rnd(-HALF, HALF), [x, z] = toWorld(c, u, v), d = Math.hypot(u, v);
      const near = 1 - Math.min(1, d / (HALF * 1.2));
      items.push({
        x, z, y0: T.height(x, z), delay: d / 22 + rnd(0, 0.08), dur: rnd(1.1, 1.6), peak: 0.7 + near * 2.4 + rnd(0, 0.9),
        w: rnd(0.6, 1.5) * (1 + near * 0.6), h: rnd(0.3, 0.7), spin: [rnd(-3, 3), rnd(-2, 2), rnd(-3, 3)], r0: [rnd(0, 6), rnd(0, 6), rnd(0, 6)], col: SOIL[Math.floor(rnd(0, SOIL.length)) % SOIL.length],
      });
      chunks.setColorAt(i, items[i].col);
    }
    if (chunks.instanceColor) chunks.instanceColor.needsUpdate = true;
    chunks.count = CH; chunks.visible = true;
    // 갈라진 자국: 가운데에서 갈라져 뻗는 들쭉날쭉한 선 9개
    if (crack) { scene.remove(crack); crack.geometry.dispose(); }
    const pos = [], idx = [];
    for (let k = 0; k < 9; k++) {
      const a0 = (k / 9) * TAU + rnd(-0.2, 0.2), len = rnd(HALF * 0.7, HALF * 1.25), seg = 10;
      let ang = a0, px = 0, pz = 0, base = pos.length / 3;
      for (let s = 0; s <= seg; s++) {
        const wdt = 0.32 * (1 - s / seg) + 0.04;
        const nx = -Math.sin(ang), nz = Math.cos(ang);
        for (const sg of [-1, 1]) { const [x, z] = toWorld(c, px + nx * wdt * sg, pz + nz * wdt * sg); pos.push(x, T.height(x, z) + 0.3, z); }
        px += Math.cos(ang) * len / seg; pz += Math.sin(ang) * len / seg; ang += rnd(-0.45, 0.45);
        if (s < seg) { const a = base + s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); g.setIndex(idx);
    crack = new THREE.Mesh(g, crackMat); crack.frustumCulled = false; crack.renderOrder = 4; crackMat.opacity = 0.92; scene.add(crack);
    // 흙먼지
    for (const p of puffs) {
      const a = rnd(0, TAU), r = rnd(1, HALF * 0.9), [x, z] = toWorld(c, Math.cos(a) * r, Math.sin(a) * r);
      p.t = 0; p.r = rnd(0.8, 1.6); p.vx = Math.cos(a) * rnd(0.5, 2); p.vz = Math.sin(a) * rnd(0.5, 2);
      p.m.position.set(x, T.height(x, z) + 0.4, z); p.m.visible = true; p.m.userData.y0 = p.m.position.y;
    }
  }

  function update(dt) {
    if (c && !impacted) {
      t += dt;
      const f = Math.min(1, t / TELE);
      const pulse = 0.5 + 0.5 * Math.sin(t * 18);
      fillMat.opacity = 0.12 + 0.2 * f + (f > 0.75 ? 0.14 * pulse : 0);          // 점점 진해지고 마지막엔 깜빡임
      innerMat.opacity = 0.3 + 0.25 * f;
      edgeMat.opacity = 0.8 + 0.2 * pulse;
      fillGrid(inner.geometry, c, HALF * Math.max(0.02, f), 0.38);                // 안쪽 네모가 가득 찰 때가 땅을 찍는 순간
      if (t >= TELE) impact();
    }
    if (impacted) {
      after += dt;
      let alive = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i], p = (after - it.delay) / it.dur;
        if (p < 0 || p > 1.12) { ss.set(0, 0, 0); m4.compose(pp.set(it.x, it.y0, it.z), qq.identity(), ss); chunks.setMatrixAt(i, m4); continue; }
        alive++;
        const rise = p < 0.3 ? 1 - Math.pow(1 - p / 0.3, 3) : 1 - Math.pow((p - 0.3) / 0.7, 2) * 1.0;   // 빠르게 솟았다가 천천히 내려앉음
        const sink = p > 1 ? (p - 1) * 6 : 0;
        const y = it.y0 + it.peak * Math.max(0, rise) - sink * it.h;
        const sc = it.w * (p > 1 ? Math.max(0, 1 - (p - 1) * 8) : 1);
        ee.set(it.r0[0] + it.spin[0] * p, it.r0[1] + it.spin[1] * p, it.r0[2] + it.spin[2] * p); qq.setFromEuler(ee);
        ss.set(sc, sc * (0.6 + it.h), sc); m4.compose(pp.set(it.x, y, it.z), qq, ss);
        chunks.setMatrixAt(i, m4);
      }
      chunks.instanceMatrix.needsUpdate = true;
      if (after > 3) crackMat.opacity = Math.max(0, 0.92 * (1 - (after - 3) / 2.5));   // 자국은 3초 뒤부터 서서히 사라짐
      for (const p of puffs) {
        if (p.t > 2) continue;
        p.t += dt; const k = p.t / 1.4;
        p.m.position.x += p.vx * dt; p.m.position.z += p.vz * dt; p.m.position.y = p.m.userData.y0 + 1.6 * k;
        p.m.scale.setScalar(p.r * (0.6 + 2.2 * k)); p.m.material.opacity = 0.5 * Math.max(0, 1 - k);
        if (k >= 1) p.m.visible = false;
      }
      if (after > 5.6) { impacted = false; c = null; chunks.visible = false; chunks.count = 0; if (crack) { scene.remove(crack); crack.geometry.dispose(); crack = null; } for (const p of puffs) p.m.visible = false; }
    }
  }
  return { start, cancel, update };
}
