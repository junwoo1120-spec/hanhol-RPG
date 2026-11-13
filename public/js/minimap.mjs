// 지도 (화면 왼쪽 위 작은 지도 + 누르면 커지는 큰 지도)
//  - 지형 전체(바다·해안·평원·사막·정글·화산·설원·얼음호수·마을)를 한 장으로 그려서 보여줘요. 처음에 조금씩 나눠서 그려서 게임이 끊기지 않아요.
//  - 평원은 구역별로 색을 살짝 입혔어요: 토끼 평원(분홍) · 고블린 서식지(진한 초록) · 슬라임 고원(연두). 점선은 구역 경계.
//  - 표시: 내 위치(흰 화살표, 보는 방향) · 다른 플레이어(주황 점) · 시작마을 · 동굴 입구 · 보스 터와 오크 대전사(💀, 싸우는 중이면 깜빡임)
//  - 위쪽이 북쪽(-z), 오른쪽이 동쪽(+x). 지도를 누르거나 M 키로 큰 지도를 열고 닫아요 (PC 는 ESC 로 마우스 고정을 푼 뒤 눌러야 해요)
import { WATER_LEVEL, PLAY_RADIUS, VILLAGE } from './terrain.js';
import { PLAIN_ZONE, plainZoneAt } from './plain-zones.mjs';

const R = PLAY_RADIUS;
const N = 384;   // 지형 그림 해상도 (한 칸 약 7m)
// 알아보기 쉽게 색을 서로 확실히 다르게: 바다(파랑) · 해안(연한 모래) · 평원(밝은 초록) · 정글(진한 초록) · 사막(노랑) · 화산(붉은 갈색) · 설원(흰색) · 얼음호수(하늘색) · 마을(금색)
const IDS = ['sea', 'coast', 'plain', 'village', 'desert', 'forest', 'volcano', 'snow', 'icelake'];
const ID_OF = Object.fromEntries(IDS.map((n, i) => [n, i]));
const COL = {
  coast: [232, 214, 164], plain: [132, 196, 86], village: [244, 218, 138], desert: [238, 206, 118], forest: [34, 108, 56],
  volcano: [146, 72, 48], snow: [238, 245, 252], icelake: [150, 214, 240],
};
const ZONE_TINT = { rabbit: [255, 140, 195], goblin: [24, 110, 56], slime: [200, 240, 50] };
const ZONE_TINT_K = { rabbit: 0.42, goblin: 0.34, slime: 0.34 };   // 구역마다 입히는 색의 세기
const BIOME_NAME = { forest: '정글', desert: '사막', volcano: '화산', snow: '설원', sea: '바다' };
const BIOME_ICON = { forest: '🌲', desert: '🌵', volcano: '🌋', snow: '❄️', sea: '🌊' };
const ZONE_NAME = { rabbit: '토끼 평원', goblin: '고블린 서식지', slime: '슬라임 고원' };
const ZONE_ICON = { rabbit: '🐇', goblin: '👺', slime: '🟢' };
const ZONE_ID = { rabbit: 1, goblin: 2, slime: 3 };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// 높이 배열을 부드럽게 (상자 평균을 두 번 = 가우시안 비슷). 지형 잔 요철이 지도에 거칠게 보이지 않게
function blur(src, w, rad) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), k = rad * 2 + 1;
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { let t = 0; for (let d = -rad; d <= rad; d++) t += src[y * w + clamp(x + d, 0, w - 1)]; tmp[y * w + x] = t / k; }
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { let t = 0; for (let d = -rad; d <= rad; d++) t += tmp[clamp(y + d, 0, w - 1) * w + x]; out[y * w + x] = t / k; }
  return out;
}

