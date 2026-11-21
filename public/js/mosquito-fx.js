// 정글 모기떼 (화면 효과). 정글 안에서만 내 둘레(R_MAX 미터)에 수십 마리가 불규칙하게 날아다녀요.
//  - 일부러 아주 작게 그려서 가까이서만 보이고, 날개가 빠르게 파닥이며 반짝거려요
//  - 서버가 'mosq' 를 보내면 가까운 모기 한 마리가 내 왼팔에 내려앉아 피를 빨고(몸이 붉게 부풀어요) 잠시 뒤 날아가요
//  - 피해·출혈 판정은 전부 서버(server.js). 여기는 모양만이라서, 모기떼는 사람마다 자기 화면에만 보여요
// 사용: const fx = createMosquitoFx({ scene, T, avatar });  fx.bite({ land, perch });  매 프레임 fx.update(dt, me, 정글인지)
import * as THREE from 'three';
import { MOSQ } from './mosquito.mjs';

const R_MAX = 18;                      // 내 둘레 이 반지름 안에서만 그려요 (밖으로 나가면 반대편에서 다시 나타남)
const BODY_L = 0.03, BODY_W = 0.011;   // 몸 길이·굵기(m) — 아주 작음
const WING_L = 0.04, WING_W = 0.013;   // 날개 길이·폭(m)
const FLAP_HZ = 24;                    // 날갯짓 속도
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createMosquitoFx({ scene, T, avatar }) {
  const N = MOSQ.SWARM;

  const body = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
  const wingGeo = new THREE.PlaneGeometry(1, 1);
  wingGeo.rotateX(-Math.PI / 2);   // 눕혀서
  wingGeo.translate(0.5, 0, 0);    // 몸쪽 끝이 원점, 오른쪽으로 뻗음
  const wings = new THREE.InstancedMesh(wingGeo, new THREE.MeshBasicMaterial({ color: 0xdfe6ea, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }), N * 2);
  body.frustumCulled = false; wings.frustumCulled = false;
  const group = new THREE.Group();
  group.add(body, wings);
  group.visible = false;
  scene.add(group);

  const DARK = new THREE.Color(0x15130f), RED = new THREE.Color(0x6a0808), tmpC = new THREE.Color();
  for (let i = 0; i < N; i++) body.setColorAt(i, DARK);

  const ms = [];
  for (let i = 0; i < N; i++) {
    ms.push({
      x: 0, z: 0, gy: 0, gyT: 0, gt: rnd(0, 0.3), h: rnd(0.5, 3.0), a: rnd(0, TAU), sp: rnd(0.5, 1.3),
      p1: rnd(0, TAU), p2: rnd(0, TAU), p3: rnd(0, TAU), f1: rnd(0.6, 1.6), f2: rnd(1.5, 3.2), f3: rnd(2.5, 5), fp: rnd(0, TAU),
      red: 0, flee: 0, y: 0
    });
  }

  // ---- 행렬 계산용 임시 객체 ----
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), e1 = new THREE.Euler();
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
  const ONE = new THREE.Vector3(1, 1, 1), AXZ = new THREE.Vector3(0, 0, 1);
  const mBase = new THREE.Matrix4(), mWing = new THREE.Matrix4(), mTmp = new THREE.Matrix4(), mZero = new THREE.Matrix4().makeScale(0, 0, 0);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), arm = new THREE.Vector3(), armDir = new THREE.Vector3();

  function put(i, x, y, z, yaw, pitch, flap, fat) {
    q1.setFromEuler(e1.set(pitch, yaw, 0, 'YXZ'));
    v1.set(x, y, z);
    mBase.compose(v1, q1, v2.set(BODY_W * fat, BODY_W * fat, BODY_L));
    body.setMatrixAt(i, mBase);
    mBase.compose(v1, q1, ONE);
    for (let s = 1; s >= -1; s -= 2) {   // 오른쪽·왼쪽 날개: 위로 올라갔다 내려오며 파닥임
      q2.setFromAxisAngle(AXZ, s * flap);
      mWing.compose(v3.set(0, BODY_W * 0.4 * fat, 0), q2, v4.set(s * WING_L, 1, WING_W));
      mTmp.multiplyMatrices(mBase, mWing);
      wings.setMatrixAt(i * 2 + (s > 0 ? 0 : 1), mTmp);
    }
  }
  function hide(i) { body.setMatrixAt(i, mZero); wings.setMatrixAt(i * 2, mZero); wings.setMatrixAt(i * 2 + 1, mZero); }

  // 내 왼팔 가운데(팔꿈치~손목 사이)의 세계 좌표와 팔이 향한 방향
  function armPoint() {
    const rig = avatar.userData && avatar.userData.rig;
    let a = null, b = null;
    if (rig) {
      if (rig.kind === 'glb' && rig.sw) { a = rig.sw.forearm_L; b = rig.sw.hand_L; }
      else if (rig.L) { a = rig.L.elbow; b = rig.L.wrist; }
    }
    if (a && b) {
      a.getWorldPosition(A); b.getWorldPosition(B);
      armDir.copy(B).sub(A);
      if (armDir.lengthSq() > 1e-8) armDir.normalize(); else armDir.set(0, -1, 0);
      arm.copy(A).lerp(B, 0.5);
      arm.add(v1.set(0.045, 0.01, 0).applyQuaternion(avatar.quaternion));   // 팔 바깥쪽 살갗 위
      return true;
    }
    arm.copy(avatar.position).add(v1.set(0.3, 1.1, 0).applyQuaternion(avatar.quaternion));
    armDir.set(0, -1, 0);
    return false;
  }

  let tm = 0, wasActive = false, hiddenDone = false, colorDirty = false;
  let biter = null;   // { i, state: 'land' | 'perch', t, land, perch, sx, sy, sz }

  function ground(m, snap) {
    if (snap) { m.gyT = m.gy = T.height(m.x, m.z); m.gt = rnd(0.3, 0.45); return; }
    m.gt -= 0.016;
  }
  function scatter(me) {   // 정글에 들어온 순간 내 둘레에 흩뿌림
    for (let i = 0; i < N; i++) {
      const m = ms[i], r = Math.sqrt(rnd(0.02, 1)) * R_MAX, ang = rnd(0, TAU);
      m.x = me.x + Math.sin(ang) * r; m.z = me.z + Math.cos(ang) * r; m.a = rnd(0, TAU);
      m.flee = 0; ground(m, true);
    }
  }
  function respawn(m, me) {   // 너무 멀어진 모기는 반대편 가장자리에서 내 쪽으로 다시 날아옴
    const r = rnd(R_MAX * 0.55, R_MAX * 0.95), ang = rnd(0, TAU);
    m.x = me.x + Math.sin(ang) * r; m.z = me.z + Math.cos(ang) * r;
    m.a = Math.atan2(me.x - m.x, me.z - m.z) + rnd(-1.2, 1.2);
    ground(m, true);
  }

  // 서버가 "한 마리가 문다" 고 알려줌
  function bite(d) {
    if (biter) return;
    const land = d && d.land > 0 ? d.land : MOSQ.LAND_TIME, perch = d && d.perch > 0 ? d.perch : MOSQ.PERCH_TIME;
    armPoint();
    let pick = 0, best = Infinity;
    for (let i = 0; i < N; i++) {   // 팔에서 가장 가까운 모기
      const m = ms[i], dd = (m.x - arm.x) ** 2 + (m.z - arm.z) ** 2;
      if (dd < best) { best = dd; pick = i; }
    }
    const ang = rnd(0, TAU), r = rnd(1.0, 1.6);
    biter = { i: pick, state: 'land', t: 0, land, perch, sx: arm.x + Math.sin(ang) * r, sy: arm.y + rnd(0.2, 0.7), sz: arm.z + Math.cos(ang) * r };
    ms[pick].red = 0; ms[pick].flee = 0;
  }

  function update(dt, me, inJungle) {
    tm += dt;
    const active = !!inJungle;
    if (!active && !biter) {
      if (!hiddenDone) { for (let i = 0; i < N; i++) hide(i); body.instanceMatrix.needsUpdate = true; wings.instanceMatrix.needsUpdate = true; hiddenDone = true; }
      wasActive = false;
      group.visible = false;
      return;
    }
    group.visible = true;
    if (active && !wasActive) { scatter(me); hiddenDone = false; }
    wasActive = active;

    for (let i = 0; i < N; i++) {
      const m = ms[i];
      if (biter && biter.i === i) continue;   // 문 모기는 아래에서 따로 움직임
      if (!active) { hide(i); continue; }

      // 불규칙하게 휘어 날며 속도도 들쭉날쭉
      m.a += (Math.sin(tm * m.f1 + m.p1) * 2.4 + Math.sin(tm * m.f2 + m.p2) * 1.6) * dt;
      let spd = m.sp * (0.5 + 0.9 * Math.abs(Math.sin(tm * m.f3 + m.p3)));
      if (m.flee > 0) { m.flee -= dt; spd = 1.6; m.h = Math.min(3.2, m.h + 0.9 * dt); }   // 피를 빨고 떠나는 중
      m.x += Math.sin(m.a) * spd * dt; m.z += Math.cos(m.a) * spd * dt;
      const dx = m.x - me.x, dz = m.z - me.z;
      if (dx * dx + dz * dz > R_MAX * R_MAX) respawn(m, me);
      m.gt -= dt;
      if (m.gt <= 0) { m.gt = rnd(0.3, 0.45); m.gyT = T.height(m.x, m.z); }
      m.gy += (m.gyT - m.gy) * Math.min(1, dt * 5);
      m.y = clamp(m.gy + m.h + 0.2 * Math.sin(tm * m.f2 * 1.3 + m.p3), me.y - 0.5, me.y + 6);

      let fat = 1;
      if (m.red > 0) {   // 피를 빤 모기는 한동안 붉다가 서서히 원래 색으로
        m.red = Math.max(0, m.red - dt / 4);
        body.setColorAt(i, tmpC.copy(DARK).lerp(RED, m.red)); colorDirty = true;
        fat = 1 + 0.9 * m.red;
      }
      put(i, m.x, m.y, m.z, m.a, 0.2 * Math.sin(tm * m.f1 * 2 + m.p2), 0.15 + 0.85 * Math.sin(tm * TAU * FLAP_HZ + m.fp), fat);
    }

    if (biter) {
      const m = ms[biter.i];
      armPoint();
      biter.t += dt;
      if (biter.state === 'land') {   // 팔을 향해 날아와 내려앉음
        const k = Math.min(1, biter.t / biter.land), e = k * k * (3 - 2 * k), w = (1 - k) * 0.08;
        const x = biter.sx + (arm.x - biter.sx) * e + Math.sin(tm * 31) * w;
        const y = biter.sy + (arm.y - biter.sy) * e + Math.sin(tm * 27) * w;
        const z = biter.sz + (arm.z - biter.sz) * e + Math.cos(tm * 29) * w;
        put(biter.i, x, y, z, Math.atan2(arm.x - biter.sx, arm.z - biter.sz), 0.2, 0.15 + 0.85 * Math.sin(tm * TAU * FLAP_HZ), 1);
        m.x = x; m.z = z; m.y = y;
        if (biter.t >= biter.land) { biter.state = 'perch'; biter.t = 0; }
      } else {   // 앉아서 피를 빪: 날개 접고, 몸이 붉게 부풀어 오름
        const k = Math.min(1, biter.t / biter.perch);
        const yaw = Math.atan2(armDir.x, armDir.z), pitch = -Math.asin(clamp(armDir.y, -1, 1));
        body.setColorAt(biter.i, tmpC.copy(DARK).lerp(RED, k)); colorDirty = true;
        put(biter.i, arm.x, arm.y, arm.z, yaw, pitch, 0.12 + 0.06 * Math.sin(tm * 2.7), 1 + 0.9 * k);
        m.x = arm.x; m.z = arm.z; m.y = arm.y;
        if (biter.t >= biter.perch) {   // 배불러서 날아감 → 다시 모기떼 속으로
          m.red = 1; m.flee = 1.6;
          m.a = Math.atan2(arm.x - me.x, arm.z - me.z) + rnd(-0.8, 0.8);
          m.gyT = m.gy = T.height(m.x, m.z); m.gt = rnd(0.3, 0.45);
          m.h = clamp(arm.y - m.gy, 0.5, 3.0);
          biter = null;
        }
      }
    }

    body.instanceMatrix.needsUpdate = true;
    wings.instanceMatrix.needsUpdate = true;
    if (colorDirty && body.instanceColor) { body.instanceColor.needsUpdate = true; colorDirty = false; }
  }

  return { update, bite };
}
