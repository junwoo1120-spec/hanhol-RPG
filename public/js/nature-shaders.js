// 자연 오브젝트 공통 셰이더 조각 (THREE 의존 없음). MeshLambert/MeshPhong의 onBeforeCompile에서 끼워 넣음.
//
// 정점 속성  aNat = (바람 가중치[units], 강조색 마스크, 텍스처층)
// 인스턴스   aInstA = (색조 라디안, 채도 배율, 명도 배율, 바람 위상)
//            aInstB = (강조색 RGB(선형), 강조 강도)
// 한 재질로 인스턴스마다 색조/채도/명도/강조색(꽃잎·버섯갓·이끼·눈)을 다르게 낼 수 있음.

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
`;

// begin_vertex 직후에 삽입 (transformed 가 이미 선언돼 있음)
export const NAT_VERT_BEGIN = /* glsl */`
vNatUv = uv;
vNat = vec2(aNat.y * aInstB.w, aNat.z);
vNatHSV = aInstA.xyz;
vNatAcc = aInstB.xyz;
{
  #ifdef USE_INSTANCING
    vec3 natOrg = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
    float natS = max(length(instanceMatrix[0].xyz), 1e-4);
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
varying vec2 vNatUv;
varying vec2 vNat;
varying vec3 vNatHSV;
varying vec3 vNatAcc;

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
`;

// map_fragment 자리에 들어감: 2층 텍스처 샘플 (공통 텍스처 재사용)
export const NAT_FRAG_MAP = /* glsl */`
float natSurf = clamp(vNat.y, 0.0, 1.0);
vec3 natTexA = texture2D(uTexA, vNatUv * uTile.xy).rgb * uTintA;
vec3 natTexB = texture2D(uTexB, vNatUv * uTile.zw).rgb * uTintB;
diffuseColor.rgb *= mix(natTexA, natTexB, natSurf) * uBright;
`;

// color_fragment(정점색 곱) 뒤에 들어감: 인스턴스별 HSV 보정 + 강조색
export const NAT_FRAG_COLOR = /* glsl */`
{
  float natMean = max(mix(uMean.x, uMean.y, natSurf), 0.02);
  float natLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 natBase = natAdjust(diffuseColor.rgb, vNatHSV);
  vec3 natAcc = vNatAcc * uAccGain * clamp(natLum / natMean, 0.3, 2.2);
  diffuseColor.rgb = mix(natBase, natAcc, clamp(vNat.x, 0.0, 1.0));
}
`;
