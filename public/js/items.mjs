// 아이템 · 스킬 정보 (서버와 브라우저가 같이 쓰는 파일)
// 인벤토리 창·스킬 창의 설명 글, 스킬북 드랍 확률, 플레이어 '내려찍기' 수치가 전부 여기 있어요.

export const INV_CAP = Infinity;              // 인벤토리 칸 수: 무제한 (숫자로 바꾸면 그 칸 수까지만 가질 수 있어요. 서로 다른 아이템 종류 기준, 같은 아이템은 겹쳐 쌓임)
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
  golem_core: { name: '골렘 코어', kind: 'material', icon: '🔷', img: '/ui/items/golem_core.png', label: '재료', desc: '골렘의 눈에 박혀 있던 빛나는 보석입니다.' },
  orc_hide: { name: '오크 가죽', kind: 'material', icon: '🟩', img: '/ui/orc_hide.png', label: '재료', desc: '냄새나는 오크 가죽 입니다.' },
  // 무기 장비: 장착하면 손에 드는 무기가 오크 도끼로 바뀌고, 평타·휩쓸기·내려찍기 모션도 도끼 전용이 돼요 (weapon.js 의 MOTION.orc_axe)
  orc_axe: { name: '오크 도끼', kind: 'gear', slot: 'weapon', weapon: 'orc_axe', dmg: 2.2, stack: false, icon: '🪓', img: '/ui/orc_axe.png', label: '무기', note: '장착하면 들고 있는 무기가<br>오크 도끼로 바뀌어요.<br>공격력이 나무검의 2.2배예요.', desc: '오크가 쓰던 낡은 도끼 입니다.<br>나무검보다 2.2배 강합니다.' },
  // 제작 무기: 대장간 제작대에서 만들어요 (CRAFT_RECIPES). 장착하면 손에 드는 무기가 돌 검으로 바뀌고, 공격력(평타·스킬 전부)이 dmg 배가 돼요 (돌 검 1.4배, 오크 도끼 2.2배). 공격 속도는 나무검과 같아요
  stone_sword: { name: '돌 검', kind: 'gear', slot: 'weapon', weapon: 'stone_sword', dmg: 1.4, stack: false, icon: '🗡️', img: '/ui/stone_sword.png', label: '무기', note: '장착하면 들고 있는 무기가<br>돌 검으로 바뀌어요.<br>공격력이 나무검의 1.4배예요.', desc: '단단한 돌을 갈아 만든 검입니다.<br>나무검보다 1.4배 강합니다.' },
  orc_heart: { name: '오크 심장', kind: 'material', icon: '❤️', img: '/ui/orc_heart.png', label: '재료', desc: '오크의 거대한 심장 입니다.<br>어딘가에 쓰일지도 모릅니다...' },
  // 고릴라 전리품 (그림 파일이 없어서 이모지로 보여요. /ui/gorilla_hide.png, /ui/gorilla_skull.png 를 올리고 img 를 추가하면 그림으로 바뀌어요)
  gorilla_hide: { name: '고릴라의 두꺼운 가죽', kind: 'material', icon: '🟫', label: '재료', desc: '고릴라의 두꺼운 가죽입니다.' },
  gorilla_skull: { name: '고릴라의 두개골', kind: 'material', icon: '💀', label: '재료', desc: '고릴라의 단단한 두개골 입니다.' },
  goblin_armor: { name: '고블린 갑옷', kind: 'gear', slot: 'armor', hp: 5, stack: false, icon: '🦺', img: '/ui/items/goblin_armor.png', label: '갑옷', desc: '고블린이 입던 갑옷 입니다.<br>더럽습니다.' },
  goblin_pants: { name: '고블린 바지', kind: 'gear', slot: 'pants', hp: 5, stack: false, icon: '👖', img: '/ui/items/goblin_pants.png', label: '바지', desc: '고블린이 입던 바지 입니다.<br>더럽습니다.' },
};
export const GEAR_SLOT_NAME = { armor: '갑옷', pants: '바지', weapon: '무기' };

