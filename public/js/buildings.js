import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VILLAGE } from './terrain.js';
import { HOUSES, ROOM, INTERIOR, FLOOR_Y, INN2, DOORS, ROOMS, isDoorOpen, houseAt, roomLight, roomLightPos } from './village-layout.js';

// 시작마을 건물: 반목조(튜더식) 집 / 휘어진 지붕의 탑 / 4층 연립 건물 / 작은 오두막 / 여관
// 전부 코드로 만든 도형을 재질별로 합쳐서 그린다 (마을 전체가 드로우콜 십여 개).
// 건물 로컬 좌표: x = 오른쪽, y = 위, z = 앞쪽(문 쪽). 땅 높이 0.

// ---------- 텍스처 ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 회반죽/벽: 얼룩덜룩한 바탕
function mottled(base, seed, amount = 0.1, blobs = 520) {
  return canvasTex(256, (g, S) => {
    const r = rng(seed);
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    for (let i = 0; i < blobs; i++) {
      const x = r() * S, y = r() * S, rad = 2 + r() * 18, a = 0.02 + r() * amount;
      g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(40,50,70,${a})`;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        if (x + ox + rad < 0 || x + ox - rad > S || y + oy + rad < 0 || y + oy - rad > S) continue;
        g.beginPath(); g.arc(x + ox, y + oy, rad, 0, 6.2832); g.fill();
      }
    }
  });
}

// 나무: 세로 결
function woodTex(base, seed) {
  return canvasTex(128, (g, S) => {
    const r = rng(seed);
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${0.05 + r() * 0.12})` : `rgba(255,255,255,${0.02 + r() * 0.05})`;
      g.fillRect(r() * S, 0, 1 + r() * 3, S);
    }
  });
}

// 돌담: 벽돌 줄눈
function stoneTex(base, seed) {
  return canvasTex(256, (g, S) => {
    const r = rng(seed);
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    const rowH = 32;
    for (let row = 0; row < S / rowH; row++) {
      let x = (row % 2) * 24 - 24;
      while (x < S) {
        const w = 40 + r() * 36;
        g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${r() * 0.1})` : `rgba(0,0,0,${r() * 0.12})`;
        g.fillRect(x, row * rowH, w, rowH);
        g.fillStyle = 'rgba(30,25,20,0.45)';
        g.fillRect(x, row * rowH, 2, rowH);
        x += w;
      }
      g.fillStyle = 'rgba(30,25,20,0.45)';
      g.fillRect(0, row * rowH, S, 2);
    }
  });
}

// 기와: 가로 줄 + 비늘 모양
function roofTex(base, seed) {
  return canvasTex(256, (g, S) => {
    const r = rng(seed);
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    const rowH = 21, colW = 32;
    for (let row = 0; row * rowH < S + rowH; row++) {
      for (let col = -1; col * colW < S + colW; col++) {
        const x = col * colW + (row % 2) * (colW / 2), y = row * rowH;
        g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${r() * 0.08})` : `rgba(0,0,0,${r() * 0.14})`;
        g.fillRect(x, y, colW, rowH);
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
        g.beginPath(); g.arc(x + colW / 2, y, colW / 2 - 1, 0, Math.PI); g.stroke();
      }
    }
  });
}

// 러그: 붉은 바탕 + 테두리 + 마름모 무늬
function rugTex() {
  return canvasTex(128, (g, S) => {
    g.fillStyle = '#7b2f3b'; g.fillRect(0, 0, S, S);
    g.strokeStyle = '#e3c88a'; g.lineWidth = 6; g.strokeRect(8, 8, S - 16, S - 16);
    g.strokeStyle = '#2f3f66'; g.lineWidth = 4; g.strokeRect(20, 20, S - 40, S - 40);
    g.fillStyle = '#e3c88a';
    g.beginPath(); g.moveTo(S / 2, 34); g.lineTo(S - 34, S / 2); g.lineTo(S / 2, S - 34); g.lineTo(34, S / 2); g.closePath(); g.fill();
    g.fillStyle = '#2f3f66';
    g.beginPath(); g.moveTo(S / 2, 52); g.lineTo(S - 52, S / 2); g.lineTo(S / 2, S - 52); g.lineTo(52, S / 2); g.closePath(); g.fill();
  });
}

