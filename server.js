const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

const SEED = Number(process.env.WORLD_SEED) || 12345;
const MAX_PLAYERS = 10;
const MAX_SPEED = 30;      // units/sec (달리기 14 + 여유)
const FAST_MULT = 100;     // 클라이언트 FAST_MULT와 같은 값
const players = new Map();

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
      spawned: false, fast: false
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
    if (p.spawned) list.push([p.id, p.nick, p.x, p.y, p.z, p.ry]);
  }
  io.emit('state', list);
}, 1000 / 15);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('listening on ' + PORT));
