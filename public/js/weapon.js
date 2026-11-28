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

function buildSwordGeometry(pal = COL, S = SWORD, stone = false, smooth = false) {   // pal = 색, S = 날 크기, stone = 돌 느낌(날을 잘게 나눠 점마다 색을 불규칙하게 + 끝이 뾰족 + 이음선·못 없음), smooth = true 면 색 얼룩 없이 매끈하게(철검)
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
  box(0, 0, 0, 0.036, 0.17, 0.044, pal.grip);
  box(0, -0.035, 0, 0.040, 0.012, 0.048, pal.band);
  box(0, 0.035, 0, 0.040, 0.012, 0.048, pal.band);
  box(0, 0.105, 0, 0.17, 0.04, 0.058, pal.guard, pal.guardTop);
  box(0, -0.11, 0, 0.062, 0.05, 0.062, pal.pommel, pal.pommelTop);

  // --- 검날: 단면(가운데가 솟은 6각형)을 길이 방향으로 이어 붙임 ---
  const { bladeBase: y0, bladeLen: L, bladeHalfW: hw, bladeThick: t, tipCut } = S;
  let secs = stone ? [
    { y: 0, xl: -hw, xr: hw, m: 1 },
    { y: L - tipCut, xl: -hw, xr: hw, m: 1 },
    { y: L, xl: -0.004, xr: 0.004, m: 1 }                 // 뾰족한 끝
  ] : [
    { y: 0, xl: -hw, xr: hw, m: 1 },
    { y: 0.29, xl: -hw, xr: hw, m: 1 },
    { y: 0.30, xl: -hw, xr: hw, m: pal.seamDark },     // 가로 이음선(얇은 어두운 줄)
    { y: 0.31, xl: -hw, xr: hw, m: 1 },
    { y: L - tipCut, xl: -hw, xr: hw, m: 1 },
    { y: L, xl: -hw, xr: -hw + 0.006, m: 1 }           // 왼쪽 위 모서리가 뾰족, 오른쪽은 비스듬히 잘림
  ];
  if (stone) {   // 날을 잘게 나눠야 점마다 다른 색이 얼룩덜룩한 돌처럼 보여요
    const sub = [];
    for (let i = 0; i < secs.length - 1; i++) for (let k = 0; k < 6; k++) {
      const f = k / 6, A = secs[i], B = secs[i + 1];
      sub.push({ y: A.y + (B.y - A.y) * f, xl: A.xl + (B.xl - A.xl) * f, xr: A.xr + (B.xr - A.xr) * f, m: 1 });
    }
    sub.push(secs[secs.length - 1]);
    secs = sub;
  }
  const ring = (s) => {
    const xm = (s.xl + s.xr) / 2, e = rgb(pal.edge, s.m), r = rgb(pal.ridge, s.m);
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

  // --- 못 (참고 이미지의 작은 금속 점) / 돌 검은 대신 날을 손잡이에 묶은 가죽 끈 ---
  if (stone) {
    for (const dy of [0.0, 0.03, 0.06]) box(0, y0 + 0.02 + dy, 0, hw * 2 + 0.012, 0.018, t + 0.014, pal.cord);
    const hash = (x, y, z) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return v - Math.floor(v); };
    for (let i = 0; i < pos.length; i += 3) {   // 점마다 밝기를 불규칙하게: 거친 돌 느낌
      const h = hash(Math.round(pos[i] * 160), Math.round(pos[i + 1] * 160), Math.round(pos[i + 2] * 160)), m = smooth ? 1 : 0.80 + h * 0.34;
      col[i] *= m; col[i + 1] *= m; col[i + 2] *= m;
    }
  } else for (const ny of [0.20, 0.33, 0.41]) box(0.022, y0 + ny, 0.0125, 0.011, 0.011, 0.011, pal.nail);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();   // 인덱스 없는 메시라 면마다 normal 이 따로 계산됨 (각진 나무 느낌)
  geo.computeBoundingSphere();
  return geo;
}

// 돌 검: 나무검과 같은 모양이지만 회색 돌 날 + 굵고 뾰족한 날 + 가죽 감김 손잡이 (크기는 나무검보다 날이 조금 넓고 두꺼움)
const STONE_SWORD = { bladeBase: 0.10, bladeLen: 0.60, bladeHalfW: 0.058, bladeThick: 0.042, tipCut: 0.10 };
const STONE_COL = {
  edge: '#b3b6bb', ridge: '#80848b', seamDark: 1,
  guard: '#4b3a2a', guardTop: '#6b553c',
  grip: '#6e4d2e', band: '#2f2113',
  pommel: '#3d4046', pommelTop: '#5f636b',
  nail: '#c9c9c9', cord: '#8a6b3f'
};

