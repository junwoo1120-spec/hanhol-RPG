// 골렘 (화면에 그리는 부분): 블록형 돌 거인 모델 + 모션(대기·걷기·달리기·공격·피격·쓰러짐) + 서버 상태 따라가기
//
// - 모델은 전부 코드로 만들어요 (이미지·glTF 파일 없음). 각 덩어리는 모서리를 한 단계 깎은 "계단식 블록"이고,
//   돌 색(푸른 회색 + 얼룩), 이끼, 빛나는 금 가는 줄무늬, 머리 앞의 빛나는 십자 코어로 꾸며요.
// - 부위(뼈대)마다 지오메트리를 하나로 합쳐서 골렘 한 마리가 메시 14개 정도예요. 지오메트리는 모든 골렘이 같이 써요.
// - 위치·추적·공격·체력은 서버(server.js + golem-ai.mjs)가 정하고, 여기서는 서버가 보낸 목록을 부드럽게 따라가며 그려요.
// - 크기·체력 같은 설정값은 golem-ai.mjs 맨 위 GOLEM 에 있어요.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GOLEM } from './golem-ai.mjs';

function h32(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const TAU = Math.PI * 2;
const sm01 = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// ================= 색 =================
const COL = {
  base: 0x2e3344, mid: 0x262a39, light: 0x424a5f, dark: 0x1a1d29, joint: 0x10121a,
  moss: 0x3b5a3a, mossDark: 0x2a4430, rust: 0x3a3030,
  crack: 0x8aeaff, core: 0xe6fbff, recess: 0x07090f,
};
const CORE_BASE = new THREE.Color(COL.core);

const V3 = THREE.Vector3, M4 = THREE.Matrix4, Q = THREE.Quaternion;
const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return c.getHex(); };
function box(p, s) {
  const g = new THREE.BoxGeometry(s[0], s[1], s[2]);
  g.applyMatrix4(new M4().compose(new V3(...p), new Q(), new V3(1, 1, 1)));
  return g;
}

class BoneDef {
  constructor(name, parent, pivot) { this.name = name; this.parent = parent; this.pivot = pivot; this.parts = []; this.glow = []; this.geo = null; this.glowGeo = null; }
  add(geo, color, jit = 0.004) { this.parts.push({ geo, color, jit }); return this; }
  addGlow(geo, color) { this.glow.push({ geo, color }); return this; }
  // 모서리를 한 단계 깎은 블록 = 서로 어긋난 상자 3개를 겹친 것 (살짝씩 크기를 달리해서 면이 겹쳐 깜빡이지 않게)
  chunk(c, s, col, b = 0.045) {
    const [w, h, d] = s;
    return this
      .add(box(c, [w, h - 2 * b, d - 2 * b]), col)
      .add(box(c, [w - 2 * b - 0.004, h, d - 2 * b - 0.004]), shade(col, 1.14))
      .add(box(c, [w - 2 * b - 0.008, h - 2 * b - 0.008, d]), shade(col, 0.9));
  }
  bake() {
    const list = [], H = 2.4;
    this.parts.forEach(({ geo, color, jit }, pi) => {
      const g = geo.toNonIndexed();
      const p = g.attributes.position, q = (n) => Math.round(n * 3000);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (jit > 0) p.setXYZ(i, x + (h32(q(x), q(y), q(z)) - 0.5) * 2 * jit, y + (h32(q(y), q(z), q(x) + 7) - 0.5) * 2 * jit, z + (h32(q(z), q(x), q(y) + 13) - 0.5) * 2 * jit);
      }
      g.translate(-this.pivot[0], -this.pivot[1], -this.pivot[2]);
      g.computeVertexNormals();
      // 덩어리마다 색을 조금씩 다르게 + 아래쪽일수록 어둡게 (바닥 그늘)
      const cc = new THREE.Color(color), n = p.count, arr = new Float32Array(n * 3);
      const tint = 0.9 + 0.2 * h32(pi, this.name.length, 91), bl = (h32(pi, 7, 92) - 0.5) * 0.06;
      for (let i = 0; i < n; i++) {
        const wy = p.getY(i) + this.pivot[1];
        const k = (0.74 + 0.26 * Math.min(1, Math.max(0, wy / H))) * tint;
        arr[i * 3] = cc.r * k * (1 - bl); arr[i * 3 + 1] = cc.g * k; arr[i * 3 + 2] = cc.b * k * (1 + bl);
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      g.deleteAttribute('uv');
      list.push(g);
    });
    this.geo = mergeGeometries(list, false);
    if (this.glow.length) {
      const gl = this.glow.map(({ geo, color }) => {
        const g = geo.toNonIndexed(); g.translate(-this.pivot[0], -this.pivot[1], -this.pivot[2]);
        const cc = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i * 3] = cc.r; arr[i * 3 + 1] = cc.g; arr[i * 3 + 2] = cc.b; }
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); g.deleteAttribute('uv'); g.deleteAttribute('normal');
        return g;
      });
      this.glowGeo = mergeGeometries(gl, false);
    }
    return this;
  }
}

