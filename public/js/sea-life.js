// 바닷속 해초 · 산호 (플레이어 주변에만 인스턴싱으로 깔아 줌)
// 사용: const sea = createSeaLife({ scene, T, WATER_LEVEL, seed });  매 프레임 sea.update(x, z, dt, 켜짐)
//  - 개수는 예전의 절반, 대신 산호가 군락(무리)으로 모여 자람 (배치 계산은 sea-gen.js)
//  - 산호 표면: 사진처럼 보이게 만든 텍스처(뇌산호·벌집산호·관스펀지·털뭉치 손가락산호·부채산호 그물·해초 잎)
//    를 군락/개체마다 색을 바꿔서 입힘. 바다에 처음 들어갈 때 한 번만 만들어서 시작 속도엔 영향 없음.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, makeLayout, genBrain, genHoney, genTube, genFinger, genNet, genBlade, mulberry } from './sea-gen.js';

const R = 11;            // 플레이어 주변 몇 칸까지 깔지
const KEEP = R + 4;      // 이 칸 수보다 멀어진 캐시는 지움
const MAXI = 1100;       // 종류별 최대 개수
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rng = mulberry;

// ---------- 모양 만들기 ----------
// 높이에 따라 아래는 어둡고 위는 밝게 (색은 인스턴스 색과 곱해짐). mul 로 통째로 어둡게도 가능
function shade(geo, height, lo = 0.5, mul = 1) {
  const p = geo.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const g = (lo + (1 - lo) * clamp(p.getY(i) / height, 0, 1)) * mul;
    c[i * 3] = g; c[i * 3 + 1] = g; c[i * 3 + 2] = g;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
// 여러 조각을 색칠(shade)해서 하나로 합침. 조각의 userData.mul 로 어둡게 할 수 있음
function merged(parts, height, lo) {
  for (const q of parts) shade(q, height, lo, q.userData.mul || 1);
  const g = mergeGeometries(parts);
  parts.forEach((q) => q.dispose());
  return g;
}
// 면마다 가장 알맞은 방향(위/옆)에서 텍스처를 붙임 (상자 투영). scale = 1 / 텍스처 한 장이 덮는 길이
function boxUV(geo, scale) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i + 2 < p.count; i += 3) {
    const ux = p.getX(i + 1) - p.getX(i), uy = p.getY(i + 1) - p.getY(i), uz = p.getZ(i + 1) - p.getZ(i);
    const vx = p.getX(i + 2) - p.getX(i), vy = p.getY(i + 2) - p.getY(i), vz = p.getZ(i + 2) - p.getZ(i);
    const nx = Math.abs(uy * vz - uz * vy), ny = Math.abs(uz * vx - ux * vz), nz = Math.abs(ux * vy - uy * vx);
    for (let j = 0; j < 3; j++) {
      const x = p.getX(i + j), y = p.getY(i + j), z = p.getZ(i + j);
      let a, b;
      if (ny >= nx && ny >= nz) { a = x; b = z; } else if (nx >= nz) { a = z; b = y; } else { a = x; b = y; }
      uv[(i + j) * 2] = a * scale; uv[(i + j) * 2 + 1] = b * scale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
const noUV = (g) => { g.deleteAttribute('uv'); return g; };
function smoothBlob(detail) {   // 이어붙은 둥근 덩어리(변형해서 쓰기 좋게 정점을 합침)
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  return mergeVertices(g);
}

// 해초 다발: 휘어진 리본 여러 장 (uv: 가로 0~1, 세로 0~1 = 잎 텍스처)
function clumpGeo(blades, segs, height) {
  const pos = [], uvs = [], idx = [];
  let base = 0;
  for (const b of blades) {
    const lx = Math.cos(b.a), lz = Math.sin(b.a), wx = -lz, wz = lx;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, y = b.h * t, ww = b.w * (1 - 0.82 * t), off = b.bend * t * t;
      const cx = b.ox + lx * off, cz = b.oz + lz * off;
      pos.push(cx - wx * ww / 2, y, cz - wz * ww / 2, cx + wx * ww / 2, y, cz + wz * ww / 2);
      uvs.push(0, t, 1, t);
    }
    for (let i = 0; i < segs; i++) { const a0 = base + i * 2; idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
    base += (segs + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
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
function stick(start, dir, len, r0, r1, seg = 8) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
  g.translate(start.x, start.y, start.z);
  return noUV(g);
}
function knob(pos, rad) {   // 가지 끝을 둥글게
  const g = new THREE.SphereGeometry(rad, 7, 5);
  g.translate(pos.x, pos.y, pos.z);
  return noUV(g);
}

function branchCoralGeo() {   // 가지산호 (털이 보송한 표면)
  const r = rng(37), parts = [];
  parts.push(stick(V3(0, 0, 0), V3(0, 1, 0), 0.5, 0.17, 0.12));
  const top = V3(0, 0.5, 0);
  parts.push(stick(top, V3(0, 1, 0), 0.7, 0.11, 0.06));
  parts.push(knob(V3(0, 1.2, 0), 0.062));
  for (let i = 0; i < 4; i++) {
    const az = (i / 4) * TAU + r() * 0.6, tilt = 0.5 + r() * 0.35;
    const d = V3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
    const len = 0.55 + r() * 0.3;
    parts.push(stick(top, d, len, 0.11, 0.07));
    const tip = top.clone().addScaledVector(d, len);
    for (let k = 0; k < 2; k++) {
      const az2 = az + (k ? 1 : -1) * (0.8 + r() * 0.5), t2 = 0.5 + r() * 0.4;
      const d2 = V3(Math.sin(t2) * Math.cos(az2) * 0.8 + d.x * 0.5, Math.cos(t2) * 0.6 + d.y * 0.6, Math.sin(t2) * Math.sin(az2) * 0.8 + d.z * 0.5);
      const l2 = 0.35 + r() * 0.2;
      parts.push(stick(tip, d2, l2, 0.065, 0.035, 6));
      parts.push(knob(tip.clone().addScaledVector(d2.clone().normalize(), l2), 0.04));
    }
  }
  return merged(parts, 1.9, 0.5);
}

function domeCoralGeo() {   // 주름진 반구 (뇌산호): 모양은 울퉁불퉁하게, 골은 텍스처가 담당
  const g = smoothBlob(2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let y = p.getY(i);
    if (y < 0) y = 0;
    const w = 1 + 0.07 * Math.sin(x * 6 + 1.3) * Math.sin(z * 5 - 0.4) + 0.04 * Math.sin(x * 13 + z * 3) * Math.sin(z * 11 - x * 2);
    p.setXYZ(i, x * w, y * 0.62 * w, z * w);
  }
  g.computeVertexNormals();
  return shade(g, 0.62, 0.55);
}

function tableCoralGeo() {   // 접시 모양 (벌집산호): 가장자리가 물결치고 위로 살짝 들린 접시
  const r = rng(61), ph1 = r() * TAU, ph2 = r() * TAU;
  const stalk = new THREE.CylinderGeometry(0.14, 0.24, 0.62, 8); stalk.translate(0, 0.31, 0);
  const plate = new THREE.CylinderGeometry(1.2, 0.8, 0.16, 22, 1); plate.translate(0, 0.66, 0);
  const p = plate.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rr = Math.hypot(x, z);
    if (rr > 0.01) {
      const a = Math.atan2(z, x), w = 1 + 0.12 * Math.sin(3 * a + ph1) + 0.07 * Math.sin(5 * a + ph2);
      x *= w; z *= w;
      if (y > 0.7) y += 0.16 * (rr / 1.2) * (rr / 1.2);   // 윗면 가장자리를 들어올려 접시처럼
    }
    p.setXYZ(i, x, y, z);
  }
  plate.computeVertexNormals();
  return merged([noUV(stalk), noUV(plate)], 0.9, 0.6);
}

function tubeCoralGeo() {   // 관 스펀지: 구멍 숭숭한 덩어리 + 입구가 뚫린 관 여러 개
  const r = rng(53), parts = [];
  const base = smoothBlob(1);
  const bp = base.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), z = bp.getZ(i);
    let y = bp.getY(i);
    if (y < 0) y = 0;
    const w = 1 + 0.12 * Math.sin(x * 5 + 2) * Math.sin(z * 4);
    bp.setXYZ(i, x * 0.7 * w, y * 0.42 * w, z * 0.7 * w);
  }
  base.computeVertexNormals();
  parts.push(base);
  for (let i = 0; i < 7; i++) {
    const a = r() * TAU, d = r() * 0.5, h = 0.35 + r() * 0.85, rad = 0.12 + r() * 0.07;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4));
    const pipe = noUV(new THREE.CylinderGeometry(rad * 1.12, rad * 0.9, h, 10, 1, true));   // 위가 살짝 벌어지고 뚜껑 없는 관
    pipe.translate(0, h / 2, 0);
    const hole = noUV(new THREE.CircleGeometry(rad * 0.95, 10));                           // 관 속 어두운 바닥
    hole.rotateX(-Math.PI / 2); hole.translate(0, h - 0.12, 0);
    hole.userData.mul = 0.1;
    for (const part of [pipe, hole]) { part.applyQuaternion(q); part.translate(Math.cos(a) * d, 0.08, Math.sin(a) * d); parts.push(part); }
  }
  return merged(parts, 1.5, 0.5);
}

