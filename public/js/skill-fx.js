import * as THREE from 'three';

// ============================================================
// 스킬 이펙트: "휩쓸기" — 검을 수평으로 휘두르며 흰 잔상이 남는 초승달 (왼쪽 → 오른쪽)
//
// 레이어 구성 (참고 콘셉트 이미지의 레이어 분리를 따름)
//   ① 넓고 옅은 잔상(빛)   ② 어두운 연기 줄기(검정, 일반 합성)   ③ 메인 슬래시(밝은 흰색 + 푸른 가장자리)
//   ④ 호 방향으로 흐르는 가는 빛줄기들   ⑤ 바닥에 긁힌 자국(어두운 흔적 + 가는 빛)
//   ⑥ 파편/스파크(둥글게 번쩍), 어두운 돌조각, 바닥에서 피어오르는 먼지
// - 띠에는 붓 터치 같은 줄무늬 텍스처(코드로 생성)를 입혀서 단색 띠보다 훨씬 거친 느낌을 냄
// - 투명도는 정점 색의 알파를 매 프레임 바꿔서 "검끝이 지나간 부분만" 보이게 함 (커스텀 셰이더 없음)
// - 실제 피해 범위는 서버(goblin-ai.mjs SKILLS.sweep)가 정해요. 여기는 눈에 보이는 연출만.
// ============================================================

// ---------- 조정용 값 ----------
export const SWEEP_FX = {
  height: 1.55,        // 땅에서 이펙트까지 높이 (칼 휘두르는 높이)
  start: 0.10,         // 모션이 시작되고 검이 휘둘러지기 시작할 때까지(초) — weapon.js SWEEP_T.windup 과 비슷하게
  swing: 0.16,         // 검이 반원을 지나가는 시간(초) — 작을수록 빠름
  life: 1.0,           // 이펙트 전체 수명(초). 휘두른 뒤 잔상이 사라지는 시간 포함
  arc: 1.75,           // 좌우 각도(라디안). 앞을 기준으로 ±이만큼 (1.75 ≈ ±100°)
  radius: 2.7,         // 띠 중심 반지름
  tilt: 0.28,          // 호가 오른쪽으로 갈수록 올라가는 정도 (살짝 기울어진 궤적)
  sparks: 56,          // 스파크 개수
  dust: 16,            // 먼지 개수
  debris: 12           // 어두운 돌조각 개수
};

