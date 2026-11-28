// 고릴라 두뇌 (서버가 실행하는 부분): 정글 배치 · 배회 · 드러밍(가슴 치기) · 추적 · 공격 · 피격 · 복귀
// THREE 를 쓰지 않는 순수 계산 파일이라 서버(Node)와 브라우저가 같은 설정(GORILLA)을 공유해요.
// 거리·속도의 단위는 게임 좌표 단위(플레이어 걷기 속도 = 7 × 1.05 = 7.35 /초, 플레이어 키 약 2.4m)예요.
//
// 정글 배치: 정글(지형 'forest')의 한가운데는 조금 비워 두고, 그 바깥을 3구역(120°씩)으로 나눠서
//           한 구역에 고릴라 PER_ZONE 마리씩 살아요. (구역 수·마리 수는 아래 GORILLA 에서 바꿔요)
// 행동: 평소엔 천천히 배회 → 사람이 인식거리 안에 들어오면 서서 가슴을 두드리며(드러밍) DRUM_SEC 초 동안 위협
//       → 네 발로 달려와서 → 팔을 번쩍 들었다가 내려찍어요 (ATTACK_WINDUP 초 뒤에 피해, 그 안에 대쉬로 피할 수 있어요)

import { GOBLIN, PLAYER_ATK, SKILLS, inSquare, dmgMul, rollHit, h32 } from './goblin-ai.mjs';
import { BOSS } from './boss-ai.mjs';

export { SKILLS };

const PLAYER_H = 2.4;   // 플레이어 키(m)

export const GORILLA = {
  NAME: '고릴라',
  ZONES: 3,                // 정글을 몇 구역으로 나눌지
  PER_ZONE: 1,             // 한 구역에 사는 고릴라 수
  CENTER_KEEP: 0.22,       // 정글 한가운데 비워 두는 크기 (정글 반지름 × 이 값 안쪽에는 안 살아요)
  SPACING: 70,             // 같은 구역 고릴라끼리 최소 간격
  HEIGHT_MUL: 1.5,         // 키 = 사람의 1.5배 (바꾸면 모델 크기도 같이 바뀌어요)
  STAND_H: PLAYER_H * 1.5, // 두 발로 섰을 때 키(m) = 3.6m
  HIT_RADIUS: 1.1,         // 몸통 반지름 (플레이어 검이 닿는 거리에 더해짐)

  HP: BOSS.HP * 1.5,       // 체력 = 오크 대전사의 1.5배
  DAMAGE: 40 * 1.5,        // 공격력 = 40의 1.5배 = 60 (플레이어 체력 100 이면 두 방)
  AGGRO_DIST: GOBLIN.AGGRO_DIST / 2,           // 인식거리 = 고블린의 절반
  DRUM_SEC: 2,                                  // 인식한 뒤 가슴을 두드리는 시간(초). 끝나면 달려와요
  CHASE_SPEED: GOBLIN.CHASE_SPEED * 1.2,        // 추적 속도 = 고블린의 1.2배
  ATTACK_RANGE: 3.2,       // 공격 사정거리 (고릴라 중심 ~ 플레이어 중심)
  ATTACK_COOLDOWN: BOSS.ATTACK_COOLDOWN / 1.15, // 공격 간격(초) = 오크 대전사의 공격 속도 1.15배
  ATTACK_WINDUP: 0.5,      // 팔을 들었다가 내려치는 순간까지(초). 이 안에 대쉬(Q)로 피하면 안 맞아요
  ATTACK_SLACK: 0.9,       // 내려치는 순간엔 사정거리를 이만큼 더 봐줘요
  LEASH: 14,               // 평소 배회 범위 (집에서 이 거리 안)
  SEGMENT: 26,             // 배회 한 사이클(서 있기 → 걷기 → 서 있기) 길이(초)
  RETURN_DIST: 90,         // 집에서 이만큼 멀어지면 복귀(순간이동) + 어그로 해제 + 체력 회복
  DEATH_FALL: 1.3,         // 죽으면 쓰러지는 데 걸리는 시간(초)
  DEATH_LIE: 4.0,          // 쓰러진 채로 누워 있다가 사라지기까지(초)
  RESPAWN_SEC: 90,         // 죽은 고릴라가 다시 나타나는 시간(초). 0 이면 다시 안 나와요
  VIEW_DIST: 240,          // 플레이어에게 이 거리 안의 고릴라만 전송
};

