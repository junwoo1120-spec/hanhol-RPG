const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

const SEED = Number(process.env.WORLD_SEED) || 12345;
const MAX_PLAYERS = 20;
const MAX_SPEED = 30;      // units/sec (달리기 14 + 여유)
const FAST_MULT = 100;     // 클라이언트 FAST_MULT와 같은 값
const players = new Map();
const openDoors = new Set();   // 열려 있는 문 (집 번호). 접속자끼리 같은 상태를 보도록 서버가 기억
const MAX_DOORS = 64;
const ATTACK_MIN_MS = 550;   // 평타 최소 간격 (클라이언트 쿨다운 0.7초보다 조금 느슨하게 → 네트워크 지터 허용)
const EQUIP_MIN_MS = 300;    // 장착/해제 토글 최소 간격

// 평타 판정 자리. 지금은 몬스터/피해 시스템이 없어서 비워 둠.
// 나중에 여기서 공격자 위치·방향·사거리를 서버 기준으로 검사해서 피해를 확정할 것 (클라이언트 애니메이션만 믿지 않음)
function resolveAttack(attacker, now) { /* TODO: 서버 검증 판정 */ }

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
      level: 1   // 레벨 (아직 성장 시스템이 없어서 1 고정. 나중에 여기 값만 바꾸면 거래 목록에도 반영됨)
    });
    socket.emit('init', { id: socket.id, seed: SEED });
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
