const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
// .mjs 파일(goblin.mjs)을 자바스크립트로 인식시키기. 안 하면 브라우저가 모듈 로드를 거부해요.
try { if (express.static.mime) express.static.mime.define({ 'application/javascript': ['mjs'] }); } catch (e) { /* 무시 */ }
app.use(express.static('public'));
// ---------- 회원가입 / 로그인 (accounts.js) ----------
const acc = require('./accounts.js');
app.set('trust proxy', 1);
app.use('/api', express.json({ limit: '2kb' }));
const authApi = (fn) => async (req, res) => {
  try { res.json(await fn(req.body || {}, req.ip || 'x')); }
  catch (e) { console.error('인증 오류:', e); res.status(500).json({ ok: false, error: 'server', message: '서버 오류가 났어요. 잠시 뒤에 다시 해주세요.' }); }
};
app.post('/api/register', authApi((b, ip) => acc.register(b.nick, b.password, ip)));
app.post('/api/login', authApi((b, ip) => acc.login(b.nick, b.password, ip)));
app.post('/api/resume', authApi((b) => { const v = acc.verify(b.token); return v ? { ok: true, nick: v.name } : { ok: false, error: 'expired' }; }));
app.post('/api/logout', authApi((b) => { acc.logout(b.token); return { ok: true }; }));

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SEED = Number(process.env.WORLD_SEED) || 12345;
const MAX_PLAYERS = 20;
const MAX_SPEED = 30;      // units/sec (달리기 14 + 여유)
const FAST_MULT = 100;     // 클라이언트 FAST_MULT와 같은 값
const players = new Map();
const openDoors = new Set();   // 열려 있는 문 (집 번호). 접속자끼리 같은 상태를 보도록 서버가 기억
const MAX_DOORS = 64;
const ATTACK_MIN_MS = 550;   // 평타 최소 간격 (클라이언트 쿨다운 0.7초보다 조금 느슨하게 → 네트워크 지터 허용)
const EQUIP_MIN_MS = 300;    // 장착/해제 토글 최소 간격

// ---------- 고블린 (평원 몬스터) ----------
// 위치·추적·공격·체력은 전부 서버가 정해요. 계산 코드는 public/js/goblin-ai.mjs (브라우저도 같은 설정값을 읽음).
// terrain.js 는 브라우저용 ESM 이라 파일 내용을 읽어서 불러와요 (파일을 따로 복사해 둘 필요 없음).
let sim = null;
let SKILLS = null;   // goblin-ai.mjs 의 스킬 설정 (쿨타임 등)
(async () => {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'public/js/terrain.js'), 'utf8');
    const terr = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
    const ai = await import(pathToFileURL(path.join(__dirname, 'public/js/goblin-ai.mjs')).href);
    sim = ai.createGoblinSim({ T: terr.makeTerrain(SEED), seed: SEED, WATER_LEVEL: terr.WATER_LEVEL, VILLAGE: terr.VILLAGE, PLAY_RADIUS: terr.PLAY_RADIUS });
    SKILLS = ai.SKILLS;
    console.log('고블린 ' + sim.goblins.length + '마리 배치 완료');
  } catch (e) {
    console.error('고블린 시스템 로드 실패 (고블린 없이 계속 진행):', e);
  }
})();

// ---------- 토끼 (평원 초반부 몬스터, 선공 없음) ----------
// 고블린과 같은 방식이에요. 계산 코드는 public/js/rabbit-ai.mjs. 로드에 실패해도 고블린·게임은 그대로 돌아가요.
let rabSim = null;
(async () => {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'public/js/terrain.js'), 'utf8');
    const terr = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
    const ai = await import(pathToFileURL(path.join(__dirname, 'public/js/rabbit-ai.mjs')).href);
    rabSim = ai.createRabbitSim({ T: terr.makeTerrain(SEED), seed: SEED, WATER_LEVEL: terr.WATER_LEVEL, VILLAGE: terr.VILLAGE, PLAY_RADIUS: terr.PLAY_RADIUS });
    console.log('토끼 ' + rabSim.rabbits.length + '마리 배치 완료');
  } catch (e) {
    console.error('토끼 시스템 로드 실패 (토끼 없이 계속 진행):', e);
  }
})();

// ---------- 슬라임 (슬라임 고원 = 평원 동쪽~남동쪽, 선공) ----------
// 고블린·토끼와 같은 방식이에요. 계산 코드는 public/js/slime-ai.mjs. 로드에 실패해도 다른 몬스터·게임은 그대로 돌아가요.
let sliSim = null;
(async () => {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'public/js/terrain.js'), 'utf8');
    const terr = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
    const ai = await import(pathToFileURL(path.join(__dirname, 'public/js/slime-ai.mjs')).href);
    sliSim = ai.createSlimeSim({ T: terr.makeTerrain(SEED), seed: SEED, WATER_LEVEL: terr.WATER_LEVEL, VILLAGE: terr.VILLAGE, PLAY_RADIUS: terr.PLAY_RADIUS });
    console.log('슬라임 ' + sliSim.slimes.length + '마리 배치 완료');
  } catch (e) {
    console.error('슬라임 시스템 로드 실패 (슬라임 없이 계속 진행):', e);
  }
})();

