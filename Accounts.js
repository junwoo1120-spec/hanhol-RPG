'use strict';
/*
 * accounts.js - 회원가입 / 로그인 / 진행 상황 저장
 *
 * - 계정과 진행 상황(인벤토리, 스킬, 장비, 마지막 위치)을 DATA_DIR/accounts.json 에 저장해요.
 * - 비밀번호는 scrypt 로 암호화해서 저장해요 (원문은 어디에도 남지 않아요).
 * - 로그인하면 기기용 토큰을 받아요. 브라우저(localStorage)에 토큰이 있으면 같은 기기에서는 자동 로그인돼요.
 *
 * ★ 업데이트(재배포)해도 계정이 안 지워지게 하려면:
 *   호스팅의 "영구 디스크(Render: Disk / Railway: Volume)"를 만들어 연결하고,
 *   환경변수 DATA_DIR 을 그 디스크 경로로 지정하세요. (예: /var/data)
 *   영구 디스크가 없으면 재배포 때 서버 파일이 초기화돼서 계정도 같이 사라져요.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'accounts.json');
const BAK = FILE + '.bak';
const TOKEN_DAYS = 90, MAX_TOKENS = 8;
const norm = (s) => String(s == null ? '' : s).normalize('NFC').trim();
const keyOf = (name) => norm(name).toLowerCase();

let db = { version: 1, accounts: {} };
const tokenIndex = new Map();   // 토큰 해시 -> 계정 key

function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let loaded = null;
  for (const f of [FILE, BAK]) {
    if (!fs.existsSync(f)) continue;
    try { loaded = readJson(f); if (loaded && loaded.accounts) { if (f === BAK) console.warn('[계정] 본 파일이 손상돼 백업에서 복구했어요'); break; } }
    catch (e) {
      const side = f + '.corrupt-' + Date.now();
      try { fs.copyFileSync(f, side); } catch (_) { /* 무시 */ }
      console.error('[계정] ' + path.basename(f) + ' 을(를) 읽지 못했어요 (사본 보관: ' + side + ')');
      loaded = null;
    }
  }
  if (loaded && loaded.accounts) db = loaded;
  for (const [k, a] of Object.entries(db.accounts)) for (const t of a.tokens || []) tokenIndex.set(t.h, k);
  console.log('[계정] ' + Object.keys(db.accounts).length + '개 불러옴 (저장 위치: ' + DATA_DIR + ')');
  if (!process.env.DATA_DIR) console.warn('[계정] ⚠ DATA_DIR 이 지정되지 않았어요. 영구 디스크가 아니면 재배포 때 계정이 사라져요.');
}
load();

let dirty = false, timer = null;
function flushNow() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!dirty) return;
  dirty = false;
  try {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    if (fs.existsSync(FILE)) fs.copyFileSync(FILE, BAK);
    fs.renameSync(tmp, FILE);
  } catch (e) { dirty = true; console.error('[계정] 저장 실패:', e); }
}
function markDirty() { dirty = true; backupDirty = true; if (!timer) timer = setTimeout(flushNow, 2000); }

// ---------- GitHub 비공개 저장소 백업 ----------
// 환경변수로 켜요 (없으면 이 기능은 꺼져 있고, 위의 로컬 저장만 써요):
//   GITHUB_BACKUP_TOKEN  = 그 저장소 하나에만 쓰기 권한(Contents: Read and write)을 준 토큰
//   GITHUB_BACKUP_REPO   = "내아이디/저장소이름"  (반드시 비공개 저장소, 게임 코드 저장소와 다른 것)
//   GITHUB_BACKUP_PATH   = 저장소 안 파일 경로 (기본 accounts.json)
//   GITHUB_BACKUP_SECONDS = 백업 간격 초 (기본 300, 최소 60)
// 서버가 켜질 때 저장소에만 있는 계정을 가져오고(합치기), 바뀐 내용이 있으면 몇 분마다/꺼질 때 커밋해요.
const GH_TOKEN = process.env.GITHUB_BACKUP_TOKEN, GH_REPO = process.env.GITHUB_BACKUP_REPO;
const GH_PATH = (process.env.GITHUB_BACKUP_PATH || 'accounts.json').split('/').map(encodeURIComponent).join('/');
const GH_ON = !!(GH_TOKEN && GH_REPO);
const BACKUP_MS = Math.max(60, Number(process.env.GITHUB_BACKUP_SECONDS) || 300) * 1000;
let GH_OK = false, ghSha = null, backupDirty = false, pushing = null;

