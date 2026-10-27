// 나무검 상태 머신 검증: node tools/weapon-state-test.mjs
// three.js 없이 돌리려고 아주 작은 가짜 THREE 를 끼워서 weapon.js 의 "상태 전환/쿨다운/중복 입력/장착 반복" 논리만 확인한다.
// (실제 메시 모양, 손 위치, 모션의 시각적 자연스러움은 브라우저에서 눈으로 봐야 함)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wtest-'));

fs.writeFileSync(path.join(tmp, 'three-stub.mjs'), `
export const DoubleSide = 2;
export class Vector3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} }
export class Color { set(){ this.r=.5; this.g=.3; this.b=.2; return this; } }
export class Matrix4 { makeBasis(x,y,z){ this.e=[x,y,z]; return this; } }
export class Euler { set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} }
export class Quaternion {
  constructor(){this.x=0;this.y=0;this.z=0;this.w=1;}
  setFromEuler(e){ const c=(a)=>Math.cos(a/2), s=(a)=>Math.sin(a/2);
    const c1=c(e.x),c2=c(e.y),c3=c(e.z),s1=s(e.x),s2=s(e.y),s3=s(e.z);
    this.x=s1*c2*c3+c1*s2*s3; this.y=c1*s2*c3-s1*c2*s3; this.z=c1*c2*s3+s1*s2*c3; this.w=c1*c2*c3-s1*s2*s3; return this; }
  setFromRotationMatrix(){ return this; }
  multiply(q){ const a=this,b=q; const x=a.x*b.w+a.w*b.x+a.y*b.z-a.z*b.y, y=a.y*b.w+a.w*b.y+a.z*b.x-a.x*b.z,
    z=a.z*b.w+a.w*b.z+a.x*b.y-a.y*b.x, w=a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z; this.x=x;this.y=y;this.z=z;this.w=w; return this; }
  slerp(q,t){ this.x+=(q.x-this.x)*t; this.y+=(q.y-this.y)*t; this.z+=(q.z-this.z)*t; this.w+=(q.w-this.w)*t;
    const n=Math.hypot(this.x,this.y,this.z,this.w)||1; this.x/=n;this.y/=n;this.z/=n;this.w/=n; return this; }
}
export class Object3D { constructor(){ this.children=[]; this.visible=true; this.position=new Vector3(); this.quaternion=new Quaternion();
  this.scale={x:1,y:1,z:1,setScalar(s){this.x=this.y=this.z=s;}}; } add(o){ this.children.push(o); return this; } }
export class Group extends Object3D {}
export class Mesh extends Object3D { constructor(g,m){ super(); this.geometry=g; this.material=m; } }
export class BufferGeometry { setAttribute(n,a){ (this.attrs ||= {})[n]=a; } computeVertexNormals(){} computeBoundingSphere(){} }
export class Float32BufferAttribute { constructor(a,n){ this.array=a; this.itemSize=n; } }
export class MeshLambertMaterial { constructor(o){ Object.assign(this,o); } }
`);
let src = fs.readFileSync(path.join(here, '../public/js/weapon.js'), 'utf8').replace("from 'three'", "from './three-stub.mjs'");
fs.writeFileSync(path.join(tmp, 'weapon.mjs'), src);
const W = await import(pathToFileURL(path.join(tmp, 'weapon.mjs')).href);
const { Quaternion, Group } = await import(pathToFileURL(path.join(tmp, 'three-stub.mjs')).href);

let pass = 0, fail = 0;
const ok = (c, name) => { if (c) pass++; else { fail++; console.log('FAIL:', name); } };

function makeRig() {
  const b = () => { const o = new Group(); o.quaternion = new Quaternion(); return o; };
  return { kind: 'glb', bones: { upper: b(), fore: b(), hand: b(), spine: b() } };
}
const loco = { run: 0, move: 0, phase: -1 };
// 매 프레임: 클립이 뼈를 초기화한 것처럼 흉내 → 우리가 덮어쓴 회전이 누적되는지 확인
function frame(rig, dt) {
  if (rig.bones) for (const k of Object.keys(rig.bones)) rig.bones[k].quaternion = Object.assign(rig.bones[k].quaternion, { x: 0, y: 0, z: 0, w: 1 });
  W.updateWeapon(rig, dt, loco);
}
function run(rig, sec, fps = 60) { const n = Math.round(sec * fps); for (let i = 0; i < n; i++) frame(rig, 1 / fps); }
const finite = (rig) => Object.values(rig.bones).every((o) => [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w].every(Number.isFinite));