// ---------- 아이템 · 스킬북 (인벤토리 / 배우기 / 장착) ----------
// 목록·설명·확률·수치는 public/js/items.mjs. 로드에 실패해도 게임은 그대로 돌아가요(아이템만 못 얻음).
// 플레이어 정보: p.inv = [{ id, n }] (인벤토리), p.learned = ['slam'] (배운 스킬), p.slotR = 'slam' | null (R 칸에 장착한 스킬)
let ITEMS_MOD = null;
(async () => {
  try { ITEMS_MOD = await import(pathToFileURL(path.join(__dirname, 'public/js/items.mjs')).href); }
  catch (e) { console.error('아이템 정보 로드 실패 (아이템 없이 계속 진행):', e); }
})();
// 진행 상황(인벤토리·스킬·장비·레벨·마지막 위치)은 계정에 저장돼요 (accounts.js → DATA_DIR/accounts.json).
// 같은 계정으로 다시 로그인하면 그대로 이어서 해요. 서버를 다시 켜거나 업데이트해도 DATA_DIR 이 영구 디스크면 유지돼요.
// 경험치·골드: 숫자가 아니면 0, 음수는 0, 상한 초과는 상한으로 잘라서(정수) 저장·복구해요
const EXP_MAX = 1e12, GOLD_MAX = 1e12;
const cleanNum = (v, max) => (Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0);
const MAX_LEVEL = 100;   // 만렙
const expNeed = (lv) => { lv = Math.max(1, lv); return (10 + 5 * lv) * (10 + lv); };   // 레벨 N 에서 다음 레벨까지 필요한 경험치 (화면 main.js 의 expNeed 와 같은 공식이어야 해요)
// 경험치가 다 차면 레벨이 올라가요 (남은 경험치는 다음 레벨로 이월, 한 번에 여러 레벨도 가능)
const settleExp = (p) => {
  p.level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(Number.isFinite(p.level) ? p.level : 1)));
  while (p.level < MAX_LEVEL && p.exp >= expNeed(p.level)) { p.exp -= expNeed(p.level); p.level++; }
  if (p.level >= MAX_LEVEL) p.exp = Math.min(p.exp, expNeed(p.level) - 1);
};
const saveProfile = (p) => {
  if (!p || !p.acct || !p.inv) return;
  const old = acc.getProfile(p.acct);
  // 땅 위에 있을 때만 위치를 새로 저장 (동굴·집 안이면 마지막 땅 위 위치를 그대로 둠)
  const above = p.spawned && [p.x, p.z].every(Number.isFinite) && p.y >= UNDER_Y && Math.abs(p.x) < 5000 && Math.abs(p.z) < 5000;
  const pos = above ? { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 } : (old && old.pos) || null;
  acc.setProfile(p.acct, { inv: p.inv.map((i) => ({ ...i })), learned: [...p.learned], slotR: p.slotR, gear: { ...p.gear }, craft: p.craft ? { id: p.craft.id, end: p.craft.end } : null, quests: { ...p.quests }, level: p.level, exp: cleanNum(p.exp, EXP_MAX), gold: cleanNum(p.gold, GOLD_MAX), stats: { ...p.stats }, pos });
};
function kickPlayer(o) {   // 같은 계정으로 다른 곳에서 로그인하면 먼저 있던 접속을 끊어요
  saveProfile(o);
  players.delete(o.id);
  const s = io.sockets.sockets.get(o.id);
  if (s) { s.emit('kicked'); s.disconnect(true); }
}
const sendInv = (p) => io.to(p.id).emit('inv', { items: p.inv });
const sendSkills = (p) => io.to(p.id).emit('skills', { learned: p.learned, slotR: p.slotR });
const sendExp = (p) => { io.to(p.id).emit('exp', { level: p.level, exp: p.exp, expMax: expNeed(p.level), gold: p.gold }); sendStats(p); };   // 레벨업으로 늘어난 스탯 포인트도 같이   // 경험치를 얻었을 때 이걸 부르면 화면 경험치 바가 차올라요
// 경험치 주기: addExp(p, 숫자) → 다 차면 자동으로 레벨업하고 화면에 알려줘요 (몬스터 처치 등에서 이걸 부르면 돼요)
const addExp = (p, n) => { if (!p || !Number.isFinite(n) || n <= 0) return; p.exp = cleanNum(p.exp + n, EXP_MAX); settleExp(p); sendExp(p); };   // 저장은 30초마다·접속 끊길 때 자동으로 돼요
// ---- 몬스터 레벨 · 처치 경험치 ----
const BOSS_REWARD_FRAC = 0.07;   // 보스 체력의 7% 이상 깎아야 보상
const MOB_LV = { rabbit: 1, goblin: 3, slime: 7, golem: 15, boss: 35 };   // boss = 오크 대전사
const MOB_EXP_MULT = { boss: 4 };                                          // 보스는 같은 레벨 일반 몬스터의 4배
const mobBaseExp = (type) => (10 + 5 * MOB_LV[type]) * (MOB_EXP_MULT[type] || 1);   // 같은 레벨일 때 주는 경험치
// 내 레벨(plv)로 type 몬스터를 잡았을 때 받는 경험치
//  - 몬스터 단계(약한 순: 토끼 → 고블린 → 슬라임 → 골렘 → 오크)로 따져서, 내 단계보다 두 단계 이상 강한 몬스터는 경험치·전리품 모두 없음
//    (내 단계 = 내 레벨 이하인 몬스터 중 가장 강한 몬스터. 예: 1레벨은 토끼 단계라서 고블린까지만 보상, 슬라임은 0)
//  - 위 몬스터: 레벨 차이 1당 +5%(최대 +25%) / 아래 몬스터: 레벨 차이 1당 -15%, 6 이상 낮으면 0
const MOB_TIERS = ['rabbit', 'goblin', 'slime', 'golem', 'boss'];
const playerTier = (plv) => { let k = 0; for (let i = 0; i < MOB_TIERS.length; i++) if (MOB_LV[MOB_TIERS[i]] <= plv) k = i; return k; };
// 내 단계보다 두 단계 이상 강한 몬스터는 경험치도 전리품도 없어요 (보스 포함)
const canReward = (plv, type) => !MOB_LV[type] || MOB_TIERS.indexOf(type) - playerTier(plv) < 2;
const expReward = (plv, type) => {
  const mlv = MOB_LV[type];
  if (!mlv || !canReward(plv, type)) return 0;
  const d = mlv - plv;
  if (d <= -6) return 0;
  return Math.floor(mobBaseExp(type) * (d >= 0 ? 1 + 0.05 * Math.min(d, 5) : 1 + 0.15 * d));
};
const giveExp = (pid, type) => { const p = players.get(pid); if (p) addExp(p, expReward(p.level, type)); };   // 안내 문구 없이 경험치 바만 올라가요
const sendToast = (p, msg) => io.to(p.id).emit('toast', { msg });
function addItem(p, id, n = 1) {   // 성공하면 true, 칸이 없으면 false (장비는 한 개당 한 칸, 재료·책은 겹쳐 쌓임)
  const def = ITEMS_MOD && ITEMS_MOD.ITEMS[id];
  if (!def) return false;
  if (def.stack === false) {
    if (p.inv.length + n > ITEMS_MOD.INV_CAP) return false;
    for (let i = 0; i < n; i++) p.inv.push({ id, n: 1 });
  } else {
    const st = p.inv.find((i) => i.id === id);
    if (st) st.n += n;
    else if (p.inv.length < ITEMS_MOD.INV_CAP) p.inv.push({ id, n });
    else return false;
  }
  saveProfile(p);
  return true;
}
// 몬스터를 잡았을 때 드랍표대로 굴려서 인벤토리에 넣고, 화면 아래에 '아이템x개수를 획득했습니다.' 를 띄움
function giveLoot(pid, kind) {
  const p = players.get(pid);
  if (!p || !ITEMS_MOD || !p.inv) return;
  if (!canReward(p.level, kind)) return;   // 두 단계 이상 강한 몬스터는 전리품도 없어요
  const got = [];
  let full = false;
  let wore = false;
  for (const e of ITEMS_MOD.rollLoot(kind, Math.random, p.dropMul || 1)) {
    const def = ITEMS_MOD.ITEMS[e.id];
    if (def && def.kind === 'gear' && !p.gear[def.slot]) { p.gear[def.slot] = e.id; got.push(e); wore = true; continue; }   // 장비는 비어 있는 칸이면 인벤토리를 거치지 않고 바로 입음
    if (addItem(p, e.id, e.n)) got.push(e); else full = true;   // 이미 입은 칸이면 인벤토리로
  }
  if (wore) applyGear(p);   // 최대 체력·입은 모습·저장
  if (got.length) { sendInv(p); io.to(pid).emit('loot', { items: got }); }
  if (full) sendToast(p, '인벤토리가 가득 차서 일부 아이템을 얻지 못했어요');
}
// ---------- 퀘스트 (마을 이장) ----------
// 진행 상황은 p.quests = { 퀘스트id: 'active' | 'done' } (받지 않은 퀘스트는 없음). 내용(목표·보상)은 items.mjs 의 QUEST_DEFS
const cleanQuests = (raw) => {
  const out = {};
  if (raw && typeof raw === 'object' && ITEMS_MOD && ITEMS_MOD.QUEST_DEFS) for (const id of Object.keys(ITEMS_MOD.QUEST_DEFS)) if (raw[id] === 'active' || raw[id] === 'done') out[id] = raw[id];
  return out;
};
const sendQuests = (p) => io.to(p.id).emit('quests', { ...p.quests });
const questResult = (p, id, act, ok, msg) => io.to(p.id).emit('quest:result', { id, act, ok, msg: msg || '' });

