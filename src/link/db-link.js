'use strict';

/**
 * 外部DB連携 STEP2-K1: 「店舗キー」方式の接続基盤（main プロセス専用モジュール・plain fetch 版）。
 *
 * ★方式（2026-07-17 前原確定・壁打ち記録 §7 = 旧 STEP2a のメール+PW ログイン方式を置換）:
 *   - PC はログインしない。設定は「①自店アプリの URL ②店舗キー」の2つだけ（アカウント管理ゼロ）。
 *   - 通信は customer-app の受け口 API（`<URL>/api/pc-timer/*`）への plain fetch のみ。
 *     supabase-js は撤去（追加ライブラリゼロへ復帰）。
 *   - 全リクエストに `Authorization: Bearer <店舗キー>` を付す。誤キー/未設定はサーバーが
 *     404 プレーン（URL の存在ごと隠蔽）を返す＝PC 側は「連携先 URL / 店舗キーの設定不備」として
 *     日本語表示する（生の HTTP 値を UI に出さない）。
 *
 * ★アーキテクチャ（STEP2a から不変）:
 *   - 通信は main プロセスに集約（renderer CSP `connect-src 'self' file:` 無改変）。
 *     preload の contextBridge + IPC で公開する。
 *   - **未設定なら inert**: URL・店舗キーが空の間は外部への接続を一切行わない
 *     （既定 OFF・後方互換 = CLAUDE.md「完全ローカル動作」例外②の範囲内でのみ通信）。
 *
 * ★資格情報の扱い:
 *   - 店舗キーは main の設定ストア（userData/config.json）に平文保存（前原了承済・壁打ち記録 §7）。
 *     失効手当 = 前原が Vercel env を差し替えると旧キーは即 404（実質失効）→ 新キーを再入力。
 *   - ログ（rollingLog）へはイベント名リテラルのみ。**店舗キーをログ・console に出さない**
 *     （tests/db-link.test.js が静的検査）。
 *
 * ★K2 で送信系を追加: 紐づけ時 = POST `/structures` → `/clock/init`（linkAndInit）。運用中 =
 *   engine の状態遷移に連動した POST `/clock/record` / `/clock/runtime`（renderer からの IPC 経由・
 *   coalescer で 60回/分レートに構造的に収める）。楽観ロック = 直前成功応答の `clock.updated_at`
 *   （ISO 文字列）を**加工せず**次回書込の `expected_updated_at` へ echo back。409 clock_conflict は
 *   GET `/clock` でキャッシュを取り直して 1 回だけ再送（PC 操作は最新の意思。真の DB 追従は K3）。
 *   stop（OFF 時の配信停止）と切断表示は K3。営業日判定はサーバー側（旧 business-date.js は撤去）。
 */

const fs = require('fs');
const path = require('path');

let _mainStore = null;      // main の設定ストア（init で受け取る・dbLink キーのみ読み書き）
let _log = null;            // rollingLog 相当（イベント名リテラルのみ渡す・秘匿値は渡さない）
let _fetchImpl = null;      // fetch 実装（テスト注入用・既定はグローバル fetch）
let _nowFn = null;          // 時刻取得（テスト注入用・既定 Date.now）
let _delayFn = null;        // 遅延実行（テスト注入用・既定 setTimeout）

// 通信タイムアウト（ms）。切断検知の土台（K3 で「連携切断中」表示に接続する）。
const REQUEST_TIMEOUT_MS = 10_000;

// K2 coalescer: トレーリング遅延 / 種別ごとの最小送信間隔 / 429 時のバックオフ（1段のみ）
const COALESCE_DELAY_MS = 300;
const MIN_SEND_INTERVAL_MS = 2_000;
const RATE_BACKOFF_MS = 60_000;

// 楽観ロック: db 大会id → 直前成功応答の clock.updated_at（ISO 文字列そのまま・加工しない）
const _updatedAtCache = new Map();

