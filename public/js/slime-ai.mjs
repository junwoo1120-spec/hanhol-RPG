// 슬라임 두뇌 (서버가 실행하는 부분): 배치 · 배회 · 추적 · 공격 · 피격 · 복귀
// THREE 를 쓰지 않는 순수 계산 파일이라 서버(Node)와 브라우저가 같은 설정(SLIME)을 공유해요.
// 슬라임 고원(평원 동쪽~남동쪽 구역, plain-zones.mjs)에서만 살고, 고블린처럼 가까이 가면 먼저 쫓아와요.
// 대신 느려서(플레이어 걷기 속도보다 느림) 달리면 따돌릴 수 있어요.
// 거리·속도의 단위는 게임 좌표 단위(플레이어 걷기 속도 = 7 × 1.05 = 7.35 /초)예요.

import { h32, PLAYER_ATK, SKILLS } from './goblin-ai.mjs';
import { plainZoneAt } from './plain-zones.mjs';

export const SLIME = {
  COUNT: 50,               // 월드 전체 슬라임 수
  SCALE: 1.2,              // 크기 배율 (모델 기본 크기 × 이 값). 모델은 폭 약 0.8m, 높이 약 0.5m
  SPACING_START: 60,       // 슬라임끼리 최소 간격의 시작 목표. 50마리가 안 들어가면 간격을 줄여서 맞춰요
  LEASH: 12,               // 평소 배회 범위 (집에서 이 거리 안)
  SEGMENT: 18,             // 배회 한 사이클(서 있기 → 꿈틀꿈틀 이동 → 서 있기) 길이(초)

  HP: 55,                  // 슬라임 체력
  DAMAGE: 10,              // 슬라임 공격력
  AGGRO_DIST: 16,          // 이 거리 안에 플레이어가 들어오면 쫓아옴
  CHASE_SPEED: 7 * 1.05 * 0.8,   // 추적 속도 = 플레이어 걷기 속도의 0.8배 (달리면 따돌려요)
  ATTACK_RANGE: 1.3,       // 공격 사정거리
  ATTACK_COOLDOWN: 1.4,    // 공격 속도(초)
  RETURN_DIST: 90,         // 집에서 이만큼 멀어지면 순간이동으로 복귀 + 어그로 해제 (체력도 회복)
  DEATH_FALL: 0.7,         // 죽으면 녹아내리는 데 걸리는 시간(초)
  DEATH_LIE: 2.0,          // 녹은 채로 남아 있다가 사라지기까지(초)
  RESPAWN_SEC: 60,         // 죽은 슬라임이 다시 나타나는 시간(초). 0 이면 다시 안 나와요
  VIEW_DIST: 150,          // 플레이어에게 이 거리 안의 슬라임만 전송
};