let TEMPLATE = null, MAT = null, MAT_HIT = null, GLOW_MAT = null, LOD_GEO = null, LOD_GLOW = null, GLOW_TEX = null;

// 모든 좌표는 "발바닥 중앙이 (0,0,0), 앞쪽이 +z, 위쪽이 +y" 인 몸 기준이에요. 키 약 2.3 (× SCALE).
function template() {
  if (TEMPLATE) return TEMPLATE;
  const defs = [];
  const bone = (name, parent, pivot) => { const b = new BoneDef(name, parent, pivot); defs.push(b); return b; };
  const torso = bone('torso', null, [0, 1.0, 0]);
  const head = bone('head', 'torso', [0, 1.8, 0.02]);

  // ---------- 몸통 ----------
  torso
    .chunk([0, 1.06, 0], [0.78, 0.3, 0.52], COL.dark)             // 골반
    .chunk([0, 1.18, 0], [0.86, 0.07, 0.6], COL.joint)            // 허리띠 홈
    .chunk([0, 1.31, 0], [0.62, 0.26, 0.46], COL.mid)             // 배
    .chunk([0, 1.56, 0.02], [1.08, 0.5, 0.68], COL.base)          // 가슴
    .chunk([0, 1.57, 0.4], [0.62, 0.34, 0.1], COL.light)          // 가슴 앞 판
    .chunk([0, 1.56, -0.44], [0.82, 0.46, 0.16], COL.mid)         // 등 판
    .chunk([0, 1.8, 0], [0.7, 0.12, 0.46], COL.dark)              // 목 받침
    .chunk([0, 1.78, 0], [0.3, 0.12, 0.3], COL.joint)             // 목
    .add(box([-0.3, 1.835, 0.02], [0.32, 0.03, 0.26]), COL.moss, 0.006)     // 어깨선 이끼
    .add(box([0.22, 1.835, -0.1], [0.24, 0.03, 0.2]), COL.mossDark, 0.006)
    .add(box([-0.5, 1.1, 0.27], [0.18, 0.2, 0.02]), COL.rust, 0.004);       // 녹물 얼룩
  torso.addGlow(box([0.2, 1.57, 0.455], [0.014, 0.26, 0.012]), COL.crack)   // 가슴 금 줄무늬
    .addGlow(box([0.2, 1.7, 0.455], [0.12, 0.014, 0.012]), COL.crack)
    .addGlow(box([-0.24, 1.45, 0.455], [0.014, 0.18, 0.012]), COL.crack)
    .addGlow(box([-0.3, 1.36, 0.455], [0.12, 0.014, 0.012]), COL.crack)
    .addGlow(box([0.0, 1.31, 0.234], [0.2, 0.012, 0.012]), COL.crack);      // 배 홈

  // ---------- 머리 + 빛나는 십자 코어 ----------
  head
    .chunk([0, 2.02, 0.03], [0.58, 0.52, 0.54], COL.base)         // 머리
    .chunk([0, 2.3, 0.1], [0.6, 0.07, 0.34], COL.dark)            // 이마 위 판
    .chunk([0, 2.22, 0.2], [0.6, 0.08, 0.2], COL.dark)            // 눈썹(이마) 턱
    .chunk([0, 1.82, 0.14], [0.42, 0.1, 0.3], COL.dark)           // 턱
    .chunk([-0.32, 1.98, 0.0], [0.1, 0.3, 0.42], COL.mid)         // 얼굴 옆 판
    .chunk([0.32, 1.98, 0.0], [0.1, 0.3, 0.42], COL.mid)
    .add(box([0, 2.0, 0.304], [0.36, 0.36, 0.022]), COL.recess, 0.002)       // 코어가 박힌 어두운 홈
    .add(box([0.12, 2.31, -0.05], [0.26, 0.03, 0.22]), COL.moss, 0.006)      // 정수리 이끼
    .add(box([-0.18, 2.31, 0.0], [0.14, 0.03, 0.14]), COL.mossDark, 0.006);
  head.addGlow(box([0, 2.0, 0.318], [0.08, 0.28, 0.02]), COL.core)           // 십자 세로
    .addGlow(box([0, 2.0, 0.318], [0.28, 0.08, 0.02]), COL.core)             // 십자 가로
    .addGlow(box([0, 2.0, 0.33], [0.1, 0.1, 0.014]), 0xffffff);              // 가운데 가장 밝은 점

  // ---------- 팔 (어깨 판 + 윗팔 / 팔꿈치부터 아랫팔 + 주먹) ----------
  for (const sx of [-1, 1]) {
    const nm = sx > 0 ? 'L' : 'R';
    const SH = [sx * 0.88, 1.68, 0], EL = [sx * 0.9, 1.0, 0];
    const arm = bone('arm' + nm, 'torso', SH);
    arm
      .chunk([sx * 0.92, 1.76, 0], [0.6, 0.44, 0.66], COL.base)               // 어깨 판
      .chunk([sx * 0.94, 2.0, 0], [0.5, 0.1, 0.56], COL.light)                // 어깨 위 덮개
      .chunk([sx * 0.9, 1.34, 0], [0.42, 0.6, 0.46], COL.mid)                 // 윗팔
      .chunk([sx * 0.9, 1.0, 0], [0.36, 0.14, 0.4], COL.joint)                // 팔꿈치
      .add(box([sx * 0.94, 2.055, 0.05], [0.3, 0.03, 0.34]), COL.moss, 0.006) // 어깨 이끼
      .add(box([sx * 0.7, 1.9, 0.2], [0.04, 0.2, 0.2]), COL.mossDark, 0.006);
    const fore = bone('fore' + nm, 'arm' + nm, EL);
    fore
      .chunk([sx * 0.9, 0.74, 0.03], [0.5, 0.5, 0.56], COL.base)              // 아랫팔
      .chunk([sx * 0.9, 0.49, 0.03], [0.54, 0.1, 0.6], COL.dark)              // 손목 띠
      .chunk([sx * 0.9, 0.26, 0.06], [0.64, 0.42, 0.66], COL.light)           // 주먹
      .chunk([sx * 0.9 - 0.2, 0.3, 0.42], [0.12, 0.2, 0.1], COL.mid)          // 주먹 마디
      .chunk([sx * 0.9 + 0.2, 0.3, 0.42], [0.12, 0.2, 0.1], COL.mid)
      .chunk([sx * 0.9, 0.31, 0.42], [0.12, 0.22, 0.1], COL.mid);
    fore.addGlow(box([sx * 0.9 - sx * 0.1, 0.78, 0.31], [0.014, 0.26, 0.012]), COL.crack)
      .addGlow(box([sx * 0.9 + sx * 0.04, 0.68, 0.31], [0.12, 0.014, 0.012]), COL.crack);
  }

  // ---------- 다리 ----------
  for (const sx of [-1, 1]) {
    const nm = sx > 0 ? 'L' : 'R';
    const leg = bone('leg' + nm, null, [sx * 0.27, 1.0, 0]);
    leg
      .chunk([sx * 0.27, 0.97, 0], [0.46, 0.16, 0.5], COL.joint)              // 고관절
      .chunk([sx * 0.27, 0.79, 0], [0.5, 0.4, 0.54], COL.base);               // 허벅지
    const shin = bone('shin' + nm, 'leg' + nm, [sx * 0.27, 0.57, 0.02]);
    shin
      .chunk([sx * 0.27, 0.58, 0.12], [0.4, 0.18, 0.3], COL.dark)             // 무릎
      .chunk([sx * 0.27, 0.37, 0.02], [0.44, 0.4, 0.46], COL.mid)             // 정강이
      .chunk([sx * 0.27, 0.12, 0.1], [0.54, 0.24, 0.72], COL.base)            // 발
      .chunk([sx * 0.27, 0.09, 0.5], [0.5, 0.14, 0.14], COL.dark)             // 발끝
      .add(box([sx * 0.27, 0.6, 0.28], [0.2, 0.03, 0.1]), COL.moss, 0.006);   // 무릎 이끼
  }

  defs.forEach((d) => d.bake());
  LOD_GEO = mergeGeometries(defs.map((d) => d.geo.clone().translate(d.pivot[0], d.pivot[1], d.pivot[2])), false);
  LOD_GLOW = mergeGeometries(defs.filter((d) => d.glowGeo).map((d) => d.glowGeo.clone().translate(d.pivot[0], d.pivot[1], d.pivot[2])), false);
  TEMPLATE = defs;
  MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  MAT_HIT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0xff2a14, emissiveIntensity: 0.9 });
  GLOW_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });   // 빛나는 금·십자 (조명 영향 없이 항상 밝게)
  // 코어 둘레의 부드러운 빛 번짐
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const ctx = cv.getContext('2d'), gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(190,240,255,0.55)'); gr.addColorStop(1, 'rgba(120,210,255,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
  GLOW_TEX = new THREE.CanvasTexture(cv);
  return TEMPLATE;
}