// 철검: 돌 검과 같은 굵고 뾰족한 모양이지만 더 하얀 은빛 + 매끈한 날 + 반짝이는 광택 재질
const IRON_SWORD = { bladeBase: 0.10, bladeLen: 0.64, bladeHalfW: 0.056, bladeThick: 0.036, tipCut: 0.10 };
const IRON_COL = {
  edge: '#f4f7fb', ridge: '#b9c2cf', seamDark: 1,
  guard: '#7f8b9a', guardTop: '#c7d0db',
  grip: '#4d3a2b', band: '#241812',
  pommel: '#76818f', pommelTop: '#c2cbd6',
  nail: '#e6eaf0', cord: '#8b6b45'
};

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

// ============================================================
// 1-2) 오크 도끼 메시 (참고 그림: 회색 강철 날 + 짙은 쇠 머리통 + 나무 자루 + 쇠 띠 + 가죽 감김)
//   좌표계는 검과 같아요. 원점 = 손잡이 가운데(쥐는 곳), 자루/머리 방향 = +Y, 날이 뻗는 쪽(베는 쪽) = +X, 납작한 면 = ±Z
//   (휘두르는 방향 = +X 이므로, 아래 모션 표의 자세는 '날이 앞서 나가도록' 손목 각도를 맞춰 둔 것)
// ============================================================
const AXE_SCALE = 1.4;   // 오크 도끼 크기 배율 (1 = 처음 크기)
const AXE_COL = {   // 오래 써서 낡은 색: 메마른 어두운 나무, 해진 가죽, 녹슬어 칙칙한 쇠 (밝게 반짝이던 날도 무디게)
  wood: '#5c3d20', woodTop: '#79552f', woodDark: '#432b16', flare: '#4d3219',
  wrap: '#4d3f30', wrapDark: '#352a1f',
  iron: '#3b3937', ironTop: '#57524c', rivet: '#6d6252',
  steelIn: '#48443f', steelMid: '#665f55', steelEdge: '#948a7b', steelDark: '#33302d'
};

