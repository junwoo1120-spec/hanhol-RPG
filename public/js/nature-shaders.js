// 자연 오브젝트 공통 셰이더 조각 (THREE 의존 없음). MeshLambert/MeshPhong의 onBeforeCompile에서 끼워 넣음.
//
// 정점 속성  aNat = (바람 가중치[units], 강조색 마스크, 텍스처층)
// 인스턴스   aInstA = (색조 라디안, 채도 배율, 명도 배율, 바람 위상)
//            aInstB = (강조색 RGB(선형), 강조 강도)
// 한 재질로 인스턴스마다 색조/채도/명도/강조색(꽃잎·버섯갓·이끼·눈)을 다르게 낼 수 있음.
//
// v2 (재질 개선): 새 텍스처 파일 없이 기존 텍스처만으로
//  - 휘도에서 만든 미세 요철(범프)  - 저주파 얼룩/색조 변화(반복 무늬 깨기)  - 지층 띠(사암)
//  - 바닥 쪽 이끼/젖음, 위쪽 면의 눈·재·먼지  - 수면 높이 기준 젖은 띠  - 표면별 반사 변화
// 전부 uniform 값으로 켜고 끄므로 셰이더 프로그램은 재질 간에 공유됨(재질 수 증가 없음).
// uFxA=(범프, 얼룩, 색조변화, 얼룩 크기[1/m])  uFxB=(바닥높이[m], 바닥 강도, 윗면 강도, 반사 변화)  uFxC=(지층 강도, 지층 주파수, 수면 y, 0)

export const NAT_VERT_PARS = /* glsl */`
attribute vec3 aNat;
attribute vec4 aInstA;
attribute vec4 aInstB;
uniform float uTime;
uniform float uWind;
uniform vec2 uWindDir;
uniform float uWindMul;
varying vec2 vNatUv;
varying vec2 vNat;      // x: 강조 마스크 * 강도, y: 텍스처층
varying vec3 vNatHSV;
varying vec3 vNatAcc;
varying float vNatH;    // 오브젝트 바닥 기준 높이(m)
varying float vNatUp;   // 월드 기준 법선 y
varying float vNatWY;   // 월드 y
`;

// begin_vertex 직후에 삽입 (transformed 가 이미 선언돼 있음)
export const NAT_VERT_BEGIN = /* glsl */`
vNatUv = uv + vec2(aInstA.w * 3.17, aInstA.w * 1.91);   // 인스턴스마다 텍스처 위치를 달리해 반복 무늬를 깸
vNat = vec2(aNat.y * aInstB.w, aNat.z);
vNatHSV = aInstA.xyz;
vNatAcc = aInstB.xyz;
{
  float natS = 1.0;
  #ifdef USE_INSTANCING
    vec3 natOrg = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
    natS = max(length(instanceMatrix[0].xyz), 1e-4);
    mat3 natR = transpose(mat3(instanceMatrix)) / natS;
  #else
    vec3 natOrg = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    mat3 natR = mat3(1.0);
  #endif
  vec2 natWd = normalize(uWindDir + vec2(1e-5));
  float natPh = aInstA.w;
  float natGust = 0.5 + 0.5 * sin(dot(natOrg.xz, natWd) * 0.05 - uTime * 0.8 + sin(uTime * 0.23 + natPh * 0.1) * 1.5);
  float natAmp = uWind * uWindMul * (0.35 + 0.9 * natGust);
  float natFlut = sin(uTime * 2.3 + natPh + position.x * 3.1 + position.z * 2.7) * 0.25;
  vec3 natAlong = natR * vec3(natWd.x, 0.0, natWd.y);
  vec3 natAcross = natR * vec3(-natWd.y, 0.0, natWd.x);
  float natW = aNat.x * natAmp;
  transformed.xz += natAlong.xz * natW + natAcross.xz * natW * natFlut;
  transformed.y -= abs(natW) * 0.12;
  vNatH = max(position.y, 0.0) * natS;
  vNatUp = (transpose(natR) * normal).y;
  #ifdef USE_INSTANCING
    vNatWY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;
  #else
    vNatWY = (modelMatrix * vec4(transformed, 1.0)).y;
  #endif
}
`;

