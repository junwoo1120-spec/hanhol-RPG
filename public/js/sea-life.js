// 바닷속 해초 · 산호 (플레이어 주변에만 인스턴싱으로 깔아 줌)
// 사용: const sea = createSeaLife({ scene, T, WATER_LEVEL, seed });  매 프레임 sea.update(x, z, dt, 켜짐)
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const CELL = 7;          // 한 칸 크기
const R = 11;            // 플레이어 주변 몇 칸까지 깔지
const KEEP = R + 4;      // 이 칸 수보다 멀어진 캐시는 지움
const MAXI = 1100;       // 종류별 최대 개수
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- 모양 만들기 ----------
function rng(seed) {   // 모양을 만들 때만 쓰는 간단한 난수 (매번 같은 모양)
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 높이에 따라 아래는 어둡고 위는 밝게 (색은 인스턴스 색과 곱해짐)
function shade(geo, height, lo = 0.5) {
  const p = geo.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const g = lo + (1 - lo) * clamp(p.getY(i) / height, 0, 1);
    c[i * 3] = g; c[i * 3 + 1] = g; c[i * 3 + 2] = g;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

// 해초 다발: 휘어진 리본 여러 장
function clumpGeo(blades, segs, height) {
  const pos = [], idx = [];
  let base = 0;
  for (const b of blades) {
    const lx = Math.cos(b.a), lz = Math.sin(b.a), wx = -lz, wz = lx;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, y = b.h * t, ww = b.w * (1 - 0.82 * t), off = b.bend * t * t;
      const cx = b.ox + lx * off, cz = b.oz + lz * off;
      pos.push(cx - wx * ww / 2, y, cz - wz * ww / 2, cx + wx * ww / 2, y, cz + wz * ww / 2);
    }
    for (let i = 0; i < segs; i++) { const a0 = base + i * 2; idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
    base += (segs + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return shade(g, height, 0.4);
}

function seaweedGeo() {
  const r = rng(11), blades = [];
  for (let i = 0; i < 6; i++) {
    blades.push({ ox: (r() - 0.5) * 0.5, oz: (r() - 0.5) * 0.5, h: 1.6 + r() * 1.2, w: 0.2 + r() * 0.1, a: r() * TAU, bend: (r() - 0.3) * 0.9 });
  }
  return clumpGeo(blades, 6, 2.8);
}

function kelpGeo() {
  const r = rng(23), blades = [];
  for (let i = 0; i < 3; i++) {
    blades.push({ ox: (r() - 0.5) * 0.4, oz: (r() - 0.5) * 0.4, h: 5 + r() * 2.5, w: 0.38 + r() * 0.15, a: r() * TAU, bend: (r() - 0.5) * 1.6 });
  }
  return clumpGeo(blades, 12, 7.5);
}

// start 에서 dir 방향으로 뻗는 가지 하나
function stick(start, dir, len, r0, r1, seg = 6) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
  g.translate(start.x, start.y, start.z);
  g.deleteAttribute('uv');
  return g;
}

function branchCoralGeo() {
  const r = rng(37), parts = [];
  parts.push(stick(V3(0, 0, 0), V3(0, 1, 0), 0.5, 0.17, 0.12));
  const top = V3(0, 0.5, 0);
  parts.push(stick(top, V3(0, 1, 0), 0.7, 0.11, 0.06));
  for (let i = 0; i < 4; i++) {
    const az = (i / 4) * TAU + r() * 0.6, tilt = 0.5 + r() * 0.35;
    const d = V3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
    const len = 0.55 + r() * 0.3;
    parts.push(stick(top, d, len, 0.11, 0.07));
    const tip = top.clone().addScaledVector(d, len);
    for (let k = 0; k < 2; k++) {
      const az2 = az + (k ? 1 : -1) * (0.8 + r() * 0.5), t2 = 0.5 + r() * 0.4;
      const d2 = V3(Math.sin(t2) * Math.cos(az2) * 0.8 + d.x * 0.5, Math.cos(t2) * 0.6 + d.y * 0.6, Math.sin(t2) * Math.sin(az2) * 0.8 + d.z * 0.5);
      parts.push(stick(tip, d2, 0.35 + r() * 0.2, 0.065, 0.035));
    }
  }
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return shade(g, 1.9, 0.5);
}

function domeCoralGeo() {   // 주름진 반구 (뇌산호)
  let g = new THREE.IcosahedronGeometry(1, 2);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < 0) y = 0;
    const w = 1 + 0.08 * Math.sin(x * 12 + z * 3) * Math.sin(z * 10 - x * 2);
    p.setXYZ(i, x * w, y * 0.62 * w, z * w);
  }
  g.computeVertexNormals();
  return shade(g, 0.62, 0.55);
}

function tableCoralGeo() {   // 접시 모양 (테이블산호)
  const stalk = new THREE.CylinderGeometry(0.14, 0.22, 0.62, 8); stalk.translate(0, 0.31, 0);
  const plate = new THREE.CylinderGeometry(1.2, 0.75, 0.14, 14); plate.translate(0, 0.66, 0);
  const rim = new THREE.CylinderGeometry(1.25, 1.2, 0.05, 14); rim.translate(0, 0.76, 0);
  [stalk, plate, rim].forEach((q) => q.deleteAttribute('uv'));
  const g = mergeGeometries([stalk, plate, rim]);
  [stalk, plate, rim].forEach((q) => q.dispose());
  return shade(g, 0.8, 0.6);
}

function tubeCoralGeo() {   // 파이프오르간처럼 여러 개의 관
  const r = rng(53), parts = [];
  for (let i = 0; i < 7; i++) {
    const a = r() * TAU, d = r() * 0.45, h = 0.5 + r() * 1.2, rad = 0.1 + r() * 0.07;
    const c = new THREE.CylinderGeometry(rad * 0.85, rad, h, 8);
    c.translate(Math.cos(a) * d, h / 2, Math.sin(a) * d);
    c.deleteAttribute('uv');
    parts.push(c);
  }
  const g = mergeGeometries(parts);
  parts.forEach((q) => q.dispose());
  return shade(g, 1.7, 0.5);
}

function fanCoralGeo() {   // 부채 모양 (부채산호)
  const stalk = new THREE.CylinderGeometry(0.06, 0.1, 0.5, 6); stalk.translate(0, 0.25, 0);
  const fan = new THREE.CircleGeometry(1, 16, 0, Math.PI); fan.translate(0, 0.45, 0);
  [stalk, fan].forEach((q) => q.deleteAttribute('uv'));
  const g = mergeGeometries([stalk, fan]);
  [stalk, fan].forEach((q) => q.dispose());
  return shade(g, 1.45, 0.45);
}

// ---------- 색 ----------
const PAL = {
  weed: [0x2fa84a, 0x4cc36a, 0x1f8a5a, 0x7ac143, 0x3fa7a0, 0x9acd32],
  kelp: [0x6b8e23, 0x8a9a3a, 0x3c7a4a, 0x8a7a30, 0x4f8f5f],
  coral: [0xff6f61, 0xff9a5c, 0xffd166, 0xf78fb3, 0xc77dff, 0x7be0d6, 0xff5d8f],
  fan: [0xc9366b, 0xa83ec9, 0xff7a3d, 0xe04a4a],
};

// 종류 번호: 0 해초, 1 다시마(키 큰 해초), 2 가지산호, 3 뇌산호, 4 테이블산호, 5 관산호, 6 부채산호
export function createSeaLife({ scene, T, WATER_LEVEL, seed }) {
  const uTime = { value: 0 };

  const swayMat = (sway) => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.uniforms.uSway = { value: sway };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSway;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        float swPh = uTime * 1.5 + instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23;
        float swA = position.y * position.y * uSway;
        transformed.x += sin(swPh + position.y * 0.8) * swA;
        transformed.z += cos(swPh * 0.83 + position.y * 0.6) * swA;`);
    };
    m.customProgramCacheKey = () => 'sealife-sway';
    return m;
  };
  const coralMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

  const defs = [
    { geo: seaweedGeo(), mat: swayMat(0.035), pal: PAL.weed },
    { geo: kelpGeo(), mat: swayMat(0.012), pal: PAL.kelp },
    { geo: branchCoralGeo(), mat: coralMat, pal: PAL.coral },
    { geo: domeCoralGeo(), mat: coralMat, pal: PAL.coral },
    { geo: tableCoralGeo(), mat: coralMat, pal: PAL.coral },
    { geo: tubeCoralGeo(), mat: coralMat, pal: PAL.coral },
    { geo: fanCoralGeo(), mat: coralMat, pal: PAL.fan },
  ];
  const meshes = defs.map((d) => {
    const m = new THREE.InstancedMesh(d.geo, d.mat, MAXI);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    m.count = 0;
    m.frustumCulled = false;
    m.visible = false;
    scene.add(m);
    return m;
  });
  const palCols = defs.map((d) => d.pal.map((h) => new THREE.Color(h)));

  // ---------- 칸마다 무엇을 어디에 심을지 (칸 번호만으로 항상 같게) ----------
  const s0 = Number(seed) | 0;
  const hash = (ix, iz, k) => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(k + 1, 2246822519) ^ Math.imul(s0, 982451653);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };

  const cache = new Map();   // "ix,iz" -> 심을 것 목록
  function genCell(ix, iz) {
    const out = [];
    const patch = hash(ix >> 2, iz >> 2, 77);          // 4x4칸 구역마다 밀도가 달라서 군락이 생김
    const dens = 0.18 + 0.82 * patch * patch;
    for (let k = 0; k < 3; k++) {
      if (hash(ix, iz, k * 7 + 1) > dens * 0.85) continue;
      const x = (ix + hash(ix, iz, k * 7 + 2)) * CELL, z = (iz + hash(ix, iz, k * 7 + 3)) * CELL;
      const h = T.height(x, z), depth = WATER_LEVEL - h;
      if (depth < 1.8 || depth > 70) continue;
      const a = hash(ix, iz, k * 7 + 4), b = hash(ix, iz, k * 7 + 5), c = hash(ix, iz, k * 7 + 6);
      let t;
      if (depth < 16) {                               // 얕은 곳: 산호 정원
        if (a < 0.5) t = 2 + Math.floor(b * 5);
        else t = 0;
      } else if (depth < 40) {                        // 중간: 해초 + 다시마 + 약간의 산호
        if (a < 0.22) t = [2, 5, 6][Math.floor(b * 3)];
        else t = a < 0.6 ? 0 : 1;
      } else {                                        // 깊은 곳: 다시마 위주
        t = a < 0.65 ? 1 : 0;
      }
      let sx, sy;
      if (t === 0) { sx = 0.8 + c * 0.6; sy = 0.7 + b * 1.0; }
      else if (t === 1) { sx = 0.8 + c * 0.5; sy = 0.8 + b * 0.7; }
      else { sx = sy = 0.8 + b * 1.2; if (t === 3) sy *= 0.9 + c * 0.5; }
      const pal = palCols[t];
      out.push({ t, x, y: h - 0.05, z, ry: hash(ix, iz, k * 7 + 4) * 97.3 % TAU, sx, sy, col: pal[Math.floor(c * pal.length) % pal.length] });
    }
    return out;
  }

  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), pp = new THREE.Vector3(), ss = new THREE.Vector3();
  let lastCx = 1e9, lastCz = 1e9, shown = false;

  function rebuild(cx, cz) {
    for (const key of cache.keys()) {
      const [kx, kz] = key.split(',').map(Number);
      if (Math.abs(kx - cx) > KEEP || Math.abs(kz - cz) > KEEP) cache.delete(key);
    }
    const n = new Array(meshes.length).fill(0);
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > R * R) continue;
        const ix = cx + dx, iz = cz + dz, key = ix + ',' + iz;
        let cell = cache.get(key);
        if (!cell) { cell = genCell(ix, iz); cache.set(key, cell); }
        for (const it of cell) {
          const i = n[it.t];
          if (i >= MAXI) continue;
          qq.setFromAxisAngle(UP, it.ry);
          pp.set(it.x, it.y, it.z);
          ss.set(it.sx, it.sy, it.sx);
          m4.compose(pp, qq, ss);
          meshes[it.t].setMatrixAt(i, m4);
          meshes[it.t].setColorAt(i, it.col);
          n[it.t] = i + 1;
        }
      }
    }
    meshes.forEach((m, i) => {
      m.count = n[i];
      m.visible = n[i] > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }

  function update(px, pz, dt, enabled) {
    uTime.value += dt;
    // 바다는 북쪽(-z)에 있어서 멀리 떨어져 있을 땐 아무것도 안 함
    if (!enabled || pz > -380) {
      if (shown) { meshes.forEach((m) => { m.visible = false; }); shown = false; lastCx = 1e9; }
      return;
    }
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    if (!shown || cx !== lastCx || cz !== lastCz) {
      rebuild(cx, cz);
      lastCx = cx; lastCz = cz; shown = true;
    }
  }

  return { update };
}