function buildAxeGeometry() {
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  const rgb = (hex, mul = 1) => { c.set(hex); return [c.r * mul, c.g * mul, c.b * mul]; };
  const tri = (a, b, d, ca, cb, cd) => { pos.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]); col.push(...ca, ...cb, ...cd); };
  const quad = (a, b, d, e, ca, cb, cd, ce) => { tri(a, b, d, ca, cb, cd); tri(a, d, e, ca, cd, ce); };
  const box = (cx, cy, cz, sx, sy, sz, hex, topHex) => {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const base = rgb(hex), side = rgb(hex, 0.84), top = rgb(topHex || hex, 1);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], base, base, base, base);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], side, side, side, side);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], side, side, side, side);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side, side, side, side);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, top, top, top);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], side, side, side, side);
  };

  // --- 나무 자루 (아래 끝이 살짝 굵고, 위 끝이 머리통 위로 조금 튀어나옴) ---
  box(0, 0.19, 0, 0.034, 0.80, 0.034, AXE_COL.wood, AXE_COL.woodTop);      // y -0.21 ~ 0.59
  box(0, -0.205, 0, 0.052, 0.07, 0.052, AXE_COL.flare, AXE_COL.woodTop);   // 아래 끝 손잡이 마디
  // --- 가죽 감김 (쥐는 곳): 짙고 옅은 띠를 번갈아 ---
  for (let i = 0; i < 7; i++) {
    const y = -0.12 + i * 0.03;
    box(0, y, 0, 0.045, 0.026, 0.045, i % 2 ? AXE_COL.wrapDark : AXE_COL.wrap);
  }
  // --- 쇠 띠 두 개 ---
  box(0, 0.115, 0, 0.050, 0.030, 0.050, AXE_COL.iron, AXE_COL.ironTop);
  box(0, 0.255, 0, 0.052, 0.030, 0.052, AXE_COL.iron, AXE_COL.ironTop);

  // --- 머리통(쇠 덩어리) + 뒤쪽 뭉툭한 면 + 리벳 ---
  box(0.005, 0.40, 0, 0.115, 0.25, 0.058, AXE_COL.iron, AXE_COL.ironTop);     // y 0.275 ~ 0.525, x -0.052 ~ 0.062
  box(-0.062, 0.40, 0, 0.026, 0.19, 0.050, AXE_COL.steelDark, AXE_COL.iron);  // 뒤쪽(-X) 뭉툭한 면
  box(0.002, 0.40, 0.031, 0.016, 0.016, 0.010, AXE_COL.rivet);                // 앞면 리벳
  box(0.002, 0.40, -0.031, 0.016, 0.016, 0.010, AXE_COL.rivet);               // 뒷면 리벳

  // --- 강철 날: 반달 모양. 안쪽 선(머리통에 붙는 쪽)과 바깥 날 선을 같은 간격으로 나눠 가로줄(rung)로 이음 ---
  const inner = [[0.20, 0.60], [0.115, 0.55], [0.062, 0.50], [0.062, 0.45], [0.062, 0.40], [0.062, 0.35], [0.062, 0.30], [0.09, 0.24], [0.15, 0.17]];
  const edge  = [[0.20, 0.60], [0.238, 0.565], [0.262, 0.52], [0.262, 0.46], [0.292, 0.40], [0.250, 0.34], [0.258, 0.28], [0.222, 0.22], [0.15, 0.17]];   // 날이 이가 빠지고 여기저기 찌그러짐
  const rung = (i, side) => {
    const a = inner[i], b = edge[i];
    const tIn = i === 0 || i === inner.length - 1 ? 0.002 : 0.017;   // 안쪽 두께 (뿔 끝은 뾰족)
    const tEd = 0.0035;                                                // 날 끝은 얇게
    return [
      [a[0], a[1], side * tIn, rgb(i % 2 ? AXE_COL.steelIn : AXE_COL.steelDark, 1)],
      [(a[0] * 0.45 + b[0] * 0.55), (a[1] * 0.45 + b[1] * 0.55), side * (tIn * 0.55 + tEd * 0.45), rgb(AXE_COL.steelMid, 1)],
      [b[0], b[1], side * tEd, rgb(AXE_COL.steelEdge, 1)]
    ];
  };
  for (let i = 0; i < inner.length - 1; i++) {
    for (const side of [1, -1]) {
      const A = rung(i, side), B = rung(i + 1, side);
      for (let k = 0; k < 2; k++) {
        quad([A[k][0], A[k][1], A[k][2]], [A[k + 1][0], A[k + 1][1], A[k + 1][2]],
             [B[k + 1][0], B[k + 1][1], B[k + 1][2]], [B[k][0], B[k][1], B[k][2]],
             A[k][3], A[k + 1][3], B[k + 1][3], B[k][3]);
      }
    }
    // 날 끝(가장자리) 얇은 면
    const e0 = edge[i], e1 = edge[i + 1], ce = rgb(AXE_COL.steelEdge, 1.05);
    quad([e0[0], e0[1], 0.0035], [e0[0], e0[1], -0.0035], [e1[0], e1[1], -0.0035], [e1[0], e1[1], 0.0035], ce, ce, ce, ce);
  }

  // --- 낡은 느낌: 점마다 밝기를 불규칙하게 얼룩지게 하고, 쇠 부분(색이 거의 회색인 곳)에는 녹이 번지게 ---
  const rustC = new THREE.Color('#7a4526');
  const hash = (x, y, z) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return v - Math.floor(v); };
  for (let i = 0; i < pos.length; i += 3) {
    const h = hash(Math.round(pos[i] * 90), Math.round(pos[i + 1] * 90), Math.round(pos[i + 2] * 90));
    const r = col[i], g = col[i + 1], b = col[i + 2];
    const mx = Math.max(r, g, b), grey = mx > 0 && (mx - Math.min(r, g, b)) / mx < 0.5;
    const m = 0.78 + h * 0.3;
    let nr = r * m, ng = g * m, nb = b * m;
    if (grey && h > 0.45) { const t = (h - 0.45) * 1.1; nr += (rustC.r - nr) * t; ng += (rustC.g - ng) * t; nb += (rustC.b - nb) * t; }
    col[i] = nr; col[i + 1] = ng; col[i + 2] = nb;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.scale(AXE_SCALE, AXE_SCALE, AXE_SCALE);   // 손잡이 가운데(원점) 기준으로 키움
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

let sharedAxeRes = null;
function sharedAxe() {
  if (!sharedAxeRes) sharedAxeRes = { geo: buildAxeGeometry(), mat: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }) };
  return sharedAxeRes;
}