export function createMinimap({ T, getMe, getOthers, getBoss, getCave }) {
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const SMALL = touch ? 120 : 190;
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);

  // ---------- 지형 그림 (한 번만, 조금씩 나눠서) ----------
  // 1단계: 칸마다 지형 종류·높이·구역을 조사하며 대충 색을 칠함 → 2단계: 높이를 부드럽게 다듬어 음영 + 경계선을 넣어 완성
  const base = document.createElement('canvas'); base.width = base.height = N;
  const bctx = base.getContext('2d');
  const img = bctx.createImageData(N, N);
  const hmap = new Float32Array(N * N), bid = new Uint8Array(N * N).fill(255), zid = new Uint8Array(N * N);
  const sums = {};          // 바이옴별 위치 합 → 이름표·아이콘 위치
  let row = 0, built = false;
  const baseColor = (id, zone) => {
    const n = IDS[id];
    let c = COL[n] || COL.plain;
    if (n === 'plain' && zone) { const zn = zone === 1 ? 'rabbit' : zone === 2 ? 'goblin' : 'slime'; c = mixc(c, ZONE_TINT[zn], ZONE_TINT_K[zn]); }
    return c;
  };
  function finish() {   // 2단계
    const hs = blur(blur(hmap, N, 3), N, 2);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, k = i * 4, id = bid[i];
      if (id === 255) { img.data[k + 3] = 0; continue; }
      let c;
      if (id === ID_OF.sea) { const d = clamp(-hs[i] / 60, 0, 1); c = mixc([72, 150, 214], [14, 44, 104], Math.pow(d, 0.8)); }
      else {
        c = baseColor(id, zid[i]);
        const l = hs[y * N + Math.max(0, x - 1)], r = hs[y * N + Math.min(N - 1, x + 1)], u = hs[Math.max(0, y - 1) * N + x], dn = hs[Math.min(N - 1, y + 1) * N + x];
        const sh = clamp(1 + ((l - r) + (u - dn)) * 0.05, 0.8, 1.2);   // 왼쪽 위에서 빛이 오는 부드러운 음영
        c = [c[0] * sh, c[1] * sh, c[2] * sh];
        // 경계선: 바다와 닿은 땅은 해안선을 진하게, 다른 지형과 닿은 곳은 살짝 어둡게
        let coast = false, edge = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const nid = bid[ny * N + nx];
          if (nid === ID_OF.sea) coast = true; else if (nid !== 255 && nid !== id) edge = true;
        }
        if (coast) c = [c[0] * 0.62, c[1] * 0.66, c[2] * 0.72]; else if (edge) c = [c[0] * 0.82, c[1] * 0.82, c[2] * 0.82];
      }
      img.data[k] = clamp(c[0], 0, 255); img.data[k + 1] = clamp(c[1], 0, 255); img.data[k + 2] = clamp(c[2], 0, 255); img.data[k + 3] = 255;
    }
    bctx.putImageData(img, 0, 0);
    built = true;
  }
  function step() {
    const t0 = performance.now();
    while (row < N && performance.now() - t0 < 7) {
      const z = -R + (row + 0.5) / N * 2 * R;
      for (let i = 0; i < N; i++) {
        const x = -R + (i + 0.5) / N * 2 * R, k = (row * N + i) * 4, ix = row * N + i;
        if (x * x + z * z > R * R) { img.data[k + 3] = 0; continue; }   // 세계 밖은 투명
        const b = T.biome(x, z), h = T.height(x, z);
        const id = b in ID_OF ? ID_OF[b] : ID_OF.plain;
        hmap[ix] = h; bid[ix] = id;
        if (b === 'plain') { const zn = plainZoneAt(x, z, VILLAGE); zid[ix] = zn ? ZONE_ID[zn] : 0; }
        let c;
        if (b === 'sea') { const d = clamp(-h / 60, 0, 1); c = mixc([72, 150, 214], [14, 44, 104], d); } else c = baseColor(id, zid[ix]);
        img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
        const s = sums[b] || (sums[b] = { x: 0, z: 0, n: 0 }); s.x += x; s.z += z; s.n++;
      }
      row++;
    }
    if (row < N) { bctx.putImageData(img, 0, 0); setTimeout(step, 0); } else finish();
  }
  setTimeout(step, 50);

  // ---------- 화면 요소 ----------
  const mkCanvas = (size) => { const c = document.createElement('canvas'); c.width = c.height = Math.round(size * dpr); c.style.width = c.style.height = size + 'px'; c.style.display = 'block'; return c; };
  const small = document.createElement('div');
  small.style.cssText = 'position:fixed;left:8px;top:8px;z-index:8;border-radius:50%;overflow:hidden;border:2px solid #d9b25c;background:#0d1a2b;box-shadow:0 2px 8px rgba(0,0,0,.65);cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent';
  small.title = '누르거나 M 키: 큰 지도';
  const sc = mkCanvas(SMALL); small.appendChild(sc);
  document.body.appendChild(small);
  document.documentElement.style.setProperty('--minimap-h', (SMALL + 4) + 'px');   // 개발자 패널이 지도 아래로 내려가게

  const bigWrap = document.createElement('div');
  bigWrap.style.cssText = 'position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.58);display:none;align-items:center;justify-content:center;cursor:pointer';
  const bigSize = () => Math.floor(Math.min(innerWidth, innerHeight) * 0.9);
  const bigBox = document.createElement('div');
  bigBox.style.cssText = 'position:relative;border-radius:50%;overflow:hidden;border:3px solid #d9b25c;background:#0d1a2b;box-shadow:0 4px 24px rgba(0,0,0,.8)';
  let bc = null;
  bigWrap.appendChild(bigBox);
  document.body.appendChild(bigWrap);
  const note = document.createElement('div');   // 큰 지도 아래 안내
  note.style.cssText = 'position:absolute;left:0;right:0;bottom:10px;text-align:center;color:#f6e3a1;font:600 14px sans-serif;text-shadow:0 1px 3px #000;pointer-events:none';
  note.textContent = '지도를 누르거나 M 키 · ESC 로 닫기';
  bigWrap.appendChild(note);
  let open = false;
  function setOpen(v) {
    open = v;
    bigWrap.style.display = v ? 'flex' : 'none';
    if (v) {
      const size = bigSize();
      if (bc) bc.remove();
      bc = mkCanvas(size); bigBox.style.width = bigBox.style.height = size + 'px'; bigBox.appendChild(bc);
      draw(bc, size, true);
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
  const toPx = (x, z, size) => [(x + R) / (2 * R) * size, (z + R) / (2 * R) * size];
  const dirPx = (a, size) => [Math.sin(a) * size / 2, -Math.cos(a) * size / 2];   // 북쪽 기준 시계 방향 각도 → 지도 위 방향
  function draw(cv, size, big) {
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    if (built || row > 0) ctx.drawImage(base, 0, 0, size, size);
    if (!built) { ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.font = '600 ' + Math.round(size * 0.07) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('지도 그리는 중…', size / 2, size / 2); }
    const u = size / 190;   // 작은 지도(190) 기준 크기 배율
    const [vx, vz] = toPx(VILLAGE.x, VILLAGE.z, size);

    // 구역 경계 (점선): 마을 바깥 원 + 방사형 선 3개
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = Math.max(1, 1.2 * u); ctx.setLineDash([4 * u, 3 * u]);
    ctx.beginPath(); ctx.arc(vx, vz, PLAIN_ZONE.INNER_R / (2 * R) * size, 0, Math.PI * 2); ctx.stroke();
    for (const deg of [PLAIN_ZONE.RABBIT_HALF_DEG, 360 - PLAIN_ZONE.RABBIT_HALF_DEG, PLAIN_ZONE.SLIME_END_DEG]) {
      const a = deg * Math.PI / 180, [dx, dz] = dirPx(a, size), r0 = PLAIN_ZONE.INNER_R / R;
      ctx.beginPath(); ctx.moveTo(vx + dx * r0, vz + dz * r0); ctx.lineTo(vx + dx, vz + dz); ctx.stroke();
    }
    ctx.restore();

    // 이름표: 작은 지도는 아이콘만, 큰 지도는 아이콘 + 글자 (알아보기 쉽게)
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const putTag = (icon, name, px, pz) => {
      ctx.font = Math.round((big ? 26 : 14) * (big ? u * 0.8 : 1)) + 'px sans-serif'; ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 3; ctx.fillText(icon, px, big ? pz - 11 * u * 0.8 : pz); ctx.shadowBlur = 0;
      if (big) { ctx.font = '700 ' + Math.round(14 * u * 0.8) + 'px sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.fillStyle = '#fff'; ctx.strokeText(name, px, pz + 12 * u * 0.8); ctx.fillText(name, px, pz + 12 * u * 0.8); }
    };
    for (const [b, sm] of Object.entries(sums)) {
      if (!BIOME_NAME[b] || sm.n < 200) continue;
      const [px, pz] = toPx(sm.x / sm.n, sm.z / sm.n, size); putTag(BIOME_ICON[b], BIOME_NAME[b], px, pz);
    }
    const zl = [['rabbit', 0], ['slime', (PLAIN_ZONE.RABBIT_HALF_DEG + PLAIN_ZONE.SLIME_END_DEG) / 2], ['goblin', (PLAIN_ZONE.SLIME_END_DEG + 360 - PLAIN_ZONE.RABBIT_HALF_DEG) / 2]];
    for (const [zn, deg] of zl) { const [dx, dz] = dirPx(deg * Math.PI / 180, size); putTag(ZONE_ICON[zn], ZONE_NAME[zn], vx + dx * 0.36, vz + dz * 0.36); }
    ctx.restore();

    // 시작마을
    ctx.fillStyle = '#ffe08a'; ctx.strokeStyle = '#6a4a18'; ctx.lineWidth = 1.5 * u;
    ctx.beginPath(); ctx.arc(vx, vz, 4.5 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (big) label(ctx, '시작마을', vx, vz + 14 * u * 0.9, u);

    // 동굴 입구
    const cave = getCave && getCave();
    if (cave) {
      const [cx, cz] = toPx(cave.x, cave.z, size);
      ctx.fillStyle = '#1a1420'; ctx.strokeStyle = '#d9d0ff'; ctx.lineWidth = 1.5 * u;
      ctx.beginPath(); ctx.arc(cx, cz, 4 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (big) label(ctx, '동굴', cx, cz + 13 * u * 0.9, u);
    }

    // 보스 터 + 오크 대전사
    const arena = T.arena, bs = getBoss && getBoss();
    if (arena) {
      const [ax, az] = toPx(arena.x, arena.z, size);
      ctx.save(); ctx.strokeStyle = 'rgba(255,80,60,.9)'; ctx.fillStyle = 'rgba(60,20,10,.45)'; ctx.lineWidth = 1.5 * u; ctx.setLineDash([3 * u, 2 * u]);
      ctx.beginPath(); ctx.arc(ax, az, Math.max(5 * u, arena.r / (2 * R) * size), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
      const live = bs && bs.has && !bs.dying;
      const [bx, bz] = live ? toPx(bs.x, bs.z, size) : [ax, az];
      const pulse = live && bs.engaged ? 0.5 + 0.5 * Math.sin(performance.now() / 160) : 0;
      if (pulse) { ctx.strokeStyle = 'rgba(255,60,40,' + (0.4 + 0.5 * pulse) + ')'; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.arc(bx, bz, (8 + 5 * pulse) * u, 0, Math.PI * 2); ctx.stroke(); }
      ctx.font = Math.round((big ? 22 : 15) * u * (big ? 0.8 : 1)) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = bs && bs.has && bs.dying ? 0.45 : 1;
      ctx.fillText(bs && bs.has && bs.dying ? '✖' : '💀', bx, bz);
      ctx.globalAlpha = 1;
      if (big) label(ctx, '오크 대전사' + (live && bs.engaged ? ' (전투 중)' : ''), bx, bz + 18 * u * 0.9, u, '#ffb0a0');
    }

    // 다른 플레이어 (주황 점)
    ctx.fillStyle = '#ffa040'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1 * u;
    for (const o of (getOthers ? getOthers() : [])) { const [px, pz] = toPx(o[0], o[1], size); ctx.beginPath(); ctx.arc(px, pz, 2.6 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }

    // 나 (흰 화살표 / 동굴 안이면 입구에 파란 링)
    const me = getMe && getMe();
    if (me) {
      if (me.under && cave) {
        const [cx, cz] = toPx(cave.x, cave.z, size);
        ctx.strokeStyle = '#7fd6ff'; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.arc(cx, cz, 7.5 * u, 0, Math.PI * 2); ctx.stroke();
        if (big || size > 150) label(ctx, '동굴 안', cx, cz - 13 * u * 0.9, u, '#bfeaff');
      } else {
        const [mx, mz] = toPx(clamp(me.x, -R, R), clamp(me.z, -R, R), size);
        ctx.save(); ctx.translate(mx, mz); ctx.rotate(Math.PI - me.ry);   // 보는 방향(앞 = +z = 지도 아래쪽)으로 돌림
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5 * u;
        ctx.beginPath(); ctx.moveTo(0, -7 * u); ctx.lineTo(5 * u, 5.5 * u); ctx.lineTo(0, 3 * u); ctx.lineTo(-5 * u, 5.5 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
    // 북쪽 표시
    ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 3; ctx.font = '700 ' + Math.round(11 * u * 0.9) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.strokeText('N', size / 2, 3 * u); ctx.fillText('N', size / 2, 3 * u);
  }
  function label(ctx, text, x, y, u, color = '#fff') {
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 ' + Math.round(12 * u * 0.8) + 'px sans-serif';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.fillStyle = color; ctx.strokeText(text, x, y); ctx.fillText(text, x, y); ctx.restore();
  }

  // 0.1초마다 새로 그림 (지형은 그대로, 표시만 갱신)
  setInterval(() => {
    if (document.hidden) return;
    draw(sc, SMALL, false);
    if (open && bc) draw(bc, bigSize(), true);
  }, 100);

  return { open: () => setOpen(true), close: () => setOpen(false) };
}
