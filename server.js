const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
// .mjs 파일(goblin.mjs)을 자바스크립트로 인식시키기. 안 하면 브라우저가 모듈 로드를 거부해요.
try { if (express.static.mime) express.static.mime.define({ 'application/javascript': ['mjs'] }); } catch (e) { /* 무시 */ }
app.use(express.static('public'));

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
// 접속이 끊겨도 같은 닉네임으로 다시 들어오면 인벤토리·스킬을 되돌려줘요. (서버를 다시 켜면 사라져요. 닉네임만 보고 되돌려주는 방식이라 계정 시스템이 생기면 그쪽으로 옮겨야 해요)
const savedByNick = new Map();
const saveProfile = (p) => {
  savedByNick.set(p.nick, { inv: p.inv.map((i) => ({ ...i })), learned: [...p.learned], slotR: p.slotR });
  if (savedByNick.size > 500) savedByNick.delete(savedByNick.keys().next().value);
};
const sendInv = (p) => io.to(p.id).emit('inv', { items: p.inv });
const sendSkills = (p) => io.to(p.id).emit('skills', { learned: p.learned, slotR: p.slotR });
const sendToast = (p, msg) => io.to(p.id).emit('toast', { msg });
function addItem(p, id, n = 1) {   // 성공하면 true, 칸이 없으면 false
  if (!ITEMS_MOD || !ITEMS_MOD.ITEMS[id]) return false;
  const st = p.inv.find((i) => i.id === id);
  if (st) st.n += n;
  else if (p.inv.length < ITEMS_MOD.INV_CAP) p.inv.push({ id, n });
  else return false;
  saveProfile(p);
  return true;
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
    if (!p.spawned || p.hp >= p.hpMax) { p.regenT = 0; continue; }
    p.regenT = (p.regenT || 0) + dt;
    if (p.regenT < HP_REGEN_SEC) continue;
    p.regenT -= HP_REGEN_SEC;
    p.hp = Math.min(p.hpMax, p.hp + HP_REGEN_AMOUNT);
    io.to(p.id).emit('hp', { hp: p.hp, max: p.hpMax });
  }
}

// 플레이어가 고블린에게 맞음. 체력이 0이 되면 임시로 시작 마을에서 체력을 가득 채워 다시 시작시켜요 (사망 시스템이 생기면 교체)
function hurtPlayer(pid, dmg) {
  const p = players.get(pid);
  if (!p || p.hp <= 0) return;
  p.hp = Math.max(0, p.hp - dmg);
  if (p.hp <= 0) {
    p.hp = p.hpMax;
    const underground = p.y < UNDER_Y;   // 동굴 안에서 쓰러지면 땅 위 시작 마을로 올려 보냄
    Object.assign(p, { x: 0, z: 0, t: Date.now() });
    if (underground) p.y = 10;
    if (sim) sim.dropTarget(pid);
    if (rabSim) rabSim.dropTarget(pid);
    if (sliSim) sliSim.dropTarget(pid);
    if (bossSim) bossSim.dropTarget(pid);
    if (golSim) golSim.dropTarget(pid);
    if (underground) io.to(pid).emit('surface', { x: 0, y: 10, z: 0 });
    else io.to(pid).emit('correct', { x: 0, y: p.y, z: 0 });
    io.to(pid).emit('notice', '쓰러져서 시작 마을에서 다시 시작해요');
  }
  io.to(pid).emit('hp', { hp: p.hp, max: p.hpMax });
}

// 평타 판정: 장착·쿨다운 검사를 통과한 공격만 여기로 와요. 실제 피해는 sim 이 위치·방향·사거리를 서버 기준으로 검사해서 확정
function resolveAttack(attacker, now) {
  if (sim) sim.playerAttack(attacker, now);
  if (rabSim) rabSim.playerAttack(attacker, now);
  if (sliSim) sliSim.playerAttack(attacker, now);
  if (bossSim) bossSim.playerAttack(attacker, now);
  if (golSim) golSim.playerAttack(attacker, now);
}

