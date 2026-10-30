import * as THREE from 'three';

// ============================================================
// 스킬 이펙트: "휩쓸기" — 검을 수평으로 휘두르며 흰 잔상이 남는 초승달 모양 (왼쪽 → 오른쪽)
//
// - 캐릭터 앞 반원을 따라 띠 모양 메시를 깔고, 정점 색(투명도)을 매 프레임 바꿔서 "검끝이 지나간 부분만" 보이게 함
//   (커스텀 셰이더 없이 기본 재질만 써서 어떤 기기에서도 동일하게 보이도록 함)
// - 레이어: ① 넓고 옅은 잔상 ② 어두운 줄기(검은색) ③ 밝은 메인 슬래시 ④ 가장자리 가는 빛줄기 + 파편(스파크)
// - 실제 피해 범위는 서버(goblin-ai.mjs SKILLS.sweep)가 정해요. 여기는 눈에 보이는 연출만.
// ============================================================

// ---------- 조정용 값 ----------
export const SWEEP_FX = {
  height: 1.55,        // 땅에서 이펙트까지 높이 (칼 휘두르는 높이)
  start: 0.10,         // 모션이 시작되고 검이 휘둘러지기 시작할 때까지(초) — weapon.js SWEEP_T.windup 과 비슷하게
  swing: 0.16,         // 검이 반원을 지나가는 시간(초) — 작을수록 빠름
  life: 0.85,          // 이펙트 전체 수명(초). 휘두른 뒤 잔상이 사라지는 시간 포함
  arc: 1.75,           // 좌우 각도(라디안). 앞을 기준으로 ±이만큼 (1.75 ≈ ±100°)
  radius: 2.7,         // 띠 중심 반지름
  sparks: 34           // 파편 개수
};

const SEG = 64;
const ease = (x) => { x = Math.min(1, Math.max(0, x)); return 1 - Math.pow(1 - x, 2.2); };   // 빠르게 시작해서 끝에서 느려짐
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 레이어 정의 (아래에서 위로 겹침). additive = 빛처럼 더해짐(밝게), 아니면 일반 겹침(어두운 색)
const LAYERS = [
  { hw: 1.05, rOff: 0,     yOff: -0.06, color: [1, 1, 1],          alpha: 0.55, trail: 1.25, core: 0.0, additive: true,  order: 1 },
  { hw: 0.26, rOff: -0.45, yOff: 0.02,  color: [0.03, 0.03, 0.05], alpha: 0.85, trail: 0.80, core: 0.0, additive: false, order: 2 },
  { hw: 0.15, rOff: 0.55,  yOff: 0.04,  color: [0.03, 0.03, 0.05], alpha: 0.75, trail: 0.65, core: 0.0, additive: false, order: 2 },
  { hw: 0.62, rOff: 0.06,  yOff: 0.0,   color: [0.92, 0.95, 1.0],  alpha: 1.00, trail: 0.65, core: 1.0, additive: true,  order: 3 },
  { hw: 0.10, rOff: 1.00,  yOff: 0.06,  color: [1, 1, 1],          alpha: 1.00, trail: 0.50, core: 1.0, additive: true,  order: 4 },
];

// 초승달 띠 (로컬: 앞 = +Z, 왼쪽 = +X, 위 = +Y). t = 0 이 왼쪽 끝, 1 이 오른쪽 끝 → 왼쪽에서 오른쪽으로 베는 방향
function buildLayer(L) {
  const n = (SEG + 1) * 3;   // 띠 폭 방향으로 정점 3개 (왼쪽 가장자리 / 가운데 / 오른쪽 가장자리) → 가운데가 밝고 가장자리가 투명해짐
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), aT = new Float32Array(n), aW = new Float32Array(n);
  const idx = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const th = SWEEP_FX.arc - 2 * SWEEP_FX.arc * t;
    const s = Math.sin(Math.PI * t);
    const c = SWEEP_FX.radius + 0.45 * s + L.rOff;
    const half = (0.10 + 0.90 * Math.pow(s, 0.75)) * L.hw;      // 양끝은 가늘고 가운데가 두꺼운 초승달
    const y = L.yOff + 0.30 * s;
    for (let k = 0; k < 3; k++) {
      const w = k - 1;
      const r = c + w * half;
      const v = i * 3 + k;
      pos[v * 3] = Math.sin(th) * r; pos[v * 3 + 1] = y; pos[v * 3 + 2] = Math.cos(th) * r;
      aT[v] = t; aW[v] = w;
      col[v * 4] = L.color[0]; col[v * 4 + 1] = L.color[1]; col[v * 4 + 2] = L.color[2]; col[v * 4 + 3] = 0;
    }
    if (i < SEG) { const a = i * 3; idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));   // RGBA (A = 투명도)
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    blending: L.additive ? THREE.AdditiveBlending : THREE.NormalBlending
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 10 + L.order;
  mesh.frustumCulled = false;
  return { L, mesh, geo: g, mat, aT, aW };
}