// 대장간 제작 목록 (제작대에서 E). time = 제작 시간(초), mats = 필요 재료, result = 완성되는 아이템.
// craftable: false 면 목록에만 보이고 아직 만들 수 없어요. 재료·시간을 바꾸려면 여기만 고치면 돼요 (서버와 화면이 같이 읽어요)
export const CRAFT_RECIPES = [
  { id: 'wooden_sword', name: '나무검', icon: '🗡️', craftable: false },
  { id: 'stone_sword', name: '돌 검', result: 'stone_sword', time: 30, craftable: true, mats: [{ id: 'mana_low', n: 5 }, { id: 'rabbit_liver', n: 5 }] },
];
// ---------- 퀘스트 (마을 이장이 줘요) ----------
// 메인퀘스트는 main_1 → main_2 → main_3 순서로 이어져요 (prev = 먼저 끝내야 하는 퀘스트).
// goal = 모아야 하는 아이템. 이장에게 줘도 인벤토리에서 빠지지 않아요 (가진 걸 확인만 해요. 입고 있는 장비도 가진 걸로 쳐요).
// goalText = 퀘스트 창에 보이는 목표 글, reward = 보상 (exp 와 아이템).
// main_1 의 exp 82 = 1레벨 필요 경험치(165)의 절반 → 1레벨에서 2레벨로 가는 길의 중간쯤
export const QUEST_DEFS = {
  main_1: {
    id: 'main_1', title: '메인퀘스트 1', summary: '토끼 간 5개 구하기', goalText: '토끼 간 5개 구하기',
    desc: '마을 이장이 토끼 간 5개를 구해다 달라고 부탁했다.\n평원의 토끼를 사냥해서 토끼 간을 모은 뒤, 이장에게 가져다주자.',
    goal: { item: 'rabbit_liver', n: 5 },
    reward: { exp: 82, items: [{ id: 'mana_low', n: 5 }] },
  },
  main_2: {
    id: 'main_2', prev: 'main_1', title: '메인퀘스트 2', summary: '마정석 10개 구하기', goalText: '하급 마정석 10개 구하기',
    desc: '이장이 이번에는 마정석 10개를 구해보라고 했다.\n고블린·슬라임·골렘 같은 몬스터를 사냥하면 마정석을 얻을 수 있다.\n10개를 모으면 이장에게 가자. (이장에게 보여주기만 하고 빼앗기지는 않는다)',
    goal: { item: 'mana_low', n: 10 },
    reward: { exp: 200, items: [{ id: 'rabbit_pelt', n: 10 }] },
  },
  main_3: {
    id: 'main_3', prev: 'main_2', title: '메인퀘스트 3', summary: '돌 검 만들기', goalText: '돌 검 만들기',
    desc: '이장이 이제 강해질 시간이라며 돌 검을 만들어보라고 했다.\n대장간 제작대에서 돌 검(하급 마정석 5개 + 토끼 간 5개)을 만들어 이장에게 보여주자.',
    goal: { item: 'stone_sword', n: 1 },
    reward: { exp: 250, items: [{ id: 'mana_low', n: 20 }] },
  },
};
// 이장 대사 (선택지는 화면 아래 버튼으로 떠요). 퀘스트 상태에 따라 화면(main.js)이 골라서 보여줘요
// quests[퀘스트id] = { intro(처음 말 걸 때, 없으면 위 intro), accepted(수락 후), waiting(아직 모자람), ready(다 모음), rewarded(보상 받은 뒤) }
export const CHIEF_TALK = {
  name: '마을 이장',
  intro: '허허 안녕하신가? 나는 이 마을의 이장이라네. 내 부탁을 좀 들어주지 않겠나?',
  introChoices: ['메인퀘스트 시작하기', '거절하기'],
  declined: '그런가... 마음이 바뀌면 언제든 다시 찾아오게나.',
  readyChoice: '보상 받기',
  done: '자네 덕분에 한시름 놓았다네. 정말 고맙네!',
  close: '닫기',
  quests: {
    main_1: {
      accepted: '고맙구먼! 평원의 토끼들에게서 토끼 간 5개만 구해다 주게나. 부탁하네.',
      waiting: '토끼 간은 아직 다 구하지 못했나? 서두를 건 없으니 천천히 구해다 주게나.',
      ready: '오오, 토끼 간을 구해왔구먼! 정말 고맙네. 약소하지만 보답을 받아주게나.',
      rewarded: '고맙네! 자네 덕분에 큰 도움이 되었네.',
    },
    main_2: {
      intro: '허허 토끼간을 구해다 주어서 고맙네. 그럼 이번엔 마정석 10개를 구해보게나.',
      accepted: '고맙구먼! 몬스터들이 가끔 떨어뜨리는 마정석을 10개만 구해다 주게나.',
      waiting: '마정석은 아직 다 구하지 못했나? 천천히 구해다 주게나.',
      ready: '오오, 마정석을 다 구해왔구먼! 정말 고맙네. 보답을 받아주게나. 마정석은 자네가 계속 가지고 있게나.',
      rewarded: '고맙네! 자네는 정말 믿음직한 사람이구먼.',
    },
    main_3: {
      intro: '마정석을 구해줘서 고맙네. 이제 자네도 강해질 시간이군. 돌검을 만들어보게나.',
      accepted: '대장간 제작대에서 돌 검을 만들 수 있다네. 재료를 챙겨서 가보게나.',
      waiting: '돌 검은 아직 만들지 못했나? 대장간 제작대를 찾아가 보게나.',
      ready: '오오, 돌 검을 만들었구먼! 한결 든든하네. 보답을 받아주게나.',
      rewarded: '자네가 점점 강해지는 모습이 보기 좋구먼! 앞으로도 몸조심하게나.',
    },
  },
};

