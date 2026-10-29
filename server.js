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
(async () => {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'public/js/terrain.js'), 'utf8');
    const terr = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
    const ai = await import(pathToFileURL(path.join(__dirname, 'public/js/goblin-ai.mjs')).href);
    sim = ai.createGoblinSim({ T: terr.makeTerrain(SEED), seed: SEED, WATER_LEVEL: terr.WATER_LEVEL, VILLAGE: terr.VILLAGE, PLAY_RADIUS: terr.PLAY_RADIUS });
    console.log('고블린 ' + sim.goblins.length + '마리 배치 완료');
  } catch (e) {
    console.error('고블린 시스템 로드 실패 (고블린 없이 계속 진행):', e);
  }
})();

const PLAYER_HP_MAX = 100;
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
    Object.assign(p, { x: 0, z: 0, t: Date.now() });
    if (sim) sim.dropTarget(pid);
    io.to(pid).emit('correct', { x: 0, y: p.y, z: 0 });
    io.to(pid).emit('notice', '쓰러져서 시작 마을에서 다시 시작해요');
  }
  io.to(pid).emit('hp', { hp: p.hp, max: p.hpMax });
}

// 평타 판정: 장착·쿨다운 검사를 통과한 공격만 여기로 와요. 실제 피해는 sim 이 위치·방향·사거리를 서버 기준으로 검사해서 확정
function resolveAttack(attacker, now) { if (sim) sim.playerAttack(attacker, now); }

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
    socket.emit('init', { id: socket.id, seed: SEED });
    socket.emit('hp', { hp: PLAYER_HP_MAX, max: PLAYER_HP_MAX });
  });

  socket.on('move', (m) => {
    const p = players.get(socket.id);
    if (!p || !m || ![m.x, m.y, m.z, m.ry].every(Number.isFinite)) return;
    const now = Date.now();
    if (p.spawned) {
      const dt = Math.max((now - p.t) / 1000, 0.016);
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      // 서버 검증: 너무 빠르면 되돌림 (속도 배율 켜면 한도도 함께 증가)
      if (d > MAX_SPEED * (p.fast ? FAST_MULT : 1) * dt + 1) {
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

  socket.on('fast', (v) => {
    const p = players.get(socket.id);
    if (p) p.fast = !!v;
  });

  socket.on('disconnect', () => players.delete(socket.id));
});

// 20Hz 고블린 시뮬레이션 + 주변 고블린 목록 전송
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  regenPlayers(dt);
  if (!sim) return;
  try {
    sim.update(dt, now, players, {
      hurt: hurtPlayer,
      kill: (pid) => io.to(pid).emit('kill', { name: '고블린' })
    });
    for (const p of players.values()) {
      if (p.spawned) io.to(p.id).emit('gob', sim.snapshot(p.x, p.z));
    }
  } catch (e) {
    console.error('고블린 업데이트 오류:', e);
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
