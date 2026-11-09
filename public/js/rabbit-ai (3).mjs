// 토끼 두뇌 (서버가 실행하는 부분): 배치 · 배회 · (맞으면) 추적 · 공격 · 피격 · 복귀
// THREE 를 쓰지 않는 순수 계산 파일이라 서버(Node)와 브라우저가 같은 설정(RABBIT)을 공유해요.
// 고블린(goblin-ai.mjs)과 달리 "선공 없음": 플레이어가 가까이 와도 안 쫓아오고, 먼저 맞았을 때만 때린 사람을 쫓아가 공격해요.
// 거리·속도의 단위는 게임 좌표 단위(플레이어 걷기 속도 = 7 × 1.05 = 7.35 /초)예요.

import { h32, PLAYER_ATK, SKILLS, inSquare } from './goblin-ai.mjs';
import { plainZoneAt } from './plain-zones.mjs';

export const RABBIT = {
  COUNT: 50,               // 월드 전체 토끼 수
  SCALE: 1.5,              // 크기 배율 (모델 기본 크기 × 이 값). 모델은 설계도대로 약 0.4m
  SPAWN_MIN_DIST: 260,     // 시작마을 중심에서 이 거리 이상 (평원이 시작되는 곳 = 초반부). 배치는 토끼 평원(동굴이 있는 북쪽 1/3, plain-zones.mjs) 안에서만
  SPAWN_MAX_DIST: 430,     // 여기까지만 배치 (평원 초반부)
  SPACING_START: 40,       // 토끼끼리 최소 간격의 시작 목표. 50마리가 안 들어가면 간격을 줄여서 맞춰요
  LEASH: 9,                // 평소 배회 범위 (집에서 이 거리 안)
  SEGMENT: 14,             // 배회 한 사이클(서 있기 → 깡충깡충 → 서 있기) 길이(초)

  HP: 10,                  // 토끼 체력
  DAMAGE: 1,               // 토끼 공격력
  ATTACK_RANGE: 0.9,       // 공격 사정거리
  ATTACK_COOLDOWN: 1.0,    // 공격 속도(초)
  CHASE_SPEED: 7 * 1.05 * 1.2,   // 맞은 뒤 쫓아오는 속도 = 플레이어 걷기 속도의 1.2배
  STUN: 0.25,              // 맞았을 때 움찔하는 시간(초) — 이 동안은 움직이지 않음
  GIVEUP_DIST: 60,         // 때린 플레이어가 이만큼 멀어지면 포기하고 돌아감 (체력도 회복)
  RETURN_DIST: 100,        // 집에서 이만큼 멀어지면 순간이동으로 복귀 + 어그로 해제
  DEATH_FALL: 0.7,         // 죽으면 쓰러지는 데 걸리는 시간(초)
  DEATH_LIE: 2.0,          // 쓰러진 채로 누워 있다가 사라지기까지(초)
  RESPAWN_SEC: 60,         // 죽은 토끼가 다시 나타나는 시간(초). 0 이면 다시 안 나와요
  VIEW_DIST: 150,          // 플레이어에게 이 거리 안의 토끼만 전송
};

