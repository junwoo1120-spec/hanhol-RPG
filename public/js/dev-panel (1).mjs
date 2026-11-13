// 개발자 도구 패널 (화면 왼쪽 위)
// 서버(server.js 의 DEV_NICK)가 "이 사람은 개발자"라고 알려줄 때만 나타나요. 다른 사람 화면에는 아무것도 안 떠요.
//  - 데미지 배율: 내 평타·스킬 데미지에 곱해짐 (몬스터·보스 모두)
//  - 체력 배율: 내 최대 체력 = 100 × 배율 (바꾸면 체력도 가득 채워짐)
//  - 스킬북·갑옷·바지·마정석 받기: 인벤토리로 바로 받음 (드랍 확률을 기다리지 않고 시험용)
// PC 에서는 ESC 로 마우스 고정을 푼 다음 칸을 클릭해서 쓰세요.
const KEY = 'hanhol-dev-mult';

export function createDevPanel({ socket }) {
  let el = null;

  const load = () => { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && Number.isFinite(s.dmg) && Number.isFinite(s.hp)) return s; } catch (e) { /* 무시 */ } return null; };
  const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* 무시 */ } };

  function build(cur) {
    el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:8px;top:calc(var(--minimap-h, 0px) + 14px);z-index:30;font:600 12px sans-serif;color:#f6e3a1;background:rgba(20,14,38,.88);border:1px solid rgba(217,178,92,.85);border-radius:10px;padding:6px 8px;min-width:150px;box-shadow:0 2px 8px rgba(0,0,0,.6);user-select:none';
    el.innerHTML =
      '<div data-head style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;gap:10px"><span>🛠 개발자 도구</span><span data-tg>▾</span></div>' +
      '<div data-body style="margin-top:6px">' +
        '<label style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin:3px 0">데미지 ×<input data-d type="number" step="any" min="0.1" max="1000" style="width:70px"></label>' +
        '<label style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin:3px 0">체력 ×<input data-h type="number" step="any" min="0.1" max="1000" style="width:70px"></label>' +
        '<div style="display:flex;gap:6px;margin-top:5px"><button data-ok style="flex:1">적용</button><button data-rs style="flex:1">1배</button></div>' +
        '<button data-bk style="width:100%;margin-top:5px">📕 스킬북(내려찍기) 받기</button>' +
        '<div style="display:flex;gap:4px;margin-top:4px"><button data-g1 style="flex:1">🦺 갑옷</button><button data-g2 style="flex:1">👖 바지</button><button data-g3 style="flex:1">💠 마정석</button></div>' +
        '<div data-info style="margin-top:5px;font-weight:400;color:#cdbf95;line-height:1.35"></div>' +
      '</div>';
    document.body.appendChild(el);
    // 입력 중에 키가 게임(이동·스킬)으로 새지 않게
    for (const ev of ['keydown', 'keyup', 'keypress']) el.addEventListener(ev, (e) => e.stopPropagation());
    for (const ev of ['mousedown', 'pointerdown', 'touchstart', 'click', 'wheel']) el.addEventListener(ev, (e) => e.stopPropagation());
    const q = (s) => el.querySelector(s);
    q('[data-head]').addEventListener('click', () => { const b = q('[data-body]'); const open = b.style.display !== 'none'; b.style.display = open ? 'none' : ''; q('[data-tg]').textContent = open ? '▸' : '▾'; });
    const apply = (d, h) => {
      d = Number(d); h = Number(h);
      if (!Number.isFinite(d) || !Number.isFinite(h)) return;
      d = Math.min(1000, Math.max(0.1, d)); h = Math.min(1000, Math.max(0.1, h));
      save({ dmg: d, hp: h });
      socket.emit('dev:set', { dmg: d, hp: h });
    };
    q('[data-ok]').addEventListener('click', () => apply(q('[data-d]').value, q('[data-h]').value));
    q('[data-rs]').addEventListener('click', () => apply(1, 1));
    q('[data-bk]').addEventListener('click', () => socket.emit('dev:book'));
    q('[data-g1]').addEventListener('click', () => socket.emit('dev:give', { id: 'goblin_armor' }));   // 장비·재료도 바로 받아서 시험
    q('[data-g2]').addEventListener('click', () => socket.emit('dev:give', { id: 'goblin_pants' }));
    q('[data-g3]').addEventListener('click', () => socket.emit('dev:give', { id: 'mana_low' }));   // 1% 드랍을 기다리지 않고 스킬북을 바로 받아 시험
    for (const s of ['[data-d]', '[data-h]']) q(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(q('[data-d]').value, q('[data-h]').value); });
    show(cur);
  }

  function show(cur) {
    const q = (s) => el.querySelector(s);
    if (document.activeElement !== q('[data-d]')) q('[data-d]').value = String(cur.dmg);
    if (document.activeElement !== q('[data-h]')) q('[data-h]').value = String(cur.hp);
    q('[data-info]').textContent = '평타 데미지 ' + +(2 * cur.dmg).toFixed(2) + ' · 최대 체력 ' + Math.max(1, Math.round(100 * cur.hp));
  }

  // 서버가 "개발자 맞음" + 현재 배율을 알려줌 → 패널을 만들고, 저장해 둔 배율이 있으면 다시 적용
  socket.on('dev:on', (cur) => {
    if (!cur || !Number.isFinite(cur.dmg) || !Number.isFinite(cur.hp)) return;
    const first = !el;
    if (first) build(cur); else show(cur);
    if (first) {
      const s = load();
      if (s && (s.dmg !== cur.dmg || s.hp !== cur.hp)) socket.emit('dev:set', s);   // 접속할 때마다 마지막 배율 복원
    }
  });
  socket.emit('dev:hello');   // 서버에 "나 개발자야?" 물어봄 (아니면 아무 응답 없음)
  return {};
}
