import * as THREE from 'three';

// ============================================================
// 무기 시스템 (테스트용 나무검 1종)
//
// - 나무검 3D 메시: 코드로 만든 BufferGeometry 1개 + 재질 1개를 모든 캐릭터가 공유 (캐릭터당 드로우콜 1)
// - 손에 장착: GLB 캐릭터는 hand_R 뼈, 코드 캐릭터(fallback)는 wrist 관절에 mount 를 붙임
// - 모션: 기존 걷기/달리기 클립 위에 "오른팔 + 상체 비틀기"만 덮어씀 (다리·왼팔·카메라·이동은 건드리지 않음)
// - 상태: NONE → EQUIPPING → READY(IDLE/WALKING/RUNNING) ⇄ ATTACKING → UNEQUIPPING → NONE
//
// 다른 파일에서 쓰는 함수: requestToggleWeapon / setRemoteWeapon / startWeaponAttack /
//   setWeaponHandlers / isWeaponEquipped / getWeaponStateName / resetWeapon  (+ character.js 가 updateWeapon 호출)
// 새 무기를 추가하려면 WEAPONS 표에 항목 하나(메시 빌더 + 손잡이 설정)를 더하면 됨.
// ============================================================

// ---------- 조정용 값 (코드에서 바로 고칠 수 있게 모아 둠) ----------
export const WEAPON_CFG = {
  equipTime: 0.75,     // 장착 모션 길이(초)
  unequipTime: 0.45,   // 해제 모션 길이(초)
  attack: {
    cooldown: 0.7,     // 공격 시작 → 다음 공격 시작 최소 간격(초)
    windup: 0.16,      // 준비 동작(검을 머리 위로)
    swing: 0.14,       // 휘두르기
    follow: 0.12,      // 후속 동작(휘두른 자세 유지)
    recover: 0.20,     // 원래 자세로 복귀
    buffer: 0.15       // 쿨다운이 끝나기 이 시간 전부터 들어온 입력은 1회만 예약
  },
  pump: { walk: 0.12, run: 0.35 },   // 걷기/달리기 중 검 든 팔의 앞뒤 흔들림 크기(라디안)
  sway: { walk: 0.10, run: 0.28 },   // 검 자체가 손목에서 위아래/좌우로 흔들리는 크기(라디안)
  keepBladeSteady: 0              // 0 = 검도 같이 흔들림, 1 = 팔이 흔들려도 검 각도 고정
};

// 손잡이(검 원점 = 손잡이 한가운데)가 손바닥 중앙에 오도록 하는 위치/각도.
//  pos  : 손 뼈 기준 위치(미터).  tilt: 검 좌표계 기준 추가 회전(라디안, XYZ) → 검이 거꾸로/비뚤게 보이면 여기서 조정
const GRIP = {
  glb:  { pos: [-0.03, -0.045, 0], tilt: [0, 0, 0] },
  proc: { pos: [0, -0.055, 0],     tilt: [0, 0, 0] }
};

// ---------- 작은 도우미 ----------
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ============================================================
// 1) 나무검 메시
//   검 좌표계: 원점 = 손잡이 중앙, 검날 방향 = +Y, 넓은 앞면 = +Z, 날 폭 = X
//   참고 이미지: 넓고 납작한 나무 날 / 비스듬히 잘린 끝 / 중앙 홈 / 가로 이음선 / 작은 못 /
//                짙은 갈색 작은 가드 / 밝은 나무 손잡이 / 붉은 갈색 네모 손잡이 끝
// ============================================================
const SWORD = {
  bladeBase: 0.10,   // 날 시작 높이(가드 속에 살짝 묻힘)
  bladeLen: 0.55,
  bladeHalfW: 0.048,
  bladeThick: 0.030,
  tipCut: 0.11       // 끝이 비스듬히 잘린 길이
};

const COL = {
  edge: '#a9693a', ridge: '#7e4b29', seamDark: 0.72,
  guard: '#5b3719', guardTop: '#7c4d28',
  grip: '#b17b49', band: '#6a4020',
  pommel: '#4a1d12', pommelTop: '#7a3a24',
  nail: '#9a9a9a'
};

