// 보스 '오크 대전사' 그리기 + 보스 터의 뼈 장식 + 화면 위 보스 체력바
// 서버가 위치·전투를 정하고, 여기서는 받아서 그려요. (계산: boss-ai.mjs, 터 위치: terrain.js 의 T.arena)
//  - 모델은 캐릭터 시트를 따라 코드로 만들었어요: 올리브색 근육질 몸, 가시 달린 어깨 갑옷, 해골 버클 벨트, 붉은 천, 상아 같은 엄니, 큰 도끼
//  - 동작: 숨쉬기 / 걷기 / 도끼를 머리 위로 들었다 내려찍기(드는 동안 피할 틈이 있어요) / 맞으면 붉게 번쩍 / 쓰러짐
//  - 보스 터: 어두운 흙(땅 색은 terrain.js + main.js 셰이더)에 뼈가 몇 개씩 꽂혀 있어요
//  - 전투가 시작되면(보스가 때리려 하거나 맞으면) 화면 위 가운데에 체력바가 떠요
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOSS } from './boss-ai.mjs';

const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ---------- 재질 (보스는 한 마리라 공유 걱정 없이 전부 같이 번쩍이게 함) ----------
const M = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const MAT = {
  skin: M(0x74862f), skinDk: M(0x56671f), metal: M(0x4a474e), metalLt: M(0x787279), leather: M(0x5a3a2a),
  red: M(0x93302a), bone: M(0xe6dcc0), hair: M(0x2b1d19), blade: M(0xa39b8c), wood: M(0x4a2e20), scar: M(0xa8402e),
  eye: new THREE.MeshBasicMaterial({ color: 0xffd54a }),
};
const FLASHABLE = [MAT.skin, MAT.skinDk, MAT.metal, MAT.metalLt, MAT.leather, MAT.red, MAT.bone, MAT.hair, MAT.blade, MAT.wood, MAT.scar];
const setFlash = (on) => { for (const m of FLASHABLE) m.emissive.setHex(on ? 0x992a10 : 0x000000); };