// 책장: 책등이 꽂힌 모습 (4단)
function booksTex() {
  const t = canvasTex(256, (g, S) => {
    const r = rng(77), cols = ['#8a2f3c', '#2f4a7d', '#3d6b4a', '#c79a3b', '#6a4a82', '#a3532f', '#d8d2c0', '#2c3140'];
    g.fillStyle = '#2a1e16'; g.fillRect(0, 0, S, S);
    const rowH = S / 4;
    for (let row = 0; row < 4; row++) {
      let x = 4;
      while (x < S - 6) {
        const w = 8 + r() * 12, h = rowH * (0.62 + r() * 0.3);
        g.fillStyle = cols[Math.floor(r() * cols.length)];
        g.fillRect(x, (row + 1) * rowH - 4 - h, w, h);
        g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 1, (row + 1) * rowH - 4 - h + 6, w - 2, 2);
        x += w + 1;
      }
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// 방 창문 밖에 보이는 풍경 (하늘 + 구름 + 먼 산 + 마을 지붕). 방 벽 바깥 멀리에 큰 판으로 세워 둠
function viewTex() {
  const t = canvasTex(512, (g, S) => {
    const r = rng(5);
    const sky = g.createLinearGradient(0, 0, 0, S);
    sky.addColorStop(0, '#5f9be0'); sky.addColorStop(0.55, '#a9d2f4'); sky.addColorStop(0.62, '#d9eefb'); sky.addColorStop(1, '#d9eefb');
    g.fillStyle = sky; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 9; i++) {
      const x = r() * S, y = 30 + r() * 150, w = 60 + r() * 90;
      for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(x + k * w * 0.2, y + (k % 2) * 6, w * 0.22, w * 0.11, 0, 0, 6.2832); g.fill(); }
    }
    const ridge = (base, amp, col, seed) => {
      const rr = rng(seed); g.fillStyle = col; g.beginPath(); g.moveTo(0, S);
      let y = base;
      for (let x = 0; x <= S; x += 16) { y = base + Math.sin(x * 0.012 + seed) * amp + (rr() - 0.5) * amp * 0.5; g.lineTo(x, y); }
      g.lineTo(S, S); g.closePath(); g.fill();
    };
    ridge(S * 0.58, 30, '#7da1b8', 1); ridge(S * 0.66, 22, '#5f8d6a', 2); ridge(S * 0.76, 14, '#4a7a4c', 3);
    for (let i = 0; i < 12; i++) {                      // 먼 마을 집들
      const x = 20 + r() * (S - 40), y = S * 0.76 + r() * 30, w = 14 + r() * 14;
      g.fillStyle = '#d8d2c2'; g.fillRect(x, y, w, w * 0.7);
      g.fillStyle = r() < 0.5 ? '#8d3142' : '#26395b';
      g.beginPath(); g.moveTo(x - 3, y); g.lineTo(x + w / 2, y - w * 0.55); g.lineTo(x + w + 3, y); g.closePath(); g.fill();
    }
    g.fillStyle = '#5c8f49'; g.fillRect(0, S * 0.88, S, S * 0.12);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function signTex() {
  const t = canvasTex(256, (g, S) => {
    g.fillStyle = '#5a3a22'; g.fillRect(0, 0, S, S);
    g.strokeStyle = '#d9a441'; g.lineWidth = 10; g.strokeRect(10, 10, S - 20, S - 20);
    g.fillStyle = '#f6d98a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 118px "Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
    g.fillText('여관', S / 2, S * 0.42);
    g.font = 'bold 54px Georgia,serif';
    g.fillText('I N N', S / 2, S * 0.78);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------- 재질 ----------
const DS = { side: THREE.DoubleSide };
const lam = (map, extra = {}) => new THREE.MeshLambertMaterial({ map, ...extra });
const MAT = {
  plaster: lam(mottled('#d7dae2', 11, 0.10)),          // 차가운 회백색 회반죽
  plasterWarm: lam(mottled('#cfc2a6', 12, 0.12)),      // 1층용 베이지
  navy: lam(mottled('#2a3855', 13, 0.08)),             // 탑의 남색 벽
  stone: lam(stoneTex('#9d9482', 14)),
  timber: lam(woodTex('#4b392c', 15)),                 // 갈색 뼈대
  timberBlue: lam(woodTex('#27364f', 16)),             // 남색 뼈대
  doorWood: lam(woodTex('#3b2b22', 17)),
  roofRed: lam(roofTex('#8d3142', 18), DS),
  roofNavy: lam(roofTex('#26395b', 19), DS),
  roofBrown: lam(roofTex('#8c5f37', 20), DS),
  frame: new THREE.MeshLambertMaterial({ color: 0x2b3b55 }),
  iron: new THREE.MeshLambertMaterial({ color: 0x26262c }),
  glow: new THREE.MeshBasicMaterial({ color: 0xffeb9c }),   // 불 켜진 창
  dark: new THREE.MeshBasicMaterial({ color: 0x111a33 }),   // 꺼진 창
  lamp: new THREE.MeshBasicMaterial({ color: 0xffd45e }),
  sign: lam(signTex()),
  // 실내
  floor: lam(woodTex('#8c6c4a', 21)),
  timberLight: lam(woodTex('#7b5b3b', 22)),
  rug: lam(rugTex()),
  books: lam(booksTex()),
  clothR: new THREE.MeshLambertMaterial({ color: 0x8d2f3f }),
  clothB: new THREE.MeshLambertMaterial({ color: 0x2f4a7d }),
  linen: new THREE.MeshLambertMaterial({ color: 0xe8e2d2 }),
  candle: new THREE.MeshLambertMaterial({ color: 0xf2ead2 }),
  ceramic: new THREE.MeshLambertMaterial({ color: 0xe9e1cf }),
  mug: new THREE.MeshLambertMaterial({ color: 0x8a5a38 }),
  glassG: new THREE.MeshLambertMaterial({ color: 0x2f6b4a }),
  glassA: new THREE.MeshLambertMaterial({ color: 0xb9782b }),
  flame: new THREE.MeshBasicMaterial({ color: 0xffc04d }),
  fire: new THREE.MeshBasicMaterial({ color: 0xff6a1f }),
  sky: new THREE.MeshBasicMaterial({ color: 0xbfdcff }),     // 안쪽에서 본 창 (낮 하늘색)
  black: new THREE.MeshBasicMaterial({ color: 0x000000 }),   // 문을 열면 보이는 어둠 (집 들어가기 전)
  view: new THREE.MeshBasicMaterial({ map: viewTex(), fog: false }),   // 방 창문 밖 풍경
};
const TILE = { floor: 4, timberLight: 3, plaster: 6, plasterWarm: 6, navy: 6, stone: 4, timber: 3, timberBlue: 3, doorWood: 2, roofRed: 4, roofNavy: 4, roofBrown: 4 };

// ---------- 도형 모으기 ----------
function boxGeo(w, h, d, tile) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tile) {   // 면 크기에 맞춰 UV를 늘려서 텍스처 크기가 일정하게 보이게 함
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  return g;
}

class Batch {
  constructor() { this.parts = {}; this.stack = [new THREE.Matrix4()]; this.doors = []; this.houseIdx = -1; }
  get m() { return this.stack[this.stack.length - 1]; }
  push(x = 0, y = 0, z = 0, ry = 0, rz = 0, rx = 0, s = 1) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
      new THREE.Vector3(s, s, s));
    this.stack.push(this.m.clone().multiply(m));
    return this;
  }
  pop() { this.stack.pop(); return this; }
  geo(key, g, x = 0, y = 0, z = 0, ry = 0, rz = 0, rx = 0, uvScale = null) {
    g = g.index ? g.toNonIndexed() : g.clone();
    if (uvScale) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale[0], uv.getY(i) * uvScale[1]);
    }
    this.push(x, y, z, ry, rz, rx);
    g.applyMatrix4(this.m);
    this.pop();
    (this.parts[key] ||= []).push(g);
  }
  box(key, w, h, d, x, y, z, ry = 0, rz = 0, rx = 0) {
    this.geo(key, boxGeo(w, h, d, TILE[key]), x, y, z, ry, rz, rx);
  }
  finish() {
    const group = new THREE.Group();
    for (const key of Object.keys(this.parts)) {
      const merged = mergeGeometries(this.parts[key], false);
      if (!merged) { console.warn('건물 도형 합치기 실패:', key); continue; }
      group.add(new THREE.Mesh(merged, MAT[key]));
    }
    return group;
  }
}

// ---------- 공용 부품 ----------
// 끝이 뾰족한 아치 모양 (고딕 창/문). 바닥 중앙이 원점, 위로 h
function archShape(w, h) {
  const s = new THREE.Shape(), hw = w / 2, sh = h * 0.62;
  s.moveTo(-hw, 0); s.lineTo(hw, 0); s.lineTo(hw, sh);
  s.quadraticCurveTo(hw, sh + (h - sh) * 0.75, 0, h);
  s.quadraticCurveTo(-hw, sh + (h - sh) * 0.75, -hw, sh);
  s.lineTo(-hw, 0);
  return s;
}
const archExtrude = (w, h, depth) => new THREE.ExtrudeGeometry(archShape(w, h), { depth, bevelEnabled: false, curveSegments: 6 });
const archFlat = (w, h) => new THREE.ShapeGeometry(archShape(w, h), 6);

// 고딕 창: 세로 창살 3줄 + 가로대. v = 창 아래쪽 높이
function gothic(b, u, v, w, h, lit, z0 = 0.25, see = false) {
  if (see) {   // 벽에 구멍이 뚫린 창: 틀 가운데도 비워서 안에서 밖이 보이게
    const outer = archAt(u, v - 0.25, w + 0.55, h + 0.5);
    outer.holes.push(archAt(u, v, w, h));
    b.geo('frame', new THREE.ExtrudeGeometry(outer, { depth: 0.22, bevelEnabled: false, curveSegments: 6 }), 0, 0, z0);
  } else b.geo('frame', archExtrude(w + 0.55, h + 0.5, 0.22), u, v - 0.25, z0);
  b.geo(lit ? 'glow' : 'dark', archFlat(w, h), u, v, z0 + 0.23);
  const t = 0.07, zb = z0 + 0.26;
  for (const dx of [-w / 6, w / 6]) b.box('frame', t, h * 0.6, 0.05, u + dx, v + h * 0.3, zb);
  b.box('frame', t, h * 0.92, 0.05, u, v + h * 0.46, zb);
  b.box('frame', w, t, 0.05, u, v + h * 0.38, zb);
  b.box('frame', w, t, 0.05, u, v + h * 0.62, zb);
  b.box('stone', w + 0.9, 0.18, 0.5, u, v - 0.38, z0 + 0.1);
}

// 네모 창: 십자 창살 (2x2 칸)
function sqWin(b, u, v, w, h, lit, z0 = 0.25, see = false) {
  if (see) {
    b.box('frame', 0.25, h + 0.5, 0.22, u - w / 2 - 0.125, v + h / 2, z0 + 0.11);
    b.box('frame', 0.25, h + 0.5, 0.22, u + w / 2 + 0.125, v + h / 2, z0 + 0.11);
    b.box('frame', w, 0.25, 0.22, u, v - 0.125, z0 + 0.11);
    b.box('frame', w, 0.25, 0.22, u, v + h + 0.125, z0 + 0.11);
  } else b.box('frame', w + 0.5, h + 0.5, 0.22, u, v + h / 2, z0 + 0.11);
  // see: 유리를 바깥쪽에서만 보이는 한 장짜리 판으로 → 안에서는 투명하게 밖이 보임
  if (see) b.geo(lit ? 'glow' : 'dark', new THREE.PlaneGeometry(w, h), u, v + h / 2, z0 + 0.24);
  else b.box(lit ? 'glow' : 'dark', w, h, 0.05, u, v + h / 2, z0 + 0.24);
  b.box('frame', 0.09, h, 0.06, u, v + h / 2, z0 + 0.28);
  b.box('frame', w, 0.09, 0.06, u, v + h / 2, z0 + 0.28);
  b.box('stone', w + 0.8, 0.16, 0.45, u, v - 0.3, z0 + 0.12);
}

// 장식용 아치형 나무문 (열리지 않음)
function doorStatic(b, u, w, h, dbl = false, z0 = 0.25) {
  b.geo('stone', archExtrude(w + 0.9, h + 0.55, 0.3), u, 0, z0);
  b.geo('doorWood', archExtrude(w, h, 0.22), u, 0, z0 + 0.2);
  const zf = z0 + 0.45;
  b.box('iron', w * 0.95, 0.12, 0.05, u, h * 0.28, zf);
  b.box('iron', w * 0.95, 0.12, 0.05, u, h * 0.62, zf);
  if (dbl) b.box('iron', 0.08, h * 0.75, 0.05, u, h * 0.38, zf);
  b.box('stone', w + 1.4, 0.25, 0.9, u, 0.12, z0 + 0.4);
}

// 사선 버팀목 (벽면 u-v 평면)
function brace(b, key, u1, v1, u2, v2, z, th = 0.3) {
  const L = Math.hypot(u2 - u1, v2 - v1), ang = Math.atan2(v2 - v1, u2 - u1);
  b.box(key, L, 0.26, th, (u1 + u2) / 2, (v1 + v2) / 2, z, 0, ang);
}

// 위치/크기를 지정한 아치 (원점 = 바닥 중앙을 ox,y0 만큼 옮김)
function archAt(ox, y0, w, h) {
  const s = new THREE.Shape(), hw = w / 2, sh = h * 0.62, c = sh + (h - sh) * 0.75;
  s.moveTo(ox - hw, y0); s.lineTo(ox + hw, y0); s.lineTo(ox + hw, y0 + sh);
  s.quadraticCurveTo(ox + hw, y0 + c, ox, y0 + h);
  s.quadraticCurveTo(ox - hw, y0 + c, ox - hw, y0 + sh);
  s.lineTo(ox - hw, y0);
  return s;
}
function rectAt(ox, y0, w, h) {
  const s = new THREE.Shape();
  s.moveTo(ox - w / 2, y0); s.lineTo(ox + w / 2, y0); s.lineTo(ox + w / 2, y0 + h); s.lineTo(ox - w / 2, y0 + h); s.lineTo(ox - w / 2, y0);
  return s;
}

// 문짝 모양 (경첩이 원점, +x 쪽으로 뻗음). half = 'L'/'R' 이면 양문의 절반
function leafShape(lw, h, half) {
  const s = new THREE.Shape(), sh = h * 0.62, c = sh + (h - sh) * 0.75;
  if (!half) {
    s.moveTo(0, 0); s.lineTo(lw, 0); s.lineTo(lw, sh);
    s.quadraticCurveTo(lw, c, lw / 2, h); s.quadraticCurveTo(0, c, 0, sh); s.lineTo(0, 0);
  } else if (half === 'L') {          // 왼쪽 문짝: 경첩이 바깥(왼쪽), 가운데(+x)가 가장 높음
    s.moveTo(0, 0); s.lineTo(lw, 0); s.lineTo(lw, h); s.quadraticCurveTo(0, c, 0, sh); s.lineTo(0, 0);
  } else {                            // 오른쪽 문짝: 경첩이 바깥(오른쪽), 가운데(-x)가 가장 높음
    s.moveTo(0, 0); s.lineTo(-lw, 0); s.lineTo(-lw, h); s.quadraticCurveTo(0, c, 0, sh); s.lineTo(0, 0);
  }
  return s;
}

// 열리는 문짝 하나를 만들어서 기록해 둔다. 경첩 위치(u) 와 방향(dir=+1: +x로 뻗음). outward 면 바깥쪽으로 열림
function addLeaf(b, doorId, hingeU, lw, h, half, dir, outward) {
  const lb = new Batch();
  const geo = new THREE.ExtrudeGeometry(leafShape(lw, h, half), { depth: 0.16, bevelEnabled: false, curveSegments: 6 });
  lb.geo('doorWood', geo, 0, 0, 0, 0, 0, 0, [0.5, 0.5]);
  const x0 = dir > 0 ? 0 : -lw;
  for (const f of [0.28, 0.62]) {                          // 쇠 띠 (앞/뒤)
    lb.box('iron', lw * 0.96, 0.12, 0.05, x0 + lw / 2, h * f, 0.18);
    lb.box('iron', lw * 0.96, 0.12, 0.05, x0 + lw / 2, h * f, -0.02);
  }
  const hx = dir > 0 ? lw - 0.22 : -lw + 0.22;             // 손잡이 (문 가운데 쪽)
  lb.box('iron', 0.1, 0.1, 0.12, hx, h * 0.42, 0.24);
  lb.box('iron', 0.1, 0.1, 0.12, hx, h * 0.42, -0.08);
  b.push(hingeU, 0.03, -0.08);
  // 안쪽으로 열리면 +각도(경첩에서 +x로 뻗은 문짝이 -z 쪽으로), 바깥으로 열리면 반대
  b.doors.push({ door: doorId, matrix: b.m.clone(), leaf: lb.finish(), sign: (dir > 0 ? 1 : -1) * (outward ? -1 : 1), outward: !!outward });
  b.pop();
}

// 열리는 문: 벽에 아치 구멍은 timberWall 이 뚫고, 여기서는 돌 문틀 + 문짝(+ 검은 안쪽)을 만든다
function liveDoor(b, D) {
  const outer = archAt(D.u, -0.3, D.w + 0.9, D.h + 0.85);
  outer.holes.push(archAt(D.u, 0.02, D.w, D.h));
  b.geo('stone', new THREE.ExtrudeGeometry(outer, { depth: 0.3, bevelEnabled: false, curveSegments: 6 }), 0, 0, 0.25, 0, 0, 0, [0.25, 0.25]);
  b.box('stone', D.w + 1.3, 0.08, 0.8, D.u, 0.04, 0.7);   // 문턱 돌
  if (D.black) b.geo('black', new THREE.ShapeGeometry(archAt(D.u, 0.02, D.w, D.h), 6), 0, 0, -0.12);   // 문을 열면 보이는 어둠
  const lw = D.w - 0.06, h = D.h - 0.05;
  if (D.double) {
    addLeaf(b, D.id, D.u - lw / 2, lw / 2, h, 'L', +1, D.outward);
    addLeaf(b, D.id, D.u + lw / 2, lw / 2, h, 'R', -1, D.outward);
  } else addLeaf(b, D.id, D.u - lw / 2, lw, h, null, +1, D.outward);
}

// 안쪽에서 본 창 (벽 안쪽 면에 붙임). 벽에 구멍이 뚫려 있으면 창틀과 창살만 보이고 그 너머로 밖이 보임
function inWin(b, win, holed = false) {
  b.push(0, 0, -0.25, Math.PI);
  const u = -win.u, v = win.v;
  if (holed) {   // 속이 빈 틀 (가운데로 밖이 보임)
    const outer = win.kind === 'g' ? archAt(u, v - 0.15, win.w + 0.4, win.h + 0.35) : rectAt(u, v - 0.2, win.w + 0.4, win.h + 0.4);
    outer.holes.push(win.kind === 'g' ? archAt(u, v, win.w, win.h) : rectAt(u, v, win.w, win.h));
    b.geo('frame', new THREE.ExtrudeGeometry(outer, { depth: 0.1, bevelEnabled: false, curveSegments: 6 }), 0, 0, 0);
  }
  if (win.kind === 'g') {
    if (!holed) {
      b.geo('frame', archExtrude(win.w + 0.4, win.h + 0.35, 0.1), u, v - 0.15, 0);
      b.geo('sky', archFlat(win.w, win.h), u, v, 0.11);
    }
    for (const dx of [-win.w / 6, win.w / 6]) b.box('frame', 0.06, win.h * 0.6, 0.04, u + dx, v + win.h * 0.3, 0.14);
    b.box('frame', 0.06, win.h * 0.92, 0.04, u, v + win.h * 0.46, 0.14);
    b.box('frame', win.w, 0.06, 0.04, u, v + win.h * 0.38, 0.14);
  } else {
    if (!holed) {
      b.box('frame', win.w + 0.4, win.h + 0.4, 0.1, u, v + win.h / 2, 0.05);
      b.box('sky', win.w, win.h, 0.04, u, v + win.h / 2, 0.11);
    }
    b.box('frame', 0.08, win.h, 0.04, u, v + win.h / 2, 0.14);
    b.box('frame', win.w, 0.08, 0.04, u, v + win.h / 2, 0.14);
  }
  b.box('timberLight', win.w + 0.7, 0.1, 0.35, u, v - 0.2, 0.17);
  b.pop();
}

// 반목조 벽 한 면. 벽 면은 z=0 평면, 바깥쪽이 +z, 아래가 v=0.
// o: w, h, panel(벽 재질), beam(뼈대 재질), nx(세로 칸 수), rows(가로 보 높이들), braces, wins,
//    door / doors(열리는 문: 벽에 아치 구멍), see(창에도 구멍을 뚫어 안에서 밖이 보이게)
function timberWall(b, o) {
  const { w, h } = o, BW = 0.34, BZ = 0.2, BT = 0.34, nx = o.nx || 1;
  const doors = (o.doors || (o.door ? [o.door] : [])).filter(d => d.live);
  const holes = [], wins = o.wins || [];
  for (const D of doors) holes.push(archAt(D.u, 0.02, D.w, D.h));
  if (o.see) for (const win of wins) holes.push(win.kind === 'g' ? archAt(win.u, win.v, win.w, win.h) : rectAt(win.u, win.v, win.w, win.h));
  if (holes.length) {
    const y0 = doors.length ? -0.3 : 0, sh = new THREE.Shape();
    sh.moveTo(-w / 2, y0); sh.lineTo(w / 2, y0); sh.lineTo(w / 2, h); sh.lineTo(-w / 2, h); sh.lineTo(-w / 2, y0);
    sh.holes.push(...holes);
    const t = TILE[o.panel] || 6;
    b.geo(o.panel, new THREE.ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: false, curveSegments: 6 }), 0, 0, -0.25, 0, 0, 0, [1 / t, 1 / t]);
  } else b.box(o.panel, w, h, 0.5, 0, h / 2, 0);
  // 아래 보: 문 자리는 비움
  const gaps = doors.map(D => [D.u - (D.w / 2 + 0.45), D.u + (D.w / 2 + 0.45)]).sort((a, c) => a[0] - c[0]);
  let cur = -w / 2;
  for (const [g0, g1] of gaps.concat([[w / 2, w / 2]])) {
    const len = g0 - cur;
    if (len > 0.1) b.box(o.beam, len, BW, BT, cur + len / 2, BW / 2, BZ);
    cur = g1;
  }
  b.box(o.beam, w, BW, BT, 0, h - BW / 2, BZ);
  for (let i = 0; i <= nx; i++) {
    const u = -w / 2 + BW / 2 + (i * (w - BW)) / nx;
    if (doors.some(D => Math.abs(u - D.u) < D.w / 2 + 0.45)) continue;
    b.box(o.beam, BW, h, BT, u, h / 2, BZ);
  }
  for (const v of o.rows || []) b.box(o.beam, w, BW * 0.8, BT, 0, v, BZ);
  for (const [u1, v1, u2, v2] of o.braces || []) brace(b, o.beam, u1, v1, u2, v2, BZ);
  for (const win of wins) {
    if (win.decal) b.box('plaster', win.w + 1.0, win.h + 0.9, 0.1, win.u, win.v + win.h / 2, 0.28);
    if (win.kind === 'g') gothic(b, win.u, win.v, win.w, win.h, win.lit, 0.25, !!o.see);
    else sqWin(b, win.u, win.v, win.w, win.h, win.lit, 0.25, !!o.see);
    if (o.see) inWin(b, win, true);
  }
  for (const D of doors) liveDoor(b, D);
  for (const D of (o.doors || (o.door ? [o.door] : [])).filter(d => !d.live)) doorStatic(b, D.u, D.w, D.h, D.double);
}