function buildSwordGeometry() {
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  const rgb = (hex, mul = 1) => { c.set(hex); return [c.r * mul, c.g * mul, c.b * mul]; };

  const tri = (a, b, d, ca, cb, cd) => {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]);
    col.push(...ca, ...cb, ...cd);
  };
  const quad = (a, b, d, e, ca, cb, cd, ce) => { tri(a, b, d, ca, cb, cd); tri(a, d, e, ca, cd, ce); };

  // 직육면체 (위쪽 면만 조금 밝게, 옆면은 조금 어둡게 해서 나무 블록 느낌)
  const box = (cx, cy, cz, sx, sy, sz, hex, topHex) => {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const base = rgb(hex), side = rgb(hex, 0.86), top = rgb(topHex || hex, 1);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], base, base, base, base);   // +Z
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], side, side, side, side);   // -Z
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], side, side, side, side);   // +X
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side, side, side, side);   // -X
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, top, top, top);       // +Y
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], side, side, side, side);   // -Y
  };

  // --- 손잡이 / 가드 / 손잡이 끝 ---
  box(0, 0, 0, 0.036, 0.17, 0.044, COL.grip);
  box(0, -0.035, 0, 0.040, 0.012, 0.048, COL.band);
  box(0, 0.035, 0, 0.040, 0.012, 0.048, COL.band);
  box(0, 0.105, 0, 0.17, 0.04, 0.058, COL.guard, COL.guardTop);
  box(0, -0.11, 0, 0.062, 0.05, 0.062, COL.pommel, COL.pommelTop);

  // --- 검날: 단면(가운데가 솟은 6각형)을 길이 방향으로 이어 붙임 ---
  const { bladeBase: y0, bladeLen: L, bladeHalfW: hw, bladeThick: t, tipCut } = SWORD;
  const secs = [
    { y: 0, xl: -hw, xr: hw, m: 1 },
    { y: 0.29, xl: -hw, xr: hw, m: 1 },
    { y: 0.30, xl: -hw, xr: hw, m: COL.seamDark },     // 가로 이음선(얇은 어두운 줄)
    { y: 0.31, xl: -hw, xr: hw, m: 1 },
    { y: L - tipCut, xl: -hw, xr: hw, m: 1 },
    { y: L, xl: -hw, xr: -hw + 0.006, m: 1 }           // 왼쪽 위 모서리가 뾰족, 오른쪽은 비스듬히 잘림
  ];
  const ring = (s) => {
    const xm = (s.xl + s.xr) / 2, e = rgb(COL.edge, s.m), r = rgb(COL.ridge, s.m);
    return [
      { p: [s.xl, y0 + s.y, 0.3 * t], c: e }, { p: [xm, y0 + s.y, 0.5 * t], c: r }, { p: [s.xr, y0 + s.y, 0.3 * t], c: e },
      { p: [s.xr, y0 + s.y, -0.3 * t], c: e }, { p: [xm, y0 + s.y, -0.5 * t], c: r }, { p: [s.xl, y0 + s.y, -0.3 * t], c: e }
    ];
  };
  for (let i = 0; i < secs.length - 1; i++) {
    const A = ring(secs[i]), B = ring(secs[i + 1]);
    for (let k = 0; k < 6; k++) {
      const k2 = (k + 1) % 6;
      quad(A[k].p, A[k2].p, B[k2].p, B[k].p, A[k].c, A[k2].c, B[k2].c, B[k].c);
    }
  }

  // --- 못 (참고 이미지의 작은 금속 점) ---
  for (const ny of [0.20, 0.33, 0.41]) box(0.022, y0 + ny, 0.0125, 0.011, 0.011, 0.011, COL.nail);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();   // 인덱스 없는 메시라 면마다 normal 이 따로 계산됨 (각진 나무 느낌)
  geo.computeBoundingSphere();
  return geo;
}

// 공유 리소스 (처음 쓸 때 한 번만 생성)
let shared = null;
function sharedSword() {
  if (!shared) {
    shared = {
      geo: buildSwordGeometry(),
      // 광택 없는 무광 나무 재질 (Lambert + 정점 색)
      mat: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
    };
  }
  return shared;
}

