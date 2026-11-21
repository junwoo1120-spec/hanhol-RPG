// 상태이상 아이콘 (화면 왼쪽 위, 미니맵 오른쪽). 지금은 출혈 하나 — 나중에 독·화상 같은 걸 DEFS 에 한 줄 더하면 됨
// 서버가 { id, ms } 를 보내면 그 시간만큼 아이콘이 떠 있고, 끝나기 BLINK_LAST 초 전부터 반투명하게 깜박이다가 사라져요.
// ms = 0 이면 바로 치움 (죽었을 때 등). 이미 걸려 있는데 다시 걸리면 시간만 새로 시작해요.
import { MOSQ } from './mosquito.mjs';

const DEFS = {
  bleed: { img: '/ui/status_bleed.png', name: '출혈', msg: '출혈 상태가 되었습니다!' }
};

export function createStatusUI({ toast } = {}) {
  const css = document.createElement('style');
  css.textContent = `
.stfx{position:fixed;left:calc(var(--minimap-h, 120px) + 18px);top:10px;z-index:9;display:flex;gap:8px;pointer-events:none;user-select:none;-webkit-user-select:none}
.stfx-i{width:52px;height:52px;opacity:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.7));animation:stfxPop .28s ease-out}
.stfx-i img{display:block;width:100%;height:100%}
.stfx-i.blink{animation:stfxBlink .55s ease-in-out infinite}
.stfx-i.out{animation:none;opacity:0;transition:opacity .25s}
@keyframes stfxPop{0%{transform:scale(.4);opacity:0}70%{transform:scale(1.12);opacity:1}100%{transform:scale(1)}}
@keyframes stfxBlink{0%,100%{opacity:1}50%{opacity:.3}}
`;
  document.head.appendChild(css);
  const root = document.createElement('div');
  root.className = 'stfx';
  document.body.appendChild(root);

  const act = new Map();   // id -> { el, end }
  let timer = 0;

  function tick() {
    const now = performance.now();
    for (const [id, a] of act) {
      const left = (a.end - now) / 1000;
      if (left <= 0) { remove(id); continue; }
      if (left <= MOSQ.BLINK_LAST) a.el.classList.add('blink');
    }
    if (!act.size) { clearInterval(timer); timer = 0; }
  }
  function remove(id) {
    const a = act.get(id);
    if (!a) return;
    act.delete(id);
    a.el.classList.remove('blink');
    a.el.classList.add('out');
    setTimeout(() => a.el.remove(), 280);
  }
  function set(id, ms) {
    const d = DEFS[id];
    if (!d) return;
    if (!(ms > 0)) { remove(id); return; }
    const end = performance.now() + ms;
    let a = act.get(id);
    if (a) {   // 이미 걸려 있음: 시간만 새로
      a.end = end;
      a.el.classList.remove('blink');
    } else {
      const el = document.createElement('div');
      el.className = 'stfx-i';
      el.title = d.name;
      const img = document.createElement('img');
      img.src = d.img; img.alt = d.name; img.draggable = false;
      el.appendChild(img);
      root.appendChild(el);
      act.set(id, { el, end });
      if (toast && d.msg) toast(d.msg);   // 상태 메시지
    }
    if (!timer) timer = setInterval(tick, 100);
  }
  return { set };
}