// ---------- 작은 도우미 ----------
const part = (geo, mat, x = 0, y = 0, z = 0, parent = null) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (parent) parent.add(m); return m; };
const box = (w, h, d, mat, x, y, z, parent) => part(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
const cyl = (r0, r1, h, mat, x, y, z, parent, seg = 8) => part(new THREE.CylinderGeometry(r1, r0, h, seg), mat, x, y, z, parent);
const cone = (r, h, mat, x, y, z, parent) => part(new THREE.ConeGeometry(r, h, 6), mat, x, y, z, parent);
const ball = (r, mat, x, y, z, parent, sx = 1, sy = 1, sz = 1) => { const m = part(new THREE.SphereGeometry(r, 10, 8), mat, x, y, z, parent); m.scale.set(sx, sy, sz); return m; };

// 모델 높이 약 2.7m (× BOSS.SCALE). 앞쪽 = +z. 캐릭터의 오른손(도끼 든 쪽) = -x
function buildOrc() {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const body = new THREE.Group(); root.add(body);

  // ----- 다리 (엉덩이 높이 1.05) -----
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(sx * 0.3, 1.05, 0); body.add(leg);
    box(0.4, 0.5, 0.42, MAT.skin, 0, -0.24, 0, leg);                    // 허벅지
    box(0.44, 0.3, 0.2, MAT.metal, 0, -0.46, 0.18, leg);               // 무릎 보호대
    box(0.36, 0.5, 0.36, MAT.leather, 0, -0.7, 0, leg);                // 정강이
    box(0.4, 0.3, 0.12, MAT.metalLt, 0, -0.7, 0.2, leg);               // 정강이 철판
    box(0.44, 0.22, 0.62, MAT.metal, 0, -0.93, 0.1, leg);              // 장화
    box(0.46, 0.06, 0.64, MAT.leather, 0, -1.02, 0.1, leg);            // 밑창
    legs.push(leg);
  }

  // ----- 몸통 (허리 높이 1.05) -----
  const torso = new THREE.Group(); torso.position.y = 1.05; body.add(torso);
  box(0.78, 0.5, 0.52, MAT.skin, 0, 0.22, 0, torso);                  // 배
  box(1.2, 0.66, 0.74, MAT.skin, 0, 0.78, 0, torso);                  // 가슴
  box(0.5, 0.5, 0.3, MAT.skinDk, 0, 0.82, -0.3, torso);               // 등 근육
  box(0.86, 0.15, 0.6, MAT.leather, 0, 0.0, 0, torso);                // 벨트
  const buckle = box(0.3, 0.3, 0.1, MAT.metalLt, 0, 0.0, 0.32, torso);                 // 해골 버클 판
  ball(0.11, MAT.bone, 0, 0.02, 0.4, torso, 1, 1.05, 0.8);                              // 해골
  box(0.06, 0.05, 0.03, MAT.hair, -0.04, 0.04, 0.47, torso); box(0.06, 0.05, 0.03, MAT.hair, 0.04, 0.04, 0.47, torso);   // 눈구멍
  box(0.4, 0.62, 0.05, MAT.red, 0, -0.32, 0.32, torso);              // 앞 붉은 천
  box(0.46, 0.5, 0.05, MAT.leather, 0.42, -0.26, 0.25, torso);       // 옆 가죽 치마
  box(0.46, 0.5, 0.05, MAT.leather, -0.42, -0.26, 0.25, torso);
  box(0.46, 0.66, 0.05, MAT.red, 0, -0.34, -0.3, torso);             // 뒤 붉은 천
  const strap = box(0.15, 1.05, 0.05, MAT.leather, 0.0, 0.8, 0.38, torso); strap.rotation.z = -0.62;   // 가슴 가로지르는 가죽끈
  box(0.1, 0.12, 0.07, MAT.metal, 0.22, 0.95, 0.4, torso);
  for (const a of [0.5, -0.55]) box(0.04, 0.4, 0.03, MAT.scar, -0.28, 0.85, 0.38, torso).rotation.z = a;   // 가슴 흉터(X 자국)

  // ----- 머리 -----
  const head = new THREE.Group(); head.position.set(0, 1.4, 0.12); torso.add(head);
  box(0.3, 0.18, 0.3, MAT.skinDk, 0, -0.2, -0.04, head);                                // 목
  ball(0.31, MAT.skin, 0, 0, 0, head, 1, 0.92, 1.0);                                    // 머리통
  box(0.4, 0.14, 0.3, MAT.skin, 0, -0.17, 0.12, head);                                  // 턱
  box(0.46, 0.08, 0.14, MAT.skinDk, 0, 0.07, 0.24, head).rotation.x = 0.15;             // 불거진 눈썹
  box(0.1, 0.07, 0.04, MAT.eye, -0.11, 0.0, 0.3, head); box(0.1, 0.07, 0.04, MAT.eye, 0.11, 0.0, 0.3, head);   // 눈
  box(0.09, 0.16, 0.12, MAT.skinDk, 0, -0.04, 0.32, head);                              // 코
  for (const sx of [-1, 1]) {
    const tusk = cone(0.045, 0.2, MAT.bone, sx * 0.13, -0.14, 0.3, head); tusk.rotation.x = -0.25;   // 위로 솟은 엄니
    const ear = cone(0.08, 0.3, MAT.skin, sx * 0.34, 0.06, -0.02, head); ear.rotation.z = -sx * 1.25;   // 뾰족한 귀
  }
  part(new THREE.SphereGeometry(0.325, 10, 6, 0, TAU, 0, 1.05), MAT.hair, 0, 0.0, -0.03, head);        // 머리카락(위쪽 반구)
  ball(0.1, MAT.hair, 0, 0.32, -0.08, head);                                                           // 상투
  ball(0.08, MAT.hair, 0, 0.28, -0.26, head); cone(0.07, 0.3, MAT.hair, 0, 0.18, -0.4, head).rotation.x = -2.3;   // 말총머리

  // ----- 팔 (어깨 높이: 허리 + 0.95) -----
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(sx * 0.74, 0.98, 0); torso.add(arm);
    ball(0.26, MAT.skin, 0, 0, 0, arm);                                    // 어깨 근육
    cyl(0.2, 0.17, 0.55, MAT.skin, 0, -0.3, 0, arm);                       // 위팔
    box(0.34, 0.44, 0.34, MAT.metal, 0, -0.7, 0, arm);                     // 팔뚝 보호대
    box(0.36, 0.1, 0.36, MAT.leather, 0, -0.5, 0, arm);                    // 보호대 위 가죽띠
    box(0.3, 0.26, 0.3, MAT.skinDk, 0, -1.0, 0.03, arm);                   // 주먹
    // 어깨 갑옷
    const big = sx < 0;                                                    // 도끼 든 쪽 어깨 갑옷이 더 큼
    const pw = big ? 0.8 : 0.62;
    const pad = box(pw, 0.2, pw * 0.85, MAT.metal, sx * 0.04, 0.2, 0, arm); pad.rotation.z = sx * 0.12;
    box(pw * 0.7, 0.05, pw * 0.6, MAT.red, sx * 0.04, 0.32, 0, arm).rotation.z = sx * 0.12;   // 붉은 문양판
    box(pw * 0.9, 0.12, pw * 0.8, MAT.metalLt, sx * 0.14, 0.04, 0, arm);  // 아래 겹
    cone(0.1, big ? 0.55 : 0.4, MAT.blade, sx * 0.02, big ? 0.62 : 0.5, 0, arm);                // 가시
    if (big) { const sp = cone(0.07, 0.34, MAT.blade, -0.28, 0.45, 0.1, arm); sp.rotation.z = 0.5; }
    arms.push(arm);
  }

  // ----- 도끼 (오른손 = arms[0], 손 위치에서 시작) -----
  const axe = new THREE.Group(); axe.position.set(0, -1.0, 0.04); arms[0].add(axe);
  cyl(0.05, 0.05, 1.9, MAT.wood, 0, 0.55, 0, axe);                          // 자루 (손잡이에서 위로)
  cyl(0.065, 0.065, 0.38, MAT.red, 0, 0.0, 0, axe);                         // 붉은 천 감은 손잡이
  cone(0.07, 0.3, MAT.blade, 0, 1.62, 0, axe);                               // 자루 끝 쇠 뿔
  box(0.22, 0.3, 0.2, MAT.metal, 0, 1.2, 0, axe);                            // 날 고정 쇠
  const blade = box(0.62, 0.62, 0.07, MAT.blade, -0.38, 1.25, 0, axe);       // 넓은 도끼날 (한쪽으로 퍼짐)
  const edge = box(0.12, 0.8, 0.09, MAT.metalLt, -0.7, 1.25, 0, axe);        // 날 끝
  box(0.2, 0.34, 0.07, MAT.blade, -0.55, 1.62, 0, axe).rotation.z = 0.5;     // 윗날 뿔
  box(0.2, 0.34, 0.07, MAT.blade, -0.55, 0.88, 0, axe).rotation.z = -0.5;    // 아랫날 뿔

  root.userData = { body, torso, head, legs, arms, axe };
  return root;
}