// 골렘 한 마리 만들기 (원점 = 발바닥, 앞쪽 = +z)
export function buildGolem() {
  const defs = template();
  const root = new THREE.Group();
  const bones = {}, meshes = [];
  const coreMat = GLOW_MAT.clone();   // 골렘마다 코어 밝기를 따로 바꿀 수 있게 복제
  const glowMeshes = [];
  for (const d of defs) {
    const g = new THREE.Group();
    const par = d.parent ? defs.find((x) => x.name === d.parent) : null, pp = par ? par.pivot : [0, 0, 0];
    g.position.set(d.pivot[0] - pp[0], d.pivot[1] - pp[1], d.pivot[2] - pp[2]);
    const m = new THREE.Mesh(d.geo, MAT); meshes.push(m); g.add(m);
    if (d.glowGeo) { const gm = new THREE.Mesh(d.glowGeo, coreMat); glowMeshes.push(gm); g.add(gm); }
    (d.parent ? bones[d.parent] : root).add(g);
    bones[d.name] = g;
  }
  // 코어 빛 번짐 (머리 앞)
  const sprMat = new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const spr = new THREE.Sprite(sprMat);
  spr.position.set(0, 2.0 - 1.8, 0.34 - 0.02); spr.scale.set(1.1, 1.1, 1);
  bones.head.add(spr);
  // 멀리 있을 때 쓰는 통짜 모델
  const lod = new THREE.Mesh(LOD_GEO, MAT), lodGlow = new THREE.Mesh(LOD_GLOW, coreMat);
  lod.visible = false; lodGlow.visible = false;
  root.add(lod, lodGlow);
  root.userData.rig = {
    b: bones, meshes, lod, lodGlow, spr, coreMat, glowMeshes, far: false,
    t: Math.random() * 20, ph: 0, w: 0, rb: 0, seed: Math.random() * 100,
    torsoY0: bones.torso.position.y,
    sw: -1, ht: -1, flash: 0, hit: false, dim: 1,
  };
  root.userData.keepInCave = true;   // 동굴 안에서 그릴 때 숨겨지지 않게 (main.js)
  return root;
}

