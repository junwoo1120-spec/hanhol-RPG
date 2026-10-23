import * as THREE from 'three';
import { makeTerrain, WATER_LEVEL, PLAY_RADIUS, LANDMARKS } from './terrain.js';
import { buildVillage } from './village.js';
import { makeHumanoid, animateHumanoid, humanReady } from './character.js';
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
const PITCH_LIMIT = 1.45; // 위아래 회전 한계 (거의 수직까지)

// 조작법 창에 표시할 내용 [키 목록, 설명]
const HELP_KEYBOARD = [
  [['W', 'A', 'S', 'D'], '이동'],
  [['Space'], '점프'],
  [['Ctrl'], '달리기 켜기/끄기'],
  [['Shift'], '시점 고정 켜기/끄기'],
  [['←', '→', '↑', '↓'], '화면 회전'],
  [['마우스'], '화면 회전 (화면 클릭 후)'],
  [['터치'], '화면 드래그로 회전'],
  [['F'], '속도 배율 켜기/끄기'],
  [['[', ']'], '속도 배율 -10 / +10'],
  [['1', '2', '3', '4'], '인벤토리·장비·스킬·특성'],
  [['H'], '조작법 열기/닫기'],
  [['Esc'], '마우스 잠금 해제'],
];
const HELP_TOUCH = [
  [['조이스틱'], '이동 (왼쪽 아래)'],
  [['화면 드래그'], '화면 회전'],
  [['⤒'], '점프'],
  [['🏃'], '달리기 켜기/끄기'],
  [['🔒'], '시점 고정 켜기/끄기'],
  [['⚔️', '✨'], '공격·스킬 (준비 중)'],
  [['속도 패널'], '속도 배율 ×10~100'],
  [['하단 메뉴'], '인벤토리·장비·스킬·특성'],
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

.rpg-status{position:fixed;top:8px;left:8px;z-index:5;max-width:200px;padding:6px 16px;border-radius:12px;background:linear-gradient(90deg,rgba(20,14,38,.88),rgba(20,14,38,.55));border:1px solid rgba(217,178,92,.75);box-shadow:0 2px 10px rgba(0,0,0,.45);color:#f6e3a1;font:600 13px sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}

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
.tbtn.atk{right:36px;bottom:132px;width:64px;height:64px}
.tbtn.skill{right:112px;bottom:112px;width:56px;height:56px}
.tbtn.run{right:132px;bottom:34px;width:58px;height:58px}
.tbtn.lock{right:38px;bottom:206px;width:52px;height:52px}

.toast{position:fixed;left:50%;top:70px;transform:translateX(-50%);padding:6px 14px;border-radius:14px;background:rgba(20,14,38,.9);color:#f6e3a1;border:1px solid #d9b25c;font:600 13px sans-serif;z-index:9;pointer-events:none;opacity:0;transition:opacity .25s}
.toast.show{opacity:1}
body.touch .joy-base{transform:scale(var(--ui,1));transform-origin:left bottom}
.tgroup{display:none}
body.touch .tgroup{display:block;position:fixed;right:0;bottom:0;width:230px;height:290px;z-index:6;pointer-events:none;transform:scale(var(--ui,1));transform-origin:right bottom}
body.touch .tgroup .tbtn{position:absolute;pointer-events:auto}
body.touch .bottom-wrap{transform:translateX(-50%) scale(var(--ui,1));transform-origin:center bottom}
body.touch .rpg-status{transform:scale(var(--ui,1));transform-origin:left top}
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

.bui-menu{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;width:74%;margin-top:10px}
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
body.touch .bui-menu{width:100%;gap:6px;margin-top:6px}
body.touch .mbtn{padding:4px 2px 3px}
body.touch .mbtn b{font-size:9px}
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
      ry: p[5]
    };
  }

  if (p && typeof p === 'object') {
    return {
      id: p.id ?? p.pid,
      nick: p.nick ?? p.name ?? '플레이어',
      x: p.x,
      y: p.y ?? 0,
      z: p.z,
      ry: p.ry ?? 0
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
  let slk = 0;             // 시프트락 카메라 이동 보간값

  const myAvatar = makeAvatar('', 0xffffff);
  myAvatar.children[1].visible = false;
  scene.add(myAvatar);

  // ---------- 공통 UI: 닉네임 표시, 안내 메시지, 조준점 ----------
  const status = document.createElement('div');
  status.className = 'rpg-status';
  status.textContent = nick;
  document.body.appendChild(status);

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
  setHelp(!touchMode); // 키보드 모드는 처음에 열어둠

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
  const keys = {};
  const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  const GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyH', 'Space'];

  window.addEventListener('keydown', (e) => {
    if (touchMode) return;

    if (ARROWS.includes(e.code) || e.code === 'Space') e.preventDefault();
    if (e.ctrlKey && GAME_KEYS.includes(e.code)) e.preventDefault();

    keys[e.code] = true;

    if (e.repeat) return;

    if (e.code === 'Space') jumpBuffer = 0.15;
    if (e.code === 'KeyF') setFast(!fast);
    if (e.code === 'KeyH') toggleHelp();
    if (e.code === 'BracketLeft') setMult(fastMult - 10);
    if (e.code === 'BracketRight') setMult(fastMult + 10);

    if ((e.code === 'ControlLeft' || e.code === 'ControlRight') && RUN_TOGGLE) {
      setRun(!runOn);
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      toggleShiftLock();
    }

    const m = /^Digit([1-4])$/.exec(e.code);
    if (m) menuPress(Number(m[1]) - 1);
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

    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== renderer.domElement) return;

      me.yaw -= e.movementX * 0.003;
      me.pitch = Math.min(
        PITCH_LIMIT,
        Math.max(-PITCH_LIMIT, me.pitch + e.movementY * 0.003)
      );
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

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || lookId !== null) return;
      lookId = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      me.yaw -= (e.clientX - lx) * 0.005;
      me.pitch = Math.min(
        PITCH_LIMIT,
        Math.max(-PITCH_LIMIT, me.pitch + (e.clientY - ly) * 0.005)
      );
      lx = e.clientX;
      ly = e.clientY;
    });
    const lookEnd = (e) => {
      if (e.pointerId === lookId) lookId = null;
    };
    canvas.addEventListener('pointerup', lookEnd);
    canvas.addEventListener('pointercancel', lookEnd);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

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
    makeBtn('atk', '⚔️', '공격', () => toast('공격은 아직 준비 중이에요'));
    makeBtn('skill', '✨', '스킬', () => toast('스킬은 아직 준비 중이에요'));
    runBtn = makeBtn('run', '🏃', '달리기', () => setRun(!runOn));
    lockBtn = makeBtn('lock', '🔒', '', () => toggleShiftLock());

    toast('왼쪽 조이스틱으로 이동, 화면을 드래그하면 시점이 돌아가요');
  }

  updateModeUI();

  // ---------- 하단 중앙 UI (레벨, HP/MP, 메뉴 버튼) ----------
  // 지금은 모양만 있는 임시 값이에요. 나중에 실제 값으로 바꾸면 돼요.
  const PLAYER = { level: 1, hp: 100, hpMax: 100, mp: 50, mpMax: 50 };

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
    ['/ui/icon_skill.png', '스킬'],
    ['/ui/icon_trait.png', '특성'],
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
    toast(MENUS[i][1] + ' 기능은 아직 준비 중이에요');
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
      }

      remote.t = { x, y, z, ry };
    }

    for (const [pid, remote] of remotes) {
      if (!seen.has(pid)) {
        scene.remove(remote.g);
        remotes.delete(pid);
      }
    }
  });

  socket.on('correct', (p) => {
    if (!p) return;

    if (Number.isFinite(p.x)) me.x = p.x;
    if (Number.isFinite(p.z)) me.z = p.z;
  });

  // ---------- 게임 루프 ----------
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
    me.pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, me.pitch));

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

      // 나무/큰 바위 충돌 (속도 배율 켠 개발용 이동 중에는 무시)
      if (!fast) {
        const cc = nature.collide(px, pz, 0.4 * CHAR_SCALE);
        px = cc.x; pz = cc.z;
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

    const ground = Math.max(T.height(me.x, me.z), WATER_LEVEL - 0.8);
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

    myAvatar.position.set(me.x, me.y, me.z);
    myAvatar.rotation.y = me.ry;
    animateHumanoid(myAvatar, dt, moved / Math.max(dt, 1e-4), grounded, vy);

    // 3인칭 카메라 (360도 궤도 회전, 시프트락이면 어깨 너머 시점)
    slk += ((shiftLock ? 1 : 0) - slk) * (1 - Math.exp(-10 * dt));
    const side = 1.3 * slk * CAM_SCALE;
    const dist = (9 - 1.5 * slk) * CAM_SCALE;

    const tx = me.x + rx * side;
    const tz = me.z + rz * side;

    const cx = tx + Math.sin(me.yaw) * Math.cos(me.pitch) * dist;
    const cz = tz + Math.cos(me.yaw) * Math.cos(me.pitch) * dist;

    const cy = Math.max(
      me.y + Math.sin(me.pitch) * dist + 1.5 * CHAR_SCALE,
      T.height(cx, cz) + 1.5 * CHAR_SCALE
    );

    camera.position.set(cx, cy, cz);
    camera.lookAt(tx, me.y + 1.5 * CHAR_SCALE, tz);

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
    nature.update(camera, { fast: fast && fastMult >= 30 });
    const ns = nature.stats();
    const ri = renderer.info.render;   // 직전 프레임 값 (render 전에 읽음)

    $('hud').textContent =
      `X ${me.x.toFixed(0)}  Z ${me.z.toFixed(0)}\n` +
      `청크 ${chunks.size}  접속 ${remotes.size + 1}명\n` +
      `자연 ${ns.instances}개  대기 ${ns.queued}\n` +
      `드로우콜 ${ri.calls}  삼각형 ${ri.triangles}`;

    renderer.render(scene, camera);
  }

  // 초기 청크를 빠르게 생성
  updateChunks(me.x, me.z);
  updateChunks(me.x, me.z);
  updateChunks(me.x, me.z);
  updateCompass();

  loop();
}