function fanCoralGeo() {   // 부채 모양 (부채산호): 그물 텍스처에 알파로 구멍을 뚫음
  const stalk = new THREE.CylinderGeometry(0.06, 0.1, 0.5, 6); stalk.translate(0, 0.25, 0);
  stalk.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(stalk.attributes.position.count * 2), 2));   // 그물 텍스처에서 꽉 찬 모서리(0,0)
  const fan = new THREE.CircleGeometry(1, 20, 0, Math.PI); fan.translate(0, 0.45, 0);
  return merged([stalk, fan], 1.45, 0.45);
}

function fingerCoralGeo() {   // 통통한 손가락 여러 개가 뭉쳐서 자라는 산호 (털뭉치 표면)
  const r = rng(71), parts = [];
  const base = new THREE.SphereGeometry(0.55, 9, 5); base.scale(1, 0.35, 1);
  parts.push(noUV(base));
  for (let i = 0; i < 9; i++) {
    const a = r() * TAU, d = i === 0 ? 0 : 0.1 + r() * 0.4;
    const len = 0.4 + r() * 0.7, rad = 0.1 + r() * 0.05, lean = i === 0 ? 0.05 : 0.15 + r() * 0.4;
    const cap = noUV(new THREE.CapsuleGeometry(rad, len, 2, 7));
    cap.translate(0, (len + 2 * rad) / 2, 0);
    cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, V3(Math.sin(lean) * Math.cos(a), Math.cos(lean), Math.sin(lean) * Math.sin(a))));
    cap.translate(Math.cos(a) * d, 0.04, Math.sin(a) * d);
    parts.push(cap);
  }
  return merged(parts, 1.4, 0.5);
}

