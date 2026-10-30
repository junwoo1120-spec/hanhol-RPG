import * as THREE from 'three';
import { makeTerrain, WATER_LEVEL, PLAY_RADIUS, LANDMARKS } from './terrain.js';
import { buildVillage } from './village.js';
import { buildHouses, updateHouses, setRoomsHidden, setPortalTexture } from './buildings.js';
import {
  collideBuildings, collideRoom, nearestDoor, doorInfo, isDoorOpen, setDoorOpen, ROOMS, CORR_ROOM, roomEntry, roomExit, roomRet,
  roomFloorY, roomGhost, clampCameraRoom, clampCameraInRoom, innFloor, stairsInfo,
} from './village-layout.js';
import { makeHumanoid, animateHumanoid, humanReady } from './character.js';
import { requestToggleWeapon, setRemoteWeapon, startWeaponAttack, startWeaponSweep, setWeaponHandlers, isWeaponEquipped } from './weapon.js';
import { createNatureKit } from './nature.js';
import { createNatureWorld } from './nature-world.js';

// HTML 요소 선택 도우미
const $ = (id) => document.getElementById(id);

const S = 32;            // 청크 크기
const N = 32;            // 청크 분할 수
const VIEW = 5;          // 로딩 반경(청크 단위)
const UNLOAD = VIEW + 2;

const SPEED_SCALE = 1.05; // 전체 이동속도 배율 (이전 1.5의 0.7배)
const RUN_MULT = 2;       // 달리기 배율
const RUN_TOGGLE = true;  // true: Ctrl을 한 번 누르면 켜짐/꺼짐, false: 누르고 있는 동안만 달리기
const GRAVITY = 26;       // 중력
const JUMP_V = 10.5;      // 점프 힘

const FAST_MIN = 10;      // 속도 배율 최소
const FAST_MAX = 100;     // 속도 배율 최대 (서버 한도도 100)
const RES_HIGH = N;       // 평소 청크 해상도
const RES_LOW = 8;        // 빠르게 이동할 때 청크 해상도
const PITCH_LIMIT = 1.5; // 위아래 회전 한계 (이 이상 넘어가면 화면이 뒤집히므로 막음)
function wrapPitch(p) { return Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, p)); }

// 조작법 창에 표시할 내용 [키 목록, 설명]
const HELP_KEYBOARD = [
  [['W', 'A', 'S', 'D'], '이동'],
  [['Space'], '점프'],
  [['E'], '문 열기 / 집 들어가기 / 밖으로 나가기'],
  [['Ctrl'], '달리기 켜기/끄기'],
  [['Shift'], '시점 고정 켜기/끄기'],
  [['←', '→', '↑', '↓'], '화면 회전'],
  [['마우스'], '화면 회전 (화면 클릭 후)'],
  [['터치'], '화면 드래그로 회전, 짧게 톡 터치하면 검 공격'],
  [['F'], '속도 배율 켜기/끄기'],
  [['[', ']'], '속도 배율 -10 / +10'],
  [['1'], '나무검 장착/해제 (테스트)'],
  [['마우스 왼쪽'], '검 공격'],
  [['E'], '스킬: 휩쓸기 (문 근처에서는 문 열기). R, T는 빈 스킬 칸'],
  [['H'], '조작법 열기/닫기'],
  [['Esc'], '마우스 잠금 해제'],
];
const HELP_TOUCH = [
  [['조이스틱'], '이동 (왼쪽 아래)'],
  [['화면 드래그'], '화면 회전'],
  [['⤒'], '점프'],
  [['🏃'], '달리기 켜기/끄기'],
  [['🔒'], '시점 고정 켜기/끄기'],
  [['화면 톡 터치'], '검 공격 (나무검 장착 후)'],
  [['공격 버튼'], '처음 누르면 나무검 장착, 이후 공격'],
  [['오른쪽 스킬 칸 E R T'], 'E = 휩쓸기 (쿨타임 10초). R, T는 아직 빈 칸'],
  [['속도 패널'], '속도 배율 ×10~100'],
  [['하단 메뉴 버튼'], '인벤토리·장비·스킬·특성·상태창·퀘스트·거래 (단축키 없음)'],
];

// ============ RPG 스타일 UI ============
const GAME_CSS = `
#login{background:radial-gradient(ellipse at 50% 25%,#2d2350 0%,#140e26 60%,#0a0716 100%)}
#login h2{margin:0 0 6px;font:700 44px Georgia,'Noto Serif KR',serif;letter-spacing:8px;color:#f6e3a1;text-shadow:0 0 18px #c9922a,0 2px 0 #5b3d0a}
#login input{width:230px;text-align:center;color:#f6e3a1;background:#0e0a1c;border:2px solid #b8913f;border-radius:10px;outline:none}
#login input::placeholder{color:#8d7a4d}
#login #msg{min-height:20px;color:#ffb4a8;font-size:14px}
#modeBox{display:flex;flex-direction:column;align-items:center;gap:14px}
.mode-title{color:#f6e3a1;font:600 18px sans-serif}
.mode-row{display:flex;gap:14px;flex-wrap:wrap;justify-content:center}
.mode-note{color:#9b92b8;font:12px sans-serif}
.rpg-btn{cursor:pointer;color:#f6e3a1;font:600 16px/1.2 Georgia,'Noto Serif KR',serif;padding:14px 20px;min-width:190px;border-radius:12px;border:2px solid #d9b25c;background:linear-gradient(#3a2d5c,#1b1432);box-shadow:0 0 0 2px #0b0816,inset 0 0 12px rgba(217,178,92,.25),0 6px 18px rgba(0,0,0,.5)}
.rpg-btn small{display:block;margin-top:6px;font:400 12px sans-serif;color:#cdbf95}
.rpg-btn:hover{filter:brightness(1.25)}
body.touch,body.touch *{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}


.rt-stack{position:fixed;top:8px;right:8px;z-index:5;display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.speedpanel{width:190px;padding:8px;display:flex;flex-direction:column;gap:6px;border-radius:12px;background:rgba(20,14,38,.75);border:1px solid rgba(217,178,92,.75);color:#f6e3a1;font:600 13px sans-serif}
.speedpanel button{padding:7px 10px;font:700 14px sans-serif;border:1px solid #d9b25c;border-radius:8px;color:#fff;cursor:pointer}
.speedpanel .hint{font:400 11px sans-serif;opacity:.8}
body.touch .speedpanel{width:150px}
body.touch .speedpanel .hint{display:none}

.helpbtn{display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 12px 4px 8px;border-radius:8px;background:linear-gradient(#2a1f16,#150f0b);border:2px solid #8a6b3a;box-shadow:0 0 0 2px #0a0705,0 3px 10px rgba(0,0,0,.5);color:#f1dba4;font-family:'Galmuri11','Galmuri9','Malgun Gothic',sans-serif;font-weight:700;font-size:13px;text-shadow:-1px 0 #000,1px 0 #000,0 -1px #000,0 1px #000}
.helpbtn img{height:38px;width:auto;filter:drop-shadow(0 2px 3px rgba(0,0,0,.7))}
.helpbtn:hover{filter:brightness(1.25)}
.helppanel{display:none;box-sizing:border-box;width:250px;max-height:calc(100vh - 240px);overflow-y:auto;padding:10px 10px 8px;border-radius:6px;background:linear-gradient(#251b14,#16100c);border:3px solid #8a6b3a;box-shadow:0 0 0 2px #0a0705,inset 0 0 0 1px #4a3a22,0 6px 16px rgba(0,0,0,.55);color:#e8d3a0;font-family:'Galmuri11','Galmuri9','Malgun Gothic',sans-serif;font-size:12px;line-height:1.4}
.helppanel h4{margin:0 0 6px;text-align:center;font-size:15px;letter-spacing:3px;color:#f6e3a1;text-shadow:-1px 0 #000,1px 0 #000,0 -1px #000,0 1px #000}
.hrow{display:flex;align-items:center;gap:8px;padding:4px 0;border-top:1px dashed rgba(138,107,58,.5)}
.hrow.first{border-top:0}
.hk{flex:none;width:96px;display:flex;flex-wrap:wrap;gap:3px}
.kcap{padding:1px 5px;border-radius:3px;background:#3a2e20;border:1px solid #8a6b3a;border-bottom-width:3px;color:#fff3c4;font-size:11px;white-space:nowrap}
.hd{flex:1}
body.touch .helppanel{width:210px;font-size:11px}
body.touch .hk{width:76px}

.chips{display:flex;gap:6px;pointer-events:none}
.chip{padding:3px 10px;border-radius:12px;font:600 12px sans-serif;background:rgba(20,14,38,.75);color:#8d8aa0;border:1px solid #4a3f72}
.chip.on{color:#201500;background:linear-gradient(#f6e3a1,#d9b25c);border-color:#fff3c4}
.hintbar{pointer-events:none;color:#e9ddb4;font:12px sans-serif;text-shadow:0 0 3px #000;opacity:.85}

.joy-base{position:fixed;left:26px;bottom:28px;width:130px;height:130px;border-radius:50%;z-index:6;touch-action:none;background:radial-gradient(circle,rgba(20,14,38,.35) 55%,rgba(20,14,38,.65));border:3px solid rgba(217,178,92,.85);box-shadow:0 0 0 3px rgba(0,0,0,.35),inset 0 0 18px rgba(217,178,92,.25)}
.joy-base::before{content:'';position:absolute;inset:18px;border-radius:50%;border:1px dashed rgba(217,178,92,.45)}
.joy-knob{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#f6e3a1,#b8913f 70%);border:2px solid #fff3c4;box-shadow:0 3px 10px rgba(0,0,0,.6);pointer-events:none}
.tbtn{position:fixed;z-index:6;touch-action:none;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#f6e3a1;font:700 11px sans-serif;background:radial-gradient(circle at 35% 30%,#4b3a7c,#1d1535);border:3px solid #d9b25c;box-shadow:0 0 0 3px rgba(0,0,0,.35),0 4px 14px rgba(0,0,0,.55),inset 0 0 12px rgba(217,178,92,.25)}
.tbtn span{font-size:22px;line-height:1}
.tbtn.press{transform:scale(.92);filter:brightness(1.5)}
.tbtn.on{background:radial-gradient(circle at 35% 30%,#f6e3a1,#b8913f);color:#2a1a00}
.tbtn.jump{right:28px;bottom:28px;width:92px;height:92px}
.tbtn.jump span{font-size:30px}
.tbtn.atk,.tbtn.lock{border:0;border-radius:0;box-shadow:none;background-color:transparent;background-repeat:no-repeat;background-position:center;background-size:contain;filter:drop-shadow(0 3px 6px rgba(0,0,0,.6))}
.tbtn.atk{right:37px;bottom:130px;width:70px;height:70px;background-image:url(/ui/attack_btn.png)}
.tbtn.atk span,.tbtn.lock span{display:none}
.tbtn.atk.press,.tbtn.lock.press{filter:brightness(1.4) drop-shadow(0 3px 6px rgba(0,0,0,.6))}
.tbtn.lock.on{background:url(/ui/lock_btn.png) center/contain no-repeat;filter:brightness(1.3) drop-shadow(0 0 8px #f6d36b)}
.tbtn .lbl{position:absolute;left:50%;bottom:-4px;transform:translateX(-50%);font:700 13px 'Galmuri11','Galmuri9','Malgun Gothic',sans-serif;font-style:normal;color:#fff;white-space:nowrap;pointer-events:none;text-shadow:-1px 0 #000,1px 0 #000,0 -1px #000,0 1px #000,0 2px 3px #000}
.tbtn.lock .lbl{font-size:11px}
.tbtn.run{right:132px;bottom:34px;width:58px;height:58px}
.tbtn.lock{right:0;bottom:0;width:30px;height:30px;background-image:url(/ui/lock_btn.png)}

.skillbar{display:flex;position:fixed;right:4px;top:40%;z-index:6;flex-direction:column;gap:6px;transform-origin:right center;pointer-events:none}
body.touch .skillbar{transform:translateY(-50%) scale(calc(var(--ui,1) * .5))}
body.kbd .skillbar{transform:translateY(-50%) scale(var(--sk,1))}
.skill-slot{position:relative;width:56px;height:56px;box-sizing:border-box;pointer-events:auto;touch-action:none;display:flex;align-items:center;justify-content:center}
.skill-slot::before{content:'';position:absolute;inset:0;background:#323a3e;border:2px solid #f0f2e6;box-shadow:inset 0 0 0 2px rgba(0,0,0,.45),0 3px 8px rgba(0,0,0,.55)}
.skill-slot .k{position:absolute;top:0;left:50%;transform:translateX(-50%);z-index:3;font:700 9px 'Galmuri9','Galmuri11',sans-serif;font-style:normal;color:#fff;line-height:11px;text-shadow:-1px 0 #000,1px 0 #000,0 -1px #000,0 1px #000}
.skill-slot .n{position:relative;z-index:2;font:700 17px 'Galmuri11','Galmuri9','Malgun Gothic',sans-serif;color:#fff;white-space:nowrap;text-shadow:-2px 0 #000,2px 0 #000,0 -2px #000,0 2px #000,-1px -1px #000,1px 1px #000,-1px 1px #000,1px -1px #000}
.skill-slot .n.s{font-size:13px}
.skill-slot .cdv{position:absolute;left:2px;right:2px;bottom:2px;height:0;background:rgba(0,0,0,.68);z-index:4}
.skill-slot .cdn{position:absolute;z-index:5;font:700 22px 'Galmuri11',sans-serif;font-style:normal;color:#ffe9a8;text-shadow:-2px 0 #000,2px 0 #000,0 -2px #000,0 2px #000}
.skill-slot.cool .n{opacity:.45}
.skill-slot.press{filter:brightness(1.35)}
.toast{position:fixed;left:50%;top:70px;transform:translateX(-50%);padding:6px 14px;border-radius:14px;background:rgba(20,14,38,.9);color:#f6e3a1;border:1px solid #d9b25c;font:600 13px sans-serif;z-index:9;pointer-events:none;opacity:0;transition:opacity .25s}
.toast.show{opacity:1}
body.touch .joy-base{transform:scale(var(--ui,1));transform-origin:left bottom}
.tgroup{display:none}
body.touch .tgroup{display:block;position:fixed;right:0;bottom:0;width:230px;height:290px;z-index:6;pointer-events:none;transform:scale(var(--ui,1));transform-origin:right bottom}
body.touch .tgroup .tbtn{position:absolute;pointer-events:auto}
body.touch .bottom-wrap{transform:translateX(-50%) scale(var(--ui,1));transform-origin:center bottom}
body.touch .rt-stack{transform:scale(var(--ui,1));transform-origin:right top}
.cross{position:fixed;left:50%;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;border:2px solid rgba(255,255,255,.9);box-shadow:0 0 4px #000;z-index:5;pointer-events:none;display:none}

.bottom-wrap{position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:5;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;width:min(500px,94vw)}
.bottom-wrap .hintbar{white-space:normal;text-align:center;font-size:11px}
.bui{width:100%;display:flex;flex-direction:column;align-items:center;font-family:'Galmuri11','Galmuri9','Malgun Gothic',sans-serif;font-weight:700;color:#fff;text-shadow:-1px 0 #000,1px 0 #000,0 -1px #000,0 1px #000}

.bui-lv{position:relative;z-index:2;width:150px;height:40px;margin-bottom:-6px;padding:3px;box-sizing:border-box;background:linear-gradient(#6a6a72,#2a2a30);clip-path:polygon(9% 0,91% 0,100% 50%,91% 100%,9% 100%,0 50%)}
.bui-lv span{display:flex;align-items:center;justify-content:center;height:100%;font-size:21px;letter-spacing:2px;background:#0d0d10;clip-path:polygon(9% 0,91% 0,100% 50%,91% 100%,9% 100%,0 50%)}

.hpmp{position:relative;display:flex;align-items:center;width:100%;height:30px;margin-top:4px}
.hpmp-ic{position:relative;z-index:2;flex:none;width:34px;height:34px;border-radius:50%;box-sizing:border-box;background:radial-gradient(#1a1a1f,#08080a);border:3px solid #55555d;display:flex;align-items:center;justify-content:center}
.hpmp-ic img{width:20px;height:20px;object-fit:contain}
.hpmp-bar{flex:1;height:26px;margin-left:-14px;padding:3px 3px 3px 18px;box-sizing:border-box;background:linear-gradient(#62626a,#2a2a30);clip-path:polygon(0 0,calc(100% - 13px) 0,100% 50%,calc(100% - 13px) 100%,0 100%)}
.hpmp-in{position:relative;height:100%;overflow:hidden;background:#070708;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 50%,calc(100% - 10px) 100%,0 100%)}
.hpmp-in i{position:absolute;left:0;top:0;bottom:0;display:block}
.hp .hpmp-in i{background:linear-gradient(#f56a5c,#d82424 55%,#a81414)}
.mp .hpmp-in i{background:linear-gradient(#46a8ff,#1a74e6 55%,#0b56b8)}
.hpmp-in span{position:relative;display:block;text-align:center;font-size:13px;line-height:20px}

.bui-menu{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;width:100%;margin-top:10px}
.mbtn{pointer-events:auto;cursor:pointer;position:relative;aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:8px 4px 6px;box-sizing:border-box;background:radial-gradient(circle at 50% 40%,#1c1c22,#0a0a0c);border:3px solid #3e3e46;border-radius:3px;box-shadow:inset 0 0 0 1px #000,0 2px 6px rgba(0,0,0,.6);transition:transform .1s,filter .1s}
.mbtn::before{content:'';position:absolute;inset:-3px;pointer-events:none;background:linear-gradient(#7a7a84,#7a7a84) 0 0/7px 7px no-repeat,linear-gradient(#7a7a84,#7a7a84) 100% 0/7px 7px no-repeat,linear-gradient(#7a7a84,#7a7a84) 0 100%/7px 7px no-repeat,linear-gradient(#7a7a84,#7a7a84) 100% 100%/7px 7px no-repeat}
.mbtn img{width:56%;height:auto;max-height:58%;object-fit:contain;margin-top:2px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.7))}
.mbtn b{font-size:13px;line-height:1.1;white-space:nowrap}
.mbtn:hover{filter:brightness(1.25)}
.mbtn.flash,.mbtn:active{transform:scale(.94);filter:brightness(1.7)}

body.touch .bottom-wrap{width:clamp(250px,calc(100vw - 390px),400px);bottom:6px}
body.touch .bottom-wrap .hintbar{display:none}
body.touch .bui-lv{width:100px;height:28px}
body.touch .bui-lv span{font-size:14px}
body.touch .hpmp{height:22px;margin-top:2px}
body.touch .hpmp-ic{width:24px;height:24px;border-width:2px}
body.touch .hpmp-ic img{width:14px;height:14px}
body.touch .hpmp-bar{height:18px;padding:2px 2px 2px 14px;margin-left:-10px}
body.touch .hpmp-in span{font-size:10px;line-height:14px}
body.touch .bui-menu{width:100%;gap:3px;margin-top:6px}
body.touch .mbtn{padding:3px 1px 2px;border-width:2px}
body.touch .mbtn b{font-size:6px}
`;