// 검 좌표계(X=날 폭, Y=날 방향, Z=앞면) → 손 뼈 좌표계 회전
//   손 뼈에서 +Z = 몸이 바라보는 쪽(손가락이 펼쳐지는 방향) 이므로, 손잡이 축(검 Y)을 손 Z 에 맞추면 주먹이 손잡이를 감싸는 모양이 됨.
//   팔꿈치를 앞으로 굽히면 손 Z 가 위로 향해서 검날이 위를 보게 됨.
const BASIS = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, -1, 0),   // 검 X → 손 -Y
  new THREE.Vector3(0, 0, 1),    // 검 Y(날 방향) → 손 +Z
  new THREE.Vector3(-1, 0, 0)    // 검 Z(앞면) → 손 -X (바깥쪽)
);

let sharedStone = null;
function sharedStoneSword() {
  if (!sharedStone) sharedStone = { geo: buildSwordGeometry(STONE_COL, STONE_SWORD, true), mat: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }) };
  return sharedStone;
}

let sharedIron = null;
function sharedIronSword() {   // 철검: Phong 재질이라 빛을 받으면 날이 반짝여요
  if (!sharedIron) sharedIron = { geo: buildSwordGeometry(IRON_COL, IRON_SWORD, true, true), mat: new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide, specular: 0xffffff, shininess: 120, emissive: 0x1a1e24 }) };
  return sharedIron;
}