// 검 좌표계(X=날 폭, Y=날 방향, Z=앞면) → 손 뼈 좌표계 회전
//   손 뼈에서 +Z = 몸이 바라보는 쪽(손가락이 펼쳐지는 방향) 이므로, 손잡이 축(검 Y)을 손 Z 에 맞추면 주먹이 손잡이를 감싸는 모양이 됨.
//   팔꿈치를 앞으로 굽히면 손 Z 가 위로 향해서 검날이 위를 보게 됨.
const BASIS = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, -1, 0),   // 검 X → 손 -Y
  new THREE.Vector3(0, 0, 1),    // 검 Y(날 방향) → 손 +Z
  new THREE.Vector3(-1, 0, 0)    // 검 Z(앞면) → 손 -X (바깥쪽)
);

// 무기 종류 표 (나중에 무기를 더할 때 여기에 추가)
const WEAPONS = {
  wooden_sword: { build: sharedSword, grip: GRIP }
};
const DEFAULT_WEAPON = 'wooden_sword';

// ============================================================
// 2) 팔 포즈 (오른팔 + 상체)   [upper x,y,z | fore x,y,z | hand x,y,z | chest(가산) x,y,z]
//    숫자는 GLB 뼈의 로컬 회전(라디안). x 음수 = 앞으로 올림/굽힘, z 양수 = 몸 쪽으로 모음, chest.y 양수 = 몸을 왼쪽으로 비틂
//    (FK 계산으로 검 위치·방향을 확인한 값)
// ============================================================
const POSE = {
  ready:  [-0.45, 0, 0.55,  -1.15, 0, 0.35,   0.45, 0.30, 0.15,   0, 0, 0],      // 검을 몸 앞에 세워 든 자세
  run:    [-0.45, 0, 0.60,  -1.45, 0, 0.45,   0.70, 0.30, 0.00,   0.02, 0, 0],   // 달릴 때: 팔을 더 접고 검을 앞으로 눕힘
  low:    [ 0.10, 0, 0.40,  -0.10, 0, 0.10,   1.00, 0, 0.00,   0, 0, 0]       // 장착 시작/해제 끝: 팔을 내리고 검끝이 아래
};
// 평타 2종 (번갈아 나감). 키프레임: windup(준비) → mid(휘두르는 중간) → end(끝) → follow(후속)
const SLASH = [
  { // 0) 오른쪽 위 → 왼쪽 아래
    windup: [-2.10, 0.2, 0.70,  -0.30, 0, 0.15,   0.10, 0.0, 0,  -0.05, -0.50, 0],
    mid:    [-1.20, 0.1, 0.90,  -0.35, 0, 0.10,   0.70, -0.3, 0,   0.10,  0.10, 0],
    end:    [-0.55, -0.1, 1.00, -0.10, 0, 0.10,   1.10, -0.6, 0,   0.20,  0.35, 0],
    follow: [-0.50, -0.1, 1.00, -0.15, 0, 0.10,   1.10, -0.6, 0,   0.20,  0.30, 0]
  },
  { // 1) 왼쪽 위 → 오른쪽 아래
    windup: [-1.90, -0.3, 1.50, -0.40, 0, 0.20,   0.20, 0.0, 0,  -0.05,  0.55, 0],
    mid:    [-1.20, -0.1, 0.70, -0.35, 0, 0.10,   0.70, 0.3, 0,   0.10, -0.10, 0],
    end:    [-0.55,  0.1, 0.30, -0.10, 0, 0.00,   1.10, -0.6, 0,   0.20, -0.40, 0],
    follow: [-0.50,  0.1, 0.30, -0.15, 0, 0.00,   1.10, -0.6, 0,   0.20, -0.35, 0]
  }
];
// 스킬 "휩쓸기": 몸을 오른쪽으로 크게 비틀었다가 검을 수평으로 왼쪽까지 휘두름 (몸통 비틀기가 주된 움직임)
const SWEEP_T = { windup: 0.20, swing: 0.28, follow: 0.20, recover: 0.25 };
const SWEEP = {
  windup: [-1.45,  0.25, 0.95,  -0.30, 0, 0.15,   1.00,  0.35, 0,   0.00, -0.95, 0],
  mid:    [-1.45,  0.00, 0.95,  -0.25, 0, 0.10,   1.00,  0.00, 0,   0.05,  0.05, 0],
  end:    [-1.40, -0.25, 0.95,  -0.25, 0, 0.10,   1.00, -0.40, 0,   0.10,  0.95, 0],
  follow: [-1.40, -0.25, 0.95,  -0.25, 0, 0.10,   1.00, -0.40, 0,   0.10,  0.90, 0]
};
const PROC_UPPER_Z = 0.61;   // 코드 캐릭터(fallback)는 팔이 곧게 내려가 있어서 GLB(A자 팔)보다 이만큼 덜 모음