// ---------- 보스 터의 뼈 ----------
function buildBones(arena, T) {
  let s = ((arena.x * 73856093) ^ (arena.z * 19349663)) >>> 0 || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const boneGeos = [], darkGeos = [];
  const put = (geo, x, y, z, rx, ry, rz, sx = 1, sy = 1, sz = 1, list = boneGeos) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
    const g = geo.clone(); g.applyMatrix4(m); list.push(g);
  };
  const shaft = new THREE.CylinderGeometry(0.07, 0.085, 1, 6);
  const knob = new THREE.SphereGeometry(0.14, 6, 5);
  const rib = new THREE.TorusGeometry(0.55, 0.05, 5, 10, Math.PI);
  const skull = new THREE.SphereGeometry(0.3, 8, 6);
  const jaw = new THREE.BoxGeometry(0.24, 0.12, 0.26);
  const socket = new THREE.SphereGeometry(0.075, 5, 4);
  const horn = new THREE.ConeGeometry(0.07, 0.4, 5);

  const CLUSTERS = 12;
  for (let c = 0; c < CLUSTERS; c++) {
    const ang = rnd() * TAU, rad = Math.sqrt(0.12 + rnd() * 0.88) * (arena.r - 5);   // 터 안쪽 (보스가 서 있는 한가운데는 약간 비움)
    const cx = arena.x + Math.cos(ang) * rad, cz = arena.z + Math.sin(ang) * rad;
    const nLong = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < nLong; i++) {       // 땅에 꽂힌 긴 뼈 2~4개
      const x = cx + (rnd() - 0.5) * 3, z = cz + (rnd() - 0.5) * 3, h = T.height(x, z);
      const L = 1.1 + rnd() * 1.1, tilt = 0.15 + rnd() * 0.55, yaw = rnd() * TAU;
      const y = h + L * 0.3;
      put(shaft, x, y, z, tilt, yaw, 0, 1, L, 1);
      const dx = Math.sin(tilt) * Math.sin(yaw) * L / 2, dz = Math.sin(tilt) * Math.cos(yaw) * L / 2, dy = Math.cos(tilt) * L / 2;
      put(knob, x + dx, y + dy, z + dz, 0, 0, 0, 1, 0.9, 1);                             // 위쪽 마디
      put(knob, x + dx + 0.11, y + dy - 0.04, z + dz + 0.02, 0, 0, 0, 0.7, 0.7, 0.7);
    }
    if (rnd() < 0.5) {                      // 해골 하나
      const x = cx + (rnd() - 0.5) * 3, z = cz + (rnd() - 0.5) * 3, h = T.height(x, z), yaw = rnd() * TAU;
      put(skull, x, h + 0.12, z, 0, yaw, 0, 1, 0.9, 1.1);
      put(jaw, x + Math.sin(yaw) * 0.2, h + 0.0, z + Math.cos(yaw) * 0.2, 0, yaw, 0);
      for (const sx of [-1, 1]) put(socket, x + Math.sin(yaw) * 0.25 + Math.cos(yaw) * sx * 0.11, h + 0.2, z + Math.cos(yaw) * 0.25 - Math.sin(yaw) * sx * 0.11, 0, 0, 0, 1, 1.2, 0.8, darkGeos);
      if (rnd() < 0.4) { put(horn, x + Math.cos(yaw) * 0.26, h + 0.34, z - Math.sin(yaw) * 0.26, 0, 0, -0.6); put(horn, x - Math.cos(yaw) * 0.26, h + 0.34, z + Math.sin(yaw) * 0.26, 0, 0, 0.6); }
    }
    if (rnd() < 0.3) {                      // 반쯤 묻힌 갈비뼈 줄
      const x = cx + (rnd() - 0.5) * 2, z = cz + (rnd() - 0.5) * 2, yaw = rnd() * TAU, n = 4 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        const o = (i - n / 2) * 0.3, px = x + Math.cos(yaw) * o, pz = z - Math.sin(yaw) * o, k = 1 - Math.abs(i - n / 2) * 0.12;
        put(rib, px, T.height(px, pz) - 0.05, pz, 0, yaw + Math.PI / 2, 0, k, k, 1);
      }
    }
  }
  const mk = (list, mat) => { const g = mergeGeometries(list); list.forEach((q) => q.dispose()); const m = new THREE.Mesh(g, mat); m.frustumCulled = true; return m; };
  const grp = new THREE.Group();
  grp.add(mk(boneGeos, MAT.bone));
  if (darkGeos.length) grp.add(mk(darkGeos, new THREE.MeshBasicMaterial({ color: 0x120b08 })));
  return grp;
}