io.on('connection', (socket) => {
  socket.on('join', ({ nick } = {}) => {
    if (players.size >= MAX_PLAYERS) {
      socket.emit('full');
      socket.disconnect();
      return;
    }
    nick = String(nick || '').trim().slice(0, 12) || '모험가';
    players.set(socket.id, {
      id: socket.id, nick,
      x: 0, y: 0, z: 0, ry: 0, t: 0,
      spawned: false, fast: false,
      eq: false, eqT: 0, atkT: 0,
      hp: PLAYER_HP_MAX, hpMax: PLAYER_HP_MAX,
      level: 1   // 레벨 (아직 성장 시스템이 없어서 1 고정. 나중에 여기 값만 바꾸면 거래 목록에도 반영됨)
    });
    const me = players.get(socket.id), sv = savedByNick.get(nick);   // 같은 닉네임이 전에 쓰던 인벤토리·스킬 복원
    me.inv = sv ? sv.inv.map((i) => ({ ...i })) : [];
    me.learned = sv ? [...sv.learned] : [];
    me.slotR = sv ? sv.slotR : null;
    socket.emit('init', { id: socket.id, seed: SEED });
    socket.emit('hp', { hp: PLAYER_HP_MAX, max: PLAYER_HP_MAX });
    sendInv(me); sendSkills(me);
    if (caveEnt) socket.emit('cave', caveEnt);   // 동굴 입구 위치 (아직 계산 전이면 계산이 끝났을 때 전체에게 보냄)
  });

  // 개발자 도구 (닉네임이 DEV_NICK 인 사람만). 화면 패널이 켜질 때 인사를 보내면 현재 배율을 알려줘요
  socket.on('dev:hello', () => {
    const p = players.get(socket.id);
    if (p && p.nick === DEV_NICK) socket.emit('dev:on', { dmg: p.dmgMult || 1, hp: p.hpMult || 1 });
  });
  socket.on('dev:set', (d) => {
    const p = players.get(socket.id);
    if (!p || p.nick !== DEV_NICK || !d || typeof d !== 'object') return;
    const num = (v) => { v = Number(v); return Number.isFinite(v) ? Math.min(DEV_MULT_MAX, Math.max(DEV_MULT_MIN, v)) : 1; };
    p.dmgMult = num(d.dmg);
    p.hpMult = num(d.hp);
    const max = Math.max(1, Math.round(PLAYER_HP_MAX * p.hpMult));
    if (max !== p.hpMax) { p.hpMax = max; p.hp = max; }   // 최대 체력이 바뀌면 가득 채워서 시작
    socket.emit('hp', { hp: p.hp, max: p.hpMax });
    socket.emit('dev:on', { dmg: p.dmgMult, hp: p.hpMult });
  });

  // 화면이 준비되면 인벤토리·스킬 정보를 한 번 더 요청 (접속 직후에 보낸 것을 놓쳤을 때 대비)
  socket.on('sync', () => {
    const p = players.get(socket.id);
    if (p && p.inv) { sendInv(p); sendSkills(p); }
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
  socket.on('dev:book', () => {
    const p = players.get(socket.id);
    if (!p || p.nick !== DEV_NICK) return;
    if (addItem(p, 'book_slam')) { sendInv(p); sendToast(p, '스킬북: 내려찍기를 받았어요 (개발자 도구)'); }
    else sendToast(p, '인벤토리가 가득 찼어요');
  });

  socket.on('move', (m) => {
    const p = players.get(socket.id);
    if (!p || !m || ![m.x, m.y, m.z, m.ry].every(Number.isFinite)) return;
    const now = Date.now();
    if (p.spawned) {
      const dt = Math.max((now - p.t) / 1000, 0.016);
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      // 서버 검증: 너무 빠르면 되돌림 (속도 배율 켜면 한도도 함께 증가)
      if (d > MAX_SPEED * (p.fast ? FAST_MULT : 1) * dt + 1 + (now < (p.dashUntil || 0) ? 6 : 0)) {   // 대쉬 직후 잠깐은 한도를 넉넉히
        socket.emit('correct', { x: p.x, y: p.y, z: p.z });
        return;
      }
    }
    Object.assign(p, { x: m.x, y: m.y, z: m.z, ry: m.ry, t: now, spawned: true });
  });

  // 집 안 공간(땅 밑 방)으로 들어가거나 나올 때 위치를 한 번에 옮김. 속도 검증에 걸려 되돌려지지 않게 서버 위치도 같이 갱신
  socket.on('tp', (d) => {
    const p = players.get(socket.id);
    if (!p || !d || ![d.x, d.y, d.z].every(Number.isFinite)) return;
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
    if (!p || !d) return;
    const now = Date.now();
    if (now - p.eqT < EQUIP_MIN_MS) return;
    p.eqT = now;
    p.eq = !!d.eq;
    if (!p.eq) p.atkT = 0;
  });

  // 평타 시작 알림: 장착 중이고 쿨다운이 지났을 때만 다른 사람에게 전달 (피해는 resolveAttack 에서 서버가 결정)
  socket.on('atk', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.eq) return;
    const now = Date.now();
    if (now - p.atkT < ATTACK_MIN_MS) return;
    p.atkT = now;
    socket.broadcast.emit('atk', { id: socket.id, s: d && d.s === 1 ? 1 : 0 });
    resolveAttack(p, now);
  });

  // 스킬 사용. E = 휩쓸기(기본), R = 장착한 스킬(내려찍기). 검을 든 상태에서만, 쿨타임은 서버가 다시 검사. 피해는 서버가 범위 안의 몬스터 전부에게 확정
  socket.on('skill', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.eq || !SKILLS || !d || (d.id !== 'sweep' && d.id !== 'slam')) return;
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
    if (!p || !d || !Number.isFinite(d.dx) || !Number.isFinite(d.dz)) return;
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
  if (sim) {
    try {
      sim.update(dt, now, players, {
        hurt: hurtPlayer,
        kill: (pid) => io.to(pid).emit('kill', { msg: '고블린을 처치했습니다!' })
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
        kill: (pid) => io.to(pid).emit('kill', { msg: '토끼를 처치했습니다!' })
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
        kill: (pid) => io.to(pid).emit('kill', { msg: '슬라임을 처치했습니다!' })
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
        kill: (pid, b, hitters) => {
          // 보스에게 피해를 준 사람마다 따로 스킬북 확률(items.mjs BOSS_BOOK_CHANCE)을 굴려요
          for (const hid of (hitters && hitters.length ? hitters : [pid])) {
            const hp = players.get(hid);
            if (!hp) continue;
            io.to(hid).emit('kill', { msg: '오크 대전사를 처치했습니다!' });
            if (ITEMS_MOD && Math.random() < (Number(process.env.BOSS_BOOK_CHANCE) || ITEMS_MOD.BOSS_BOOK_CHANCE)) {   // 환경변수 BOSS_BOOK_CHANCE 로 확률을 바꿔 시험할 수 있어요 (예: 1 = 100%)
              if (addItem(hp, 'book_slam')) { sendInv(hp); sendToast(hp, '✨ ' + ITEMS_MOD.ITEMS.book_slam.name + ' 획득!'); }
              else sendToast(hp, '인벤토리가 가득 차서 스킬북을 얻지 못했어요');
            }
          }
        }
      });
      for (const p of players.values()) {
        if (!p.spawned || p.y < UNDER_Y) continue;
        const snap = bossSim.snapshot(p.x, p.z);
        if (snap.length || p.bossOn) io.to(p.id).emit('boss', snap);   // 멀어지면 빈 목록을 한 번만 보내서 화면에서 지움
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
        kill: (pid) => io.to(pid).emit('kill', { msg: '골렘을 처치했습니다!' })
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
    if (p.spawned) list.push([p.id, p.nick, p.x, p.y, p.z, p.ry, p.eq ? 1 : 0, p.level]);
  }
  io.emit('state', list);
}, 1000 / 15);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('listening on ' + PORT));
