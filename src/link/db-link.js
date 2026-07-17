'use strict';

/**
 * 外部DB連携 STEP2a: Supabase 接続基盤 + 管理者ログイン（main プロセス専用モジュール）。
 *
 * ★アーキテクチャ（plan §2 / plan review 裏取り済）:
 *   - **Supabase 通信は main プロセスに集約**する。renderer の CSP は `connect-src 'self' file:` で
 *     外部 fetch を遮断しており、renderer から呼ぶ設計は CSP 改変を要する。main(Node) で通信し
 *     preload の contextBridge + IPC で公開すれば **CSP・webPreferences は無改変**で済む
 *     （remote-control(src/remote/server.js) と同じ「main 側ネットワーク機能」の型）。
 *   - **未設定 / 未ログインなら inert**: URL・キーが空の間はクライアントを作らず、外部への接続を
 *     一切行わない（既定 OFF・後方互換 = CLAUDE.md「完全ローカル動作」例外②の範囲内でのみ通信）。
 *
 * ★認証（brief 必須確認1・3 / 前原確定6）:
 *   - 管理者の email+PW ログイン（`signInWithPassword`）。得たユーザー JWT(role=authenticated) が
 *     連携先の `is_admin()` ガードを通る。**新トークン方式は発明しない**。
 *   - **anon キーはクライアント初期化にのみ使い、データ取得を anon のまま行わない**
 *     （ログイン済みセッションが無ければ listTodayTournaments 等は実行前に拒否する）。
 *
 * ★資格情報の扱い（brief 必須確認2 / plan §2-C）:
 *   - **PW は保存しない・ログに書かない**。IPC で受けて signInWithPassword に渡すだけ。
 *   - セッション（トークン）は electron-store 別ファイル `db-link-session.json` に永続化
 *     （config.json を汚さない = tournament-images.json と同じ分離の流儀）。
 *     店舗共有 PC の userData に平文保存となる点は plan §2-C に明示済み（前原確定4「保存する」・
 *     緩和 = ログアウトで明示失効 + PW 変更時の失効を 6-B で実確認）。
 *   - ログ(rollingLog/electron-log)へはイベント名と結果種別のみ。**token / password / セッション内容を
 *     ログ出力しない**（tests/db-link.test.js が静的検査）。
 *
 * ★自動トークン更新（公式ドキュメント確認済・2026-07-17）:
 *   非ブラウザ環境では自動更新が「継続的に」バックグラウンド動作する（公式: "On non-browser platforms
 *   the refresh process works continuously in the background"）。常時起動の店舗 PC ではこれが望みの
 *   挙動そのもの。念のため作成直後に `startAutoRefresh()` を明示し、アプリ終了時に `stop()` で
 *   `stopAutoRefresh()` を呼ぶ（公式の非ブラウザ環境ガイダンスどおり）。
 */

const Store = require('electron-store');
const { currentBusinessDate } = require('./business-date');

// セッション専用ストア（userData/db-link-session.json）。設定(config.json)とは分離。
const sessionStore = new Store({ name: 'db-link-session', defaults: {} });

let _mainStore = null;      // main の設定ストア（init で受け取る・dbLink キーのみ読む）
let _log = null;            // rollingLog 相当（イベント名のみ渡す・秘匿値は渡さない）
let _client = null;         // SupabaseClient（設定済み時のみ生成）
let _clientKey = '';        // client を作った時の url+anonKey（変更検知して作り直す）
let _adminCache = null;     // { userId, isAdmin } ログイン/復元時に profiles を読んだ結果

function init(store, log) {
  _mainStore = store;
  _log = typeof log === 'function' ? log : () => {};
}

function _config() {
  const cfg = (_mainStore && _mainStore.get('dbLink')) || {};
  return {
    url: typeof cfg.url === 'string' ? cfg.url.trim() : '',
    anonKey: typeof cfg.anonKey === 'string' ? cfg.anonKey.trim() : '',
    links: cfg.links && typeof cfg.links === 'object' ? cfg.links : {}
  };
}

function _configured() {
  const { url, anonKey } = _config();
  return url.startsWith('https://') && anonKey.length > 0;
}

/**
 * supabase-js の auth.storage アダプタ（electron-store 直結）。
 * GoTrue は getItem/setItem/removeItem を await するため同期返しでよい。
 */