export function setGolemFar(g, far) {
  const r = g.userData.rig;
  if (r.far === far) return;
  r.far = far;
  r.lod.visible = far; r.lodGlow.visible = far;
  r.b.torso.visible = !far; r.b.legL.visible = !far; r.b.legR.visible = !far;
  r.spr.visible = !far;
}

// ================= 모션 =================
// speed: 이동 속도(m/s). 0 근처 = 대기, ~1 = 걷기, 2.7 이상 = 달리기(쫓아올 때)
export function animateGolem(g, dt, speed) {
  const r = g.userData.rig, b = r.b;
  r.t += dt;
  const t = r.t, seed = r.seed;

  r.w += (Math.min(1, speed / 0.35) - r.w) * (1 - Math.exp(-8 * dt));
  r.rb += (sm01((speed - 2.2) / 1.4) - r.rb) * (1 - Math.exp(-6 * dt));
  const w = r.w, run = r.rb, idle = 1 - w;
  r.ph += dt * speed * (1.6 + 0.4 * run);   // 한 걸음 주기: 속도에 비례 (느리고 묵직하게)
  const s = Math.sin(r.ph), c = Math.cos(r.ph);

  const P = {
    torsoY: Math.abs(s) * (0.04 + 0.05 * run) * w * -1 + 0.0,   // 발이 땅에 닿을 때 몸이 살짝 내려감
    torsoX: 0.05 * w + 0.2 * run, torsoY_rot: c * (0.1 + 0.05 * run) * w, torsoZ: s * 0.05 * w,
    sqY: 1 + Math.sin(t * 1.5 + seed) * 0.012 * idle,
    headX: Math.sin(t * 0.7 + seed) * 0.05 * idle - 0.04 * w - 0.12 * run, headY: Math.sin(t * 0.35 + seed * 2) * 0.35 * idle - c * 0.08 * w,
    armLx: -s * (0.35 + 0.3 * run) * w + Math.sin(t * 1.1 + seed) * 0.03 * idle, armRx: s * (0.35 + 0.3 * run) * w + Math.sin(t * 1.1 + seed + 1) * 0.03 * idle,
    armLz: 0.1 + 0.03 * idle, armRz: -0.1 - 0.03 * idle,
    foreLx: -0.25 - 0.2 * run - Math.max(0, s) * 0.2 * w, foreRx: -0.25 - 0.2 * run - Math.max(0, -s) * 0.2 * w,
    legLx: s * (0.45 + 0.25 * run) * w, legRx: -s * (0.45 + 0.25 * run) * w,
    shinLx: Math.max(0, -c) * 0.6 * w * (s > 0 ? 1 : 0.4) + 0.0, shinRx: Math.max(0, c) * 0.6 * w * (s < 0 ? 1 : 0.4),
    pulse: 0.78 + 0.22 * Math.sin(t * 2.2 + seed), bright: 1,
  };

  // ---- 공격: 두 팔을 번쩍 들었다가 내려치기 (서버가 팔이 내려오는 순간 피해를 확정) ----
  if (r.sw >= 0) {
    r.sw += dt;
    const u = r.sw / 1.1;
    if (u >= 1) r.sw = -1;
    else {
      const raise = u < 0.5 ? sm01(u / 0.5) : u < 0.56 ? 1 : 1 - sm01((u - 0.7) / 0.3);
      const slam = u < 0.5 ? 0 : u < 0.6 ? sm01((u - 0.5) / 0.1) : 1 - sm01((u - 0.62) / 0.38);
      P.armLx = P.armRx = -2.55 * raise + 3.0 * slam * 0.9;
      P.foreLx = P.foreRx = -0.3 * raise - 0.2 * slam;
      P.armLz = 0.15 * raise; P.armRz = -0.15 * raise;
      P.torsoX = -0.28 * raise + 0.55 * slam;
      P.torsoY = -0.12 * slam;
      P.headX = -0.2 * raise + 0.25 * slam;
      P.legLx = -0.3 * slam; P.legRx = -0.3 * slam; P.shinLx = P.shinRx = 0.35 * slam + 0.15 * raise;
      P.torsoY_rot = 0; P.torsoZ = 0;
      P.bright = 1 + 0.5 * raise;   // 팔을 들 때 코어가 더 밝게
    }
  }

  // ---- 피격: 뒤로 휘청 ----
  if (r.ht >= 0) {
    r.ht += dt;
    const u = r.ht / 0.45;
    if (u >= 1) r.ht = -1;
    else {
      const k = u < 0.2 ? u / 0.2 : 1 - sm01((u - 0.2) / 0.8);
      P.torsoX -= 0.24 * k; P.headX -= 0.35 * k;
      P.armLz += 0.35 * k; P.armRz -= 0.35 * k;
      P.armLx += 0.3 * k; P.armRx += 0.3 * k;
      P.pulse *= 0.4 + 0.6 * Math.abs(Math.sin(r.ht * 40));   // 코어가 깜빡임
    }
  }

  // ---- 적용 ----
  b.torso.position.y = r.torsoY0 + P.torsoY;
  b.torso.rotation.set(P.torsoX, P.torsoY_rot, P.torsoZ);
  b.torso.scale.y = P.sqY;
  b.head.rotation.x = P.headX; b.head.rotation.y = P.headY;
  b.armL.rotation.x = P.armLx; b.armR.rotation.x = P.armRx;
  b.armL.rotation.z = P.armLz; b.armR.rotation.z = P.armRz;
  b.foreL.rotation.x = P.foreLx; b.foreR.rotation.x = P.foreRx;
  b.legL.rotation.x = P.legLx; b.legR.rotation.x = P.legRx;
  b.shinL.rotation.x = P.shinLx; b.shinR.rotation.x = P.shinRx;

  // 코어 밝기 (숨 쉬듯 일렁임) — 죽으면 서서히 꺼짐(r.dim)
  const k = (0.7 + 0.3 * P.pulse) * P.bright * r.dim;
  r.coreMat.color.setRGB(Math.min(1, CORE_BASE.r * k), Math.min(1, CORE_BASE.g * k), Math.min(1, CORE_BASE.b * k));
  r.spr.material.opacity = Math.min(1, 0.55 * P.pulse * P.bright) * r.dim;
  const ss = 1.0 + 0.12 * P.pulse + 0.35 * (P.bright - 1);
  r.spr.scale.set(ss, ss, 1);

  if (r.flash > 0) {
    r.flash -= dt;
    if (!r.hit) { r.hit = true; for (const m of r.meshes) m.material = MAT_HIT; }
    if (r.flash <= 0) { r.hit = false; for (const m of r.meshes) m.material = MAT; }
  }
}