export const WS = { NONE: 0, EQUIPPING: 1, READY: 2, ATTACKING: 3, UNEQUIPPING: 4 };

// ---------- 미리 만들어 두는 임시 객체 (프레임마다 새로 만들지 않음) ----------
const tmpE = new THREE.Euler();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpMul = new THREE.Quaternion();

function getWp(rig) {
  if (!rig.wp) {
    rig.wp = {
      kind: DEFAULT_WEAPON,
      mode: WS.NONE, t: 0, cd: 0, queued: false, want: false, hitDone: false, side: 0, nextSide: 0, sweep: false,
      armW: 0, runAmt: 0, moveAmt: 0, phase: 0, time: 0, scale: 1,
      mount: null,
      base: new Float32Array(12), pose: new Float32Array(12),
      onStart: null, onHit: null
    };
  }
  return rig.wp;
}

// 손(또는 손목)에 검 mount 를 한 번만 붙임. 이미 있으면 재사용 → 장착/해제를 반복해도 메시가 늘어나지 않음
function ensureMount(rig, wp) {
  if (wp.mount) return true;
  const glb = rig.kind === 'glb';
  const parent = glb ? rig.bones && rig.bones.hand : rig.R && rig.R.wrist;
  if (!parent) return false;

  const def = WEAPONS[wp.kind];
  const g = def.grip[glb ? 'glb' : 'proc'];
  const mount = new THREE.Group();
  mount.position.set(g.pos[0], g.pos[1], g.pos[2]);
  mount.quaternion.setFromRotationMatrix(BASIS);
  tmpE.set(g.tilt[0], g.tilt[1], g.tilt[2], 'XYZ');
  mount.quaternion.multiply(tmpQ.setFromEuler(tmpE));

  const s = def.build();
  const mesh = new THREE.Mesh(s.geo, s.mat);
  mesh.frustumCulled = false;
  mount.add(mesh);
  mount.visible = false;
  parent.add(mount);
  wp.mount = mount;
  return true;
}

function setMountScale(wp, s) {
  wp.scale = s;
  wp.mount.scale.setScalar(s);
}

// ============================================================
// 3) 공개 API
// ============================================================

// 내 캐릭터: 장착 ↔ 해제 토글. 모션 중(장착/해제/공격)이면 무시하고 null, 받아들이면 새 장착 여부(true/false) 반환
export function requestToggleWeapon(rig) {
  if (!rig) return null;
  const wp = getWp(rig);
  if (wp.mode === WS.EQUIPPING || wp.mode === WS.UNEQUIPPING || wp.mode === WS.ATTACKING) return null;
  if (!ensureMount(rig, wp)) return null;
  wp.want = !wp.want;
  return wp.want;
}

// 다른 플레이어: 서버가 알려 준 장착 여부로 맞춤. instant = 처음 보이는 순간(모션 없이 바로 든 상태)
export function setRemoteWeapon(rig, eq, instant = false) {
  if (!rig) return;
  eq = !!eq;
  if (!eq && !rig.wp) return;   // 한 번도 들지 않은 캐릭터는 아무 것도 만들지 않음
  const wp = getWp(rig);
  if (!eq && !wp.want && wp.mode === WS.NONE) return;
  if (!ensureMount(rig, wp)) return;
  wp.want = eq;
  if (instant && eq && wp.mode === WS.NONE) {
    wp.mode = WS.READY; wp.t = 0; wp.armW = 1;
    wp.mount.visible = true; setMountScale(wp, 1);
  }
}