const _storageAdapter = {
  getItem: (key) => {
    const v = sessionStore.get(key);
    return typeof v === 'string' ? v : null;
  },
  setItem: (key, value) => { sessionStore.set(key, value); },
  removeItem: (key) => { sessionStore.delete(key); }
};

/** 設定済みならクライアントを返す（未設定は null）。設定変更時は作り直す。 */
function _getClient() {
  if (!_configured()) return null;
  const { url, anonKey } = _config();
  const key = `${url}\n${anonKey}`;
  if (_client && _clientKey === key) return _client;
  // 設定が変わった場合は旧クライアントの自動更新を止めてから作り直す
  if (_client) {
    try { _client.auth.stopAutoRefresh(); } catch (_) { /* ignore */ }
    _client = null;
    _adminCache = null;
  }
  // 遅延 require: 未設定運用（=大多数の配布ユーザー）では supabase-js をロードすらしない
  const { createClient } = require('@supabase/supabase-js');
  _client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: _storageAdapter
    }
  });
  // 非ブラウザ環境の明示開始（公式ガイダンス・ヘッダコメント参照）
  try { _client.auth.startAutoRefresh(); } catch (_) { /* ignore */ }
  _clientKey = key;
  return _client;
}

/** ログイン中セッション（無ければ null）。 */
async function _getSession() {
  const client = _getClient();
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    return data && data.session ? data.session : null;
  } catch (_) {
    return null;
  }
}

/** profiles.is_admin を読んで管理者判定（自分の行のみ・失敗は null=不明）。 */
async function _fetchIsAdmin(client, userId) {
  try {
    const { data, error } = await client
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return null;
    return data.is_admin === true;
  } catch (_) {
    return null;
  }
}

async function _isAdmin(client, userId) {
  if (_adminCache && _adminCache.userId === userId) return _adminCache.isAdmin;
  const isAdmin = await _fetchIsAdmin(client, userId);
  if (isAdmin !== null) _adminCache = { userId, isAdmin };
  return isAdmin;
}

/**
 * 現在状態（設定/ログイン/管理者/大会別リンクフラグ）。renderer の表示専用。
 * 返すのは email と真偽値のみ（トークン等の秘匿値は返さない）。
 */
async function getStatus() {
  const configured = _configured();
  const { links } = _config();
  if (!configured) {
    return { configured: false, loggedIn: false, email: null, isAdmin: null, links };
  }
  const session = await _getSession();
  if (!session) {
    return { configured: true, loggedIn: false, email: null, isAdmin: null, links };
  }
  const isAdmin = await _isAdmin(_getClient(), session.user.id);
  return {
    configured: true,
    loggedIn: true,
    email: session.user.email || null,
    isAdmin, // true / false / null(確認失敗=不明)
    links
  };
}

/** 連携先 URL / anon キーの保存。変更時は既存セッションを破棄（別プロジェクトのトークン混在防止）。 */
async function setConfig(cfg) {
  const url = typeof cfg.url === 'string' ? cfg.url.trim() : '';
  const anonKey = typeof cfg.anonKey === 'string' ? cfg.anonKey.trim() : '';
  if (url !== '' && !url.startsWith('https://')) {
    return { ok: false, error: '連携先 URL は https:// で始まる必要があります' };
  }
  const prev = _config();
  const changed = prev.url !== url || prev.anonKey !== anonKey;
  _mainStore.set('dbLink', { ...(_mainStore.get('dbLink') || {}), url, anonKey });
  if (changed) {
    if (_client) {
      try { await _client.auth.signOut(); } catch (_) { /* ignore */ }
      try { _client.auth.stopAutoRefresh(); } catch (_) { /* ignore */ }
    }
    _client = null;
    _clientKey = '';
    _adminCache = null;
    sessionStore.clear();
  }
  _log('dblink:config-saved');
  return { ok: true, status: await getStatus() };
}

