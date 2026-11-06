// 골렘 두뇌 (서버가 실행하는 부분): 동굴 안 배치 · 배회 · 발견하면 추적 · 내려치기 공격 · 쓰러짐 · 복귀
// THREE 를 쓰지 않는 순수 계산 파일이라 서버(Node)와 브라우저가 같은 설정(GOLEM)을 공유해요.
// 골렘은 동굴(cave-layout.mjs) 안에서만 살아요. 땅 위 플레이어는 상대하지 않고, 동굴 안(지하)에 있는 플레이어만 상대해요.
// 거리·속도의 단위는 게임 좌표 단위(플레이어 걷기 속도 = 7 × 1.05 = 7.35 /초)예요.

import { h32, PLAYER_ATK, SKILLS } from './goblin-ai.mjs';
import { CAVE } from './cave-layout.mjs';

export const GOLEM = {
  COUNT: 20,               // 동굴 안 골렘 수 (cave-layout.mjs 의 시작 위치 수와 같게)
  SCALE: 1.25,             // 크기 배율. 모델 높이 약 2.3 × 1.25 ≈ 2.9m (플레이어는 약 2.4m)
  HP: 50,                  // 체력
  DAMAGE: 10,              // 공격력
  HIT_RADIUS: 0.9,         // 몸통 반지름 (플레이어 검이 닿는 거리에 더해짐)

  LEASH: 8,                // 평소 배회 범위 (집에서 이 거리 안)
  SEGMENT: 26,             // 배회 한 사이클 길이(초) — 골렘은 느긋하게
  WANDER_SPEED: 0.6,       // 배회 속도 (아주 천천히)
  AGGRO_DIST: 18,          // 이 거리 안에 플레이어가 들어오면 발견하고 쫓아옴
  CHASE_SPEED: 4.0,        // 쫓아오는 속도. 플레이어 걷기(7.35)보다 느려요
  ATTACK_RANGE: 2.6,       // 공격 사정거리 (골렘 중심 ~ 플레이어 중심)
  ATTACK_COOLDOWN: 2.2,    // 공격 간격(초)
  ATTACK_WINDUP: 0.62,     // 팔을 들었다 내려치는 순간까지(초). 이 안에 피하면 안 맞아요
  STUN: 0.25,              // 맞았을 때 움찔하는 시간(초)
  GIVEUP_DIST: 45,         // 플레이어가 이만큼 멀어지면 포기하고 돌아감 (체력도 회복)
  RETURN_DIST: 60,         // 집에서 이만큼 멀어지면 복귀
  DEATH_FALL: 1.1,         // 죽으면 무너져 쓰러지는 데 걸리는 시간(초)
  DEATH_LIE: 2.0,          // 쓰러진 채로 누워 있다가 사라지기까지(초)
  RESPAWN_SEC: 90,         // 죽은 골렘이 다시 나타나는 시간(초). 0 이면 다시 안 나와요
  VIEW_DIST: 220,          // 플레이어에게 이 거리 안의 골렘만 전송
};

const TAU = Math.PI * 2;
const TURN = 1.2;
const smooth01 = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// ---------- 평소 배회 (시계로 위치 계산) ----------
function makeWander(layout) {
  function wp(g, k) {
    const memo = g.memo || (g.memo = new Map());
    let p = memo.get(k);
    if (p) return p;
    const a = h32(g.id, k, 2101 + g.seed) * TAU, rr = Math.sqrt(h32(g.id, k, 2202 + g.seed)) * GOLEM.LEASH;
    let x = g.hx + Math.cos(a) * rr, z = g.hz + Math.sin(a) * rr;
    const bad = layout.sdf(x, z) > -4 || layout.pillars.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 2.5);
    if (bad) { x = g.hx; z = g.hz; }
    p = [x, z];
    memo.set(k, p);
    if (memo.size > 8) memo.delete(memo.keys().next().value);
    return p;
  }
  const segDir = (g, k) => {
    const A = wp(g, k), B = wp(g, k + 1), dx = B[0] - A[0], dz = B[1] - A[1];
    return Math.hypot(dx, dz) < 0.6 ? h32(g.id, k, 2505) * TAU : Math.atan2(dx, dz);
  };
  return function pose(g, tSec, out) {
    const L = GOLEM.SEGMENT, tt = tSec + g.off, k = Math.floor(tt / L), f = tt - k * L;
    const A = wp(g, k), B = wp(g, k + 1), dx = B[0] - A[0], dz = B[1] - A[1], dist = Math.hypot(dx, dz);
    const walkT = Math.min(Math.max(dist / GOLEM.WANDER_SPEED, 0.01), L - TURN - 1);
    const idleBefore = (L - TURN - walkT) * h32(g.id, k, 2404);
    const ts = idleBefore + TURN;
    const prev = segDir(g, k - 1), cur = segDir(g, k);
    out.heading = f < idleBefore ? prev : prev + angDiff(prev, cur) * smooth01((f - idleBefore) / TURN);
    if (f <= ts || dist < 0.05) { out.x = A[0]; out.z = A[1]; return out; }
    const u = Math.min(1, (f - ts) / walkT);
    out.x = A[0] + dx * u; out.z = A[1] + dz * u;
    return out;
  };
}

