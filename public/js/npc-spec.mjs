// 마을 이장 NPC 의 모습 (THREE 의존 없음: 부품 목록만 만들어요. npc.js 가 이걸 읽어서 3D 로 조립)
//
// ■ 좌표: 발바닥 가운데가 (0,0,0), y 가 위, 얼굴이 향하는 쪽이 +z, 오른손(지팡이 든 손)이 +x.
// ■ 부품 모양: { s: 모양, a: 크기값, pos: [x,y,z], rot: [rx,ry,rz](라디안, XYZ 순서) | quat: [x,y,z,w], sc: [sx,sy,sz], c: 색(0xRRGGBB), g: 소속 그룹, dbl: 양면 }
//   모양(s) = 'sphere' { r, phiStart, phiLen, thetaStart, thetaLen } | 'box' { w, h, d } | 'cyl' { rt, rb, h, open } (rt=0 이면 원뿔)
//            | 'torus' { R, r, arc } | 'lathe' { pts: [[반지름, y], ...] }
// ■ 그룹(g): 'body' 가만히 있는 몸, 'upper' 숨쉴 때 살짝 오르내리는 윗몸, 'head' 고개(바라보기), 'armL' 왼팔(살랑), 'eyeL'/'eyeR' 눈(깜빡임)
//   그룹이 도는 축(PIVOT)은 아래 표. 부품의 pos 는 항상 "캐릭터 전체 기준" 좌표로 적어요.

const PI = Math.PI;

// ---------- 색 ----------
export const COL = {
  skin: 0xe2b38b, skinDark: 0xc99872, skinRed: 0xdba88b, blush: 0xe3a68b,
  white: 0xf3f0ea, whiteShade: 0xe4e0d6,
  eyeWhite: 0xf7f2e8, iris: 0x55402a, pupil: 0x15100c, lid: 0xd2a07c,
  coat: 0x3e6b52,
  trim: 0x6b4527, cream: 0xe2d4ae, fur: 0xeae5d7,
  trousers: 0x76614a, boot: 0x3a291c, bootCuff: 0x5a3f28,
  belt: 0x4b3120, gold: 0xd6a83c, goldDark: 0x9a7420, leather: 0x7c5632,
  wood: 0x79512f, iron: 0x4d4d55,
};

// 그룹이 도는 기준점 (캐릭터 좌표). head/armL 은 upper 안에 들어 있어요
export const PIVOT = {
  upper: [0, 1.0, 0],
  head: [0, 1.49, 0.03],
  armL: [-0.212, 1.335, 0],
  eyeL: [-0.04, 1.618, 0.14],
  eyeR: [0.04, 1.618, 0.14],
};
export const PARENT = { head: 'upper', armL: 'upper', eyeL: 'head', eyeR: 'head' };
export const GROUP_SCALE = { head: 1.18 };   // 머리 크기 배율 (목 기준). 눈 그룹은 머리 안에 있어서 같이 커져요

// ---------- 작은 수학 도우미 ----------
const v3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm3 = (a) => mul3(a, 1 / (len3(a) || 1));
// +y 축을 dir 방향으로 돌리는 쿼터니언
function quatUp(dir) {
  const d = nrm3(dir), r = d[1] + 1;
  if (r < 1e-6) return [1, 0, 0, 0];
  const q = [d[2], 0, -d[0], r], l = Math.hypot(...q);
  return q.map((x) => x / l);
}
// 팔꿈치 위치 (두 마디 팔): 어깨 s → 손 h, 팔 길이 l1/l2, 팔꿈치가 꺾이는 쪽 hint
function elbow(s, h, l1, l2, hint) {
  const dv = v3(h, s), d = Math.min(len3(dv), l1 + l2 - 1e-4), u = nrm3(dv);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const hp = nrm3(add3(hint, mul3(u, -dot3(hint, u))));
  return add3(add3(s, mul3(u, a)), mul3(hp, hh));
}

