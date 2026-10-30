import * as THREE from 'three';

// ============================================================
// 스킬 이펙트: "휩쓸기" — 검을 수평으로 휘두르며 흰 잔상이 남는 초승달 모양
//
// - 캐릭터 앞 반원(오른쪽 → 왼쪽)을 따라 띠 모양 메시를 깔고, 셰이더로 "검끝이 지나간 부분만" 보이게 해서 휘두르는 느낌을 냄
// - 레이어: ① 넓고 옅은 잔상 ② 어두운 줄기(검은색) ③ 밝은 메인 슬래시 ④ 가장자리 가는 빛줄기 + 파편(스파크)
// - 지오메트리는 모두 공유하고, 재질만 효과마다 복제 (끝나면 정리)
// - 실제 피해 범위는 서버(goblin-ai.mjs SKILLS.sweep)가 정해요. 여기는 눈에 보이는 연출만.
// ============================================================

// ---------- 조정용 값 ----------
export const SWEEP_FX = {
  height: 1.55,        // 땅에서 이펙트까지 높이 (칼 휘두르는 높이)
  start: 0.18,         // 모션이 시작되고 검이 휘둘러지기 시작할 때까지(초) — weapon.js SWEEP_T.windup 과 맞춤
  swing: 0.28,         // 검이 반원을 지나가는 시간(초)
  life: 1.15,          // 이펙트 전체 수명(초). 휘두른 뒤 잔상이 사라지는 시간 포함
  arc: 1.75,           // 좌우 각도(라디안). 앞을 기준으로 ±이만큼 (1.75 ≈ ±100°)
  radius: 2.7,         // 띠 중심 반지름
  sparks: 34           // 파편 개수
};

const SEG = 72;

const VERT = /* glsl */`
attribute float aT;
attribute float aW;
varying float vT;
varying float vW;
void main() {
  vT = aT; vW = aW;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
uniform float uHead;    // 검끝 위치 (0 = 오른쪽 끝, 1 = 왼쪽 끝)
uniform float uFade;    // 전체 투명도
uniform float uAlpha;
uniform float uTrail;   // 잔상 길이 (클수록 꼬리가 길게 남음)
uniform vec3 uColor;
uniform float uCore;    // 가운데를 더 밝게
varying float vT;
varying float vW;
void main() {
  float behind = uHead - vT;
  if (behind < 0.0) discard;
  float body = 1.0 - smoothstep(0.0, uTrail, behind);
  float edge = 1.0 - smoothstep(0.30, 1.0, abs(vW));
  float core = 1.0 - smoothstep(0.0, 0.55, abs(vW));
  float lead = smoothstep(0.0, 0.05, behind);          // 검끝 앞쪽은 살짝 부드럽게
  float a = uAlpha * body * edge * uFade * mix(0.6, 1.0, lead);
  vec3 c = mix(uColor, vec3(1.0), core * uCore);
  gl_FragColor = vec4(c, a);
}`;

// 초승달 띠 지오메트리 (로컬: 앞 = +Z, 왼쪽 = +X, 위 = +Y)
function crescent({ hw = 1, rOff = 0, yOff = 0, rise = 0.3 }) {
  const pos = [], aT = [], aW = [], idx = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const th = -SWEEP_FX.arc + 2 * SWEEP_FX.arc * t;
    const s = Math.sin(Math.PI * t);
    const c = SWEEP_FX.radius + 0.45 * s + rOff;
    const half = (0.10 + 0.90 * Math.pow(s, 0.75)) * hw;      // 양끝은 가늘고 가운데가 두꺼운 초승달
    const y = yOff + rise * s;
    for (const k of [-1, 1]) {
      const r = c + k * half;
      pos.push(Math.sin(th) * r, y, Math.cos(th) * r);
      aT.push(t); aW.push(k);
    }
    if (i < SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(aW, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// 레이어 정의 (아래에서 위로 겹침)
const LAYERS = [
  { name: 'ghost',  geo: { hw: 1.0,  rOff: 0,    yOff: -0.06, rise: 0.30 }, color: 0xffffff, alpha: 0.30, trail: 1.25, core: 0.0, order: 1 },
  { name: 'dark1',  geo: { hw: 0.24, rOff: -0.42, yOff: 0.02,  rise: 0.30 }, color: 0x07080c, alpha: 0.80, trail: 0.80, core: 0.0, order: 2 },
  { name: 'dark2',  geo: { hw: 0.14, rOff: 0.50,  yOff: 0.04,  rise: 0.30 }, color: 0x07080c, alpha: 0.70, trail: 0.65, core: 0.0, order: 2 },
  { name: 'main',   geo: { hw: 0.58, rOff: 0.06,  yOff: 0.0,   rise: 0.30 }, color: 0xf2f4ff, alpha: 1.00, trail: 0.60, core: 1.0, order: 3 },
  { name: 'streak', geo: { hw: 0.09, rOff: 0.95,  yOff: 0.06,  rise: 0.30 }, color: 0xffffff, alpha: 0.95, trail: 0.50, core: 1.0, order: 4 },
];

let shared = null;
function getShared() {
  if (shared) return shared;
  shared = LAYERS.map((L) => ({
    L,
    geo: crescent(L.geo),
    mat: new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        uHead: { value: -1 }, uFade: { value: 1 }, uAlpha: { value: L.alpha }, uTrail: { value: L.trail },
        uColor: { value: new THREE.Color(L.color) }, uCore: { value: L.core }
      }
    })
  }));
  return shared;
}

