import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { updateWeapon } from './weapon.js';

// ============================================================
// 사람 모양 캐릭터 (레퍼런스 시트 기반 무채색 마네킹)
//
// 1) models/human_base.glb  (tools/build_human_glb.py 로 생성한 스킨드 메시 + 스켈레톤 + 애니메이션)
//    → AnimationMixer 로 idle / walk / run / jump_start / jump_air / jump_land 재생
// 2) GLB 를 아직 못 불러왔거나 실패하면, 코드로 만든 관절 캐릭터(아래 procedural)를 대신 사용
//
// 사용: makeHumanoid(color) 로 만들고, 매 프레임 animateHumanoid(avatar, dt, speed, grounded, vy)
// ============================================================

// ---------- 조정용 값 ----------
export const GAIT = {
  strideLen: 5.9,  // 이동속도 / strideLen = 초당 걸음 주기. 값이 클수록 다리가 천천히 움직임
  minHz: 0.9,      // 최소 걸음 주기(초당)
  maxHz: 2.6,      // 최대 걸음 주기(초당)
  runStrideLen: 10,  // 달리기(조깅) 전용: 이동속도 / runStrideLen = 초당 주기. 클수록 느긋하게 뜀
  runMinHz: 1.1,     // 조깅 최소 주기(초당)
  runMaxHz: 1.6,     // 조깅 최대 주기(초당). 이 값이 와다다 정도를 결정
  runFrom: 9,      // 이 속도부터 달리기 자세로 서서히 전환
  runTo: 13,       // 이 속도에서 완전한 달리기 자세
  maxSpeed: 16     // 애니메이션 계산에 쓰는 속도 상한 (속도 배율 켜도 다리가 미친 듯이 돌지 않게)
};

const HIP_Y = 0.95;          // 서 있을 때 골반 높이
const BODY_COLOR = 0xd8dae0; // 마네킹 기본색

// ---------- 작은 도우미 ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------- 공유 지오메트리 / 재질 (여러 캐릭터가 같이 씀) ----------
let G = null;
const matCache = new Map();

function profile(raw, n = 36) {
  const curve = new THREE.SplineCurve(raw.map((p) => new THREE.Vector2(p[0], p[1])));
  const pts = curve.getPoints(n);
  for (const p of pts) p.x = Math.max(0, p.x);
  pts[0].x = 0;
  pts[pts.length - 1].x = 0;
  return pts;
}

// 위가 rTop, 아래가 rBot 인 끝이 둥근 팔다리. 위쪽 구의 중심이 관절 피벗(원점)에 오도록 만듦
function limbGeo(rTop, rBot, L) {
  const pts = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI / 2;
    pts.push(new THREE.Vector2(rBot * Math.sin(t), -L - rBot * Math.cos(t)));
  }
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI / 2;
    pts.push(new THREE.Vector2(rTop * Math.cos(t), rTop * Math.sin(t)));
  }
  return new THREE.LatheGeometry(pts, 14);
}

function geos() {
  if (G) return G;

  G = {
    sphere: new THREE.SphereGeometry(1, 16, 12),
    neck: new THREE.CylinderGeometry(0.038, 0.045, 0.12, 12),
    // 골반 (앞뒤로 납작하게 z 스케일 적용해서 씀)
    pelvis: new THREE.LatheGeometry(
      profile([[0, -0.13], [0.09, -0.115], [0.15, -0.05], [0.16, 0.03], [0.145, 0.1], [0, 0.11]]),
      20
    ),
    // 가슴~어깨
    chest: new THREE.LatheGeometry(
      profile([
        [0, -0.02], [0.12, 0.0], [0.135, 0.12], [0.14, 0.2],
        [0.17, 0.33], [0.19, 0.42], [0.14, 0.5], [0.06, 0.54], [0, 0.55]
      ]),
      20
    ),
    upperArm: limbGeo(0.062, 0.050, 0.29),
    foreArm: limbGeo(0.050, 0.036, 0.26),
    thigh: limbGeo(0.095, 0.068, 0.42),
    shin: limbGeo(0.066, 0.043, 0.40)
  };

  return G;
}