// 죽는 모션: 무릎이 꺾이고 앞으로 무너져 쓰러짐. 코어 불빛이 꺼져요. f = 쓰러진 정도 (0 = 서 있음, 1 = 완전히 누움)
function deathPose(g, f, side) {
  const r = g.userData.rig, b = r.b;
  r.sw = -1; r.ht = -1;
  b.torso.position.y = r.torsoY0 - 0.25 * Math.min(1, f * 1.6);
  b.torso.rotation.set(0.25 * f, 0, 0);
  b.torso.scale.y = 1;
  b.head.rotation.x = 0.25 * f; b.head.rotation.y = 0.4 * side * f;
  b.armL.rotation.x = -0.6 * f; b.armR.rotation.x = -1.0 * f;
  b.armL.rotation.z = 0.6 * f; b.armR.rotation.z = -0.5 * f;
  b.foreL.rotation.x = -0.4 * f; b.foreR.rotation.x = -0.2 * f;
  b.legL.rotation.x = -0.7 * f; b.legR.rotation.x = -0.45 * f;
  b.shinL.rotation.x = 0.9 * f; b.shinR.rotation.x = 0.7 * f;
  r.dim = 1 - 0.92 * sm01((f - 0.2) / 0.8);
}
// 0 → 1 로 점점 빨라지며 쓰러지고, 땅에 닿을 때 살짝 튕김
const fallCurve = (k) => k >= 1 ? 1 : k < 0.8 ? (k / 0.8) ** 2 : 1 - 0.04 * Math.sin(Math.PI * (k - 0.8) / 0.2);