// 무기 종류 표 (나중에 무기를 더할 때 여기에 추가)
const WEAPONS = {
  wooden_sword: { build: sharedSword, grip: GRIP },
  iron_sword: { build: sharedIronSword, grip: GRIP },   // 철검 (대장간 제작 장비). 모션은 나무검과 같음
  stone_sword: { build: sharedStoneSword, grip: GRIP },   // 돌 검 (대장간 제작 장비). 모션은 나무검과 같음(공격 속도 동일)
  orc_axe: { build: sharedAxe, grip: GRIP }   // 오크 도끼 (보스 드랍 장비). 모션은 아래 MOTION 표
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
// 스킬 "휩쓸기": 몸을 왼쪽으로 크게 비틀었다가 검을 수평으로 왼쪽에서 오른쪽으로 휘두름 (몸통 비틀기가 주된 움직임)
const SWEEP_T = { windup: 0.10, swing: 0.16, follow: 0.12, recover: 0.20 };   // 평타보다 훨씬 빠름
const SWEEP = {
  windup: [-1.45, -0.25, 0.95,  -0.30, 0, 0.15,   1.00, -0.35, 0,   0.00,  0.95, 0],
  mid:    [-1.45,  0.00, 0.95,  -0.25, 0, 0.10,   1.00,  0.00, 0,   0.05, -0.05, 0],
  end:    [-1.40,  0.25, 0.95,  -0.25, 0, 0.10,   1.00,  0.40, 0,   0.10, -0.95, 0],
  follow: [-1.40,  0.25, 0.95,  -0.25, 0, 0.10,   1.00,  0.40, 0,   0.10, -0.90, 0]
};
// ---------- 오크 도끼 모션 ----------
// 도끼는 '날이 앞서 나가도록' 손목 각도를 맞춰서(FK 계산으로 확인) 머리가 앞으로 호를 그리며 지나가요.
//  · 평타 0: 머리 위에서 앞으로 내려치는 세로 베기      · 평타 1: 오른쪽 위 → 왼쪽 아래로 비스듬히 내려치기
//  · 휩쓸기: 몸을 크게 비틀며 도끼를 수평으로 한 바퀴    · 내려찍기: 도끼를 머리 위로 번쩍 들었다가 앞 땅을 힘껏 내려찍음
const AXE = {
  slash: [
    { windup: [-1.94, 0.18, 0.95, -0.19, -0.06, 0.09, 0.47, -0.47, -0.40, -0.50, -0.51, 0.00],
      mid:    [-1.29, 0.15, 0.72,  0.00, -0.15, 0.13, 1.05, -0.63, -0.15, -0.18, -0.14, -0.20],
      end:    [-1.03, 0.00, 0.53, -0.17,  0.14, 0.00, 1.12, -0.79, -0.18,  0.55,  0.30, -0.02],
      follow: [-1.03, 0.00, 0.53, -0.17,  0.14, 0.00, 1.12, -0.79, -0.18,  0.58,  0.30, -0.02] },
    { windup: [-2.03, 0.35, 0.88, -0.19,  0.07, 0.31, 0.29, -0.02, -0.02, -0.36, -0.78, 0.04],
      mid:    [-1.12, 0.31, 0.78, -0.07,  0.05, 0.00, 1.06, -0.65, -0.37, -0.21, -0.07, -0.40],
      end:    [-0.74, -0.15, 0.70, -0.23,  0.30, 0.00, 1.20, -1.20, -0.44,  0.39,  0.36, -0.40],
      follow: [-0.74, -0.15, 0.70, -0.23,  0.30, 0.00, 1.20, -1.20, -0.44,  0.42,  0.36, -0.40] }
  ],
  sweep: {
    windup: [-1.29, 0.27, 0.81, -0.04, 0.40, 0.00, 1.19, -0.62, -0.67, -0.25,  0.84, -0.40],
    mid:    [-1.51, 0.41, 0.77,  0.00, 0.30, 0.00, 1.49, -0.85, -0.59,  0.06, -0.15, -0.40],
    end:    [-1.47, 0.46, 0.67,  0.00, -0.05, 0.00, 1.57, -1.09, -0.42,  0.33, -1.00, -0.40],
    follow: [-1.47, 0.46, 0.67,  0.00, -0.05, 0.00, 1.57, -1.09, -0.42,  0.33, -0.95, -0.40]
  },
  slam: {
    windup: [-2.27, 0.10, 0.74, -0.21, -0.13, 0.00, 0.36, -0.44, -0.37, -0.39, -0.43, -0.12],
    mid:    [-1.30, 0.12, 0.71,  0.00, -0.14, 0.18, 1.11, -0.66, -0.16, -0.20, -0.17, -0.19],
    end:    [-1.08, -0.03, 0.42, -0.20, 0.13, 0.00, 1.19, -0.81, -0.16,  0.70,  0.42,  0.00],
    follow: [-1.08, -0.03, 0.42, -0.20, 0.13, 0.00, 1.19, -0.81, -0.16,  0.72,  0.42,  0.00]
  }
};
// 무기별 모션 묶음 (타이밍 + 자세). 내려찍기(slam)는 서버의 SLAM.DELAY(0.6초)에 맞춰 windup+swing = 0.6초
const MOTION = {
  wooden_sword: { atk: WEAPON_CFG.attack, slash: SLASH, sweepT: SWEEP_T, sweep: SWEEP, slamT: null, slam: null },
  orc_axe: {
    atk: { cooldown: 0.7, windup: 0.20, swing: 0.16, follow: 0.12, recover: 0.22, buffer: 0.15 },   // 칼보다 묵직하게 (준비·휘두름이 느리고 대신 회복은 빠름)
    slash: AXE.slash,
    sweepT: { windup: 0.12, swing: 0.20, follow: 0.14, recover: 0.22 },
    sweep: AXE.sweep,
    slamT: { windup: 0.46, swing: 0.14, follow: 0.30, recover: 0.36 },
    slam: AXE.slam
  }
};
MOTION.iron_sword = MOTION.wooden_sword;   // 철검도 나무검과 같은 모션·같은 공격 속도
MOTION.stone_sword = MOTION.wooden_sword;   // 돌 검은 나무검과 같은 모션·같은 공격 속도
const motionOf = (wp) => MOTION[wp.kind] || MOTION[DEFAULT_WEAPON];
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
      mode: WS.NONE, t: 0, cd: 0, queued: false, want: false, hitDone: false, side: 0, nextSide: 0, sweep: false, slam: false, speed: 1,
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
  if (wp.mode === WS.ATTACKING && (wp.sweep || wp.slam)) return false;   // 이미 스킬 모션 중
  if (wp.mode === WS.READY ? (remote || wp.cd <= 0) : wp.mode === WS.ATTACKING) {
    beginAttack(wp, 0, true);
    return true;
  }
  return false;
}

