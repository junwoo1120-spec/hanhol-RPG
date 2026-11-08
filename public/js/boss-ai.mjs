// 보스 '오크 대전사' 두뇌 (서버가 실행하는 부분)
// 고블린 구역 한가운데의 어두운 흙 빈터(terrain.js 의 T.arena)에 한 마리가 살아요.
// THREE 를 쓰지 않는 순수 계산 파일이라 서버(Node)와 브라우저가 같은 설정(BOSS)을 공유해요.
// 거리·속도의 단위는 게임 좌표 단위(플레이어 걷기 속도 = 7 × 1.05 = 7.35 /초)예요.
//
// 전투가 시작되는 순간 = 보스가 플레이어를 처음 때리려고 도끼를 드는 때, 또는 플레이어가 보스를 처음 때린 때.
// (그때부터 화면 위에 보스 체력바가 떠요 — 스냅샷의 마지막 값 engaged)

import { PLAYER_ATK, SKILLS } from './goblin-ai.mjs';

export const BOSS = {
  NAME: '오크 대전사',
  SCALE: 1.5,              // 크기 배율. 모델 높이 약 2.7 × 1.5 ≈ 4.0m (플레이어 약 2.4m, 골렘 약 2.9m)
  HP: 500,                 // 체력
  DAMAGE: 50,              // 공격력 (한 방 50 → 플레이어 체력 100 이면 두 방)
  HIT_RADIUS: 1.6,         // 몸통 반지름 (플레이어 검이 닿는 거리에 더해짐)

  AGGRO_DIST: 24,          // 이 거리 안에 플레이어가 들어오면 발견하고 쫓아옴 (터 안으로 들어오면 바로)
  CHASE_SPEED: 5.2,        // 쫓아오는 속도. 골렘(4.0)보다 빠르고 플레이어 걷기(7.35)보단 느려요
  ATTACK_RANGE: 4.0,       // 공격 사정거리 (보스 중심 ~ 플레이어 중심)
  ATTACK_COOLDOWN: 1.8,    // 공격 간격(초). 골렘(2.2초)보다 빠름
  ATTACK_WINDUP: 0.85,     // 도끼를 머리 위로 들었다 내려찍는 순간까지(초). 이 안에 대쉬(Q)로 피하면 안 맞아요
  GIVEUP_DIST: 70,         // 플레이어가 이만큼 멀어지면 포기하고 돌아감 (체력도 가득 회복)
  RETURN_DIST: 80,         // 터 중심에서 이만큼 멀어지면 복귀
  DEATH_FALL: 1.6,         // 죽으면 쓰러지는 데 걸리는 시간(초)
  DEATH_LIE: 5.0,          // 쓰러진 채로 누워 있다가 사라지기까지(초)
  RESPAWN_SEC: 600,        // 쓰러진 보스가 다시 나타나는 시간(초). 0 이면 다시 안 나와요
  VIEW_DIST: 260,          // 플레이어에게 이 거리 안에 있을 때만 전송
};