// ---------- 대장간 무기 제작 (제작대에서 E) ----------
// 재료는 시작할 때 바로 빠지고, 시간(items.mjs 의 CRAFT_RECIPES.time 초)이 지나면 '수령하기'로 받아요. 한 번에 하나만 제작.
// 끝나는 시각(p.craft.end)을 저장해서, 제작 중에 접속을 끊어도 시간은 계속 흘러요.
const craftOf = (id) => (ITEMS_MOD && ITEMS_MOD.CRAFT_RECIPES ? ITEMS_MOD.CRAFT_RECIPES.find((r) => r.id === id && r.craftable) : null) || null;
const sendCraft = (p) => io.to(p.id).emit('craft', p.craft ? { id: p.craft.id, left: Math.max(0, p.craft.end - Date.now()) } : { id: null });
function craftTick(now) {   // 제작이 끝난 사람에게 한 번 알려줘요
  for (const p of players.values()) {
    if (!p.craft || p.craftNotified || now < p.craft.end) continue;
    p.craftNotified = true;
    const r = craftOf(p.craft.id);
    sendToast(p, (r ? ITEMS_MOD.ITEMS[r.result].name : '무기') + ' 제작이 완료되었습니다! 대장간 제작대에서 받아가세요.');
    sendCraft(p);
  }
}
// ---------- 장비 (갑옷·신발): 장착하면 최대 체력이 늘어요 ----------
const sendGear = (p) => io.to(p.id).emit('gear', { gear: p.gear });
// ---------- 스탯 (레벨업마다 6포인트) ----------
// 1포인트당 효과. 아래 퍼센트는 처음에 만렙 100(총 495포인트) 기준으로 잡은 값이고(지금은 레벨당 6포인트라 만렙 총 594포인트), 몬스터를 아주 세게 만들 계획이라 퍼센트를 넉넉하게 잡았어요. 여기 숫자만 바꾸면 돼요
const STAT_KEYS = ['str', 'dex', 'con', 'int', 'luk', 'agi'];
const STAT = {
  PER_LEVEL: 6,                     // 레벨업마다 받는 포인트. 남은 포인트는 'PER_LEVEL × (레벨-1) − 찍은 합'으로 늘 새로 계산해서, 이 숫자를 바꾸면 이미 있는 사람들도 바뀐 만큼 자동으로 더 받아요
  STR_DMG: 0.04,                    // STR: 공격력 +4%
  DEX_MOVE: 1 / (5 * (MAX_LEVEL - 1)), MOVE_MAX: 1.0,   // DEX: 이동 속도 — 만렙(100레벨)의 총 495포인트를 전부 찍으면 정확히 +100% (포인트당 약 +0.2%)
  CON_HP: 10,                       // CON: 최대 HP +10
  INT_MP: 6, MP_BASE: 50,           // INT: 최대 MP +6 (기본 50)
  LUK_CRITDMG: 0.02, CRITDMG_BASE: 1.5, LUK_DROP: 0.006, DROP_MAX: 1.0,   // LUK: 치명타 피해 +2%(기본 150%), 아이템 획득 확률 +0.6%(최대 +100%)
  AGI_ASPD: 0.008, ASPD_MAX: 0.5,   // AGI: 공격 속도 +0.8% (최대 +50%)
  AGI_CRIT: 0.008, CRIT_MAX: 0.5    // AGI: 치명타 확률 +0.8% (최대 50%)
};
const zeroStats = () => ({ str: 0, dex: 0, con: 0, int: 0, luk: 0, agi: 0 });
const cleanStats = (raw) => { const s = zeroStats(); if (raw && typeof raw === 'object') for (const k of STAT_KEYS) { const v = raw[k]; s[k] = Number.isFinite(v) && v >= 0 && v <= 99999 ? Math.floor(v) : 0; } return s; };
const statSum = (p) => STAT_KEYS.reduce((a, k) => a + p.stats[k], 0);
const statPts = (p) => STAT.PER_LEVEL * (p.level - 1) - statSum(p);   // 아직 안 쓴 포인트
// 레벨보다 많이 쓴 상태(저장 데이터가 이상하거나 개발자 도구로 레벨을 내림)면 전부 초기화
const fitStats = (p) => { if (!p.stats) p.stats = zeroStats(); if (statPts(p) < 0) p.stats = zeroStats(); };
// 스탯 → 실제 능력치 (몬스터 sim 은 p.dmgMult·critChance·critDmg 를 읽어요)
const weaponMul = (p) => (ITEMS_MOD && ITEMS_MOD.weaponDmg ? ITEMS_MOD.weaponDmg(p.gear) : 1);   // 장착한 무기의 공격력 배율 (안 끼면 나무검 = 1)
function applyStats(p) {
  fitStats(p);
  const s = p.stats;
  p.dmgMult = (p.devDmg || 1) * (1 + STAT.STR_DMG * s.str) * weaponMul(p);   // 개발자 도구 배율 × STR × 들고 있는 무기 배율(돌 검 2배)
  p.critChance = Math.min(STAT.CRIT_MAX, STAT.AGI_CRIT * s.agi);
  p.critDmg = STAT.CRITDMG_BASE + STAT.LUK_CRITDMG * s.luk;
  p.dropMul = 1 + Math.min(STAT.DROP_MAX, STAT.LUK_DROP * s.luk);
  p.atkSpd = Math.min(STAT.ASPD_MAX, STAT.AGI_ASPD * s.agi);
  p.moveSpd = Math.min(STAT.MOVE_MAX, STAT.DEX_MOVE * s.dex);
  p.mpMax = STAT.MP_BASE + STAT.INT_MP * s.int;
}
const sendStats = (p) => io.to(p.id).emit('stats', {
  pts: statPts(p), stats: { ...p.stats }, mpMax: p.mpMax,
  dmg: (1 + STAT.STR_DMG * p.stats.str) * weaponMul(p) - 1, crit: p.critChance, critDmg: p.critDmg, drop: p.dropMul - 1, aspd: p.atkSpd, move: p.moveSpd
});
const calcHpMax = (p) => Math.max(1, Math.round(PLAYER_HP_MAX * (p.hpMult || 1))) + (ITEMS_MOD ? ITEMS_MOD.gearHp(p.gear) : 0) + (p.stats ? STAT.CON_HP * p.stats.con : 0);
// 스탯이 바뀐 뒤: 능력치·최대 체력을 다시 계산하고 화면에 알려줘요 (최대 체력이 늘면 현재 체력도 같이 늘어요)
function refreshStats(p) {
  applyStats(p);
  const max = calcHpMax(p), diff = max - p.hpMax;
  p.hpMax = max;
  p.hp = diff > 0 ? Math.min(max, p.hp + diff) : Math.min(p.hp, max);
  if (p.dead) p.hp = 0;   // 쓰러져 있는 동안은 체력이 늘어도 0 유지
  io.to(p.id).emit('hp', { hp: p.hp, max: p.hpMax });
  sendStats(p); saveProfile(p);
}
function applyGear(p) {   // 최대 체력을 다시 계산: 늘어난 만큼 현재 체력도 같이 늘고, 줄면 최대치에 맞춰 깎임 (무기를 바꾸면 공격력도 다시 계산)
  applyStats(p);
  const max = calcHpMax(p), diff = max - p.hpMax;
  p.hpMax = max;
  p.hp = diff > 0 ? Math.min(max, p.hp + diff) : Math.min(p.hp, max);
  if (p.dead) p.hp = 0;   // 쓰러져 있는 동안은 체력이 늘어도 0 유지
  io.to(p.id).emit('hp', { hp: p.hp, max: p.hpMax });
  saveProfile(p); sendGear(p); sendInv(p); sendStats(p);
}

// ---------- 보스 오크 대전사 (고블린 구역 한가운데의 어두운 흙 터) ----------
// 계산 코드는 public/js/boss-ai.mjs, 터 위치는 terrain.js 가 시드마다 정해요. 로드에 실패해도 다른 몬스터·게임은 그대로 돌아가요.
let bossSim = null;
(async () => {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'public/js/terrain.js'), 'utf8');
    const terr = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
    const ai = await import(pathToFileURL(path.join(__dirname, 'public/js/boss-ai.mjs')).href);
    const zones = await import(pathToFileURL(path.join(__dirname, 'public/js/plain-zones.mjs')).href);
    bossSim = ai.createBossSim({ T: terr.makeTerrain(SEED) });
    if (bossSim) {
      const a = bossSim.arena;
      console.log('보스 오크 대전사 배치 완료 (터 중심 ' + a.x + ', ' + a.z + ')');
      if (zones.plainZoneAt(a.x, a.z, terr.VILLAGE) !== 'goblin') console.warn('경고: 보스 터가 고블린 구역 밖이에요. terrain.js 의 findArena 각도(145/300)를 plain-zones.mjs 와 맞춰 주세요.');
    } else console.warn('보스 터로 쓸 알맞은 평원을 못 찾아서 보스 없이 진행해요.');
  } catch (e) {
    console.error('보스 시스템 로드 실패 (보스 없이 계속 진행):', e);
  }
})();