function getMaterial(color) {
  const c = new THREE.Color(BODY_COLOR);
  if (color !== 0xffffff) c.lerp(new THREE.Color(color), 0.4); // 다른 플레이어는 살짝 색을 섞음

  const key = c.getHex();
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }));
  }
  return matCache.get(key);
}

// ---------- 캐릭터 생성 ----------
// 반환된 그룹의 userData.rig 에 관절 정보가 들어 있음. 발바닥이 y=0, 키 약 1.8, 정면은 +z
function makeProceduralHumanoid(color = 0xffffff) {
  const g = geos();
  const mat = getMaterial(color);
  const root = new THREE.Group();

  const mesh = (geo, parent, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  };

  const pivot = (parent, x, y, z) => {
    const p = new THREE.Group();
    p.position.set(x, y, z);
    parent.add(p);
    return p;
  };

  // 몸통
  const hips = pivot(root, 0, HIP_Y, 0);
  mesh(g.pelvis, hips, 0, 0, 0, 1, 1, 0.72);

  const spine = pivot(hips, 0, 0.08, 0);
  mesh(g.chest, spine, 0, 0, 0, 1, 1, 0.62);

  // 목 / 머리
  const neck = pivot(spine, 0, 0.48, 0);
  mesh(g.neck, neck, 0, 0.04, 0);

  const head = pivot(neck, 0, 0.08, 0);
  mesh(g.sphere, head, 0, 0.095, 0.005, 0.092, 0.118, 0.105);
  mesh(g.sphere, head, 0.09, 0.095, 0, 0.012, 0.034, 0.024);
  mesh(g.sphere, head, -0.09, 0.095, 0, 0.012, 0.034, 0.024);

  const rig = {
    hips, spine, neck, head,
    L: null, R: null,
    phase: 0,
    time: Math.random() * 10,
    move: 0,
    run: 0,
    air: 0
  };

  // 팔 + 다리 (side: 왼쪽 +1 / 오른쪽 -1, 캐릭터는 +z를 바라봄)
  for (const side of [1, -1]) {
    const shoulder = pivot(spine, side * 0.205, 0.42, 0);
    mesh(g.sphere, shoulder, 0, 0, 0, 0.058, 0.058, 0.058);
    mesh(g.upperArm, shoulder);

    const elbow = pivot(shoulder, 0, -0.29, 0);
    mesh(g.foreArm, elbow);

    const wrist = pivot(elbow, 0, -0.26, 0);
    mesh(g.sphere, wrist, 0, -0.055, 0, 0.03, 0.055, 0.017);                      // 손바닥
    mesh(g.sphere, wrist, -side * 0.027, -0.04, 0.008, 0.011, 0.03, 0.011);       // 엄지

    const hip = pivot(hips, side * 0.112, -0.05, 0);
    mesh(g.thigh, hip);

    const knee = pivot(hip, 0, -0.42, 0);
    mesh(g.shin, knee);

    const ankle = pivot(knee, 0, -0.4, 0);
    mesh(g.sphere, ankle, 0, -0.04, 0.035, 0.045, 0.04, 0.105);                   // 발
    mesh(g.sphere, ankle, 0, -0.058, 0.115, 0.038, 0.02, 0.04);                   // 발끝

    rig[side > 0 ? 'L' : 'R'] = { shoulder, elbow, wrist, hip, knee, ankle };
  }

  root.userData.rig = rig;
  return root;
}