// ---------- 화면 위 체력바 ----------
function buildHud() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);width:min(560px,72vw);z-index:55;pointer-events:none;opacity:0;transition:opacity .3s;text-align:center;font-family:inherit';
  el.innerHTML =
    '<div data-n style="color:#ffe9c8;font-size:20px;font-weight:700;letter-spacing:2px;text-shadow:0 2px 4px #000,0 0 8px #a02010;margin-bottom:4px"></div>' +
    '<div style="position:relative;height:22px;border:2px solid #1c0e0a;border-radius:5px;background:#2b1410;box-shadow:0 2px 8px rgba(0,0,0,.7);overflow:hidden">' +
      '<div data-lag style="position:absolute;left:0;top:0;bottom:0;width:100%;background:#e8a24a"></div>' +
      '<div data-fill style="position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(#ee4a38,#a8160e)"></div>' +
      '<div data-hp style="position:absolute;inset:0;line-height:22px;font-size:13px;font-weight:700;color:#fff;text-shadow:0 1px 2px #000"></div>' +
    '</div>';
  document.body.appendChild(el);
  return { el, name: el.querySelector('[data-n]'), fill: el.querySelector('[data-fill]'), lag: el.querySelector('[data-lag]'), hp: el.querySelector('[data-hp]') };
}