// 건물 네 면 + 모서리 기둥. spec(face, 면너비) → timberWall 옵션
function ring(b, o, spec) {
  const faces = [['f', 0, o.d / 2, 0, o.w], ['b', 0, -o.d / 2, Math.PI, o.w], ['r', o.w / 2, 0, Math.PI / 2, o.d], ['l', -o.w / 2, 0, -Math.PI / 2, o.d]];
  for (const [f, x, z, ry, ww] of faces) {
    b.push(x, o.y, z, ry);
    timberWall(b, { w: ww, h: o.h, panel: o.panel, beam: o.beam, ...spec(f, ww) });
    b.pop();
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(o.beam, 0.55, o.h, 0.55, (sx * o.w) / 2, o.y + o.h / 2, (sz * o.d) / 2);
}

// 바깥쪽 돌 밑단 (벽 아래 0.8). 문이 있으면 문 자리는 비움
function plinth(b, w, d, doorW) {
  const H = 0.8, T = 0.2, o = 0.37;
  b.box('stone', w + 0.9, H, T, 0, H / 2, -d / 2 - o);
  b.box('stone', T, H, d + 0.9, -w / 2 - o, H / 2, 0);
  b.box('stone', T, H, d + 0.9, w / 2 + o, H / 2, 0);
  if (doorW > 0) {
    const g = doorW / 2 + 0.5, len = w / 2 + 0.45 - g;
    b.box('stone', len, H, T, -(g + len / 2), H / 2, d / 2 + o);
    b.box('stone', len, H, T, g + len / 2, H / 2, d / 2 + o);
  } else b.box('stone', w + 0.9, H, T, 0, H / 2, d / 2 + o);
}

// 방 안쪽 마감: 나무 바닥 + 회반죽 천장 + 노출 보 + 걸레받이 (방 안에서 끝 방 전체)
function shell(b, R) {
  b.box('floor', R.w - 0.5, 0.1, R.d - 0.5, 0, 0, 0);
  b.box('plaster', R.w - 0.5, 0.3, R.d - 0.5, 0, R.h - 0.2, 0);
  const n = Math.max(2, Math.round(R.d / 3.2));
  for (let i = 0; i < n; i++) b.box('timber', R.w - 0.5, 0.3, 0.28, 0, R.h - 0.5, -R.d / 2 + 0.25 + ((i + 0.5) * (R.d - 0.5)) / n);
  baseboards(b, R);
}
function baseboards(b, R, x0 = -1e9) {
  const seg = (R.w - 0.5) / 2 - R.dw / 2 - 0.1;                 // 앞쪽은 문 자리를 비움
  if (seg > 0.1) for (const sx of [-1, 1]) b.box('timberLight', seg, 0.22, 0.08, sx * ((R.w - 0.5) / 2 - seg / 2), 0.16, R.d / 2 - 0.29);
  b.box('timberLight', R.w - 0.5, 0.22, 0.08, 0, 0.16, -R.d / 2 + 0.29);
  b.box('timberLight', 0.08, 0.22, R.d - 0.5, R.w / 2 - 0.29, 0.16, 0);
  b.box('timberLight', 0.08, 0.22, R.d - 0.5, -R.w / 2 + 0.29, 0.16, 0);
}

// 칸 중앙 위치들
function cellsU(ww, nx) {
  const cw = (ww - 0.34) / nx, out = [];
  for (let i = 0; i < nx; i++) out.push(-ww / 2 + 0.17 + (i + 0.5) * cw);
  return out;
}

// 박공 지붕 (용마루가 z 방향, 처마가 살짝 휘어 올라간 모양). y0 = 벽 윗면, R = 높이
function gableRoof(b, key, hw, y0, R, len, zc = 0) {
  const pts = [[0, y0 + R], [hw * 0.55, y0 + R * 0.45], [hw + 1.1, y0 - 0.1]];
  for (const s of [1, -1]) for (let i = 0; i < 2; i++) {
    const x1 = s * pts[i][0], y1 = pts[i][1], x2 = s * pts[i + 1][0], y2 = pts[i + 1][1];
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
    let nx = -dy / L, ny = dx / L;
    if (ny < 0) { nx = -nx; ny = -ny; }
    b.box(key, L + 0.15, 0.34, len, (x1 + x2) / 2 + nx * 0.17, (y1 + y2) / 2 + ny * 0.17, zc, 0, Math.atan2(dy, dx));
  }
  b.box('timber', 0.5, 0.35, len + 0.2, 0, y0 + R + 0.18, zc);
}

// 박공 벽 (지붕 밑 삼각형). 원점: 삼각형 밑변 중앙, 바깥쪽 +z
function gableWall(b, hw, R, panel, beam) {
  const sh = new THREE.Shape();
  sh.moveTo(-hw, 0); sh.lineTo(hw, 0); sh.lineTo(0, R); sh.lineTo(-hw, 0);
  b.geo(panel, new THREE.ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: false }), 0, 0, -0.5, 0, 0, 0, [1 / 6, 1 / 6]);
  b.box(beam, 0.34, R * 0.92, 0.34, 0, R * 0.46, 0.2);
  b.box(beam, hw * 2 - 0.4, 0.34, 0.34, 0, 0.17, 0.2);
  for (const s of [-1, 1]) brace(b, beam, s * (hw - 0.5), 0.3, s * 0.2, R * 0.55, 0.2);
}