const TAU = Math.PI * 2;
const TURN = 0.6;
const smooth01 = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// ---------- 배치: 평원 초반부에 일정 간격으로 불규칙하게 ----------
export function makeRabbitSpawns(T, seed, WATER_LEVEL, VILLAGE, PLAY_RADIUS) {
  const sd = (Number(seed) | 0) || 1;
  const { COUNT, SPAWN_MIN_DIST, SPAWN_MAX_DIST, LEASH } = RABBIT;
  const CELL = 22, maxR = Math.min(SPAWN_MAX_DIST, PLAY_RADIUS - 80), n = Math.ceil(maxR / CELL);

  const isPlain = (x, z) => {
    const h = T.height(x, z);
    if (h < WATER_LEVEL + 2.5) return false;
    const d = T.detail(x, z, h);
    return d[0] + d[1] > 0.9 && d[3] < 0.02;   // 풀·흙(평원)이고 마을 터가 아님
  };
  const isHome = (x, z) => isPlain(x, z) && plainZoneAt(x, z, VILLAGE) === 'rabbit';   // 평원이면서 토끼 구역

  const cand = [];
  for (let cz = -n; cz <= n; cz++) {
    for (let cx = -n; cx <= n; cx++) {
      const x = (cx + 0.1 + 0.8 * h32(cx, cz, sd + 141)) * CELL;
      const z = (cz + 0.1 + 0.8 * h32(cx, cz, sd + 151)) * CELL;
      const d = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
      if (d < SPAWN_MIN_DIST || d > maxR) continue;
      if (!isHome(x, z)) continue;
      let ok = true;   // 배회 범위 사방도 토끼 구역 평원이어야 (바다·마을·다른 구역으로 넘어가지 않게)
      for (let a = 0; a < 4 && ok; a++) ok = isHome(x + Math.cos(a * Math.PI / 2) * LEASH, z + Math.sin(a * Math.PI / 2) * LEASH);
      if (ok) cand.push({ x, z, r: h32(cx, cz, sd + 161) });
    }
  }
  cand.sort((a, b) => a.r - b.r);   // 섞기 (시드가 같으면 항상 같은 순서)

  let best = [];
  for (let D = RABBIT.SPACING_START; D >= 8; D -= 4) {
    const picked = [];
    for (const c of cand) {
      if (picked.length >= COUNT) break;
      if (picked.every((p) => Math.hypot(p.x - c.x, p.z - c.z) >= D)) picked.push(c);
    }
    if (picked.length > best.length) best = picked;
    if (picked.length >= COUNT) break;
  }
  return best;
}

// ---------- 평소 배회 (시계로 위치 계산) ----------
// 한 구간 = [가만히 서 있기] → [방향 돌리기] → [깡충깡충 걷기] → [도착해서 서 있기]
function makeWander(T, WATER_LEVEL) {
  function wp(g, k) {
    const memo = g.memo || (g.memo = new Map());
    let p = memo.get(k);
    if (p) return p;
    const a = h32(g.id, k, 1101 + g.seed) * TAU;
    const rr = Math.sqrt(h32(g.id, k, 1202 + g.seed)) * RABBIT.LEASH;
    let x = g.hx + Math.cos(a) * rr, z = g.hz + Math.sin(a) * rr;
    if (T.height(x, z) < WATER_LEVEL + 1.2) { x = g.hx; z = g.hz; }
    p = [x, z];
    memo.set(k, p);
    if (memo.size > 8) memo.delete(memo.keys().next().value);
    return p;
  }
  const segDir = (g, k) => {
    const A = wp(g, k), B = wp(g, k + 1);
    const dx = B[0] - A[0], dz = B[1] - A[1];
    return Math.hypot(dx, dz) < 0.4 ? h32(g.id, k, 1505) * TAU : Math.atan2(dx, dz);
  };
  return function pose(g, tSec, out) {
    const L = RABBIT.SEGMENT;
    const tt = tSec + g.off;
    const k = Math.floor(tt / L), f = tt - k * L;
    const A = wp(g, k), B = wp(g, k + 1);
    const dx = B[0] - A[0], dz = B[1] - A[1], dist = Math.hypot(dx, dz);
    const spd = 1.2 + 1.0 * h32(g.id, k, 1303);   // 깡충깡충 평균 속도 (1.2 ~ 2.2 m/s)
    const walkT = Math.min(Math.max(dist / spd, 0.01), L - TURN - 0.5);
    const idleBefore = (L - TURN - walkT) * h32(g.id, k, 1404);
    const ts = idleBefore + TURN;
    const prev = segDir(g, k - 1), cur = segDir(g, k);
    out.heading = f < idleBefore ? prev : prev + angDiff(prev, cur) * smooth01((f - idleBefore) / TURN);
    if (f <= ts || dist < 0.05) { out.x = A[0]; out.z = A[1]; return out; }
    const u = Math.min(1, (f - ts) / walkT);
    out.x = A[0] + dx * u;   // 일정한 속도로 이동 (토끼는 멈췄다 가지 않고 또박또박 뜀)
    out.z = A[1] + dz * u;
    return out;
  };
}

