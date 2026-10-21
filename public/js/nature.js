// 자연 오브젝트 키트 (THREE 연결부). 지형/청크 시스템과는 독립이며, 다음 단계에서 청크 생성/제거 훅에서 호출하면 됩니다.
//
//   import { createNatureKit } from './nature.js';
//   const kit = createNatureKit({ time: waterUniforms.uTime });         // 시간 uniform 공유(선택)
//   const vs  = kit.getVariants('tree_oak');                             // 변종 4개 (LOD0/LOD1 지오메트리)
//   const mesh = kit.createInstanced(vs[0], 64, /*lod 0~2*/ 0);              // 변종 1개 = InstancedMesh 1개 = 드로우콜 1개
//   kit.setInstance(mesh, 0, { x, y, z, yaw, scale }, kit.randomStyle('tree_oak', rand));
//   kit.commit(mesh, 1);  scene.add(mesh);
//   매 프레임: kit.update(dt)  (바람 시간)
//   청크 제거: kit.disposeInstanced(mesh)
import * as THREE from 'three';
import { SPECIES, SPECIES_IDS, FAMILIES, BIOMES, TEX_MEAN_LUM, buildSpecies, mulberry32, hashStr } from './nature-geo.js';
import { NAT_VERT_PARS, NAT_VERT_BEGIN, NAT_FRAG_PARS, NAT_FRAG_MAP, NAT_FRAG_COLOR } from './nature-shaders.js';

const lumOf = (t) => 0.299 * t[0] + 0.587 * t[1] + 0.114 * t[2];