const gh = (url, opt = {}) => fetch('https://api.github.com' + url, {
  ...opt,
  headers: { Authorization: 'Bearer ' + GH_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'hanhol-rpg-backup', ...(opt.headers || {}) },
  signal: AbortSignal.timeout(15000),
});

async function ghInit() {
  const r = await gh('/repos/' + GH_REPO);
  if (!r.ok) throw new Error('저장소 확인 실패 (HTTP ' + r.status + ') - 토큰/저장소 이름을 확인하세요');
  if (!(await r.json()).private) { console.error('[백업] ⚠ ' + GH_REPO + ' 는 공개(public) 저장소예요. 비밀번호 해시가 노출될 수 있어서 백업을 끕니다. 비공개로 바꿔주세요.'); return false; }
  const f = await gh('/repos/' + GH_REPO + '/contents/' + GH_PATH);
  if (f.status === 404) { ghSha = null; }
  else if (!f.ok) throw new Error('백업 파일 읽기 실패 (HTTP ' + f.status + ')');
  else {
    const j = await f.json();
    ghSha = j.sha;
    let text;
    if (j.content) text = Buffer.from(j.content, 'base64').toString('utf8');
    else text = await (await gh('/repos/' + GH_REPO + '/contents/' + GH_PATH, { headers: { Accept: 'application/vnd.github.raw+json' } })).text();
    const remote = JSON.parse(text);
    let added = 0;
    for (const [k, a] of Object.entries((remote && remote.accounts) || {})) {   // 이 서버에 없는 계정만 가져와요 (이미 있는 건 이 서버 것이 우선)
      if (db.accounts[k]) continue;
      db.accounts[k] = a; added++;
      for (const t of a.tokens || []) tokenIndex.set(t.h, k);
    }
    if (added) { dirty = true; flushNow(); console.log('[백업] GitHub에서 계정 ' + added + '개를 복구했어요'); }
  }
  backupDirty = true;   // 시작할 때 한 번은 현재 상태를 맞춰 올려요
  return true;
}

async function pushBackup() {
  if (!GH_OK || !backupDirty || !Object.keys(db.accounts).length) return;
  if (pushing) return pushing;
  pushing = (async () => {
    backupDirty = false;
    const n = Object.keys(db.accounts).length;
    const content = Buffer.from(JSON.stringify(db)).toString('base64');
    const put = () => gh('/repos/' + GH_REPO + '/contents/' + GH_PATH, {
      method: 'PUT',
      body: JSON.stringify({ message: 'backup ' + new Date().toISOString() + ' (' + n + '명)', content, ...(ghSha ? { sha: ghSha } : {}) }),
    });
    try {
      let r = await put();
      if (r.status === 409 || r.status === 422) {   // 파일 버전이 어긋남 → 최신 버전 번호를 다시 받아 한 번 더
        const f = await gh('/repos/' + GH_REPO + '/contents/' + GH_PATH);
        ghSha = f.ok ? (await f.json()).sha : null;
        r = await put();
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      ghSha = (await r.json()).content.sha;
    } catch (e) { backupDirty = true; console.error('[백업] GitHub 저장 실패(다음에 다시 시도):', e.message); }
    finally { pushing = null; }
  })();
  return pushing;
}

async function startBackup() {
  try { GH_OK = await ghInit(); }
  catch (e) { console.error('[백업] 시작 실패(1분 뒤 다시 시도):', e.message); setTimeout(startBackup, 60000).unref(); }
  if (GH_OK) { console.log('[백업] GitHub 백업 켜짐: ' + GH_REPO); setInterval(pushBackup, BACKUP_MS).unref(); pushBackup(); }
}
const ready = GH_ON ? startBackup() : Promise.resolve();   // 서버는 이게 끝난 뒤 열어요 (복구가 먼저)

// ---------- 시도 횟수 제한 ----------
const hits = new Map();
function limited(bucket, id, max, windowMs) {
  const k = bucket + '|' + id, now = Date.now();
  let h = hits.get(k);
  if (!h || now - h.t > windowMs) h = { t: now, n: 0 };
  h.n++; hits.set(k, h);
  if (hits.size > 5000) for (const [kk, v] of hits) if (now - v.t > windowMs) hits.delete(kk);
  return h.n > max;
}

// ---------- 비밀번호 ----------
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 32, (e, k) => (e ? rej(e) : res(k))));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function issueToken(k) {
  const a = db.accounts[k], raw = crypto.randomBytes(32).toString('base64url');
  a.tokens = a.tokens || [];
  a.tokens.push({ h: sha(raw), at: Date.now(), last: Date.now() });
  while (a.tokens.length > MAX_TOKENS) tokenIndex.delete(a.tokens.shift().h);
  tokenIndex.set(sha(raw), k);
  markDirty();
  return raw;
}

