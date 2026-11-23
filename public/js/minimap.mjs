// 지도 (화면 왼쪽 위 작은 지도 + 누르면 화면 가득 커지는 큰 지도)
//  - 그림은 /ui/world_map.webp (둥근 테두리가 있는 대륙 그림). 월드 좌표(x, z) 를 그림 위 위치로 바꿔서 그 위에 표시를 그려요.
//  - 표시: 내 위치(흰 화살표, 보는 방향) · 다른 플레이어(주황 점) · 시작마을 · 동굴 입구 · 보스 터와 오크 대전사(💀, 싸우는 중이면 깜빡임)
//          · 몬스터 구역(🐇 토끼 평원 · 🟢 슬라임 고원 · 👺 고블린 서식지, 점선은 구역 경계) · 지형 이름(바다·정글·화산·설원·사막)
//  - 위쪽이 북쪽(-z), 오른쪽이 동쪽(+x). 지도를 누르거나 M 키로 큰 지도를 열고 닫아요 (PC 는 ESC 로 마우스 고정을 푼 뒤 눌러야 해요)
//  - 그림을 다른 것으로 바꾸려면: 파일을 같은 이름으로 덮어쓰고, 아래 IMG_W/IMG_H(그림 크기)와 ART(월드→그림 위치 맞춤값)만 고치면 돼요.
import { PLAY_RADIUS, VILLAGE, LANDMARKS } from './terrain.js';
import { PLAIN_ZONE, plainZoneAt } from './plain-zones.mjs';

const R = PLAY_RADIUS;
const MAP_URL = '/ui/world_map.webp';
const IMG_W = 1248, IMG_H = 1210;      // 그림 크기(픽셀). 가로세로 비율이 지도 모양이 돼요
const AR = IMG_H / IMG_W;
// 월드 좌표 → 그림 픽셀:  px = cx + sx * x,  py = cy + sz * z   (cx, cy = 시작마을이 그려진 자리, sx/sz = 월드 1칸이 그림에서 몇 픽셀인지)
// 월드 지형(바다·사막·화산·설원 구역)과 그림을 겹쳐 보면서 맞춘 값이에요.
const ART = { cx: 637, cy: 595, sx: 0.395, sz: 0.39 };