export function createSkillFx(scene) {
  const active = [];

  function play(id, x, y, z, ry) {
    if (id !== 'sweep') return;
    const group = new THREE.Group();
    group.position.set(x, y + SWEEP_FX.height, z);
    group.rotation.y = ry;
    const layers = LAYERS.map(buildLayer);
    for (const l of layers) group.add(l.mesh);

    // 파편: 검끝이 지나가는 순간 바깥쪽으로 튀어 나감
    const N = SWEEP_FX.sparks;
    const sp = [];
    const arr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const th = (Math.random() * 2 - 1) * SWEEP_FX.arc * 0.95;
      const r = SWEEP_FX.radius + 0.4 + Math.random() * 1.2;
      sp.push({
        t: (SWEEP_FX.arc - th) / (2 * SWEEP_FX.arc),   // 이 위치(0~1)를 검끝이 지날 때 나타남
        x: Math.sin(th) * r, y: (Math.random() - 0.3) * 0.5, z: Math.cos(th) * r,
        vx: Math.sin(th) * (1.0 + Math.random() * 2.2), vy: 0.5 + Math.random() * 1.6, vz: Math.cos(th) * (1.0 + Math.random() * 2.2)
      });
      arr[i * 3 + 1] = -999;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const pm = new THREE.PointsMaterial({ color: 0xffffff, size: 0.2, transparent: true, depthWrite: false, opacity: 1, blending: THREE.AdditiveBlending, fog: false });
    const pts = new THREE.Points(pg, pm);
    pts.frustumCulled = false;
    pts.renderOrder = 20;
    group.add(pts);

    scene.add(group);
    active.push({ group, layers, sp, pg, pm, t: 0 });
  }

  function update(dt) {
    for (let i = active.length - 1; i >= 0; i--) {
      const e = active[i];
      e.t += dt;
      const t = e.t;
      const head = t < SWEEP_FX.start ? -0.2 : ease((t - SWEEP_FX.start) / SWEEP_FX.swing) * 1.04;   // 검끝 위치 (0 = 왼쪽 끝, 1 = 오른쪽 끝)
      const fade = 1 - smooth(0.35, SWEEP_FX.life, t);

      for (const l of e.layers) {
        const col = l.geo.attributes.color, a = col.array, L = l.L;
        for (let v = 0; v < l.aT.length; v++) {
          const behind = head - l.aT[v];
          let alpha = 0;
          if (behind >= 0) {
            const body = 1 - smooth(0, L.trail, behind);                 // 검끝에서 멀수록 옅어짐
            const edge = 1 - smooth(0.30, 1.0, Math.abs(l.aW[v]));       // 띠 가장자리는 부드럽게
            const lead = 0.6 + 0.4 * smooth(0, 0.05, behind);            // 검끝 바로 앞은 살짝 약하게
            alpha = L.alpha * body * edge * fade * lead;
            if (L.core > 0) {   // 가운데를 더 하얗게
              const core = 1 - smooth(0, 0.55, Math.abs(l.aW[v]));
              const k = core * L.core;
              a[v * 4] = L.color[0] + (1 - L.color[0]) * k;
              a[v * 4 + 1] = L.color[1] + (1 - L.color[1]) * k;
              a[v * 4 + 2] = L.color[2] + (1 - L.color[2]) * k;
            }
          }
          a[v * 4 + 3] = alpha;
        }
        col.needsUpdate = true;
      }

      // 파편
      const pos = e.pg.attributes.position.array;
      for (let k = 0; k < e.sp.length; k++) {
        const s = e.sp[k];
        const age = t - (SWEEP_FX.start + SWEEP_FX.swing * s.t);
        if (head < s.t || age < 0) { pos[k * 3 + 1] = -999; continue; }
        pos[k * 3] = s.x + s.vx * age;
        pos[k * 3 + 1] = s.y + s.vy * age - 2.2 * age * age;
        pos[k * 3 + 2] = s.z + s.vz * age;
      }
      e.pg.attributes.position.needsUpdate = true;
      e.pm.opacity = Math.max(0, 1 - smooth(0.4, SWEEP_FX.life, t));

      if (t >= SWEEP_FX.life) {
        scene.remove(e.group);
        for (const l of e.layers) { l.geo.dispose(); l.mat.dispose(); }
        e.pg.dispose(); e.pm.dispose();
        active.splice(i, 1);
      }
    }
  }

  return { play, update };
}