export function createNatureKit(opts = {}) {
  const texPath = opts.texturePath || '/textures/';
  const loader = new THREE.TextureLoader();
  const ownTex = new Map(), extTex = opts.textures || {};
  // 전역 바람/시간 uniform (모든 자연 재질이 공유). opts.time 으로 기존 시간 uniform을 그대로 쓸 수 있음
  const U = { uTime: opts.time || { value: 0 }, uWind: { value: opts.wind ?? 1 }, uWindDir: { value: new THREE.Vector2(1, 0.4) }, uBright: { value: opts.brightness ?? 1 } };
  const external = !!opts.time;

  function tex(name) {
    if (extTex[name]) return extTex[name];                       // 이미 로드된 텍스처 재사용 → GPU 중복 없음
    if (!ownTex.has(name)) {
      const t = loader.load(texPath + name + '.jpg');
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = opts.anisotropy ?? 4;
      ownTex.set(name, t);
    }
    return ownTex.get(name);
  }

  // ----- 재질 (family 1개 = 재질 1개, 모든 변종/인스턴스가 공유) -----
  const mats = new Map();
  function material(fam) {
    if (mats.has(fam)) return mats.get(fam);
    const F = FAMILIES[fam];
    const uni = {
      uTexA: { value: tex(F.A.tex) }, uTexB: { value: tex(F.B.tex) },
      uTile: { value: new THREE.Vector4(F.A.tile[0], F.A.tile[1], F.B.tile[0], F.B.tile[1]) },
      uTintA: { value: new THREE.Vector3(...F.A.tint) }, uTintB: { value: new THREE.Vector3(...F.B.tint) },
      uMean: { value: new THREE.Vector2(TEX_MEAN_LUM[F.A.tex] * lumOf(F.A.tint), TEX_MEAN_LUM[F.B.tex] * lumOf(F.B.tint)) },
      uWindMul: { value: F.wind }, uAccGain: { value: F.acc ?? 2.4 },
      uTime: U.uTime, uWind: U.uWind, uWindDir: U.uWindDir, uBright: U.uBright,
    };
    // 거칠기: 0.8 이상은 Lambert(싸다), 미만은 Phong(반짝임). 바위/버섯 등 표면 느낌 조절용
    const common = { vertexColors: true, side: F.double ? THREE.DoubleSide : THREE.FrontSide };
    const m = F.rough >= 0.8
      ? new THREE.MeshLambertMaterial(common)
      : new THREE.MeshPhongMaterial({ ...common, shininess: 4 + (1 - F.rough) * 70, specular: new THREE.Color().setScalar((1 - F.rough) * 0.25) });
    m.name = 'nat_' + fam;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + NAT_VERT_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + NAT_VERT_BEGIN);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + NAT_FRAG_PARS)
        .replace('#include <map_fragment>', NAT_FRAG_MAP)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + NAT_FRAG_COLOR);
    };
    m.customProgramCacheKey = () => 'nat_v1_' + (F.rough >= 0.8 ? 'L' : 'P');
    mats.set(fam, m);
    return m;
  }

  // ----- 지오메트리 -----
  function toGeometry(d) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(d.color, 3));
    g.setAttribute('aNat', new THREE.BufferAttribute(d.nat, 3));
    g.setIndex(new THREE.BufferAttribute(d.index, 1));
    g.computeBoundingSphere();
    return g;
  }
  const variantCache = new Map();
  /** 종류 1개의 변종들. 각 변종: {id, index, family, lods:[LOD0,LOD1,LOD2 지오메트리], tris, height, radius, collRadius, colliders} */
  function getVariants(id, { count = 4, seed0 = 1 } = {}) {
    const key = id + ':' + count + ':' + seed0;
    if (variantCache.has(key)) return variantCache.get(key);
    const out = [];
    for (let i = 0; i < count; i++) {
      const ds = [0, 1, 2].map((l) => buildSpecies(id, seed0 + i, l)), d0 = ds[0];
      out.push({ id, index: i, family: d0.family, lods: ds.map(toGeometry), tris: ds.map((d) => d.triCount), colliders: d0.meta.colliders || null,
        height: d0.height, radius: d0.radius, collRadius: d0.meta.coll || 0, kind: d0.meta.kind, hang: !!d0.meta.hang });
    }
    variantCache.set(key, out);
    return out;
  }

  // ----- 인스턴싱 -----
  /** 변종 1개를 capacity개까지 그리는 InstancedMesh. 정점 버퍼는 변종끼리 공유, 인스턴스 속성만 mesh별. */
  function createInstanced(variant, capacity, lod = 0) {
    const src = variant.lods[lod], g = new THREE.BufferGeometry();
    for (const k of Object.keys(src.attributes)) g.setAttribute(k, src.attributes[k]);
    g.setIndex(src.index);
    g.boundingSphere = src.boundingSphere.clone();
    const A = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4), B = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    A.setUsage(THREE.DynamicDrawUsage); B.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aInstA', A); g.setAttribute('aInstB', B);
    const mesh = new THREE.InstancedMesh(g, material(variant.family), capacity);
    mesh.count = 0; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.nat = { id: variant.id, lod };
    return mesh;
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
  /** t: {x,y,z,yaw,scale,tilt,tiltAz}  style: {hue,sat,val,phase,accent:hex|[r,g,b](선형),accentAmt} */
  function setInstance(mesh, i, t, style = {}) {
    const sc = t.scale ?? 1;
    _e.set(t.tilt ? Math.sin(t.tiltAz || 0) * t.tilt : 0, t.yaw || 0, t.tilt ? Math.cos(t.tiltAz || 0) * t.tilt : 0, 'YXZ');
    _q.setFromEuler(_e); _p.set(t.x || 0, t.y || 0, t.z || 0); _s.set(sc, sc, sc);
    mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    const a = mesh.geometry.attributes.aInstA, b = mesh.geometry.attributes.aInstB;
    a.setXYZW(i, style.hue || 0, style.sat ?? 1, style.val ?? 1, style.phase ?? (i * 1.618) % 6.283);
    let r = 0, g = 0, bl = 0;
    if (style.accent !== undefined) { if (Array.isArray(style.accent)) [r, g, bl] = style.accent; else { _c.set(style.accent); r = _c.r; g = _c.g; bl = _c.b; } }
    b.setXYZW(i, r, g, bl, style.accentAmt || 0);
  }
  /** 인스턴스를 다 채운 뒤 호출: 개수 반영 + GPU 업로드 표시 + 컬링용 경계구 */
  function commit(mesh, count) {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.attributes.aInstA.needsUpdate = true; mesh.geometry.attributes.aInstB.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 1.5;      // 바람 흔들림 여유
  }
  /** 청크 제거 시. 정점 버퍼는 변종이 다시 올리므로 안전. */
  function disposeInstanced(mesh) { mesh.geometry.dispose(); mesh.dispose(); }

  // ----- 변화 샘플러 (색/크기) -----
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const rng = (r, [a, b]) => a + (b - a) * r();
  function randomStyle(id, rand = Math.random) {
    const st = SPECIES[id].style, s = { hue: rng(rand, st.hue), sat: rng(rand, st.sat), val: rng(rand, st.val), phase: rand() * 6.283, accentAmt: rng(rand, st.accent) };
    if (st.accents) s.accent = pick(rand, st.accents);
    return s;
  }
  const randomScale = (id, rand = Math.random) => rng(rand, SPECIES[id].scale);

  function update(dt) { if (!external) U.uTime.value += dt; }
  function setWind(strength, dirDeg) { U.uWind.value = strength; if (dirDeg !== undefined) U.uWindDir.value.set(Math.cos(dirDeg * Math.PI / 180), Math.sin(dirDeg * Math.PI / 180)); }
  function dispose() {
    for (const m of mats.values()) m.dispose();
    for (const t of ownTex.values()) t.dispose();
    for (const vs of variantCache.values()) for (const v of vs) v.lods.forEach((g) => g.dispose());
    mats.clear(); ownTex.clear(); variantCache.clear();
  }
  return { THREE, species: SPECIES, ids: SPECIES_IDS, biomes: BIOMES, families: FAMILIES, uniforms: U, material, getVariants, createInstanced, setInstance, commit, disposeInstanced, randomStyle, randomScale, update, setWind, dispose, mulberry32, hashStr };
}