// 스킬 "내려찍기" 모션 시작. 도끼는 전용 모션(머리 위로 번쩍 → 땅을 내려찍음), 칼은 휩쓸기 모션 그대로
export function startWeaponSlam(rig, remote = false) {
  const wp = rig && rig.wp;
  if (!wp || !wp.want) return false;
  if (!motionOf(wp).slam) return startWeaponSweep(rig, remote);
  if (wp.mode === WS.ATTACKING && (wp.sweep || wp.slam)) return false;
  if (wp.mode === WS.READY ? (remote || wp.cd <= 0) : wp.mode === WS.ATTACKING) {
    beginAttack(wp, 0, false, true);
    return true;
  }
  return false;
}

// 공격 속도 배율 (AGI 스탯): 평타 모션이 빨라지고 쿨다운도 같이 줄어요. 휩쓸기·내려찍기는 서버 타이밍이 정해져 있어서 그대로예요
export function setWeaponSpeed(rig, speed) {
  if (!rig) return;
  getWp(rig).speed = Math.min(2, Math.max(1, Number(speed) || 1));
}

// 들고 있는 무기 종류 바꾸기 ('wooden_sword' | 'stone_sword' | 'orc_axe'). 이미 손에 붙어 있으면 모양만 바꿔 끼움 (모션 상태는 그대로)
export function setWeaponKind(rig, kind) {
  if (!rig) return;
  if (!WEAPONS[kind]) kind = DEFAULT_WEAPON;
  const wp = getWp(rig);
  if (wp.kind === kind) return;
  wp.kind = kind;
  if (wp.mount) {
    const vis = wp.mount.visible;
    if (wp.mount.parent) wp.mount.parent.remove(wp.mount);
    wp.mount = null;
    if (ensureMount(rig, wp)) { wp.mount.visible = vis; wp.mount.scale.setScalar(wp.scale); }
  }
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
  wp.mode = WS.NONE; wp.t = 0; wp.cd = 0; wp.queued = false; wp.want = false; wp.hitDone = false; wp.armW = 0; wp.sweep = false; wp.slam = false;
  if (wp.mount) wp.mount.visible = false;
}

function beginAttack(wp, side, sweep = false, slam = false) {
  wp.sweep = sweep;
  wp.slam = slam;
  wp.side = side;
  if (!sweep && !slam) wp.nextSide = 1 - side;   // 다음 평타는 반대 방향
  wp.mode = WS.ATTACKING;
  wp.t = 0;
  wp.cd = slam ? 0.6 : sweep ? 0.55 : motionOf(wp).atk.cooldown;
  wp.queued = false;
  wp.hitDone = false;
  if (wp.onStart && !sweep && !slam) wp.onStart(side);   // 스킬은 'atk' 대신 스킬 이벤트로 따로 알림
}

// ============================================================
// 4) 매 프레임 갱신 (character.js 의 animateHumanoid 에서 기존 애니메이션 직후 호출)
//    loco: { run: 0|1(달리기 중), move: 0|1(걷기/달리기 중), phase: 0~1 걸음 위상, 정지면 -1 }
// ============================================================
export function updateWeapon(rig, dt, loco) {
  const wp = rig.wp;
  if (!wp || !wp.mount) return;
  dt = clamp(dt, 0, 0.1);

  const MO = motionOf(wp);
  const A = MO.atk;
  wp.time += dt;
  wp.cd = Math.max(0, wp.cd - dt * (wp.speed || 1));   // 공격 속도(AGI)만큼 쿨다운도 빨리 줄어요
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
      const AT = wp.slam ? MO.slamT : wp.sweep ? MO.sweepT : A;
      wp.t += dt * (wp.slam || wp.sweep ? 1 : (wp.speed || 1));   // 평타 모션만 공격 속도 적용
      if (!wp.hitDone && wp.t >= AT.windup + AT.swing * 0.5) {
        wp.hitDone = true;
        if (wp.onHit && !wp.sweep && !wp.slam) wp.onHit();
      }
      if (wp.t >= AT.windup + AT.swing + AT.follow + AT.recover) { wp.mode = WS.READY; wp.t = 0; wp.sweep = false; wp.slam = false; }
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
      const AT = wp.slam ? MO.slamT : wp.sweep ? MO.sweepT : A;
      const t1 = AT.windup, t2 = t1 + AT.swing * 0.5, t3 = t1 + AT.swing, t4 = t3 + AT.follow, t5 = t4 + AT.recover;
      const S = wp.slam ? MO.slam : wp.sweep ? MO.sweep : MO.slash[wp.side];
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