// 평타 시작. 성공하면 true. remote=true 면 서버가 허용한 공격이므로 쿨다운을 다시 검사하지 않음
export function startWeaponAttack(rig, remote = false, side = -1) {
  const wp = rig && rig.wp;
  if (!wp || !wp.want) return false;
  if (wp.mode === WS.READY && (remote || wp.cd <= 0)) {
    beginAttack(wp, remote && (side === 0 || side === 1) ? side : wp.nextSide);   // 다른 플레이어는 서버가 알려 준 방향으로
    return true;
  }
  // 쿨다운 끝나기 직전 입력은 1회만 예약 (불리언이라 여러 번 눌러도 쌓이지 않음)
  if (!remote && wp.mode === WS.ATTACKING && wp.cd <= WEAPON_CFG.attack.buffer) wp.queued = true;
  if (!remote && wp.mode === WS.READY && wp.cd <= WEAPON_CFG.attack.buffer) wp.queued = true;
  return false;
}

// 스킬 "휩쓸기" 모션 시작. 성공하면 true (장착 중이고 장착/해제 모션이 아닐 때). 평타 도중이면 끊고 시작.
// remote=true 면 서버가 허용한 스킬이므로 쿨다운을 다시 검사하지 않음
export function startWeaponSweep(rig, remote = false) {
  const wp = rig && rig.wp;
  if (!wp || !wp.want) return false;
  if (wp.mode === WS.ATTACKING && wp.sweep) return false;   // 이미 휩쓸기 중
  if (wp.mode === WS.READY ? (remote || wp.cd <= 0) : wp.mode === WS.ATTACKING) {
    beginAttack(wp, 0, true);
    return true;
  }
  return false;
}

// 공격 시작/타격 프레임 콜백 등록 (null 로 해제). 타격 프레임은 "시각상 휘두른 순간" 알림일 뿐, 피해 확정은 서버 몫
export function setWeaponHandlers(rig, { onStart = null, onHit = null } = {}) {
  const wp = getWp(rig);
  wp.onStart = onStart;
  wp.onHit = onHit;
}

export function isWeaponEquipped(rig) { return !!(rig && rig.wp && rig.wp.want); }

export function getWeaponStateName(rig) {
  const wp = rig && rig.wp;
  if (!wp || wp.mode === WS.NONE) return 'UNEQUIPPED';
  if (wp.mode === WS.EQUIPPING) return 'EQUIPPING';
  if (wp.mode === WS.UNEQUIPPING) return 'UNEQUIPPING';
  if (wp.mode === WS.ATTACKING) return 'ATTACKING';
  return wp.runAmt > 0.5 ? 'RUNNING' : wp.moveAmt > 0.5 ? 'WALKING' : 'IDLE';
}

// 재접속/재생성/일시정지 복구용: 모든 상태를 처음으로
export function resetWeapon(rig) {
  const wp = rig && rig.wp;
  if (!wp) return;
  wp.mode = WS.NONE; wp.t = 0; wp.cd = 0; wp.queued = false; wp.want = false; wp.hitDone = false; wp.armW = 0; wp.sweep = false;
  if (wp.mount) wp.mount.visible = false;
}

function beginAttack(wp, side, sweep = false) {
  wp.sweep = sweep;
  wp.side = side;
  if (!sweep) wp.nextSide = 1 - side;   // 다음 평타는 반대 방향
  wp.mode = WS.ATTACKING;
  wp.t = 0;
  wp.cd = sweep ? 0.9 : WEAPON_CFG.attack.cooldown;
  wp.queued = false;
  wp.hitDone = false;
  if (wp.onStart && !sweep) wp.onStart(side);   // 휩쓸기는 'atk' 대신 스킬 이벤트로 따로 알림
}