const TAU = Math.PI * 2;
const TURN = 1.1;
const smooth01 = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// ---------- 배치: 정글 가운데를 조금 비우고 3구역으로 나눠서, 구역마다 PER_ZONE 마리 ----------
// 반환: [{ x, z, zone }]. 정글을 못 찾으면 빈 목록
export function makeSpawns(T, seed, WATER_LEVEL, PLAY_RADIUS) {
  const sd = (Number(seed) | 0) || 1;
  const STEP = 20, R = PLAY_RADIUS;
  const okLand = (x, z) => {
    const h = T.height(x, z);
    if (h < WATER_LEVEL + 2.5) return false;
    const s = Math.max(Math.abs(T.height(x + 5, z) - h), Math.abs(T.height(x, z + 5) - h));
    return s < 3.2;   // 너무 가파른 비탈은 제외
  };

  // 1) 정글 땅 훑기 → 무게중심(c) 과 대략적인 반지름(Rj)
  const pts = [];
  for (let x = -R; x <= R; x += STEP) for (let z = -R; z <= R; z += STEP) {
    if (Math.hypot(x, z) > R) continue;
    if (T.biome(x, z) === 'forest' && T.height(x, z) > WATER_LEVEL + 1) pts.push([x, z]);
  }
  if (pts.length < 40) return [];
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cz += p[1]; }
  cx /= pts.length; cz /= pts.length;
  const Rj = Math.sqrt(pts.length * STEP * STEP / Math.PI);   // 같은 넓이의 원 반지름
  const hole = Rj * GORILLA.CENTER_KEEP;
  const off = h32(sd, 17, 5) * 360;   // 구역을 나누는 시작 각도 (시드마다 달라요)
  const zoneOf = (x, z) => {
    let a = Math.atan2(x - cx, -(z - cz)) * 180 / Math.PI;
    a = ((a - off) % 360 + 360) % 360;
    return Math.min(GORILLA.ZONES - 1, Math.floor(a / (360 / GORILLA.ZONES)));
  };
  const isHome = (x, z) => T.biome(x, z) === 'forest' && okLand(x, z);

  // 2) 구역마다: 가운데 구멍 바깥의 정글 땅 중, 배회 범위 사방도 정글인 곳 → 구역의 중심에 가까운 곳부터 PER_ZONE 곳
  const out = [];
  for (let zone = 0; zone < GORILLA.ZONES; zone++) {
    const cand = [];
    for (const [x, z] of pts) {
      if (zoneOf(x, z) !== zone) continue;
      const d = Math.hypot(x - cx, z - cz);
      if (d < hole + GORILLA.LEASH + 6) continue;
      if (!isHome(x, z)) continue;
      let ok = true;
      for (let a = 0; a < 4 && ok; a++) ok = isHome(x + Math.cos(a * Math.PI / 2) * GORILLA.LEASH, z + Math.sin(a * Math.PI / 2) * GORILLA.LEASH);
      if (ok) cand.push([x, z]);
    }
    if (!cand.length) continue;
    let mx = 0, mz = 0;
    for (const p of cand) { mx += p[0]; mz += p[1]; }
    mx /= cand.length; mz /= cand.length;
    cand.sort((a, b) => Math.hypot(a[0] - mx, a[1] - mz) - Math.hypot(b[0] - mx, b[1] - mz));
    const picked = [];
    for (const c of cand) {
      if (picked.length >= GORILLA.PER_ZONE) break;
      if (picked.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) >= GORILLA.SPACING)) picked.push(c);
    }
    for (const p of picked) out.push({ x: p[0], z: p[1], zone });
  }
  return out;
}

