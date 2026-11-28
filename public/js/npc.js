import * as THREE from 'three';
import { chiefParts, PIVOT, PARENT, GROUP_SCALE } from './npc-spec.mjs';

// ============================================================
// 마을 이장 NPC (3D 조립 + 가만히 서 있는 움직임)
//  - 모습(얼굴·머리카락·옷·지팡이)은 npc-spec.mjs 의 부품 목록. 여기서는 그걸 THREE 로 조립만 해요.
//  - 움직임: 숨쉬기(윗몸이 살짝 오르내림), 왼팔 살랑, 고개 흔들림, 눈 깜빡임,
//            가까이 오면 몸을 돌려 플레이어를 바라봄(멀어지면 원래 방향으로 돌아가요)
//  - 머리 위 표시: '!' (퀘스트를 줄 수 있음) / '?' (퀘스트를 끝낼 수 있음)
// 사용: const chief = createVillageChief({ scene, x, y, z, ry }); 매 프레임 chief.update(dt, me); chief.setMarker('!' | '?' | null)
// ============================================================

const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));
const wrapPi = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

function geometryOf(p) {
  const a = p.a;
  switch (p.s) {
    case 'sphere': return new THREE.SphereGeometry(a.r, 22, 15, a.phiStart || 0, a.phiLen === undefined ? Math.PI * 2 : a.phiLen, a.thetaStart || 0, a.thetaLen === undefined ? Math.PI : a.thetaLen);
    case 'box': return new THREE.BoxGeometry(a.w, a.h, a.d);
    case 'cyl': return new THREE.CylinderGeometry(a.rt, a.rb, a.h, 18, 1, !!a.open);
    case 'torus': return new THREE.TorusGeometry(a.R, a.r, 8, 24, a.arc === undefined ? Math.PI * 2 : a.arc);
    case 'lathe': return new THREE.LatheGeometry(a.pts.map(([r, y]) => new THREE.Vector2(r, y)), 28);
    default: return new THREE.BufferGeometry();
  }
}

// '!' / '?' 머리 위 표시 (캔버스 글씨를 판에 붙임)
function markerTexture(ch) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '900 104px "Galmuri11","Malgun Gothic",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 16;
  g.strokeStyle = '#3a2400';
  g.strokeText(ch, 64, 68);
  g.fillStyle = '#ffd24a';
  g.fillText(ch, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const CHIEF_SCALE = 1.34;   // 이장 크기 배율 (플레이어와 같은 키로 맞춤. 키를 바꾸려면 이 숫자만)
export function createVillageChief({ scene, x, y, z, ry = 0 }) {
  const root = new THREE.Group();
  root.position.set(x, y, z);
  root.rotation.y = ry;
  root.scale.setScalar(CHIEF_SCALE);   // 이장 키 = 플레이어 키(약 2.4m). 모델 높이 약 1.79 × 1.34 ≈ 2.4m
  scene.add(root);

  // 그룹(움직이는 부분) 만들기: 부품 좌표는 캐릭터 전체 기준이라서, 그룹 기준점을 빼서 넣어요
  const groups = { body: root };
  const pivotOf = (n) => (n === 'body' ? [0, 0, 0] : PIVOT[n]);
  for (const name of ['upper', 'head', 'armL', 'eyeL', 'eyeR']) {   // 부모가 먼저 만들어지는 순서
    const g = new THREE.Group();
    const par = PARENT[name] || 'body', pp = pivotOf(par), pv = PIVOT[name];
    g.position.set(pv[0] - pp[0], pv[1] - pp[1], pv[2] - pp[2]);
    if (GROUP_SCALE[name]) g.scale.setScalar(GROUP_SCALE[name]);
    groups[par].add(g);
    groups[name] = g;
  }
  const mats = new Map();
  const matOf = (c, dbl) => {
    const k = c + (dbl ? 'd' : 's');
    if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color: c, side: dbl ? THREE.DoubleSide : THREE.FrontSide }));
    return mats.get(k);
  };
  for (const p of chiefParts()) {
    const m = new THREE.Mesh(geometryOf(p), matOf(p.c, p.dbl));
    const pv = pivotOf(p.g);
    m.position.set(p.pos[0] - pv[0], p.pos[1] - pv[1], p.pos[2] - pv[2]);
    if (p.quat) m.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
    else if (p.rot) m.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
    if (p.sc) m.scale.set(p.sc[0], p.sc[1], p.sc[2]);
    groups[p.g].add(m);
  }

  // 머리 위 표시
  const markers = { '!': markerTexture('!'), '?': markerTexture('?') };
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: markers['!'], transparent: true, depthWrite: false }));
  sprite.scale.set(0.5, 0.5, 1);
  sprite.position.set(0, 2.12, 0);
  sprite.visible = false;
  root.add(sprite);
  let markerCh = null;

  const baseRy = ry;
  let t = Math.random() * 10, blinkIn = 2 + Math.random() * 2, blinking = 0;
  let bodyYaw = ry;

  return {
    group: root,
    x, z,
    setMarker(ch) {
      if (ch === markerCh) return;
      markerCh = ch;
      sprite.visible = !!ch;
      if (ch) sprite.material.map = markers[ch];
      sprite.material.needsUpdate = true;
    },
    // me = { x, z } 플레이어 위치. 가까우면 몸을 돌려 바라봐요
    update(dt, me) {
      dt = Math.min(Math.max(dt, 0), 0.1);
      t += dt;
      const dx = me.x - x, dz = me.z - z, dist = Math.hypot(dx, dz);
      const want = dist < 7 ? Math.atan2(dx, dz) : baseRy;
      bodyYaw += wrapPi(want - bodyYaw) * (1 - Math.exp(-4 * dt));
      root.rotation.y = bodyYaw;
      // 숨쉬기·살랑거림
      groups.upper.position.y = PIVOT.upper[1] + Math.sin(t * 1.7) * 0.003;
      groups.armL.rotation.x = Math.sin(t * 1.25) * 0.035;
      groups.armL.rotation.z = Math.sin(t * 0.9) * 0.02;
      groups.head.rotation.y = Math.sin(t * 0.55) * 0.1;
      groups.head.rotation.z = Math.sin(t * 0.37) * 0.03;
      groups.head.rotation.x = dist < 4.5 ? damp(groups.head.rotation.x, 0.06, 3, dt) : damp(groups.head.rotation.x, 0, 3, dt);   // 가까이 오면 살짝 고개를 숙여 내려다봄
      // 눈 깜빡임
      blinkIn -= dt;
      if (blinkIn <= 0) { blinking = 0.13; blinkIn = 2.5 + Math.random() * 3.5; }
      blinking = Math.max(0, blinking - dt);
      const ey = blinking > 0 ? 0.08 : 1;
      groups.eyeL.scale.y = ey;
      groups.eyeR.scale.y = ey;
      // 표시가 위아래로 통통
      if (sprite.visible) sprite.position.y = 2.12 + Math.sin(t * 3) * 0.05;
    },
  };
}
