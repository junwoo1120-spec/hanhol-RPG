// 평원 3구역 (서버와 브라우저가 같이 쓰는 순수 계산 파일)
//
//          북(-z) ← 동굴이 있는 쪽
//        ╲ 토끼 ╱
//    ───────●───────        ● = 시작마을. 마을 둘레 INNER_R 안쪽은 구역 없이 그냥 평원
//   고블린  ╱ ╲  슬라임
//          남
//
// 각도는 북쪽(-z)이 0°, 동쪽(+x)이 90°, 남쪽이 180°, 서쪽이 270° 인 시계 방향.
//  - 토끼 평원   : 북쪽 좌우 60°씩 (300° ~ 60°)  — 동굴이 이 안에 있어요
//  - 슬라임 고원 : 60° ~ SLIME_END_DEG (동쪽 ~ 남동쪽)
//  - 고블린 서식지: SLIME_END_DEG ~ 300° (남쪽 ~ 서쪽)
// 이 섬의 평원은 동그란 모양이 아니라 북쪽에 한 덩어리, 남동쪽으로 길게 뻗은 한 덩어리라서
// 정확히 120°씩 자르면 고블린 쪽 평원이 너무 좁아요. 그래서 평원 넓이가 비슷하게 나뉘도록
// 슬라임/고블린 경계를 남동쪽 긴 평원 한가운데(145°)로 잡았어요. 바꾸고 싶으면 SLIME_END_DEG 만 고치면 돼요.
// 지형이 평원(plain)인 곳에만 적용돼요. (사막·정글·바다 등은 그대로)
export const PLAIN_ZONE = {
  INNER_R: 260,          // 시작마을 + 아무것도 없는 평원 (이 반지름 안쪽은 구역 없음)
  RABBIT_HALF_DEG: 60,   // 토끼 구역이 북쪽 기준 좌우로 퍼지는 각도
  SLIME_END_DEG: 145,    // 슬라임 고원이 끝나고 고블린 서식지가 시작되는 각도
};

// V: 시작마을 { x, z }.  반환: 'rabbit' | 'goblin' | 'slime' | null(구역 없음)
export function plainZoneAt(x, z, V) {
  const dx = x - V.x, dz = z - V.z;
  if (Math.hypot(dx, dz) < PLAIN_ZONE.INNER_R) return null;
  let a = Math.atan2(dx, -dz) * 180 / Math.PI;   // 0 = 북(-z), 양수 = 동쪽(+x)
  if (a < 0) a += 360;
  if (a <= PLAIN_ZONE.RABBIT_HALF_DEG || a >= 360 - PLAIN_ZONE.RABBIT_HALF_DEG) return 'rabbit';
  return a < PLAIN_ZONE.SLIME_END_DEG ? 'slime' : 'goblin';
}