function init(store, log, opts) {
  _mainStore = store;
  _log = typeof log === 'function' ? log : () => {};
  _fetchImpl = opts && typeof opts.fetchImpl === 'function' ? opts.fetchImpl : null;
  _nowFn = opts && typeof opts.nowFn === 'function' ? opts.nowFn : null;
  _delayFn = opts && typeof opts.delayFn === 'function' ? opts.delayFn : null;
  _updatedAtCache.clear();
  for (const st of Object.values(_coalescers)) {
    if (st.timer) { try { clearTimeout(st.timer); } catch (_) {} }
    st.timer = null; st.pending = null; st.lastSentAt = 0; st.backoffUntil = 0;
  }
  // 旧 STEP2a（ログイン方式）のセッションファイルが残っていれば削除する（旧トークンを残置しない）。
  // userData パスは electron-store の設定ファイルと同じディレクトリ。失敗は無視（存在しない等）。
  try {
    if (store && typeof store.path === 'string') {
      const sessionPath = path.join(path.dirname(store.path), 'db-link-session.json');
      if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
    }
  } catch (_) { /* ignore */ }
}

function _config() {
  const cfg = (_mainStore && _mainStore.get('dbLink')) || {};
  return {
    url: typeof cfg.url === 'string' ? cfg.url.trim() : '',
    storeKey: typeof cfg.storeKey === 'string' ? cfg.storeKey.trim() : '',
    links: cfg.links && typeof cfg.links === 'object' ? cfg.links : {}
  };
}

function _configured() {
  const { url, storeKey } = _config();
  return url.startsWith('https://') && storeKey.length > 0;
}

/** ベース URL の正規化（末尾スラッシュを落とす）。 */
function _baseUrl() {
  return _config().url.replace(/\/+$/, '');
}

/**
 * 受け口 API への共通リクエスト。エラーを日本語の `{ ok:false, code, error }` へ写像する。
 *
 * ★404 の両義性（brief 要注意2）: `/api/pc-timer/*` の 404 は「認可NG（誤キー/env 未設定）」または
 *   「大会/時計 not_found」であり route 不在ではない。認可NG はプレーン 404（本文が JSON でない）、
 *   not_found 系は `{ok:false, code, error}` の JSON 本文を持つ＝本文の有無で判別する。
 *   API のエラー本文 `error` は日本語完成文なのでそのまま UI 表示してよい（契約）。
 */
