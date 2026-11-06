// 지형에 들어갈 때마다 화면 위쪽에 지형 이름이 떨어져서 튕기고, 잠시 뒤 그라데이션으로 사라지는 알림
// 사용: const zb = createZoneBanner(T.biome);  매 프레임 zb.update(x, z, 동굴안인지, 방안인지)

const ZONES = {
  village: { title: '프론트 마을', sub: '모든것이 시작되는 마을입니다.',
             grad: ['#fff3c4', '#ffc65a', '#ff9a3c'], glow: '255,170,70', edge: '#4a2208' },
  forest:  { title: '울창한 숲', sub: '빽빽한 나무와 짙은 수풀이 시야를 가립니다.',
             grad: ['#e4ffb8', '#7fe06a', '#2fa84a'], glow: '90,220,110', edge: '#0b3a1a' },
  desert:  { title: '광활한 사막', sub: '뜨거운 태양과 거센 모래바람이 몰아칩니다.',
             grad: ['#fff0b0', '#ffc94a', '#e8892a'], glow: '255,190,70', edge: '#5a2e0a' },
  plain:   { title: '평원', sub: '푸른 초원이 펼쳐집니다.',
             grad: ['#f2ffc0', '#a8ec6a', '#5cc24a'], glow: '150,240,110', edge: '#17401a' },
  volcano: { title: '불타는 화산지대', sub: '끓어오르는 용암과 뜨거운 열기가 가득합니다.',
             grad: ['#fff2a8', '#ff9a2e', '#ff3b1f'], glow: '255,90,40', edge: '#4a0e08' },
  snow:    { title: '설원', sub: '매우 춥습니다!',
             grad: ['#ffffff', '#bfe8ff', '#6fbfff'], glow: '140,210,255', edge: '#0f2f55' },
  cave:    { title: '수정동굴', sub: '반짝이는 수정으로 형성된 동굴입니다.',
             grad: ['#f3e2ff', '#c79bff', '#6fd8ff'], glow: '170,130,255', edge: '#25104a' },
};

const SETTLE_MS = 700;      // 새 지형에 이 시간 이상 머물러야 알림 (경계에서 왔다갔다 해도 깜빡이지 않게)
const HOLD_MS = 3000;       // 다 떨어진 뒤 글씨가 머무는 시간
const FADE_MS = 1400;       // 그라데이션으로 사라지는 시간
const COOLDOWN_MS = 15000;  // 같은 지형 알림이 연달아 뜨지 않게

