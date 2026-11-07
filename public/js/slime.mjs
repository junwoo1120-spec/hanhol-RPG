// 슬라임 그리기 (서버가 위치·전투를 정하고, 여기서는 받아서 그림)
// 모양은 캐릭터 시트 그대로: 각진 면이 보이는 반투명 네온 그린 젤리 + 속이 비치는 어두운 핵 + 빛나는 노란 눈 + 떠다니는 물방울.
//  - 평소: 숨쉬듯 말랑말랑 / 이동: 통통 튀듯 늘었다 줄었다 / 공격: 움츠렸다가 길게 튀어 오르며 찡그린 눈 /
//    맞음: 붉게 번쩍 + 눈이 > < / 죽음: 바닥에 납작하게 녹아내림
// 모델은 모두 코드로 만들어서 따로 받을 이미지·모델 파일이 없어요.
import * as THREE from 'three';
import { SLIME } from './slime-ai.mjs';

const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const R0 = 0.4;   // 모델 기본 반지름(m) × SLIME.SCALE = 실제 크기

// ---------- 모든 슬라임이 같이 쓰는 모양·재질 (처음 만들 때 한 번만) ----------
let SH = null;
function shared() {
  if (SH) return SH;

  // 몸: 각진 면이 보이는 돔. 위쪽은 울퉁불퉁하게 일그러뜨리고 아래는 납작하게 퍼짐
  const dome = (detail, noise) => {
    const g = new THREE.IcosahedronGeometry(1, detail);   // 면마다 따로(비인덱스) → 법선이 면 단위라 보석처럼 각져 보임
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const w = 1 + noise * (Math.sin(x * 7 + 1.3) * Math.sin(z * 6 + 2.1) + 0.6 * Math.sin(y * 9 + x * 4));   // 좌표만으로 정해서 이웃 면과 안 갈라져요
      if (y < 0) { x *= 1.06; z *= 1.06; y = 0; } else { x *= w; z *= w; y *= 1.25 * w; }
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  };
  const bodyGeo = dome(2, 0.045), coreGeo = dome(1, 0.05);
  const dropGeo = new THREE.SphereGeometry(0.13, 8, 6);
  const puddleGeo = new THREE.CircleGeometry(1.25, 20).rotateX(-Math.PI / 2);
  const eyeGeo = new THREE.PlaneGeometry(1.15, 0.58);

  const body = new THREE.MeshStandardMaterial({ color: 0x62e61c, emissive: 0x2f9a06, emissiveIntensity: 0.55, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.74, depthWrite: false });
  const bodyHit = new THREE.MeshStandardMaterial({ color: 0xffb0a0, emissive: 0xff3a1a, emissiveIntensity: 0.9, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.85, depthWrite: false });
  const core = new THREE.MeshStandardMaterial({ color: 0x2c8a0e, emissive: 0x1d6a06, emissiveIntensity: 0.5, roughness: 0.5 });
  const coreHit = new THREE.MeshStandardMaterial({ color: 0xc04a3a, emissive: 0x8a1a0a, emissiveIntensity: 0.6, roughness: 0.5 });
  const drop = new THREE.MeshStandardMaterial({ color: 0x8cff3a, emissive: 0x3fb010, emissiveIntensity: 0.6, roughness: 0.1, transparent: true, opacity: 0.8 });
  const puddle = new THREE.MeshBasicMaterial({ color: 0x9dff2a, transparent: true, opacity: 0.32, depthWrite: false, fog: true });

  // 눈 3종류: 동그란 눈 / 화난 눈(위가 비스듬히 깎임) / 아픈 눈(> <)
  const eyeTex = (draw) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.shadowColor = 'rgba(255,255,140,0.95)'; ctx.shadowBlur = 16;
    ctx.fillStyle = ctx.strokeStyle = '#fff9b0';
    draw(ctx);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const eyeMat = (tex) => new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
  const ell = (ctx, cx) => { ctx.beginPath(); ctx.ellipse(cx, 64, 30, 40, 0, 0, TAU); ctx.fill(); };
  const eyes = {
    idle: eyeMat(eyeTex((ctx) => { ell(ctx, 76); ell(ctx, 180); })),
    angry: eyeMat(eyeTex((ctx) => {
      ctx.save();
      ell(ctx, 76); ell(ctx, 180);
      ctx.globalCompositeOperation = 'destination-out';   // 눈 위쪽을 안쪽으로 비스듬히 잘라 화난 눈으로
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.moveTo(30, 6); ctx.lineTo(120, 62); ctx.lineTo(120, 0); ctx.lineTo(30, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(226, 6); ctx.lineTo(136, 62); ctx.lineTo(136, 0); ctx.lineTo(226, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    })),
    hurt: eyeMat(eyeTex((ctx) => {
      ctx.lineWidth = 15; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(48, 36); ctx.lineTo(100, 64); ctx.lineTo(48, 92); ctx.stroke();      // >
      ctx.beginPath(); ctx.moveTo(208, 36); ctx.lineTo(156, 64); ctx.lineTo(208, 92); ctx.stroke();    // <
    })),
  };

  // 체력바 (카메라를 향함)
  const barGeo = new THREE.PlaneGeometry(1, 1);
  const barBg = new THREE.MeshBasicMaterial({ color: 0x041204, transparent: true, opacity: 0.9, depthTest: false, fog: false });
  const barFg = new THREE.MeshBasicMaterial({ color: 0xff1111, depthTest: false, fog: false });

  SH = { bodyGeo, coreGeo, dropGeo, puddleGeo, eyeGeo, body, bodyHit, core, coreHit, drop, puddle, eyes, barGeo, barBg, barFg };
  return SH;
}

// 슬라임 하나 만들기. root(위치·방향) > squash(찌그러짐 적용) > 몸/핵/눈/물방울,  root > 웅덩이
function buildSlime() {
  const S = shared();
  const root = new THREE.Group();
  const squash = new THREE.Group();
  const body = new THREE.Mesh(S.bodyGeo, S.body); body.renderOrder = 2;
  const core = new THREE.Mesh(S.coreGeo, S.core); core.scale.set(0.66, 0.6, 0.66); core.position.y = 0.04;
  const eyes = new THREE.Mesh(S.eyeGeo, S.eyes.idle); eyes.position.set(0, 0.6, 0.9); eyes.rotation.x = -0.22; eyes.renderOrder = 3;
  const drops = [];
  for (let i = 0; i < 3; i++) { const d = new THREE.Mesh(S.dropGeo, S.drop); d.userData.a = (i / 3) * TAU + 0.6; d.userData.s = 0.6 + 0.5 * ((i * 37) % 10) / 10; drops.push(d); squash.add(d); }
  squash.add(body, core, eyes);
  squash.scale.setScalar(R0 * SLIME.SCALE);
  const puddle = new THREE.Mesh(S.puddleGeo, S.puddle); puddle.position.y = 0.02; puddle.scale.setScalar(R0 * SLIME.SCALE); puddle.renderOrder = 1;
  root.add(puddle, squash);
  root.rotation.order = 'YXZ';
  root.userData = { squash, body, core, eyes, drops, puddle };
  return root;
}

const fallCurve = (k) => k >= 1 ? 1 : k * k;   // 0 → 1 로 점점 빨라지며 녹아내림
const LOD_NEAR = 35, LOD_FAR = 45;   // 이 거리(m)보다 멀면 핵·물방울·눈 생략

// ================= 서버가 보낸 슬라임을 화면에 그리기 =================
export function createSlimeWorld({ scene, camera, T, WATER_LEVEL }) {
  const S = shared();
  const map = new Map();   // 슬라임 id -> 상태
  const BAR_W = 0.7, BAR_H = 0.08;
  const BASE = R0 * SLIME.SCALE;

  function makeBar() {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(S.barGeo, S.barBg); bg.scale.set(BAR_W + 0.04, BAR_H + 0.04, 1); bg.renderOrder = 998;
    const fg = new THREE.Mesh(S.barGeo, S.barFg); fg.scale.set(BAR_W, BAR_H, 1); fg.position.z = 0.001; fg.renderOrder = 999;
    g.add(bg, fg);
    g.userData.fg = fg;
    g.visible = false;
    return g;
  }

  function setHit(e, on) {
    if (e.hit === on) return;
    e.hit = on;
    const u = e.obj.userData;
    u.body.material = on ? S.bodyHit : S.body;
    u.core.material = on ? S.coreHit : S.core;
  }
  function setEyes(e, kind) {
    if (e.eyeKind === kind) return;
    e.eyeKind = kind;
    e.obj.userData.eyes.material = S.eyes[kind];
  }

  // 서버가 보낸 목록: [id, x, z, 바라보는 방향, mode, hp, 공격횟수]
  function onSnapshot(list) {
    const seen = new Set();
    for (const [id, x, z, ry, mode, hp, atkN] of list) {
      seen.add(id);
      let e = map.get(id);
      if (!e) {
        const obj = buildSlime();
        const bar = makeBar();
        scene.add(obj, bar);
        e = { obj, bar, x, z, ry, tx: x, tz: z, tr: ry, hp, atkN, mode, sp: 0, far: false, dying: false, dd: 0, t: Math.random() * 10, hop: Math.random() * TAU, atkT: -1, hurtT: 0, flash: 0, hit: false, eyeKind: 'idle' };
        map.set(id, e);
      }
      e.tx = x; e.tz = z; e.tr = ry;
      if (mode === 3) {   // 죽음: 녹아내리기 시작 (누워 있는 동안 서버가 계속 보내줌)
        if (!e.dying) { e.dying = true; e.dd = 0; e.atkT = -1; }
      } else if (e.dying) {   // 다시 살아남(리스폰)
        e.dying = false; e.dd = 0;
      }
      if (hp < e.hp && mode !== 3) { e.flash = 0.18; e.hurtT = 0.45; }   // 맞음 → 붉게 번쩍 + 아픈 눈
      if (atkN !== e.atkN) { e.atkT = 0; e.atkN = atkN; }                   // 공격 모션 시작
      e.mode = mode;
      e.hp = hp;
    }
    for (const [id, e] of map) {
      if (seen.has(id)) continue;
      scene.remove(e.obj, e.bar);   // 죽었거나 멀어짐 (모양·재질은 공유라 지우지 않음)
      map.delete(id);
    }
  }

  const ATK_T = 0.5;   // 공격 모션 길이(초)

  function update(dt) {
    const k = 1 - Math.exp(-12 * dt), kr = 1 - Math.exp(-10 * dt), ks = 1 - Math.exp(-8 * dt);
    for (const e of map.values()) {
      const ox = e.x, oz = e.z;
      if (Math.hypot(e.tx - e.x, e.tz - e.z) > 6) { e.x = e.tx; e.z = e.tz; }   // 순간이동(복귀)은 바로 이동
      else { e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; }
      e.ry += angDiff(e.ry, e.tr) * kr;
      const sp = dt > 0 ? Math.hypot(e.x - ox, e.z - oz) / dt : 0;
      e.sp += (Math.min(sp, 12) - e.sp) * ks;
      e.t += dt;

      const u = e.obj.userData;
      const y = Math.max(T.height(e.x, e.z), WATER_LEVEL - 0.8);
      e.obj.position.set(e.x, y, e.z);
      e.obj.rotation.y = e.ry;

      const cx = e.x - camera.position.x, cz = e.z - camera.position.z, d2 = cx * cx + cz * cz;
      const farNow = e.far ? d2 > LOD_NEAR * LOD_NEAR : d2 > LOD_FAR * LOD_FAR;
      if (farNow !== e.far) { e.far = farNow; u.core.visible = !farNow; u.eyes.visible = !farNow; for (const d of u.drops) d.visible = !farNow; }

      // ---- 찌그러짐(squash & stretch) 계산: sy = 세로, sxz = 가로, sz = 앞뒤 늘어남, lift = 들어올림, fwd = 앞으로 튀어나감 ----
      let sy = 1, sxz = 1, sz = 1, lift = 0, fwd = 0, pitch = 0;
      let eyes = 'idle';

      if (e.dying) {
        e.dd += dt;
        const f = fallCurve(e.dd / SLIME.DEATH_FALL);
        sy = 1 - 0.92 * f; sxz = 1 + 0.55 * f;
        u.eyes.visible = !e.far && f < 0.35;
        setHit(e, f < 0.5);
        u.puddle.scale.setScalar(BASE * (1 + 0.5 * f));
        e.bar.visible = false;
        for (const d of u.drops) d.visible = false;
      } else {
        u.eyes.visible = !e.far;
        for (const d of u.drops) d.visible = !e.far;   // (죽었다 살아난 뒤에도 다시 보이게)
        u.puddle.scale.setScalar(BASE);
        const breath = Math.sin(e.t * 2.2 + e.hop);
        const m = clamp(e.sp / 3, 0, 1);                 // 이동 중인 정도
        e.hop += dt * (3.5 + e.sp * 0.7);
        const hp1 = Math.abs(Math.sin(e.hop));
        sy = 1 + 0.05 * breath * (1 - m) + m * (0.1 * Math.sin(e.hop * 2));
        sxz = 1 / Math.sqrt(sy);   // 부피 유지: 세로가 줄면 가로가 늘어남
        sz = 1 + 0.18 * m;
        lift = m * 0.1 * hp1;
        pitch = m * 0.08;

        if (e.atkT >= 0) {   // 공격: 움츠림(0~35%) → 길게 튀어 오르며 내리침(35~100%)
          e.atkT += dt;
          const a = e.atkT / ATK_T;
          if (a >= 1) e.atkT = -1;
          else if (a < 0.35) { const c = a / 0.35; sy = 1 - 0.3 * c; sxz = 1 + 0.16 * c; }
          else { const c = (a - 0.35) / 0.65, s = Math.sin(c * Math.PI); sy = 0.7 + 0.75 * s; sxz = 1.16 - 0.3 * s; sz = 1 + 0.35 * s; lift = 0.5 * s; fwd = 0.5 * s; pitch = 0.35 * s; }
          eyes = 'angry';
        } else if (e.mode === 2) eyes = 'angry';
        else if (e.mode === 1) eyes = 'angry';

        if (e.hurtT > 0) {   // 맞으면 움찔하며 납작해졌다 돌아옴
          e.hurtT -= dt;
          const h = clamp(e.hurtT / 0.45, 0, 1);
          sy *= 1 - 0.22 * h; sxz *= 1 + 0.12 * h;
          eyes = 'hurt';
        }

        // 물방울: 몸 주변을 천천히 맴돌며 둥실둥실
        if (!e.far) for (const d of u.drops) {
          const a = d.userData.a + e.t * 0.5 * d.userData.s;
          const r = 1.15 + 0.15 * Math.sin(e.t * 1.7 + d.userData.a);
          d.position.set(Math.cos(a) * r, 0.5 + 0.35 * Math.sin(e.t * 1.3 * d.userData.s + d.userData.a * 2), Math.sin(a) * r);
          d.scale.setScalar(0.6 + 0.4 * d.userData.s);
        }

        // 체력바: 맞아서 체력이 줄었을 때만 머리 위에 표시 (카메라를 향함)
        const show = e.hp < SLIME.HP;
        e.bar.visible = show;
        if (show) {
          const ratio = Math.max(0, e.hp / SLIME.HP);
          e.bar.position.set(e.x, y + 1.25 * BASE + 0.3, e.z);
          e.bar.quaternion.copy(camera.quaternion);
          const fg = e.bar.userData.fg;
          fg.scale.x = BAR_W * ratio;
          fg.position.x = -BAR_W / 2 + (BAR_W * ratio) / 2;
        }
      }

      // 맞았을 때 잠깐 붉게
      if (!e.dying) {
        if (e.flash > 0) { e.flash -= dt; setHit(e, true); if (e.flash <= 0) setHit(e, false); }
        else setHit(e, false);
      }

      setEyes(e, eyes);
      u.squash.scale.set(BASE * sxz, BASE * sy, BASE * sxz * sz);
      u.squash.position.set(0, lift * SLIME.SCALE, fwd * SLIME.SCALE);
      u.squash.rotation.x = pitch;
    }
  }

  return { onSnapshot, update };
}