// ---------- 텍스처 / 재질 ----------
function dataTex(d, clampEdge = false) {
  const t = new THREE.DataTexture(d.data, d.w, d.h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = clampEdge ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// 산호 재질: 텍스처의 밝기(마루)는 인스턴스 색 그대로, 어두운 곳(골·구멍)은 색을 살짝 돌려서 어둡게 → 같은 텍스처로도 색이 다양하고 입체감이 남.
// 거기에 범프맵으로 울퉁불퉁한 빛 반응까지.
function coralMaterial(tex, bump) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: tex, bumpMap: tex, bumpScale: bump });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', '')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float mk = texture2D( map, vMapUv ).r;
        vec3 tn = diffuseColor.rgb;
        vec3 vall = mix( tn, tn.gbr, 0.38 ) * 0.4;
        diffuseColor.rgb = mix( vall, tn * 1.15, smoothstep( 0.12, 0.8, mk ) );
      }`);
  };
  m.customProgramCacheKey = () => 'sealife-coral2';
  return m;
}

// 종류 번호: 0 해초, 1 다시마(키 큰 해초), 2 가지산호, 3 뇌산호, 4 벌집·접시산호, 5 관스펀지, 6 부채산호, 7 손가락산호
export function createSeaLife({ scene, T, WATER_LEVEL, seed }) {
  const uTime = { value: 0 };
  const layout = makeLayout({ T, WATER_LEVEL, seed });
  const colCache = new Map();
  const colorOf = (hex) => { let c = colCache.get(hex); if (!c) { c = new THREE.Color(hex); colCache.set(hex, c); } return c; };

  let meshes = null;
  // 바다에 처음 들어갈 때 한 번만 만듦 (텍스처 만드는 데 0.3초쯤)
  function init() {
    const brainTex = dataTex(genBrain()), honeyTex = dataTex(genHoney()), tubeTex = dataTex(genTube()), fingerTex = dataTex(genFinger());
    const netTex = dataTex(genNet(), true), bladeTex = dataTex(genBlade(), true);

    const swayMat = (sway) => {
      const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: bladeTex });
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
    const fanMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: netTex, alphaTest: 0.4 });
    const BUMP = 2.5;

    const defs = [
      { geo: seaweedGeo(), mat: swayMat(0.035) },
      { geo: kelpGeo(), mat: swayMat(0.012) },
      { geo: boxUV(branchCoralGeo(), 1 / 0.55), mat: coralMaterial(fingerTex, BUMP) },
      { geo: boxUV(domeCoralGeo(), 1 / 1.0), mat: coralMaterial(brainTex, BUMP) },
      { geo: boxUV(tableCoralGeo(), 1 / 1.0), mat: coralMaterial(honeyTex, BUMP) },
      { geo: boxUV(tubeCoralGeo(), 1 / 1.0), mat: coralMaterial(tubeTex, BUMP) },
      { geo: fanCoralGeo(), mat: fanMat },
      { geo: boxUV(fingerCoralGeo(), 1 / 0.8), mat: coralMaterial(fingerTex, BUMP) },
    ];
    meshes = defs.map((d) => {
      const m = new THREE.InstancedMesh(d.geo, d.mat, MAXI);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.count = 0;
      m.frustumCulled = false;
      m.visible = false;
      scene.add(m);
      return m;
    });
  }

  const cache = new Map();   // "ix,iz" -> 심을 것 목록 (칸 번호만으로 항상 같게 sea-gen.js 가 만들어 줌)
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
        if (!cell) { cell = layout.genCell(ix, iz); cache.set(key, cell); }
        for (const it of cell) {
          const i = n[it.t];
          if (i >= MAXI) continue;
          qq.setFromAxisAngle(UP, it.ry);
          pp.set(it.x, it.y, it.z);
          ss.set(it.sx, it.sy, it.sx);
          m4.compose(pp, qq, ss);
          meshes[it.t].setMatrixAt(i, m4);
          meshes[it.t].setColorAt(i, colorOf(it.hex));
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
    if (!meshes) init();
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    if (!shown || cx !== lastCx || cz !== lastCz) {
      rebuild(cx, cz);
      lastCx = cx; lastCz = cz; shown = true;
    }
  }

  return { update };
}