// mode: 0 = 대기, 1 = 추적(이동 중), 2 = 공격(사정거리 안), (스냅샷에서만) 3 = 죽어서 쓰러짐
// T.arena 가 없으면(알맞은 터를 못 찾음) null 을 돌려줘요.
export function createBossSim({ T }) {
  const A = T.arena;
  if (!A) return null;
  const boss = {
    hx: A.x, hz: A.z, x: A.x, z: A.z, ry: Math.PI,   // 처음엔 마을 쪽(북서)을 보고 서 있음
    hp: BOSS.HP, mode: 0, target: null, engaged: false,
    atkReady: 0, atkN: 0, hitAt: 0, dead: false, respawnAt: 0, deadAt: 0,
  };
  const swings = [];
  let lastNow = 0;

  const eligible = (pl) => !!pl && pl.spawned && pl.hp > 0 && pl.y >= -100;   // 땅 위에 있는 살아 있는 플레이어
  // 포기하고 돌아가면 제자리로 순간이동 + 체력 가득 + 전투 종료
  const returnHome = () => { boss.mode = 0; boss.target = null; boss.hp = BOSS.HP; boss.hitAt = 0; boss.engaged = false; boss.x = boss.hx; boss.z = boss.hz; };

  function update(dtIn, nowMs, players, cb) {
    const dt = Math.min(dtIn, 0.2);
    lastNow = nowMs;

    // 1) 플레이어 검이 맞는 순간 처리
    for (let i = swings.length - 1; i >= 0; i--) {
      const s = swings[i];
      if (nowMs < s.at) continue;
      swings.splice(i, 1);
      const pl = players.get(s.pid);
      if (!eligible(pl) || boss.dead) continue;
      const fx = Math.sin(pl.ry), fz = Math.cos(pl.ry), cosArc = Math.cos((s.arc / 2) * Math.PI / 180);
      const dx = boss.x - pl.x, dz = boss.z - pl.z, d = Math.hypot(dx, dz);
      if (d - BOSS.HIT_RADIUS > s.reach) continue;          // 몸집이 커서 중심이 좀 더 멀어도 맞음
      if (d > 2.0 && (dx * fx + dz * fz) / d < cosArc) continue;
      boss.hp -= s.dmg;
      boss.engaged = true;                                    // 맞으면 전투 시작
      if (boss.hp <= 0) {
        boss.hp = 0; boss.dead = true; boss.mode = 0; boss.target = null; boss.hitAt = 0; boss.engaged = false; boss.deadAt = nowMs;
        boss.respawnAt = BOSS.RESPAWN_SEC > 0 ? nowMs + BOSS.RESPAWN_SEC * 1000 : Infinity;
        if (cb.kill) cb.kill(s.pid, boss);
      } else if (boss.mode === 0) {                           // 대기 중에 맞으면 때린 사람을 쫓음
        boss.mode = 1; boss.target = s.pid; boss.atkReady = Math.max(boss.atkReady, nowMs + 500);
      }
    }

    // 2) 보스 행동
    if (boss.dead) {
      if (nowMs >= boss.respawnAt) { boss.dead = false; boss.hp = BOSS.HP; boss.mode = 0; boss.target = null; boss.engaged = false; boss.x = boss.hx; boss.z = boss.hz; }
      return;
    }
    // 내려찍기 마무리: 도끼가 내려오는 순간 아직 사정거리 안에 있으면 피해 (그 전에 피하면 안 맞음)
    if (boss.hitAt && nowMs >= boss.hitAt) {
      boss.hitAt = 0;
      const t = players.get(boss.target);
      if (eligible(t) && Math.hypot(t.x - boss.x, t.z - boss.z) <= BOSS.ATTACK_RANGE + 1.2 && cb.hurt) cb.hurt(t.id, BOSS.DAMAGE, boss);
    }
    if (boss.mode === 0) {   // 대기 중: 가까이 온 플레이어를 발견하면 추적 시작
      let best = null, bd = BOSS.AGGRO_DIST;
      for (const pl of players.values()) {
        if (!eligible(pl)) continue;
        const d = Math.hypot(pl.x - boss.x, pl.z - boss.z);
        if (d < bd) { bd = d; best = pl; }
      }
      if (!best) return;
      boss.mode = 1; boss.target = best.id; boss.atkReady = Math.max(boss.atkReady, nowMs + 600);
    }
    const pl = players.get(boss.target);
    if (!eligible(pl)) { returnHome(); return; }
    if (Math.hypot(boss.x - boss.hx, boss.z - boss.hz) > BOSS.RETURN_DIST) { returnHome(); return; }
    const dx = pl.x - boss.x, dz = pl.z - boss.z, d = Math.hypot(dx, dz);
    if (d > BOSS.GIVEUP_DIST) { returnHome(); return; }
    if (d > 0.01 && !(boss.hitAt && nowMs > boss.hitAt - 200)) boss.ry = Math.atan2(dx, dz);   // 내려찍기 직전엔 방향 고정
    if (boss.hitAt) { boss.mode = 2; return; }   // 내려찍는 중에는 제자리
    if (d > BOSS.ATTACK_RANGE) {
      boss.mode = 1;
      const step = Math.min(d - BOSS.ATTACK_RANGE * 0.8, BOSS.CHASE_SPEED * dt);
      boss.x += (dx / d) * step; boss.z += (dz / d) * step;
    } else {
      boss.mode = 2;
      if (nowMs >= boss.atkReady) {
        boss.atkReady = nowMs + BOSS.ATTACK_COOLDOWN * 1000;
        boss.atkN = (boss.atkN + 1) & 255;                  // 화면에서 도끼 드는 모션 시작
        boss.hitAt = nowMs + BOSS.ATTACK_WINDUP * 1000;     // 이 시각에 피해 확정
        boss.engaged = true;                                 // 때리려고 하면 전투 시작
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
  function dropTarget(pid) { if (boss.target === pid) returnHome(); }

  // 플레이어 주변이면 [x, z, 바라보는 방향, mode(3 = 죽어서 쓰러짐), hp, 공격횟수, 전투중(0/1)], 멀면 []
  function snapshot(px, pz) {
    if (boss.dead && lastNow - boss.deadAt > (BOSS.DEATH_FALL + BOSS.DEATH_LIE) * 1000) return [];
    if ((boss.x - px) ** 2 + (boss.z - pz) ** 2 > BOSS.VIEW_DIST * BOSS.VIEW_DIST) return [];
    return [Math.round(boss.x * 100) / 100, Math.round(boss.z * 100) / 100, Math.round(boss.ry * 100) / 100, boss.dead ? 3 : boss.mode, boss.hp, boss.atkN, boss.engaged ? 1 : 0];
  }

  return { boss, arena: A, update, playerAttack, playerSkill, dropTarget, snapshot };
}