// ---------- 부품 만들기 ----------
export function chiefParts() {
  const P = [];
  const part = (o) => { P.push(o); return o; };
  const sph = (g, c, pos, r, sc, extra = {}) => part({ s: 'sphere', a: { r, ...(extra.a || {}) }, pos, sc: sc || [1, 1, 1], c, g, dbl: !!extra.dbl, rot: extra.rot });
  const box = (g, c, pos, w, h, d, rot) => part({ s: 'box', a: { w, h, d }, pos, c, g, rot });
  const cyl = (g, c, pos, rt, rb, h, extra = {}) => part({ s: 'cyl', a: { rt, rb, h, open: !!extra.open }, pos, sc: extra.sc, rot: extra.rot, c, g, dbl: !!extra.open });
  const bone = (g, c, a, b, r1, r2) => part({ s: 'cyl', a: { rt: r2, rb: r1, h: len3(v3(b, a)) }, pos: mul3(add3(a, b), 0.5), quat: quatUp(v3(b, a)), c, g });

  // ===== 얼굴 표면 높이 (머리 타원체 앞면의 z) =====
  const HC = [0, 1.60, 0.04], HR = 0.113, HSX = 0.92, HSY = 1.12;
  const faceZ = (x, y) => HC[2] + HR * Math.sqrt(Math.max(0, 1 - (x / (HR * HSX)) ** 2 - ((y - HC[1]) / (HR * HSY)) ** 2));

  // ===== 신발·바지 =====
  for (const sx of [-1, 1]) {
    const x = sx * 0.105;
    box('body', COL.boot, [x, 0.043, 0.05], 0.125, 0.085, 0.27);
    sph('body', COL.boot, [x, 0.052, 0.165], 0.062, [1, 0.72, 1.1]);          // 둥근 앞코
    cyl('body', COL.boot, [x, 0.185, 0.0], 0.062, 0.068, 0.2);                 // 목
    cyl('body', COL.bootCuff, [x, 0.292, 0.0], 0.073, 0.073, 0.035);           // 목 가죽 테두리
    cyl('body', COL.trousers, [x, 0.6, 0.0], 0.088, 0.07, 0.62);               // 바지
  }

  // ===== 긴 외투 (옆으로 살짝 납작하게 돌려 깎은 몸통) =====
  const PROFILE = [[0.001, 0.47], [0.27, 0.47], [0.268, 0.50], [0.252, 0.62], [0.228, 0.80], [0.2, 0.98], [0.19, 1.05], [0.196, 1.18], [0.206, 1.30], [0.185, 1.38], [0.14, 1.42], [0.001, 1.43]];
  const COAT_SZ = 0.78;
  part({ s: 'lathe', a: { pts: PROFILE }, pos: [0, 0, 0], sc: [1, 1, COAT_SZ], c: COL.coat, g: 'body', dbl: true });
  const coatR = (y) => {                                                        // 높이 y 에서 외투 반지름 (옆 방향)
    for (let i = 0; i < PROFILE.length - 1; i++) {
      const [r0, y0] = PROFILE[i], [r1, y1] = PROFILE[i + 1];
      if (y >= y0 && y <= y1) return r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
    }
    return 0.2;
  };
  cyl('body', COL.trim, [0, 0.505, 0], 0.281, 0.284, 0.07, { open: true, sc: [1, 1, COAT_SZ] });   // 밑단 갈색 띠
  cyl('body', COL.belt, [0, 1.02, 0], 0.206, 0.208, 0.075, { sc: [1, 1, COAT_SZ] });                // 허리띠
  const bz = 0.207 * COAT_SZ + 0.012;
  box('body', COL.gold, [0, 1.02, bz], 0.078, 0.066, 0.02);                      // 버클
  box('body', COL.belt, [0, 1.02, bz + 0.007], 0.04, 0.034, 0.014);
  box('body', COL.leather, [0.19, 0.97, 0.1], 0.07, 0.08, 0.04);             // 허리 주머니
  box('body', COL.trim, [0.19, 1.008, 0.1], 0.075, 0.028, 0.045);
  for (const y of [1.16, 1.10, 0.94, 0.86, 0.78, 0.70]) sph('body', COL.gold, [0, y, coatR(y) * COAT_SZ + 0.005], 0.0115, [1, 1, 0.7]);   // 단추

  // ===== 윗몸 (숨쉬는 그룹): 털 깃, 속옷 깃, 목 =====
  sph('upper', COL.cream, [0, 1.38, 0.08], 0.08, [1, 0.62, 0.85]);                // 속에 입은 크림색 옷깃
  part({ s: 'torus', a: { R: 0.15, r: 0.048 }, pos: [0, 1.395, -0.012], rot: [PI / 2, 0, 0], sc: [1, 0.82, 1], c: COL.fur, g: 'upper' });   // 하얀 털 깃
  part({ s: 'torus', a: { R: 0.142, r: 0.036 }, pos: [0, 1.425, -0.016], rot: [PI / 2, 0, 0], sc: [1, 0.82, 1], c: COL.whiteShade, g: 'upper' });
  cyl('upper', COL.skin, [0, 1.47, 0.0], 0.046, 0.05, 0.1);                             // 목

  // ===== 팔 =====
  const SR = [0.212, 1.335, 0], SL = [-0.212, 1.335, 0];
  // 오른팔: 지팡이를 짚음
  const CANE = [0.31, 0.15];                                                   // 지팡이 x, z
  const HR_ = [CANE[0], 1.045, CANE[1]];
  const ER = elbow(SR, HR_, 0.28, 0.27, [0.7, -0.1, -0.7]);
  const WR = add3(HR_, mul3(nrm3(v3(HR_, ER)), -0.065));
  const armCol = COL.coat;
  sph('upper', armCol, SR, 0.066);
  bone('upper', armCol, SR, ER, 0.062, 0.056); sph('upper', armCol, ER, 0.057);
  bone('upper', armCol, ER, WR, 0.056, 0.049);
  bone('upper', COL.trim, add3(WR, mul3(nrm3(v3(HR_, ER)), -0.03)), add3(WR, mul3(nrm3(v3(HR_, ER)), 0.012)), 0.054, 0.054);   // 소맷부리
  sph('upper', COL.skin, HR_, 0.043, [1, 1, 1.05]);                              // 손
  for (const dy of [-0.032, -0.011, 0.01, 0.031]) sph('upper', COL.skin, [CANE[0] - 0.005, HR_[1] + dy, CANE[1] + 0.04], 0.0165, [1.1, 0.9, 1]);   // 지팡이를 감싼 손가락
  sph('upper', COL.skin, [CANE[0] - 0.045, HR_[1] + 0.012, CANE[1] + 0.02], 0.017, [1, 1.3, 1]);   // 엄지

  // 왼팔: 자연스럽게 내려둠 (살랑거림 그룹)
  const HL_ = [-0.262, 0.83, 0.07];
  const EL = elbow(SL, HL_, 0.28, 0.27, [-0.3, -0.1, -1]);
  const WL = add3(HL_, mul3(nrm3(v3(HL_, EL)), -0.065));
  sph('armL', armCol, SL, 0.066);
  bone('armL', armCol, SL, EL, 0.062, 0.056); sph('armL', armCol, EL, 0.057);
  bone('armL', armCol, EL, WL, 0.056, 0.049);
  bone('armL', COL.trim, add3(WL, mul3(nrm3(v3(HL_, EL)), -0.03)), add3(WL, mul3(nrm3(v3(HL_, EL)), 0.012)), 0.054, 0.054);
  sph('armL', COL.skin, HL_, 0.043, [1, 1.05, 1]);
  for (const fx of [-0.026, -0.009, 0.009, 0.026]) sph('armL', COL.skin, [HL_[0] + fx, HL_[1] - 0.05 - Math.abs(fx) * -0.2, HL_[2] + 0.004], 0.0135, [0.9, 2.3, 0.9]);   // 자연스럽게 펴진 손가락
  sph('armL', COL.skin, [HL_[0] + 0.04, HL_[1] - 0.012, HL_[2] + 0.02], 0.017, [1, 1.4, 1]);   // 엄지

  // ===== 지팡이 =====
  bone('body', COL.wood, [CANE[0], 0.03, CANE[1]], [CANE[0], 1.10, CANE[1]], 0.0185, 0.0165);
  cyl('body', COL.iron, [CANE[0], 0.02, CANE[1]], 0.02, 0.017, 0.045);              // 쇠 끝
  cyl('body', COL.gold, [CANE[0], 0.86, CANE[1]], 0.021, 0.021, 0.018);             // 금빛 띠
  part({ s: 'torus', a: { R: 0.056, r: 0.0172, arc: PI }, pos: [CANE[0] - 0.056, 1.10, CANE[1]], c: COL.wood, g: 'body' });   // 손잡이 휘어진 부분
  sph('body', COL.wood, [CANE[0] - 0.112, 1.10, CANE[1]], 0.0172);

  // ===== 머리 =====
  sph('head', COL.skin, HC, HR, [HSX, HSY, 1.0]);                                // 머리
  sph('head', COL.skin, [0, 1.545, 0.055], 0.072, [1.0, 0.8, 0.92]);               // 턱·볼
  for (const sx of [-1, 1]) sph('head', COL.skin, [sx * 0.105, 1.598, 0.04], 0.027, [0.45, 1.0, 0.8]);   // 귀
  for (const sx of [-1, 1]) sph('head', COL.skinRed, [sx * 0.108, 1.585, 0.04], 0.012, [0.5, 1, 0.8]);    // 귓불

  // 눈 (눈꺼풀은 고정, 눈알 그룹만 깜빡임)
  for (const sx of [-1, 1]) {
    const x = sx * 0.04, g = sx < 0 ? 'eyeL' : 'eyeR';
    sph(g, COL.eyeWhite, [x, 1.618, faceZ(x, 1.618) - 0.003], 0.0165, [1, 0.85, 0.55]);
    sph(g, COL.iris, [x, 1.617, faceZ(x, 1.617) + 0.003], 0.0105, [1, 1, 0.5]);
    sph(g, COL.pupil, [x, 1.617, faceZ(x, 1.617) + 0.0065], 0.0052, [1, 1, 0.5]);
    sph(g, COL.eyeWhite, [x + 0.004, 1.621, faceZ(x, 1.621) + 0.0085], 0.0026, [1, 1, 0.5]);
    sph('head', COL.lid, [x, 1.6285, faceZ(x, 1.6285) - 0.0005], 0.0185, [1.05, 0.5, 0.62]);        // 처진 윗눈꺼풀
    sph('head', COL.lid, [x, 1.6065, faceZ(x, 1.6065) - 0.002], 0.0165, [1.0, 0.32, 0.5]);          // 아랫눈꺼풀·눈밑 주름
    // 덥수룩한 흰 눈썹
    box('head', COL.white, [sx * 0.046, 1.648, faceZ(sx * 0.046, 1.648) - 0.003], 0.062, 0.017, 0.022, [0, 0, -sx * 0.16]);
    box('head', COL.whiteShade, [sx * 0.036, 1.658, faceZ(sx * 0.036, 1.658) - 0.006], 0.044, 0.012, 0.018, [0, 0, -sx * 0.28]);
    box('head', COL.white, [sx * 0.074, 1.642, faceZ(sx * 0.074, 1.642) - 0.004], 0.026, 0.014, 0.02, [0, 0, -sx * 0.5]);
    // 볼 홍조, 웃음 주름
    sph('head', COL.blush, [sx * 0.066, 1.574, faceZ(sx * 0.066, 1.574) - 0.002], 0.016, [1, 0.8, 0.35]);
    box('head', COL.skinDark, [sx * 0.074, 1.612, faceZ(sx * 0.074, 1.612) - 0.002], 0.004, 0.026, 0.004, [0, 0, sx * 0.5]);   // 눈가 주름
    box('head', COL.skinDark, [sx * 0.034, 1.562, faceZ(sx * 0.034, 1.562) + 0.0], 0.004, 0.04, 0.004, [0, 0, -sx * 0.32]);     // 팔자 주름
    // 안경
    part({ s: 'torus', a: { R: 0.029, r: 0.0036 }, pos: [x, 1.617, faceZ(x, 1.617) + 0.013], c: COL.gold, g: 'head' });
    bone('head', COL.gold, [sx * 0.069, 1.622, faceZ(sx * 0.069, 1.622) + 0.008], [sx * 0.1075, 1.608, 0.05], 0.0026, 0.0026);   // 다리
  }
  box('head', COL.gold, [0, 1.622, faceZ(0, 1.622) + 0.013], 0.024, 0.004, 0.004);   // 안경 코다리
  // 이마 주름
  box('head', COL.skinDark, [0, 1.676, faceZ(0, 1.676) + 0.0005], 0.08, 0.0035, 0.004);
  box('head', COL.skinDark, [0, 1.689, faceZ(0, 1.689) + 0.0005], 0.062, 0.0035, 0.004);
  // 코
  box('head', COL.skin, [0, 1.603, faceZ(0, 1.603) - 0.002], 0.019, 0.054, 0.022);
  sph('head', COL.skinRed, [0, 1.578, faceZ(0, 1.578) + 0.007], 0.022, [1, 0.9, 1.05]);
  for (const sx of [-1, 1]) sph('head', COL.skinRed, [sx * 0.015, 1.573, faceZ(0, 1.573) + 0.0], 0.0115, [1, 0.9, 0.9]);
  // 입 (콧수염 아래로 살짝 보임)
  box('head', 0x8a4a3a, [0, 1.531, faceZ(0, 1.531) + 0.001], 0.036, 0.006, 0.006);
  for (const sx of [-1, 1]) box('head', 0x8a4a3a, [sx * 0.022, 1.534, faceZ(sx * 0.022, 1.534) + 0.0], 0.014, 0.005, 0.006, [0, 0, sx * 0.5]);

  // 수염: 커다란 콧수염 + 풍성한 턱수염
  for (const sx of [-1, 1]) {
    sph('head', COL.white, [sx * 0.03, 1.554, faceZ(sx * 0.03, 1.554) + 0.011], 0.03, [1.5, 0.55, 0.85], { rot: [0, 0, sx * -0.3] });
    sph('head', COL.whiteShade, [sx * 0.064, 1.543, faceZ(sx * 0.064, 1.543) + 0.003], 0.017, [1, 0.9, 0.8]);
    sph('head', COL.white, [sx * 0.077, 1.535, 0.075], 0.036, [0.6, 1.5, 0.85]);       // 구레나룻 아래
  }
  sph('head', COL.white, [0, 1.49, faceZ(0, 1.52) - 0.02], 0.078, [1.0, 1.4, 0.8]);    // 턱수염 본체
  sph('head', COL.white, [0, 1.405, 0.15], 0.07, [1.0, 1.3, 0.72]);          // 길게 늘어진 수염 (겹친 덩어리 셋)
  sph('head', COL.whiteShade, [0, 1.335, 0.158], 0.056, [1.0, 1.4, 0.66]);
  sph('head', COL.white, [0, 1.275, 0.162], 0.04, [0.95, 1.5, 0.62]);
  sph('head', COL.whiteShade, [0.02, 1.42, 0.17], 0.024, [0.8, 1.3, 0.7]);

  // 머리카락: 앞이마는 드러나고 옆·뒤로 하얀 머리, 정수리엔 몇 가닥
  part({ s: 'sphere', a: { r: 0.1235, phiStart: 0, phiLen: 2 * PI, thetaStart: 0, thetaLen: 0.82 }, pos: [0, 1.607, 0.03], sc: [1, 1.12, 1.04], c: COL.white, g: 'head', dbl: true });   // 정수리
  part({ s: 'sphere', a: { r: 0.123, phiStart: PI / 2 + 0.9, phiLen: 2 * PI - 1.8, thetaStart: 0.5, thetaLen: 1.45 }, pos: [0, 1.607, 0.026], sc: [1, 1.12, 1.04], c: COL.whiteShade, g: 'head', dbl: true });   // 옆·뒤 머리
  sph('head', COL.whiteShade, [0, 1.545, -0.048], 0.1, [1.0, 0.72, 0.78]);              // 뒷덜미 머리
  for (const sx of [-1, 1]) {
    sph('head', COL.white, [sx * 0.104, 1.62, 0.0], 0.03, [0.7, 1.3, 1.0]);             // 귀 뒤 머리
  }
  return P;
}