const NAME_RE = /^[0-9A-Za-z_\u3131-\u318E\uAC00-\uD7A3]{2,12}$/;
const fail = (error, message) => ({ ok: false, error, message });

async function register(nameIn, pw, ip) {
  if (limited('reg', ip, 5, 3600e3)) return fail('rate', '가입 시도가 너무 많아요. 잠시 뒤에 다시 해주세요.');
  const name = norm(nameIn);
  if (!NAME_RE.test(name)) return fail('name', '닉네임은 한글·영문·숫자·_ 로 2~12자예요.');
  if (typeof pw !== 'string' || pw.length < 6 || pw.length > 64) return fail('pw', '비밀번호는 6자 이상이에요.');
  const k = keyOf(name);
  if (db.accounts[k]) return fail('taken', '이미 사용 중인 닉네임이에요.');
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt);
  if (db.accounts[k]) return fail('taken', '이미 사용 중인 닉네임이에요.');   // 해시 계산 중 같은 이름이 가입했을 때 대비
  db.accounts[k] = { name, salt: salt.toString('hex'), hash: hash.toString('hex'), createdAt: Date.now(), tokens: [], profile: null };
  const token = issueToken(k);
  flushNow();   // 가입은 바로 저장
  if (GH_OK) setTimeout(pushBackup, 20000).unref();   // 새 계정은 GitHub에도 빨리 올려요
  return { ok: true, nick: name, token };
}

async function login(nameIn, pw, ip) {
  const name = norm(nameIn), k = keyOf(name);
  if (limited('login-ip', ip, 15, 600e3) || limited('login-acct', k, 30, 600e3)) return fail('rate', '로그인 시도가 너무 많아요. 잠시 뒤에 다시 해주세요.');
  const a = db.accounts[k];
  if (typeof pw !== 'string' || pw.length > 64) return fail('bad', '닉네임 또는 비밀번호가 틀렸어요.');
  const salt = a ? Buffer.from(a.salt, 'hex') : crypto.randomBytes(16);   // 없는 계정도 같은 시간이 걸리게
  const hash = await scrypt(pw, salt);
  if (!a || !crypto.timingSafeEqual(hash, Buffer.from(a.hash, 'hex'))) return fail('bad', '닉네임 또는 비밀번호가 틀렸어요.');
  const token = issueToken(k);
  flushNow();
  return { ok: true, nick: a.name, token };
}

// 토큰 확인: 맞으면 { key, name }, 아니면 null
function verify(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const h = sha(token), k = tokenIndex.get(h), a = k && db.accounts[k];
  const t = a && (a.tokens || []).find((x) => x.h === h);
  if (!t) return null;
  if (Date.now() - t.last > TOKEN_DAYS * 864e5) { a.tokens.splice(a.tokens.indexOf(t), 1); tokenIndex.delete(h); markDirty(); return null; }
  if (Date.now() - t.last > 864e5) { t.last = Date.now(); markDirty(); }   // 쓸 때마다(하루에 한 번만 기록) 기간 연장
  return { key: k, name: a.name };
}
function logout(token) {
  const v = verify(token);
  if (!v) return;
  const h = sha(token), a = db.accounts[v.key];
  a.tokens = a.tokens.filter((x) => x.h !== h); tokenIndex.delete(h); markDirty();
}

function getProfile(k) { const a = db.accounts[k]; return a && a.profile ? a.profile : null; }
function setProfile(k, profile) {
  const a = db.accounts[k];
  if (!a) return;
  if (JSON.stringify(a.profile) === JSON.stringify(profile)) return;
  a.profile = profile; markDirty();
}

const backupNow = () => pushBackup();
module.exports = { register, login, verify, logout, getProfile, setProfile, flushNow, backupNow, ready, DATA_DIR };
