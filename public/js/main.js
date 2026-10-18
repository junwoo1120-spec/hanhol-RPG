import * as THREE from 'three';
import { makeTerrain, WATER_LEVEL, PLAY_RADIUS, LANDMARKS } from './terrain.js';
import { buildVillage } from './village.js';

// HTML 요소 선택 도우미
const $ = (id) => document.getElementById(id);

const S = 32;            // 청크 크기
const N = 32;            // 청크 분할 수
const VIEW = 5;          // 로딩 반경(청크 단위)
const UNLOAD = VIEW + 2;

const SPEED_SCALE = 1.5;  // 전체 이동속도 배율
const RUN_MULT = 2;       // 달리기 배율
const RUN_TOGGLE = true;  // true: Ctrl을 한 번 누르면 켜짐/꺼짐, false: 누르고 있는 동안만 달리기
const GRAVITY = 26;       // 중력
const JUMP_V = 10.5;      // 점프 힘

const FAST_MIN = 10;      // 속도 배율 최소
const FAST_MAX = 100;     // 속도 배율 최대 (서버 한도도 100)
const RES_HIGH = N;       // 평소 청크 해상도
const RES_LOW = 8;        // 빠르게 이동할 때 청크 해상도
const PITCH_LIMIT = 1.45; // 위아래 회전 한계 (거의 수직까지)

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

.speedpanel{position:fixed;top:8px;right:8px;z-index:5;width:190px;padding:8px;display:flex;flex-direction:column;gap:6px;border-radius:12px;background:rgba(20,14,38,.75);border:1px solid rgba(217,178,92,.75);color:#f6e3a1;font:600 13px sans-serif}
.speedpanel button{padding:7px 10px;font:700 14px sans-serif;border:1px solid #d9b25c;border-radius:8px;color:#fff;cursor:pointer}
.speedpanel .hint{font:400 11px sans-serif;opacity:.8}
body.touch .speedpanel{width:150px}
body.touch .speedpanel .hint{display:none}

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

// 플레이어 라벨
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

  sprite.scale.set(3, 0.75, 1);
  sprite.position.y = 2.6;

  return sprite;
}

// 플레이어 모델
function makeAvatar(nick, color) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 1.0, 4, 8),
    new THREE.MeshLambertMaterial({ color })
  );

  body.position.y = 0.9;
  group.add(body);
  group.add(makeLabel(nick));

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
    makeChoice('⌨️', '키보드', 'WASD · 마우스 / 방향키', 'keyboard'),
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

function connect(nick, mode) {
  $('msg').textContent = '서버에 연결 중...';

  const socket = io();

  socket.on('connect', () => {
    socket.emit('join', { nick });
  });

  socket.on('connect_error', (err) => {
    console.error('서버 연결 오류:', err);
    resetLogin('서버 연결에 실패했습니다.');
  });

  socket.on('full', () => {
    resetLogin('서버가 가득 찼어요 (최대 10명)');
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

  // 물은 플레이어 주변에 배치
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({
      color: 0x2f6fb5,
      transparent: true,
      opacity: 0.72
    })
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

  // 잔디/흙/모래 텍스처
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

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
        'attribute vec3 detail;\n' +
        'attribute vec3 detail2;\n' +
        'varying vec3 vDetail;\n' +
        'varying vec3 vDetail2;\n' +
        'varying vec2 vWorldXZ;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        'vDetail = detail;\n' +
        'vDetail2 = detail2;\n' +
        'vWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
        'uniform sampler2D uGrass;\n' +
        'uniform sampler2D uGold;\n' +
        'uniform sampler2D uJungle;\n' +
        'uniform sampler2D uDirt;\n' +
        'uniform sampler2D uVillage;\n' +
        'uniform sampler2D uSand;\n' +
        'varying vec3 vDetail;\n' +
        'varying vec3 vDetail2;\n' +
        'varying vec2 vWorldXZ;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 p = vWorldXZ;

          // 평원: 일반 잔디 + 연한 누런 잔디
          vec3 a1 = texture2D(uGrass, p * 0.25).rgb;
          float l1 =