export const NAT_FRAG_PARS = /* glsl */`
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform vec4 uTile;     // A.xy, B.xy  (미터당 반복)
uniform vec3 uTintA;
uniform vec3 uTintB;
uniform vec2 uMean;     // 층별 평균 휘도(tint 포함) - 강조색 정규화용
uniform float uBright;
uniform float uAccGain;
uniform vec4 uFxA;
uniform vec4 uFxB;
uniform vec4 uFxC;
uniform vec3 uLowTint;
uniform vec3 uTopTint;
varying vec2 vNatUv;
varying vec2 vNat;
varying vec3 vNatHSV;
varying vec3 vNatAcc;
varying float vNatH;
varying float vNatUp;
varying float vNatWY;

vec3 natHue(vec3 c, float a) {
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYIQ * c;
  float cs = cos(a), sn = sin(a);
  yiq.yz = vec2(yiq.y * cs - yiq.z * sn, yiq.y * sn + yiq.z * cs);
  return toRGB * yiq;
}
vec3 natAdjust(vec3 c, vec3 hsv) {
  vec3 r = natHue(c, hsv.x);
  float l = dot(r, vec3(0.299, 0.587, 0.114));
  r = mix(vec3(l), r, hsv.y);
  return max(r * hsv.z, 0.0);
}
float natHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float natVN(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(natHash(i), natHash(i + vec2(1.0, 0.0)), f.x), mix(natHash(i + vec2(0.0, 1.0)), natHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

// map_fragment 자리에 들어감: 2층 텍스처 샘플 (공통 텍스처 재사용)
export const NAT_FRAG_MAP = /* glsl */`
float natSurf = clamp(vNat.y, 0.0, 1.0);
vec2 natUvA = vNatUv * uTile.xy;
vec2 natUvB = vNatUv * uTile.zw;
vec3 natTexA = texture2D(uTexA, natUvA).rgb * uTintA;
vec3 natTexB = texture2D(uTexB, natUvB).rgb * uTintB;
if (uFxA.y > 0.0) {
  // 같은 텍스처를 다른 배율/위치로 한 번 더 읽어 저주파 무늬로 섞음 → 타일 반복이 덜 보임
  float natBl = natVN(vNatUv * uFxA.w + 3.7) * 0.6 * min(uFxA.y * 1.5, 1.0);
  natTexA = mix(natTexA, texture2D(uTexA, natUvA * 0.37 + vec2(0.31, 0.57)).rgb * uTintA, natBl);
  natTexB = mix(natTexB, texture2D(uTexB, natUvB * 0.37 + vec2(0.31, 0.57)).rgb * uTintB, natBl);
}
vec3 natTex = mix(natTexA, natTexB, natSurf);
float natH = dot(natTex, vec3(0.299, 0.587, 0.114)) / max(mix(uMean.x, uMean.y, natSurf), 0.02);   // 상대 높이(요철용)
float natWet = 0.0;
diffuseColor.rgb *= natTex * uBright;
`;

// color_fragment(정점색 곱) 뒤에 들어감: 인스턴스별 HSV 보정 + 강조색 + 표면 색 변화
export const NAT_FRAG_COLOR = /* glsl */`
{
  float natMean = max(mix(uMean.x, uMean.y, natSurf), 0.02);
  float natLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 natBase = natAdjust(diffuseColor.rgb, vNatHSV);
  vec3 natAcc = vNatAcc * uAccGain * clamp(natLum / natMean, 0.3, 2.2);
  diffuseColor.rgb = mix(natBase, natAcc, clamp(vNat.x, 0.0, 1.0));
}
{
  float nA = natVN(vNatUv * uFxA.w * 0.9 + vec2(11.3, 5.1));
  float nB = natVN(vNatUv * uFxA.w * 2.3 + vec2(2.7, 17.9));
  float nn = nA * 0.65 + nB * 0.35;
  float keep = 1.0 - clamp(vNat.x, 0.0, 1.0) * 0.7;           // 꽃잎/버섯갓 강조색 영역은 변화를 약하게
  vec3 c = diffuseColor.rgb;
  c = natHue(c, (nB - 0.5) * uFxA.z * keep);                   // 표면 위치마다 색조가 조금씩 다름
  c *= 1.0 + (nn - 0.5) * uFxA.y * keep;                       // 명도 얼룩
  if (uFxC.x > 0.0) {                                          // 사암 지층 띠
    float bd = sin(vNatH * uFxC.y + nA * 3.0);
    c *= 1.0 + bd * uFxC.x;
    c = natHue(c, bd * 0.06);
  }
  float lo = (1.0 - smoothstep(0.0, max(uFxB.x, 0.01), vNatH)) * uFxB.y * (0.6 + 0.8 * nA) * keep;   // 바닥 쪽 이끼/습기
  c = mix(c, c * uLowTint, clamp(lo, 0.0, 1.0));
  float up = smoothstep(0.5, 0.9, vNatUp) * uFxB.z * (0.7 + 0.6 * nB);                                   // 위쪽 면: 눈/재/먼지/햇빛
  c = mix(c, c * uTopTint, clamp(up, 0.0, 1.0));
  float wy = vNatWY - uFxC.z;                                  // 수면 기준: 젖은 띠 + 물에 잠긴 부분은 푸르게
  natWet = 1.0 - smoothstep(0.0, 0.6, wy);
  c *= mix(1.0, 0.74, natWet);
  float sub = clamp(-wy / 3.0, 0.0, 1.0);
  c = mix(c, c * vec3(0.5, 0.78, 1.1), sub * 0.7);
  diffuseColor.rgb = max(c, 0.0);
}
`;

// specularmap_fragment 자리: 표면별 반사 세기(밝은 알갱이는 반짝, 어두운 틈은 무광, 젖은 곳은 더 반짝)
export const NAT_FRAG_SPEC = /* glsl */`
float specularStrength = mix(1.0, clamp(natH, 0.25, 1.7), uFxB.w) * (1.0 + natWet * 1.2);
`;

// normal_fragment_maps 뒤: 텍스처 휘도로 만든 미세 요철 (노멀맵 파일 없이 법선만 흔듦)
export const NAT_FRAG_NORMAL = /* glsl */`
{
  float natBf = uFxA.x * (1.0 - smoothstep(18.0, 60.0, length(vViewPosition)));   // 멀리서는 끔(깜빡임 방지)
  vec3 natP = -vViewPosition;
  vec3 natSx = dFdx(natP), natSy = dFdy(natP);
  vec3 natR1 = cross(natSy, normal), natR2 = cross(normal, natSx);
  float natDet = dot(natSx, natR1) * faceDirection;
  vec2 natD = vec2(dFdx(natH), dFdy(natH)) * (0.012 * natBf);
  vec3 natG = sign(natDet) * (natD.x * natR1 + natD.y * natR2);
  normal = normalize(abs(natDet) * normal - natG);
}
`;