// ---------- 애니메이션 ----------
// avatar: makeAvatar 가 만든 그룹 (userData.rig 를 가지고 있어야 함)
// speed: 수평 이동속도(유닛/초), grounded: 땅에 닿아있는지, vy: 수직 속도
function animateProcedural(avatar, dt, speed, grounded = true, vy = 0) {
  const s = avatar.userData.rig;
  if (!s) return;

  dt = Math.min(Math.max(dt, 0), 0.1);
  const sp = Math.min(speed, GAIT.maxSpeed);
  const moving = sp > 0.4;

  s.time += dt;
  s.move = damp(s.move, moving ? 1 : 0, 10, dt);
  s.run = damp(s.run, smooth(GAIT.runFrom, GAIT.runTo, sp), 8, dt);
  s.air = damp(s.air, grounded ? 0 : 1, 14, dt);

  if (moving && grounded) {
    const hz = clamp(sp / GAIT.strideLen, GAIT.minHz, GAIT.maxHz);
    s.phase += dt * hz * Math.PI * 2;
  }

  const m = s.move;
  const r = s.run;
  const air = s.air;
  const P = s.phase;
  const fall = clamp(-vy / 10, 0, 1);

  const ampLeg = lerp(0.5, 0.85, r) * m;
  const ampArm = lerp(0.55, 0.95, r) * m;
  const kneeAmp = lerp(0.85, 1.35, r) * m;

  for (const side of [1, -1]) {
    const j = side > 0 ? s.L : s.R;
    const ph = P + (side > 0 ? 0 : Math.PI);
    const sinP = Math.sin(ph);
    const cosP = Math.cos(ph);
    const swing = Math.max(0, cosP); // 다리를 앞으로 내미는 구간

    // --- 땅 위 자세 (걷기/달리기 → 대기로 자연스럽게 섞임) ---
    let thigh = -ampLeg * sinP - 0.1 * r * m;
    let knee = (0.06 + 0.08 * r) * m + kneeAmp * Math.pow(swing, 1.4);
    let ankle = -(thigh + knee) * 0.6 + 0.5 * Math.max(0, -sinP) * (1 - swing) * m;

    let armX = ampArm * sinP + 0.025 * Math.sin(s.time * 1.5 + side) * (1 - m);
    let elbow = -(
      0.14 * (1 - m) +
      (0.22 + 0.95 * r) * m +
      (0.1 + 0.3 * r) * m * Math.max(0, -sinP)
    );
    let armZ = side * (0.11 * (1 - m) + 0.05 * m);

    // --- 공중 자세 (점프/낙하) ---
    if (air > 0.001) {
      const lead = side > 0; // 왼쪽 다리를 앞으로
      const aThigh = lead ? lerp(-0.7, -0.15, fall) : lerp(0.35, 0.15, fall);
      const aKnee = lead ? lerp(1.0, 0.3, fall) : lerp(0.7, 0.2, fall);
      const aAnkle = -(aThigh + aKnee) * 0.5;
      const aArmX = lead ? lerp(0.5, -0.1, fall) : lerp(-0.9, -0.1, fall);
      const aArmZ = side * lerp(0.35, 0.9, fall);
      const aElbow = -lerp(0.6, 0.25, fall);

      thigh = lerp(thigh, aThigh, air);
      knee = lerp(knee, aKnee, air);
      ankle = lerp(ankle, aAnkle, air);
      armX = lerp(armX, aArmX, air);
      armZ = lerp(armZ, aArmZ, air);
      elbow = lerp(elbow, aElbow, air);
    }

    j.hip.rotation.x = thigh;
    j.knee.rotation.x = knee;
    j.ankle.rotation.x = ankle;
    j.shoulder.rotation.x = armX;
    j.shoulder.rotation.z = armZ;
    j.elbow.rotation.x = elbow;
  }

  // --- 몸통: 상하 반동, 골반/어깨 비틀기, 앞으로 기울기, 시선 고정 ---
  const ground = 1 - air;
  const bob =
    -(0.03 + 0.04 * r) * m +
    (0.025 + 0.03 * r) * m * Math.cos(2 * P);

  s.hips.position.y = HIP_Y + bob * ground - 0.04 * air;

  const hipYaw = -0.1 * Math.sin(P) * m * ground;
  const spineYaw = 0.16 * Math.sin(P) * m * ground;
  const lean = (0.03 + 0.17 * r) * m + 0.1 * air;

  s.hips.rotation.y = hipYaw;
  s.hips.rotation.z = 0.04 * Math.cos(P) * m * ground;

  s.spine.rotation.y = spineYaw;
  s.spine.rotation.z = -0.5 * s.hips.rotation.z;
  s.spine.rotation.x = lean + 0.015 * Math.sin(s.time * 1.8) * (1 - m); // 대기 중 숨쉬기

  s.head.rotation.y = -(hipYaw + spineYaw) * 0.8;
  s.head.rotation.x = -lean * 0.6;
}


