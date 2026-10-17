import * as THREE from 'three';
import { VILLAGE } from './terrain.js';

// 시작마을 터를 선으로만 표시
export function buildVillage(scene) {
  const y = VILLAGE.h + 0.12;
  const mat = new THREE.MeshBasicMaterial({
    color: 0xfff3d0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const group = new THREE.Group();

  function line(x1, z1, x2, z2, width) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, width), mat);
    m.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    group.add(m);
  }

  function rect(cx, cz, w, d, rot) {
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
      .map(([lx, lz]) => [cx + lx * cos - lz * sin, cz + lx * sin + lz * cos]);
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      line(a[0], a[1], b[0], b[1], 0.5);
    }
  }

  const X = VILLAGE.x, Z = VILLAGE.z;

  // 바깥 원 (마을 경계)
  const R = 135, SEG = 72;
  for (let i = 0; i < SEG; i++) {
    const a1 = (i / SEG) * Math.PI * 2, a2 = ((i + 1) / SEG) * Math.PI * 2;
    line(X + Math.cos(a1) * R, Z + Math.sin(a1) * R,
         X + Math.cos(a2) * R, Z + Math.sin(a2) * R, 0.8);
  }

  rect(X, Z, 36, 36, 0);                                   // 중앙 광장

  for (let i = 0; i < 6; i++) {                            // 안쪽 집터 6개
    const a = (i / 6) * Math.PI * 2;
    rect(X + Math.cos(a) * 55, Z + Math.sin(a) * 55, 18, 14, a + Math.PI / 2);
  }
  for (let i = 0; i < 10; i++) {                           // 바깥 집터 10개
    const a = (i / 10) * Math.PI * 2 + 0.3;
    rect(X + Math.cos(a) * 95, Z + Math.sin(a) * 95, 16, 12, a + Math.PI / 2);
  }

  scene.add(group);
}
