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
 * ★K1 のスコープ: GET `/tournaments`（当日大会一覧・非機微5列）と紐づけ（PC ローカル対応表1行）のみ。
 *   POST 系（structures/init/record/runtime/stop）のラッパは K2 で追加する＝「まだ送信しない」を
 *   構造で担保。営業日判定はサーバー側（旧 business-date.js は撤去）。
 */

const fs = require('fs');
const path = require('path');

let _mainStore = null;      // main の設定ストア（init で受け取る・dbLink キーのみ読み書き）
let _log = null;            // rollingLog 相当（イベント名リテラルのみ渡す・秘匿値は渡さない）
let _fetchImpl = null;      // fetch 実装（テスト注入用・既定はグローバル fetch）

// 通信タイムアウト（ms）。切断検知の土台（K3 で「連携切断中」表示に接続する）。
const REQUEST_TIMEOUT_MS = 10_000;

function init(store, log, opts) {
  _mainStore = store;
  _log = typeof log === 'function' ? log : () => {};
  _fetchImpl = opts && typeof opts.fetchImpl === 'function' ? opts.fetchImpl : null;
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
    // API の日本語エラー本文はそのまま透過（400/404 not_found/409/413/429）
    return { ok: false, code: json.code || 'api_error', error: json.error };
  }
  if (res.status === 404) {
    // プレーン 404 = 認可NG（誤キー / サーバー側キー未設定）。生の HTTP 値は出さない。
    return { ok: false, code: 'auth', error: '連携先 URL または店舗キーを確認してください' };
  }
  return { ok: false, code: 'bad_response', error: '連携先から正しい応答がありません（時間をおいて再試行してください）' };
}

/**
 * 現在状態（設定済みか + 大会別の紐づけ対応表）。renderer の表示専用。
 * 店舗キーの値そのものは返さない（表示は「設定済み」の2値で足りる）。
 */
function getStatus() {
  const { links } = _config();
  return { configured: _configured(), links };
}

/** 連携先 URL / 店舗キーの保存。旧方式の anonKey キーはここで自然に消える（書き戻さない）。 */
function setConfig(cfg) {
  const url = typeof cfg.url === 'string' ? cfg.url.trim() : '';
  const storeKey = typeof cfg.storeKey === 'string' ? cfg.storeKey.trim() : '';
  if (url !== '' && !url.startsWith('https://')) {
    return { ok: false, error: '連携先 URL は https:// で始まる必要があります' };
  }
  const { links } = _config();
  _mainStore.set('dbLink', { url, storeKey, links });
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

module.exports = {
  init,
  getStatus,
  setConfig,
  listTodayTournaments,
  setTournamentLink,
  // テスト専用: fetch ラッパを直接駆動する（実ネットワーク不要の純ロジック検証用）
  _request
};
