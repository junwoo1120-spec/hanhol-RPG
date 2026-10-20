import * as THREE from 'three';

// ============================================================
// 사람 모양 캐릭터 (레퍼런스 시트 기반 무채색 마네킹)
// - 외부 모델 파일 없이 코드로 만든 관절 구조 (골반 / 척추 / 목 / 머리 / 팔 3마디 / 다리 3마디)
// - 걷기 / 달리기 / 점프 / 낙하 / 대기(숨쉬기) 애니메이션 포함
// ============================================================

// ---------- 조정용 값 ----------
export const GAIT = {
  strideLen: 4.2,  // 이동속도 / strideLen = 초당 걸음 주기. 값이 클수록 다리가 천천히 움직임
  minHz: 0.9,      // 최소 걸음 주기(초당)
  maxHz: 2.6,      // 최대 걸음 주기(초당)
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
    upperArm: limbGeo(0.047, 0.038, 0.29),
    foreArm: limbGeo(0.038, 0.027, 0.26),
    thigh: limbGeo(0.075, 0.055, 0.42),
    shin: limbGeo(0.055, 0.035, 0.40)
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
export function makeHumanoid(color = 0xffffff) {
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

    const hip = pivot(hips, side * 0.095, -0.05, 0);
    mesh(g.thigh, hip);

    const knee = pivot(hip, 0, -0.42, 0);
    mesh(g.shin, knee);

    const ankle = pivot(knee, 0, -0.4, 0);
    mesh(g.sphere, ankle, 0, -0.04, 0.035, 0.045, 0.04, 0.105);                   // 발
    mesh(g.sphere, ankle, 0, -0.058, 0.115, 0.038, 0.02, 0.04);                   // 발끝

    rig[side > 0 ? 'L' : 'R'] = { shoulder, elbow, hip, knee, ankle };
  }

  root.userData.rig = rig;
  return root;
}

// ---------- 애니메이션 ----------
// avatar: makeAvatar 가 만든 그룹 (userData.rig 를 가지고 있어야 함)
// speed: 수평 이동속도(유닛/초), grounded: 땅에 닿아있는지, vy: 수직 속도
export function animateHumanoid(avatar, dt, speed, grounded = true, vy = 0) {
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
