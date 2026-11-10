// 아이템 · 스킬 정보 (서버와 브라우저가 같이 쓰는 파일)
// 인벤토리 창·스킬 창의 설명 글, 스킬북 드랍 확률, 플레이어 '내려찍기' 수치가 전부 여기 있어요.

export const INV_CAP = 30;                    // 인벤토리 칸 수 (서로 다른 아이템 종류 기준, 같은 아이템은 겹쳐 쌓임)
export const BOSS_BOOK_CHANCE = 0.01;         // 보스를 잡을 때 스킬북이 나올 확률 (보스에게 피해를 준 사람마다 따로 굴려요)

// 플레이어가 쓰는 '내려찍기' (오크 대전사의 스킬을 책으로 배운 것)
export const SLAM = {
  DAMAGE: 40,        // 범위 안 몬스터 전부에게 주는 피해 (휩쓸기 5 · 평타 2 와 비교해 보세요)
  COOLDOWN: 10,      // 쿨타임(초)
  SIZE: 10,          // 정사각형 한 변 길이(m). 쓰는 사람을 중심으로, 바라보던 방향에 맞춰 고정
  DELAY: 0.6,        // 스킬을 누르고 땅을 찍을 때까지(초). 그 사이에 노란 네모로 범위가 보여요
};

// 스킬 목록. slot = 장착하는 칸 (E 칸은 휩쓸기 고정, R 칸이 바로 그 아래 칸)
export const SKILL_INFO = {
  sweep: {
    name: '휩쓸기', slot: 'E', base: true, cd: 10,
    desc: '검을 크게 휘둘러 앞쪽 넓은 부채꼴 안의 모든 몬스터에게 평타의 2.5배 피해를 줍니다.<br>(기본 스킬 · E 칸에 고정 · 쿨타임 10초)',
  },
  slam: {
    name: '내려찍기', slot: 'R', cd: SLAM.COOLDOWN,
    desc: '검을 높이 들었다가 땅을 힘껏 내려찍습니다.<br>' +
      '쓰면 바닥에 노란 네모(' + SLAM.SIZE + 'm × ' + SLAM.SIZE + 'm)로 범위가 뜨고, ' + SLAM.DELAY + '초 뒤 땅이 부서지며 파편이 솟아오릅니다. 범위 안의 모든 몬스터에게 <b>' + SLAM.DAMAGE + '</b>의 피해를 줍니다.<br>' +
      '쿨타임 ' + SLAM.COOLDOWN + '초 · 검을 들고 있어야 사용 · 장착 칸: R (E 칸 바로 아래)<br>' +
      '<span style="color:#7a5a30">오크 대전사의 기술을 책으로 익힌 스킬</span>',
  },
};

// 아이템 목록.
//  kind 'skillbook' : 인벤토리에서 '배우기'를 누르면 책이 사라지고 skill 을 배움
//  kind 'material'  : 재료 (겹쳐 쌓임)
//  kind 'gear'      : 장비. slot 칸에 장착하면 hp 만큼 최대 체력이 늘어남 (겹쳐 쌓이지 않고 한 개씩 한 칸)
export const ITEMS = {
  book_slam: {
    name: '스킬북: 내려찍기', kind: 'skillbook', skill: 'slam', icon: '📕', label: '스킬북',
    desc: '오크 대전사의 기술 \'내려찍기\'가 적힌 스킬북입니다.<br>배우기를 누르면 책이 사라지고, 스킬 창에서 R 칸에 장착할 수 있어요.<br>' +
      '<span style="color:#7a5a30">(이미 배운 스킬이면 배울 수 없어요)</span>',
  },
  rabbit_pelt: { name: '토끼 가죽', kind: 'material', icon: '🐰', img: '/ui/items/rabbit_pelt.png', label: '재료', desc: '토끼를 잡은 후 벗겨낸 가죽 입니다.' },
  rabbit_liver: { name: '토끼 간', kind: 'material', icon: '🥩', img: '/ui/items/rabbit_liver.png', label: '재료', desc: '용왕님이 좋아하는 토끼 간 입니다.' },
  slime_goo: { name: '슬라임 점액', kind: 'material', icon: '🟢', img: '/ui/items/slime_goo.png', label: '재료', desc: '슬라임을 잡고 나온 찌꺼기입니다.' },
  mana_low: { name: '하급 마정석', kind: 'material', icon: '💠', img: '/ui/items/mana_low.png', label: '재료', desc: '이 세상의 재화인 마정석 입니다.<br>여러 방면으로 사용할 수 있습니다.' },
  goblin_armor: { name: '고블린 갑옷', kind: 'gear', slot: 'armor', hp: 5, stack: false, icon: '🦺', img: '/ui/items/goblin_armor.png', label: '갑옷', desc: '고블린이 입던 갑옷 입니다.<br>더럽습니다.' },
  goblin_boots: { name: '고블린 신발', kind: 'gear', slot: 'boots', hp: 5, stack: false, icon: '🥾', label: '신발', desc: '고블린이 입던 신발 입니다.<br>더럽습니다.' },
};
export const GEAR_SLOT_NAME = { armor: '갑옷', boots: '신발' };

// 몬스터 드랍표. chance = 확률(1 = 100%), min~max = 개수. pick 이 있으면 그중 하나를 같은 확률로 골라서 줌
export const LOOT = {
  rabbit: [
    { id: 'rabbit_pelt', chance: 1, min: 1, max: 3 },
    { id: 'rabbit_liver', chance: 0.3, min: 1, max: 2 },
  ],
  goblin: [
    { id: 'mana_low', chance: 0.8, min: 1, max: 2 },
    { pick: ['goblin_armor', 'goblin_boots'], chance: 0.05, min: 1, max: 1 },
  ],
  slime: [
    { id: 'slime_goo', chance: 1, min: 1, max: 3 },
    { id: 'mana_low', chance: 0.8, min: 2, max: 3 },
  ],
  boss: [   // 오크 대전사: 피해를 준 사람마다 각자 받아요
    { id: 'mana_low', chance: 1, min: 10, max: 15 },
  ],
};
// 한 번 처치로 받는 아이템 목록 [{ id, n }]
export function rollLoot(kind, rnd = Math.random) {
  const out = [];
  for (const e of LOOT[kind] || []) {
    if (rnd() >= e.chance) continue;
    const id = e.pick ? e.pick[Math.floor(rnd() * e.pick.length) % e.pick.length] : e.id;
    out.push({ id, n: e.min + Math.floor(rnd() * (e.max - e.min + 1)) });
  }
  return out;
}
// 장비로 늘어나는 최대 체력 합 (gear = { armor: 아이템id | null, boots: ... })
export function gearHp(gear) {
  let t = 0;
  for (const k of Object.keys(GEAR_SLOT_NAME)) { const d = gear && ITEMS[gear[k]]; if (d && d.hp) t += d.hp; }
  return t;
}
// '토끼 가죽x2를 획득했습니다.' (숫자를 읽는 소리의 받침에 맞춰 을/를: 1·3·6·7·8·0 → 을, 2·4·5·9 → 를)
export function lootText(id, n) {
  const d = ITEMS[id];
  if (!d) return '';
  const josa = '013678'.includes(String(n).slice(-1)) ? '을' : '를';
  return d.name + 'x' + n + josa + ' 획득했습니다.';
}