// ---------- 골렘 시뮬레이션 ----------
// mode: 0 = 배회, 1 = 추적(이동 중), 2 = 공격(사정거리 안), (스냅샷에서만) 3 = 죽어서 쓰러짐
export function createGolemSim({ layout, seed }) {
  const sd = (Number(seed) | 0) || 1;
  const pose = makeWander(layout);
  const golems = layout.spawns.slice(0, GOLEM.COUNT).map((c, id) => ({
    id, seed: sd, hx: c.x, hz: c.z, off: h32(id, sd, 261) * GOLEM.SEGMENT * 9,
    x: c.x, z: c.z, ry: h32(id, sd, 262) * TAU, hp: GOLEM.HP, mode: 0, target: null,
    atkReady: 0, atkN: 0, hitAt: 0, stunUntil: 0, dead: false, respawnAt: 0, deadAt: 0, wp: { x: c.x, z: c.z, heading: 0 },
  }));
  const swings = [];
  let lastNow = 0;

  // 지하(동굴 안)에 있는 플레이어만 상대해요
  const eligible = (pl) => !!pl && pl.spawned && pl.hp > 0 && pl.y < CAVE.UNDER_Y && Math.abs(pl.y - layout.Y) < 40 && layout.inside(pl.x, pl.z);
  const returnHome = (g) => { g.mode = 0; g.target = null; g.hp = GOLEM.HP; g.stunUntil = 0; g.hitAt = 0; };

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
      if (!eligible(pl)) continue;
      const fx = Math.sin(pl.ry), fz = Math.cos(pl.ry), cosArc = Math.cos((s.arc / 2) * Math.PI / 180);
      for (const g of golems) {
        if (g.dead) continue;
        const dx = g.x - pl.x, dz = g.z - pl.z, d = Math.hypot(dx, dz);
        if (d - GOLEM.HIT_RADIUS > s.reach) continue;   // 몸집이 커서 중심이 좀 더 멀어도 맞음
        if (d > 1.6 && (dx * fx + dz * fz) / d < cosArc) continue;
        g.hp -= s.dmg;
        if (g.hp <= 0) {
          g.dead = true; g.mode = 0; g.target = null; g.hitAt = 0; g.deadAt = nowMs;
          g.respawnAt = GOLEM.RESPAWN_SEC > 0 ? nowMs + GOLEM.RESPAWN_SEC * 1000 : Infinity;
          if (cb.kill) cb.kill(s.pid, g);
        } else {
          g.stunUntil = nowMs + GOLEM.STUN * 1000;
          if (g.mode === 0) { g.mode = 1; g.target = s.pid; g.atkReady = Math.max(g.atkReady, nowMs + 600); }   // 맞으면 때린 사람을 쫓음
        }
      }
    }

    // 2) 골렘 행동
    for (const g of golems) {
      if (g.dead) {
        if (nowMs >= g.respawnAt) { g.dead = false; g.hp = GOLEM.HP; g.mode = 0; g.target = null; g.x = g.hx; g.z = g.hz; }
        continue;
      }
      // 내려치기 마무리: 팔이 내려오는 순간 아직 사정거리 안에 있으면 피해 (그 전에 피하면 안 맞음)
      if (g.hitAt && nowMs >= g.hitAt) {
        g.hitAt = 0;
        const t = players.get(g.target);
        if (eligible(t) && Math.hypot(t.x - g.x, t.z - g.z) <= GOLEM.ATTACK_RANGE + 1.0 && cb.hurt) cb.hurt(t.id, GOLEM.DAMAGE, g);
      }
      if (g.mode === 0) {
        // 배회 중: 가까이 온 플레이어를 발견하면 추적 시작
        let best = null, bd = GOLEM.AGGRO_DIST;
        for (const pl of players.values()) {
          if (!eligible(pl)) continue;
          const d = Math.hypot(pl.x - g.x, pl.z - g.z);
          if (d < bd) { bd = d; best = pl; }
        }
        if (best) { g.mode = 1; g.target = best.id; g.atkReady = Math.max(g.atkReady, nowMs + 500); }
        else {
          const p = pose(g, tSec, g.wp);
          g.x = p.x; g.z = p.z; g.ry = p.heading;
          continue;
        }
      }
      const pl = players.get(g.target);
      if (!eligible(pl)) { returnHome(g); continue; }
      if (Math.hypot(g.x - g.hx, g.z - g.hz) > GOLEM.RETURN_DIST) { returnHome(g); continue; }
      const dx = pl.x - g.x, dz = pl.z - g.z, d = Math.hypot(dx, dz);
      if (d > GOLEM.GIVEUP_DIST) { returnHome(g); continue; }
      if (nowMs < g.stunUntil) continue;
      if (d > 0.01 && !(g.mode === 2 && g.hitAt && nowMs > g.hitAt - 150)) g.ry = Math.atan2(dx, dz);   // 내려치기 직전엔 방향 고정
      if (g.hitAt) { g.mode = 2; continue; }   // 내려치는 중에는 제자리
      if (d > GOLEM.ATTACK_RANGE) {
        g.mode = 1;
        const step = Math.min(d - GOLEM.ATTACK_RANGE * 0.8, GOLEM.CHASE_SPEED * dt);
        const c = layout.collide(g.x + (dx / d) * step, g.z + (dz / d) * step, 1.0);
        g.x = c.x; g.z = c.z;
      } else {
        g.mode = 2;
        if (nowMs >= g.atkReady) {
          g.atkReady = nowMs + GOLEM.ATTACK_COOLDOWN * 1000;
          g.atkN = (g.atkN + 1) & 255;                  // 화면에서 팔 드는 모션 시작
          g.hitAt = nowMs + GOLEM.ATTACK_WINDUP * 1000; // 이 시각에 피해 확정
        }
      }
    }

    // 3) 쫓아오는 골렘끼리 겹치지 않게 살짝 밀어내기
    for (let i = 0; i < golems.length; i++) {
      const a = golems[i];
      if (a.dead || a.mode === 0) continue;
      for (let j = i + 1; j < golems.length; j++) {
        const b = golems[j];
        if (b.dead || b.mode === 0) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d < 1.8) {
          const push = d > 0.001 ? (1.8 - d) / 2 / d : 0.5;
          const ux = d > 0.001 ? dx : 1, uz = d > 0.001 ? dz : 0;
          a.x -= ux * push; a.z -= uz * push; b.x += ux * push; b.z += uz * push;
        }
      }
    }
  }

  function playerAttack(pl, nowMs) {
    swings.push({ pid: pl.id, at: nowMs + PLAYER_ATK.DELAY * 1000, dmg: PLAYER_ATK.DAMAGE, reach: PLAYER_ATK.REACH, arc: PLAYER_ATK.ARC_DEG });
  }
  function playerSkill(pl, id, nowMs) {
    const k = SKILLS[id];
    if (!k) return;
    swings.push({ pid: pl.id, at: nowMs + k.DELAY * 1000, dmg: k.DAMAGE, reach: k.REACH, arc: k.ARC_DEG });
  }
  function dropTarget(pid) { for (const g of golems) if (g.target === pid) returnHome(g); }

  // 플레이어 주변 골렘 목록: [id, x, z, 바라보는 방향, mode(3 = 죽어서 쓰러짐), hp, 공격횟수]
  function snapshot(px, pz) {
    const v2 = GOLEM.VIEW_DIST * GOLEM.VIEW_DIST, linger = (GOLEM.DEATH_FALL + GOLEM.DEATH_LIE) * 1000, out = [];
    for (const g of golems) {
      if (g.dead && lastNow - g.deadAt > linger) continue;
      if ((g.x - px) ** 2 + (g.z - pz) ** 2 > v2) continue;
      out.push([g.id, Math.round(g.x * 100) / 100, Math.round(g.z * 100) / 100, Math.round(g.ry * 100) / 100, g.dead ? 3 : g.mode, g.hp, g.atkN]);
    }
    return out;
  }

  return { golems, update, playerAttack, playerSkill, dropTarget, snapshot };
}