/** 管理者ログイン。PW は保存もログ出力もしない（受けて渡すだけ）。 */
async function login(cred) {
  const email = typeof cred.email === 'string' ? cred.email.trim() : '';
  const password = typeof cred.password === 'string' ? cred.password : '';
  if (!_configured()) {
    return { ok: false, error: '先に連携先 URL と anon キーを保存してください' };
  }
  if (!email || !password) {
    return { ok: false, error: 'メールアドレスとパスワードを入力してください' };
  }
  const client = _getClient();
  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      _log('dblink:login-failed');
      // Supabase の英語メッセージを日本語の具体的な文言へ変換
      const msg = /invalid login credentials/i.test(error.message || '')
        ? 'メールアドレスまたはパスワードが違います'
        : `ログインに失敗しました: ${error.message}`;
      return { ok: false, error: msg };
    }
    _adminCache = null;
    const isAdmin = await _isAdmin(client, data.user.id);
    _log('dblink:login-ok');
    if (isAdmin === false) {
      // ログイン自体は成立するが管理者ではない=連携操作は連携先 RPC が拒否する。UI で明示する。
      return { ok: true, warning: 'このアカウントは管理者ではありません（連携操作は拒否されます）', status: await getStatus() };
    }
    return { ok: true, status: await getStatus() };
  } catch (err) {
    _log('dblink:login-error');
    return { ok: false, error: `連携先に接続できません: ${err && err.message ? err.message : '不明なエラー'}` };
  }
}

/** ログアウト（セッション明示失効 + ローカル保存も消す）。 */
async function logout() {
  const client = _getClient();
  if (client) {
    try { await client.auth.signOut(); } catch (_) { /* signOut 失敗でもローカルは消す */ }
  }
  sessionStore.clear();
  _adminCache = null;
  _log('dblink:logout');
  return { ok: true, status: await getStatus() };
}

/**
 * 接続テスト: 当営業日（朝8:00境界）の開催中大会一覧を read。
 * ★brief §随伴の実確認: admin JWT で tournaments 直 SELECT が通るかをここで実証する。
 * ★SELECT は 5 列のみ（金額列・PII を選ばない = 送信内容の最小化と対）。
 */
async function listTodayTournaments() {
  if (!_configured()) {
    return { ok: false, error: '連携先が未設定です' };
  }
  const session = await _getSession();
  if (!session) {
    // ★anon のままデータ取得を行わない（brief 必須確認3）
    return { ok: false, error: 'ログインしていません（管理者アカウントでログインしてください）' };
  }
  const client = _getClient();
  const businessDate = currentBusinessDate();
  try {
    const { data, error } = await client
      .from('tournaments')
      .select('id, name, part_label, business_date, status')
      .eq('business_date', businessDate)
      .eq('status', 'open');
    if (error) {
      _log('dblink:list-failed');
      return { ok: false, error: `大会一覧を取得できません: ${error.message}（管理者権限が無い可能性があります）` };
    }
    _log('dblink:list-ok');
    return { ok: true, businessDate, tournaments: data || [] };
  } catch (err) {
    _log('dblink:list-error');
    return { ok: false, error: `連携先に接続できません: ${err && err.message ? err.message : '不明なエラー'}` };
  }
}

/**
 * 大会（PC 側 id）ごとの連携フラグの保存（STEP2a では保存のみ・送信などの挙動ゼロ）。
 * ★plan §2-E からの安全側変更: tournaments 配列の要素に持たせると `normalizeTournament` が
 *   未知キーを落とす（tournaments:save 経路で消える）ため、**dbLink.links に隔離保存**する
 *   （既存の大会保存経路・検証関数に一切触れない）。
 */
function setTournamentLink(p) {
  const tournamentId = typeof p.tournamentId === 'string' ? p.tournamentId : '';
  if (!tournamentId) return { ok: false, error: '対象のトーナメントがありません' };
  const cur = _mainStore.get('dbLink') || {};
  const links = { ...(cur.links || {}) };
  if (p.enabled) links[tournamentId] = true;
  else delete links[tournamentId];
  _mainStore.set('dbLink', { ...cur, links });
  return { ok: true, links };
}

/** アプリ終了時の後始末（公式ガイダンス: 非ブラウザは stopAutoRefresh を明示）。 */
function stop() {
  if (_client) {
    try { _client.auth.stopAutoRefresh(); } catch (_) { /* ignore */ }
  }
}

module.exports = {
  init,
  getStatus,
  setConfig,
  login,
  logout,
  listTodayTournaments,
  setTournamentLink,
  stop
};