// ---------- 지하 동굴 + 골렘 ----------
// 평원 중반부에 동굴 입구가 있고, 동굴 안(아주 깊은 땅 밑)에 골렘 20마리가 살아요.
// 지도·충돌은 public/js/cave-layout.mjs, 골렘 두뇌는 public/js/golem-ai.mjs. 입구 위치는 서버가 정해서 접속한 브라우저에 알려줘요.
let golSim = null;
let caveEnt = null;     // 동굴 입구 { x, z }
let UNDER_Y = -100;     // 이보다 낮으면 지하 (땅 위 몬스터는 지하 플레이어를 못 봄)
(async () => {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'public/js/terrain.js'), 'utf8');
    const terr = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
    const L = await import(pathToFileURL(path.join(__dirname, 'public/js/cave-layout.mjs')).href);
    const ai = await import(pathToFileURL(path.join(__dirname, 'public/js/golem-ai.mjs')).href);
    const ent = L.findEntrance(terr.makeTerrain(SEED), SEED, terr.WATER_LEVEL, terr.VILLAGE);
    if (!ent) throw new Error('동굴 입구로 쓸 평평한 평원을 못 찾음');
    golSim = ai.createGolemSim({ layout: L.makeCaveLayout(ent, SEED), seed: SEED });
    UNDER_Y = L.CAVE.UNDER_Y;
    caveEnt = ent;
    io.emit('cave', caveEnt);   // 이미 접속해 있는 사람에게도 알림
    console.log('동굴 입구 (' + ent.x + ', ' + ent.z + '), 골렘 ' + golSim.golems.length + '마리 배치 완료');
  } catch (e) {
    console.error('동굴/골렘 시스템 로드 실패 (동굴 없이 계속 진행):', e);
  }
})();

const PLAYER_HP_MAX = 100;
// 개발자 도구: 이 닉네임으로 접속한 사람은 화면 위 패널에서 자기 데미지·체력 배율을 바꿀 수 있어요.
// ※ 닉네임만 확인하는 방식이라 같은 닉네임을 쓰면 누구나 쓸 수 있어요. 공개 서버로 열 땐 비밀번호 방식으로 바꾸세요.
const DEV_NICK = '박준우';
const DEV_MULT_MIN = 0.1, DEV_MULT_MAX = 1000;
const HP_REGEN_SEC = 2;      // 자연 회복: 이 시간(초)마다
const HP_REGEN_AMOUNT = 1;   // 이만큼 회복

// 플레이어 체력 자연 회복
function regenPlayers(dt) {
  for (const p of players.values()) {
    if (!p.spawned || p.dead || p.hp >= p.hpMax) { p.regenT = 0; continue; }
    p.regenT = (p.regenT || 0) + dt;
    if (p.regenT < HP_REGEN_SEC) continue;
    p.regenT -= HP_REGEN_SEC;
    p.hp = Math.min(p.hpMax, p.hp + HP_REGEN_AMOUNT);
    io.to(p.id).emit('hp', { hp: p.hp, max: p.hpMax });
  }
}

// 플레이어가 몬스터에게 맞음. 체력이 0이 되면 그 자리에서 쓰러지고(화면이 쓰러지는 모션을 보여줘요), 몇 초 뒤 시작 마을에서 체력을 가득 채워 다시 시작시켜요. 안내 메시지는 없어요
const PLAYER_DEATH_MS = 3000;   // 쓰러진 뒤 시작 마을로 돌아가기까지(ms). 쓰러지는 모션 0.7초 + 누워 있는 시간 (몬스터와 비슷하게)
function hurtPlayer(pid, dmg, quiet) {   // quiet = true 면 화면이 붉게 번쩍이지 않음 (모기·출혈처럼 자잘한 피해)
  const p = players.get(pid);
  if (!p || p.dead || p.hp <= 0) return;
  p.hp = Math.max(0, p.hp - dmg);
  io.to(pid).emit('hp', { hp: p.hp, max: p.hpMax, q: quiet ? 1 : 0 });
  if (p.hp > 0) return;
  p.dead = true;
  clearStatus(p);   // 죽으면 출혈·모기 물기도 끝   // 누워 있는 동안 체력 0 → 몬스터가 노리지 않고, 이동·공격·스킬도 못 해요
  if (sim) sim.dropTarget(pid);
  if (rabSim) rabSim.dropTarget(pid);
  if (sliSim) sliSim.dropTarget(pid);
  if (bossSim) bossSim.dropTarget(pid);
  if (golSim) golSim.dropTarget(pid);
  io.to(pid).emit('dead');
  setTimeout(() => respawnPlayer(p), PLAYER_DEATH_MS);
}
function respawnPlayer(p) {
  if (players.get(p.id) !== p || !p.dead) return;   // 그 사이 접속이 끊겼으면 아무것도 안 함
  p.dead = false;
  p.hp = p.hpMax;
  const underground = p.y < UNDER_Y;   // 동굴 안에서 쓰러졌으면 땅 위 시작 마을로 올려 보냄
  Object.assign(p, { x: 0, z: 0, t: Date.now() });
  if (underground) p.y = 10;
  if (underground) io.to(p.id).emit('surface', { x: 0, y: 10, z: 0 });
  else io.to(p.id).emit('correct', { x: 0, y: p.y, z: 0 });
  io.to(p.id).emit('hp', { hp: p.hp, max: p.hpMax });
  io.to(p.id).emit('alive');
}

// ---------- 정글 모기 ----------
// 정글(지형 'forest') 안에 있으면 MOSQ.BITE_EVERY 초마다 모기가 팔에 앉아 피를 빨아요 → 내려앉는 순간 체력 -1, 5% 확률로 출혈(5초, 1초마다 -1).
// 모기떼 모습은 브라우저(mosquito-fx.js)가 그려요. 숫자는 public/js/mosquito.mjs 에서 바꿔요. 로드에 실패해도 게임은 그대로 돌아가요.
let jungleT = null, MOSQ = null;
(async () => {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'public/js/terrain.js'), 'utf8');
    const terr = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
    const m = await import(pathToFileURL(path.join(__dirname, 'public/js/mosquito.mjs')).href);
    jungleT = terr.makeTerrain(SEED);
    MOSQ = m.MOSQ;
    console.log('정글 모기 준비 완료');
  } catch (e) {
    console.error('정글 모기 로드 실패 (모기 없이 계속 진행):', e);
  }
})();
function clearStatus(p) {   // 상태이상 전부 끝 (죽었을 때)
  if (p.bleedTicksLeft) { p.bleedTicksLeft = 0; io.to(p.id).emit('status', { id: 'bleed', ms: 0 }); }
  p.biteAt = 0; p.mosqT = 0;
}
function applyBleed(p) {   // 출혈: 이미 걸려 있으면 시간만 새로 시작
  if (!MOSQ || p.dead) return;
  p.bleedTicksLeft = Math.max(1, Math.round(MOSQ.BLEED_TIME / MOSQ.BLEED_TICK));
  p.bleedAcc = 0;
  io.to(p.id).emit('status', { id: 'bleed', ms: MOSQ.BLEED_TIME * 1000 });
}
function startBite(p, now) {   // 모기 한 마리가 팔에 내려앉기 시작. 체력은 내려앉는 순간(LAND_TIME 뒤)에 깎여요
  p.biteAt = now + MOSQ.LAND_TIME * 1000;
  io.to(p.id).emit('mosq', { land: MOSQ.LAND_TIME, perch: MOSQ.PERCH_TIME });
}
function mosquitoTick(dt, now) {
  if (!MOSQ || !jungleT) return;
  for (const p of players.values()) {
    if (!p.spawned || p.dead) continue;
    // 출혈 (정글 밖에서도 계속)
    if (p.bleedTicksLeft > 0) {
      p.bleedAcc = (p.bleedAcc || 0) + dt;
      while (p.bleedAcc >= MOSQ.BLEED_TICK && p.bleedTicksLeft > 0 && !p.dead) {
        p.bleedAcc -= MOSQ.BLEED_TICK;
        p.bleedTicksLeft--;
        hurtPlayer(p.id, MOSQ.BLEED_DAMAGE, true);
      }
      if (p.dead) continue;
    }
    // 정글 안인지 (0.5초에 한 번만 계산). 땅 밑(동굴·집 안)은 제외
    if (now - (p.jgAt || 0) > 500) { p.jgAt = now; p.inJg = p.y >= UNDER_Y && jungleT.biome(p.x, p.z) === 'forest'; }
    if (p.inJg) {
      p.mosqT = (p.mosqT || 0) + dt;
      if (p.mosqT >= MOSQ.BITE_EVERY) { p.mosqT = 0; startBite(p, now); }
    } else p.mosqT = 0;
    // 내려앉은 순간: 피 -1, 5% 출혈
    if (p.biteAt && now >= p.biteAt) {
      p.biteAt = 0;
      hurtPlayer(p.id, MOSQ.BITE_DAMAGE, true);
      if (!p.dead && Math.random() < MOSQ.BLEED_CHANCE) applyBleed(p);
    }
  }
}