(function injectStyles() {
  const st = document.createElement('style');
  st.textContent = GAME_CSS;
  document.head.appendChild(st);

  // 픽셀 글꼴 (못 불러오면 기본 글꼴로 보임)
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://cdn.jsdelivr.net/npm/galmuri@latest/dist/galmuri.css';
  document.head.appendChild(fontLink);
})();

// 단말기 화면 크기에 맞춘 UI 배율 (짧은 쪽 400px = 1배, 0.75~1.6배)
function computeUiScale() {
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  return Math.max(0.75, Math.min(1.6, shortSide / 400));
}

// 플레이어 라벨
// 캐릭터 표시 배율 (모델·이름표·카메라에 공통 적용)
const CHAR_SCALE = 1.4;   // 캐릭터 크기 (모델·이름표·시선 높이)
const CAM_SCALE = 1;    // 카메라 거리 배율 (CHAR_SCALE보다 작게 두면 화면에서 더 크게 보임)

function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;

  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#000';
  ctx.strokeText(text, 128, 44);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 128, 44);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false
    })
  );

  sprite.scale.set(3 * CHAR_SCALE, 0.75 * CHAR_SCALE, 1);
  sprite.position.y = 2.6 * CHAR_SCALE;

  return sprite;
}

// 플레이어 모델
function makeAvatar(nick, color) {
  const group = new THREE.Group();

  // 사람 모양 캐릭터 (children[0]) + 닉네임 표시 (children[1])
  const body = makeHumanoid(color);
  body.scale.setScalar(CHAR_SCALE);
  group.add(body);
  group.add(makeLabel(nick));
  group.userData.rig = body.userData.rig;

  return group;
}

// 서버 데이터에서 플레이어 목록을 배열로 변환
function normalizePlayers(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (data && typeof data === 'object') {
    if (Array.isArray(data.players)) return data.players;
    if (Array.isArray(data.list)) return data.list;

    return Object.entries(data).map(([pid, p]) => {
      if (Array.isArray(p)) {
        return [pid, ...p.slice(1)];
      }

      return { id: pid, ...p };
    });
  }

  console.error('알 수 없는 state 데이터 형식:', data);
  return [];
}

// 플레이어 데이터 해석
function parsePlayer(p) {
  if (Array.isArray(p)) {
    // [id, nick, x, y, z, ry]
    return {
      id: p[0],
      nick: p[1],
      x: p[2],
      y: p[3],
      z: p[4],
      ry: p[5],
      eq: p[6] === 1,
      level: Number(p[7]) || 1
    };
  }

  if (p && typeof p === 'object') {
    return {
      id: p.id ?? p.pid,
      nick: p.nick ?? p.name ?? '플레이어',
      x: p.x,
      y: p.y ?? 0,
      z: p.z,
      ry: p.ry ?? 0,
      eq: !!p.eq,
      level: Number(p.level) || 1
    };
  }

  return null;
}

// ============ 시작 화면: 닉네임 -> 조작 방식 선택 -> 접속 ============
$('join').classList.add('rpg-btn');
$('nick').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('join').click();
});

function resetLogin(message) {
  $('login').style.display = 'flex';
  $('nick').style.display = '';
  $('join').style.display = '';
  $('join').disabled = false;
  const box = $('modeBox');
  if (box) box.remove();
  $('msg').textContent = message || '';
}

function showModeSelect(nick) {
  $('nick').style.display = 'none';
  $('join').style.display = 'none';
  $('msg').textContent = '';

  const box = document.createElement('div');
  box.id = 'modeBox';

  const title = document.createElement('div');
  title.className = 'mode-title';
  title.textContent = nick + '님, 조작 방식을 골라주세요';

  const row = document.createElement('div');
  row.className = 'mode-row';

  const makeChoice = (icon, name, sub, mode) => {
    const b = document.createElement('button');
    b.className = 'rpg-btn';
    const t = document.createElement('div');
    t.textContent = icon + ' ' + name;
    const s = document.createElement('small');
    s.textContent = sub;
    b.append(t, s);
    b.addEventListener('click', () => {
      box.style.display = 'none';
      connect(nick, mode);
    });
    return b;
  };

  row.append(
    makeChoice('⌨️', '키보드', 'WASD · 마우스 / 방향키 / 터치', 'keyboard'),
    makeChoice('📱', '터치스크린', '조이스틱 · 버튼', 'touch')
  );

  const note = document.createElement('div');
  note.className = 'mode-note';
  note.textContent = '터치스크린은 가로 화면을 추천해요';

  box.append(title, row, note);
  $('login').appendChild(box);
}

$('join').onclick = () => {
  showModeSelect($('nick').value.trim() || '플레이어');
};

async function connect(nick, mode) {
  $('msg').textContent = '서버에 연결 중...';
  await humanReady; // GLB 로딩이 끝난 뒤에 캐릭터를 만들도록 대기

  const socket = io();

  socket.on('connect', () => {
    socket.emit('join', { nick });
  });

  socket.on('connect_error', (err) => {
    console.error('서버 연결 오류:', err);
    resetLogin('서버 연결에 실패했습니다.');
  });

  socket.on('full', () => {
    resetLogin('서버가 가득 찼어요 (최대 20명)');
  });

  socket.on('init', (data) => {
    if (!data || !data.id) {
      console.error('잘못된 init 데이터:', data);
      resetLogin('캐릭터 초기화에 실패했습니다.');
      return;
    }

    $('msg').textContent = '';

    try {
      boot(socket, data, nick, mode);
    } catch (err) {
      console.error('게임 시작 오류:', err);
      resetLogin('게임 시작 오류: ' + err.message);
    }
  });
}