// ================= 서버가 보낸 골렘을 화면에 그리기 =================
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const LOD_NEAR = 70, LOD_FAR = 85;   // 이 거리(m)보다 멀면 단순 모델로 바꿈

export function createGolemWorld({ scene, camera, layout }) {
  const map = new Map();   // 골렘 id -> { obj, bar, x, z, ry, tx, tz, tr, hp, atkN, mode, sp, far, dying, dd, side }
  const barGeo = new THREE.PlaneGeometry(1, 1);
  const barBgMat = new THREE.MeshBasicMaterial({ color: 0x120404, transparent: true, opacity: 0.9, depthTest: false, fog: false });
  const barFgMat = new THREE.MeshBasicMaterial({ color: 0xff1111, depthTest: false, fog: false });
  const BAR_W = 1.6, BAR_H = 0.16;

  function makeBar() {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(barGeo, barBgMat); bg.scale.set(BAR_W + 0.06, BAR_H + 0.06, 1); bg.renderOrder = 998;
    const fg = new THREE.Mesh(barGeo, barFgMat); fg.scale.set(BAR_W, BAR_H, 1); fg.position.z = 0.001; fg.renderOrder = 999;
    g.add(bg, fg);
    g.userData.fg = fg; g.userData.keepInCave = true;
    g.visible = false;
    return g;
  }

  // 서버가 보낸 목록: [id, x, z, 바라보는 방향, mode(3 = 죽음), hp, 공격횟수]
  function onSnapshot(list) {
    const seen = new Set();
    for (const [id, x, z, ry, mode, hp, atkN] of list) {
      seen.add(id);
      let e = map.get(id);
      if (!e) {
        const obj = buildGolem();
        obj.scale.setScalar(GOLEM.SCALE);
        obj.rotation.order = 'YXZ';   // 방향(y)을 돌린 뒤 쓰러지는 기울기(x)를 적용
        const bar = makeBar();
        scene.add(obj, bar);
        e = { obj, bar, x, z, ry, tx: x, tz: z, tr: ry, hp, atkN, mode, sp: 0, far: false, dying: false, dd: 0, side: 1 };
        map.set(id, e);
      }
      const rig = e.obj.userData.rig;
      e.tx = x; e.tz = z; e.tr = ry;
      if (mode === 3) {
        if (!e.dying) { e.dying = true; e.dd = 0; e.side = Math.random() < 0.5 ? -1 : 1; rig.sw = -1; }
      } else if (e.dying) {   // 리스폰: 자세 되돌리기
        e.dying = false; e.obj.rotation.x = 0; rig.dim = 1;
      }
      if (hp < e.hp) { rig.flash = 0.15; if (mode !== 3) rig.ht = 0; }
      if (atkN !== e.atkN) { rig.sw = 0; e.atkN = atkN; }
      e.mode = mode; e.hp = hp;
    }
    for (const [id, e] of map) {
      if (seen.has(id)) continue;
      scene.remove(e.obj, e.bar);
      e.obj.userData.rig.coreMat.dispose(); e.obj.userData.rig.spr.material.dispose();   // 골렘마다 따로 만든 재질만 정리
      map.delete(id);
    }
  }

  // active = false 면 (동굴 밖) 전부 치우고 아무것도 안 함
  function update(dt, active = true) {
    if (!active) { if (map.size) onSnapshot([]); return; }
    const k = 1 - Math.exp(-12 * dt), kr = 1 - Math.exp(-8 * dt), ks = 1 - Math.exp(-8 * dt);
    for (const e of map.values()) {
      const ox = e.x, oz = e.z;
      if (Math.hypot(e.tx - e.x, e.tz - e.z) > 6) { e.x = e.tx; e.z = e.tz; }
      else { e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; }
      e.ry += angDiff(e.ry, e.tr) * kr;
      const sp = dt > 0 ? Math.hypot(e.x - ox, e.z - oz) / dt : 0;
      e.sp += (Math.min(sp, 12) - e.sp) * ks;

      const y = layout.floorAt(e.x, e.z);
      e.obj.position.set(e.x, y, e.z);
      e.obj.rotation.y = e.ry;
      const cx = e.x - camera.position.x, cz = e.z - camera.position.z, d2 = cx * cx + cz * cz;
      const farNow = e.far ? d2 > LOD_NEAR * LOD_NEAR : d2 > LOD_FAR * LOD_FAR;
      if (farNow !== e.far) { e.far = farNow; setGolemFar(e.obj, farNow); }

      if (e.dying) {
        e.dd += dt;
        const f = fallCurve(e.dd / GOLEM.DEATH_FALL);
        if (!e.far) { animateGolem(e.obj, dt, 0); deathPose(e.obj, f, e.side); }
        else e.obj.userData.rig.dim = 1 - 0.92 * sm01((f - 0.2) / 0.8);
        e.obj.rotation.x = (Math.PI / 2) * 0.96 * f;           // 앞으로 쓰러짐
        e.obj.position.y = y + 0.32 * GOLEM.SCALE * f;         // 몸통 두께만큼 올려서 바닥에 닿게
        e.bar.visible = false;
        continue;
      }
      if (!e.far) animateGolem(e.obj, dt, e.sp);

      const show = e.hp < GOLEM.HP;
      e.bar.visible = show;
      if (show) {
        const ratio = Math.max(0, e.hp / GOLEM.HP);
        e.bar.position.set(e.x, y + 2.6 * GOLEM.SCALE + 0.35, e.z);
        e.bar.quaternion.copy(camera.quaternion);
        const fg = e.bar.userData.fg;
        fg.scale.x = BAR_W * ratio;
        fg.position.x = -BAR_W / 2 + (BAR_W * ratio) / 2;
      }
    }
  }

  return { onSnapshot, update };
}