// 평타 판정: 장착·쿨다운 검사를 통과한 공격만 여기로 와요. 실제 피해는 sim 이 위치·방향·사거리를 서버 기준으로 검사해서 확정
// 몬스터를 때렸을 때(맞는 순간): 치명타가 터진 때만 때린 사람 화면에 알려줘요 (몬스터 머리 위에 "치명타!" 글씨). kind = 몬스터 종류(글씨 높이용)
const hitCb = (kind) => (pid, m, dmg, crit) => {
  if (!crit) return;
  io.to(pid).emit('crit', { k: kind, x: Math.round(m.x * 100) / 100, z: Math.round(m.z * 100) / 100, d: Math.round(dmg * 10) / 10 });
};

function resolveAttack(attacker, now) {
  if (sim) sim.playerAttack(attacker, now);
  if (rabSim) rabSim.playerAttack(attacker, now);
  if (sliSim) sliSim.playerAttack(attacker, now);
  if (bossSim) bossSim.playerAttack(attacker, now);
  if (golSim) golSim.playerAttack(attacker, now);
}

io.on('connection', (socket) => {
  socket.on('join', (d) => {
    if (players.has(socket.id)) return;
    const auth = acc.verify(d && d.token);   // 로그인한 계정만 입장 (닉네임은 계정 닉네임으로 고정)
    if (!auth) { socket.emit('authfail'); socket.disconnect(); return; }
    for (const o of [...players.values()]) if (o.acct === auth.key) kickPlayer(o);
    if (players.size >= MAX_PLAYERS) {
      socket.emit('full');
      socket.disconnect();
      return;
    }
    const nick = auth.name;
    players.set(socket.id, {
      id: socket.id, nick, acct: auth.key,
      x: 0, y: 0, z: 0, ry: 0, t: 0,
      spawned: false, fast: false,
      eq: false, eqT: 0, atkT: 0,
      hp: PLAYER_HP_MAX, hpMax: PLAYER_HP_MAX,
      level: 1,  // 레벨 (아직 성장 시스템이 없어서 1 고정. 나중에 여기 값만 바꾸면 거래 목록에도 반영됨)
      exp: 0, gold: 0   // 경험치·골드 기본값 (저장된 값이 있으면 아래에서 덮어써요)
    });
    const me = players.get(socket.id), sv = acc.getProfile(auth.key);   // 이 계정의 저장된 인벤토리·스킬·장비 복원
    me.inv = sv ? sv.inv.map((i) => ({ ...i })) : [];
    me.learned = sv ? [...sv.learned] : [];
    me.slotR = sv ? sv.slotR : null;
    me.gear = sv && sv.gear ? { armor: sv.gear.armor || null, pants: sv.gear.pants || null, weapon: sv.gear.weapon || null } : { armor: null, pants: null, weapon: null };
    me.craft = sv && sv.craft && craftOf(sv.craft.id) && Number.isFinite(sv.craft.end) ? { id: sv.craft.id, end: sv.craft.end } : null;   // 제작 중이던 무기
    me.craftNotified = false;
    me.quests = cleanQuests(sv && sv.quests);   // 퀘스트 진행 상황 { 퀘스트id: 'active'(진행중) | 'done'(완료) }
    if (sv && Number.isFinite(sv.level)) me.level = sv.level;
    me.stats = cleanStats(sv && sv.stats);        // 예전 계정은 스탯이 없어서 0부터 시작
    me.exp = cleanNum(sv && sv.exp, EXP_MAX);     // 예전 계정은 값이 없어서 0부터 시작
    me.gold = cleanNum(sv && sv.gold, GOLD_MAX);
    settleExp(me);   // 저장된 경험치가 이미 가득이면 레벨로 넘겨요
    applyStats(me);
    me.hpMax = calcHpMax(me); me.hp = me.hpMax;   // 장비·체력 스탯으로 늘어난 최대 체력 포함
    const spawn = sv && sv.pos && Number.isFinite(sv.pos.x) && Number.isFinite(sv.pos.z) ? { x: sv.pos.x, z: sv.pos.z } : undefined;   // 마지막으로 있던 땅 위 위치
    socket.emit('init', { id: socket.id, seed: SEED, spawn, level: me.level, exp: me.exp, expMax: expNeed(me.level), gold: me.gold });
    socket.emit('hp', { hp: me.hp, max: me.hpMax });
    sendInv(me); sendSkills(me); sendGear(me); sendStats(me); sendCraft(me); sendQuests(me);
    if (caveEnt) socket.emit('cave', caveEnt);   // 동굴 입구 위치 (아직 계산 전이면 계산이 끝났을 때 전체에게 보냄)
  });

  // 개발자 도구 (닉네임이 DEV_NICK 인 사람만). 화면 패널이 켜질 때 인사를 보내면 현재 배율을 알려줘요
  socket.on('dev:hello', () => {
    const p = players.get(socket.id);
    if (p && p.nick === DEV_NICK) socket.emit('dev:on', { dmg: p.devDmg || 1, hp: p.hpMult || 1 });
  });
  socket.on('dev:set', (d) => {
    const p = players.get(socket.id);
    if (!p || p.nick !== DEV_NICK || !d || typeof d !== 'object') return;
    const num = (v) => { v = Number(v); return Number.isFinite(v) ? Math.min(DEV_MULT_MAX, Math.max(DEV_MULT_MIN, v)) : 1; };
    p.devDmg = num(d.dmg);   // 개발자 도구 공격력 배율 (스탯 STR 배율과 곱해져서 p.dmgMult 가 돼요)
    p.hpMult = num(d.hp);
    applyStats(p);
    const max = calcHpMax(p);   // 장비·스탯으로 늘어난 최대 체력 포함
    if (max !== p.hpMax) { p.hpMax = max; p.hp = p.dead ? 0 : max; }   // 최대 체력이 바뀌면 가득 채워서 시작
    socket.emit('hp', { hp: p.hp, max: p.hpMax });
    socket.emit('dev:on', { dmg: p.devDmg, hp: p.hpMult });
  });

  // 스탯 포인트 찍기: { k: 'str'|'dex'|'con'|'int'|'luk'|'agi', n: +올릴 포인트 / -되돌릴 포인트 }. 남은 포인트·현재 찍은 값 안에서만 서버가 허락해요
  socket.on('stat', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.stats || !d || typeof d !== 'object' || !STAT_KEYS.includes(d.k)) return;
    let n = Math.trunc(Number(d.n));
    if (!Number.isFinite(n) || n === 0) return;
    n = n > 0 ? Math.min(n, statPts(p)) : -Math.min(-n, p.stats[d.k]);
    if (n === 0) return;
    p.stats[d.k] += n;
    refreshStats(p);
  });
  socket.on('stat:reset', () => {
    const p = players.get(socket.id);
    if (!p || !p.stats || statSum(p) === 0) return;
    p.stats = zeroStats();
    refreshStats(p);
  });

  // 화면이 준비되면 인벤토리·스킬 정보를 한 번 더 요청 (접속 직후에 보낸 것을 놓쳤을 때 대비)
  socket.on('sync', () => {
    const p = players.get(socket.id);
    if (p && p.inv) { sendInv(p); sendSkills(p); sendGear(p); sendStats(p); sendCraft(p); sendQuests(p); }
  });
  // 장비 장착: 인벤토리의 갑옷/신발을 해당 칸에 입음 (이미 입은 게 있으면 서로 바뀜)
  socket.on('wear', (d) => {
    const p = players.get(socket.id);
    if (!p || !ITEMS_MOD || !d || typeof d.id !== 'string') return;
    const def = ITEMS_MOD.ITEMS[d.id], st = p.inv.find((i) => i.id === d.id);
    if (!def || def.kind !== 'gear' || !st) return;
    p.inv.splice(p.inv.indexOf(st), 1);
    const old = p.gear[def.slot];
    if (old) p.inv.push({ id: old, n: 1 });
    p.gear[def.slot] = d.id;
    applyGear(p);
  });
  // 장비 해제: 입고 있던 것을 인벤토리로 되돌림
  socket.on('unwear', (d) => {
    const p = players.get(socket.id);
    if (!p || !ITEMS_MOD || !d || typeof d.slot !== 'string') return;
    const id = p.gear[d.slot];
    if (!id) return;
    if (p.inv.length >= ITEMS_MOD.INV_CAP) { sendToast(p, '인벤토리가 가득 차서 벗을 수 없어요'); return; }
    p.inv.push({ id, n: 1 });
    p.gear[d.slot] = null;
    applyGear(p);
  });
  // 퀘스트 받기: 아직 안 받은 퀘스트만
  socket.on('quest:accept', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.quests || !ITEMS_MOD || !d || typeof d.id !== 'string') return;
    const q = ITEMS_MOD.QUEST_DEFS[d.id];
    if (!q) return;
    if (p.quests[q.id]) { questResult(p, q.id, 'accept', false, '이미 받은 퀘스트예요'); sendQuests(p); return; }
    p.quests[q.id] = 'active';
    saveProfile(p); sendQuests(p);
    sendToast(p, '퀘스트를 수락했습니다');
    questResult(p, q.id, 'accept', true);
  });
  // 퀘스트 완료: 목표 아이템을 내고(빠짐) 보상(경험치·아이템)을 받아요. 보상 아이템을 넣을 칸이 없으면 아무것도 바뀌지 않아요
  socket.on('quest:complete', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.quests || !p.inv || !ITEMS_MOD || !d || typeof d.id !== 'string') return;
    const q = ITEMS_MOD.QUEST_DEFS[d.id];
    if (!q) return;
    if (p.quests[q.id] !== 'active') { questResult(p, q.id, 'complete', false, '진행 중인 퀘스트가 아니에요'); sendQuests(p); return; }
    const st = p.inv.find((i) => i.id === q.goal.item);
    if (!st || st.n < q.goal.n) { questResult(p, q.id, 'complete', false, '아직 재료가 부족해요'); sendInv(p); return; }
    const backup = p.inv.map((i) => ({ ...i }));
    st.n -= q.goal.n;
    if (st.n <= 0) p.inv.splice(p.inv.indexOf(st), 1);
    for (const r of q.reward.items || []) {
      if (!addItem(p, r.id, r.n)) { p.inv = backup; sendInv(p); questResult(p, q.id, 'complete', false, '인벤토리가 가득 차서 보상을 받을 수 없어요'); sendToast(p, '인벤토리가 가득 차서 보상을 받을 수 없어요'); return; }
    }
    p.quests[q.id] = 'done';
    if (q.reward.exp) addExp(p, q.reward.exp);
    saveProfile(p); sendInv(p); sendQuests(p);
    if (q.reward.items && q.reward.items.length) io.to(p.id).emit('loot', { items: q.reward.items.map((r) => ({ id: r.id, n: r.n })) });
    sendToast(p, '퀘스트를 완료했습니다! 경험치 +' + (q.reward.exp || 0));
    questResult(p, q.id, 'complete', true);
  });
  // 무기 제작 시작: 재료가 다 있고 제작 중인 게 없을 때만. 재료는 바로 빠지고 시간이 지나면 수령할 수 있어요
  socket.on('craft:start', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.inv || !d || typeof d.id !== 'string') return;
    const r = craftOf(d.id);
    if (!r) return;
    if (p.craft) { sendToast(p, '이미 제작 중인 무기가 있어요'); sendCraft(p); return; }
    if (!r.mats.every((m) => { const st = p.inv.find((i) => i.id === m.id); return st && st.n >= m.n; })) { sendToast(p, '재료가 부족해요'); sendInv(p); return; }
    for (const m of r.mats) { const st = p.inv.find((i) => i.id === m.id); st.n -= m.n; if (st.n <= 0) p.inv.splice(p.inv.indexOf(st), 1); }
    p.craft = { id: r.id, end: Date.now() + r.time * 1000 };
    p.craftNotified = false;
    saveProfile(p); sendInv(p); sendCraft(p);
  });
  // 완성된 무기 수령: 인벤토리(장비 보관)로 들어와요. 칸이 없으면 못 받고 제작은 그대로 남아 있어요
  socket.on('craft:claim', () => {
    const p = players.get(socket.id);
    if (!p || !p.inv || !p.craft) return;
    const r = craftOf(p.craft.id);
    if (!r) { p.craft = null; saveProfile(p); sendCraft(p); return; }   // 없어진 제작 항목이면 정리
    if (Date.now() < p.craft.end - 300) { sendCraft(p); return; }       // 아직 안 끝났어요
    if (!addItem(p, r.result, 1)) { sendToast(p, '인벤토리가 가득 차서 받을 수 없어요'); return; }
    p.craft = null;
    saveProfile(p); sendInv(p); sendCraft(p);
    io.to(p.id).emit('loot', { items: [{ id: r.result, n: 1 }] });   // '돌 검x1을 획득했습니다.'
  });
  // 스킬북 배우기: 인벤토리의 책을 하나 쓰고 그 스킬을 익힘 (이미 배운 스킬이면 책을 쓰지 않음)
  socket.on('learn', (d) => {
    const p = players.get(socket.id);
    if (!p || !ITEMS_MOD || !d || typeof d.id !== 'string') return;
    const def = ITEMS_MOD.ITEMS[d.id], st = p.inv.find((i) => i.id === d.id);
    if (!def || def.kind !== 'skillbook' || !st) return;
    if (p.learned.includes(def.skill)) { sendToast(p, '이미 배운 스킬이에요'); return; }
    st.n -= 1;
    if (st.n <= 0) p.inv.splice(p.inv.indexOf(st), 1);
    p.learned.push(def.skill);
    saveProfile(p); sendInv(p); sendSkills(p);
    sendToast(p, '\'' + ITEMS_MOD.SKILL_INFO[def.skill].name + '\' 스킬을 배웠습니다!');
  });
  // 장착: R 칸(E 칸 아래)에 배운 스킬을 올리거나(skill = 스킬 id) 내림(skill = null)
  socket.on('equip', (d) => {
    const p = players.get(socket.id);
    if (!p || !ITEMS_MOD || !d) return;
    if (d.skill === null) p.slotR = null;
    else {
      const info = typeof d.skill === 'string' ? ITEMS_MOD.SKILL_INFO[d.skill] : null;
      if (!info || info.slot !== 'R' || !p.learned.includes(d.skill)) return;
      p.slotR = d.skill;
    }
    saveProfile(p); sendSkills(p);
  });
  // 개발자 도구: 스킬북을 바로 받음 (1% 드랍을 기다리지 않고 시험하려고)
  // 개발자 전용 경험치·레벨 조절 (시험용): { exp: 값으로 설정, add: 더하기(음수 가능), level: 레벨 설정 }
  socket.on('dev:exp', (d) => {
    const p = players.get(socket.id);
    if (!p || p.nick !== DEV_NICK || !d || typeof d !== 'object') return;
    if (Number.isFinite(d.level)) p.level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(d.level)));
    if (Number.isFinite(d.exp)) p.exp = cleanNum(d.exp, EXP_MAX);
    if (Number.isFinite(d.add)) p.exp = cleanNum(p.exp + d.add, EXP_MAX);
    settleExp(p); refreshStats(p); sendExp(p); saveProfile(p);   // 가득 차면 레벨업 (레벨이 내려가 포인트가 모자라면 스탯은 초기화)
  });
  socket.on('dev:book', () => {
    const p = players.get(socket.id);
    if (!p || p.nick !== DEV_NICK) return;
    if (addItem(p, 'book_slam')) { sendInv(p); sendToast(p, '스킬북: 내려찍기를 받았어요 (개발자 도구)'); }
    else sendToast(p, '인벤토리가 가득 찼어요');
  });

  // 개발자 도구: 아이템을 바로 받음 (드랍 확률을 기다리지 않고 장비·재료를 시험하려고)
  socket.on('dev:give', (d) => {
    const p = players.get(socket.id);
    if (!p || p.nick !== DEV_NICK || !ITEMS_MOD || !d || typeof d.id !== 'string' || !ITEMS_MOD.ITEMS[d.id]) return;
    if (addItem(p, d.id, 1)) { sendInv(p); io.to(p.id).emit('loot', { items: [{ id: d.id, n: 1 }] }); }
    else sendToast(p, '인벤토리가 가득 찼어요');
  });

  // 개발자 도구: 모기 물림 / 출혈을 바로 시험 (5초·5% 를 기다리지 않고)
  socket.on('dev:mosq', () => {
    const p = players.get(socket.id);
    if (!p || p.nick !== DEV_NICK || !MOSQ || p.dead) return;
    startBite(p, Date.now());
  });
  socket.on('dev:bleed', () => {
    const p = players.get(socket.id);
    if (!p || p.nick !== DEV_NICK) return;
    applyBleed(p);
  });

  socket.on('move', (m) => {
    const p = players.get(socket.id);
    if (!p || p.dead || !m || ![m.x, m.y, m.z, m.ry].every(Number.isFinite)) return;   // 쓰러져 있으면 이동 무시
    const now = Date.now();
    if (p.spawned) {
      const dt = Math.max((now - p.t) / 1000, 0.016);
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      // 서버 검증: 너무 빠르면 되돌림 (속도 배율 켜면 한도도 함께 증가)
      if (d > MAX_SPEED * (1 + (p.moveSpd || 0)) * (p.fast ? FAST_MULT : 1) * dt + 1 + (now < (p.dashUntil || 0) ? 6 : 0)) {   // 대쉬 직후 잠깐은 한도를 넉넉히
        socket.emit('correct', { x: p.x, y: p.y, z: p.z });
        return;
      }
    }
    Object.assign(p, { x: m.x, y: m.y, z: m.z, ry: m.ry, t: now, spawned: true });
  });

  // 집 안 공간(땅 밑 방)으로 들어가거나 나올 때 위치를 한 번에 옮김. 속도 검증에 걸려 되돌려지지 않게 서버 위치도 같이 갱신
  socket.on('tp', (d) => {
    const p = players.get(socket.id);
    if (!p || p.dead || !d || ![d.x, d.y, d.z].every(Number.isFinite)) return;
    if (Math.abs(d.x) > 5000 || Math.abs(d.z) > 5000 || d.y < -5000 || d.y > 800) return;
    Object.assign(p, { x: d.x, y: d.y, z: d.z, t: Date.now() });
  });

  socket.on('doors?', () => {
    if (players.has(socket.id)) socket.emit('doors', [...openDoors]);
  });

  socket.on('door', (d) => {
    if (!players.has(socket.id) || !d || !Number.isInteger(d.i) || d.i < 0 || d.i >= MAX_DOORS) return;
    if (d.open) openDoors.add(d.i); else openDoors.delete(d.i);
    socket.broadcast.emit('door', { i: d.i, open: !!d.open });
  });

  // 나무검 장착/해제 (상태는 서버가 기억해서 나중에 들어온 사람도 같은 모습을 보게 함)
  socket.on('weapon', (d) => {
    const p = players.get(socket.id);
    if (!p || p.dead || !d) return;
    const now = Date.now();
    if (now - p.eqT < EQUIP_MIN_MS) return;
    p.eqT = now;
    p.eq = !!d.eq;
    if (!p.eq) p.atkT = 0;
  });

  // 평타 시작 알림: 장착 중이고 쿨다운이 지났을 때만 다른 사람에게 전달 (피해는 resolveAttack 에서 서버가 결정)
  socket.on('atk', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.eq || p.dead) return;
    const now = Date.now();
    if (now - p.atkT < ATTACK_MIN_MS / (1 + (p.atkSpd || 0))) return;   // AGI 공격 속도만큼 간격이 짧아져요
    p.atkT = now;
    socket.broadcast.emit('atk', { id: socket.id, s: d && d.s === 1 ? 1 : 0 });
    resolveAttack(p, now);
  });

  // 스킬 사용. E = 휩쓸기(기본), R = 장착한 스킬(내려찍기). 검을 든 상태에서만, 쿨타임은 서버가 다시 검사. 피해는 서버가 범위 안의 몬스터 전부에게 확정
  socket.on('skill', (d) => {
    const p = players.get(socket.id);
    if (!p || p.dead || !p.eq || !SKILLS || !d || (d.id !== 'sweep' && d.id !== 'slam')) return;
    if (!sim && !rabSim && !sliSim && !bossSim && !golSim) return;
    const now = Date.now();
    p.skillCd = p.skillCd || {};
    if (d.id === 'sweep') {
      if (now < (p.skillCd.sweep || 0) - 300) return;   // 쿨타임 중 (네트워크 지연 0.3초는 봐줌)
      p.skillCd.sweep = now + SKILLS.sweep.COOLDOWN * 1000;
      socket.broadcast.emit('skillfx', { id: socket.id, skill: 'sweep' });
      if (sim) sim.playerSkill(p, 'sweep', now);
      if (rabSim) rabSim.playerSkill(p, 'sweep', now);
      if (sliSim) sliSim.playerSkill(p, 'sweep', now);
      if (bossSim) bossSim.playerSkill(p, 'sweep', now);
      if (golSim) golSim.playerSkill(p, 'sweep', now);
      return;
    }
    // 내려찍기: 배우고 R 칸에 장착해야 씀. 내 둘레 정사각형 범위(쓴 순간 위치·방향으로 고정)에 DELAY 뒤 피해
    if (!ITEMS_MOD || p.slotR !== 'slam' || !p.learned.includes('slam')) return;
    const SL = ITEMS_MOD.SLAM;
    if (now < (p.skillCd.slam || 0) - 300) return;
    p.skillCd.slam = now + SL.COOLDOWN * 1000;
    socket.broadcast.emit('skillfx', { id: socket.id, skill: 'slam', x: p.x, z: p.z, ry: p.ry });
    const sq = { cx: p.x, cz: p.z, ry: p.ry, half: SL.SIZE / 2, dmg: SL.DAMAGE, delay: SL.DELAY };
    if (sim) sim.playerSquare(p, now, sq);
    if (rabSim) rabSim.playerSquare(p, now, sq);
    if (sliSim) sliSim.playerSquare(p, now, sq);
    if (bossSim) bossSim.playerSquare(p, now, sq);
    if (golSim) golSim.playerSquare(p, now, sq);
  });

  // 대쉬 (Q): 이동 자체는 클라이언트가 하고(5m), 서버는 쿨타임(1초)만 확인해서 다른 플레이어에게 이펙트를 알려줌
  socket.on('dash', (d) => {
    const p = players.get(socket.id);
    if (!p || p.dead || !d || !Number.isFinite(d.dx) || !Number.isFinite(d.dz)) return;
    const now = Date.now();
    if (now - (p.dashT || 0) < 800) return;   // 쿨타임 1초 (네트워크 지연 오차 허용)
    p.dashT = now;
    p.dashUntil = now + 500;
    const len = Math.hypot(d.dx, d.dz) || 1;
    socket.broadcast.emit('dashfx', { id: socket.id, dx: d.dx / len, dz: d.dz / len });
  });

  socket.on('fast', (v) => {
    const p = players.get(socket.id);
    if (p) p.fast = !!v;
  });

  socket.on('disconnect', () => { const p = players.get(socket.id); if (p && p.inv) saveProfile(p); players.delete(socket.id); });
});