// ============================================================
// 4) 매 프레임 갱신 (character.js 의 animateHumanoid 에서 기존 애니메이션 직후 호출)
//    loco: { run: 0|1(달리기 중), move: 0|1(걷기/달리기 중), phase: 0~1 걸음 위상, 정지면 -1 }
// ============================================================
export function updateWeapon(rig, dt, loco) {
  const wp = rig.wp;
  if (!wp || !wp.mount) return;
  dt = clamp(dt, 0, 0.1);

  const A = WEAPON_CFG.attack;
  wp.time += dt;
  wp.cd = Math.max(0, wp.cd - dt);
  wp.runAmt = damp(wp.runAmt, loco.run, 8, dt);
  wp.moveAmt = damp(wp.moveAmt, loco.move, 10, dt);
  if (loco.phase >= 0) wp.phase = loco.phase;

  // ---- 상태 전환 ----
  switch (wp.mode) {
    case WS.NONE:
      if (wp.want) {
        wp.mode = WS.EQUIPPING; wp.t = 0;
        wp.mount.visible = true; setMountScale(wp, 0.2);
      }
      break;
    case WS.EQUIPPING:
      wp.t += dt;
      if (wp.t >= WEAPON_CFG.equipTime) { wp.mode = WS.READY; wp.t = 0; setMountScale(wp, 1); }
      break;
    case WS.READY:
      if (!wp.want) { wp.mode = WS.UNEQUIPPING; wp.t = 0; wp.queued = false; }
      else if (wp.queued && wp.cd <= 0) beginAttack(wp, wp.nextSide);
      break;
    case WS.ATTACKING: {
      const AT = wp.sweep ? SWEEP_T : A;
      wp.t += dt;
      if (!wp.hitDone && wp.t >= AT.windup + AT.swing * 0.5) {
        wp.hitDone = true;
        if (wp.onHit && !wp.sweep) wp.onHit();
      }
      if (wp.t >= AT.windup + AT.swing + AT.follow + AT.recover) { wp.mode = WS.READY; wp.t = 0; wp.sweep = false; }
      break;
    }
    case WS.UNEQUIPPING:
      wp.t += dt;
      if (wp.t >= WEAPON_CFG.unequipTime) { wp.mode = WS.NONE; wp.t = 0; wp.mount.visible = false; }
      break;
  }

  // 팔 덮어쓰기 가중치: 장착 중엔 1, 해제가 끝나면 부드럽게 0 (기존 클립 팔로 튀지 않고 돌아감)
  wp.armW = damp(wp.armW, wp.mode === WS.NONE ? 0 : 1, 14, dt);
  if (wp.mode === WS.NONE && wp.armW < 0.005) { wp.armW = 0; return; }

  // ---- 기본 자세(들고 있는 자세 + 걷기/달리기 흔들림) ----
  const base = wp.base, pose = wp.pose;
  const r = wp.runAmt, m = wp.moveAmt;
  for (let i = 0; i < 12; i++) base[i] = lerp(POSE.ready[i], POSE.run[i], r);
  const amp = lerp(WEAPON_CFG.pump.walk, WEAPON_CFG.pump.run, r) * m;
  const s = Math.sin(wp.phase * TAU);
  const dux = -amp * s;                                   // 다리와 같은 박자로 위팔이 앞뒤로
  base[0] += dux;
  base[6] -= dux * WEAPON_CFG.keepBladeSteady;            // 손목이 보정해서 검 각도는 거의 그대로
  base[3] -= amp * 0.4 * (0.5 + 0.5 * Math.cos(wp.phase * TAU));
  // 검 흔들림: 걸음마다 위아래로 출렁(2배 박자) + 좌우로 흔들 → 달릴수록 크게
  const sw = lerp(WEAPON_CFG.sway.walk, WEAPON_CFG.sway.run, r) * m;
  base[6] += sw * Math.cos(wp.phase * TAU * 2);
  base[7] += sw * 0.8 * Math.sin(wp.phase * TAU + 1.0);
  base[3] += sw * 0.6 * Math.cos(wp.phase * TAU * 2 + 0.5);
  const breath = Math.sin(wp.time * 1.8) * (1 - m);       // 정지 중 아주 작은 호흡
  base[0] += 0.012 * breath;
  base[9] += 0.01 * breath;

  // ---- 상태별 최종 자세 ----
  let sc = 1;
  switch (wp.mode) {
    case WS.EQUIPPING: {
      const u = wp.t / WEAPON_CFG.equipTime;
      sc = 0.2 + 0.8 * smooth(0, 0.3, u);                 // 검이 손 안에서 커지며 나타남 (순간이동 없음)
      const k = smooth(0.2, 1, u);
      for (let i = 0; i < 12; i++) pose[i] = lerp(POSE.low[i], base[i], k);
      break;
    }
    case WS.UNEQUIPPING: {
      const u = wp.t / WEAPON_CFG.unequipTime;
      sc = 1 - 0.95 * smooth(0.6, 1, u);
      const k = smooth(0, 0.7, u);
      for (let i = 0; i < 12; i++) pose[i] = lerp(base[i], POSE.low[i], k);
      break;
    }
    case WS.ATTACKING: {
      const t = wp.t;
      const AT = wp.sweep ? SWEEP_T : A;
      const t1 = AT.windup, t2 = t1 + AT.swing * 0.5, t3 = t1 + AT.swing, t4 = t3 + AT.follow, t5 = t4 + AT.recover;
      const S = wp.sweep ? SWEEP : SLASH[wp.side];
      let a, b, k;
      if (t < t1)      { a = base;     b = S.windup; k = smooth(0, 1, t / t1); }
      else if (t < t2) { a = S.windup; b = S.mid;    k = (t - t1) / (t2 - t1); }
      else if (t < t3) { a = S.mid;    b = S.end;    k = (t - t2) / (t3 - t2); }
      else if (t < t4) { a = S.end;    b = S.follow; k = smooth(0, 1, (t - t3) / (t4 - t3)); }
      else             { a = S.follow; b = base;     k = smooth(0, 1, (t - t4) / (t5 - t4)); }
      for (let i = 0; i < 12; i++) pose[i] = lerp(a[i], b[i], k);
      break;
    }
    case WS.NONE:
      for (let i = 0; i < 12; i++) pose[i] = POSE.low[i];  // 해제 직후 가중치가 0 으로 줄어드는 동안 유지
      sc = 0.05;
      break;
    default:
      for (let i = 0; i < 12; i++) pose[i] = base[i];
  }
  if (wp.scale !== sc) setMountScale(wp, sc);

  applyPose(rig, pose, wp.armW);
}

