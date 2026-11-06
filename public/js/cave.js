import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeCaveLayout, buildCaveArrays, bakeLight, PIT_R } from './cave-layout.mjs';
import { setNoNatureZone } from './nature-placement.js';

// ============================================================
// 동굴 (화면에 그리는 부분)
//  - 땅 위: 평원 한가운데 시커먼 구멍 + 돌 테두리 + 푸른 수정 + 하늘로 솟는 빛기둥 (멀리서도 보임)
//  - 땅 밑: 아주 깊은 곳(CAVE.Y)에 따로 있는 넓은 동굴. 바닥·벽·천장은 수정 빛을 꼭짓점 색에 미리 구워 넣어서
//    조명을 하나도 안 쓰고도 수정 가까이는 환하고 먼 곳은 어둡게 보여요 (렉 걱정 없음).
//  - 모양·충돌·수정 위치는 cave-layout.mjs (서버와 같은 파일)에서 와요.
// ============================================================

const DARK_BG = 0x010204;

export function createCave({ scene, T, ent, seed, WATER_LEVEL, id = 0 }) {
  const layout = makeCaveLayout(ent, seed, id);
  const tmp = [0, 0, 0];

  // ---------- 동굴 안 ----------
  const cave = new THREE.Group();
  cave.userData.keepInCave = true;   // 동굴 안에서 그릴 때 숨겨지지 않게 (main.js)
  cave.visible = false;

  // 바위(바닥·벽·천장)
  const A = buildCaveArrays(layout);
  const rockGeo = new THREE.BufferGeometry();
  rockGeo.setAttribute('position', new THREE.BufferAttribute(A.pos, 3));
  rockGeo.setAttribute('color', new THREE.BufferAttribute(A.col, 3));
  rockGeo.computeBoundingSphere();
  const rock = new THREE.Mesh(rockGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  rock.frustumCulled = false;
  cave.add(rock);

  // 구운 빛으로 칠한 저폴리 조각들 (기둥·종유석·석순)을 하나로 합침
  const decor = [];
  const hash = (a, b, c) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  function paint(geo, base) {   // 정점마다 구운 빛 색을 입힘
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, arr = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      bakeLight(layout, p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i), tmp);
      const v = 0.85 + 0.3 * hash(Math.round(p.getX(i) * 7), Math.round(p.getY(i) * 7), Math.round(p.getZ(i) * 7));
      arr[i * 3] = Math.min(1, base[0] * tmp[0] * 2.2 * v); arr[i * 3 + 1] = Math.min(1, base[1] * tmp[1] * 2.2 * v); arr[i * 3 + 2] = Math.min(1, base[2] * tmp[2] * 2.2 * v);
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); g.deleteAttribute('uv');
    return g;
  }
  function jitter(g, amt, s) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const kx = Math.round(p.getX(i) * 50), ky = Math.round(p.getY(i) * 50), kz = Math.round(p.getZ(i) * 50);
      p.setXYZ(i, p.getX(i) + (hash(kx, ky, kz + s) - 0.5) * amt, p.getY(i), p.getZ(i) + (hash(kz, kx, ky + s) - 0.5) * amt);
    }
  }
  // 돌기둥 (바닥에서 천장까지)
  for (const [i, pl] of layout.pillars.entries()) {
    if (pl.big) continue;   // 큰 수정 자리는 수정으로 채움
    const fy = layout.floorAt(pl.x, pl.z), cy = layout.ceilAt(pl.x, pl.z) + 1, h = cy - fy;
    const g = new THREE.CylinderGeometry(pl.r * 0.78, pl.r * 1.18, h, 7, 5, true).toNonIndexed();
    jitter(g, pl.r * 0.35, i);
    g.translate(pl.x, fy + h / 2, pl.z);
    decor.push(paint(g, [0.34, 0.35, 0.42]));
  }
  // 종유석(천장) / 석순(바닥)
  for (let k = 0; k < 90; k++) {
    const x = layout.bounds.x0 + hash(k, 1, 51) * (layout.bounds.x1 - layout.bounds.x0), z = layout.bounds.z0 + hash(k, 2, 51) * (layout.bounds.z1 - layout.bounds.z0);
    if (layout.sdf(x, z) > -3.5) continue;
    const r = 0.35 + hash(k, 3, 51) * 0.7, len = 1.4 + hash(k, 4, 51) * 3.8;
    if (k % 3 !== 0) {   // 종유석: 뾰족한 끝이 아래
      const top = layout.ceilAt(x, z) + 0.6;
      const g = new THREE.ConeGeometry(r, len, 5, 1).toNonIndexed(); g.rotateX(Math.PI); g.translate(x, top - len / 2, z);
      decor.push(paint(g, [0.36, 0.37, 0.45]));
    } else {   // 석순
      const g = new THREE.ConeGeometry(r * 0.8, len * 0.7, 5, 1).toNonIndexed(); g.translate(x, layout.floorAt(x, z) + len * 0.35 - 0.2, z);
      decor.push(paint(g, [0.3, 0.31, 0.38]));
    }
  }
  const decorMesh = new THREE.Mesh(mergeGeometries(decor, false), new THREE.MeshBasicMaterial({ vertexColors: true }));
  decorMesh.frustumCulled = false;
  cave.add(decorMesh);

  // ---------- 빛나는 수정 ----------
  function prism(bx, by, bz, lean, len, rad, col, bright) {
    const body = new THREE.CylinderGeometry(rad * 0.92, rad, len * 0.7, 6, 1).toNonIndexed();
    body.translate(0, len * 0.35, 0);
    const tip = new THREE.ConeGeometry(rad * 0.92, len * 0.34, 6, 1).toNonIndexed();
    tip.translate(0, len * 0.7 + len * 0.17, 0);
    const g = mergeGeometries([body, tip], false);
    g.rotateZ(lean[0]); g.rotateX(lean[1]);
    g.translate(bx, by, bz);
    const c = new THREE.Color(col), n = g.attributes.position.count, arr = new Float32Array(n * 3);
    const p = g.attributes.position;
    for (let i = 0; i < n; i++) {   // 끝으로 갈수록 더 하얗게 반짝이는 느낌
      const t = Math.min(1, Math.max(0, (p.getY(i) - by) / (len * 1.0)));
      const k = bright * (0.8 + 0.35 * t);
      arr[i * 3] = Math.min(1, c.r * k + 0.25 * t * t); arr[i * 3 + 1] = Math.min(1, c.g * k + 0.25 * t * t); arr[i * 3 + 2] = Math.min(1, c.b * k + 0.25 * t * t);
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); g.deleteAttribute('uv'); g.deleteAttribute('normal');
    return g;
  }
  const crystalGeos = [];
  for (const [ci, c] of layout.crystals.entries()) {
    const n = c.big ? 9 : 4 + Math.floor(hash(ci, 7, 61) * 3);
    for (let k = 0; k < n; k++) {
      const a = hash(ci, k, 62) * Math.PI * 2, rr = (c.big ? 1.3 : 0.5) * Math.sqrt(hash(ci, k, 63)) * c.size;
      const len = (0.9 + hash(ci, k, 64) * 1.6) * c.size * (k === 0 ? 1.5 : 1), rad = (0.13 + hash(ci, k, 65) * 0.12) * c.size;
      const lean = [(hash(ci, k, 66) - 0.5) * 0.7, (hash(ci, k, 67) - 0.5) * 0.7];
      crystalGeos.push(prism(c.x + Math.cos(a) * rr, c.y - 0.15, c.z + Math.sin(a) * rr, lean, len, rad, c.color, 0.85 + 0.3 * hash(ci, k, 68)));
    }
  }
  const crystalMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const crystalMesh = new THREE.Mesh(mergeGeometries(crystalGeos, false), crystalMat);
  crystalMesh.frustumCulled = false;
  cave.add(crystalMesh);

  // 수정 둘레 빛 번짐 (색별로 재질 하나씩)
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const ctx = cv.getContext('2d'), gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(cv);
  const sprMats = new Map();
  const sprites = [];
  const sprMat = (col) => {
    if (!sprMats.has(col)) sprMats.set(col, new THREE.SpriteMaterial({ map: glowTex, color: col, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    return sprMats.get(col);
  };
  for (const [ci, c] of layout.crystals.entries()) {
    const s = new THREE.Sprite(sprMat(c.color));
    const sz = (c.big ? 16 : 7.5) * c.size;
    s.scale.set(sz, sz, 1);
    s.position.set(c.x, c.y + 0.9 * c.size, c.z);
    s.userData.ph = hash(ci, 9, 71) * Math.PI * 2; s.userData.base = sz;
    cave.add(s); sprites.push(s);
  }

  // 출구 자리: 바닥의 푸른 빛 고리 + 둘레 작은 수정 3덩어리(cave-layout.mjs). 여기서 "동굴 나가기"
  const ex = layout.exit;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.6, 24).rotateX(-Math.PI / 2), ringMat);
  ring.position.set(ex.x, ex.y + 0.08, ex.z);
  cave.add(ring);
  const exSpr = new THREE.Sprite(sprMat(0x8fdcff)); exSpr.scale.set(9, 9, 1); exSpr.position.set(ex.x, ex.y + 1.2, ex.z); cave.add(exSpr);
  scene.add(cave);

  // ---------- 땅 위 입구: 큰 검은 구멍 + 돌 테두리 + 수정 (빛기둥 없음). 구멍 안으로 뛰어들면 동굴로 들어가요 ----------
  setNoNatureZone(ent.x, ent.z, PIT_R + 14);   // 구멍 둘레엔 나무·바위·풀을 놓지 않음
  const surface = new THREE.Group();
  let hMax = -1e9;
  for (let k = 0; k < 16; k++) hMax = Math.max(hMax, T.height(ent.x + Math.cos(k * Math.PI / 8) * PIT_R, ent.z + Math.sin(k * Math.PI / 8) * PIT_R));
  hMax = Math.max(hMax, T.height(ent.x, ent.z));
  const ey = Math.max(hMax, WATER_LEVEL + 0.5);
  const pit = new THREE.Mesh(new THREE.CircleGeometry(PIT_R, 36).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x010207, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  pit.position.set(ent.x, ey + 0.05, ent.z);
  surface.add(pit);
  // 구멍 가장자리 아래로 내려가는 어두운 벽 (구멍이 땅보다 높이 떠 보이지 않고 푹 파인 것처럼 보이게)
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(PIT_R, PIT_R * 0.97, 4.2, 36, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x0b0c12, side: THREE.DoubleSide }));
  skirt.position.set(ent.x, ey - 2.05, ent.z);
  surface.add(skirt);
  // 돌 테두리 (울퉁불퉁한 큰 바위 32개)
  const rocks = [];
  for (let k = 0; k < 32; k++) {
    const a = (k + hash(k, 1, 81) * 0.6) / 32 * Math.PI * 2, rr = PIT_R + 0.8 + hash(k, 2, 81) * 1.8, s = 1.6 + hash(k, 3, 81) * 1.7;
    const x = ent.x + Math.cos(a) * rr, z = ent.z + Math.sin(a) * rr;
    const g = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
    g.scale(s * (0.9 + hash(k, 4, 81) * 0.5), s * (0.55 + hash(k, 5, 81) * 0.4), s * (0.9 + hash(k, 6, 81) * 0.5));
    g.rotateY(hash(k, 7, 81) * 6.28);
    g.translate(x, T.height(x, z) + 0.15 * s, z);
    g.computeVertexNormals();
    const base = 0.36 + 0.14 * hash(k, 8, 81), arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) { const v = base * (0.85 + 0.3 * hash(i, k, 82)); arr[i * 3] = v; arr[i * 3 + 1] = v * 1.02; arr[i * 3 + 2] = v * 1.08; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); g.deleteAttribute('uv');
    rocks.push(g);
  }
  const rockMesh = new THREE.Mesh(mergeGeometries(rocks, false), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  surface.add(rockMesh);
  // 입구 수정 (테두리 사이사이에 8덩어리, 크게)
  const sCrystals = [];
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) / 8 * Math.PI * 2 + 0.4, rr = PIT_R + 1.4, x = ent.x + Math.cos(a) * rr, z = ent.z + Math.sin(a) * rr, y = T.height(x, z);
    const col = k % 2 ? layout.crystals[0].color : 0x7fb0ff;
    for (let m = 0; m < 5; m++) {
      sCrystals.push(prism(x + (hash(k, m, 83) - 0.5) * 1.8, y - 0.1, z + (hash(k, m, 84) - 0.5) * 1.8, [(hash(k, m, 85) - 0.5) * 0.6, (hash(k, m, 86) - 0.5) * 0.6], 1.6 + hash(k, m, 87) * 2.6, 0.26 + hash(k, m, 88) * 0.2, col, 1));
    }
    const sp = new THREE.Sprite(sprMat(col)); sp.scale.set(9, 9, 1); sp.position.set(x, y + 1.6, z); surface.add(sp); sprites.push(Object.assign(sp, { userData: { ph: k, base: 9 } }));
  }
  const sCrystalMesh = new THREE.Mesh(mergeGeometries(sCrystals, false), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  surface.add(sCrystalMesh);
  scene.add(surface);

  // 땅으로 나갈 때 서는 자리: 구멍 가장자리에서 마을 쪽으로 6칸 더 (구멍 안으로 다시 안 들어가게)
  const dl = Math.hypot(ent.x, ent.z) || 1, dx = -ent.x / dl, dz = -ent.z / dl;
  const ox = ent.x + dx * (PIT_R + 6), oz = ent.z + dz * (PIT_R + 6);
  // dive = 이 거리 안(구멍 안쪽)으로 들어오면 동굴로 떨어짐
  const entrance = { x: ent.x, y: ey, z: ent.z, r: PIT_R, dive: PIT_R * 0.85, out: { x: ox, y: T.height(ox, oz), z: oz, yaw: Math.atan2(-dx, -dz) } };

  let time = 0;
  // inCave: 동굴 안에 있는지. 안이면 동굴을 보이게, 밖이면 숨겨서 그리기 부담을 줄임
  function update(dt, inCave) {
    time += dt;
    cave.visible = !!inCave;
    if (inCave) {
      const k = 0.92 + 0.08 * Math.sin(time * 1.3);
      crystalMat.color.setRGB(k, k, k);
      ringMat.opacity = 0.34 + 0.1 * Math.sin(time * 2.2);
      exSpr.scale.setScalar(8.5 + 0.8 * Math.sin(time * 1.5));
    }
    for (const s of sprites) {
      const k = 1 + 0.08 * Math.sin(time * 1.6 + s.userData.ph);
      s.scale.set(s.userData.base * k, s.userData.base * k, 1);
    }
  }

  // 지금 서 있는 곳의 은은한 수정 빛 (캐릭터·골렘에 입힐 주변광 색)
  function ambientAt(x, y, z, out) {
    bakeLight(layout, x, y + 1.5, z, 0, 1, 0, tmp);
    out[0] = Math.min(1, tmp[0] * 1.3 + 0.02); out[1] = Math.min(1, tmp[1] * 1.3 + 0.02); out[2] = Math.min(1, tmp[2] * 1.3 + 0.035);
    return out;
  }

  return {
    layout, entrance, group: cave, surface, update, ambientAt,
    fogColor: DARK_BG, fogNear: 18, fogFar: 120,
  };
}