// 사각뿔 지붕 (용마루 길이 rl). w x d 밑면, 높이 h
function hipGeo(w, d, h, rl) {
  const A = [-w / 2, 0, d / 2], B = [w / 2, 0, d / 2], C = [w / 2, 0, -d / 2], D = [-w / 2, 0, -d / 2];
  const R1 = [-rl / 2, h, 0], R2 = [rl / 2, h, 0];
  const tris = [A, B, R2, A, R2, R1, B, C, R2, C, D, R1, C, R1, R2, D, A, R1];
  const pos = [], uv = [];
  for (const p of tris) { pos.push(p[0], p[1], p[2]); uv.push((p[0] + p[2]) / 4, (p[1] * 1.4) / 4); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

const chimney = (b, x, yBase, z, h) => {
  b.box('stone', 1.1, h, 1.1, x, yBase + h / 2, z);
  b.box('stone', 1.4, 0.25, 1.4, x, yBase + h + 0.1, z);
};

function lantern(b, x, y, z) {
  b.box('iron', 0.62, 0.12, 0.62, x, y + 0.4, z);
  b.box('lamp', 0.5, 0.7, 0.5, x, y, z);
  b.box('iron', 0.62, 0.1, 0.62, x, y - 0.38, z);
}
// 벽에 매단 등 (벽 면 기준: z 앞쪽으로 팔이 나옴)
function wallLamp(b, u, v) {
  b.box('iron', 0.1, 0.1, 0.9, u, v, 0.7);
  lantern(b, u, v - 0.45, 1.1);
}
// 길가 가로등 기둥 (건물 로컬 좌표)
function lampPost(b, x, z) {
  b.box('stone', 0.9, 0.7, 0.9, x, 0.35, z);
  b.box('timber', 0.26, 4.6, 0.26, x, 2.7, z);
  b.box('timber', 1.3, 0.2, 0.2, x + 0.55, 4.9, z);
  lantern(b, x + 1.05, 4.4, z);
}

// ---------- 가구 ----------
// 가구 좌표: 바닥 윗면 중앙이 원점, 앞면이 +z. (village-layout.js 의 INTERIOR 목록과 같은 이름/크기)
function tableware(b, w, d, h) {
  b.box('candle', 0.12, 0.34, 0.12, 0, h + 0.06 + 0.17, 0);
  b.box('flame', 0.07, 0.13, 0.07, 0, h + 0.06 + 0.34 + 0.06, 0);
  for (const [px, pz] of [[-w * 0.28, d * 0.18], [w * 0.28, -d * 0.18]]) b.geo('ceramic', new THREE.CylinderGeometry(0.27, 0.22, 0.05, 12), px, h + 0.085, pz);
  b.geo('mug', new THREE.CylinderGeometry(0.1, 0.1, 0.2, 8), w * 0.12, h + 0.16, d * 0.2);
}

const FURN = {
  table(b, it) {
    const { w, d } = it, h = 1.0;
    b.box('timberLight', w, 0.12, d, 0, h, 0);
    b.box('timber', w - 0.3, 0.1, d - 0.3, 0, h - 0.11, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('timber', 0.18, h - 0.06, 0.18, sx * (w / 2 - 0.2), (h - 0.06) / 2, sz * (d / 2 - 0.2));
    tableware(b, w, d, h);
  },
  round(b, it) {
    const r = it.w / 2, h = 1.0;
    b.geo('timberLight', new THREE.CylinderGeometry(r, r, 0.12, 20), 0, h, 0);
    b.geo('timber', new THREE.CylinderGeometry(0.16, 0.2, h - 0.06, 8), 0, (h - 0.06) / 2, 0);
    b.geo('timber', new THREE.CylinderGeometry(0.5, 0.55, 0.1, 10), 0, 0.05, 0);
    tableware(b, r * 1.2, r * 1.2, h);
  },
  chair(b) {
    b.box('timberLight', 0.55, 0.09, 0.55, 0, 0.58, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('timber', 0.09, 0.58, 0.09, sx * 0.23, 0.29, sz * 0.23);
    b.box('timberLight', 0.55, 0.75, 0.07, 0, 0.98, -0.24);
    b.box('timber', 0.07, 0.8, 0.07, -0.24, 0.98, -0.24);
    b.box('timber', 0.07, 0.8, 0.07, 0.24, 0.98, -0.24);
  },
  stool(b) {
    b.geo('timberLight', new THREE.CylinderGeometry(0.28, 0.28, 0.09, 10), 0, 0.62, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('timber', 0.08, 0.6, 0.08, sx * 0.17, 0.3, sz * 0.17);
    b.box('timber', 0.4, 0.05, 0.05, 0, 0.25, 0);
  },
  desk(b, it) {
    const { w, d } = it, h = 1.0;
    b.box('timberLight', w, 0.1, d, 0, h, 0);
    for (const sx of [-1, 1]) {
      b.box('timber', 0.8, h - 0.05, d - 0.1, sx * (w / 2 - 0.45), (h - 0.05) / 2, 0);
      b.box('iron', 0.2, 0.05, 0.05, sx * (w / 2 - 0.45), h * 0.72, d / 2 - 0.02);
      b.box('iron', 0.2, 0.05, 0.05, sx * (w / 2 - 0.45), h * 0.4, d / 2 - 0.02);
    }
    b.box('clothB', 0.5, 0.1, 0.36, -0.2, h + 0.1, -0.05);
    b.box('clothR', 0.46, 0.08, 0.34, -0.2, h + 0.19, -0.05);
    b.box('linen', 0.5, 0.02, 0.4, 0.35, h + 0.06, 0.1);
    b.box('lamp', 0.2, 0.3, 0.2, w * 0.36, h + 0.2, -d * 0.2);
    b.box('iron', 0.26, 0.05, 0.26, w * 0.36, h + 0.37, -d * 0.2);
  },
  bed(b, it) {
    const { w, d } = it, cl = it.cloth || 'clothR';
    b.box('timber', w, 0.3, d, 0, 0.3, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('timber', 0.14, 0.3, 0.14, sx * (w / 2 - 0.1), 0.15, sz * (d / 2 - 0.1));
    b.box('timberLight', w, 1.0, 0.12, 0, 0.8, -d / 2 + 0.06);
    b.box('timberLight', w, 0.55, 0.1, 0, 0.58, d / 2 - 0.05);
    b.box('linen', w - 0.16, 0.22, d - 0.3, 0, 0.56, 0);
    b.box(cl, w - 0.1, 0.1, d * 0.62, 0, 0.7, d * 0.17);
    b.box('linen', 0.62, 0.14, 0.42, -w * 0.22, 0.74, -d / 2 + 0.45);
    b.box('linen', 0.62, 0.14, 0.42, w * 0.22, 0.74, -d / 2 + 0.45);
  },
  shelf(b, it) {
    const { w, d } = it, H = 3.0;
    b.box('timber', 0.1, H, d, -w / 2 + 0.05, H / 2, 0);
    b.box('timber', 0.1, H, d, w / 2 - 0.05, H / 2, 0);
    for (const y of [0.08, 0.9, 1.7, 2.5, 2.96]) b.box('timber', w, 0.08, d, 0, y, 0);
    b.box('books', w - 0.2, H - 0.2, 0.06, 0, H / 2, -d / 2 + 0.12);
    b.box('clothR', 0.1, 0.4, 0.28, -w * 0.3, 1.12, 0.0);
    b.box('clothB', 0.1, 0.36, 0.26, -w * 0.3 + 0.12, 1.1, 0.0);
    b.box('ceramic', 0.3, 0.3, 0.3, w * 0.25, 1.9, 0.0);
  },
  wardrobe(b, it) {
    const { w, d } = it, H = 2.6;
    b.box('timber', w, H, d, 0, H / 2, 0);
    b.box('timberLight', w + 0.15, 0.18, d + 0.15, 0, H + 0.09, 0);
    b.box('frame', 0.05, H - 0.4, 0.05, 0, H / 2, d / 2 + 0.02);
    for (const sx of [-1, 1]) b.box('iron', 0.08, 0.22, 0.08, sx * 0.2, 1.3, d / 2 + 0.05);
  },
  chest(b, it) {
    const { w, d } = it;
    b.box('timber', w, 0.7, d, 0, 0.35, 0);
    b.box('timberLight', w + 0.06, 0.18, d + 0.06, 0, 0.78, 0);
    for (const sx of [-1, 1]) b.box('iron', 0.1, 0.9, d + 0.1, sx * (w / 2 - 0.2), 0.45, 0);
    b.box('iron', 0.12, 0.16, 0.06, 0, 0.62, d / 2 + 0.03);
  },
  stand(b) {
    b.box('timber', 0.55, 0.75, 0.55, 0, 0.375, 0);
    b.box('timberLight', 0.62, 0.06, 0.62, 0, 0.78, 0);
    b.box('lamp', 0.18, 0.26, 0.18, 0, 0.94, 0);
    b.box('iron', 0.24, 0.05, 0.24, 0, 1.09, 0);
  },
  lamp(b) {
    b.geo('iron', new THREE.CylinderGeometry(0.25, 0.3, 0.1, 10), 0, 0.05, 0);
    b.box('iron', 0.08, 2.2, 0.08, 0, 1.15, 0);
    b.geo('lamp', new THREE.CylinderGeometry(0.3, 0.4, 0.6, 10), 0, 2.5, 0);
    b.box('iron', 0.5, 0.06, 0.5, 0, 2.82, 0);
  },
  barrel(b) {
    b.geo('timber', new THREE.CylinderGeometry(0.5, 0.45, 1.05, 10), 0, 0.52, 0);
    b.geo('iron', new THREE.CylinderGeometry(0.52, 0.52, 0.07, 10), 0, 0.28, 0);
    b.geo('iron', new THREE.CylinderGeometry(0.52, 0.52, 0.07, 10), 0, 0.8, 0);
  },
  crate(b, it) {
    const w = it.w - 0.1;
    b.box('timberLight', w, 0.9, w, 0, 0.45, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('timber', 0.1, 0.94, 0.1, sx * (w / 2), 0.47, sz * (w / 2));
  },
  stove(b, it) {
    const { w, d } = it;
    b.box('stone', w, 1.1, d, 0, 0.55, 0);
    b.box('iron', w - 0.1, 0.08, d - 0.1, 0, 1.14, 0);
    b.box('fire', 0.4, 0.3, 0.05, 0, 0.55, d / 2 + 0.01);
    b.box('iron', 0.5, 0.4, 0.04, 0, 0.55, d / 2 + 0.03);
    b.box('iron', 0.2, 2.2, 0.2, w * 0.25, 2.3, -d * 0.25);
    b.geo('iron', new THREE.CylinderGeometry(0.22, 0.22, 0.45, 8), -w * 0.2, 1.4, 0);
    b.geo('ceramic', new THREE.CylinderGeometry(0.2, 0.17, 0.2, 8), w * 0.15, 1.28, 0.1);
  },
  fireplace(b, it, R) {
    const { w, d } = it, H = 3.2, ow = w - 1.4;
    for (const sx of [-1, 1]) b.box('stone', 0.7, H, d, sx * (w / 2 - 0.35), H / 2, 0);
    b.box('stone', w, 0.9, d, 0, H - 0.45, 0);
    b.box('stone', ow, H - 0.9, 0.25, 0, (H - 0.9) / 2, -d / 2 + 0.125);
    b.box('stone', ow, 0.12, d - 0.2, 0, 0.06, 0);
    b.box('timberLight', w + 0.4, 0.15, d + 0.3, 0, H - 0.9, 0.05);
    const top = R.h - 0.35;
    if (top > H + 0.1) b.box('stone', w - 0.8, top - H, d - 0.3, 0, (H + top) / 2, -0.05);
    b.box('timber', 0.9, 0.16, 0.16, 0, 0.2, 0.05, 0.25); b.box('timber', 0.9, 0.16, 0.16, 0, 0.36, -0.05, -0.25);
    b.box('fire', ow * 0.7, 0.55, 0.4, 0, 0.62, -0.1);
    b.box('flame', ow * 0.4, 0.5, 0.25, 0, 0.9, -0.1);
  },
  bar(b, it) {
    const { w, d } = it;
    b.box('timber', w, 1.1, d, 0, 0.55, 0);
    b.box('timberLight', w + 0.3, 0.12, d + 0.3, 0, 1.16, 0);
    b.box('iron', w - 0.3, 0.08, 0.08, 0, 0.3, d / 2 + 0.12);
    for (let i = 0; i < 6; i++) b.geo('mug', new THREE.CylinderGeometry(0.12, 0.1, 0.24, 8), -w / 2 + 1 + (i * (w - 2)) / 5, 1.34, d * 0.1);
    for (const x of [-w * 0.2, 0, w * 0.2]) { b.box('iron', 0.1, 0.35, 0.1, x, 1.4, -d * 0.3); b.box('iron', 0.1, 0.1, 0.28, x, 1.52, -d * 0.2); }
  },
  backbar(b, it) {
    const { w, d } = it;
    b.box('timber', w, 3.0, 0.1, 0, 1.5, -d / 2 + 0.05);
    b.box('timber', 0.1, 3.0, d, -w / 2 + 0.05, 1.5, 0); b.box('timber', 0.1, 3.0, d, w / 2 - 0.05, 1.5, 0);
    b.box('timber', w, 1.0, d, 0, 0.5, 0);
    for (const y of [1.25, 1.95, 2.65]) {
      b.box('timberLight', w, 0.08, d, 0, y, 0);
      for (let x = -w / 2 + 0.7, n = 0; x < w / 2 - 0.5; x += 0.65, n++) {
        b.geo(n % 2 ? 'glassG' : 'glassA', new THREE.CylinderGeometry(0.12, 0.13, 0.5, 8), x, y + 0.29, 0.02 * (n % 3));
        b.geo(n % 2 ? 'glassG' : 'glassA', new THREE.CylinderGeometry(0.05, 0.12, 0.2, 8), x, y + 0.64, 0.02 * (n % 3));
      }
    }
  },
  screen(b, it) {
    const { w, d } = it, H = 2.2;
    b.box('timber', w, H, d, 0, H / 2, 0);
    b.box('plasterWarm', w - 0.4, H - 0.6, d + 0.04, 0, H / 2, 0);
    b.box('timberLight', w + 0.1, 0.1, d + 0.1, 0, H + 0.05, 0);
  },
  rug(b, it) { b.box('rug', it.w, 0.04, it.d, 0, 0.02, 0); },
  chandelier(b, it, R) {
    const top = R.h - 0.5 - FLOOR_Y, y = top - 1.0;
    b.box('iron', 0.05, top - y, 0.05, 0, (top + y) / 2, 0);
    b.geo('iron', new THREE.TorusGeometry(0.8, 0.045, 6, 18), 0, y, 0, 0, 0, Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, x = Math.cos(a) * 0.8, z = Math.sin(a) * 0.8;
      b.box('candle', 0.1, 0.28, 0.1, x, y + 0.18, z);
      b.box('flame', 0.06, 0.12, 0.06, x, y + 0.4, z);
    }
    b.box('lamp', 0.28, 0.28, 0.28, 0, y - 0.12, 0);
  },
  sconce(b, it) {
    const y = it.y || 2.4;
    b.box('iron', 0.26, 0.36, 0.05, 0, y, 0.025);
    b.box('iron', 0.06, 0.06, 0.3, 0, y - 0.1, 0.18);
    b.box('candle', 0.1, 0.22, 0.1, 0, y + 0.04, 0.3);
    b.box('flame', 0.06, 0.12, 0.06, 0, y + 0.21, 0.3);
  },
};

// 방에 가구를 놓는다 (집 로컬 좌표, 바닥 윗면 기준)
function furnish(b, type, R) {
  INTERIOR[type].forEach((it, i) => {
    b.push(it.x, FLOOR_Y, it.z, it.ry || 0);
    FURN[it.k](b, it, R, i);
    b.pop();
  });
}

// ---------- 건물 종류 ----------
// 장식 건물(A/B/C/D): 겉모습만 있음. 문을 열면 안쪽이 검고, "집 들어가기"로 땅 밑 방(ROOMS)으로 이동한다.
// 여관: 1층은 진짜 실내(+계단), 2층은 복도 + 방문들(각 방문은 객실로 이동).
const decoDoor = (b, R, noDoor) => ({ u: 0, w: R.dw, h: R.dh, live: !noDoor, black: true, outward: true, id: b.houseIdx });

// A: 튜더식 2층집 (2층이 앞으로 튀어나온 구조 + 가파른 붉은 지붕 + 고딕 창)
function buildA(b, o) {
  const R = ROOM.A, r = rng(o.seed), noDoor = !!o.noDoor;
  const w = R.w, d = R.d, fh = 0, h1 = R.h, h2 = 3.8, W2 = w + 1.2, D2 = d + 1.2;
  plinth(b, w, d, noDoor ? 0 : R.dw);
  ring(b, { w, d, y: fh, h: h1, panel: 'plasterWarm', beam: 'timber' }, (f, ww) => {
    if (f === 'f') return { nx: 1, door: decoDoor(b, R, noDoor), braces: [[-ww / 2 + 0.2, h1 - 0.2, -ww / 2 + 1.6, h1 - 1.7], [ww / 2 - 0.2, h1 - 0.2, ww / 2 - 1.6, h1 - 1.7]] };
    return { nx: 1, wins: [{ u: 0, v: 1.0, w: 1.1, h: 1.3, kind: 's', lit: r() < 0.6 }] };
  });
  // 2층을 받치는 보와 버팀목
  b.box('timber', W2 + 0.3, 0.5, D2 + 0.3, 0, fh + h1 + 0.1, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.push(0, 0, sz * (d / 2 + 0.05));
    brace(b, 'timber', sx * (w / 2), fh + h1 - 1.5, sx * (W2 / 2 - 0.15), fh + h1 - 0.1, 0, 0.3);
    b.pop();
    b.push(sx * (w / 2 + 0.05), 0, 0, Math.PI / 2);
    brace(b, 'timber', -sz * (d / 2), fh + h1 - 1.5, -sz * (D2 / 2 - 0.15), fh + h1 - 0.1, 0, 0.3);
    b.pop();
  }
  const y2 = fh + h1 + 0.3, hh = h2 - 0.3;
  ring(b, { w: W2, d: D2, y: y2, h: hh, panel: 'plaster', beam: 'timber' }, (f, ww) => {
    if (f === 'f') return { nx: 1, rows: [hh * 0.5], wins: [{ u: 0, v: 0.8, w: 1.5, h: 2.3, kind: 'g', lit: true }], braces: [[-ww / 2 + 0.2, hh - 0.2, -ww / 2 + 1.5, hh * 0.55], [ww / 2 - 0.2, hh - 0.2, ww / 2 - 1.5, hh * 0.55]] };
    const nx = f === 'b' ? 1 : 2;
    return { nx, wins: cellsU(ww, nx).map(u => ({ u, v: 0.9, w: 1.1, h: 1.6, kind: 's', lit: r() < 0.65 })) };
  });
  const y0 = fh + h1 + h2, hw = W2 / 2, RR = 6.4;
  gableRoof(b, o.roof, hw, y0, RR, D2 + 1.6);
  for (const s of [1, -1]) { b.push(0, y0, (s * D2) / 2, s > 0 ? 0 : Math.PI); gableWall(b, hw, RR, 'plaster', 'timber'); b.pop(); }
  chimney(b, hw * 0.45, y0 + 1.8, -1.5, 5.2);
  b.push((w / 2) + 0.35, 0, d / 2 + 0.2); wallLamp(b, 0, 3.0); b.pop();
}

// D: 작은 오두막 (갈색 기와 + 고딕 창 둘 + 굴뚝)
function buildD(b, o) {
  const R = ROOM.D, r = rng(o.seed);
  const w = R.w, d = R.d, fh = 0, h1 = R.h;
  plinth(b, w, d, R.dw);
  ring(b, { w, d, y: fh, h: h1, panel: 'plaster', beam: 'timber' }, (f, ww) => {
    if (f === 'f') return { nx: 3, door: decoDoor(b, R, false), wins: [-1, 1].map(s => ({ u: s * (ww / 2 - 1.5), v: 1.0, w: 1.0, h: 1.9, kind: 'g', lit: r() < 0.8 })) };
    return { nx: 2, wins: cellsU(ww, 2).map(u => ({ u, v: 1.0, w: 1.0, h: 1.8, kind: 'g', lit: r() < 0.6 })) };
  });
  const y0 = fh + h1, hw = w / 2 + 0.1, RR = 4.6;
  gableRoof(b, o.roof, hw, y0, RR, d + 1.6);
  for (const s of [1, -1]) {
    b.push(0, y0, (s * d) / 2, s > 0 ? 0 : Math.PI); gableWall(b, hw, RR, 'plaster', 'timber');
    if (s > 0) gothic(b, 0, 0.6, 0.9, 1.7, true);
    b.pop();
  }
  chimney(b, -hw * 0.5, y0 + 1.3, 0.5, 4.2);
}

// 탑: 남색 벽 + 층마다 고딕 창 둘 + 휘어 올라가는 뾰족 지붕 (사각 로프트). enter 면 1층에 열리는 문(안쪽은 검음)
function tower(b, o) {
  const r = rng(o.seed), sq = o.sq, fh = 0, tiers = o.tiers, R = ROOM.B;
  plinth(b, sq, sq, o.enter ? R.dw : 0);
  let y = fh;
  tiers.forEach((th, ti) => {
    ring(b, { w: sq, d: sq, y, h: th, panel: ti === 0 ? 'stone' : 'navy', beam: 'timberBlue' }, (f, ww) => {
      if (ti === 0) {
        if (f === 'f') return { nx: 1, door: decoDoor(b, R, !o.enter) };
        return { nx: 1 };
      }
      return { nx: 2, wins: cellsU(ww, 2).map(u => ({ u, v: 0.8, w: 1.0, h: th - 1.7, kind: 'g', lit: r() < 0.7, decal: true })) };
    });
    y += th;
  });
  b.box('timberBlue', sq + 0.9, 0.5, sq + 0.9, 0, y + 0.05, 0);
  const r0 = (sq / 2 + 0.95) * Math.SQRT2, H = o.roofH;
  const prof = [[1, 0], [0.9, 0.025], [0.74, 0.12], [0.5, 0.3], [0.29, 0.52], [0.14, 0.75], [0.045, 0.92], [0, 1]];
  const lathe = new THREE.LatheGeometry(prof.map(([a, c]) => new THREE.Vector2(a * r0, c * H)), 4, Math.PI / 4);
  b.geo('roofNavy', lathe, 0, y + 0.3, 0, 0, 0, 0, [6, 6]);
  b.box('iron', 0.15, 1.6, 0.15, 0, y + 0.3 + H + 0.5, 0);
}
const buildB = (b, o) => tower(b, { seed: o.seed, sq: ROOM.B.w, tiers: [ROOM.B.h, 3.5, 3.5, 3.5, 3.5], roofH: 10, enter: true });

// C: 4층 연립 건물 (남색 뼈대 + 회백색 벽 + 네모 창 격자 + 남색 지붕)
function buildC(b, o) {
  const R = ROOM.C, r = rng(o.seed);
  const w = R.w, d = R.d, fh = 0, tiers = [R.h, 3.5, 3.5, 3.5];
  plinth(b, w, d, R.dw);
  let y = fh;
  tiers.forEach((th, ti) => {
    ring(b, { w, d, y, h: th, panel: ti === 0 ? 'plasterWarm' : 'plaster', beam: 'timberBlue' }, (f, ww) => {
      const nx = Math.max(1, Math.round(ww / 3.8)), wins = [];
      for (const u of cellsU(ww, nx)) {
        if (ti === 0) {
          if (f === 'f' && Math.abs(u) < 0.5) continue;
          wins.push({ u, v: 0.9, w: 1.3, h: 2.4, kind: 'g', lit: r() < 0.8 });
        } else wins.push({ u, v: 0.8, w: 1.7, h: th - 1.8, kind: 's', lit: r() < 0.65 });
      }
      const spec = { nx, wins };
      if (ti === 0 && f === 'f') spec.door = decoDoor(b, R, false);
      return spec;
    });
    y += th;
  });
  b.box('timberBlue', w + 0.9, 0.55, d + 0.9, 0, y + 0.2, 0);
  b.geo(o.roof === 'roofBrown' ? 'roofBrown' : 'roofNavy', hipGeo(w + 1.6, d + 1.6, 3.8, (w + 1.6) * 0.5), 0, y + 0.45, 0);
  chimney(b, w * 0.28, y + 1.0, 0, 4.2);
  chimney(b, -w * 0.28, y + 1.0, 0, 4.2);
}

// ----- 여관 1층 안쪽 마감 + 2층 바닥(계단 구멍) + 계단 + 2층 복도 -----
function innShell(b) {
  const R = ROOM.INN, S = INN2.stairs, W = R.w, D = R.d;
  const x0 = -W / 2 + 0.25, x1 = W / 2 - 0.25, zA = -D / 2 + 0.25, zB = D / 2 - 0.25;
  b.box('floor', W - 0.5, 0.1, D - 0.5, 0, 0, 0);                              // 1층 바닥
  // 1층 천장 = 2층 바닥. 계단이 올라오는 자리(오른쪽 앞)만 비워 둠
  for (const [ax, bx, az, bz] of [[x0, S.x0, zA, zB], [S.x0, x1, zA, S.zt]]) {
    const cx = (ax + bx) / 2, cz = (az + bz) / 2, w = bx - ax, d = bz - az;
    b.box('plaster', w, 0.3, d, cx, R.h - 0.2, cz);
    b.box('floor', w, 0.1, d, cx, R.h, cz);
  }
  const n = Math.round(D / 3.2);
  for (let i = 0; i < n; i++) b.box('timber', S.x0 - x0, 0.3, 0.28, (x0 + S.x0) / 2, R.h - 0.5, zA + ((i + 0.5) * (zB - zA)) / n);
  baseboards(b, R);
  // 2층 천장
  b.box('plaster', W - 0.5, 0.3, D - 0.5, 0, INN2.floorY - 0.05 + INN2.h - 0.15, 0);
}

function innStairs(b) {
  const S = INN2.stairs, n = S.n, run = (S.zb - S.zt) / n, rise = (INN2.floorY - FLOOR_Y) / n;
  const w = S.x1 - S.x0, xc = (S.x0 + S.x1) / 2, ramp = z => FLOOR_Y + ((S.zb - z) / (S.zb - S.zt)) * (INN2.floorY - FLOOR_Y);
  for (let i = 0; i < n; i++) {
    const top = FLOOR_Y + (i + 1) * rise;
    b.box('timberLight', w, top, run + 0.01, xc, top / 2, S.zb - (i + 0.5) * run);
  }
  b.box('plasterWarm', w, ROOM.INN.h - 0.35, 0.4, xc, (ROOM.INN.h - 0.35) / 2, S.zt - 0.2);   // 계단 꼭대기 아래 벽
  // 서쪽 난간: 기둥 + 경사진 손잡이
  const len = Math.hypot(S.zb - S.zt, INN2.floorY - FLOOR_Y), ang = Math.atan2(INN2.floorY - FLOOR_Y, S.zb - S.zt);
  b.box('timberLight', 0.14, 0.14, len, S.x0, (ramp(S.zb) + ramp(S.zt)) / 2 + 1.0, (S.zb + S.zt) / 2, 0, 0, ang);
  for (let i = 0; i <= 6; i++) {
    const z = S.zb - (i * (S.zb - S.zt)) / 6;
    b.box('timber', 0.12, 1.0, 0.12, S.x0, ramp(z) + 0.5, z);
  }
  b.box('timber', 0.22, 1.25, 0.22, S.x0, INN2.floorY + 0.62, S.zt - 0.1);
}

// 2층 복도 칸막이 벽 (방문들이 줄지어 달림). side -1: 북쪽(-z)벽, +1: 남쪽(+z)벽
function innPartition(b, side, ids) {
  const C = INN2.corr, W = ROOM.INN.w, x0 = -W / 2 + 0.25, x1 = side < 0 ? W / 2 - 0.25 : INN2.stairs.x0;
  const len = x1 - x0, xc = (x0 + x1) / 2, flip = side > 0;
  const doors = INN2.doorX.map((dx, k) => ({
    u: flip ? -(dx - xc) : dx - xc, w: INN2.doorW, h: INN2.doorH, live: true, black: true, outward: true, id: ids[k],
  }));
  b.push(xc, INN2.floorY, side * C, flip ? Math.PI : 0);
  timberWall(b, { w: len, h: INN2.h - 0.35, panel: 'plasterWarm', beam: 'timber', nx: Math.round(len / 2.6), doors });
  b.pop();
  // 문 사이 촛대
  for (const x of [-8.4, -3.2, 2.0, 7.2]) {
    b.push(x, INN2.floorY, side * (C - 0.28), flip ? Math.PI : 0);
    FURN.sconce(b, { y: 2.4 });
    b.pop();
  }
}

function innCorridor(b) {
  const C = INN2.corr;
  innPartition(b, -1, [15, 16, 17, 18]);
  innPartition(b, 1, [19, 20, 21, 22]);
  b.box('rug', 25, 0.04, 1.8, -1.2, INN2.floorY + 0.02, 0);
  for (let x = -13; x <= 13; x += 3) b.box('timber', 0.28, 0.3, 2 * C - 0.5, x, INN2.floorY + 3.5, 0);
  for (const x of [-9, -2, 5]) { b.push(x, INN2.floorY, 0); FURN.chandelier(b, {}, { h: 3.9 }); b.pop(); }
  for (const [x, z] of [[-13.6, -1.1], [-13.6, 1.1]]) { b.push(x, INN2.floorY, z); FURN.lamp(b); b.pop(); }
  // 복도 아래쪽 걸레받이 (복도 양쪽 벽)
  b.box('timberLight', 28, 0.22, 0.08, -0.2, INN2.floorY + 0.16, -C + 0.3);
  b.box('timberLight', 26, 0.22, 0.08, -1.2, INN2.floorY + 0.16, C - 0.3);
}

// 여관: 4층 본관 + 왼쪽 탑 + 오른쪽 튜더식 별관. 1층 술집 + 침대 칸, 계단, 2층 복도(방문 8개)
function buildInn(b, o) {
  const R = ROOM.INN, r = rng(o.seed);
  const w = R.w, d = R.d, fh = 0, tiers = [R.h, INN2.h, 4.0, 4.0];
  plinth(b, w, d, R.dw);
  let y = fh;
  tiers.forEach((th, ti) => {
    ring(b, { w, d, y, h: th, panel: ti === 0 ? 'plasterWarm' : 'plaster', beam: 'timberBlue' }, (f, ww) => {
      const see = ti <= 1;       // 1~2층 창은 벽에 구멍을 뚫어서 안에서 밖이 보임
      const nx = f === 'f' || f === 'b' ? 6 : (ti === 1 ? 3 : 4), wins = [];
      for (const u of cellsU(ww, nx)) {
        if (ti === 0) {
          if (f === 'f' && Math.abs(u) < 4) continue;
          wins.push({ u, v: 1.0, w: 1.7, h: 3.2, kind: 'g', lit: r() < 0.85 });
        } else wins.push({ u, v: 0.9, w: 1.9, h: th - 2.0, kind: 's', lit: r() < 0.7 });
      }
      const spec = { nx, wins, see };
      if (ti === 0 && f === 'f') spec.door = { u: 0, w: R.dw, h: R.dh, live: true, double: true, id: 0 };
      return spec;
    });
    y += th;
  });
  innShell(b);
  furnish(b, 'INN', R);
  innStairs(b);
  innCorridor(b);
  // 정문 양옆 벽등
  b.push(0, 0, d / 2);
  wallLamp(b, -3.2, 3.6); wallLamp(b, 3.2, 3.6);
  b.pop();
  // 정문 차양
  const fz = d / 2;
  b.box('roofRed', 6.2, 0.3, 3.2, 0, 4.9, fz + 1.35, 0, 0, 0.32);
  for (const sx of [-1, 1]) b.box('timber', 0.32, 4.0, 0.32, sx * 2.8, 2.7, fz + 2.5);
  // 간판 (차양 위, 벽에 달림)
  b.box('timber', 3.3, 1.75, 0.2, 0, 7.4, fz + 0.45);
  b.geo('sign', new THREE.PlaneGeometry(3.0, 1.5), 0, 7.4, fz + 0.57);
  for (const sx of [-1, 1]) b.box('iron', 0.1, 0.1, 0.5, sx * 1.4, 8.3, fz + 0.3);
  // 지붕 + 굴뚝 + 다락창
  const rootY = y + 0.45, roofH = 6.8, rl = (w + 2) * 0.55;
  b.box('timberBlue', w + 0.9, 0.55, d + 0.9, 0, y + 0.2, 0);
  b.geo('roofNavy', hipGeo(w + 2, d + 2, roofH, rl), 0, rootY, 0);
  chimney(b, -6, rootY + 2.5, -2.5, 5.2);
  chimney(b, 6, rootY + 2.5, -2.5, 5.2);
  for (const x of [-8, 0, 8]) {                      // 앞쪽 지붕 다락창 3개
    const t = 0.36, zs = (d / 2 + 1) * (1 - t);
    const yb = rootY + roofH * t - 0.5;
    b.box('plaster', 2.4, 2.6, 2.2, x, yb + 1.3, zs - 0.6);
    b.push(x, 0, zs - 0.6);
    b.push(0, 0, 1.1); gothic(b, 0, yb + 0.35, 0.9, 1.5, true, 0.0); b.pop();
    gableRoof(b, 'roofRed', 1.3, yb + 2.6, 1.5, 2.8, 0);
    b.pop();
  }
  // 왼쪽 탑 / 오른쪽 별관 (들어갈 수 없는 덩어리, 문은 장식)
  b.push(-18.2, 0, 4.6); tower(b, { seed: o.seed + 1, sq: 8, tiers: [4.4, 4, 4, 4, 4, 4], roofH: 12.5, enter: false }); b.pop();
  b.push(19, 0, 4.7); buildA(b, { seed: o.seed + 2, roof: 'roofRed', noDoor: true }); b.pop();
  // 정문 앞: 가로등, 통, 상자
  lampPost(b, -8, fz + 4.5);
  lampPost(b, 8, fz + 4.5);
  for (const [bx, bz] of [[6.2, fz + 1.2], [7.4, fz + 1.5], [6.8, fz + 2.6]]) {
    b.geo('timber', new THREE.CylinderGeometry(0.5, 0.45, 1.05, 10), bx, 0.52, bz);
    b.box('iron', 1.02, 0.08, 1.02, bx, 0.3, bz); b.box('iron', 1.02, 0.08, 1.02, bx, 0.8, bz);
  }
  b.box('timber', 1.0, 1.0, 1.0, -6.4, 0.5, fz + 1.4, 0.3);
  b.box('timber', 0.9, 0.9, 0.9, -6.5, 1.45, fz + 1.35, 0.9);
  b.box('timber', 1.0, 1.0, 1.0, -7.6, 0.5, fz + 2.2, -0.2);
}

const BUILD = { A: buildA, B: buildB, C: buildC, D: buildD, INN: buildInn };

// ---------- 방(집 안 공간): 땅 밑에 따로 있는 방. 처음 들어갈 때 만든다 ----------
// 벽 한 면 (회반죽 + 창 구멍). 벽 면은 z=0 평면, 방 안쪽이 -z
function roomWall(b, w, h, wins) {
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, h); sh.lineTo(-w / 2, h); sh.lineTo(-w / 2, 0);
  for (const win of wins) sh.holes.push(win.kind === 'g' ? archAt(win.u, win.v, win.w, win.h) : rectAt(win.u, win.v, win.w, win.h));
  b.geo('plaster', new THREE.ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: false, curveSegments: 6 }), 0, 0, -0.25, 0, 0, 0, [1 / 6, 1 / 6]);
  for (const win of wins) inWin(b, win, true);
}

function buildRoomGroup(m) {
  const b = new Batch(), R = m.R, W = R.w, D = R.d;
  b.push(m.x, m.y, m.z);
  shell(b, R);
  for (const [id, x, z, ry, ww] of [['b', 0, -D / 2, Math.PI, W], ['f', 0, D / 2, 0, W], ['l', -W / 2, 0, -Math.PI / 2, D], ['r', W / 2, 0, Math.PI / 2, D]]) {
    const wins = m.windows.filter(q => q.wall === id).map(q => ({ u: id === 'b' || id === 'r' ? -q.t : q.t, v: q.v, w: q.w, h: q.h, kind: q.kind }));
    b.push(x, 0, z, ry);
    roomWall(b, ww, R.h, wins);
    if (wins.length) b.geo('view', new THREE.PlaneGeometry(90, 50), 0, 8, 26, Math.PI);   // 창밖 풍경 (벽 바깥 멀리)
    b.pop();
  }
  b.push(0, 0, D / 2 - 0.25, Math.PI); doorStatic(b, 0, R.dw, R.dh, false, 0.0); b.pop();   // 나가는 문 (안쪽)
  furnish(b, m.type, R);
  b.pop();
  return b.finish();
}

// ---------- 실행 중 (문 열림 애니메이션 + 실내 조명 + 방 보이기/숨기기) ----------
const RT = { swings: [], ang: [], light: null, group: null, rooms: [], scene: null };

// 마을 건물 전부 만들어서 scene에 올린다 (village-layout.js 의 HOUSES 배치대로)
export function buildHouses(scene) {
  const b = new Batch();
  HOUSES.forEach((h, i) => {
    b.houseIdx = i;
    b.push(h.x, VILLAGE.h, h.z, h.rot, 0, 0, h.k);
    BUILD[h.type](b, h);
    b.pop();
  });
  const group = b.finish();
  group.name = 'village-houses';
  // 열리는 문짝: 경첩 위치에서 돌아가도록 pivot 그룹으로 감싼다
  for (const rec of b.doors) {
    const outer = new THREE.Group();
    rec.matrix.decompose(outer.position, outer.quaternion, outer.scale);
    const swing = new THREE.Group();
    swing.add(rec.leaf);
    outer.add(swing);
    group.add(outer);
    (RT.swings[rec.door] ||= []).push({ swing, sign: rec.sign, open: rec.outward ? 1.6 : 1.75 });
  }
  scene.add(group);
  // 실내 조명: 지금 들어가 있는 방에만 따뜻한 빛을 하나 켠다 (광원이 많으면 느려져서 하나를 옮겨 씀)
  RT.light = new THREE.PointLight(0xffd9a0, 0, 20, 1.4);
  scene.add(RT.light);
  RT.group = group;
  RT.scene = scene;
  return group;
}

function ensureRoom(r) {
  if (RT.rooms[r] || !RT.scene) return;
  const g = buildRoomGroup(ROOMS[r]);
  g.visible = false;
  RT.scene.add(g);
  RT.rooms[r] = g;
}

// 매 프레임: 문 애니메이션 + 방 보이기 + 실내 조명. curRoom = 지금 들어가 있는 방(없으면 -1).
// 돌려주는 값: 지금 여관 안(진짜 실내)에 있으면 0, 아니면 -1
export function updateHouses(dt, px, py, pz, curRoom = -1) {
  const k = 1 - Math.exp(-9 * dt);
  RT.swings.forEach((list, i) => {
    if (!list) return;
    const cur = RT.ang[i] || 0;
    const first = RT.ang[i] === undefined;
    const target = isDoorOpen(i) ? list[0].open : 0;
    const next = Math.abs(target - cur) < 0.002 ? target : cur + (target - cur) * k;
    if (next !== cur || first) {
      RT.ang[i] = next;
      for (const L of list) L.swing.rotation.y = L.sign * next;
    }
  });
  if (curRoom >= 0) ensureRoom(curRoom);
  RT.rooms.forEach((g, r) => { if (g) g.visible = r === curRoom; });
  const inInn = curRoom >= 0 ? -1 : houseAt(px, pz);
  if (RT.light) {
    let target = 0;
    if (curRoom >= 0) {
      const c = roomLightPos(curRoom);
      RT.light.position.set(c.x, c.y, c.z);
      RT.light.distance = 16;
      target = 1.2;
    } else if (inInn >= 0) {
      const c = roomLight(inInn, py);
      RT.light.position.set(c.x, VILLAGE.h + c.y, c.z);
      RT.light.distance = 34;
      target = 1.5;
    }
    RT.light.intensity += (target - RT.light.intensity) * (1 - Math.exp(-6 * dt));
  }
  return inInn;
}