// ================= 서버가 보낸 보스를 화면에 그리기 =================
const ATK_WIND = 0.68, ATK_SLAM = 0.17, ATK_END = 1.4;   // 도끼 드는 시간 / 내려찍는 시간 / 전체(초). 내려찍는 순간 = 서버 피해 확정(0.85초)

export function createBossWorld({ scene, camera, T, WATER_LEVEL }) {
  const arena = T.arena;
  if (!arena) return { onSnapshot() {}, update() {} };

  scene.add(buildBones(arena, T));

  const obj = buildOrc();
  obj.scale.setScalar(BOSS.SCALE);
  obj.visible = false;
  scene.add(obj);
  const u = obj.userData;
  const hud = buildHud();
  hud.name.textContent = BOSS.NAME;

  const e = { has: false, x: arena.x, z: arena.z, ry: Math.PI, tx: arena.x, tz: arena.z, tr: Math.PI, mode: 0, hp: BOSS.HP, atkN: 0, engaged: false, sp: 0, t: 0, walk: 0, atkT: -1, flash: 0, dying: false, dd: 0, bar: 0, lag: 1, barShow: 0 };

  // 서버가 보낸 [x, z, 방향, mode, hp, 공격횟수, 전투중] 또는 [] (멀리 있거나 사라짐)
  function onSnapshot(s) {
    if (!Array.isArray(s) || s.length < 7) { e.has = false; return; }
    const [x, z, ry, mode, hp, atkN, engaged] = s;
    if (!e.has) { e.x = x; e.z = z; e.ry = ry; e.has = true; e.atkN = atkN; e.hp = hp; e.dying = mode === 3; e.dd = e.dying ? 9 : 0; if (hp < BOSS.HP) e.lag = hp / BOSS.HP; }
    e.tx = x; e.tz = z; e.tr = ry;
    if (mode === 3) { if (!e.dying) { e.dying = true; e.dd = 0; e.atkT = -1; } }
    else if (e.dying) { e.dying = false; e.dd = 0; e.lag = 1; }
    if (hp < e.hp && mode !== 3) e.flash = 0.14;                      // 맞음 → 붉게 번쩍
    if (atkN !== e.atkN) { e.atkT = 0; e.atkN = atkN; }                // 공격 모션 시작
    e.mode = mode; e.hp = hp; e.engaged = !!engaged;
  }

  function update(dt, me) {
    // ----- 체력바 -----
    const near = !!me && e.has && Math.hypot(me.x - e.x, me.z - e.z) < 90;
    const want = near && (e.engaged || (e.dying && e.dd < 2.2));
    e.barShow += ((want ? 1 : 0) - e.barShow) * Math.min(1, dt * 8);
    hud.el.style.opacity = e.barShow > 0.02 ? String(Math.min(1, e.barShow)) : '0';
    const ratio = clamp(e.hp / BOSS.HP, 0, 1);
    hud.fill.style.width = (ratio * 100).toFixed(1) + '%';
    e.lag += (ratio - e.lag) * Math.min(1, dt * (e.lag > ratio ? 1.6 : 12));   // 줄어든 만큼 주황색이 천천히 따라옴
    hud.lag.style.width = (clamp(e.lag, 0, 1) * 100).toFixed(1) + '%';
    hud.hp.textContent = Math.ceil(e.hp) + ' / ' + BOSS.HP;

    if (!e.has) { obj.visible = false; return; }
    obj.visible = true;

    const ox = e.x, oz = e.z;
    if (Math.hypot(e.tx - e.x, e.tz - e.z) > 8) { e.x = e.tx; e.z = e.tz; }   // 순간이동(복귀)은 바로 이동
    else { const k = 1 - Math.exp(-10 * dt); e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; }
    e.ry += angDiff(e.ry, e.tr) * (1 - Math.exp(-8 * dt));
    const sp = dt > 0 ? Math.hypot(e.x - ox, e.z - oz) / dt : 0;
    e.sp += (Math.min(sp, 10) - e.sp) * (1 - Math.exp(-8 * dt));
    e.t += dt;

    const y = Math.max(T.height(e.x, e.z), WATER_LEVEL - 0.5);
    obj.position.set(e.x, y, e.z);
    obj.rotation.y = e.ry;

    // ---- 자세 계산 ----
    const m = clamp(e.sp / 3.5, 0, 1);                      // 걷는 정도
    e.walk += dt * (2.5 + e.sp * 1.1);
    const sw = Math.sin(e.walk), breath = Math.sin(e.t * 1.8);
    let legL = sw * 0.55 * m, legR = -sw * 0.55 * m;
    let armLx = -0.12 - sw * 0.35 * m + 0.02 * breath;       // 왼팔(캐릭터 왼쪽): 걸을 때 다리 반대로
    let armRth = -0.35 + sw * 0.1 * m + 0.02 * breath, axePhi = 0.77;   // 오른팔(도끼): θ = 어깨 회전(음수 = 앞으로), φ = 도끼 기울기
    let torsoX = 0.03 * breath * (1 - m), bodyY = 0.04 * Math.abs(sw) * m + 0.012 * breath * (1 - m), bodyZ = 0;
    let armLz = 0.08;

    if (e.dying) {
      e.dd += dt;
      const f = clamp(e.dd / BOSS.DEATH_FALL, 0, 1), ff = f * f * (3 - 2 * f);
      obj.rotation.x = -(Math.PI / 2) * 0.96 * ff;           // 뒤로 쓰러짐
      obj.position.y = y + 0.25 * BOSS.SCALE * ff;
      legL = legR = 0; armLx = -0.3; armRth = -0.7; axePhi = 1.4;
      torsoX = 0; bodyY = 0;
    } else {
      obj.rotation.x = 0;
      if (e.atkT >= 0) {
        e.atkT += dt;
        const t = e.atkT;
        if (t >= ATK_END) e.atkT = -1;
        else if (t < ATK_WIND) {                              // 도끼를 머리 위로 (천천히, 피할 틈)
          const a = sm(t / ATK_WIND);
          armRth = lerp(-0.35, -2.6, a); axePhi = lerp(0.77, 2.3, a);
          armLx = lerp(armLx, -1.2, a); torsoX = lerp(torsoX, -0.22, a); bodyY += 0.12 * a; legL = lerp(legL, 0.25, a); legR = lerp(legR, -0.2, a);
        } else if (t < ATK_WIND + ATK_SLAM) {                 // 내려찍기 (빠르게)
          const a = clamp((t - ATK_WIND) / ATK_SLAM, 0, 1), s2 = a * a;
          armRth = lerp(-2.6, -0.55, s2); axePhi = lerp(2.3, 2.95, s2);
          armLx = lerp(-1.2, -0.6, s2); torsoX = lerp(-0.22, 0.5, s2); bodyY += lerp(0.12, -0.08, s2); bodyZ = 0.25 * s2; legL = 0.25; legR = -0.2;
        } else {                                              // 천천히 자세 회복
          const a = sm((t - ATK_WIND - ATK_SLAM) / (ATK_END - ATK_WIND - ATK_SLAM));
          armRth = lerp(-0.55, armRth, a); axePhi = lerp(2.95, axePhi, a);
          armLx = lerp(-0.6, armLx, a); torsoX = lerp(0.5, torsoX, a); bodyY += lerp(-0.08, 0, a); bodyZ = lerp(0.25, 0, a);
        }
      }
    }

    // ---- 뼈대에 적용 ----
    u.body.position.set(0, bodyY, bodyZ);
    u.torso.rotation.x = torsoX;
    u.torso.scale.y = 1 + 0.012 * breath;
    u.legs[0].rotation.x = legR; u.legs[1].rotation.x = legL;      // legs[0] 은 -x(오른쪽) 다리
    u.arms[0].rotation.x = armRth;                                  // arms[0] = -x = 도끼 든 오른팔
    u.arms[0].rotation.z = -0.1;
    u.axe.rotation.x = axePhi;
    u.arms[1].rotation.x = armLx; u.arms[1].rotation.z = armLz;
    u.head.rotation.x = e.atkT >= 0 && e.atkT < ATK_WIND ? -0.15 : 0.0;

    // 맞았을 때 잠깐 붉게
    if (e.flash > 0) { e.flash -= dt; setFlash(e.flash > 0); }
  }

  return { onSnapshot, update };
}