// ============================================================
// GLB 캐릭터 (스킨드 메시 + AnimationMixer)
// ============================================================
const MODEL_URL = 'models/human_base.glb';
const JUMP_START_SKIP = 0.10; // jump_start 의 "웅크리는 준비" 구간은 게임에서 건너뜀(점프 입력 즉시 도약하므로)
const RUN_ENTER = 10.5;       // 이 속도를 넘으면 run
const RUN_LEAVE = 9.0;        // 이 속도 밑으로 내려가면 다시 walk
const CLIP_DUR = { walk: 1.0, run: 0.7 };

let glb = null;

// 팔다리 살집 (미터 단위로 겉면을 바깥으로 부풀림). 값을 키우면 더 두꺼워짐, 0이면 원래대로
export const BODY = {
  thigh: 0.030,    // 허벅지
  shin: 0.020,     // 종아리
  upperArm: 0.026, // 위팔
  foreArm: 0.018   // 아래팔
};

// GLB 의 스킨드 메시에서 팔다리 정점을 법선 방향으로 부풀려서 근육/살이 있는 느낌을 줌 (불러올 때 한 번만 실행)
function fleshenBody(scene) {
  scene.updateMatrixWorld(true);
  scene.traverse((m) => {
    if (!m.isSkinnedMesh || m.userData.fleshy) return;
    m.userData.fleshy = true;
    const geo = m.geometry, sk = m.skeleton;
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const ji = geo.attributes.skinIndex, jw = geo.attributes.skinWeight;
    if (!pos || !nor || !ji || !jw || !sk) return;

    const bones = sk.bones;
    const bpos = bones.map((b, i) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(sk.boneInverses[i]).invert()));
    const byName = new Map(bones.map((b, i) => [b.name, i]));
    const seg = new Array(bones.length).fill(null);
    const defs = [
      ['upper_arm_', 'forearm_', BODY.upperArm], ['forearm_', 'hand_', BODY.foreArm],
      ['thigh_', 'shin_', BODY.thigh], ['shin_', 'foot_', BODY.shin]
    ];
    for (const side of ['L', 'R']) {
      for (const [a, c, amt] of defs) {
        const ia = byName.get(a + side), ic = byName.get(c + side);
        if (ia === undefined || ic === undefined || !(amt > 0)) continue;
        const dir = bpos[ic].clone().sub(bpos[ia]);
        const len = dir.length();
        if (len < 1e-4) continue;
        seg[ia] = { p: bpos[ia], dir: dir.divideScalar(len), len, amt };
      }
    }

    // 같은 자리에 겹친 정점들의 법선을 평균내서 틈이 안 벌어지게 함
    const key = (i) => Math.round(pos.getX(i) * 2000) + ',' + Math.round(pos.getY(i) * 2000) + ',' + Math.round(pos.getZ(i) * 2000);
    const acc = new Map();
    for (let i = 0; i < pos.count; i++) {
      const k = key(i);
      let a = acc.get(k);
      if (!a) { a = new THREE.Vector3(); acc.set(k, a); }
      a.x += nor.getX(i); a.y += nor.getY(i); a.z += nor.getZ(i);
    }

    const bind = m.bindMatrix, bindInv = m.bindMatrixInverse;
    const v = new THREE.Vector3(), n = new THREE.Vector3(), d = new THREE.Vector3();
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(bind);
      n.copy(acc.get(key(i))).normalize();
      let amount = 0;
      for (let k = 0; k < 4; k++) {
        const w = jw.getComponent(i, k);
        if (w <= 0) continue;
        const sg = seg[ji.getComponent(i, k)];
        if (!sg) continue;
        const t = clamp(d.copy(v).sub(sg.p).dot(sg.dir) / sg.len, 0, 1);
        amount += w * sg.amt * (0.55 + 0.45 * Math.sin(Math.PI * t));   // 마디 중간이 제일 볼록, 관절 쪽은 덜 부풀림
      }
      if (amount > 0) {
        const inner = -Math.sign(v.x || 1) * n.x;                         // 몸 안쪽을 향한 면은 덜 부풀려서 다리/팔이 서로 파고들지 않게
        if (inner > 0) amount *= 1 - 0.8 * Math.min(1, inner);
        v.addScaledVector(n, amount);
      }
      v.applyMatrix4(bindInv);
      out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
    }
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
  });
}