function boot(socket, { id, seed }, nick, mode) {
  const touchMode = mode === 'touch';
  let uiScale = touchMode ? computeUiScale() : 1;
  document.body.classList.add(touchMode ? 'touch' : 'kbd');
  $('login').style.display = 'none';

  const T = makeTerrain(seed);

  // 렌더러
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, touchMode ? 1.5 : 2));
  document.body.appendChild(renderer.domElement);

  renderer.domElement.style.position = 'fixed';
  renderer.domElement.style.inset = '0';
  renderer.domElement.style.zIndex = '0';
  renderer.domElement.style.touchAction = 'none';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa8c8e8);
  scene.fog = new THREE.Fog(0xa8c8e8, 70, VIEW * S - 8);

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    400
  );

  scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 0.9));

  const sun = new THREE.DirectionalLight(0xfff2d0, 1.0);
  sun.position.set(80, 120, 40);
  scene.add(sun);

  // 물: 텍스처 + 물살(흐르는 무늬) + 위아래로 출렁이는 파도
  // 안개가 152 밖은 가리므로 물 판은 플레이어 주변 400칸이면 충분 (촘촘하게 나눠 파도를 표현)
  const WATER_SIZE = 400;
  const WATER_SEG = 200;
  const WATER_STEP = WATER_SIZE / WATER_SEG; // 격자 한 칸 크기

  const waterLoader = new THREE.TextureLoader();
  const loadWaterTex = (url) => {
    const t = waterLoader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  };

  // 시간 값 (물과 용암이 같이 씀)
  const waterUniforms = {
    uTime: { value: 0 },
    uRipple: { value: loadWaterTex('/textures/water_ripple.jpg') },
    uBlotch: { value: loadWaterTex('/textures/water_blotch.jpg') },
  };

  const waterMat = new THREE.MeshLambertMaterial({
    color: 0x2f6fb5,
    transparent: true,
    opacity: 0.9
  });

  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.uniforms.uRipple = waterUniforms.uRipple;
    shader.uniforms.uBlotch = waterUniforms.uBlotch;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
        'uniform float uTime;\n' +
        'varying vec2 vWaterXZ;\n' +
        'varying vec2 vWaveSlope;\n' +
        'varying float vWaveH;'
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
        vec2 wxz = wp0.xz;
        // 방향과 크기가 다른 파도 4겹 (파장 약 39, 22, 12, 7)
        float ph1 = dot(wxz, vec2( 0.80,  0.60)) * 0.16 + uTime * 1.2;
        float ph2 = dot(wxz, vec2(-0.55,  0.83)) * 0.29 + uTime * 1.6;
        float ph3 = dot(wxz, vec2( 0.30, -0.95)) * 0.52 + uTime * 2.1;
        float ph4 = dot(wxz, vec2(-0.95, -0.30)) * 0.90 + uTime * 2.7;
        float wh = sin(ph1) * 0.28 + sin(ph2) * 0.16 + sin(ph3) * 0.08 + sin(ph4) * 0.04;
        float c1 = cos(ph1) * 0.28 * 0.16;
        float c2 = cos(ph2) * 0.16 * 0.29;
        float c3 = cos(ph3) * 0.08 * 0.52;
        float c4 = cos(ph4) * 0.04 * 0.90;
        float wdx = (c1 * 0.80 - c2 * 0.55 + c3 * 0.30 - c4 * 0.95) * 2.5;
        float wdz = (c1 * 0.60 + c2 * 0.83 - c3 * 0.95 - c4 * 0.30) * 2.5;
        vec3 objectNormal = normalize(vec3(-wdx, 1.0, -wdz));`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed.y += wh;
        vWaterXZ = wxz;
        vWaveSlope = vec2(wdx, wdz);
        vWaveH = wh;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
        'uniform float uTime;\n' +
        'uniform sampler2D uRipple;\n' +
        'uniform sampler2D uBlotch;\n' +
        'varying vec2 vWaterXZ;\n' +
        'varying vec2 vWaveSlope;\n' +
        'varying float vWaveH;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        const float WS1 = 0.020;
        const float WS2 = 0.030;
        vec2 wq1 = vWaterXZ * WS1 + vec2(uTime * 0.008, uTime * 0.005);
        vec2 wq2 = vWaterXZ * WS2 + vec2(-uTime * 0.007, uTime * 0.010) + vec2(0.37, 0.61);
        vec2 wq3 = vWaterXZ * 0.012 + vec2(uTime * 0.004, -uTime * 0.003);
        vec3 wr1 = texture2D(uRipple, wq1).rgb;
        vec3 wr2 = texture2D(uRipple, wq2).rgb;
        vec3 wb = texture2D(uBlotch, wq3).rgb;
        float wl1 = dot(wr1, vec3(0.333));
        float wl2 = dot(wr2, vec3(0.333));
        vec3 wtex = mix((wr1 + wr2) * 0.5, wb, 0.2) * 1.3;
        float wspark = smoothstep(0.68, 0.9, max(wl1, wl2));
        diffuseColor.rgb = mix(diffuseColor.rgb, wtex, 0.9) + vec3(wspark * 0.25);
        // 파도 마루는 살짝 밝고 골은 살짝 어둡게
        diffuseColor.rgb *= 1.0 + vWaveH * 0.25;
        diffuseColor.rgb += vec3(smoothstep(0.30, 0.50, vWaveH) * 0.10);`
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        {
          float we = 1.5 / 512.0;
          float h1x = dot(texture2D(uRipple, wq1 + vec2(we, 0.0)).rgb, vec3(0.333));
          float h1z = dot(texture2D(uRipple, wq1 + vec2(0.0, we)).rgb, vec3(0.333));
          float h2x = dot(texture2D(uRipple, wq2 + vec2(we, 0.0)).rgb, vec3(0.333));
          float h2z = dot(texture2D(uRipple, wq2 + vec2(0.0, we)).rgb, vec3(0.333));
          float gx = clamp(((h1x - wl1) * WS1 + (h2x - wl2) * WS2) / we, -2.0, 2.0);
          float gz = clamp(((h1z - wl1) * WS1 + (h2z - wl2) * WS2) / we, -2.0, 2.0);
          vec3 nw = normalize(vec3(-gx * 0.4 - vWaveSlope.x, 1.0, -gz * 0.4 - vWaveSlope.y));
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`
      );
  };

  // 물은 플레이어 주변에 배치
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, WATER_SEG, WATER_SEG).rotateX(-Math.PI / 2),
    waterMat
  );

  water.position.y = WATER_LEVEL;
  scene.add(water);

  // 시작마을 터 (선으로만 표시)
  buildVillage(scene);
  buildHouses(scene);   // 여관 + 마을 집들

  // 청크 공통 인덱스 (해상도별로 한 번만 만들어 재사용)
  const indexCache = {};

  function getIndex(res) {
    if (indexCache[res]) return indexCache[res];

    const idx = [];
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const a = z * (res + 1) + x;
        const b = a + 1;
        const c = a + res + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }

    indexCache[res] = new THREE.BufferAttribute(new Uint16Array(idx), 1);
    return indexCache[res];
  }

  // 땅 텍스처 (잔디/흙/모래/돌/용암/눈/얼음)
  const texLoader = new THREE.TextureLoader();
  const loadTex = (url) => {
    const t = texLoader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  };
  const texGrass = loadTex('/textures/grass.jpg');           // 평원: 일반 잔디
  const texGold = loadTex('/textures/grass_gold.jpg');       // 평원: 연한 누런 잔디
  const texJungle = loadTex('/textures/grass_dark.jpg');     // 정글: 진한 잔디
  const texDirt = loadTex('/textures/dirt.jpg');             // 평원: 흙 얼룩
  const texVillage = loadTex('/textures/village_dirt.jpg');  // 마을 흙바닥
  const texSand = loadTex('/textures/desert_sand.jpg');      // 사막 모래
  const texRock = loadTex('/textures/rock.jpg');             // 화산: 일반 돌
  const texLavaRock = loadTex('/textures/lava_rock.jpg');    // 화산: 용암 섞인 돌
  const texLava = loadTex('/textures/lava.jpg');             // 화산: 분출구 용암
  const texSnow = loadTex('/textures/snow.jpg');             // 설원: 눈
  const texSnowRock = loadTex('/textures/snow_rock.jpg');    // 설원: 눈 덮힌 바위
  const texIce = loadTex('/textures/ice.jpg');               // 설원: 얼음

  // 자연 오브젝트(나무·바위·풀·꽃 등): 땅 텍스처와 시간 uniform을 공유해서 GPU 중복 없이 쓴다.
  // 지형별 배치는 nature-placement.js, 청크별 인스턴싱/거리별 LOD는 nature-world.js
  const natureKit = createNatureKit({
    time: waterUniforms.uTime,
    textures: { grass: texGrass, grass_gold: texGold, grass_dark: texJungle, dirt: texDirt, village_dirt: texVillage, desert_sand: texSand, rock: texRock, lava_rock: texLavaRock, snow: texSnow, snow_rock: texSnowRock, ice: texIce },
  });
  const nature = createNatureWorld({ scene, kit: natureKit, T, seed, chunkSize: S });

  const terrainMat = new THREE.MeshLambertMaterial({
    vertexColors: true
  });

  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrass = { value: texGrass };
    shader.uniforms.uGold = { value: texGold };
    shader.uniforms.uJungle = { value: texJungle };
    shader.uniforms.uDirt = { value: texDirt };
    shader.uniforms.uVillage = { value: texVillage };
    shader.uniforms.uSand = { value: texSand };
    shader.uniforms.uRock = { value: texRock };
    shader.uniforms.uLavaRock = { value: texLavaRock };
    shader.uniforms.uLava = { value: texLava };
    shader.uniforms.uSnow = { value: texSnow };
    shader.uniforms.uSnowRock = { value: texSnowRock };
    shader.uniforms.uIce = { value: texIce };
    shader.uniforms.uTime = waterUniforms.uTime;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
        'uniform float uTime;\n' +
        'attribute vec3 detail;\n' +
        'attribute vec3 detail2;\n' +
        'attribute vec3 detail3;\n' +
        'attribute vec3 detail4;\n' +
        'varying vec3 vDetail;\n' +
        'varying vec3 vDetail2;\n' +
        'varying vec3 vDetail3;\n' +
        'varying vec3 vDetail4;\n' +
        'varying float vNy;\n' +
        'varying vec2 vWorldXZ;'
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vDetail = detail;
        vDetail2 = detail2;
        vDetail3 = detail3;
        vDetail4 = detail4;
        vNy = normal.y;
        vec3 wpL = (modelMatrix * vec4(position, 1.0)).xyz;
        vWorldXZ = wpL.xz;
        // 분화구 용암 표면이 위아래로 일렁임 (용암 가장자리는 0이라 땅과 갈라지지 않음)
        float lpV = clamp(detail3.z, 0.0, 1.0);
        transformed.y += lpV * (
          sin(wpL.x * 0.55 + uTime * 1.4) * 0.07 +
          sin(wpL.z * 0.47 - uTime * 1.2) * 0.07 +
          sin((wpL.x + wpL.z) * 0.33 + uTime * 0.9) * 0.05
        );`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
        'uniform float uTime;\n' +
        'uniform sampler2D uGrass;\n' +
        'uniform sampler2D uGold;\n' +
        'uniform sampler2D uJungle;\n' +
        'uniform sampler2D uDirt;\n' +
        'uniform sampler2D uVillage;\n' +
        'uniform sampler2D uSand;\n' +
        'uniform sampler2D uRock;\n' +
        'uniform sampler2D uLavaRock;\n' +
        'uniform sampler2D uLava;\n' +
        'uniform sampler2D uSnow;\n' +
        'uniform sampler2D uSnowRock;\n' +
        'uniform sampler2D uIce;\n' +
        'varying vec3 vDetail;\n' +
        'varying vec3 vDetail2;\n' +
        'varying vec3 vDetail3;\n' +
        'varying vec3 vDetail4;\n' +
        'varying float vNy;\n' +
        'varying vec2 vWorldXZ;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 lavaGlow = vec3(0.0);
        {
          vec2 p = vWorldXZ;

          // 평원: 일반 잔디 + 연한 누런 잔디
          vec3 a1 = texture2D(uGrass, p * 0.25).rgb;
          float l1 = dot(texture2D(uGrass, p * 0.04).rgb, vec3(0.333));
          vec3 g1 = a1 * (0.6 + 0.8 * l1);

          vec3 a2 = texture2D(uGold, p * 0.22).rgb;
          float l2 = dot(texture2D(uGold, p * 0.035).rgb, vec3(0.333));
          vec3 g2 = a2 * (0.6 + 0.8 * l2);

          vec3 plainCol = mix(g1, g2, smoothstep(0.35, 0.65, vDetail.z));

          // 정글: 진한 잔디
          vec3 a4 = texture2D(uJungle, p * 0.22).rgb;
          float l4 = dot(texture2D(uJungle, p * 0.035).rgb, vec3(0.333));
          vec3 jungleCol = a4 * (0.6 + 1.6 * l4);

          // 사막: 모래
          vec3 a6 = texture2D(uSand, p * 0.2).rgb;
          float l6 = dot(texture2D(uSand, p * 0.03).rgb, vec3(0.333));
          vec3 sandCol = a6 * (0.75 + 0.35 * l6);

          // 평원 흙 얼룩
          vec3 a3 = texture2D(uDirt, p * 0.2).rgb;
          float l3 = dot(texture2D(uDirt, p * 0.033).rgb, vec3(0.333));
          vec3 dirtCol = a3 * (0.6 + 1.1 * l3);

          // 마을 흙바닥
          vec3 a5 = texture2D(uVillage, p * 0.15).rgb;
          float l5 = dot(texture2D(uVillage, p * 0.03).rgb, vec3(0.333));
          vec3 villageCol = a5 * (0.7 + 0.6 * l5);

          // 화산: 일반 돌 + 용암 섞인 돌
          vec3 rk = texture2D(uRock, p * 0.12).rgb;
          float rkl = dot(texture2D(uRock, p * 0.02).rgb, vec3(0.333));
          vec3 rockCol = rk * (1.4 + 2.0 * rkl);

          vec3 lr = texture2D(uLavaRock, p * 0.09).rgb;
          vec3 lavaRockCol = lr * 1.4;

          float lrMix = clamp(vDetail3.y, 0.0, 1.0);
          float volc = clamp(vDetail3.x, 0.0, 1.0);
          vec3 volcCol = mix(rockCol, lavaRockCol, lrMix);

          // 용암 섞인 돌의 주황 균열은 스스로 빛남
          float vein = smoothstep(0.35, 0.75, lr.r) * lrMix * volc;
          lavaGlow += lr * vein * 0.7;

          // 분출구 용암: 액체처럼 출렁이며 흐르고 밝기가 맥동함
          vec2 lw = vec2(sin(p.y * 0.30 + uTime * 0.9), cos(p.x * 0.27 + uTime * 0.8)) * 0.035;
          vec2 lq1 = p * 0.040 + lw + vec2(uTime * 0.018, uTime * 0.010);
          vec2 lq2 = p * 0.065 - lw * 1.4 + vec2(-uTime * 0.014, uTime * 0.022) + vec2(0.31, 0.57);
          vec3 lava1 = texture2D(uLava, lq1).rgb;
          vec3 lava2 = texture2D(uLava, lq2).rgb;
          vec3 lavaCol = mix(lava1, lava2, 0.5);
          float lflow = dot(lavaCol, vec3(0.333));
          lavaCol *= 0.85 + 0.25 * sin(uTime * 1.3 + lflow * 6.0);
          float lp = clamp(vDetail3.z, 0.0, 1.0);
          lavaGlow += lavaCol * lp * 0.9;

          // 설원: 눈 / 눈 덮힌 바위 / 얼음
          // (반복 무늬가 티 나지 않도록 각도와 크기를 달리해 두 번 읽어서 섞음)
          vec2 pr = vec2(p.x * 0.8 - p.y * 0.6, p.x * 0.6 + p.y * 0.8);
          float tb = smoothstep(0.35, 0.65, vDetail.z);

          vec3 snowCol = texture2D(uSnow, p * 0.10).rgb * 0.92;

          vec3 srA = texture2D(uSnowRock, p * 0.085).rgb;
          vec3 srB = texture2D(uSnowRock, pr * 0.061 + vec2(0.23, 0.47)).rgb;
          vec3 snowRockCol = mix(srA, srB, tb) * 1.7;

          vec3 icA = texture2D(uIce, p * 0.055).rgb;
          vec3 icB = texture2D(uIce, pr * 0.038 + vec2(0.61, 0.17)).rgb;
          vec3 iceCol = mix(icA, icB, tb) * 1.15;

          // 가파른 곳은 바위, 바위 덩어리의 평평한 윗면은 눈이 쌓임
          float slopeRock = 1.0 - smoothstep(0.55, 0.85, vNy);
          float patchRock = clamp(vDetail4.y, 0.0, 1.0) * (1.0 - smoothstep(0.82, 0.95, vNy));
          float rockAmt = clamp(max(slopeRock, patchRock), 0.0, 1.0);
          vec3 snowGround = mix(snowCol, snowRockCol, rockAmt);

          diffuseColor.rgb = mix(diffuseColor.rgb, plainCol, clamp(vDetail.x, 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, jungleCol, clamp(vDetail2.y, 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, sandCol, clamp(vDetail2.z, 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, dirtCol, clamp(vDetail.y, 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, villageCol, clamp(vDetail2.x, 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, volcCol, volc);
          diffuseColor.rgb = mix(diffuseColor.rgb, lavaCol * 0.45, lp);
          diffuseColor.rgb = mix(diffuseColor.rgb, snowGround, clamp(vDetail4.x, 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, iceCol, clamp(vDetail4.z, 0.0, 1.0));
        }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n' +
        'totalEmissiveRadiance += lavaGlow;'
      );
  };

  const chunks = new Map();
  const E = 0.5;
  let fast = false;
  let fastMult = FAST_MAX;

  // 청크 생성 (res가 클수록 정밀)
  function buildChunk(cx, cz, res) {
    const key = `${cx},${cz}`;

    const old = chunks.get(key);
    if (old) {
      scene.remove(old);
      old.geometry.dispose();
    }

    const V = (res + 1) * (res + 1);
    const pos = new Float32Array(V * 3);
    const nor = new Float32Array(V * 3);
    const col = new Float32Array(V * 3);
    const det = new Float32Array(V * 3);
    const det2 = new Float32Array(V * 3);
    const det3 = new Float32Array(V * 3);
    const det4 = new Float32Array(V * 3);

    let i = 0;

    for (let z = 0; z <= res; z++) {
      for (let x = 0; x <= res; x++, i++) {
        const wx = cx * S + (x * S) / res;
        const wz = cz * S + (z * S) / res;

        const h = T.height(wx, wz);

        let nx = T.height(wx - E, wz) - T.height(wx + E, wz);
        let ny = 2 * E;
        let nz = T.height(wx, wz - E) - T.height(wx, wz + E);

        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;

        let c = T.color(wx, wz, h);

        const rock = 1 - Math.min(1, Math.max(0, (ny - 0.40) / 0.2));

        c = [
          c[0] + (0.45 - c[0]) * rock,
          c[1] + (0.43 - c[1]) * rock,
          c[2] + (0.40 - c[2]) * rock
        ];

        pos.set([(x * S) / res, h, (z * S) / res], i * 3);
        nor.set([nx, ny, nz], i * 3);
        col.set(c, i * 3);

        const d = T.detail(wx, wz, h);
        det.set([d[0], d[1], d[2]], i * 3);
        det2.set([d[3], d[4], d[5]], i * 3);
        det3.set([d[6], d[7], d[8]], i * 3);
        det4.set([d[9], d[10], d[11]], i * 3);
      }
    }

    const geo = new THREE.BufferGeometry();

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('detail', new THREE.BufferAttribute(det, 3));
    geo.setAttribute('detail2', new THREE.BufferAttribute(det2, 3));
    geo.setAttribute('detail3', new THREE.BufferAttribute(det3, 3));
    geo.setAttribute('detail4', new THREE.BufferAttribute(det4, 3));
    geo.setIndex(getIndex(res));
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, terrainMat);
    mesh.position.set(cx * S, 0, cz * S);
    mesh.userData = { cx, cz, res };

    scene.add(mesh);
    chunks.set(key, mesh);
    nature.requestChunk(cx, cz);   // 이미 요청된 청크(해상도만 올리는 재생성)는 무시됨
  }

  // 주변 청크 로딩 및 먼 청크 제거
  function updateChunks(px, pz) {
    const pcx = Math.floor(px / S);
    const pcz = Math.floor(pz / S);

    for (const [key, mesh] of chunks) {
      const distance = Math.max(
        Math.abs(mesh.userData.cx - pcx),
        Math.abs(mesh.userData.cz - pcz)
      );

      if (distance > UNLOAD) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        chunks.delete(key);
        nature.removeChunk(mesh.userData.cx, mesh.userData.cz);
      }
    }

    // 배율 30 이상으로 빠르게 이동할 때만 거친 해상도 사용
    const lowMode = fast && fastMult >= 30;
    const wantRes = lowMode ? RES_LOW : RES_HIGH;
    const t0 = performance.now();
    const budget = lowMode ? 8 : 0; // 거친 모드: 프레임당 8ms까지, 평소: 1개씩

    do {
      let best = null;
      let bestDistance = Infinity;

      for (let dz = -VIEW; dz <= VIEW; dz++) {
        for (let dx = -VIEW; dx <= VIEW; dx++) {
          const distance = dx * dx + dz * dz;

          if (distance > VIEW * VIEW) continue;
          if (distance >= bestDistance) continue;

          const existing = chunks.get(`${pcx + dx},${pcz + dz}`);
          if (existing && existing.userData.res >= wantRes) continue;

          bestDistance = distance;
          best = [pcx + dx, pcz + dz];
        }
      }

      if (!best) break;
      buildChunk(best[0], best[1], wantRes);
    } while (performance.now() - t0 < budget);
  }

  // 육지 스폰 위치 찾기
  let sx = 0;
  let sz = 0;
  let foundLand = false;

  search:
  for (let r = 0; r < 400; r += 8) {
    for (let a = 0; a < Math.PI * 2; a += 0.5) {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;

      if (T.height(x, z) > WATER_LEVEL + 1) {
        sx = x;
        sz = z;
        foundLand = true;
        break search;
      }
    }
  }

  if (!foundLand) {
    console.warn(
      '스폰 주변에서 물보다 높은 지형을 찾지 못했습니다. terrain.js를 확인하세요.'
    );
  }

  const me = {
    x: sx,
    z: sz,
    y: T.height(sx, sz),
    yaw: 0,
    pitch: 0.45,
    ry: 0
  };

  // 점프/중력 상태
  let vy = 0;
  let grounded = true;
  let jumpBuffer = 0;
  let jumpHeld = false;

  // 조작 상태
  let shiftLock = false;   // 시프트락 (로블록스식)
  let runOn = false;       // 달리기 켜짐
  let idleTime = 0;
  let uiOpen = false;      // 인벤토리/장비/스킬/특성 창이 열려 있는지
  let pinching = false;    // 두 손가락 확대/축소 중인지
  let zoomRaw = 1;         // 카메라 거리 배율 (작을수록 확대)
  const ZOOM_MIN = 0.1, ZOOM_FP = 0.12, ZOOM_MAX = 2.2;   // ZOOM_FP 이하로 끝까지 확대하면 1인칭
  let slk = 0;             // 시프트락 카메라 이동 보간값

  const myAvatar = makeAvatar('', 0xffffff);
  myAvatar.children[1].visible = false;
  scene.add(myAvatar);

  // ---------- 나무검 (테스트): Q 장착/해제, 마우스 왼쪽 또는 J 공격 ----------
  const myRig = myAvatar.userData.rig;
  setWeaponHandlers(myRig, {
    onStart: (side) => socket.emit('atk', { s: side }),   // 공격 모션이 시작될 때 한 번만 알림 (s = 베는 방향 0/1, 서버가 쿨다운을 다시 검사)
    onHit: null                          // 시각상 타격 프레임. 피해는 나중에 서버 판정(server.js resolveAttack)으로 확정
  });
  function toggleWeapon() {   // 1번 키: 장착 ↔ 해제
    if (uiOpen) return;
    const eq = requestToggleWeapon(myRig);   // 모션 중이면 null (중복 입력 무시)
    if (eq === null) return;
    socket.emit('weapon', { eq });
  }
  function doAttack() {
    if (uiOpen || !isWeaponEquipped(myRig)) return;
    startWeaponAttack(myRig);
  }

  // ---------- 공통 UI: 닉네임 표시, 안내 메시지, 조준점 ----------
  const toastEl = document.createElement('div');
  toastEl.className = 'toast';
  document.body.appendChild(toastEl);

  let toastTimer = 0;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  const cross = document.createElement('div');
  cross.className = 'cross';
  document.body.appendChild(cross);

  let runBtn = null, lockBtn = null, runChip = null, lockChip = null;

  function updateModeUI() {
    if (runBtn) runBtn.classList.toggle('on', runOn);
    if (lockBtn) lockBtn.classList.toggle('on', shiftLock);
    if (runChip) runChip.classList.toggle('on', runOn);
    if (lockChip) lockChip.classList.toggle('on', shiftLock);
    cross.style.display = shiftLock ? 'block' : 'none';
  }

  function setRun(v) {
    runOn = v;
    updateModeUI();
  }

  function toggleShiftLock() {
    shiftLock = !shiftLock;
    if (shiftLock && !touchMode) {
      try { renderer.domElement.requestPointerLock(); } catch (e) { /* 무시 */ }
    }
    updateModeUI();
  }

  // ---------- 오른쪽 위: 속도 배율 패널 + 조작법 ----------
  const stack = document.createElement('div');
  stack.className = 'rt-stack';

  const panel = document.createElement('div');
  panel.className = 'speedpanel';

  const fastBtn = document.createElement('button');

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(FAST_MIN);
  slider.max = String(FAST_MAX);
  slider.step = '5';
  slider.value = String(fastMult);

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'F: 켜기/끄기   [ ]: 배율 조절';

  panel.append(fastBtn, slider, hint);

  // 조작법 버튼 (책 아이콘) + 조작법 창
  const helpBtn = document.createElement('div');
  helpBtn.className = 'helpbtn';
  const helpImg = document.createElement('img');
  helpImg.src = '/ui/book.png';
  helpImg.alt = '';
  helpImg.draggable = false;
  const helpLabel = document.createElement('span');
  helpLabel.textContent = touchMode ? '조작법' : '조작법 (H)';
  helpBtn.append(helpImg, helpLabel);

  const helpPanel = document.createElement('div');
  helpPanel.className = 'helppanel';
  const helpTitle = document.createElement('h4');
  helpTitle.textContent = '조작법';
  helpPanel.appendChild(helpTitle);

  (touchMode ? HELP_TOUCH : HELP_KEYBOARD).forEach(([keyList, desc], idx) => {
    const row = document.createElement('div');
    row.className = 'hrow' + (idx === 0 ? ' first' : '');
    const hk = document.createElement('div');
    hk.className = 'hk';
    for (const k of keyList) {
      const cap = document.createElement('span');
      cap.className = 'kcap';
      cap.textContent = k;
      hk.appendChild(cap);
    }
    const hd = document.createElement('div');
    hd.className = 'hd';
    hd.textContent = desc;
    row.append(hk, hd);
    helpPanel.appendChild(row);
  });

  let helpOpen = false;
  function setHelp(v) {
    helpOpen = v;
    helpPanel.style.display = helpOpen ? 'block' : 'none';
  }
  function toggleHelp() {
    setHelp(!helpOpen);
  }
  helpBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    toggleHelp();
  });
  setHelp(false); // 조작법은 H를 눌러야 열림

  stack.append(panel, helpBtn, helpPanel);
  document.body.appendChild(stack);

  function refreshPanel() {
    fastBtn.textContent =
      `⚡ 속도 ×${fastMult} ${fast ? 'ON' : 'OFF'}`;
    fastBtn.style.background = fast ? '#d33' : '#3a2d5c';
    slider.value = String(fastMult);
  }

  function setFast(v) {
    fast = v;
    refreshPanel();
    socket.emit('fast', fast);
    fastBtn.blur();
  }

  function setMult(m) {
    fastMult = Math.max(FAST_MIN, Math.min(FAST_MAX, Math.round(m)));
    refreshPanel();
  }

  fastBtn.addEventListener('click', () => setFast(!fast));
  slider.addEventListener('input', () => setMult(Number(slider.value)));
  slider.addEventListener('change', () => slider.blur());
  refreshPanel();
  socket.emit('fast', false);

  // ---------- 나침반 (위쪽 가운데) ----------
  const compass = document.createElement('div');
  compass.className = 'rpg-compass';
  compass.style.cssText =
    'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:5;' +
    'width:min(' + (touchMode ? '420px,40vw' : '760px,56vw') + ');height:54px;overflow:hidden;border-radius:12px;' +
    'background:rgba(20,14,38,.72);border:1px solid rgba(217,178,92,.75);' +
    'color:#fff;pointer-events:none;font-family:sans-serif;text-shadow:0 0 3px #000';

  const tick = document.createElement('div');
  tick.style.cssText =
    'position:absolute;left:50%;top:0;width:2px;height:100%;' +
    'background:rgba(246,227,161,.45);transform:translateX(-50%)';
  compass.appendChild(tick);

  const compassItems = [];

  function addCompassItem(text, bearing, style, landmark) {
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;transform:translateX(-50%);white-space:nowrap;' +
      'display:none;' + style;
    el.textContent = text;
    compass.appendChild(el);
    compassItems.push({ el, bearing, landmark, last: '' });
  }

  // 동서남북 (북쪽 = -z, 동쪽 = +x)
  addCompassItem('N', 0, 'top:3px;font-size:20px;font-weight:bold;color:#ff5555');
  addCompassItem('E', Math.PI / 2, 'top:3px;font-size:20px;font-weight:bold');
  addCompassItem('S', Math.PI, 'top:3px;font-size:20px;font-weight:bold');
  addCompassItem('W', Math.PI * 1.5, 'top:3px;font-size:20px;font-weight:bold');

  // 지형 이름
  for (const lm of LANDMARKS) {
    addCompassItem(lm.name, 0, 'top:30px;font-size:13px;font-weight:bold;color:#ffe9a0', lm);
  }

  document.body.appendChild(compass);

  function updateCompass() {
    const heading = -me.yaw; // 바라보는 방향 (북쪽 기준, 시계 방향)

    for (const item of compassItems) {
      let bearing = item.bearing;
      let label = null;

      if (item.landmark) {
        const dx = item.landmark.x - me.x;
        const dz = item.landmark.z - me.z;
        bearing = Math.atan2(dx, -dz);

        const dist = Math.hypot(dx, dz);
        const distText = dist >= 1000
          ? (dist / 1000).toFixed(1) + 'km'
          : Math.round(dist) + 'm';
        label = `${item.landmark.name} ${distText}`;
      }

      let diff = bearing - heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const deg = (diff * 180) / Math.PI;

      if (Math.abs(deg) > 95) {
        item.el.style.display = 'none';
        continue;
      }

      item.el.style.display = 'block';
      item.el.style.left = (50 + (deg / 100) * 50) + '%';

      if (label !== null && label !== item.last) {
        item.el.textContent = label;
        item.last = label;
      }
    }
  }

  // ---------- 키보드 / 마우스 ----------
  // ---------- 문 (E 키 또는 문 옆에 뜨는 반투명 안내를 누름) ----------
  // 장식 건물: 문 열기 → (안쪽은 검음) → 집 들어가기 = 땅 밑 멀리 있는 방으로 이동. 방 안 출구: 밖으로 나가기.
  // 여관 정문: 문 열기/닫기 (그냥 걸어 들어감). 여관 2층 복도의 방문: 장식 건물과 같은 방식.
  let curRoom = -1;          // 지금 들어가 있는 방 (-1 = 땅 위)
  let openedDoor = -1;       // 내가 열어 둔 문 (멀어지면 자동으로 닫음)
  const doorHint = document.createElement('div');
  doorHint.style.cssText = 'position:fixed;left:0;top:0;transform:translate(-50%,-50%);padding:7px 16px;border-radius:12px;' +
    'background:rgba(15,15,25,.38);border:1px solid rgba(255,255,255,.4);color:rgba(255,255,255,.9);font:600 16px sans-serif;' +
    'z-index:20;display:none;cursor:pointer;user-select:none;text-shadow:0 1px 3px rgba(0,0,0,.6);backdrop-filter:blur(2px)';
  document.body.appendChild(doorHint);
  let hintAct = null;

  function setDoor(i, open) { setDoorOpen(i, open); socket.emit('door', { i, open }); }
  function teleportTo(x, y, z, yaw) {
    me.x = x; me.y = y; me.z = z; vy = 0; grounded = true;
    me.yaw = yaw; me.ry = yaw + Math.PI;           // 가는 방향을 바라봄
    socket.emit('tp', { x, y, z });
  }
  function enterRoom(r) {
    if (ROOMS[r].door >= 0) setDoor(ROOMS[r].door, false);   // 들어가면서 문은 닫힘
    openedDoor = -1;
    const e = roomEntry(r);
    curRoom = r;
    teleportTo(e.x, e.y, e.z, e.yaw);
  }
  function leaveRoom() {
    const ret = roomRet(curRoom);                  // 장식 건물 방 → 문 앞 / 객실 → 복도 방문 앞 / 복도 → 여관 계단 앞
    curRoom = ret.to === 'room' ? ret.room : -1;
    teleportTo(ret.x, ret.y, ret.z, ret.yaw);
  }
  // 문 앞에서 할 수 있는 동작: 문 열기 → 집 들어가기 (여관 정문만 열고 닫기)
  function doorAction(di) {
    const d = doorInfo(di), open = isDoorOpen(di), pos = { x: d.x, y: d.y + (d.kind === 'room' ? 3.6 : 1.7), z: d.z };
    if (d.kind === 'inn') return { text: open ? '문 닫기' : '문 열기', ...pos, run: () => setDoor(di, !open) };
    if (!open) return { text: '문 열기', ...pos, run: () => { setDoor(di, true); openedDoor = di; } };
    return { text: '집 들어가기', ...pos, run: () => enterRoom(d.room) };
  }
  // 지금 할 수 있는 동작 (없으면 null). 안내 문구가 뜰 위치(x,y,z)도 같이 돌려줌
  function currentAction() {
    if (curRoom >= 0) {
      const ex = roomExit(curRoom);
      if (Math.hypot(me.x - ex.x, me.z - ex.z) < ex.reach) return { text: ex.text, x: ex.x, y: ex.y + 3.0, z: ex.z, run: leaveRoom };
      const di = nearestDoor(me.x, me.z, me.y);    // 복도 방의 방문들
      return di >= 0 ? doorAction(di) : null;
    }
    const di = nearestDoor(me.x, me.z, me.y);
    if (di >= 0) return doorAction(di);
    const st = stairsInfo();                       // 여관 안 계단: 올라갈 수는 없고, 누르면 복도 방으로 이동
    if (Math.hypot(me.x - st.x, me.z - st.z) < st.reach && Math.abs(me.y - st.y) < 3) {
      return { text: '계단 올라가기', x: st.x, y: st.hy, z: st.z, run: () => enterRoom(CORR_ROOM.id) };
    }
    return null;
  }
  const _hv = new THREE.Vector3();
  function updateDoorHint() {
    if (openedDoor >= 0) {                         // 열어 둔 문에서 멀어지면 닫음
      const d = doorInfo(openedDoor);
      if (Math.hypot(me.x - d.x, me.z - d.z) > 9 || Math.abs(me.y - d.y) > 4) { setDoor(openedDoor, false); openedDoor = -1; }
    }
    hintAct = currentAction();
    if (!hintAct) { doorHint.style.display = 'none'; return; }
    camera.updateMatrixWorld();
    _hv.set(hintAct.x, hintAct.y, hintAct.z).project(camera);   // 문 위치를 화면 좌표로
    if (_hv.z > 1) { doorHint.style.display = 'none'; return; }
    doorHint.style.display = 'block';
    doorHint.style.left = (_hv.x * 0.5 + 0.5) * window.innerWidth + 'px';
    doorHint.style.top = (-_hv.y * 0.5 + 0.5) * window.innerHeight + 'px';
    const txt = (touchMode ? '' : '[E] ') + hintAct.text;
    if (doorHint.textContent !== txt) doorHint.textContent = txt;
  }
  function doDoorAction() { const a = hintAct || currentAction(); if (a) a.run(); }
  doorHint.addEventListener('click', doDoorAction);
  doorHint.addEventListener('touchstart', (e) => { e.preventDefault(); doDoorAction(); }, { passive: false });

  const keys = {};
  // ---------- 확대/축소 (마우스 휠, 두 손가락 핀치). 끝까지 확대하면 1인칭 ----------
  function zoomBy(f) {
    if (uiOpen) return;
    if (zoomRaw <= ZOOM_FP) {                 // 1인칭에서 축소하면 3인칭으로 복귀
      if (f > 1.01) zoomRaw = 0.4;
      return;
    }
    zoomRaw = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomRaw * f));
  }
  window.addEventListener('wheel', (e) => {
    if (uiOpen) return;
    if (e.target !== renderer.domElement && document.pointerLockElement !== renderer.domElement) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    zoomBy(Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0018));
  }, { passive: false });

  const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  const GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyH', 'Space'];

  window.addEventListener('keydown', (e) => {
    if (touchMode) return;

    if (uiOpen) {   // 창이 열려 있으면 게임 조작은 막고 창 조작만 받음
      if (e.code === 'Escape') closeWin();
      e.preventDefault();
      return;
    }

    if (ARROWS.includes(e.code) || e.code === 'Space') e.preventDefault();
    if (e.ctrlKey && GAME_KEYS.includes(e.code)) e.preventDefault();

    keys[e.code] = true;

    if (e.repeat) return;

    if (e.code === 'Space') jumpBuffer = 0.15;
    if (e.code === 'KeyF') setFast(!fast);
    if (e.code === 'KeyE') {   // 문/집 상호작용이 가능하면 그걸 하고, 아니면 스킬 E (휩쓸기)
      if (hintAct || currentAction()) doDoorAction();
      else useSkill('E');
    }
    if (e.code === 'KeyR') useSkill('R');
    if (e.code === 'KeyT') useSkill('T');
    if (e.code === 'Digit1') toggleWeapon();
    if (e.code === 'KeyH') toggleHelp();
    if (e.code === 'BracketLeft') setMult(fastMult - 10);
    if (e.code === 'BracketRight') setMult(fastMult + 10);

    if ((e.code === 'ControlLeft' || e.code === 'ControlRight') && RUN_TOGGLE) {
      setRun(!runOn);
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      toggleShiftLock();
    }
  });

  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    jumpHeld = false;
  });

  if (!touchMode) {
    renderer.domElement.addEventListener('click', (e) => {
      if (e.pointerType === 'touch') return; // 터치로 누른 건 마우스 잠금을 하지 않음
      renderer.domElement.requestPointerLock();
    });

    // 마우스 왼쪽 = 공격 (마우스 잠금 중일 때만. 처음 클릭은 잠금용이라 공격되지 않음)
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || document.pointerLockElement !== renderer.domElement) return;
      doAttack();
    });

    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== renderer.domElement) return;

      me.yaw -= e.movementX * 0.003;
      me.pitch = wrapPitch(me.pitch + e.movementY * 0.003);
    });

    // Esc로 마우스 잠금이 풀리면 시프트락도 해제
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== renderer.domElement && shiftLock) {
        shiftLock = false;
        updateModeUI();
      }
    });

    document.addEventListener('pointerlockerror', () => {
      shiftLock = false;
      updateModeUI();
      toast('화면을 한 번 클릭한 뒤 Shift를 눌러 주세요');
    });
  }

  // ---------- 화면 터치/드래그로 시점 회전 (키보드 모드에서도 가능) ----------
  {
    let lookId = null;
    let lx = 0;
    let ly = 0;
    const canvas = renderer.domElement;

    let tapX = 0, tapY = 0, tapT = 0, tapMoved = false;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || lookId !== null) return;
      lookId = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
      tapX = lx; tapY = ly; tapT = performance.now(); tapMoved = false;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      if (pinching) { lx = e.clientX; ly = e.clientY; tapMoved = true; return; }
      if (Math.hypot(e.clientX - tapX, e.clientY - tapY) > 12) tapMoved = true;
      me.yaw -= (e.clientX - lx) * 0.005;
      me.pitch = wrapPitch(me.pitch + (e.clientY - ly) * 0.005);
      lx = e.clientX;
      ly = e.clientY;
    });
    const lookEnd = (e) => {
      if (e.pointerId === lookId) lookId = null;
    };
    // 화면을 짧게 톡 터치(드래그/핀치 아님)하면 평타
    canvas.addEventListener('pointerup', (e) => {
      if (e.pointerId === lookId && !tapMoved && !pinching && performance.now() - tapT < 300) doAttack();
    });
    canvas.addEventListener('pointerup', lookEnd);
    canvas.addEventListener('pointercancel', lookEnd);

    // 두 손가락 벌리면 확대, 모으면 축소 (끝까지 확대하면 1인칭)
    let pd = 0;
    const tdist = (e) => Math.hypot(e.targetTouches[0].clientX - e.targetTouches[1].clientX, e.targetTouches[0].clientY - e.targetTouches[1].clientY);
    canvas.addEventListener('touchstart', (e) => {
      if (e.targetTouches.length === 2) { pd = tdist(e); pinching = true; }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (e.targetTouches.length === 2 && pd > 0) {
        const d = tdist(e);
        if (d > 0) { zoomBy(pd / d); pd = d; }
        e.preventDefault();
      }
    }, { passive: false });
    const pinchEnd = (e) => { if (e.targetTouches.length < 2) { pd = 0; pinching = false; } };
    canvas.addEventListener('touchend', pinchEnd);
    canvas.addEventListener('touchcancel', pinchEnd);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------- 방 창문: 실제 바깥 풍경 (포털) ----------
  // 방은 땅 밑에 있지만 방마다 마을 바깥 둘레에 "유령 위치"가 있다. 방 안에 있을 때 플레이어 카메라를 그 위치로 옮겨 놓은
  // 가짜 카메라로 월드를 한 번 더 그려서(renderTarget) 창 구멍 자리에 화면 좌표 그대로 입힌다 → 창으로 진짜 바깥이 보임.
  const portalRT = new THREE.WebGLRenderTarget(2, 2, { samples: 2 });
  const vcam = new THREE.PerspectiveCamera();
  const _pq = new THREE.Quaternion(), _pv = new THREE.Vector3(), _pUp = new THREE.Vector3(0, 1, 0), _pdb = new THREE.Vector2();
  function updatePortalCamera() {
    const g = roomGhost(curRoom);
    const gs = g.s || 1;   // 여관 2층 방은 가로를 줄여서 매핑 (복도 59칸 → 여관 폭)
    _pv.set((camera.position.x - g.room.x) * gs, camera.position.y - g.room.y, (camera.position.z - g.room.z) * gs);
    _pq.setFromAxisAngle(_pUp, g.rot);
    _pv.applyQuaternion(_pq);
    vcam.copy(camera, false);
    vcam.position.set(g.x + _pv.x, g.y + _pv.y, g.z + _pv.z);
    vcam.quaternion.copy(camera.quaternion).premultiply(_pq);
    vcam.updateMatrixWorld(true);
  }
  function renderPortal() {
    const w = Math.max(2, Math.floor(renderer.domElement.width * 0.7)), h = Math.max(2, Math.floor(renderer.domElement.height * 0.7));
    if (portalRT.width !== w || portalRT.height !== h) portalRT.setSize(w, h);
    renderer.getDrawingBufferSize(_pdb);
    setPortalTexture(portalRT.texture, _pdb.x, _pdb.y);
    setRoomsHidden(true, curRoom);                 // 방 자체는 가짜 시점에 안 나오게 숨김
    const prev = renderer.getRenderTarget();
    renderer.localClippingEnabled = !!roomGhost(curRoom).clip;   // 여관 방: 여관 본체(2층 이상)를 잘라서 벽에 안 가려지게
    renderer.setRenderTarget(portalRT);
    renderer.render(scene, vcam);
    renderer.setRenderTarget(prev);
    renderer.localClippingEnabled = false;
    setRoomsHidden(false, curRoom);
  }

  // ---------- 키보드 모드 전용 UI: 조작 안내, 달리기/시점고정 표시 ----------
  if (!touchMode) {
    const hintbar = document.createElement('div');
    hintbar.className = 'hintbar';
    hintbar.textContent =
      'WASD 이동 · Space 점프 · Ctrl 달리기 · Shift 시점고정 · 방향키/마우스/터치 시점';
    document.body.appendChild(hintbar);

    const chips = document.createElement('div');
    chips.className = 'chips';
    runChip = document.createElement('div');
    runChip.className = 'chip';
    runChip.textContent = '🏃 달리기';
    lockChip = document.createElement('div');
    lockChip.className = 'chip';
    lockChip.textContent = '🔒 시점고정';
    chips.append(runChip, lockChip);
    document.body.appendChild(chips);

    toast('화면을 클릭하면 마우스로 시점을 돌릴 수 있어요 (방향키, 터치도 가능)');
  }

  // ---------- 터치 모드 전용 UI: 조이스틱, 버튼 ----------
  const joy = { x: 0, y: 0 };

  if (touchMode) {
    // 조이스틱
    const base = document.createElement('div');
    base.className = 'joy-base';
    const knob = document.createElement('div');
    knob.className = 'joy-knob';
    base.appendChild(knob);
    document.body.appendChild(base);

    const JOY_R = 44;
    let joyId = null;

    const joyMove = (e) => {
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const R = JOY_R * uiScale;
      const d = Math.hypot(dx, dy);
      const k = d > R ? R / d : 1;
      dx *= k;
      dy *= k;
      knob.style.transform = `translate(${dx / uiScale}px, ${dy / uiScale}px)`;
      joy.x = dx / R;
      joy.y = -dy / R;
    };

    const joyEnd = (e) => {
      if (e.pointerId !== joyId) return;
      joyId = null;
      joy.x = 0;
      joy.y = 0;
      knob.style.transform = 'translate(0, 0)';
    };

    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      joyId = e.pointerId;
      base.setPointerCapture(e.pointerId);
      joyMove(e);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === joyId) joyMove(e);
    });
    base.addEventListener('pointerup', joyEnd);
    base.addEventListener('pointercancel', joyEnd);

    // 버튼 (오른쪽 아래 묶음)
    const tgroup = document.createElement('div');
    tgroup.className = 'tgroup';
    document.body.appendChild(tgroup);

    const makeBtn = (cls, icon, label, onDown, onUp) => {
      const b = document.createElement('div');
      b.className = 'tbtn ' + cls;
      b.innerHTML = '<span>' + icon + '</span>' + (label || '');
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.classList.add('press');
        if (onDown) onDown();
      });
      const up = () => {
        b.classList.remove('press');
        if (onUp) onUp();
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      tgroup.appendChild(b);
      return b;
    };

    makeBtn('jump', '⤒', '점프',
      () => { jumpHeld = true; jumpBuffer = 0.15; },
      () => { jumpHeld = false; });
    const atkBtn = makeBtn('atk', '', '', () => { if (isWeaponEquipped(myRig)) doAttack(); else toggleWeapon(); });
    atkBtn.insertAdjacentHTML('beforeend', '<i class="lbl">공격</i>');
    runBtn = makeBtn('run', '🏃', '달리기', () => setRun(!runOn));
    lockBtn = makeBtn('lock', '', '', () => toggleShiftLock());
    lockBtn.insertAdjacentHTML('beforeend', '<i class="lbl">쉬프트락</i>');

    toast('왼쪽 조이스틱으로 이동, 화면을 드래그하면 시점이 돌아가요');
  }

  updateModeUI();

  // ---------- 하단 중앙 UI (레벨, HP/MP, 메뉴 버튼) ----------
  // 지금은 모양만 있는 임시 값이에요. 나중에 실제 값으로 바꾸면 돼요.
  const PLAYER = { level: 1, hp: 100, hpMax: 100, mp: 50, mpMax: 50, exp: 0, expMax: 100 };

  const fmt = (n) => {
    if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.?0+$/, '') + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.?0+$/, '') + 'K';
    return String(n);
  };
  const pct = (a, b) => Math.max(0, Math.min(100, (a / b) * 100));

  const bottomWrap = document.createElement('div');
  bottomWrap.className = 'bottom-wrap';

  // 키보드 모드의 조작 안내와 달리기/시점고정 표시를 패널 위로 옮김
  for (const sel of ['.hintbar', '.chips']) {
    const el = document.querySelector(sel);
    if (el) bottomWrap.appendChild(el);
  }

  const hpmp = (cls, icon, cur, max) =>
    '<div class="hpmp ' + cls + '">' +
      '<div class="hpmp-ic"><img src="' + icon + '" alt="" draggable="false"></div>' +
      '<div class="hpmp-bar"><div class="hpmp-in">' +
        '<i style="width:' + pct(cur, max) + '%"></i>' +
        '<span>' + fmt(cur) + ' / ' + fmt(max) + '</span>' +
      '</div></div>' +
    '</div>';

  const bui = document.createElement('div');
  bui.className = 'bui';
  bui.innerHTML =
    '<div class="bui-lv"><span>Lv.' + PLAYER.level + '</span></div>' +
    hpmp('hp', '/ui/icon_heart.png', PLAYER.hp, PLAYER.hpMax) +
    hpmp('mp', '/ui/icon_drop.png', PLAYER.mp, PLAYER.mpMax) +
    '<div class="bui-menu"></div>';

  const MENUS = [
    ['/ui/icon_bag.png', '인벤토리'],
    ['/ui/icon_gear.png', '장비'],
    ['/ui/skill_btn.png', '스킬'],
    ['/ui/icon_trait.png', '특성'],
    ['/ui/status_frame.png', '상태창'],
    ['/ui/icon_quest.png', '퀘스트'],
    ['/ui/icon_trade.png', '거래'],
  ];
  const menuSlots = [];
  const menuEl = bui.querySelector('.bui-menu');

  MENUS.forEach(([icon, name], i) => {
    const b = document.createElement('div');
    b.className = 'mbtn';
    const img = document.createElement('img');
    img.src = icon;
    img.alt = '';
    img.draggable = false;
    const label = document.createElement('b');
    label.textContent = name;
    b.append(img, label);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      menuPress(i);
    });
    menuEl.appendChild(b);
    menuSlots.push(b);
  });

  bottomWrap.appendChild(bui);
  document.body.appendChild(bottomWrap);

  function menuPress(i) {
    const b = menuSlots[i];
    if (!b) return;
    b.classList.add('flash');
    setTimeout(() => b.classList.remove('flash'), 150);
    if (i === WIN_TABS.length) { toggleStatus(); return; }   // 5번째 = 상태창(두루마리)
    if (i === WIN_TABS.length + 1) { toggleQuest(); return; }   // 6번째 = 퀘스트
    if (i === WIN_TABS.length + 2) { toggleTrade(); return; }   // 7번째 = 거래 (주변 플레이어 목록)
    toggleWin(i);
  }

  // ---------- 전체 화면 창: 인벤토리 · 장비 · 스킬 · 특성 (열면 UI만 보임) ----------
  const WIN_TABS = [
    ['/ui/icon_bag.png', '인벤토리'],
    ['/ui/icon_gear.png', '장비'],
    ['/ui/skill_btn.png', '스킬'],
    ['/ui/icon_trait.png', '특성'],
  ];
  const winStyle = document.createElement('style');
  winStyle.textContent = `
.uiwin{position:fixed;inset:0;z-index:60;display:none;background:rgba(0,0,0,.14);font-family:'Galmuri11','Galmuri9','Malgun Gothic',sans-serif;color:#2a1a0c;user-select:none;-webkit-user-select:none;overflow:hidden}
body.uw-open .bottom-wrap,body.uw-open .rt-stack,body.uw-open .joy-base,body.uw-open .tgroup,body.uw-open .skillbar,body.uw-open .rpg-compass,body.uw-open #hud,body.uw-open .cross{display:none!important}
.uwb-stage{position:absolute;left:50%;top:50%;width:1536px;height:1024px;margin:-512px 0 0 -768px;transform-origin:50% 50%;background:#3a2a1c url(/ui/book_bg.png) 0 0/100% 100% no-repeat;box-shadow:0 10px 40px rgba(0,0,0,.6)}
.uwb-tab{position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:14px;cursor:pointer;font-size:32px;font-weight:700;color:#2e1d0e;text-shadow:0 1px 0 rgba(255,235,190,.35);padding-bottom:6px}
.uwb-tab img{width:54px;height:54px;object-fit:contain;pointer-events:none;filter:sepia(.6) brightness(.55)}
.uwb-tab.on{background:url(/ui/tab_on.png) 0 0/100% 100% no-repeat;color:#f1dfb6;text-shadow:0 2px 0 #000}
.uwb-tab.on img{filter:none}
.uwb-h{position:absolute;display:flex;align-items:center;gap:10px;height:48px;font-size:36px;font-weight:700;color:#2a1a0c;text-shadow:0 1px 0 rgba(255,235,190,.4)}
.uwb-h i{font-style:normal;font-size:30px;color:#6b4a2a}
.uw-slot{box-sizing:border-box;background:#2b1f14 url(/ui/slot_empty.png) 0 0/100% 100% no-repeat;cursor:pointer}
.uw-slot.sel{filter:drop-shadow(0 0 6px #ffd77a) brightness(1.3)}
.uwb-grid{position:absolute;display:grid;gap:4px}
.uwb-eq{position:absolute}
.uwb-lb{position:absolute;width:160px;margin-left:-80px;text-align:center;font-size:24px;font-weight:700;color:#2a1a0c}
.uwb-detail{position:absolute;left:840px;top:330px;width:560px;height:420px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;text-align:center;font-size:30px;line-height:1.9;color:#5a4328}
.uwb-orn{font-size:44px;color:rgba(90,60,28,.5);line-height:1}
.uwb-x{position:absolute;left:1380px;top:146px;width:52px;height:48px;font-size:40px;line-height:48px;text-align:center;cursor:pointer;color:#3a2814}
.uwb-x:hover{color:#000}
.uw-node{fill:#2b1f14;stroke:#7a5d34;stroke-width:5;cursor:pointer}
.uw-node.sel{stroke:#ffd77a}
`;
  document.head.appendChild(winStyle);
  const winEl = document.createElement('div');
  winEl.className = 'uiwin';
  document.body.appendChild(winEl);
  let winIdx = 0;

  const at = (x, y, w, h) => 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px';
  const wHead = (x, y, t) => '<div class="uwb-h" style="left:' + x + 'px;top:' + y + 'px"><i>◈</i>' + t + '</div>';
  const wDetail = (txt) => '<div class="uwb-detail"><div class="uwb-orn">❖</div><div class="uw-dtxt">' + txt + '</div><div class="uwb-orn">❖</div></div>';
  const wInv = () => wHead(138, 158, '인벤토리') +
    '<div class="uwb-grid" style="' + at(147, 249, 581, 551) + ';grid-template-columns:repeat(6,1fr);grid-template-rows:repeat(5,1fr)">' + '<div class="uw-slot"></div>'.repeat(30) + '</div>' +
    '<img src="/ui/icon_bag.png" alt="" style="position:absolute;left:153px;top:831px;width:40px;height:40px;object-fit:contain;filter:sepia(.7) brightness(.45)">' +
    '<div style="position:absolute;left:205px;top:832px;font-size:30px;font-weight:700">0 / 100</div>';
  const wEquip = () => {
    const sl = (img, x, y, w, h, lx, ly, name) =>
      '<div class="uw-slot uwb-eq" style="' + at(x, y, w, h) + ';background-image:url(/ui/' + img + '.png)"></div>' +
      '<div class="uwb-lb" style="left:' + lx + 'px;top:' + ly + 'px">' + name + '</div>';
    return wHead(820, 152, '장비') +
      '<img src="/ui/silhouette.png" alt="" style="position:absolute;left:991px;top:378px;width:211px;height:270px;pointer-events:none">' +
      sl('slot_head', 1043, 252, 112, 107, 1099, 363, '투구') +
      sl('slot_armor', 858, 426, 118, 118, 917, 548, '갑옷') +
      sl('slot_weapon', 1225, 426, 119, 118, 1284, 548, '무기') +
      sl('slot_boots', 1038, 626, 121, 121, 1099, 752, '신발');
  };
  const wTree = () => {
    const cx = 290, cy = 275, R = 185;
    let svg = '<svg viewBox="0 0 581 551" style="position:absolute;' + at(147, 249, 581, 551) + '"><g stroke="#6b4c2a" stroke-width="4" fill="none" stroke-opacity=".75"><circle cx="' + cx + '" cy="' + cy + '" r="' + R + '"/>';
    const N = [];
    for (let k = 0; k < 10; k++) { const an = -Math.PI / 2 + k * Math.PI / 5; N.push([cx + R * Math.cos(an), cy + R * Math.sin(an)]); }
    for (const [x, y] of N) svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>';
    svg += '</g>';
    for (const [x, y] of N) svg += '<circle class="uw-node" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="26"/>';
    svg += '<circle class="uw-node" cx="' + cx + '" cy="' + cy + '" r="56"/><image href="/ui/icon_trait.png" x="' + (cx - 36) + '" y="' + (cy - 36) + '" width="72" height="72" pointer-events="none"/></svg>';
    return wHead(138, 158, '특성') + svg;
  };

  function winBody(i) {
    if (i === 0) return wInv() + wDetail('아이템을 선택하면<br>상세 정보가 표시됩니다.');
    if (i === 1) return wInv() + wEquip();
    if (i === 2) {
      return wHead(138, 158, '스킬') +
        '<div class="uwb-grid" style="' + at(153, 298, 568, 452) + ';grid-template-columns:repeat(5,104px);grid-template-rows:repeat(4,104px);gap:12px">' + '<div class="uw-slot"></div>'.repeat(20) + '</div>' +
        wDetail('스킬을 선택하면<br>상세 정보가 표시됩니다.');
    }
    return wTree() + wDetail('특성을 선택하면<br>상세 정보가 표시됩니다.');
  }

  const TAB_BOX = [[143, 37, 298, 88], [451, 37, 265, 88], [727, 37, 259, 89], [997, 37, 250, 87]];
  function fitWin() {
    const st = winEl.firstElementChild;
    if (!st) return;
    st.style.transform = 'scale(' + (Math.min(window.innerWidth / 1536, window.innerHeight / 1024) * 0.98) + ')';
  }
  window.addEventListener('resize', fitWin);
  function renderWin() {
    let h = '<div class="uwb-stage">';
    WIN_TABS.forEach(([ti, tn], k) => {
      const [x, y, w, hh] = TAB_BOX[k], on = k === winIdx;
      h += '<div class="uwb-tab' + (on ? ' on' : '') + '" data-tab="' + k + '" style="' + at(x, on ? 35 : y, w, on ? 92 : hh) + '"><img src="' + ti + '" alt="">' + tn + '</div>';
    });
    h += winBody(winIdx) + '<div class="uwb-x" data-close="1">✕</div></div>';
    winEl.innerHTML = h;
    fitWin();
  }

  winEl.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest('[data-close]')) { closeWin(); return; }
    const tab = t.closest('[data-tab]');
    if (tab) { winIdx = Number(tab.getAttribute('data-tab')); renderWin(); return; }
    if (t === winEl) { closeWin(); return; }
    const sl = t.closest('.uw-slot, .uw-node');
    if (sl) {
      winEl.querySelectorAll('.sel').forEach((n) => n.classList.remove('sel'));
      sl.classList.add('sel');
      const d = winEl.querySelector('.uw-dtxt');
      if (d) d.textContent = '비어 있는 칸이에요';
    }
  });

  function openWin(i) {
    closeTrade();
    closeQuest();
    scrEl.classList.remove('open', 'show');   // 상태창 두루마리가 열려 있으면 바로 닫음
    winIdx = i;
    renderWin();
    winEl.style.display = 'flex';
    if (!uiOpen) {
      uiOpen = true;
      document.body.classList.add('uw-open');
      for (const k in keys) keys[k] = false;
      jumpHeld = false;
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch (err) { /* 무시 */ }
    }
  }
  function closeWin() {
    closeStatus();
    closeTrade();
    closeQuest();
    uiOpen = false;
    document.body.classList.remove('uw-open');
    winEl.style.display = 'none';
  }
  function toggleWin(i) {
    if (uiOpen && winIdx === i) closeWin();
    else openWin(i);
  }


  // ---------- 상태창: 두루마리가 위아래로 펼쳐지며 내 정보가 나옴 (기능 없이 모양만) ----------
  const scrStyle = document.createElement('style');
  scrStyle.textContent = `
.scr{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0);transition:background .4s;font-family:'Galmuri11','Galmuri9','Malgun Gothic',sans-serif;user-select:none;-webkit-user-select:none}
.scr.show{display:flex}
.scr.open{background:rgba(0,0,0,.6)}
.scr-wrap{--rh:clamp(40px,8vh,64px);position:relative;display:flex;flex-direction:column;align-items:center;width:min(98vw,1040px);filter:drop-shadow(0 10px 24px rgba(0,0,0,.75))}
.scr-r{position:relative;z-index:2;flex:none;display:flex;width:100%;height:var(--rh)}
.scr-r i{display:block;height:100%;background-repeat:no-repeat;background-size:100% 100%}
.scr-r .bd{flex:1 1 0;min-width:0}
.scr-r.top .cl{flex:none;width:calc(var(--rh)*.893);background-image:url(/ui/scr_cap_l.png)}
.scr-r.top .cr{flex:none;width:calc(var(--rh)*.917);background-image:url(/ui/scr_cap_r.png)}
.scr-r.top .bl{background-image:url(/ui/scr_top_bl.png)}
.scr-r.top .br{background-image:url(/ui/scr_top_br.png)}
.scr-r.top .st{flex:none;width:calc(var(--rh)*.69);background-image:url(/ui/scr_top_strap.png)}
.scr-r.bot .cl{flex:none;width:calc(var(--rh)*.893);background-image:url(/ui/scr_cap_l_b.png)}
.scr-r.bot .cr{flex:none;width:calc(var(--rh)*.917);background-image:url(/ui/scr_cap_r_b.png)}
.scr-r.bot .bd{background-image:url(/ui/scr_bot_body.png)}
.scr-paper{position:relative;z-index:1;flex:none;width:calc(100% - var(--rh)*1.75);margin:calc(var(--rh)*-.1) 0;height:0;overflow:hidden;transition:height .6s cubic-bezier(.22,.8,.25,1);background:url(/ui/scr_paper.png) 0 0/100% 100% no-repeat}
.scr.open .scr-paper{height:min(70vh,520px)}
.scr-in{position:absolute;inset:0;display:flex;gap:14px;padding:20px 24px 16px;box-sizing:border-box;color:#33200d;text-shadow:0 1px 0 rgba(255,235,190,.35);opacity:0;transition:opacity .35s .3s}
.scr.open .scr-in{opacity:1}
.scr-col{flex:1 1 0;min-width:0;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;padding-right:2px}
.scr-x{position:absolute;top:4px;right:12px;font-size:20px;line-height:1;cursor:pointer;color:#4a2f12;z-index:4;padding:3px}
.scr-col,.scr-in{scrollbar-width:none;-ms-overflow-style:none}
.scr-col::-webkit-scrollbar,.scr-in::-webkit-scrollbar{display:none;width:0;height:0}
.scr-card{border:1.5px solid rgba(70,42,18,.55);border-radius:3px;background:rgba(80,50,20,.1);box-shadow:inset 0 0 0 1px rgba(255,235,190,.25);padding:10px 12px;margin-bottom:10px}
.scr-h{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:16px;font-weight:700;color:#3a2410}
.scr-h img{width:18px;height:auto}
.scr-h img.ic{width:24px;height:24px;object-fit:contain}
.scr-h img.sp{filter:sepia(.7) brightness(.5)}
.scr-prof{display:flex;gap:12px;align-items:stretch}
.scr-prof>img{width:84px;height:auto;align-self:flex-start;flex:none;filter:drop-shadow(0 3px 4px rgba(0,0,0,.5))}
.scr-pi{flex:1;min-width:0}
.scr-lvl{font-size:21px;font-weight:700;color:#2a1a0c}
.scr-nick{font-size:16px;font-weight:700;margin-top:1px;word-break:break-all}
.scr-hr{height:2px;margin:6px 0;background:linear-gradient(90deg,rgba(70,42,18,0),rgba(70,42,18,.6),rgba(70,42,18,0))}
.scr-kv{display:flex;justify-content:space-between;font-size:13px;padding:1px 0}
.scr-kv span:first-child{color:#6b4c2a}
.scr-bw{margin-top:6px}
.scr-bt{display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;color:#4a2f12}
.scr-bar{height:13px;border:1.5px solid #2b1a08;border-radius:2px;background:#2a1c10;overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.7)}
.scr-bar i{display:block;height:100%}
.scr-bar.xp i{background:linear-gradient(#f0cf7a,#b8862c)}
.scr-bar.hp i{background:linear-gradient(#e0524a,#8c1f1a)}
.scr-bar.mp i{background:linear-gradient(#5aa0ea,#1f4f95)}
.scr-row{display:flex;align-items:center;gap:8px;padding:6px 2px;border-bottom:1px solid rgba(70,42,18,.28);font-size:14px}
.scr-row:last-child{border-bottom:0}
.scr-row img{width:20px;height:20px;object-fit:contain;filter:sepia(.7) brightness(.5)}
.scr-row b{margin-left:auto;font-size:15px}
.scr-slots{display:flex;gap:7px;flex-wrap:wrap}
.scr-slots i{width:44px;height:50px;box-sizing:border-box;background:#2b1f14 url(/ui/slot_empty.png) 0 0/100% 100% no-repeat}
.scr-note{margin-top:6px;font-size:12px;color:#6b5636}
.scr-pts{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700}
.scr-pts b{font-size:19px;color:#7a2a14;margin-left:2px}
.scr-btn{margin-left:auto;padding:6px 12px;border:2px solid #3d2810;border-radius:3px;background:linear-gradient(#8a6230,#5e3f1c);color:#ecd49a;font:700 13px 'Galmuri11','Malgun Gothic',sans-serif;opacity:.6;box-shadow:inset 0 1px 0 rgba(255,235,190,.35)}
.scr-st{display:flex;align-items:center;gap:10px;padding:9px 10px;margin-bottom:8px;border:1.5px solid rgba(70,42,18,.5);border-radius:3px;background:rgba(80,50,20,.1);box-shadow:inset 0 0 0 1px rgba(255,235,190,.25)}
.scr-ic{flex:none;width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;background:radial-gradient(circle at 35% 30%,#4a3622,#1f160c);border:2px solid #8a6a3a;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.scr-ic img{width:24px;height:24px;object-fit:contain}
.scr-sn{flex:1;min-width:0}
.scr-sn b{font-size:16px}
.scr-sn small{margin-left:5px;font-size:12px;color:#5e4828}
.scr-sn div{margin-top:2px;font-size:11.5px;color:#5e4828}
.scr-vl{width:34px;text-align:center;font-size:18px;font-weight:700}
.scr-pm{display:flex;gap:5px}
.scr-pm button{width:30px;height:30px;border:2px solid #3d2810;border-radius:3px;background:linear-gradient(#8a6230,#5e3f1c);color:#ecd49a;font:700 18px/1 sans-serif;opacity:.6;box-shadow:inset 0 1px 0 rgba(255,235,190,.35)}
@media (max-width:620px){
.scr-in{flex-direction:column;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain}
.scr-col{flex:none;overflow:visible}
.scr.open .scr-paper{height:min(74vh,620px)}
}
`;
  document.head.appendChild(scrStyle);
  const scrEl = document.createElement('div');
  scrEl.className = 'scr';
  document.body.appendChild(scrEl);
  let scrHideT = 0, scrOpenT = 0;
  // 스탯 (기능 없이 모양만): [약어, 이름, 설명]
  const STATS = [
    ['STR', '힘', '공격력 증가, 무기 공격력 상승'],
    ['DEX', '민첩', '치명타 확률 증가, 명중률 상승'],
    ['CON', '체력', '최대 HP 증가, 방어력 상승'],
    ['INT', '지능', '최대 MP 증가, 마법 공격력 상승'],
    ['LUK', '운', '아이템 획득 확률 증가, 치명타 피해 상승'],
    ['AGI', '공속/회피', '공격 속도 증가, 회피율 상승']
  ];
  const scrSlots = (n) => '<div class="scr-slots">' + '<i></i>'.repeat(n) + '</div>';
  const scrBar = (cls, label, a, b) =>
    '<div class="scr-bw"><div class="scr-bt"><span>' + label + '</span><span>' + fmt(a) + ' / ' + fmt(b) + '</span></div><div class="scr-bar ' + cls + '"><i style="width:' + pct(a, b) + '%"></i></div></div>';
  const scrRow = (icon, name, val) => '<div class="scr-row"><img src="' + icon + '" alt="">' + name + '<b>' + val + '</b></div>';

  function renderScr() {
    const left =
      '<div class="scr-card"><div class="scr-prof"><img src="/ui/status_frame.png" alt="" draggable="false"><div class="scr-pi">' +
      '<div class="scr-lvl">Lv. ' + PLAYER.level + '</div><div class="scr-nick"></div><div class="scr-hr"></div>' +
      '<div class="scr-kv"><span>직업</span><span>초보자</span></div><div class="scr-kv"><span>길드</span><span>없음</span></div><div class="scr-hr"></div>' +
      scrBar('xp', '경험치', PLAYER.exp, PLAYER.expMax) + scrBar('hp', 'HP', PLAYER.hp, PLAYER.hpMax) + scrBar('mp', 'MP', PLAYER.mp, PLAYER.mpMax) +
      '</div></div></div>' +
      '<div class="scr-card"><div class="scr-h"><img src="/ui/orn_diamond.png" alt="">기본 정보</div>' +
      scrRow('/ui/icon_heart.png', '체력', fmt(PLAYER.hpMax)) + scrRow('/ui/icon_drop.png', '마나', fmt(PLAYER.mpMax)) +
      scrRow('/ui/slot_weapon.png', '공격력', '0') + scrRow('/ui/slot_armor.png', '방어력', '0') +
      scrRow('/ui/icon_gear.png', '치명타 확률', '0%') + scrRow('/ui/icon_gear.png', '치명타 피해', '150%') + scrRow('/ui/slot_boots.png', '이동 속도', '100%') +
      '</div>' +
      '<div class="scr-card"><div class="scr-h"><img class="ic" src="/ui/skill_btn.png" alt="">보유 스킬</div>' + scrSlots(5) + '<div class="scr-note">아직 배운 스킬이 없어요</div></div>' +
      '<div class="scr-card"><div class="scr-h"><img class="ic sp" src="/ui/icon_trait.png" alt="">특성</div>' + scrSlots(5) + '<div class="scr-note">아직 얻은 특성이 없어요</div></div>';
    const right =
      '<div class="scr-card"><div class="scr-h"><img src="/ui/orn_diamond.png" alt="">스탯 포인트</div>' +
      '<div class="scr-pts"><span>사용 가능한 포인트</span><b>0</b><button class="scr-btn" disabled>초기화</button></div></div>' +
      STATS.map(([k, n, d]) =>
        '<div class="scr-st">' +
        '<div class="scr-sn"><b>' + k + '</b><small>(' + n + ')</small><div>' + d + '</div></div>' +
        '<span class="scr-vl">0</span><span class="scr-pm"><button disabled>−</button><button disabled>+</button></span></div>').join('') +
      '<div class="scr-note">스탯 찍기는 아직 준비 중이에요</div>';
    scrEl.innerHTML =
      '<div class="scr-wrap"><div class="scr-r top"><i class="cl"></i><i class="bd bl"></i><i class="st"></i><i class="bd br"></i><i class="cr"></i></div>' +
      '<div class="scr-paper"><div class="scr-x" data-sclose="1">✕</div>' +
      '<div class="scr-in"><div class="scr-col">' + left + '</div><div class="scr-col">' + right + '</div></div></div>' +
      '<div class="scr-r bot"><i class="cl"></i><i class="bd"></i><i class="cr"></i></div></div>';
    const nk = scrEl.querySelector('.scr-nick');
    if (nk) nk.textContent = nick;
  }

  scrEl.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (performance.now() - scrOpenT < 500) return;   // 상태창을 연 그 터치의 click 이 어두운 배경에 떨어져 바로 닫히는 것 방지
    if (t === scrEl || t.closest('[data-sclose]')) { closeWin(); return; }
  });

  function openStatus() {
    closeTrade();
    closeQuest();
    winEl.style.display = 'none';
    renderScr();
    clearTimeout(scrHideT);
    scrOpenT = performance.now();
    scrEl.classList.add('show');
    void scrEl.offsetWidth;            // 펼쳐지는 애니메이션이 처음부터 재생되도록
    scrEl.classList.add('open');
    if (!uiOpen) {
      uiOpen = true;
      document.body.classList.add('uw-open');
      for (const k in keys) keys[k] = false;
      jumpHeld = false;
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch (err) { /* 무시 */ }
    }
  }
  function closeStatus() {
    if (!scrEl.classList.contains('open')) return;
    scrEl.classList.remove('open');
    clearTimeout(scrHideT);
    scrHideT = setTimeout(() => scrEl.classList.remove('show'), 650);
  }
  function toggleStatus() {
    if (uiOpen && scrEl.classList.contains('open')) closeWin();
    else openStatus();
  }

  // ---------- 거래 창: 주변 플레이어 목록 (이름 + 레벨만 표시, 직업은 표시 안 함) ----------
  const TRADE_RANGE = Infinity;   // 이 거리(m) 안의 플레이어만 목록에 표시. 지금은 접속자 전부 (예: 80 으로 바꾸면 가까운 사람만)
  const tradeStyle = document.createElement('style');
  tradeStyle.textContent = `
.trade{position:fixed;inset:0;z-index:61;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);font-family:'Galmuri11','Galmuri9','Malgun Gothic',sans-serif;color:#e8dcc0;user-select:none;-webkit-user-select:none}
.trade-box{position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:min(94vw,460px);max-height:min(88vh,720px);border:2px solid #4a4030;border-radius:6px;background:linear-gradient(#1c1a18,#121110);box-shadow:0 0 0 2px #070605,inset 0 0 0 1px #5a4a30,0 12px 40px rgba(0,0,0,.8)}
.trade-hd{flex:none;display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid #3a3226;background:linear-gradient(#26221c,#1a1814)}
.trade-hd .ic{flex:none;width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 35% 30%,#4a3a22,#1f170c);border:2px solid #b8924a}
.trade-hd .ic img{width:28px;height:28px;object-fit:contain}
.trade-hd h2{margin:0;font-size:24px;font-weight:700;color:#f1e6c8;text-shadow:0 2px 0 #000}
.trade-x{margin-left:auto;font-size:24px;line-height:1;padding:6px 8px;cursor:pointer;color:#bba880}
.trade-x:hover{color:#fff}
.trade-sec{flex:none;padding:14px 16px 8px;font-size:19px;font-weight:700;color:#e2c98a;text-shadow:0 1px 0 #000}
.trade-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 12px 14px;touch-action:pan-y;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#5a4a30 transparent}
.trade-row{display:flex;align-items:center;gap:12px;padding:8px 10px;margin-bottom:8px;border:1px solid #3a3226;border-radius:5px;background:linear-gradient(#24211d,#1a1816);box-shadow:inset 0 0 0 1px rgba(255,235,190,.04)}
.trade-pt{position:relative;flex:none;width:58px;height:58px;box-sizing:border-box;border:2px solid #8a6b3a;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;color:#fff;text-shadow:0 2px 3px #000;box-shadow:0 0 0 1px #0a0705}
.trade-pt i{position:absolute;right:-5px;bottom:-5px;width:11px;height:11px;border-radius:50%;background:#46d560;border:2px solid #121110;box-shadow:0 0 5px #46d560}
.trade-info{flex:1;min-width:0}
.trade-nm{font-size:18px;font-weight:700;color:#f4ead0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.trade-lv{margin-top:4px;font-size:14px;color:#a89c82}
.trade-btn{flex:none;padding:10px 16px;border:2px solid #9a7a3e;border-radius:4px;background:linear-gradient(#4a3a24,#2e2416);color:#f1dfb6;font:700 16px 'Galmuri11','Malgun Gothic',sans-serif;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,235,190,.25),0 2px 4px rgba(0,0,0,.5);text-shadow:0 1px 0 #000}
.trade-btn:hover{filter:brightness(1.2)}
.trade-btn:active{transform:translateY(1px)}
.trade-empty{padding:30px 10px;text-align:center;font-size:15px;color:#8f846c;line-height:1.7}
`;
  document.head.appendChild(tradeStyle);
  const tradeEl = document.createElement('div');
  tradeEl.className = 'trade';
  document.body.appendChild(tradeEl);
  let tradeOn = false, tradeTimer = 0, tradeOpenT = 0, tradeKey = '';

  const portraitColor = (name) => {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360;
    return 'linear-gradient(135deg,hsl(' + h + ',32%,34%),hsl(' + ((h + 40) % 360) + ',36%,16%))';
  };
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function tradePlayers() {
    const list = [];
    for (const [pid, r] of remotes) {
      const d = Math.hypot(r.t.x - me.x, r.t.z - me.z);
      if (d <= TRADE_RANGE) list.push({ pid, nick: r.nick || '플레이어', level: r.level || 1, d });
    }
    list.sort((a, b) => a.d - b.d);
    return list;
  }

  function renderTrade(force) {
    const ps = tradePlayers();
    const key = ps.map((p) => p.pid + '|' + p.nick + '|' + p.level).join(',');
    if (!force && key === tradeKey) return;   // 바뀐 게 없으면 다시 그리지 않음 (스크롤·버튼 눌림 유지)
    tradeKey = key;
    const prev = tradeEl.querySelector('.trade-list');
    const scrollTop = prev ? prev.scrollTop : 0;
    const rows = ps.length
      ? ps.map((p) =>
          '<div class="trade-row"><div class="trade-pt" style="background:' + portraitColor(p.nick) + '">' + esc(Array.from(p.nick)[0] || '?') + '<i></i></div>' +
          '<div class="trade-info"><div class="trade-nm">' + esc(p.nick) + '</div><div class="trade-lv">Lv.' + p.level + '</div></div>' +
          '<button class="trade-btn" data-trade="' + esc(p.pid) + '">거래하기</button></div>').join('')
      : '<div class="trade-empty">주변에 거래할 수 있는<br>플레이어가 없어요</div>';
    tradeEl.innerHTML =
      '<div class="trade-box"><div class="trade-hd"><div class="ic"><img src="/ui/icon_trade.png" alt="" draggable="false"></div><h2>거래하기</h2><div class="trade-x" data-tclose="1">✕</div></div>' +
      '<div class="trade-sec">주변 플레이어</div><div class="trade-list">' + rows + '</div></div>';
    const lst = tradeEl.querySelector('.trade-list');
    if (lst) lst.scrollTop = scrollTop;
  }

  tradeEl.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (performance.now() - tradeOpenT < 400) return;   // 메뉴를 연 그 터치의 click 이 바로 닫기로 처리되는 것 방지
    if (t === tradeEl || t.closest('[data-tclose]')) { closeWin(); return; }
    const b = t.closest('[data-trade]');
    if (b) {
      const r = remotes.get(b.getAttribute('data-trade'));
      toast((r && r.nick ? r.nick + '님과의 ' : '') + '거래는 아직 준비 중이에요');   // TODO: 거래 신청 소켓 이벤트 연결
    }
  });

  function openTrade() {
    closeQuest();
    winEl.style.display = 'none';
    scrEl.classList.remove('open', 'show');
    tradeOn = true;
    tradeOpenT = performance.now();
    renderTrade(true);
    tradeEl.style.display = 'flex';
    clearInterval(tradeTimer);
    tradeTimer = setInterval(() => renderTrade(false), 500);   // 열려 있는 동안 접속·퇴장을 바로 반영
    if (!uiOpen) {
      uiOpen = true;
      document.body.classList.add('uw-open');
      for (const k in keys) keys[k] = false;
      jumpHeld = false;
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch (err) { /* 무시 */ }
    }
  }
  function closeTrade() {
    tradeOn = false;
    clearInterval(tradeTimer);
    tradeEl.style.display = 'none';
  }
  function toggleTrade() {
    if (uiOpen && tradeOn) closeWin();
    else openTrade();
  }

  // ---------- 퀘스트 창: 진행중 / 전체 / 완료 / 실패 ----------
  // 퀘스트 데이터. 지금은 퀘스트가 하나도 없어서 비어 있어요. 나중에 아래 모양으로 넣으면 목록에 바로 나타나요.
  // { id: 'q1', title: '잃어버린 마을의 흔적', status: 'active'(진행중) | 'done'(완료) | 'fail'(실패),
  //   summary: '숲의 경계 지역으로 이동하기', dist: '342m', desc: '설명...',
  //   goals: [{ text: '숲의 경계 지역으로 이동하기', dist: '342m' }],
  //   rewards: [{ kind: 'gold', text: '골드 500' }, { kind: 'exp', text: '경험치 1,200' }] }
  const QUESTS = [];
  const QUEST_TABS = [
    ['active', '진행중', '진행중인 퀘스트가 없습니다'],
    ['all', '전체', '퀘스트가 없습니다'],
    ['done', '완료', '완료한 퀘스트가 없습니다'],
    ['fail', '실패', '실패한 퀘스트가 없습니다'],
  ];
  const questStyle = document.createElement('style');
  questStyle.textContent = `
.quest{position:fixed;inset:0;z-index:61;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);font-family:'Galmuri11','Galmuri9','Malgun Gothic',sans-serif;color:#e8dcc0;user-select:none;-webkit-user-select:none}
.q-box{position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:min(96vw,1000px);height:min(88vh,640px);border:2px solid #4a4030;border-radius:6px;background:linear-gradient(#1c1a18,#121110);box-shadow:0 0 0 2px #070605,inset 0 0 0 1px #5a4a30,0 12px 40px rgba(0,0,0,.8)}
.q-hd{flex:none;display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid #3a3226;background:linear-gradient(#26221c,#1a1814)}
.q-hd .ic{flex:none;width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 35% 30%,#4a3a22,#1f170c);border:2px solid #b8924a}
.q-hd .ic img{width:28px;height:28px;object-fit:contain}
.q-hd h2{margin:0;font-size:24px;font-weight:700;color:#f1e6c8;text-shadow:0 2px 0 #000}
.q-x{margin-left:auto;font-size:24px;line-height:1;padding:6px 8px;cursor:pointer;color:#bba880}
.q-x:hover{color:#fff}
.q-body{flex:1 1 auto;min-height:0;display:flex;gap:12px;padding:12px}
.q-left{flex:0 0 42%;min-width:0;display:flex;flex-direction:column}
.q-tabs{flex:none;display:flex;margin-bottom:10px;border:1px solid #3a3226;border-radius:4px;overflow:hidden}
.q-tab{flex:1;text-align:center;padding:10px 0;font-size:15px;font-weight:700;color:#a89c82;background:#17150f;cursor:pointer;border-right:1px solid #3a3226}
.q-tab:last-child{border-right:0}
.q-tab.on{color:#f4e2ac;background:linear-gradient(#3a2e1a,#251d10);box-shadow:inset 0 0 0 2px #b8924a}
.q-list{flex:1 1 auto;min-height:0;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#5a4a30 transparent}
.q-row{display:flex;align-items:center;gap:12px;padding:10px 12px;margin-bottom:8px;border:1px solid #2e2820;border-radius:4px;background:linear-gradient(#1f1c18,#171512);cursor:pointer}
.q-row.sel{border-color:#d9a43c;box-shadow:0 0 0 1px #d9a43c,0 0 10px rgba(217,164,60,.35)}
.q-dia{flex:none;width:34px;height:34px;display:flex;align-items:center;justify-content:center}
.q-dia b{display:block;width:24px;height:24px;transform:rotate(45deg);border:2px solid #d9a43c;display:flex;align-items:center;justify-content:center}
.q-dia b i{transform:rotate(-45deg);font-style:normal;font-weight:700;font-size:15px;color:#f4c24a}
.q-row.done .q-dia b{border-color:#5aa0ea}.q-row.done .q-dia b i{color:#8ec4ff}
.q-row.fail .q-dia b{border-color:#9a9a9a}.q-row.fail .q-dia b i{color:#bdbdbd}
.q-ri{flex:1;min-width:0}
.q-rt{font-size:16px;font-weight:700;color:#f4ead0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.q-rs{margin-top:3px;font-size:12.5px;color:#a89c82;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.q-rd{flex:none;font-size:12.5px;color:#a89c82}
.q-empty{padding:40px 10px;text-align:center;font-size:16px;color:#8f846c}
.q-right{flex:1 1 0;min-width:0;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;box-sizing:border-box;padding:18px 20px;border:2px solid #6b5636;border-radius:4px;background:url(/ui/parchment.jpg) 0 0/cover #cdb88d;color:#33200d;text-shadow:0 1px 0 rgba(255,235,190,.35);scrollbar-width:none}
.q-right::-webkit-scrollbar{display:none}
.q-dt{display:flex;align-items:center;gap:12px;font-size:22px;font-weight:700;color:#2a1a0c;padding-bottom:10px;border-bottom:1px solid rgba(70,42,18,.5)}
.q-desc{margin:12px 0 16px;font-size:14.5px;line-height:1.8;color:#3d2a14}
.q-sh{display:flex;align-items:center;gap:10px;margin:14px 0 8px;font-size:16px;font-weight:700;color:#2a1a0c}
.q-sh::after{content:'';flex:1;height:1px;background:rgba(70,42,18,.55)}
.q-goal{display:flex;align-items:center;gap:10px;padding:5px 2px;font-size:14.5px;color:#33200d}
.q-goal span:last-child{margin-left:auto;color:#5e4828}
.q-rw{display:flex;align-items:center;gap:12px;padding:5px 2px;font-size:14.5px}
.q-rwi{flex:none;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:2px solid #3d2810;border-radius:3px;background:#2b1f14;font-size:18px;font-weight:700;color:#e8c050}
.q-track{display:block;margin:20px auto 4px;padding:10px 40px;border:2px solid #3d2810;border-radius:4px;background:linear-gradient(#2a2f3a,#14171e);color:#eadfc0;font:700 16px 'Galmuri11','Malgun Gothic',sans-serif;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,235,190,.2)}
.q-track:hover{filter:brightness(1.25)}
.q-none{display:flex;align-items:center;justify-content:center;height:100%;text-align:center;line-height:1.9;font-size:16px;color:#6b5636}
@media (max-width:620px){
.q-body{flex-direction:column}
.q-left{flex:0 0 46%}
.q-right{flex:1 1 0;padding:12px 14px}
.q-tab{font-size:13px;padding:8px 0}
}
`;
  document.head.appendChild(questStyle);
  const questEl = document.createElement('div');
  questEl.className = 'quest';
  document.body.appendChild(questEl);
  let questOn = false, questTab = 0, questSel = null, questOpenT = 0;

  function questList() {
    const key = QUEST_TABS[questTab][0];
    return QUESTS.filter((q) => key === 'all' || q.status === key);
  }
  const questMark = (st) => (st === 'done' ? '✓' : st === 'fail' ? '✕' : '!');

  function questDetail(q) {
    if (!q) return '<div class="q-none">퀘스트를 선택하면<br>상세 정보가 표시됩니다.</div>';
    const goals = (q.goals || []).map((g) =>
      '<div class="q-goal"><span>◆</span><span>' + esc(g.text) + '</span><span>' + esc(g.dist || '') + '</span></div>').join('');
    const rewards = (q.rewards || []).map((r) =>
      '<div class="q-rw"><div class="q-rwi">' + (r.kind === 'exp' ? 'EXP' : '●') + '</div><span>' + esc(r.text) + '</span></div>').join('');
    return '<div class="q-dt"><span class="q-dia"><b><i>' + questMark(q.status) + '</i></b></span>' + esc(q.title) + '</div>' +
      '<div class="q-desc">' + esc(q.desc || '').replace(/\n/g, '<br>') + '</div>' +
      (goals ? '<div class="q-sh">목표</div>' + goals : '') +
      (rewards ? '<div class="q-sh">보상</div>' + rewards : '') +
      (q.status === 'active' ? '<button class="q-track" data-qtrack="' + esc(q.id) + '">추적하기</button>' : '');
  }

  function renderQuest() {
    const list = questList();
    if (!list.some((q) => q.id === questSel)) questSel = list.length ? list[0].id : null;
    const cur = list.find((q) => q.id === questSel) || null;
    const prev = questEl.querySelector('.q-list');
    const scrollTop = prev ? prev.scrollTop : 0;
    const tabs = QUEST_TABS.map((t, k) => '<div class="q-tab' + (k === questTab ? ' on' : '') + '" data-qtab="' + k + '">' + t[1] + '</div>').join('');
    const rows = list.length
      ? list.map((q) =>
          '<div class="q-row ' + esc(q.status) + (q.id === questSel ? ' sel' : '') + '" data-qid="' + esc(q.id) + '">' +
          '<div class="q-dia"><b><i>' + questMark(q.status) + '</i></b></div>' +
          '<div class="q-ri"><div class="q-rt">' + esc(q.title) + '</div><div class="q-rs">' + esc(q.summary || '') + '</div></div>' +
          '<div class="q-rd">' + esc(q.dist || '') + '</div></div>').join('')
      : '<div class="q-empty">' + QUEST_TABS[questTab][2] + '</div>';
    questEl.innerHTML =
      '<div class="q-box"><div class="q-hd"><div class="ic"><img src="/ui/icon_quest.png" alt="" draggable="false"></div><h2>퀘스트</h2><div class="q-x" data-qclose="1">✕</div></div>' +
      '<div class="q-body"><div class="q-left"><div class="q-tabs">' + tabs + '</div><div class="q-list">' + rows + '</div></div>' +
      '<div class="q-right">' + questDetail(cur) + '</div></div></div>';
    const lst = questEl.querySelector('.q-list');
    if (lst) lst.scrollTop = scrollTop;
  }

  questEl.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (performance.now() - questOpenT < 400) return;   // 메뉴를 연 그 터치의 click 이 바로 닫기로 처리되는 것 방지
    if (t === questEl || t.closest('[data-qclose]')) { closeWin(); return; }
    const tab = t.closest('[data-qtab]');
    if (tab) { questTab = Number(tab.getAttribute('data-qtab')); questSel = null; renderQuest(); return; }
    const row = t.closest('[data-qid]');
    if (row) { questSel = row.getAttribute('data-qid'); renderQuest(); return; }
    if (t.closest('[data-qtrack]')) toast('퀘스트 추적은 아직 준비 중이에요');   // TODO: 추적 표시 연결
  });

  function openQuest() {
    closeTrade();
    winEl.style.display = 'none';
    scrEl.classList.remove('open', 'show');
    questOn = true;
    questOpenT = performance.now();
    questTab = 0;   // 열 때는 항상 진행중 탭부터
    questSel = null;
    renderQuest();
    questEl.style.display = 'flex';
    if (!uiOpen) {
      uiOpen = true;
      document.body.classList.add('uw-open');
      for (const k in keys) keys[k] = false;
      jumpHeld = false;
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch (err) { /* 무시 */ }
    }
  }
  function closeQuest() {
    questOn = false;
    questEl.style.display = 'none';
  }
  function toggleQuest() {
    if (uiOpen && questOn) closeWin();
    else openQuest();
  }

  // ---------- 화면 크기에 맞춰 터치 UI 크기 조절 ----------
  function applyUiScale() {
    if (!touchMode) return;
    uiScale = computeUiScale();
    document.documentElement.style.setProperty('--ui', String(uiScale));

    // 아래 가운데 패널: 조이스틱과 오른쪽 버튼 사이 공간에 맞춤
    const reserve = Math.max(26 + 130 * uiScale, 200 * uiScale) + 12;
    const wScreen = Math.max(220 * uiScale, Math.min(420 * uiScale, window.innerWidth - 2 * reserve));
    bottomWrap.style.width = (wScreen / uiScale) + 'px';

    // 나침반: 화면 폭의 40%까지
    compass.style.width = Math.min(420, (window.innerWidth * 0.4) / uiScale) + 'px';
    compass.style.transform = 'translateX(-50%) scale(' + uiScale + ')';
    compass.style.transformOrigin = 'center top';
  }
  window.addEventListener('resize', applyUiScale);
  window.addEventListener('orientationchange', applyUiScale);
  applyUiScale();

  // ---------- 다른 플레이어 ----------
  const remotes = new Map();

  // 다른 사람이 연 문도 같이 보이게 (서버가 전달)
  socket.on('doors', (list) => { if (Array.isArray(list)) for (const i of list) setDoorOpen(i, true); });
  socket.on('door', (d) => { if (d) setDoorOpen(d.i, d.open); });
  socket.emit('doors?');

  socket.on('state', (data) => {
    const list = normalizePlayers(data);
    const seen = new Set();

    for (const rawPlayer of list) {
      const p = parsePlayer(rawPlayer);

      if (
        !p ||
        p.id == null ||
        !Number.isFinite(Number(p.x)) ||
        !Number.isFinite(Number(p.z))
      ) {
        continue;
      }

      const pid = p.id;
      const x = Number(p.x);
      const y = Number(p.y) || 0;
      const z = Number(p.z);
      const ry = Number(p.ry) || 0;

      if (String(pid) === String(id)) continue;

      seen.add(pid);

      let remote = remotes.get(pid);

      if (!remote) {
        remote = {
          g: makeAvatar(p.nick || '플레이어', 0xffa040),
          t: { x, y, z, ry }
        };

        remote.g.position.set(x, y, z);
        scene.add(remote.g);
        remotes.set(pid, remote);
        setRemoteWeapon(remote.g.userData.rig, p.eq, true);   // 처음 보이는 순간에 이미 들고 있으면 모션 없이 든 상태로
      } else if (!!p.eq !== !!remote.eq) {
        setRemoteWeapon(remote.g.userData.rig, p.eq);          // 장착/해제 모션 재생
      }

      remote.eq = !!p.eq;
      remote.nick = p.nick || '플레이어';
      remote.level = p.level || 1;
      remote.t = { x, y, z, ry };
    }

    for (const [pid, remote] of remotes) {
      if (!seen.has(pid)) {
        scene.remove(remote.g);
        remotes.delete(pid);
      }
    }
  });

  // 다른 플레이어의 평타 모션 (서버가 장착·쿨다운을 검사한 뒤 전달)
  socket.on('atk', (d) => {
    const remote = d && remotes.get(d.id);
    if (remote) startWeaponAttack(remote.g.userData.rig, true, d.s);
  });

  socket.on('correct', (p) => {
    if (!p) return;

    if (Number.isFinite(p.x)) me.x = p.x;
    if (Number.isFinite(p.z)) me.z = p.z;
  });

  // ---------- 스킬 (E / R / T) ----------
  // 지금은 E = 휩쓸기만 있고 R·T 는 빈 칸이에요. 스킬을 더하려면 SKILL_SLOTS 의 id 를 채우고 useSkill 에 동작을 넣으면 돼요.
  // 실제 피해·범위·쿨타임 확정은 서버(server.js 'skill' + goblin-ai.mjs SKILLS). 여기는 입력·모션·이펙트·쿨타임 표시.
  const SKILL_SLOTS = [
    { key: 'E', id: 'sweep', name: '휩쓸기', cd: 10 },   // cd = 쿨타임(초). 서버 값(goblin-ai.mjs SKILLS.sweep.COOLDOWN)과 같게
    { key: 'R', id: null, name: '없음', cd: 0 },
    { key: 'T', id: null, name: '없음', cd: 0 },
  ];
  const SKILLBAR_PC_SCALE = 2.5;  // 컴퓨터(키보드 모드)에서 스킬 칸 크기 배율. 화면 높이를 넘지 않게 자동으로 줄여요
  const skillReadyAt = {};        // 스킬 id -> 다시 쓸 수 있는 시각(performance.now 기준)
  let skillFx = null;   // (이름 주의: 게임 루프 안에 fx 라는 다른 변수가 있어서 skillFx 로 씀)
  import('./skill-fx.js')
    .then((m) => { skillFx = m.createSkillFx(scene); })
    .catch((err) => console.error('스킬 이펙트 로드 실패:', err));

  function useSkill(key) {
    const def = SKILL_SLOTS.find((s) => s.key === key);
    if (!def) return;
    if (uiOpen) return;
    if (!def.id) { toast('비어 있는 스킬 칸이에요'); return; }
    if (!isWeaponEquipped(myRig)) { toast('검을 먼저 장착해야 해요'); return; }
    const left = (skillReadyAt[def.id] || 0) - performance.now();
    if (left > 0) { toast(def.name + ' 쿨타임 ' + Math.ceil(left / 1000) + '초'); return; }
    if (def.id === 'sweep') {
      if (!startWeaponSweep(myRig)) return;          // 장착/해제 모션 중이면 못 씀 (쿨타임도 안 씀)
      skillReadyAt.sweep = performance.now() + def.cd * 1000;
      socket.emit('skill', { id: 'sweep' });
      if (skillFx) { try { skillFx.play('sweep', myAvatar.position.x, myAvatar.position.y, myAvatar.position.z, me.ry); } catch (err) { console.error('스킬 이펙트 오류:', err); } }
    }
  }

  // 다른 플레이어가 쓴 스킬 (모션 + 이펙트)
  socket.on('skillfx', (d) => {
    const remote = d && remotes.get(d.id);
    if (!remote || d.skill !== 'sweep') return;
    startWeaponSweep(remote.g.userData.rig, true);
    if (skillFx) { try { skillFx.play('sweep', remote.g.position.x, remote.g.position.y, remote.g.position.z, remote.g.rotation.y); } catch (err) { console.error('스킬 이펙트 오류:', err); } }
  });

  // 화면의 스킬 칸 (참고 이미지 스타일, 오른쪽 끝 화면 가운데 위쪽)
  {
    const bar = document.createElement('div');
    bar.className = 'skillbar';
    if (!touchMode) {
      const fit = () => bar.style.setProperty('--sk', String(Math.max(1, Math.min(SKILLBAR_PC_SCALE, (window.innerHeight * 0.85) / (56 * 3 + 12)))));
      fit();
      window.addEventListener('resize', fit);
    }
    const slotEls = SKILL_SLOTS.map((def) => {
      const el = document.createElement('div');
      el.className = 'skill-slot';
      el.innerHTML = '<i class="k">' + def.key + '</i><b class="n' + (def.name.length > 2 ? ' s' : '') + '">' + def.name + '</b><div class="cdv"></div><em class="cdn"></em>';
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.classList.add('press'); useSkill(def.key); });
      const up = () => el.classList.remove('press');
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
      bar.appendChild(el);
      return { def, el, cdv: el.querySelector('.cdv'), cdn: el.querySelector('.cdn') };
    });
    document.body.appendChild(bar);
    setInterval(() => {   // 쿨타임 표시 (아래에서 위로 줄어드는 어두운 막 + 남은 초)
      const now = performance.now();
      for (const s of slotEls) {
        const left = s.def.id ? (skillReadyAt[s.def.id] || 0) - now : 0;
        if (left > 0) {
          s.el.classList.add('cool');
          s.cdv.style.height = Math.min(100, (left / (s.def.cd * 1000)) * 100) + '%';
          s.cdn.textContent = Math.ceil(left / 1000);
        } else if (s.el.classList.contains('cool')) {
          s.el.classList.remove('cool');
          s.cdv.style.height = '0';
          s.cdn.textContent = '';
        }
      }
    }, 100);
  }

  // ---------- 게임 루프 ----------
  // ---------- 고블린 (서버가 위치·전투를 정하고, 여기서는 받아서 그림) ----------
  // goblin.mjs 를 못 불러와도 게임 자체는 그대로 돌아가요.
  let goblins = null;
  let lastGob = [];
  import('./goblin.mjs')
    .then((m) => {
      goblins = m.createGoblinWorld({ scene, camera, T, WATER_LEVEL });
      goblins.onSnapshot(lastGob);
    })
    .catch((err) => console.error('고블린 로드 실패:', err));
  socket.on('gob', (list) => {
    lastGob = Array.isArray(list) ? list : [];
    if (goblins) goblins.onSnapshot(lastGob);
  });

  // 내 체력 (서버가 정함)
  const hurtEl = document.createElement('div');
  hurtEl.style.cssText = 'position:fixed;inset:0;z-index:8;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,rgba(200,0,0,0) 45%,rgba(200,10,10,.55) 100%)';
  document.body.appendChild(hurtEl);
  function flashHurt() {
    hurtEl.style.transition = 'none';
    hurtEl.style.opacity = '1';
    requestAnimationFrame(() => requestAnimationFrame(() => { hurtEl.style.transition = 'opacity .35s'; hurtEl.style.opacity = '0'; }));
  }
  socket.on('hp', (d) => {
    if (!d || !Number.isFinite(d.hp) || !Number.isFinite(d.max)) return;
    const before = PLAYER.hp;
    PLAYER.hp = d.hp;
    PLAYER.hpMax = d.max;
    const bar = bui.querySelector('.hp .hpmp-in i'), txt = bui.querySelector('.hp .hpmp-in span');
    if (bar) bar.style.width = pct(d.hp, d.max) + '%';
    if (txt) txt.textContent = fmt(Math.ceil(d.hp)) + ' / ' + fmt(d.max);
    if (d.hp < before) flashHurt();
  });
  socket.on('kill', () => toast('고블린을 처치했습니다!'));
  socket.on('notice', (t) => { if (typeof t === 'string') toast(t); });

  let sendTimer = 0;
  let compassTimer = 0;
  const clock = new THREE.Clock();

  function loop() {
    requestAnimationFrame(loop);

    const dt = Math.min(clock.getDelta(), 0.1);

    // 방향키로 화면 회전 (좌우 무제한, 위아래는 거의 수직까지)
    if (keys.ArrowLeft) me.yaw += 1.8 * dt;
    if (keys.ArrowRight) me.yaw -= 1.8 * dt;
    if (keys.ArrowUp) me.pitch -= 1.5 * dt;
    if (keys.ArrowDown) me.pitch += 1.5 * dt;
    me.pitch = wrapPitch(me.pitch);

    // 이동 입력 (앞뒤 inF, 좌우 inR)
    let inF = 0;
    let inR = 0;

    if (touchMode) {
      if (Math.hypot(joy.x, joy.y) > 0.12) {
        inF = joy.y;
        inR = joy.x;
      }
    } else {
      inF = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
      inR = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    }

    if (uiOpen) { inF = 0; inR = 0; }
    const mag = Math.min(1, Math.hypot(inF, inR));

    const fx = -Math.sin(me.yaw);
    const fz = -Math.cos(me.yaw);
    const rx = Math.cos(me.yaw);
    const rz = -Math.sin(me.yaw);

    const mx = fx * inF + rx * inR;
    const mz = fz * inF + rz * inR;
    const len = Math.hypot(mx, mz);

    let moved = 0;

    if (len > 0.01) {
      const running = RUN_TOGGLE ? runOn : (keys.ControlLeft || keys.ControlRight);
      const speed =
        7 * SPEED_SCALE * (running ? RUN_MULT : 1) * (fast ? fastMult : 1) * mag;

      const dirX = mx / len;
      const dirZ = mz / len;

      let px = me.x + dirX * speed * dt;
      let pz = me.z + dirZ * speed * dt;

      // 원형 활동 범위 제한
      const pr = Math.hypot(px, pz);
      if (pr > PLAY_RADIUS) {
        px *= PLAY_RADIUS / pr;
        pz *= PLAY_RADIUS / pr;
      }

      // 충돌: 방 안은 벽/가구, 땅 위는 나무/큰 바위/건물 (속도 배율 켠 개발용 이동 중 땅 위에서는 무시)
      const CR = 0.4 * CHAR_SCALE;
      if (curRoom >= 0) {
        const rc = collideRoom(curRoom, px, pz, CR);
        px = rc.x; pz = rc.z;
      } else if (!fast) {
        const cc = nature.collide(px, pz, CR);
        const bc = collideBuildings(cc.x, cc.z, CR, me.y);
        px = bc.x; pz = bc.z;
      }

      moved = Math.hypot(px - me.x, pz - me.z);
      me.x = px;
      me.z = pz;

      // 시프트락이 꺼져 있으면 가는 방향으로 몸을 돌림
      if (!shiftLock) me.ry = Math.atan2(dirX, dirZ);
      idleTime = 0;
    } else {
      idleTime += dt;
      if (RUN_TOGGLE && runOn && idleTime > 0.4) setRun(false); // 멈추면 달리기 해제
    }

    // 시프트락: 항상 카메라가 보는 방향을 바라봄 (이동은 수평 이동)
    if (shiftLock) me.ry = Math.atan2(fx, fz);

    // 점프 / 중력
    if (keys.Space || jumpHeld) jumpBuffer = Math.max(jumpBuffer, 0.1);
    jumpBuffer = Math.max(0, jumpBuffer - dt);

    // 서 있는 바닥: 방 안 = 방 바닥, 여관 안 = 1층/계단/2층, 그 밖 = 땅
    let ground;
    if (curRoom >= 0) ground = roomFloorY(curRoom);
    else {
      const fl = innFloor(me.x, me.z, me.y);
      ground = fl !== null ? fl : Math.max(T.height(me.x, me.z), WATER_LEVEL - 0.8);
    }
    const stepTol = 0.6 + moved * 2.0;

    if (grounded) {
      if (me.y - ground > stepTol) grounded = false; // 절벽 끝에서 떨어짐
      else me.y = ground;
    }

    if (grounded && jumpBuffer > 0) {
      vy = JUMP_V;
      grounded = false;
      jumpBuffer = 0;
    }

    if (!grounded) {
      vy -= GRAVITY * dt;
      me.y += vy * dt;

      if (me.y <= ground) {
        me.y = ground;
        if (vy < 0) {
          vy = 0;
          grounded = true;
        }
      }
    }

    const inHouse = updateHouses(dt, me.x, me.y, me.z, curRoom);   // 문 열림 애니메이션 + 방 보이기 + 실내 조명
    myAvatar.position.set(me.x, me.y, me.z);
    myAvatar.rotation.y = me.ry;
    animateHumanoid(myAvatar, dt, moved / Math.max(dt, 1e-4), grounded, vy);

    // 3인칭 카메라 (360도 궤도 회전, 시프트락이면 어깨 너머 시점)
    slk += ((shiftLock ? 1 : 0) - slk) * (1 - Math.exp(-10 * dt));
    const side = 1.3 * slk * CAM_SCALE;
    const dist = (9 - 1.5 * slk) * CAM_SCALE * Math.max(zoomRaw, ZOOM_FP);
    const fp = zoomRaw <= ZOOM_FP;   // 끝까지 확대 = 1인칭

    const tx = me.x + rx * side;
    const tz = me.z + rz * side;

    const cx = tx + Math.sin(me.yaw) * Math.cos(me.pitch) * dist;
    const cz = tz + Math.cos(me.yaw) * Math.cos(me.pitch) * dist;

    const cy = Math.max(
      me.y + Math.sin(me.pitch) * dist + 1.5 * CHAR_SCALE,
      T.height(cx, cz) + 1.5 * CHAR_SCALE
    );

    const ty = me.y + 1.5 * CHAR_SCALE;
    if (curRoom >= 0 || inHouse >= 0) {
      // 방 안/여관 안: 시선 방향(위/아래)은 입력 그대로 두고, 벽/천장/바닥에 닿으면
      // 같은 방향 선상에서 캐릭터 쪽으로만 거리를 줄임 (방향이 바뀌지 않아 위아래가 뒤집히지 않음)
      const fit = (x, y, z) => curRoom >= 0 ? clampCameraRoom(curRoom, x, y, z) : clampCameraInRoom(inHouse, x, y, z, me.y);
      const ry0 = ty + Math.sin(me.pitch) * dist;   // 지형 보정 없는 원래 카메라 높이
      const ok = (m) => {
        const x = tx + (cx - tx) * m, y = ty + (ry0 - ty) * m, z = tz + (cz - tz) * m;
        const c = fit(x, y, z);
        return Math.abs(c.x - x) + Math.abs(c.y - y) + Math.abs(c.z - z) < 1e-4;
      };
      let lo = 0, hi = 1;
      if (ok(1)) lo = 1;
      else {
        for (let i = 0; i < 12; i++) {
          const m = (lo + hi) / 2;
          if (ok(m)) lo = m; else hi = m;
        }
      }
      lo = Math.max(lo, 0.25);   // 머리 속으로 파고들지 않게 최소 거리 유지
      const c = fit(tx + (cx - tx) * lo, ty + (ry0 - ty) * lo, tz + (cz - tz) * lo);
      camera.position.set(c.x, c.y, c.z);
    } else camera.position.set(cx, cy, cz);
    camera.up.set(0, 1, 0);
    myAvatar.visible = !fp;
    if (fp) {   // 1인칭: 캐릭터 눈 위치에서 바라보는 방향으로 봄
      const hy = me.y + 1.6 * CHAR_SCALE, cp = Math.cos(me.pitch);
      camera.position.set(me.x, hy, me.z);
      camera.lookAt(me.x - Math.sin(me.yaw) * cp, hy - Math.sin(me.pitch), me.z - Math.cos(me.yaw) * cp);
    } else camera.lookAt(tx, ty, tz);
    updateDoorHint();   // 문 옆에 뜨는 반투명 안내 (카메라 위치가 정해진 뒤에 화면 좌표로 바꿈)

    // 물: 격자에 맞춰 움직여서 파도가 떨리지 않게 하고, 시간을 흘려보냄 (용암도 같은 시간 사용)
    water.position.x = Math.round(me.x / WATER_STEP) * WATER_STEP;
    water.position.z = Math.round(me.z / WATER_STEP) * WATER_STEP;
    waterUniforms.uTime.value += dt;

    updateChunks(me.x, me.z);

    // 나침반 (0.1초마다)
    compassTimer += dt;
    if (compassTimer > 0.1) {
      compassTimer = 0;
      updateCompass();
    }

    // 다른 플레이어 위치 보간
    for (const remote of remotes.values()) {
      // 땅 밑 방에 있는 사람은 땅 위에서 보이면 안 됨 (높이 차이로 판단). 방 출입(순간이동)은 미끄러지지 않고 바로 이동
      remote.g.visible = Math.abs(remote.t.y - me.y) < 60;
      if (Math.hypot(remote.t.x - remote.g.position.x, remote.t.z - remote.g.position.z) + Math.abs(remote.t.y - remote.g.position.y) > 25) {
        remote.g.position.set(remote.t.x, remote.t.y, remote.t.z);
      }
      const k = 1 - Math.exp(-12 * dt);
      const ox = remote.g.position.x;
      const oy = remote.g.position.y;
      const oz = remote.g.position.z;

      remote.g.position.x += (remote.t.x - remote.g.position.x) * k;
      remote.g.position.y += (remote.t.y - remote.g.position.y) * k;
      remote.g.position.z += (remote.t.z - remote.g.position.z) * k;
      remote.g.rotation.y = remote.t.ry;

      // 위치 변화로 속도를 구해서 걷기/점프 애니메이션 재생
      const idt = Math.max(dt, 1e-4);
      const kk = 1 - Math.exp(-10 * dt);
      remote.sp = (remote.sp ?? 0) + (Math.hypot(remote.g.position.x - ox, remote.g.position.z - oz) / idt - (remote.sp ?? 0)) * kk;
      remote.vy = (remote.vy ?? 0) + ((remote.g.position.y - oy) / idt - (remote.vy ?? 0)) * kk;

      const rGround = Math.max(T.height(remote.g.position.x, remote.g.position.z), WATER_LEVEL - 0.8);
      const rAir = remote.g.position.y - rGround > 0.5;
      animateHumanoid(remote.g, dt, remote.sp, !rAir, remote.vy);
    }

    if (skillFx) { try { skillFx.update(dt); } catch (err) { console.error('스킬 이펙트 오류 (이펙트만 끕니다):', err); skillFx = null; } }
    if (goblins) {
      try { goblins.update(dt); } catch (err) { console.error('고블린 오류 (고블린만 끕니다):', err); goblins = null; }
    }

    // 서버로 이동 정보 전송
    sendTimer += dt;

    if (sendTimer > 0.05) {
      sendTimer = 0;

      socket.emit('move', {
        x: me.x,
        y: me.y,
        z: me.z,
        ry: me.ry
      });
    }

    // 자연 오브젝트: 배치 계산은 프레임 예산 안에서, 빠른 이동(×30 이상)에는 새 배치를 미룸
    if (curRoom >= 0) updatePortalCamera();        // 방 안에서는 유령 위치 기준으로 자연 오브젝트를 불러옴
    nature.update(curRoom >= 0 ? vcam : camera, { fast: fast && fastMult >= 30 });
    const ns = nature.stats();
    const ri = renderer.info.render;   // 직전 프레임 값 (render 전에 읽음)

    $('hud').textContent =
      `X ${me.x.toFixed(0)}  Z ${me.z.toFixed(0)}\n` +
      `청크 ${chunks.size}  접속 ${remotes.size + 1}명\n` +
      `자연 ${ns.instances}개  대기 ${ns.queued}\n` +
      `드로우콜 ${ri.calls}  삼각형 ${ri.triangles}`;


    if (curRoom >= 0) {
      renderPortal();                              // 창문에 보일 바깥 풍경을 먼저 그림
      // 방 안 화면에는 방/조명/캐릭터만 그리면 되므로 땅·자연·마을은 잠깐 숨겨서 그리기 부담을 줄임
      const keep = new Set([myAvatar]);
      for (const r of remotes.values()) keep.add(r.g);
      const hidden = [];
      for (const o of scene.children) {
        if (o.isLight || o.userData.keepInRoom || keep.has(o) || !o.visible) continue;
        o.visible = false; hidden.push(o);
      }
      renderer.render(scene, camera);
      for (const o of hidden) o.visible = true;
    } else renderer.render(scene, camera);
  }

  // 초기 청크를 빠르게 생성
  updateChunks(me.x, me.z);
  updateChunks(me.x, me.z);
  updateChunks(me.x, me.z);
  updateCompass();

  loop();
}