// 20Hz 고블린·토끼 시뮬레이션 + 주변 몬스터 목록 전송
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  regenPlayers(dt);
  mosquitoTick(dt, now);
  craftTick(now);   // 무기 제작이 끝난 사람에게 알림
  if (sim) {
    try {
      sim.update(dt, now, players, {
        hurt: hurtPlayer,
        hit: hitCb('goblin'),
        kill: (pid) => { io.to(pid).emit('kill', { msg: '고블린을 처치했습니다!' }); giveLoot(pid, 'goblin'); giveExp(pid, 'goblin'); }
      });
      for (const p of players.values()) {
        if (p.spawned && p.y >= UNDER_Y) io.to(p.id).emit('gob', sim.snapshot(p.x, p.z));
      }
    } catch (e) {
      console.error('고블린 업데이트 오류:', e);
    }
  }
  if (rabSim) {
    try {
      rabSim.update(dt, now, players, {
        hurt: hurtPlayer,
        hit: hitCb('rabbit'),
        kill: (pid) => { io.to(pid).emit('kill', { msg: '토끼를 처치했습니다!' }); giveLoot(pid, 'rabbit'); giveExp(pid, 'rabbit'); }
      });
      for (const p of players.values()) {
        if (p.spawned && p.y >= UNDER_Y) io.to(p.id).emit('rab', rabSim.snapshot(p.x, p.z));
      }
    } catch (e) {
      console.error('토끼 업데이트 오류:', e);
    }
  }
  if (sliSim) {
    try {
      sliSim.update(dt, now, players, {
        hurt: hurtPlayer,
        hit: hitCb('slime'),
        kill: (pid) => { io.to(pid).emit('kill', { msg: '슬라임을 처치했습니다!' }); giveLoot(pid, 'slime'); giveExp(pid, 'slime'); }
      });
      for (const p of players.values()) {
        if (p.spawned && p.y >= UNDER_Y) io.to(p.id).emit('sli', sliSim.snapshot(p.x, p.z));
      }
    } catch (e) {
      console.error('슬라임 업데이트 오류:', e);
    }
  }
  if (bossSim) {
    try {
      bossSim.update(dt, now, players, {
        hurt: hurtPlayer,
        hit: hitCb('boss'),
        kill: (pid, b, hitters, dmgMap) => {
          // 보스 체력의 7% 이상 깎은 사람만 보상(마정석·경험치·스킬북)을 받아요. 스킬북 확률(items.mjs BOSS_BOOK_CHANCE)은 사람마다 따로 굴려요
          const need = bossSim.hpMax * BOSS_REWARD_FRAC;
          for (const hid of (hitters && hitters.length ? hitters : [pid])) {
            const hp = players.get(hid);
            if (!hp) continue;
            io.to(hid).emit('kill', { msg: '오크 대전사를 처치했습니다!' });
            if (dmgMap && (dmgMap.get(hid) || 0) < need - 1e-9) continue;   // 7% 미만이면 보상 없음
            if (!canReward(hp.level, 'boss')) continue;                       // 두 단계 이상 강한 보스면 전리품(스킬북 포함)·경험치 모두 없음
            giveLoot(hid, 'boss');   // 하급 마정석 10~15개 (피해를 준 사람마다)
            giveExp(hid, 'boss');    // 경험치도 피해를 준 사람마다
            if (ITEMS_MOD && Math.random() < (Number(process.env.BOSS_BOOK_CHANCE) || ITEMS_MOD.BOSS_BOOK_CHANCE) * (hp.dropMul || 1)) {   // 환경변수 BOSS_BOOK_CHANCE 로 확률을 바꿔 시험할 수 있어요 (예: 1 = 100%)
              if (addItem(hp, 'book_slam')) { sendInv(hp); io.to(hid).emit('loot', { items: [{ id: 'book_slam', n: 1 }] }); }
              else sendToast(hp, '인벤토리가 가득 차서 스킬북을 얻지 못했어요');
            }
          }
        }
      });
      // 보스 체력바 오른쪽 아래에 띄울 '누가 보스 체력을 몇 % 깎았나' (많이 깎은 순 최대 8명). 바뀔 때만 보내요
      const dmgRows = [...bossSim.boss.hitters.entries()]
        .map(([hid, d]) => { const q = players.get(hid); return q ? [q.nick, Math.round(d / bossSim.hpMax * 1000) / 10] : null; })
        .filter(Boolean).sort((a, b) => b[1] - a[1]).slice(0, 8);
      const dmgSig = JSON.stringify(dmgRows);
      for (const p of players.values()) {
        if (!p.spawned || p.y < UNDER_Y) continue;
        const snap = bossSim.snapshot(p.x, p.z);
        if (snap.length || p.bossOn) io.to(p.id).emit('boss', snap);   // 멀어지면 빈 목록을 한 번만 보내서 화면에서 지움
        if ((snap.length || p.bossOn) && p.bossDmgSig !== dmgSig) { p.bossDmgSig = dmgSig; io.to(p.id).emit('bossdmg', dmgRows); }
        p.bossOn = snap.length > 0;
      }
    } catch (e) {
      console.error('보스 업데이트 오류:', e);
    }
  }
  if (golSim) {
    try {
      golSim.update(dt, now, players, {
        hurt: hurtPlayer,
        hit: hitCb('golem'),
        kill: (pid) => { io.to(pid).emit('kill', { msg: '골렘을 처치했습니다!' }); giveLoot(pid, 'golem'); giveExp(pid, 'golem'); }
      });
      for (const p of players.values()) {
        if (p.spawned && p.y < UNDER_Y) io.to(p.id).emit('gol', golSim.snapshot(p.x, p.z));   // 동굴 안에 있는 사람에게만
      }
    } catch (e) {
      console.error('골렘 업데이트 오류:', e);
    }
  }
}, 50);