export const humanReady = new GLTFLoader()
  .loadAsync(MODEL_URL)
  .then((g) => {
    try { fleshenBody(g.scene); } catch (e) { console.warn('팔다리 살집 적용 실패:', e); }
    glb = { scene: g.scene, clips: g.animations };
    return true;
  })
  .catch((err) => {
    console.warn('human_base.glb 로드 실패, 코드로 만든 캐릭터를 사용합니다:', err);
    return false;
  });

const glbMatCache = new Map();
function glbMaterial(color) {
  const c = new THREE.Color(BODY_COLOR);
  if (color !== 0xffffff) c.lerp(new THREE.Color(color), 0.4);
  const key = c.getHex();
  if (!glbMatCache.has(key)) glbMatCache.set(key, new THREE.MeshLambertMaterial({ color: c }));
  return glbMatCache.get(key);
}

function makeGlbHumanoid(color) {
  const root = SkeletonUtils.clone(glb.scene);
  const mat = glbMaterial(color);
  root.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.material = mat;
      o.frustumCulled = false; // 애니메이션 중 바운딩 박스를 벗어나도 사라지지 않게
    }
  });

  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const clip of glb.clips) {
    const a = mixer.clipAction(clip);
    if (clip.name === 'jump_start' || clip.name === 'jump_land' || clip.name === 'jump') {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    actions[clip.name] = a;
  }

  const rig = { kind: 'glb', mixer, actions, cur: null, state: '', stateTime: 0, wasGrounded: true };
  // 무기 장착/팔 포즈에 쓰는 뼈 (weapon.js)
  rig.bones = {
    upper: root.getObjectByName('upper_arm_R'),
    fore: root.getObjectByName('forearm_R'),
    hand: root.getObjectByName('hand_R'),
    spine: root.getObjectByName('spine_02')
  };
  root.userData.rig = rig;
  enterState(rig, 'idle', 0);
  return root;
}

function enterState(rig, name, fade = 0.15) {
  if (rig.state === name) return;
  const next = rig.actions[name];
  if (!next) return;
  const prev = rig.cur;

  next.reset();
  next.enabled = true;
  next.setEffectiveWeight(1);

  // walk <-> run 전환은 같은 보행 위상에서 이어붙임 (발이 튀지 않게)
  if (prev && CLIP_DUR[rig.state] && CLIP_DUR[name]) {
    const phase = (prev.time % CLIP_DUR[rig.state]) / CLIP_DUR[rig.state];
    next.time = phase * CLIP_DUR[name];
  }
  if (name === 'jump_start') next.time = JUMP_START_SKIP;

  if (prev && fade > 0) {
    next.fadeIn(fade);
    prev.fadeOut(fade);
  }
  next.play();

  rig.cur = next;
  rig.state = name;
  rig.stateTime = 0;
}