const BIOME_TAG = { 바다: '🌊', 정글: '🌲', 화산: '🌋', 설원: '❄️', 사막: '🌵' };   // LANDMARKS 의 이름 → 아이콘
const ZONE_NAME = { rabbit: '토끼 평원', goblin: '고블린 서식지', slime: '슬라임 고원' };
const ZONE_ICON = { rabbit: '🐇', goblin: '👺', slime: '🟢' };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createMinimap({ T, getMe, getOthers, getBoss, getCave }) {
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const SMALL_W = touch ? 120 : 190, SMALL_H = Math.round(SMALL_W * AR);
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);

  // ---------- 그림 ----------
  const art = new Image();
  let artState = 'loading';
  art.onload = () => { artState = 'ok'; };
  art.onerror = () => { artState = 'error'; console.error('지도 그림을 못 불러왔어요:', MAP_URL); };
  art.src = MAP_URL;

  // ---------- 몬스터 구역 이름표 위치: 그 구역 평원 칸들의 한가운데 (처음에 한 번만, 게임이 끊기지 않게 살짝 늦춰서) ----------
  const zoneAt = { rabbit: null, slime: null, goblin: null };
  setTimeout(() => {
    const sum = { rabbit: [0, 0, 0], slime: [0, 0, 0], goblin: [0, 0, 0] }, G = 56;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = -R + (i + 0.5) / G * 2 * R, z = -R + (j + 0.5) / G * 2 * R;
      if (x * x + z * z > R * R || T.biome(x, z) !== 'plain') continue;
      const zn = plainZoneAt(x, z, VILLAGE);
      if (zn) { const s = sum[zn]; s[0] += x; s[1] += z; s[2]++; }
    }
    const mid = { rabbit: 0, slime: (PLAIN_ZONE.RABBIT_HALF_DEG + PLAIN_ZONE.SLIME_END_DEG) / 2, goblin: (PLAIN_ZONE.SLIME_END_DEG + 360 - PLAIN_ZONE.RABBIT_HALF_DEG) / 2 };
    for (const zn of Object.keys(sum)) {
      const s = sum[zn];
      if (s[2] > 20) zoneAt[zn] = [s[0] / s[2], s[1] / s[2]];
      else { const a = mid[zn] * Math.PI / 180; zoneAt[zn] = [VILLAGE.x + Math.sin(a) * R * 0.45, VILLAGE.z - Math.cos(a) * R * 0.45]; }   // 평원 칸이 없으면 방향만으로
    }
  }, 120);

  // ---------- 화면 요소 ----------
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + 'px'; c.style.height = h + 'px'; c.style.display = 'block'; return c; };
  const small = document.createElement('div');
  small.style.cssText = 'position:fixed;left:8px;top:8px;z-index:8;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;filter:drop-shadow(0 2px 6px rgba(0,0,0,.7))';
  small.title = '누르거나 M 키: 큰 지도';
  const sc = mkCanvas(SMALL_W, SMALL_H); small.appendChild(sc);
  document.body.appendChild(small);
  document.documentElement.style.setProperty('--minimap-h', (SMALL_H + 4) + 'px');   // 개발자 패널이 지도 아래로 내려가게

  const bigWrap = document.createElement('div');
  bigWrap.style.cssText = 'position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.62);display:none;align-items:center;justify-content:center;cursor:pointer';
  const bigSize = () => { const w = Math.floor(Math.min(innerWidth * 0.98, innerHeight * 0.975 / AR)); return [w, Math.floor(w * AR)]; };   // 화면에 거의 가득
  const bigBox = document.createElement('div');
  bigBox.style.cssText = 'position:relative;filter:drop-shadow(0 4px 24px rgba(0,0,0,.85))';
  let bc = null;
  bigWrap.appendChild(bigBox);
  document.body.appendChild(bigWrap);
  const note = document.createElement('div');   // 큰 지도 아래 안내
  note.style.cssText = 'position:absolute;left:0;right:0;bottom:6px;text-align:center;color:#f6e3a1;font:600 13px sans-serif;text-shadow:0 1px 3px #000,0 0 6px #000;pointer-events:none';
  note.textContent = '지도를 누르거나 M 키 · ESC 로 닫기';
  bigWrap.appendChild(note);
  let open = false;
  function setOpen(v) {
    open = v;
    bigWrap.style.display = v ? 'flex' : 'none';
    if (v) {
      const [w, h] = bigSize();
      if (bc) bc.remove();
      bc = mkCanvas(w, h); bigBox.style.width = w + 'px'; bigBox.style.height = h + 'px'; bigBox.appendChild(bc);
      draw(bc, w, h, true);
    }
  }
  small.addEventListener('click', (e) => { e.stopPropagation(); setOpen(true); });
  small.addEventListener('mousedown', (e) => e.stopPropagation());
  small.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  bigWrap.addEventListener('click', () => setOpen(false));
  addEventListener('keydown', (e) => {
    const tg = e.target && e.target.tagName;
    if (tg === 'INPUT' || tg === 'TEXTAREA') return;
    if (e.code === 'KeyM' && !e.ctrlKey && !e.altKey && !e.metaKey) setOpen(!open);
    else if (e.code === 'Escape' && open) setOpen(false);
  });
  addEventListener('resize', () => { if (open) setOpen(true); });

  // ---------- 그리기 ----------
  function draw(cv, w, h, big) {
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (artState === 'ok') ctx.drawImage(art, 0, 0, w, h);
    else {
      ctx.fillStyle = 'rgba(13,26,43,.9)'; ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w * 0.48, h * 0.48, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '600 ' + Math.round(w * 0.05) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(artState === 'error' ? '지도 그림 없음' : '지도 불러오는 중…', w / 2, h / 2);
    }
    const k = big ? w / 1000 : 1;                        // 큰 지도는 가로 1000px 기준 크기에 비율을 곱해요
    const S = (bigPx, smallPx) => (big ? bigPx * k : smallPx);
    const toPx = (x, z) => [(ART.cx + ART.sx * x) / IMG_W * w, (ART.cy + ART.sz * z) / IMG_H * h];
    const [vx, vz] = toPx(VILLAGE.x, VILLAGE.z);

    // 구역 경계 (점선): 마을 바깥 원 + 방사형 선 3개
    ctx.save();
    ctx.lineCap = 'round'; ctx.setLineDash([S(10, 4), S(7, 3)]);
    const strokeBoth = (path) => { ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = S(4.5, 2.4); ctx.stroke(path); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = S(2.2, 1.1); ctx.stroke(path); };
    const circle = new Path2D();
    for (let i = 0; i <= 72; i++) { const a = i / 72 * Math.PI * 2, [px, pz] = toPx(VILLAGE.x + Math.cos(a) * PLAIN_ZONE.INNER_R, VILLAGE.z + Math.sin(a) * PLAIN_ZONE.INNER_R); if (i) circle.lineTo(px, pz); else circle.moveTo(px, pz); }
    strokeBoth(circle);
    for (const deg of [PLAIN_ZONE.RABBIT_HALF_DEG, 360 - PLAIN_ZONE.RABBIT_HALF_DEG, PLAIN_ZONE.SLIME_END_DEG]) {
      const a = deg * Math.PI / 180, ln = new Path2D();
      ln.moveTo(...toPx(VILLAGE.x + Math.sin(a) * PLAIN_ZONE.INNER_R, VILLAGE.z - Math.cos(a) * PLAIN_ZONE.INNER_R));
      ln.lineTo(...toPx(VILLAGE.x + Math.sin(a) * R * 0.97, VILLAGE.z - Math.cos(a) * R * 0.97));
      strokeBoth(ln);
    }
    ctx.restore();

    // 이름표: 작은 지도는 아이콘만, 큰 지도는 아이콘 + 글자
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tag = (icon, name, x, z) => {
      const [px, pz] = toPx(x, z);
      ctx.font = Math.round(S(40, 13)) + 'px sans-serif'; ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = S(6, 3);
      ctx.fillText(icon, px, big ? pz - S(14, 0) : pz); ctx.shadowBlur = 0;
      if (big) outlined(ctx, name, px, pz + S(20, 0), S(19, 11), '#fff');
    };
    if (big) for (const lm of LANDMARKS) if (BIOME_TAG[lm.name]) tag(BIOME_TAG[lm.name], lm.name, lm.x, lm.z);   // 지형 이름은 큰 지도에서만 (작은 지도는 그림만으로 충분)
    // 몬스터 구역 이름표는 동굴·보스 터·시작마을 표시와 겹치지 않게 살짝 밀어내요
    const caveNow = getCave && getCave(), avoid = [[VILLAGE.x, VILLAGE.z, 300]];
    if (caveNow) avoid.push([caveNow.x, caveNow.z, 260]);
    if (T.arena) avoid.push([T.arena.x, T.arena.z, 280]);
    for (const zn of Object.keys(zoneAt)) {
      if (!zoneAt[zn]) continue;
      let [zx, zz] = zoneAt[zn];
      for (let it = 0; it < 3; it++) for (const [ax, az, rad] of avoid) { const dx = zx - ax, dz = zz - az, d = Math.hypot(dx, dz) || 1; if (d < rad) { zx += dx / d * (rad - d); zz += dz / d * (rad - d); } }
      tag(ZONE_ICON[zn], ZONE_NAME[zn], zx, zz);
    }
    ctx.restore();

    // 시작마을
    ctx.fillStyle = '#ffe08a'; ctx.strokeStyle = '#4a3010'; ctx.lineWidth = S(3, 1.5);
    ctx.beginPath(); ctx.arc(vx, vz, S(9, 3.8), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (big) outlined(ctx, '시작마을', vx, vz + S(26, 0), S(17, 11), '#ffe9a8');

    // 동굴 입구
    const cave = getCave && getCave();
    if (cave) {
      const [cx, cz] = toPx(cave.x, cave.z);
      ctx.fillStyle = '#1a1420'; ctx.strokeStyle = '#d9d0ff'; ctx.lineWidth = S(3, 1.5);
      ctx.beginPath(); ctx.arc(cx, cz, S(8, 3.4), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (big) outlined(ctx, '동굴 (골렘)', cx, cz + S(24, 0), S(17, 11), '#e4dcff');
    }

    // 보스 터 + 오크 대전사
    const arena = T.arena, bs = getBoss && getBoss();
    if (arena) {
      const [ax, az] = toPx(arena.x, arena.z);
      const rx = Math.max(S(14, 5), arena.r * ART.sx / IMG_W * w);
      ctx.save(); ctx.strokeStyle = 'rgba(255,80,60,.95)'; ctx.fillStyle = 'rgba(60,20,10,.4)'; ctx.lineWidth = S(3, 1.5); ctx.setLineDash([S(7, 3), S(5, 2)]);
      ctx.beginPath(); ctx.arc(ax, az, rx, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
      const live = bs && bs.has && !bs.dying;
      const [bx, bz] = live ? toPx(bs.x, bs.z) : [ax, az];
      const pulse = live && bs.engaged ? 0.5 + 0.5 * Math.sin(performance.now() / 160) : 0;
      if (pulse) { ctx.strokeStyle = 'rgba(255,60,40,' + (0.4 + 0.5 * pulse) + ')'; ctx.lineWidth = S(4, 2); ctx.beginPath(); ctx.arc(bx, bz, S(20 + 12 * pulse, 8 + 5 * pulse), 0, Math.PI * 2); ctx.stroke(); }
      ctx.font = Math.round(S(40, 14)) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = bs && bs.has && bs.dying ? 0.45 : 1;
      ctx.fillText(bs && bs.has && bs.dying ? '✖' : '💀', bx, bz);
      ctx.globalAlpha = 1;
      if (big) outlined(ctx, '오크 대전사' + (live && bs.engaged ? ' (전투 중)' : ''), bx, bz + S(34, 0), S(17, 11), '#ffb0a0');
    }

    // 다른 플레이어 (주황 점)
    ctx.fillStyle = '#ffa040'; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineWidth = S(2, 1);
    for (const o of (getOthers ? getOthers() : [])) { const [px, pz] = toPx(...circleClamp(o[0], o[1])); ctx.beginPath(); ctx.arc(px, pz, S(6, 2.6), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }

    // 나 (흰 화살표 / 동굴 안이면 입구에 파란 링)
    const me = getMe && getMe();
    if (me) {
      if (me.under && cave) {
        const [cx, cz] = toPx(cave.x, cave.z);
        ctx.strokeStyle = '#7fd6ff'; ctx.lineWidth = S(4, 2); ctx.beginPath(); ctx.arc(cx, cz, S(16, 7.5), 0, Math.PI * 2); ctx.stroke();
        if (big || w > 150) outlined(ctx, '동굴 안', cx, cz - S(26, 12), S(17, 10), '#bfeaff');
      } else {
        const [mx, mz] = toPx(...circleClamp(me.x, me.z));
        ctx.save(); ctx.translate(mx, mz); ctx.rotate(Math.PI - me.ry);   // 보는 방향(앞 = +z = 지도 아래쪽)으로 돌림
        const u = S(2.7, 1);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = S(3, 1.5);
        ctx.beginPath(); ctx.moveTo(0, -7 * u); ctx.lineTo(5 * u, 5.5 * u); ctx.lineTo(0, 3 * u); ctx.lineTo(-5 * u, 5.5 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
  }
  // 월드 원 밖으로 나간 좌표는 가장자리로 당겨서 그림 밖에 안 찍히게
  function circleClamp(x, z) { const d = Math.hypot(x, z); return d > R ? [x * R / d, z * R / d] : [x, z]; }
  function outlined(ctx, text, x, y, size, color) {
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 ' + Math.round(size) + 'px sans-serif';
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, size * 0.28); ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.fillStyle = color;
    ctx.strokeText(text, x, y); ctx.fillText(text, x, y); ctx.restore();
  }

  // 0.1초마다 새로 그림 (그림은 그대로, 표시만 갱신)
  setInterval(() => {
    if (document.hidden) return;
    draw(sc, SMALL_W, SMALL_H, false);
    if (open && bc) { const [w, h] = bigSize(); draw(bc, w, h, true); }
  }, 100);

  return { open: () => setOpen(true), close: () => setOpen(false) };
}