// 들고 있는 무기로 정해지는 공격력 배율 (무기를 안 끼면 나무검 = 1배). gear = { weapon: 아이템id | null, ... }
export const weaponDmg = (gear) => { const d = gear && ITEMS[gear.weapon]; return d && d.dmg ? d.dmg : 1; };

// 몬스터 드랍표. chance = 확률(1 = 100%), min~max = 개수. pick 이 있으면 그중 하나를 같은 확률로 골라서 줌
export const LOOT = {
  rabbit: [
    { id: 'rabbit_pelt', chance: 1, min: 1, max: 3 },
    { id: 'rabbit_liver', chance: 0.3, min: 1, max: 2 },
  ],
  goblin: [
    { id: 'mana_low', chance: 0.8, min: 1, max: 2 },
    { pick: ['goblin_armor', 'goblin_pants'], chance: 0.05, min: 1, max: 1 },
  ],
  slime: [
    { id: 'slime_goo', chance: 1, min: 1, max: 3 },
    { id: 'mana_low', chance: 0.8, min: 2, max: 3 },
  ],
  golem: [
    { id: 'mana_low', chance: 1, min: 5, max: 5 },
    { id: 'golem_core', chance: 0.1, min: 1, max: 1 },
  ],
  gorilla: [   // 정글 고릴라
    { id: 'gorilla_hide', chance: 1, min: 1, max: 5 },       // 100% · 1~5개
    { id: 'gorilla_skull', chance: 0.5, min: 1, max: 1 },    // 50%
  ],
  boss: [   // 오크 대전사: 피해를 준 사람마다 각자 받아요
    { id: 'mana_low', chance: 1, min: 10, max: 15 },
    { id: 'orc_hide', chance: 1, min: 1, max: 5 },       // 100% · 1~5개
    { id: 'orc_axe', chance: 0.10, min: 1, max: 1 },     // 10%
    { id: 'orc_heart', chance: 0.05, min: 1, max: 1 },   // 5%
  ],
};
// 한 번 처치로 받는 아이템 목록 [{ id, n }]
export function rollLoot(kind, rnd = Math.random, luck = 1) {   // luck: LUK 스탯으로 늘어난 아이템 획득 확률 배율 (확정 100% 드롭은 그대로)
  const out = [];
  for (const e of LOOT[kind] || []) {
    if (rnd() >= (e.chance >= 1 ? 1 : Math.min(1, e.chance * luck))) continue;
    const id = e.pick ? e.pick[Math.floor(rnd() * e.pick.length) % e.pick.length] : e.id;
    out.push({ id, n: e.min + Math.floor(rnd() * (e.max - e.min + 1)) });
  }
  return out;
}
// 장비로 늘어나는 최대 체력 합 (gear = { armor: 아이템id | null, pants: ... })
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