function animateGlb(avatar, dt, speed, grounded, vy) {
  const rig = avatar.userData.rig;
  dt = Math.min(Math.max(dt, 0), 0.1);
  const sp = Math.min(speed, GAIT.maxSpeed);
  const moving = sp > 0.4;
  rig.stateTime += dt;

  const jumpStartLen = (rig.actions.jump_start ? rig.actions.jump_start.getClip().duration : 0.3) - JUMP_START_SKIP;
  const landLen = rig.actions.jump_land ? rig.actions.jump_land.getClip().duration : 0.6;

  const loco = () => {
    if (!moving) return 'idle';
    const runNow = rig.state === 'run' ? sp > RUN_LEAVE : sp > RUN_ENTER;
    return runNow ? 'run' : 'walk';
  };

  if (!grounded) {
    // ---- 공중 ----
    if (rig.state === 'jump_start') {
      if (rig.stateTime >= jumpStartLen) enterState(rig, 'jump_air', 0.12);
    } else if (rig.state !== 'jump_air') {
      // 땅에서 위로 튀어오른 순간이면 도약 동작, 그냥 떨어지는 중이면 바로 공중 자세
      if (rig.wasGrounded && vy > 1.5) enterState(rig, 'jump_start', 0.08);
      else enterState(rig, 'jump_air', 0.15);
    }
  } else {
    // ---- 지상 ----
    if (rig.state === 'jump_air' || rig.state === 'jump_start') {
      enterState(rig, 'jump_land', 0.08);
    } else if (rig.state === 'jump_land') {
      // 이동 중이면 충격 흡수만 짧게 하고 달리기/걷기로 복귀
      if ((moving && rig.stateTime > 0.14) || rig.stateTime > landLen - 0.05) enterState(rig, loco(), 0.18);
    } else {
      enterState(rig, loco(), 0.2);
    }
  }
  rig.wasGrounded = grounded;

  // 걸음 속도에 맞춰 재생 속도 조절
  const hz = Math.min(Math.max(sp / GAIT.strideLen, GAIT.minHz), GAIT.maxHz);
  if (rig.state === 'walk') rig.cur.setEffectiveTimeScale(hz * CLIP_DUR.walk);
  else if (rig.state === 'run') {
    const rhz = Math.min(Math.max(sp / GAIT.runStrideLen, GAIT.runMinHz), GAIT.runMaxHz);
    rig.cur.setEffectiveTimeScale(rhz * CLIP_DUR.run);
  }
  else rig.cur.setEffectiveTimeScale(1);

  rig.mixer.update(dt);
}

// ============================================================
// 공개 API
// ============================================================
export function makeHumanoid(color = 0xffffff) {
  return glb ? makeGlbHumanoid(color) : makeProceduralHumanoid(color);
}

export function animateHumanoid(avatar, dt, speed, grounded = true, vy = 0) {
  const rig = avatar.userData.rig;
  if (!rig) return;
  if (rig.kind === 'glb') animateGlb(avatar, dt, speed, grounded, vy);
  else animateProcedural(avatar, dt, speed, grounded, vy);

  // 무기를 한 번이라도 만진 캐릭터만 (기존 애니메이션 직후에 팔 포즈를 덮어씀)
  if (rig.wp) updateWeapon(rig, dt, weaponLoco(rig));
}

// 무기 팔 포즈가 걷기/달리기 박자에 맞도록 현재 이동 상태를 알려 줌 (객체 재사용)
function weaponLoco(rig) {
  const l = rig.wpLoco || (rig.wpLoco = { run: 0, move: 0, phase: -1 });
  if (rig.kind === 'glb') {
    const st = rig.state;
    l.run = st === 'run' ? 1 : 0;
    l.move = st === 'walk' || st === 'run' ? 1 : 0;
    const dur = CLIP_DUR[st];
    l.phase = dur && rig.cur ? (rig.cur.time % dur) / dur : -1;
  } else {
    l.run = rig.run;
    l.move = rig.move > 0.5 ? 1 : 0;
    l.phase = rig.move > 0.05 ? (((rig.phase / (Math.PI * 2)) % 1) + 1) % 1 : -1;
  }
  return l;
}
