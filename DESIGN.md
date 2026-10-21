# 현재 진행 상황
- 1단계: 시드 기반 청크 지형 + 바이옴 + 멀티 위치 동기화 (진행 중)
- 다음: 강/호수/나무/LOD → AOI 전송 → 청크 변경 저장 → 동굴

# 자연 오브젝트 공통 베이스 (2단계, 배치 전)
- 파일: public/js/nature-geo.js(순수 지오메트리/프리셋/재질표), nature-shaders.js(GLSL), nature.js(THREE 키트), public/nature-test.html(갤러리), tools/nature-geo-test.mjs(검증)
- 베이스 8종(tree, rock, grass, flower, mushroom, stump, plant, vine) → 파생 36종(SPECIES) × 변종 seed. 한 모델 = 지오메트리 1 + 재질 1 + 드로우콜 1
- 기존 땅 텍스처 12장 재사용(2층 텍스처 + 층별 색 보정). 인스턴스별 색조/채도/명도/강조색(꽃잎·버섯갓·이끼·눈)을 셰이더에서 처리
- 바람: 정점 가중치(nat.x)+인스턴스 위상으로 구현만 해 둠. 지형·청크 시스템(main.js, terrain.js, server.js)은 수정하지 않음
- 다음: 청크 생성/제거 훅에서 kit.createInstanced / disposeInstanced 호출, 바이옴별 밀도 규칙(T.detail 가중치로 마을·용암·얼음 제외), 거리별 LOD 전환

# 지형별 자연 오브젝트 (3단계, 배치 전)
- 베이스 8종에서 파생한 81종(SPECIES). 정글/평원/사막/설원/화산/바다 목록은 nature-geo.js의 BIOMES
- LOD0/1/2 지원. 배치는 다음 단계: 청크 훅에서 createInstanced/disposeInstanced, 거리별 LOD, 밀도 상한
- 바다는 수면·해저 구현을 건드리지 않고 해안/얕은 물 장식만 추가