async function _request(method, apiPath, body) {
  if (!_configured()) {
    return { ok: false, code: 'not_configured', error: '連携先が未設定です（連携先 URL と店舗キーを保存してください）' };
  }
  const { storeKey } = _config();
  const url = `${_baseUrl()}/api/pc-timer${apiPath}`;
  const headers = { Authorization: `Bearer ${storeKey}` };
  const opts = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  opts.signal = controller.signal;
  const doFetch = _fetchImpl || fetch;
  let res;
  try {
    res = await doFetch(url, opts);
  } catch (_) {
    // ネットワーク断 / DNS 失敗 / タイムアウト abort — 生のエラー文言は UI に出さない
    return { ok: false, code: 'network', error: '連携先に接続できません（ネットワークを確認してください）' };
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try { json = await res.json(); } catch (_) { /* 本文が JSON でない（プレーン 404 等） */ }
  if (res.ok && json && json.ok === true) return json;
  if (json && json.ok === false && typeof json.error === 'string' && json.error) {
    // API の日本語エラー本文はそのまま透過（400/404 not_found/409/413/429）。
    // httpStatus は内部制御用（429 バックオフ判定）で UI には出さない。
    return { ok: false, code: json.code || 'api_error', error: json.error, httpStatus: res.status };
  }
  if (res.status === 404) {
    // プレーン 404 = 認可NG（誤キー / サーバー側キー未設定）。生の HTTP 値は出さない。
    return { ok: false, code: 'auth', error: '連携先 URL または店舗キーを確認してください', httpStatus: 404 };
  }
  return { ok: false, code: 'bad_response', error: '連携先から正しい応答がありません（時間をおいて再試行してください）', httpStatus: res.status };
}

/** 成功応答の clock.updated_at を楽観ロックキャッシュへ（ISO 文字列そのまま・加工しない）。 */
function _cacheUpdatedAt(dbId, res) {
  if (res && res.ok === true && res.clock && typeof res.clock.updated_at === 'string') {
    _updatedAtCache.set(dbId, res.clock.updated_at);
  }
}

/**
 * 現在状態（設定済みか + 大会別の紐づけ対応表）。renderer の表示専用。
 * 店舗キーの値そのものは返さない（表示は「設定済み」の2値で足りる）。
 */
function getStatus() {
  const { links } = _config();
  return { configured: _configured(), links };
}

/**
 * 連携先 URL / 店舗キーの保存。旧方式の anonKey キーはここで自然に消える（書き戻さない）。
 * ★K1 完了 review 懐疑役指摘の手当て: **storeKey が空なら保存済みキーを維持**する
 *   （URL だけ直して再保存してもキーが無言で消えない。キーを消したい場合は URL も空にして
 *   保存 = 未設定へ戻す）。
 */
function setConfig(cfg) {
  const url = typeof cfg.url === 'string' ? cfg.url.trim() : '';
  const inputKey = typeof cfg.storeKey === 'string' ? cfg.storeKey.trim() : '';
  if (url !== '' && !url.startsWith('https://')) {
    return { ok: false, error: '連携先 URL は https:// で始まる必要があります' };
  }
  const prev = _config();
  const storeKey = (url === '') ? '' : (inputKey !== '' ? inputKey : prev.storeKey);
  _mainStore.set('dbLink', { url, storeKey, links: prev.links });
  _log('dblink:config-saved');
  return { ok: true, status: getStatus() };
}

/**
 * 当営業日の開催中大会一覧（GET /tournaments）。営業日判定はサーバー側（受け口 API）。
 * 返るのは非機微5列（id/name/part_label/business_date/status）のみ（金額・PII なし）。
 */
async function listTodayTournaments() {
  const res = await _request('GET', '/tournaments');
  _log(res.ok ? 'dblink:list-ok' : 'dblink:list-failed');
  if (!res.ok) return res;
  return { ok: true, tournaments: Array.isArray(res.tournaments) ? res.tournaments : [] };
}

/**
 * 大会紐づけ（PC ローカルの対応表1行のみ・仕様3）。
 * ON = links[PC 側大会id] に選択した API 側大会（非機微3値）を保存 / OFF = 行削除。
 * タイマーアプリ側の大会データ（名前・ブラインド・設定）にも台帳側にも一切書き込まない。
 * ★tournaments 配列の要素に持たせない（normalizeTournament が未知キーを落とすため隔離保存）。
 */
function setTournamentLink(p) {
  const tournamentId = typeof p.tournamentId === 'string' ? p.tournamentId : '';
  if (!tournamentId) return { ok: false, error: '対象のトーナメントがありません' };
  const cur = _mainStore.get('dbLink') || {};
  const links = { ...(cur.links || {}) };
  if (p.enabled) {
    const db = p.db && typeof p.db === 'object' ? p.db : null;
    if (!db || typeof db.id !== 'string' || !db.id) {
      return { ok: false, error: '紐づけ先の大会が選択されていません' };
    }
    links[tournamentId] = {
      id: db.id,
      name: typeof db.name === 'string' ? db.name : '',
      part_label: typeof db.part_label === 'string' ? db.part_label : ''
    };
  } else {
    delete links[tournamentId];
  }
  _mainStore.set('dbLink', { ...cur, links });
  _log('dblink:link-updated');
  return { ok: true, links };
}

// ===== K2: 時計状態の送信（structures / init / record / runtime + 楽観ロック + coalescer） =====

/** 現在時計の取得（GET /clock）。成功時は楽観ロックキャッシュを更新する。 */
async function getClock(dbId) {
  const res = await _request('GET', `/clock?t=${encodeURIComponent(dbId)}`);
  _cacheUpdatedAt(dbId, res);
  return res;
}

/**
 * 紐づけ確定の一括処理: 構成 upload → clock/init → 対応表保存。
 * - init が 409 clock_running（進行中差し替え拒否）の場合は構成を差し替えず **GET /clock で
 *   既存時計に接続**して対応表を保存し、`mode:'connected'` + warning を返す（PC 再起動後の
 *   再紐づけ UX・plan review 条件①: この場合 renderer は初期状態送信をしない=稼働中の
 *   DB 時計を PC の idle で上書きしない）。
 * - upload / init の他エラー時は対応表を保存せずエラー返却。
 * @returns {ok, mode:'fresh'|'connected', warning?, links?} or {ok:false, error}
 */
async function linkAndInit(p) {
  const tournamentId = typeof p.tournamentId === 'string' ? p.tournamentId : '';
  const db = p.db && typeof p.db === 'object' && typeof p.db.id === 'string' && p.db.id ? p.db : null;
  const structure = p.structure && typeof p.structure === 'object' ? p.structure : null;
  if (!tournamentId || !db) return { ok: false, error: '紐づけ先の大会が選択されていません' };
  if (!structure) return { ok: false, error: 'ブラインド構成がありません' };
  const upload = await _request('POST', '/structures', structure);
  if (!upload.ok) { _log('dblink:structures-failed'); return upload; }
  const initRes = await _request('POST', '/clock/init', {
    tournament_id: db.id,
    structure_id: upload.structure_id
  });
  if (initRes.ok) {
    _cacheUpdatedAt(db.id, initRes);
    const saved = setTournamentLink({ tournamentId, enabled: true, db });
    if (!saved.ok) return saved;
    _log('dblink:link-init-ok');
    return { ok: true, mode: 'fresh', links: saved.links };
  }
  if (initRes.code === 'clock_running') {
    // 進行中は構成差し替え不可（契約どおり）→ 既存時計へ接続して紐づけだけ保存
    const clock = await getClock(db.id);
    if (!clock.ok) return clock;
    const saved = setTournamentLink({ tournamentId, enabled: true, db });
    if (!saved.ok) return saved;
    _log('dblink:link-connected');
    return {
      ok: true,
      mode: 'connected',
      warning: '進行中のため既存の時計に接続しました（構成の差し替えは終了後のみ可能です）',
      links: saved.links
    };
  }
  _log('dblink:init-failed');
  return initRes;
}

// 種別ごとの coalescer 状態（PC 1台=1大会のため種別単位で足りる。dbId は pending に持つ）
const _coalescers = {
  record: { timer: null, pending: null, lastSentAt: 0, backoffUntil: 0, path: '/clock/record' },
  runtime: { timer: null, pending: null, lastSentAt: 0, backoffUntil: 0, path: '/clock/runtime' }
};

function _now() { return _nowFn ? _nowFn() : Date.now(); }
function _delay(fn, ms) { return _delayFn ? _delayFn(fn, ms) : setTimeout(fn, ms); }

/** PC 側大会 id → 紐づけ済み db 大会 id（未紐づけは null=送信しない・main 側ゲート）。 */
function _linkedDbId(pcTournamentId) {
  const { links } = _config();
  const row = links && links[pcTournamentId];
  return row && typeof row === 'object' && typeof row.id === 'string' && row.id ? row.id : null;
}

/**
 * 種別ごとのトレーリング coalescer（最新 payload 勝ち）:
 * - 送信は常に COALESCE_DELAY_MS 後（連打・連続遷移は最後の状態に収束）
 * - 直近送信から MIN_SEND_INTERVAL_MS 未満なら間隔が空くまで待つ（2種別合計でも 60回/分以内）
 * - 429 を受けたら RATE_BACKOFF_MS のバックオフ（1段のみ・payload は保持して後送）
 */
function _scheduleSend(type, dbId, payload) {
  const st = _coalescers[type];
  st.pending = { dbId, payload };
  if (st.timer) return; // 既にスケジュール済み → pending の上書きだけで良い（最新勝ち）
  const now = _now();
  const wait = Math.max(COALESCE_DELAY_MS, st.lastSentAt + MIN_SEND_INTERVAL_MS - now, st.backoffUntil - now);
  st.timer = _delay(() => { st.timer = null; _flushSend(type); }, wait);
}

async function _flushSend(type) {
  const st = _coalescers[type];
  if (!st.pending) return;
  const { dbId, payload } = st.pending;
  st.pending = null;
  st.lastSentAt = _now();
  const body = { tournament_id: dbId, ...payload, expected_updated_at: _updatedAtCache.get(dbId) || null };
  let res = await _request('POST', st.path, body);
  if (res.ok) { _cacheUpdatedAt(dbId, res); _log('dblink:send-ok'); }
  else if (res.code === 'clock_conflict') {
    // 楽観ロック衝突: GET で取り直し → 最新 payload を 1 回だけ再送（PC 操作は最新の意思）。
    // 再 409 / 他エラーは放置（UI 表示・DB 追従は K3）。
    _log('dblink:send-conflict');
    const clock = await getClock(dbId);
    if (clock.ok) {
      const retryBody = { tournament_id: dbId, ...payload, expected_updated_at: _updatedAtCache.get(dbId) || null };
      const retry = await _request('POST', st.path, retryBody);
      if (retry.ok) { _cacheUpdatedAt(dbId, retry); _log('dblink:send-retry-ok'); }
      else _log('dblink:send-retry-failed');
    }
  } else if (res.httpStatus === 429) {
    // レート超過: 1 段バックオフして payload を保持（後で最新状態を送る）
    _log('dblink:send-rate-limited');
    st.backoffUntil = _now() + RATE_BACKOFF_MS;
    if (!st.pending) st.pending = { dbId, payload };
    if (!st.timer) {
      st.timer = _delay(() => { st.timer = null; _flushSend(type); }, RATE_BACKOFF_MS);
    }
  } else {
    _log('dblink:send-failed');
  }
  // 送信中に新しい pending が積まれていたら次をスケジュール
  if (st.pending && !st.timer) {
    const now = _now();
    const wait = Math.max(COALESCE_DELAY_MS, st.lastSentAt + MIN_SEND_INTERVAL_MS - now, st.backoffUntil - now);
    st.timer = _delay(() => { st.timer = null; _flushSend(type); }, wait);
  }
}

/** 時計状態（record）の送信。未紐づけ pcId は黙って破棄（fetch ゼロ）。 */
function publishRecord(pcTournamentId, record) {
  if (!record || typeof record !== 'object') return;
  const dbId = _linkedDbId(pcTournamentId);
  if (!dbId || !_configured()) return;
  _scheduleSend('record', dbId, record);
}

/** 人数系（runtime）の送信。未紐づけ pcId は黙って破棄（fetch ゼロ）。 */
function publishRuntime(pcTournamentId, runtime) {
  if (!runtime || typeof runtime !== 'object') return;
  const dbId = _linkedDbId(pcTournamentId);
  if (!dbId || !_configured()) return;
  _scheduleSend('runtime', dbId, runtime);
}

module.exports = {
  init,
  getStatus,
  setConfig,
  listTodayTournaments,
  setTournamentLink,
  getClock,
  linkAndInit,
  publishRecord,
  publishRuntime,
  // テスト専用: fetch ラッパを直接駆動する（実ネットワーク不要の純ロジック検証用）
  _request
};