const TAU = Math.PI * 2;
const TURN = 0.8;
const smooth01 = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// ---------- 배치: 슬라임 고원(평원 동쪽~남동쪽)에 일정 간격으로 불규칙하게 ----------
export function makeSlimeSpawns(T, seed, WATER_LEVEL, VILLAGE, PLAY_RADIUS) {
  const sd = (Number(seed) | 0) || 1;
  const { COUNT, LEASH } = SLIME;
  const CELL = 30, maxR = PLAY_RADIUS - 80, n = Math.ceil(maxR / CELL);

  const isPlain = (x, z) => {
    const h = T.height(x, z);
    if (h < WATER_LEVEL + 2.5) return false;
    const d = T.detail(x, z, h);
    return d[0] + d[1] > 0.9 && d[3] < 0.02;   // 풀·흙(평원)이고 마을 터가 아님
  };
  const isHome = (x, z) => isPlain(x, z) && plainZoneAt(x, z, VILLAGE) === 'slime';   // 평원이면서 슬라임 구역

  const cand = [];
  for (let cz = -n; cz <= n; cz++) {
    for (let cx = -n; cx <= n; cx++) {
      const x = (cx + 0.1 + 0.8 * h32(cx, cz, sd + 241)) * CELL;
      const z = (cz + 0.1 + 0.8 * h32(cx, cz, sd + 251)) * CELL;
      if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) > maxR) continue;
      if (!isHome(x, z)) continue;
      let ok = true;   // 배회 범위 사방도 슬라임 구역 평원이어야 (바다·사막·다른 구역으로 넘어가지 않게)
      for (let a = 0; a < 4 && ok; a++) ok = isHome(x + Math.cos(a * Math.PI / 2) * LEASH, z + Math.sin(a * Math.PI / 2) * LEASH);
      if (ok) cand.push({ x, z, r: h32(cx, cz, sd + 261) });
    }
  }
  cand.sort((a, b) => a.r - b.r);   // 섞기 (시드가 같으면 항상 같은 순서)

  let best = [];
  for (let D = SLIME.SPACING_START; D >= 10; D -= 5) {
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
// 한 구간 = [가만히 서 있기] → [방향 돌리기] → [천천히 꿈틀꿈틀 이동] → [도착해서 서 있기]
function makeWander(T, WATER_LEVEL) {
  function wp(g, k) {
    const memo = g.memo || (g.memo = new Map());
    let p = memo.get(k);
    if (p) return p;
    const a = h32(g.id, k, 2101 + g.seed) * TAU;
    const rr = Math.sqrt(h32(g.id, k, 2202 + g.seed)) * SLIME.LEASH;
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
    return Math.hypot(dx, dz) < 0.4 ? h32(g.id, k, 2505) * TAU : Math.atan2(dx, dz);
  };
  return function pose(g, tSec, out) {
    const L = SLIME.SEGMENT;
    const tt = tSec + g.off;
    const k = Math.floor(tt / L), f = tt - k * L;
    const A = wp(g, k), B = wp(g, k + 1);
    const dx = B[0] - A[0], dz = B[1] - A[1], dist = Math.hypot(dx, dz);
    const spd = 0.5 + 0.5 * h32(g.id, k, 2303);   // 느릿느릿 (0.5 ~ 1.0 m/s)
    const walkT = Math.min(Math.max(dist / spd, 0.01), L - TURN - 0.5);
    const idleBefore = (L - TURN - walkT) * h32(g.id, k, 2404);
    const ts = idleBefore + TURN;
    const prev = segDir(g, k - 1), cur = segDir(g, k);
    out.heading = f < idleBefore ? prev : prev + angDiff(prev, cur) * smooth01((f - idleBefore) / TURN);
    if (f <= ts || dist < 0.05) { out.x = A[0]; out.z = A[1]; return out; }
    const u = Math.min(1, (f - ts) / walkT);
    const e = (1 - Math.cos(Math.PI * u)) / 2;
    out.x = A[0] + dx * e;
    out.z = A[1] + dz * e;
    return out;
  };
}

// ---------- 슬라임 시뮬레이션 ----------
// mode: 0 = 배회, 1 = 추적(이동 중), 2 = 공격(사정거리 안)
export function createSlimeSim({ T, seed, WATER_LEVEL, VILLAGE, PLAY_RADIUS }) {
  const sd = (Number(seed) | 0) || 1;
  const pose = makeWander(T, WATER_LEVEL);
  const slimes = makeSlimeSpawns(T, sd, WATER_LEVEL, VILLAGE, PLAY_RADIUS).map((c, id) => ({
    id, seed: sd, hx: c.x, hz: c.z, off: h32(id, sd, 261) * SLIME.SEGMENT * 9,
    x: c.x, z: c.z, ry: 0, hp: SLIME.HP, mode: 0, target: null,
    atkReady: 0, atkN: 0, dead: false, respawnAt: 0, wp: { x: c.x, z: c.z, heading: 0 },
  }));
  const swings = [];   // 플레이어가 휘두른 검 (맞는 순간 대기 중)
  let lastNow = 0;     // 마지막 update 시각 (죽은 슬라임을 얼마나 보여줄지 계산)

  // 배회로 돌아가면 위치는 배회 위치로 순간이동. 체력도 가득 채움
  const returnHome = (g) => { g.mode = 0; g.target = null; g.hp = SLIME.HP; };

  function update(dtIn, nowMs, players, cb) {
    const dt = Math.min(dtIn, 0.2);
    lastNow = nowMs;
    const tSec = nowMs / 1000;
    const A2 = SLIME.AGGRO_DIST * SLIME.AGGRO_DIST;

    // 1) 플레이어 검이 맞는 순간 처리
    for (let i = swings.length - 1; i >= 0; i--) {
      const s = swings[i];
      if (nowMs < s.at) continue;
      swings.splice(i, 1);
      const pl = players.get(s.pid);
      if (!pl || !pl.spawned || pl.hp <= 0 || pl.y < -100) continue;
      const fx = Math.sin(pl.ry), fz = Math.cos(pl.ry), cosArc = Math.cos((s.arc / 2) * Math.PI / 180);
      for (const g of slimes) {
        if (g.dead) continue;
        const dx = g.x - pl.x, dz = g.z - pl.z, d = Math.hypot(dx, dz);
        if (d > s.reach) continue;
        if (d > 0.8 && (dx * fx + dz * fz) / d < cosArc) continue;
        g.hp -= s.dmg;
        if (g.hp <= 0) {
          g.dead = true; g.mode = 0; g.target = null; g.deadAt = nowMs;
          g.respawnAt = SLIME.RESPAWN_SEC > 0 ? nowMs + SLIME.RESPAWN_SEC * 1000 : Infinity;
          if (cb.kill) cb.kill(s.pid, g);
        } else if (g.mode === 0) {   // 맞으면 때린 사람을 쫓아옴
          g.mode = 1; g.target = s.pid; g.atkReady = Math.max(g.atkReady, nowMs + 450);
        }
      }
    }

    // 2) 슬라임 행동
    for (const g of slimes) {
      if (g.dead) {
        if (nowMs >= g.respawnAt) { g.dead = false; g.hp = SLIME.HP; g.mode = 0; g.target = null; g.x = g.hx; g.z = g.hz; }
        continue;
      }
      if (g.mode === 0) {
        const p = pose(g, tSec, g.wp);
        g.x = p.x; g.z = p.z; g.ry = p.heading;
        let best = null, bd = A2;
        for (const pl of players.values()) {
          if (!pl.spawned || pl.hp <= 0 || pl.y < -100) continue;
          const d2 = (pl.x - g.x) ** 2 + (pl.z - g.z) ** 2;
          if (d2 <= bd) { bd = d2; best = pl; }
        }
        if (best) { g.mode = 1; g.target = best.id; g.atkReady = Math.max(g.atkReady, nowMs + 450); }
        continue;
      }
      const pl = players.get(g.target);
      if (!pl || !pl.spawned || pl.hp <= 0 || pl.y < -100) { returnHome(g); continue; }
      if (Math.hypot(g.x - g.hx, g.z - g.hz) > SLIME.RETURN_DIST) { returnHome(g); continue; }   // 너무 멀리 끌려옴 → 복귀 + 어그로 해제
      const dx = pl.x - g.x, dz = pl.z - g.z, d = Math.hypot(dx, dz);
      if (d > 0.01) g.ry = Math.atan2(dx, dz);
      if (d > SLIME.ATTACK_RANGE) {
        g.mode = 1;
        const step = Math.min(d - SLIME.ATTACK_RANGE * 0.8, SLIME.CHASE_SPEED * dt);
        g.x += (dx / d) * step; g.z += (dz / d) * step;
      } else {
        g.mode = 2;
        if (nowMs >= g.atkReady) {
          g.atkReady = nowMs + SLIME.ATTACK_COOLDOWN * 1000;
          g.atkN = (g.atkN + 1) & 255;
          if (cb.hurt) cb.hurt(pl.id, SLIME.DAMAGE, g);
        }
      }
    }

    // 3) 쫓아오는 슬라임끼리 겹치지 않게 살짝 밀어내기
    for (let i = 0; i < slimes.length; i++) {
      const a = slimes[i];
      if (a.dead || a.mode === 0) continue;
      for (let j = i + 1; j < slimes.length; j++) {
        const b = slimes[j];
        if (b.dead || b.mode === 0) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d < 1.0) {
          const push = d > 0.001 ? (1.0 - d) / 2 / d : 0.5;
          const ux = d > 0.001 ? dx : 1, uz = d > 0.001 ? dz : 0;
          a.x -= ux * push; a.z -= uz * push; b.x += ux * push; b.z += uz * push;
        }
      }
    }
  }

  // 플레이어가 평타를 시작했을 때 (실제 타격은 DELAY 뒤에 판정)
  function playerAttack(pl, nowMs) {
    swings.push({ pid: pl.id, at: nowMs + PLAYER_ATK.DELAY * 1000, dmg: PLAYER_ATK.DAMAGE, reach: PLAYER_ATK.REACH, arc: PLAYER_ATK.ARC_DEG });
  }

  // 플레이어가 스킬을 썼을 때 (범위 안의 슬라임 전부에게 피해. 맞는 순간은 DELAY 뒤)
  function playerSkill(pl, id, nowMs) {
    const k = SKILLS[id];
    if (!k) return;
    swings.push({ pid: pl.id, at: nowMs + k.DELAY * 1000, dmg: k.DAMAGE, reach: k.REACH, arc: k.ARC_DEG });
  }

  // 그 플레이어를 쫓던 슬라임들의 어그로 해제 (플레이어가 마을로 되살아날 때 등)
  function dropTarget(pid) {
    for (const g of slimes) if (g.target === pid) returnHome(g);
  }

  // 플레이어 주변 슬라임 목록: [id, x, z, 바라보는 방향, mode(3 = 죽어서 녹음), hp, 공격횟수]
  function snapshot(px, pz) {
    const v2 = SLIME.VIEW_DIST * SLIME.VIEW_DIST, out = [];
    const linger = (SLIME.DEATH_FALL + SLIME.DEATH_LIE) * 1000;
    for (const g of slimes) {
      // 죽은 슬라임은 녹아내리는 동안(mode 3)만 계속 보내요. 그 뒤엔 목록에서 빠져서 사라져요
      if (g.dead && lastNow - g.deadAt > linger) continue;
      if ((g.x - px) ** 2 + (g.z - pz) ** 2 > v2) continue;
      out.push([g.id, Math.round(g.x * 100) / 100, Math.round(g.z * 100) / 100, Math.round(g.ry * 100) / 100, g.dead ? 3 : g.mode, g.hp, g.atkN]);
    }
    return out;
  }

  return { slimes, update, playerAttack, playerSkill, dropTarget, snapshot };
}