// ---------- 평소 배회 (시계로 위치 계산, 고블린과 같은 방식) ----------
function makeWander(T, WATER_LEVEL) {
  function wp(g, k) {
    const memo = g.memo || (g.memo = new Map());
    let p = memo.get(k);
    if (p) return p;
    const a = h32(g.id, k, 101 + g.seed) * TAU;
    const rr = Math.sqrt(h32(g.id, k, 202 + g.seed)) * GORILLA.LEASH;
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
    return Math.hypot(dx, dz) < 0.4 ? h32(g.id, k, 505) * TAU : Math.atan2(dx, dz);
  };
  return function pose(g, tSec, out) {
    const L = GORILLA.SEGMENT;
    const tt = tSec + g.off;
    const k = Math.floor(tt / L), f = tt - k * L;
    const A = wp(g, k), B = wp(g, k + 1);
    const dx = B[0] - A[0], dz = B[1] - A[1], dist = Math.hypot(dx, dz);
    const spd = 1.1 + 0.7 * h32(g.id, k, 303);   // 느긋하게 걷는 속도
    const walkT = Math.min(Math.max(dist / spd, 0.01), L - TURN - 0.5);
    const idleBefore = (L - TURN - walkT) * h32(g.id, k, 404);
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

// ---------- 고릴라 시뮬레이션 ----------
// mode: 0 = 배회, 1 = 추적(이동 중), 2 = 공격(사정거리 안), 4 = 드러밍(가슴 치기), (스냅샷에서만) 3 = 죽어서 쓰러짐
export function createGorillaSim({ T, seed, WATER_LEVEL, PLAY_RADIUS }) {
  const sd = (Number(seed) | 0) || 1;
  const pose = makeWander(T, WATER_LEVEL);
  const gorillas = makeSpawns(T, sd, WATER_LEVEL, PLAY_RADIUS).map((c, id) => ({
    id, seed: sd, zone: c.zone, hx: c.x, hz: c.z, off: h32(id, sd, 61) * GORILLA.SEGMENT * 9,
    x: c.x, z: c.z, ry: h32(id, sd, 71) * TAU, hp: GORILLA.HP, mode: 0, target: null,
    drumUntil: 0, atkReady: 0, atkN: 0, winding: false, hitAt: 0,
    dead: false, respawnAt: 0, deadAt: 0, wp: { x: c.x, z: c.z, heading: 0 },
  }));
  const swings = [];   // 플레이어가 휘두른 검 (맞는 순간 대기 중)
  let lastNow = 0;

  const eligible = (pl) => !!pl && pl.spawned && pl.hp > 0 && pl.y >= -100;   // 땅 위에 있는 살아 있는 플레이어
  const returnHome = (g) => { g.mode = 0; g.target = null; g.winding = false; g.hp = GORILLA.HP; g.x = g.wp.x; g.z = g.wp.z; };
  const startDrum = (g, pid, nowMs) => {   // 가슴을 두드려 위협 → DRUM_SEC 뒤에 달려옴
    g.mode = 4; g.target = pid; g.winding = false;
    g.drumUntil = nowMs + GORILLA.DRUM_SEC * 1000;
    g.atkReady = Math.max(g.atkReady, g.drumUntil + 250);
  };

  function update(dtIn, nowMs, players, cb) {
    const dt = Math.min(dtIn, 0.2);
    lastNow = nowMs;
    const tSec = nowMs / 1000;
    const A2 = GORILLA.AGGRO_DIST * GORILLA.AGGRO_DIST;

    // 1) 플레이어 검이 맞는 순간 처리
    for (let i = swings.length - 1; i >= 0; i--) {
      const s = swings[i];
      if (nowMs < s.at) continue;
      swings.splice(i, 1);
      const pl = players.get(s.pid);
      if (!pl || !pl.spawned || pl.hp <= 0 || pl.y < -100) continue;
      const fx = Math.sin(pl.ry), fz = Math.cos(pl.ry), cosArc = Math.cos((s.arc / 2) * Math.PI / 180);
      for (const g of gorillas) {
        if (g.dead) continue;
        const dx = g.x - pl.x, dz = g.z - pl.z, d = Math.hypot(dx, dz);
        if (s.sq) { if (!inSquare(g.x, g.z, s.sq, GORILLA.HIT_RADIUS)) continue; }
        else {
          if (d > s.reach + GORILLA.HIT_RADIUS) continue;
          if (d > 0.8 + GORILLA.HIT_RADIUS && (dx * fx + dz * fz) / d < cosArc) continue;
        }
        const h = rollHit(pl, s.dmg);   // 치명타 판정 (몬스터마다 따로)
        g.hp -= h.dmg;
        if (cb.hit) cb.hit(s.pid, g, h.dmg, h.crit);
        if (g.hp <= 0) {
          g.dead = true; g.mode = 0; g.target = null; g.winding = false; g.deadAt = nowMs;
          g.respawnAt = GORILLA.RESPAWN_SEC > 0 ? nowMs + GORILLA.RESPAWN_SEC * 1000 : Infinity;
          if (cb.kill) cb.kill(s.pid, g);
        } else if (g.mode === 0) startDrum(g, s.pid, nowMs);   // 맞으면 때린 사람을 보고 가슴을 두드린 뒤 달려옴
      }
    }

    // 2) 고릴라 행동
    for (const g of gorillas) {
      if (g.dead) {
        if (nowMs >= g.respawnAt) { g.dead = false; g.hp = GORILLA.HP; g.mode = 0; g.target = null; g.winding = false; g.x = g.hx; g.z = g.hz; }
        continue;
      }
      if (g.mode === 0) {
        const p = pose(g, tSec, g.wp);
        g.x = p.x; g.z = p.z; g.ry = p.heading;
        let best = null, bd = A2;
        for (const pl of players.values()) {
          if (!eligible(pl)) continue;
          const d2 = (pl.x - g.x) ** 2 + (pl.z - g.z) ** 2;
          if (d2 <= bd) { bd = d2; best = pl; }
        }
        if (best) startDrum(g, best.id, nowMs);
        continue;
      }
      const pl = players.get(g.target);
      if (!eligible(pl)) { returnHome(g); continue; }
      if (Math.hypot(g.x - g.hx, g.z - g.hz) > GORILLA.RETURN_DIST) { returnHome(g); continue; }   // 너무 멀리 끌려옴 → 복귀
      const dx = pl.x - g.x, dz = pl.z - g.z, d = Math.hypot(dx, dz);

      if (g.mode === 4) {   // 드러밍: 제자리에서 상대를 보며 가슴을 두드림
        if (d > 0.01) g.ry += angDiff(g.ry, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
        if (nowMs >= g.drumUntil) g.mode = 1;
        continue;
      }

      // 내려치는 중(팔을 들었다가 찍는 순간까지): 제자리에서 상대를 향함. 찍는 순간 사정거리 안이면 피해
      if (g.winding) {
        if (d > 0.01 && nowMs < g.hitAt - 120) g.ry += angDiff(g.ry, Math.atan2(dx, dz)) * Math.min(1, dt * 10);
        if (nowMs >= g.hitAt) {
          g.winding = false;
          if (d <= GORILLA.ATTACK_RANGE + GORILLA.ATTACK_SLACK && cb.hurt) cb.hurt(pl.id, GORILLA.DAMAGE, g);
        }
        continue;
      }

      if (d > 0.01) g.ry = Math.atan2(dx, dz);
      if (d > GORILLA.ATTACK_RANGE) {
        g.mode = 1;
        const step = Math.min(d - GORILLA.ATTACK_RANGE * 0.8, GORILLA.CHASE_SPEED * dt);
        g.x += (dx / d) * step; g.z += (dz / d) * step;
      } else {
        g.mode = 2;
        if (nowMs >= g.atkReady) {
          g.atkReady = nowMs + GORILLA.ATTACK_COOLDOWN * 1000;
          g.atkN = (g.atkN + 1) & 255;      // 화면이 이 숫자가 바뀌는 걸 보고 내려치는 모션을 시작해요
          g.winding = true;
          g.hitAt = nowMs + GORILLA.ATTACK_WINDUP * 1000;
        }
      }
    }

    // 3) 고릴라끼리 겹치지 않게 살짝 밀어내기
    for (let i = 0; i < gorillas.length; i++) {
      const a = gorillas[i];
      if (a.dead || a.mode === 0) continue;
      for (let j = i + 1; j < gorillas.length; j++) {
        const b = gorillas[j];
        if (b.dead || b.mode === 0) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), m = GORILLA.HIT_RADIUS * 2;
        if (d < m) {
          const push = d > 0.001 ? (m - d) / 2 / d : 0.4;
          const ux = d > 0.001 ? dx : 1, uz = d > 0.001 ? dz : 0;
          a.x -= ux * push; a.z -= uz * push; b.x += ux * push; b.z += uz * push;
        }
      }
    }
  }

  // 플레이어가 평타를 시작했을 때 (실제 타격은 DELAY 뒤에 판정)
  function playerAttack(pl, nowMs) {
    swings.push({ pid: pl.id, at: nowMs + PLAYER_ATK.DELAY * 1000, dmg: PLAYER_ATK.DAMAGE * dmgMul(pl), reach: PLAYER_ATK.REACH, arc: PLAYER_ATK.ARC_DEG });
  }
  function playerSquare(pl, nowMs, sq) {
    swings.push({ pid: pl.id, at: nowMs + sq.delay * 1000, dmg: sq.dmg * dmgMul(pl), sq: { cx: sq.cx, cz: sq.cz, ry: sq.ry, half: sq.half } });
  }
  function playerSkill(pl, id, nowMs) {
    const k = SKILLS[id];
    if (!k) return;
    swings.push({ pid: pl.id, at: nowMs + k.DELAY * 1000, dmg: k.DAMAGE * dmgMul(pl), reach: k.REACH, arc: k.ARC_DEG });
  }
  // 그 플레이어를 쫓던 고릴라들의 어그로 해제 (플레이어가 죽거나 마을로 되살아날 때)
  function dropTarget(pid) {
    for (const g of gorillas) if (g.target === pid) returnHome(g);
  }

  // 플레이어 주변 고릴라 목록: [id, x, z, 바라보는 방향, mode(3 = 죽어서 쓰러짐), hp, 공격횟수]
  function snapshot(px, pz) {
    const v2 = GORILLA.VIEW_DIST * GORILLA.VIEW_DIST, out = [];
    const linger = (GORILLA.DEATH_FALL + GORILLA.DEATH_LIE) * 1000;
    for (const g of gorillas) {
      if (g.dead && lastNow - g.deadAt > linger) continue;   // 누워 있는 동안만 계속 보내고, 그 뒤엔 목록에서 빠져 사라져요
      if ((g.x - px) ** 2 + (g.z - pz) ** 2 > v2) continue;
      out.push([g.id, Math.round(g.x * 100) / 100, Math.round(g.z * 100) / 100, Math.round(g.ry * 100) / 100, g.dead ? 3 : g.mode, Math.round(g.hp), g.atkN]);
    }
    return out;
  }

  return { gorillas, update, playerAttack, playerSkill, playerSquare, dropTarget, snapshot };
}