// 1) 장착
{
  const rig = makeRig();
  ok(W.getWeaponStateName(rig) === 'UNEQUIPPED', 'start UNEQUIPPED');
  ok(W.startWeaponAttack(rig) === false, 'attack impossible when unequipped');
  ok(W.requestToggleWeapon(rig) === true, 'toggle -> equip');
  run(rig, 0.1);
  ok(W.getWeaponStateName(rig) === 'EQUIPPING', 'EQUIPPING');
  ok(W.requestToggleWeapon(rig) === null, 'duplicate toggle ignored while equipping');
  ok(W.startWeaponAttack(rig) === false, 'no attack while equipping');
  run(rig, 0.8);
  ok(W.getWeaponStateName(rig) === 'IDLE', 'IDLE after equip');
  ok(rig.wp.mount.visible && rig.wp.mount.scale.x === 1, 'sword visible, full scale');
  ok(rig.bones.hand.children.length === 1, 'exactly one mount on hand');

  // 걷기/달리기 상태 이름
  loco.move = 1; loco.phase = 0.3; run(rig, 0.8);
  ok(W.getWeaponStateName(rig) === 'WALKING', 'WALKING');
  loco.run = 1; run(rig, 0.8);
  ok(W.getWeaponStateName(rig) === 'RUNNING', 'RUNNING');
  loco.run = 0; loco.move = 0; loco.phase = -1; run(rig, 0.8);
  ok(W.getWeaponStateName(rig) === 'IDLE', 'back to IDLE');

  // 2) 공격
  let starts = 0, hits = 0;
  W.setWeaponHandlers(rig, { onStart: () => starts++, onHit: () => hits++ });
  let a = 0; for (let i = 0; i < 100; i++) if (W.startWeaponAttack(rig)) a++;   // 한 프레임에 100번 눌러도
  ok(a === 1 && starts === 1, 'spam in one frame -> 1 attack');
  ok(W.getWeaponStateName(rig) === 'ATTACKING', 'ATTACKING');
  ok(W.requestToggleWeapon(rig) === null, 'no unequip during attack');
  run(rig, 0.30); ok(hits === 1, 'hit frame fired once'); 
  ok(W.startWeaponAttack(rig) === false, 'no attack during cooldown');
  run(rig, 0.60);
  ok(W.getWeaponStateName(rig) === 'IDLE' && starts === 1, 'returns to IDLE, no repeat');
  run(rig, 3); ok(starts === 1 && hits === 1, 'attack never loops');
  ok(finite(rig), 'no NaN');

  // 쿨다운 직전 예약 입력은 정확히 1번만
  starts = 0;
  W.startWeaponAttack(rig); run(rig, 0.58);
  for (let i = 0; i < 50; i++) W.startWeaponAttack(rig);
  run(rig, 0.3);
  ok(starts === 2, 'buffered input starts exactly one extra attack (got ' + starts + ')');
  run(rig, 3); ok(starts === 2, 'no further repeats');

  // 3) 해제 + 반복 장착
  for (let i = 0; i < 20; i++) {
    run(rig, 0.8); ok(W.requestToggleWeapon(rig) === false, 'unequip ' + i);
    run(rig, 0.6); ok(W.getWeaponStateName(rig) === 'UNEQUIPPED' && !rig.wp.mount.visible, 'hidden after unequip');
    ok(W.requestToggleWeapon(rig) === true, 'equip ' + i);
  }
  run(rig, 0.9);
  ok(rig.bones.hand.children.length === 1, 'mount count stays 1 after 20 equip/unequip cycles');

  // 4) 프레임률이 달라도 장착 시간이 거의 같은지
  const r30 = makeRig(), r144 = makeRig();
  W.requestToggleWeapon(r30); W.requestToggleWeapon(r144);
  let t30 = 0, t144 = 0;
  while (W.getWeaponStateName(r30) !== 'IDLE' && t30 < 3) { frame(r30, 1 / 30); t30 += 1 / 30; }
  while (W.getWeaponStateName(r144) !== 'IDLE' && t144 < 3) { frame(r144, 1 / 144); t144 += 1 / 144; }
  ok(Math.abs(t30 - 0.75) < 0.05 && Math.abs(t144 - 0.75) < 0.05, 'equip time frame-rate independent (' + t30.toFixed(2) + ' / ' + t144.toFixed(2) + ')');

  // 5) 초기화
  W.resetWeapon(rig);
  ok(W.getWeaponStateName(rig) === 'UNEQUIPPED' && !W.isWeaponEquipped(rig), 'reset');
  run(rig, 0.5); ok(finite(rig), 'stable after reset');
}

// 6) 다른 플레이어
{
  const rig = makeRig();
  W.setRemoteWeapon(rig, true, true);
  ok(W.getWeaponStateName(rig) === 'IDLE', 'remote instant equip');
  ok(W.startWeaponAttack(rig, true) === true, 'remote attack accepted');
  ok(W.startWeaponAttack(rig, true) === false, 'remote duplicate attack ignored');
  run(rig, 1);
  W.setRemoteWeapon(rig, false); run(rig, 1);
  ok(W.getWeaponStateName(rig) === 'UNEQUIPPED', 'remote unequip');
  const never = makeRig(); W.setRemoteWeapon(never, false);
  ok(!never.wp, 'never-armed remote allocates nothing');
}

// 7) 코드 캐릭터(fallback) 경로
{
  const j = () => ({ rotation: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } } });
  const wrist = new Group();
  const rig = { kind: 'proc', R: { shoulder: j(), elbow: j(), wrist: Object.assign(wrist, j()) }, spine: j() };
  W.requestToggleWeapon(rig); run(rig, 1);
  ok(W.getWeaponStateName(rig) === 'IDLE' && wrist.children.length === 1, 'procedural equip');
  ok(Number.isFinite(rig.R.shoulder.rotation.x), 'procedural pose finite');
}

// 8) 평타 2종 번갈아 + 다른 플레이어는 서버가 준 방향 사용
{
  const rig = makeRig(); const sides = [];
  W.requestToggleWeapon(rig); run(rig, 1);
  W.setWeaponHandlers(rig, { onStart: (sd) => sides.push(sd) });
  for (let i = 0; i < 4; i++) { W.startWeaponAttack(rig); run(rig, 0.8); }
  ok(sides.join() === '0,1,0,1', 'slashes alternate 0,1,0,1 (got ' + sides.join() + ')');
  ok(finite(rig), 'finite after slashes');
  const rem = makeRig(); const rs = [];
  W.setRemoteWeapon(rem, true, true); W.setWeaponHandlers(rem, { onStart: (sd) => rs.push(sd) });
  W.startWeaponAttack(rem, true, 1); run(rem, 0.8); W.startWeaponAttack(rem, true, 1); run(rem, 0.8);
  ok(rs.join() === '1,1', 'remote uses side from server');
}

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