function blendBone(bone, x, y, z, w) {
  tmpE.set(x, y, z, 'XYZ');
  bone.quaternion.slerp(tmpQ2.setFromEuler(tmpE), w);
}

// 이미 이번 프레임의 기존 애니메이션이 적용된 뼈 위에 덮어씀 → 매 프레임 클립이 값을 다시 써 주므로 회전이 누적되지 않음
function applyPose(rig, p, w) {
  if (rig.kind === 'glb') {
    const b = rig.bones;
    if (!b || !b.upper || !b.fore || !b.hand || !b.spine) return;
    blendBone(b.upper, p[0], p[1], p[2], w);
    blendBone(b.fore, p[3], p[4], p[5], w);
    blendBone(b.hand, p[6], p[7], p[8], w);
    tmpE.set(p[9] * w, p[10] * w, p[11] * w, 'XYZ');       // 상체는 원래 동작에 비틀기만 더함
    b.spine.quaternion.multiply(tmpMul.setFromEuler(tmpE));
  } else if (rig.R) {
    const J = rig.R;
    J.shoulder.rotation.x = lerp(J.shoulder.rotation.x, p[0], w);
    J.shoulder.rotation.y = lerp(J.shoulder.rotation.y, p[1], w);
    J.shoulder.rotation.z = lerp(J.shoulder.rotation.z, p[2] - PROC_UPPER_Z, w);
    J.elbow.rotation.x = lerp(J.elbow.rotation.x, p[3], w);
    J.elbow.rotation.y = lerp(J.elbow.rotation.y, p[4], w);
    J.elbow.rotation.z = lerp(J.elbow.rotation.z, p[5], w);
    J.wrist.rotation.set(p[6] * w, p[7] * w, p[8] * w);
    rig.spine.rotation.x += p[9] * w;
    rig.spine.rotation.y += p[10] * w;
    rig.spine.rotation.z += p[11] * w;
  }
}