// 15Hz 상태 전송 (나중에 주변 플레이어만 보내도록 변경 예정)
setInterval(() => {
  const list = [];
  for (const p of players.values()) {
    // 마지막 값 = 입은 옷 (1 = 갑옷, 2 = 바지, 3 = 둘 다) → 다른 플레이어 화면에도 입은 모습이 보임
    if (p.spawned) list.push([p.id, p.nick, p.x, p.y, p.z, p.ry, p.eq ? 1 : 0, p.level, (p.gear && p.gear.armor ? 1 : 0) | (p.gear && p.gear.pants ? 2 : 0) | (p.gear && p.gear.weapon ? (p.gear.weapon === 'stone_sword' ? 8 : 4) : 0), p.dead ? 1 : 0]);   // 마지막 값 = 쓰러져 있는지 (다른 플레이어 화면에도 쓰러진 모습이 보임)
  }
  io.emit('state', list);
}, 1000 / 15);

// 진행 상황 자동 저장 (30초마다) + 서버가 꺼질 때(업데이트 배포 포함) 마지막으로 한 번 더 저장
setInterval(() => { for (const p of players.values()) saveProfile(p); }, 30000);
function shutdown() {
  for (const p of players.values()) saveProfile(p);
  acc.flushNow();
  const t = setTimeout(() => process.exit(0), 10000);   // GitHub 백업이 오래 걸려도 10초 안에는 끝내요
  acc.backupNow().catch(() => {}).finally(() => { clearTimeout(t); process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const PORT = process.env.PORT || 3000;
acc.ready.then(() => server.listen(PORT, () => console.log('listening on ' + PORT)));   // GitHub 복구가 끝난 뒤 서버를 열어요