const SEG = 64;
const ease = (x) => { x = Math.min(1, Math.max(0, x)); return 1 - Math.pow(1 - x, 2.2); };   // 빠르게 시작해서 끝에서 느려짐
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- 텍스처 (코드로 생성, 한 번만) ----------
let TEX = null;
function textures() {
  if (TEX) return TEX;
  TEX = { slash: null, dot: null };
  if (typeof document === 'undefined') return TEX;

  // 붓 터치 줄무늬: 가로(호 방향)로 길게 흐르는 줄, 세로(폭 방향)로 가운데가 진하고 가장자리가 거칠게 찢어짐
  {
    const W = 256, H = 64, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d'), img = ctx.createImageData(W, H);
    const rows = [];
    for (let y = 0; y < H; y++) rows.push({ ph: Math.random() * 6.28, f1: rnd(0.02, 0.07), f2: rnd(0.08, 0.2), g: rnd(0.55, 1.0) });
    for (let y = 0; y < H; y++) {
      const v = y / (H - 1), mid = 1 - Math.abs(2 * v - 1);   // 가운데 1, 가장자리 0
      const R = rows[y];
      for (let x = 0; x < W; x++) {
        const n = 0.5 + 0.5 * Math.sin(x * R.f1 + R.ph) * Math.sin(x * R.f2 + R.ph * 1.7);   // 줄 방향 얼룩
        const rag = (Math.random() - 0.5) * 0.18;                                               // 거친 가장자리
        let a = smooth(0.0, 0.55, mid + rag + (n - 0.5) * 0.35) * (0.55 + 0.45 * n) * R.g;
        if (Math.random() < 0.012) a *= 0.2;                                                    // 군데군데 구멍
        const i = (y * W + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(Math.min(1, a * 1.15) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    TEX.slash = new THREE.CanvasTexture(c);
  }
  // 둥근 빛 점 (스파크·먼지용)
  {
    const S = 64, c = document.createElement('canvas');
    c.width = S; c.height = S;
    const ctx = c.getContext('2d'), g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    TEX.dot = new THREE.CanvasTexture(c);
  }
  return TEX;
}

// ---------- 레이어 정의 (아래에서 위로 겹침) ----------
// hw 폭 배율 / rOff 반지름 이동 / yOff 높이 이동 / tilt 기울기 배율 / color 색 / alpha 진하기 / trail 꼬리 길이 / core 가운데 하얗게 / additive 빛처럼 더하기
const WHITE = [1, 1, 1], BLUE = [0.80, 0.90, 1.0], BLACK = [0.02, 0.02, 0.04];
const LAYERS = [
  { hw: 1.10, rOff: 0.00, yOff: -0.06, tilt: 1, color: BLUE,  alpha: 0.42, trail: 1.40, core: 0.0, additive: true,  order: 1 },   // 넓은 푸른빛 잔상
  { hw: 0.55, rOff: -0.40, yOff: 0.02, tilt: 1, color: BLACK, alpha: 0.80, trail: 1.00, core: 0.0, additive: false, order: 2 },   // 어두운 연기 줄기 (안쪽)
  { hw: 0.32, rOff: 0.70,  yOff: 0.04, tilt: 1, color: BLACK, alpha: 0.75, trail: 0.80, core: 0.0, additive: false, order: 2 },   // 어두운 줄기 (바깥쪽)
  { hw: 0.80, rOff: 0.05,  yOff: 0.00, tilt: 1, color: BLUE,  alpha: 0.80, trail: 0.95, core: 0.6, additive: true,  order: 3 },   // 메인 바깥 (푸른 가장자리)
  { hw: 0.46, rOff: 0.08,  yOff: 0.00, tilt: 1, color: WHITE, alpha: 1.00, trail: 0.65, core: 1.0, additive: true,  order: 4 },   // 메인 중심 (가장 밝음)
  { hw: 0.07, rOff: 1.05,  yOff: 0.07, tilt: 1, color: WHITE, alpha: 1.00, trail: 0.45, core: 1.0, additive: true,  order: 5 },   // 가는 빛줄기 1
  { hw: 0.06, rOff: -0.95, yOff: -0.02, tilt: 1, color: WHITE, alpha: 0.90, trail: 0.55, core: 1.0, additive: true,  order: 5 },  // 가는 빛줄기 2
  { hw: 0.05, rOff: 1.50,  yOff: 0.12, tilt: 1, color: WHITE, alpha: 0.85, trail: 0.70, core: 1.0, additive: true,  order: 5 },   // 가는 빛줄기 3 (멀리)
  // 바닥 긁힌 자국 (발밑 높이로 내려서 깔림)
  { hw: 0.70, rOff: -0.55, yOff: -SWEEP_FX.height + 0.07, tilt: 0, rise: 0, color: [0.10, 0.10, 0.12], alpha: 0.60, trail: 1.20, core: 0.0, additive: false, order: 0 },
  { hw: 0.14, rOff: -0.55, yOff: -SWEEP_FX.height + 0.09, tilt: 0, rise: 0, color: WHITE, alpha: 0.65, trail: 0.80, core: 1.0, additive: true,  order: 0 },
];

// 초승달 띠 (로컬: 앞 = +Z, 왼쪽 = +X, 위 = +Y). t = 0 이 왼쪽 끝, 1 이 오른쪽 끝 → 왼쪽에서 오른쪽으로 베는 방향
function buildLayer(L) {
  const n = (SEG + 1) * 3;   // 띠 폭 방향으로 정점 3개 (가장자리 / 가운데 / 가장자리)
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), uv = new Float32Array(n * 2), aT = new Float32Array(n), aW = new Float32Array(n);
  const idx = [];
  const rise = L.rise === undefined ? 0.30 : L.rise;
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const th = SWEEP_FX.arc - 2 * SWEEP_FX.arc * t;
    const s = Math.sin(Math.PI * t);
    const c = SWEEP_FX.radius + 0.45 * s + L.rOff;
    const half = (0.10 + 0.90 * Math.pow(s, 0.75)) * L.hw;      // 양끝은 가늘고 가운데가 두꺼운 초승달
    const y = L.yOff + rise * s + SWEEP_FX.tilt * L.tilt * (t - 0.5);
    for (let k = 0; k < 3; k++) {
      const w = k - 1;
      const r = c + w * half;
      const v = i * 3 + k;
      pos[v * 3] = Math.sin(th) * r; pos[v * 3 + 1] = y; pos[v * 3 + 2] = Math.cos(th) * r;
      uv[v * 2] = t; uv[v * 2 + 1] = (w + 1) / 2;
      aT[v] = t; aW[v] = w;
      col[v * 4] = L.color[0]; col[v * 4 + 1] = L.color[1]; col[v * 4 + 2] = L.color[2]; col[v * 4 + 3] = 0;
    }
    if (i < SEG) { const a = i * 3; idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));   // RGBA (A = 투명도)
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    map: textures().slash || null,
    blending: L.additive ? THREE.AdditiveBlending : THREE.NormalBlending
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 10 + L.order;
  mesh.frustumCulled = false;
  return { L, mesh, geo: g, mat, aT, aW };
}

function makePoints(N, size, color, additive, map) {
  const arr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) arr[i * 3 + 1] = -999;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const m = new THREE.PointsMaterial({ color, size, transparent: true, depthWrite: false, opacity: 1, fog: false, map: map || null, alphaTest: map ? 0 : 0, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return { pts: p, geo: g, mat: m, arr };
}


// ============================================================
// 대쉬 이펙트: 지나온 길에 남는 속도선(빛줄기) + 출발점 충격 고리 + 먼지
// 로컬 좌표: 원점 = 출발 위치(발밑), +Z = 대쉬 방향
// ============================================================
export const DASH_FX = {
  dist: 5,            // 대쉬 거리 (main.js DASH.dist 와 같게)
  time: 0.18,         // 대쉬 시간(초) (main.js DASH.time 과 같게)
  life: 0.55,         // 이펙트 전체 수명(초)
  streaks: [          // 속도선: 높이, 좌우 위치, 굵기, 꼬리 길이, 색
    { y: 0.30, x: -0.55, rot: 0.5, w: 0.060, trail: 0.85, color: [0.85, 0.93, 1.0] },
    { y: 0.80, x:  0.45, rot: -0.7, w: 0.080, trail: 1.00, color: [1, 1, 1] },
    { y: 1.30, x: -0.35, rot: 1.0, w: 0.090, trail: 0.90, color: [1, 1, 1] },
    { y: 1.80, x:  0.50, rot: -0.4, w: 0.070, trail: 0.80, color: [0.85, 0.93, 1.0] },
    { y: 2.20, x: -0.10, rot: 0.9, w: 0.050, trail: 0.70, color: [1, 1, 1] },
    { y: 1.05, x:  0.00, rot: 0.0, w: 0.140, trail: 0.55, color: [1, 1, 1] }
  ],
  dust: 12
};
const dashProfile = (u) => { u = Math.min(1, Math.max(0, u)); return u * (1.4 - 0.4 * u); };   // main.js 의 대쉬 이동 곡선과 같음

function buildStreak(S) {
  const SEGS = 18, n = (SEGS + 1) * 3;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), uv = new Float32Array(n * 2), aT = new Float32Array(n), aW = new Float32Array(n);
  const idx = [];
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    const half = S.w * 1.4 * (0.25 + 0.75 * t);   // 출발점 쪽은 가늘고 앞쪽(캐릭터 쪽)이 굵음
    for (let k = 0; k < 3; k++) {
      const w = k - 1, v = i * 3 + k;
      pos[v * 3] = S.x + w * half * Math.cos(S.rot); pos[v * 3 + 1] = S.y + w * half * Math.sin(S.rot); pos[v * 3 + 2] = t * DASH_FX.dist;
      uv[v * 2] = t; uv[v * 2 + 1] = (w + 1) / 2;
      aT[v] = t; aW[v] = w;
      col[v * 4] = S.color[0]; col[v * 4 + 1] = S.color[1]; col[v * 4 + 2] = S.color[2]; col[v * 4 + 3] = 0;
    }
    if (i < SEGS) { const a = i * 3; idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  // 선이 얇아서 옆에서 보면 안 보이지 않게, 위아래(Y)로도 살짝 넓힌 십자 형태는 생략하고 양면 + 가산 합성으로 처리
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, map: textures().slash || null, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(g, mat);
  mesh.rotation.z = 0;
  mesh.renderOrder = 14;
  mesh.frustumCulled = false;
  return { S, mesh, geo: g, mat, aT, aW };
}

export function createSkillFx(scene) {
  const active = [];
  const H = SWEEP_FX.height, A = SWEEP_FX.arc;

  function play(id, x, y, z, ry) {
    if (id !== 'sweep') return;
    const tex = textures();
    const group = new THREE.Group();
    group.position.set(x, y + H, z);
    group.rotation.y = ry;
    const layers = LAYERS.map(buildLayer);
    for (const l of layers) group.add(l.mesh);

    // 스파크: 검끝이 지나가는 순간 바깥으로 튀어 오름
    const sparks = makePoints(SWEEP_FX.sparks, 0.24, 0xffffff, true, tex.dot);
    const sp = [];
    for (let i = 0; i < SWEEP_FX.sparks; i++) {
      const th = rnd(-A, A) * 0.95, r = SWEEP_FX.radius + rnd(-0.4, 1.6);
      sp.push({ t: (A - th) / (2 * A), x: Math.sin(th) * r, y: rnd(-0.3, 0.5), z: Math.cos(th) * r,
        vx: Math.sin(th) * rnd(1.0, 3.4), vy: rnd(0.4, 2.0), vz: Math.cos(th) * rnd(1.0, 3.4) });
    }
    // 어두운 돌조각
    const debris = makePoints(SWEEP_FX.debris, 0.22, 0x17171c, false, null);
    const db = [];
    for (let i = 0; i < SWEEP_FX.debris; i++) {
      const th = rnd(-A, A) * 0.9, r = SWEEP_FX.radius + rnd(-0.6, 0.9);
      db.push({ t: (A - th) / (2 * A), x: Math.sin(th) * r, y: -H + 0.2, z: Math.cos(th) * r,
        vx: Math.sin(th) * rnd(1.2, 3.0), vy: rnd(2.0, 4.2), vz: Math.cos(th) * rnd(1.2, 3.0) });
    }
    // 바닥 먼지: 천천히 피어올라 커지면서 사라짐
    const dust = makePoints(SWEEP_FX.dust, 1.0, 0xb9bec4, false, tex.dot);
    const du = [];
    for (let i = 0; i < SWEEP_FX.dust; i++) {
      const th = rnd(-A, A) * 0.9, r = SWEEP_FX.radius + rnd(-1.0, 0.8);
      du.push({ t: (A - th) / (2 * A), x: Math.sin(th) * r, y: -H + 0.25, z: Math.cos(th) * r,
        vx: Math.sin(th) * rnd(0.2, 0.9), vy: rnd(0.15, 0.5), vz: Math.cos(th) * rnd(0.2, 0.9) });
    }
    for (const p of [dust, debris, sparks]) { p.pts.renderOrder = 9; group.add(p.pts); }
    sparks.pts.renderOrder = 20;

    scene.add(group);
    active.push({ group, layers, sparks, sp, debris, db, dust, du, t: 0 });
  }

  // 입자 위치 갱신 (검끝이 지난 뒤부터 나타남)
  function stepParticles(P, list, head, t, gravity) {
    const a = P.arr;
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      const age = t - (SWEEP_FX.start + SWEEP_FX.swing * s.t);
      if (head < s.t || age < 0) { a[k * 3 + 1] = -999; continue; }
      a[k * 3] = s.x + s.vx * age;
      a[k * 3 + 1] = s.y + s.vy * age - gravity * age * age;
      a[k * 3 + 2] = s.z + s.vz * age;
    }
    P.geo.attributes.position.needsUpdate = true;
  }


  // ---------- 대쉬 ----------
  const dashes = [];
  function playDash(x, y, z, dx, dz) {
    const tex = textures();
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = Math.atan2(dx, dz);   // 로컬 +Z = 대쉬 방향
    const streaks = DASH_FX.streaks.map(buildStreak);
    for (const s of streaks) group.add(s.mesh);

    // 출발점 충격 고리 (땅에 깔려서 퍼지며 사라짐)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xdfe9ff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.8, 32), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    ring.renderOrder = 13;
    ring.frustumCulled = false;
    group.add(ring);

    // 먼지: 출발점에서 뒤쪽과 옆으로 퍼짐
    const N = DASH_FX.dust, arr = new Float32Array(N * 3), du = [];
    for (let i = 0; i < N; i++) {
      const a = rnd(-1, 1);
      du.push({ x: rnd(-0.5, 0.5), y: 0.2, z: rnd(-0.3, 0.4), vx: a * rnd(0.6, 1.6), vy: rnd(0.3, 0.9), vz: -rnd(0.6, 2.4) });
      arr[i * 3 + 1] = -999;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const dm = new THREE.PointsMaterial({ color: 0xc9cdd2, size: 0.8, transparent: true, depthWrite: false, opacity: 0.5, fog: false, map: tex.dot || null });
    const dp = new THREE.Points(dg, dm);
    dp.frustumCulled = false;
    dp.renderOrder = 9;
    group.add(dp);

    scene.add(group);
    dashes.push({ group, streaks, ring, ringMat, dg, dm, du, arr, t: 0 });
  }

  function updateDashes(dt) {
    for (let i = dashes.length - 1; i >= 0; i--) {
      const e = dashes[i];
      e.t += dt;
      const t = e.t, life = DASH_FX.life;
      const head = dashProfile(t / DASH_FX.time) * 1.03;    // 캐릭터가 지나간 지점까지만 선이 보임
      const fade = 1 - smooth(0.10, life, t);
      for (const s of e.streaks) {
        const a = s.geo.attributes.color.array, trail = s.S.trail;
        for (let v = 0; v < s.aT.length; v++) {
          const behind = head - s.aT[v];
          let alpha = 0;
          if (behind >= 0) {
            const body = 1 - smooth(0, trail, behind);
            const edge = 1 - smooth(0.2, 1.0, Math.abs(s.aW[v]));
            alpha = 0.9 * body * edge * fade;
          }
          a[v * 4 + 3] = alpha;
        }
        s.geo.attributes.color.needsUpdate = true;
      }
      const rs = 1 + 3.2 * ease(t / 0.35);
      e.ring.scale.set(rs, rs, 1);
      e.ringMat.opacity = 0.7 * (1 - smooth(0, 0.35, t));
      const pa = e.arr;
      for (let k = 0; k < e.du.length; k++) {
        const d = e.du[k];
        if (t < 0.02) { pa[k * 3 + 1] = -999; continue; }
        pa[k * 3] = d.x + d.vx * t; pa[k * 3 + 1] = d.y + d.vy * t; pa[k * 3 + 2] = d.z + d.vz * t;
      }
      e.dg.attributes.position.needsUpdate = true;
      e.dm.size = 0.6 + 1.4 * smooth(0, life, t);
      e.dm.opacity = 0.5 * (1 - smooth(0.1, life, t));
      if (t >= life) {
        scene.remove(e.group);
        for (const s of e.streaks) { s.geo.dispose(); s.mat.dispose(); }
        e.ring.geometry.dispose(); e.ringMat.dispose(); e.dg.dispose(); e.dm.dispose();
        dashes.splice(i, 1);
      }
    }
  }

  function update(dt) {
    updateDashes(dt);
    for (let i = active.length - 1; i >= 0; i--) {
      const e = active[i];
      e.t += dt;
      const t = e.t, life = SWEEP_FX.life;
      const head = t < SWEEP_FX.start ? -0.2 : ease((t - SWEEP_FX.start) / SWEEP_FX.swing) * 1.04;   // 검끝 위치 (0 = 왼쪽 끝, 1 = 오른쪽 끝)
      const fade = 1 - smooth(0.38, life, t);

      for (const l of e.layers) {
        const col = l.geo.attributes.color, a = col.array, L = l.L;
        for (let v = 0; v < l.aT.length; v++) {
          const behind = head - l.aT[v];
          let alpha = 0;
          if (behind >= 0) {
            const body = 1 - smooth(0, L.trail, behind);                 // 검끝에서 멀수록 옅어짐
            const edge = 1 - smooth(0.25, 1.0, Math.abs(l.aW[v]));       // 띠 가장자리는 부드럽게
            const lead = 0.55 + 0.45 * smooth(0, 0.04, behind);          // 검끝 바로 앞은 살짝 약하게
            alpha = L.alpha * body * edge * fade * lead;
            if (L.core > 0) {   // 가운데를 더 하얗게
              const k = (1 - smooth(0, 0.6, Math.abs(l.aW[v]))) * L.core;
              a[v * 4] = L.color[0] + (1 - L.color[0]) * k;
              a[v * 4 + 1] = L.color[1] + (1 - L.color[1]) * k;
              a[v * 4 + 2] = L.color[2] + (1 - L.color[2]) * k;
            }
          }
          a[v * 4 + 3] = alpha;
        }
        col.needsUpdate = true;
      }

      stepParticles(e.sparks, e.sp, head, t, 2.4);
      e.sparks.mat.opacity = Math.max(0, 1 - smooth(0.35, life, t));
      stepParticles(e.debris, e.db, head, t, 9.0);
      e.debris.mat.opacity = Math.max(0, 1 - smooth(0.45, life * 0.95, t));
      stepParticles(e.dust, e.du, head, t, -0.2);
      e.dust.mat.size = 0.7 + 1.6 * smooth(SWEEP_FX.start, life, t);   // 먼지는 점점 커짐
      e.dust.mat.opacity = 0.45 * (1 - smooth(0.3, life, t));

      if (t >= life) {
        scene.remove(e.group);
        for (const l of e.layers) { l.geo.dispose(); l.mat.dispose(); }
        for (const P of [e.sparks, e.debris, e.dust]) { P.geo.dispose(); P.mat.dispose(); }
        active.splice(i, 1);
      }
    }
  }

  return { play, playDash, update };
}