const ease = (x) => { x = Math.min(1, Math.max(0, x)); return 1 - Math.pow(1 - x, 2.2); };   // 빠르게 시작해서 끝에서 느려짐
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createSkillFx(scene) {
  const active = [];

  function play(id, x, y, z, ry) {
    if (id !== 'sweep') return;
    const layers = getShared();
    const group = new THREE.Group();
    group.position.set(x, y + SWEEP_FX.height, z);
    group.rotation.y = ry;
    const mats = [];
    for (const { L, geo, mat } of layers) {
      const m = mat.clone();
      m.uniforms = THREE.UniformsUtils.clone(mat.uniforms);
      mats.push(m);
      const mesh = new THREE.Mesh(geo, m);
      mesh.renderOrder = 10 + L.order;
      mesh.frustumCulled = false;
      group.add(mesh);
    }

    // 파편: 검끝이 지나가는 순간 바깥쪽으로 튀어 나감
    const N = SWEEP_FX.sparks;
    const sp = [];
    const arr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const th = (Math.random() * 2 - 1) * SWEEP_FX.arc * 0.95;
      const r = SWEEP_FX.radius + 0.4 + Math.random() * 1.2;
      sp.push({
        t: (th + SWEEP_FX.arc) / (2 * SWEEP_FX.arc),   // 이 위치(0~1)를 검끝이 지날 때 나타남
        x: Math.sin(th) * r, y: (Math.random() - 0.3) * 0.5, z: Math.cos(th) * r,
        vx: Math.sin(th) * (1.0 + Math.random() * 2.2), vy: 0.5 + Math.random() * 1.6, vz: Math.cos(th) * (1.0 + Math.random() * 2.2)
      });
      arr[i * 3 + 1] = -999;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const pm = new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, transparent: true, depthWrite: false, opacity: 1 });
    const pts = new THREE.Points(pg, pm);
    pts.frustumCulled = false;
    pts.renderOrder = 20;
    group.add(pts);

    scene.add(group);
    active.push({ group, mats, sp, pg, pm, t: 0 });
  }

  function update(dt) {
    for (let i = active.length - 1; i >= 0; i--) {
      const e = active[i];
      e.t += dt;
      const t = e.t;
      const head = t < SWEEP_FX.start ? -0.2 : ease((t - SWEEP_FX.start) / SWEEP_FX.swing) * 1.04;
      const fade = 1 - smooth(0.55, SWEEP_FX.life, t);
      for (const m of e.mats) { m.uniforms.uHead.value = head; m.uniforms.uFade.value = fade; }

      // 파편
      const pos = e.pg.attributes.position.array;
      let alive = 0;
      for (let k = 0; k < e.sp.length; k++) {
        const s = e.sp[k];
        if (head < s.t) { pos[k * 3 + 1] = -999; continue; }
        const age = t - (SWEEP_FX.start + SWEEP_FX.swing * s.t);
        if (age < 0) { pos[k * 3 + 1] = -999; continue; }
        pos[k * 3] = s.x + s.vx * age;
        pos[k * 3 + 1] = s.y + s.vy * age - 2.2 * age * age;
        pos[k * 3 + 2] = s.z + s.vz * age;
        alive++;
      }
      e.pg.attributes.position.needsUpdate = true;
      e.pm.opacity = Math.max(0, 1 - smooth(0.7, SWEEP_FX.life, t));

      if (t >= SWEEP_FX.life) {
        scene.remove(e.group);
        for (const m of e.mats) m.dispose();
        e.pg.dispose(); e.pm.dispose();
        active.splice(i, 1);
      }
    }
  }

  return { play, update };
}