export function createZoneBanner(biomeAt) {
  const css = document.createElement('style');
  css.textContent = `
.zb{position:fixed;left:0;right:0;top:max(92px,13vh);z-index:8;display:none;flex-direction:column;align-items:center;pointer-events:none;user-select:none;-webkit-user-select:none;font-family:'Galmuri11','Galmuri9','Malgun Gothic',sans-serif;font-weight:900;text-align:center;padding:0 12px}
.zb.on{display:flex}
.zb-t{display:flex;justify-content:center;white-space:pre;font-size:clamp(34px,7.2vw,68px);line-height:1.15;filter:drop-shadow(0 0 14px rgba(var(--g),.75)) drop-shadow(0 4px 0 rgba(0,0,0,.45))}
.zb-c{position:relative;display:inline-block;opacity:0;transform:translateY(-230px);animation:zbDrop .95s both}
.zb-c::before{content:attr(data-c);position:absolute;left:0;top:0;z-index:0;color:var(--e);-webkit-text-stroke:.2em var(--e)}
.zb-c i{position:relative;z-index:1;font-style:normal;color:transparent;background:linear-gradient(180deg,var(--c0) 0%,var(--c1) 52%,var(--c2) 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-stroke:.03em rgba(255,255,255,.35)}
.zb-s{margin-top:8px;font-size:clamp(14px,2.7vw,25px);line-height:1.3;color:#fff;opacity:0;transform:translateY(-120px);animation:zbDropS .8s both;text-shadow:-2px 0 var(--e),2px 0 var(--e),0 -2px var(--e),0 2px var(--e),-1px -1px var(--e),1px 1px var(--e),-1px 1px var(--e),1px -1px var(--e),0 0 12px rgba(var(--g),.9)}
@keyframes zbDrop{
  0%{opacity:0;transform:translateY(-230px) scale(1,1);animation-timing-function:cubic-bezier(.55,0,1,.6)}
  8%{opacity:1}
  40%{opacity:1;transform:translateY(0) scale(1.14,.8);animation-timing-function:cubic-bezier(.2,.7,.4,1)}
  56%{transform:translateY(-34px) scale(.96,1.06);animation-timing-function:cubic-bezier(.55,0,1,.6)}
  70%{transform:translateY(0) scale(1.07,.92);animation-timing-function:cubic-bezier(.2,.7,.4,1)}
  82%{transform:translateY(-10px) scale(1,1.02);animation-timing-function:cubic-bezier(.55,0,1,.6)}
  92%{transform:translateY(0) scale(1.02,.98)}
  100%{opacity:1;transform:translateY(0) scale(1,1)}
}
@keyframes zbDropS{
  0%{opacity:0;transform:translateY(-120px);animation-timing-function:cubic-bezier(.55,0,1,.6)}
  10%{opacity:1}
  50%{opacity:1;transform:translateY(0);animation-timing-function:cubic-bezier(.2,.7,.4,1)}
  72%{transform:translateY(-14px);animation-timing-function:cubic-bezier(.55,0,1,.6)}
  100%{opacity:1;transform:translateY(0)}
}
.zb.out{-webkit-mask-image:linear-gradient(90deg,transparent 0%,transparent 35%,#000 65%,#000 100%);mask-image:linear-gradient(90deg,transparent 0%,transparent 35%,#000 65%,#000 100%);-webkit-mask-size:300% 100%;mask-size:300% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;animation:zbOut ${FADE_MS}ms ease-in forwards}
@keyframes zbOut{
  0%{-webkit-mask-position:100% 0;mask-position:100% 0;opacity:1;transform:translateY(0)}
  100%{-webkit-mask-position:0% 0;mask-position:0% 0;opacity:0;transform:translateY(-14px)}
}`;
  document.head.appendChild(css);

  const el = document.createElement('div');
  el.className = 'zb';
  document.body.appendChild(el);

  let shown = null;                 // 지금 화면에 띄운(또는 마지막으로 띄운) 지형
  let cand = null, candT = 0;       // 후보 지형과 머문 시간
  let tHold = 0, tHide = 0;
  const lastShow = {};

  function hide() { clearTimeout(tHold); clearTimeout(tHide); el.className = 'zb'; el.textContent = ''; }

  function show(id) {
    const z = ZONES[id];
    if (!z) return;
    hide();
    void el.offsetWidth;            // 애니메이션 다시 시작
    el.style.setProperty('--c0', z.grad[0]); el.style.setProperty('--c1', z.grad[1]); el.style.setProperty('--c2', z.grad[2]);
    el.style.setProperty('--g', z.glow); el.style.setProperty('--e', z.edge);

    const t = document.createElement('div');
    t.className = 'zb-t';
    [...z.title].forEach((ch, i) => {
      const c = document.createElement('span');
      c.className = 'zb-c'; c.dataset.c = ch; c.style.animationDelay = (i * 0.07) + 's';
      const f = document.createElement('i'); f.textContent = ch;
      c.appendChild(f);
      t.appendChild(c);
    });
    const s = document.createElement('div');
    s.className = 'zb-s'; s.textContent = z.sub;
    s.style.animationDelay = (0.18 + z.title.length * 0.07 * 0.6) + 's';
    el.appendChild(t); el.appendChild(s);
    el.classList.add('on');

    const land = 950 + (z.title.length - 1) * 70;          // 마지막 글자까지 다 떨어지는 시간
    tHold = setTimeout(() => { el.classList.add('out'); }, land + HOLD_MS);
    tHide = setTimeout(hide, land + HOLD_MS + FADE_MS + 50);
    lastShow[id] = performance.now();
  }

  let last = performance.now();
  function update(x, zPos, inCave, skip) {
    const now = performance.now();
    const dt = Math.min(250, now - last); last = now;
    if (skip) return;               // 방 안에서는 판정하지 않음
    const id = inCave ? 'cave' : biomeAt(x, zPos);
    if (id === shown || !ZONES[id]) { cand = null; candT = 0; return; }   // 같은 지형 / 알림이 없는 지형(바다 등)
    if (id !== cand) { cand = id; candT = 0; }
    candT += dt;
    if (candT < SETTLE_MS) return;
    cand = null; candT = 0;
    shown = id;
    if (lastShow[id] && now - lastShow[id] < COOLDOWN_MS) return;
    show(id);
  }
  return { update };
}