// ---------- 토끼 시뮬레이션 ----------
// mode: 0 = 배회, 1 = 추적(이동 중), 2 = 공격(사정거리 안)
export function createRabbitSim({ T, seed, WATER_LEVEL, VILLAGE, PLAY_RADIUS }) {
  const sd = (Number(seed) | 0) || 1;
  const pose = makeWander(T, WATER_LEVEL);
  const rabbits = makeRabbitSpawns(T, sd, WATER_LEVEL, VILLAGE, PLAY_RADIUS).map((c, id) => ({
    id, seed: sd, hx: c.x, hz: c.z, off: h32(id, sd, 161) * RABBIT.SEGMENT * 9,
    x: c.x, z: c.z, ry: 0, hp: RABBIT.HP, mode: 0, target: null,
    atkReady: 0, atkN: 0, stunUntil: 0, dead: false, respawnAt: 0, wp: { x: c.x, z: c.z, heading: 0 },
  }));
  const swings = [];   // 플레이어가 휘두른 검 (맞는 순간 대기 중)
  let lastNow = 0;     // 마지막 update 시각 (죽은 토끼를 얼마나 보여줄지 계산)

  // 배회로 돌아가면 위치는 배회 위치로 순간이동. 체력도 가득 채움
  const returnHome = (g) => { g.mode = 0; g.target = null; g.hp = RABBIT.HP; g.stunUntil = 0; };

  function update(dtIn, nowMs, players, cb) {
    const dt = Math.min(dtIn, 0.2);
    lastNow = nowMs;
    const tSec = nowMs / 1000;

    // 1) 플레이어 검이 맞는 순간 처리
    for (let i = swings.length - 1; i >= 0; i--) {
      const s = swings[i];
      if (nowMs < s.at) continue;
      swings.splice(i, 1);
      const pl = players.get(s.pid);
      if (!pl || !pl.spawned || pl.hp <= 0 || pl.y < -100) continue;
      const fx = Math.sin(pl.ry), fz = Math.cos(pl.ry), cosArc = Math.cos((s.arc / 2) * Math.PI / 180);
      for (const g of rabbits) {
        if (g.dead) continue;
        const dx = g.x - pl.x, dz = g.z - pl.z, d = Math.hypot(dx, dz);
        if (s.sq) { if (!inSquare(g.x, g.z, s.sq, 0.5)) continue; }
        else {
          if (d > s.reach) continue;
          if (d > 0.8 && (dx * fx + dz * fz) / d < cosArc) continue;
        }
        g.hp -= s.dmg;
        if (g.hp <= 0) {
          g.dead = true; g.mode = 0; g.target = null; g.deadAt = nowMs;
          g.respawnAt = RABBIT.RESPAWN_SEC > 0 ? nowMs + RABBIT.RESPAWN_SEC * 1000 : Infinity;
          if (cb.kill) cb.kill(s.pid, g);
        } else {
          g.stunUntil = nowMs + RABBIT.STUN * 1000;   // 맞으면 잠깐 움찔
          if (g.mode === 0) {   // 먼저 맞았을 때만 때린 사람을 쫓아옴 (선공 없음)
            g.mode = 1; g.target = s.pid; g.atkReady = Math.max(g.atkReady, nowMs + 450);
          }
        }
      }
    }

    // 2) 토끼 행동
    for (const g of rabbits) {
      if (g.dead) {
        if (nowMs >= g.respawnAt) { g.dead = false; g.hp = RABBIT.HP; g.mode = 0; g.target = null; g.x = g.hx; g.z = g.hz; }
        continue;
      }
      if (g.mode === 0) {   // 배회 — 플레이어가 옆에 와도 신경 쓰지 않음
        const p = pose(g, tSec, g.wp);
        g.x = p.x; g.z = p.z; g.ry = p.heading;
        continue;
      }
      const pl = players.get(g.target);
      if (!pl || !pl.spawned || pl.hp <= 0 || pl.y < -100) { returnHome(g); continue; }
      if (Math.hypot(g.x - g.hx, g.z - g.hz) > RABBIT.RETURN_DIST) { returnHome(g); continue; }   // 너무 멀리 끌려옴 → 복귀
      const dx = pl.x - g.x, dz = pl.z - g.z, d = Math.hypot(dx, dz);
      if (d > RABBIT.GIVEUP_DIST) { returnHome(g); continue; }                                   // 플레이어가 멀리 도망 → 포기
      if (nowMs < g.stunUntil) continue;   // 움찔하는 중에는 가만히 (방향도 그대로)
      if (d > 0.01) g.ry = Math.atan2(dx, dz);
      if (d > RABBIT.ATTACK_RANGE) {
        g.mode = 1;
        const step = Math.min(d - RABBIT.ATTACK_RANGE * 0.8, RABBIT.CHASE_SPEED * dt);
        g.x += (dx / d) * step; g.z += (dz / d) * step;
      } else {
        g.mode = 2;
        if (nowMs >= g.atkReady) {
          g.atkReady = nowMs + RABBIT.ATTACK_COOLDOWN * 1000;
          g.atkN = (g.atkN + 1) & 255;
          if (cb.hurt) cb.hurt(pl.id, RABBIT.DAMAGE, g);
        }
      }
    }

    // 3) 쫓아오는 토끼끼리 겹치지 않게 살짝 밀어내기
    for (let i = 0; i < rabbits.length; i++) {
      const a = rabbits[i];
      if (a.dead || a.mode === 0) continue;
      for (let j = i + 1; j < rabbits.length; j++) {
        const b = rabbits[j];
        if (b.dead || b.mode === 0) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d < 0.6) {
          const push = d > 0.001 ? (0.6 - d) / 2 / d : 0.3;
          const ux = d > 0.001 ? dx : 1, uz = d > 0.001 ? dz : 0;
          a.x -= ux * push; a.z -= uz * push; b.x += ux * push; b.z += uz * push;
        }
      }
    }
  }

  // 플레이어가 평타를 시작했을 때 (실제 타격은 DELAY 뒤에 판정)
  function playerAttack(pl, nowMs) {
    swings.push({ pid: pl.id, at: nowMs + PLAYER_ATK.DELAY * 1000, dmg: PLAYER_ATK.DAMAGE * (pl.dmgMult || 1), reach: PLAYER_ATK.REACH, arc: PLAYER_ATK.ARC_DEG });
  }

  // 플레이어가 스킬을 썼을 때 (범위 안의 토끼 전부에게 피해)

  // 플레이어가 범위 스킬(내려찍기)을 썼을 때: 정사각형 범위 안의 몬스터 전부에게 DELAY 뒤에 피해
  function playerSquare(pl, nowMs, sq) {
    swings.push({ pid: pl.id, at: nowMs + sq.delay * 1000, dmg: sq.dmg * (pl.dmgMult || 1), sq: { cx: sq.cx, cz: sq.cz, ry: sq.ry, half: sq.half } });
  }

  function playerSkill(pl, id, nowMs) {
    const k = SKILLS[id];
    if (!k) return;
    swings.push({ pid: pl.id, at: nowMs + k.DELAY * 1000, dmg: k.DAMAGE * (pl.dmgMult || 1), reach: k.REACH, arc: k.ARC_DEG });
  }

  // 그 플레이어를 쫓던 토끼들의 어그로 해제 (플레이어가 마을로 되살아날 때 등)
  function dropTarget(pid) {
    for (const g of rabbits) if (g.target === pid) returnHome(g);
  }

  // 플레이어 주변 토끼 목록: [id, x, z, 바라보는 방향, mode(3 = 죽어서 쓰러짐), hp, 공격횟수]
  function snapshot(px, pz) {
    const v2 = RABBIT.VIEW_DIST * RABBIT.VIEW_DIST, out = [];
    const linger = (RABBIT.DEATH_FALL + RABBIT.DEATH_LIE) * 1000;
    for (const g of rabbits) {
      // 죽은 토끼는 쓰러졌다가 누워 있는 동안(mode 3)만 계속 보내요. 그 뒤엔 목록에서 빠져서 사라져요
      if (g.dead && lastNow - g.deadAt > linger) continue;
      if ((g.x - px) ** 2 + (g.z - pz) ** 2 > v2) continue;
      out.push([g.id, Math.round(g.x * 100) / 100, Math.round(g.z * 100) / 100, Math.round(g.ry * 100) / 100, g.dead ? 3 : g.mode, g.hp, g.atkN]);
    }
    return out;
  }

  return { rabbits, update, playerAttack, playerSkill, playerSquare, dropTarget, snapshot };
}
