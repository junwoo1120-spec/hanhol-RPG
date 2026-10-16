
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

// ==============================
// 게임 설정
// ==============================
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 10;
const MAX_SPEED = 20;

// 맵 중심 기준 이동 한계: -4650 ~ 4650
const WORLD_LIMIT = 4650;

// 서버 상태 전송 주기: 초당 15회
const TICK_RATE = 1000 / 15;

// ==============================
// 정적 파일
// ==============================
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ==============================
// 플레이어 데이터
// ==============================
const players = new Map();

// 월드 시드
const SEED = Math.floor(Math.random() * 2147483647);

// 안전한 숫자 검사
function isValidNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// 플레이어 정보 복사
function publicPlayer(player) {
  return {
    id: player.id,
    nick: player.nick,
    x: player.x,
    y: player.y,
    z: player.z,
    ry: player.ry,
    spawned: player.spawned
  };
}

// 현재 접속자 목록
function getPlayerList() {
  return Array.from(players.values()).map(publicPlayer);
}

// ==============================
// 소켓 연결
// ==============================
io.on('connection', (socket) => {
  console.log(`[연결 요청] ${socket.id}`);

  // ------------------------------
  // 입장
  // ------------------------------
  socket.on('join', (data = {}) => {
    // 이미 입장한 플레이어라면 중복 생성 방지
    if (players.has(socket.id)) {
      socket.emit('init', {
        id: socket.id,
        seed: SEED,
        players: getPlayerList()
      });
      return;
    }

    // 최대 인원 검사
    if (players.size >= MAX_PLAYERS) {
      socket.emit('full');
      return;
    }

    // 닉네임 검사
    let nick = '모험가';

    if (typeof data.nick === 'string') {
      const trimmed = data.nick.trim().slice(0, 12);
      if (trimmed.length > 0) {
        nick = trimmed;
      }
    }

    const player = {
      id: socket.id,
      nick,
      x: 0,
      y: 0,
      z: 0,
      ry: 0,
      t: Date.now(),
      spawned: false
    };

    players.set(socket.id, player);

    console.log(
      `[입장] ${nick} (${players.size}/${MAX_PLAYERS})`
    );

    // 입장한 플레이어에게 초기 정보 전송
    socket.emit('init', {
      id: socket.id,
      seed: SEED,
      players: getPlayerList()
    });

    // 다른 플레이어에게 입장 알림
    socket.broadcast.emit('playerJoined', publicPlayer(player));
  });

  // ------------------------------
  // 플레이어 생성 위치 등록
  // ------------------------------
  socket.on('spawn', (data = {}) => {
    const player = players.get(socket.id);
    if (!player) return;

    if (
      !isValidNumber(data.x) ||
      !isValidNumber(data.y) ||
      !isValidNumber(data.z)
    ) {
      return;
    }

    if (
      Math.abs(data.x) > WORLD_LIMIT ||
      Math.abs(data.z) > WORLD_LIMIT
    ) {
      return;
    }

    player.x = data.x;
    player.y = data.y;
    player.z = data.z;
    player.spawned = true;
    player.t = Date.now();
  });

  // ------------------------------
  // 이동
  // ------------------------------
  socket.on('move', (m = {}) => {
    const player = players.get(socket.id);
    if (!player) return;

    // 좌표 유효성 검사
    if (
      !isValidNumber(m.x) ||
      !isValidNumber(m.y) ||
      !isValidNumber(m.z)
    ) {
      return;
    }

    // 맵 경계 검사
    if (
      Math.abs(m.x) > WORLD_LIMIT ||
      Math.abs(m.z) > WORLD_LIMIT
    ) {
      socket.emit('correct', {
        x: player.x,
        y: player.y,
        z: player.z
      });
      return;
    }

    const now = Date.now();
    const elapsed = Math.max(
      0.001,
      Math.min((now - player.t) / 1000, 1)
    );

    // 처음 위치가 등록되기 전에는 속도 검사 생략
    if (player.spawned) {
      const dx = m.x - player.x;
      const dy = m.y - player.y;
      const dz = m.z - player.z;
      const distance = Math.sqrt(
        dx * dx + dy * dy + dz * dz
      );

      // 순간이동이나 비정상적으로 빠른 이동 방지
      if (distance > MAX_SPEED * elapsed + 3) {
        socket.emit('correct', {
          x: player.x,
          y: player.y,
          z: player.z
        });
        return;
      }
    }

    player.x = m.x;
    player.y = m.y;
    player.z = m.z;

    if (isValidNumber(m.ry)) {
      player.ry = m.ry;
    }

    player.t = now;
    player.spawned = true;
  });

  // ------------------------------
  // 연결 종료
  // ------------------------------
  socket.on('disconnect', () => {
    const player = players.get(socket.id);

    if (player) {
      console.log(
        `[퇴장] ${player.nick} (${players.size - 1}/${MAX_PLAYERS})`
      );

      players.delete(socket.id);

      io.emit('playerLeft', {
        id: socket.id
      });
    } else {
      console.log(`[연결 종료] ${socket.id}`);
    }
  });
});

// ==============================
// 주기적 플레이어 상태 전송
// ==============================
setInterval(() => {
  if (players.size === 0) return;

  io.emit('state', getPlayerList());
}, TICK_RATE);

// ==============================
// 서버 시작
// ==============================
server.listen(PORT, '0.0.0.0', () => {
  console.log('================================');
  console.log(' RPG 게임 서버 실행 완료');
  console.log(` 포트: ${PORT}`);
  console.log(` 최대 인원: ${MAX_PLAYERS}명`);
  console.log(` 맵 이동 범위: -${WORLD_LIMIT} ~ ${WORLD_LIMIT}`);
  console.log('================================');
});
