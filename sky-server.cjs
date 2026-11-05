'use strict';
/*
 * sky-server.cjs - 하늘(날씨/시간) 공유용 서버 모듈
 *
 * 하는 일
 *  - 날씨(구름 양, 폭풍, 번개, 바람)와 하루 시간의 "기준점(배속/이동)"을 서버가 한 곳에서 들고 있어요.
 *  - 허락된 닉네임이 바꾸면 접속해 있는 모든 사람에게 바로 보내고, 새로 들어온 사람에게도 현재 값을 알려줘요.
 *  - 누가 바꿀 수 있는지는 서버가 직접 확인해요 (화면의 패널을 억지로 열어도 서버가 거절).
 *      날씨: 닉네임 박준우, 19   /   시간(배속, 이동): 닉네임 박준우
 *
 * 설치 (server.js 에서, socket.io 의 io 를 만든 직후 한 줄):
 *      require('./sky-server.cjs')(io);                // server.js 가 CommonJS 일 때
 *      import skyServer from './sky-server.cjs'; skyServer(io);   // server.js 가 ES 모듈일 때
 *
 * 비밀번호(권장): 닉네임은 누구나 따라 쓸 수 있어서, Render 의 Environment 에 SKY_ADMIN_PASSWORD 를 넣어 두면
 *   관리자 패널을 처음 쓸 때 비밀번호를 한 번 물어봐요. (넣지 않으면 닉네임만 확인해요)
 *
 * 주의: 이 값들은 서버 메모리에만 있어서 서버가 다시 시작되면 기본값(구름 조금, 실시간)으로 돌아가요.
 * 이 파일은 public 폴더 밖(server.js 와 같은 폴더)에 두세요. public 안에 두면 누구나 내려받을 수 있어요.
 */
const DAY = 1200;   // 하루(초)

module.exports = function attachSky(io, options) {
  const cfg = Object.assign({
    weatherAdmins: ['박준우', '19'],
    timeAdmins: ['박준우'],
    password: process.env.SKY_ADMIN_PASSWORD || '',
    epoch: '2026-10-28T12:00:00+09:00',   // sky.js 의 기준 시각과 같아야 해요
    epochTime: 0
  }, options || {});

  const EPOCH = Date.parse(cfg.epoch) / 1000;
  const norm = (s) => String(s == null ? '' : s).normalize('NFC').trim();
  const inList = (list, nick) => !!nick && list.some((n) => norm(n) === nick);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);

  let weather = { cloudCover: 0.35, storm: 0, lightning: 0, windDir: 90, windSpeed: 1 };
  let anchor = { sec: EPOCH, phase: cfg.epochTime, speed: 1 };
  let rev = 0;

  const nowSec = () => Date.now() / 1000;
  const phaseAt = (sec) => (((anchor.phase + (sec - anchor.sec) * anchor.speed) % DAY) + DAY) % DAY;
  const snapshot = () => ({ weather: Object.assign({}, weather), anchor: Object.assign({}, anchor), serverMs: Date.now(), rev });

  function applyWeather(w) {
    const lim = { cloudCover: [0, 1], storm: [0, 1], lightning: [0, 1], windSpeed: [0, 8] };
    for (const k in lim) { const v = num(w[k]); if (v !== null) weather[k] = clamp(v, lim[k][0], lim[k][1]); }
    const d = num(w.windDir); if (d !== null) weather.windDir = ((d % 360) + 360) % 360;
  }
  function applyTime(t) {
    const now = nowSec();
    if (t.mode === 'speed') {
      const v = num(t.speed); if (v === null) return;
      anchor = { sec: now, phase: phaseAt(now), speed: clamp(v, 0, 1000) };   // 지금 시각에서 이어서 배속만 바꿈
    } else if (t.mode === 'jump') {
      const p = num(t.phase); if (p === null) return;
      anchor = { sec: now, phase: ((p % DAY) + DAY) % DAY, speed: anchor.speed };
    } else if (t.mode === 'real') {
      anchor = { sec: EPOCH, phase: cfg.epochTime, speed: 1 };
    }
  }

  io.on('connection', (socket) => {
    socket.skyNick = '';
    let tokens = 20, last = Date.now();   // 요청이 너무 잦으면 무시 (초당 약 20회)
    socket.on('join', (d) => { socket.skyNick = norm(d && d.nick); });
    socket.on('sky:hello', () => socket.emit('sky:state', snapshot()));
    socket.on('sky:ping', (m) => socket.emit('sky:pong', { c: m && m.c, s: Date.now() }));
    socket.on('sky:set', (m) => {
      const t = Date.now(); tokens = Math.min(20, tokens + (t - last) / 50); last = t;
      if (tokens < 1) return; tokens -= 1;
      if (!m || typeof m !== 'object') return;
      const wantW = m.weather && typeof m.weather === 'object', wantT = m.time && typeof m.time === 'object';
      if (!wantW && !wantT) return;
      if ((wantW && !inList(cfg.weatherAdmins, socket.skyNick)) || (wantT && !inList(cfg.timeAdmins, socket.skyNick))) {
        socket.emit('sky:denied', { reason: 'nick' }); return;
      }
      if (cfg.password && m.pw !== cfg.password) { socket.emit('sky:denied', { reason: 'pw' }); return; }
      if (wantW) applyWeather(m.weather);
      if (wantT) applyTime(m.time);
      rev++;
      io.emit('sky:state', snapshot());   // 모든 접속자에게 적용
    });
  });

  return { getState: snapshot };
};
