// auth.js - 로그인 / 회원가입 화면 (같은 기기에서는 자동 로그인)
// 토큰은 이 브라우저(localStorage)에만 저장돼요. 비밀번호는 저장하지 않아요.
const KEY = 'hanhol.auth.v1';

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } }
function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* 저장 불가(시크릿 모드 등)여도 게임은 가능 */ } }
function wipe() { try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ } }

async function api(path, body) {
  try {
    const r = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) { return { ok: false, error: 'net', message: '서버에 연결하지 못했어요.' }; }
}

export function getToken() { const a = load(); return a && a.token ? a.token : null; }
export function clearToken() { wipe(); }

const css = document.createElement('style');
css.textContent = `
#authBox{display:flex;flex-direction:column;align-items:center;gap:10px}
#authBox .a-tabs{display:flex;gap:8px}
#authBox .a-tab{cursor:pointer;color:#9b8a5a;font:600 16px sans-serif;padding:6px 16px;border-bottom:2px solid transparent}
#authBox .a-tab.on{color:#f6e3a1;border-bottom-color:#d9b25c}
#authBox .a-hello{color:#f6e3a1;font:600 20px sans-serif;margin-bottom:4px}
#authBox .a-sub{color:#9b92b8;font:13px sans-serif;cursor:pointer;text-decoration:underline}
`;
document.head.appendChild(css);

// root = #login 요소, msg = #msg 요소, onLogin(nick, token) = 로그인이 끝났을 때 호출
export function createAuth({ root, msg, onLogin }) {
  const box = document.createElement('div');
  box.id = 'authBox';
  root.insertBefore(box, msg);
  let mode = 'login';

  const setMsg = (t) => { msg.textContent = t || ''; };
  const done = (r) => { box.style.display = 'none'; setMsg(''); save({ nick: r.nick, token: r.token }); onLogin(r.nick, r.token); };

  function renderForm(message) {
    box.style.display = 'flex';
    box.innerHTML = '';
    const tabs = document.createElement('div');
    tabs.className = 'a-tabs';
    for (const [m, label] of [['login', '로그인'], ['register', '회원가입']]) {
      const t = document.createElement('div');
      t.className = 'a-tab' + (mode === m ? ' on' : '');
      t.textContent = label;
      t.onclick = () => { mode = m; renderForm(); };
      tabs.appendChild(t);
    }
    const nick = document.createElement('input');
    nick.maxLength = 12; nick.placeholder = '닉네임'; nick.autocomplete = 'username';
    const pw = document.createElement('input');
    pw.type = 'password'; pw.placeholder = mode === 'register' ? '비밀번호 (6자 이상)' : '비밀번호'; pw.maxLength = 64;
    pw.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    const pw2 = document.createElement('input');
    pw2.type = 'password'; pw2.placeholder = '비밀번호 확인'; pw2.maxLength = 64; pw2.autocomplete = 'new-password';
    const btn = document.createElement('button');
    btn.className = 'rpg-btn';
    btn.textContent = mode === 'register' ? '가입하고 입장' : '로그인';

    const submit = async () => {
      const n = nick.value.trim();
      if (!n || !pw.value) { setMsg('닉네임과 비밀번호를 입력해주세요.'); return; }
      if (mode === 'register' && pw.value !== pw2.value) { setMsg('비밀번호 확인이 달라요.'); return; }
      btn.disabled = true; setMsg('확인 중...');
      const r = await api(mode, { nick: n, password: pw.value });
      btn.disabled = false;
      if (r && r.ok) done(r); else setMsg((r && r.message) || '실패했어요. 다시 해주세요.');
    };
    btn.onclick = submit;
    for (const el of [nick, pw, pw2]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    box.append(tabs, nick, pw);
    if (mode === 'register') box.append(pw2);
    box.append(btn);
    setMsg(message);
  }

  function renderWelcome(a) {
    box.style.display = 'flex';
    box.innerHTML = '';
    const hello = document.createElement('div');
    hello.className = 'a-hello';
    hello.textContent = a.nick + '님, 어서오세요';
    const go = document.createElement('button');
    go.className = 'rpg-btn';
    go.textContent = '이어서 입장';
    go.onclick = () => { box.style.display = 'none'; setMsg(''); onLogin(a.nick, a.token); };
    const other = document.createElement('div');
    other.className = 'a-sub';
    other.textContent = '다른 계정으로 로그인';
    other.onclick = () => { api('logout', { token: a.token }); wipe(); mode = 'login'; renderForm(); };
    box.append(hello, go, other);
    setMsg('');
  }

  // 화면을 처음 보여줄 때: 저장된 토큰이 있으면 서버에 확인하고 자동 로그인 화면으로
  async function start(message) {
    const a = load();
    if (a && a.token) {
      setMsg('확인 중...');
      const r = await api('resume', { token: a.token });
      if (r && r.ok) { renderWelcome({ nick: r.nick, token: a.token }); if (message) setMsg(message); return; }
      if (r && r.error === 'expired') wipe();   // 서버가 못 알아보는 토큰만 지움 (네트워크 오류면 남겨둠)
      else if (r && r.error === 'net') { renderForm('서버에 연결하지 못했어요. 잠시 뒤 다시 시도해주세요.'); return; }
    }
    renderForm(message);
  }

  return { show: start };
}
