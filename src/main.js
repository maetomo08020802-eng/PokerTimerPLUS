// PokerTimerPLUS+ メインプロセス
// 制作: Yu Shimomachi (PLUS2運営)

const { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain, screen, session, shell, powerMonitor, powerSaveBlocker } = require('electron');
// STEP 10 フェーズC.1.2 Fix 3: electron-updater で GitHub Releases から自動更新。
//   開発時（NODE_ENV=development）はスキップしてテスト誤動作を回避。
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; }
catch (_) { /* electron-updater 未インストール時は no-op */ }
// STEP 10 フェーズC.2.7-audit-fix: powerSaveBlocker — RUNNING 中のディスプレイスリープ防止
//   営業中にスクリーンロックでタイマーが見えなくなる事故を防ぐ。
//   blocker ID は単一保持。renderer から start/stop IPC で制御。
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
// remote-control Phase 1a: 同一 LAN 内スマホ遠隔操作サーバ（Node 標準 http のみ・追加ライブラリなし）。
//   既定 OFF（設定トグル remoteControl.enabled）。ON の時だけ main が LAN サーバを起動する。
//   認証境界（PIN / Origin / Host / Content-Type / レート制限）は src/remote/server.js に集約。
const remoteServer = require('./remote/server');
const remoteDiscover = require('./remote/discover');
// 1b-qr: 接続 URL の QR を main（node）側で生成し行列を IPC で renderer へ渡す（本体 renderer に
//   新規 script を読ませない＝CSP `script-src 'self'` を一切触らない）。vendored 自作・依存ゼロ。
const remoteQr = require('./remote/vendor/qrcode');
// 外部DB連携 STEP2a: Supabase 接続基盤 + 管理者ログイン（main 集約＝renderer CSP 無改変）。
//   既定 OFF（連携先未設定なら inert・外部接続ゼロ）。CLAUDE.md「完全ローカル動作」例外②の範囲。
const dbLink = require('./link/db-link');

// STEP 6.21.4.2: Chromium AutoPlay Policy を無効化（起動直後から音再生を許可）
// app.whenReady() より前に必ず設定（Electron 起動フラグのため）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// v2.0.4-rc15 タスク 2: グローバル例外を rolling ログに記録（main プロセス側）。
//   rollingLog 自体は never throw 設計なのでハンドラ内で安全に呼べる。
//   既存挙動（プロセス継続 / 終了）には介入しない（観測のみ）。
process.on('uncaughtException', (err) => {
  try { rollingLog('main:uncaughtException', { message: err && err.message, stack: err && err.stack }); } catch (_) {}
});
process.on('unhandledRejection', (reason) => {
  try { rollingLog('main:unhandledRejection', { reason: reason && (reason.message || String(reason)) }); } catch (_) {}
});

// ウィンドウタイトル（branding.md により固定、変更不可）
const WINDOW_TITLE = 'PokerTimerPLUS+ — presented by Yu Shimomachi';

const isDev = process.env.NODE_ENV === 'development';

// v2.1.18-meas1 Fix 4: Ctrl+Shift+L で rolling-current.log のスナップショットを別ファイル保存する際の連番カウンタ。
//   app セッション開始時 0、押下のたびに increment して `op-{NN}-{timestamp}.log` のファイル名を生成。
let _measOpCounter = 0;

// ============================================================
// v2.0.4-rc15 タスク 2: 5 分 rolling ログ機構（案 A 単一ファイル + 30s 切捨）
// ============================================================
// バグ発見支援のため、直近 5 分間のイベントログを <userData>/logs/rolling-current.log に
// JSON Lines 形式で記録する常時稼働機構。前原さん要望「1 ファイルコピーで済む」を満たす。
//
// 設計（rc14 §3 推奨案 A → rc18 で ring buffer 化に進化）:
// - rc18 改修: in-memory ring buffer (上限 5,000 件) に push、30s 定期 flush で writeFile 全体上書き。
//   fire-and-forget の追記廃止により I/O 順序乱れを根絶（ts と書込順序が常に一致）。
// - 切捨: flush 時に 5 分 retention で filter してから書換（fs.promises 必須、同期 IO 禁止）
// - renderer は IPC 'rolling-log:write' 経由のみ（直接 fs アクセス禁止、ロックフリー化）
// - クラッシュ耐性: 最大 30s 分 + buffer 内未 flush 分のみ損失リスク
// - 容量目安: 平均 440 B/行 × 約 200 行/5min ≒ 90 KB（上限 ~1 MB 想定）
//
// 致命バグ保護への影響: なし（C.1.7 等は観測のみ、再生経路に介入しない）
// v2.2.1: 本番値固定（rc6-meas3 三項演算撤去）
const ROLLING_LOG_RETENTION_MS = 5 * 60 * 1000;        // 5 分 retention
const ROLLING_LOG_TRUNCATE_INTERVAL_MS = 30 * 1000;    // 30 秒 flush
const ROLLING_LOG_BUFFER_MAX = 5000;                   // 5000 行上限
let _rollingLogFilePath = null;
let _rollingLogTruncateTimer = null;
let _rollingLogBuffer = [];
function _initRollingLog() {
  if (_rollingLogFilePath !== null) return _rollingLogFilePath;
  try {
    if (typeof app.getPath !== 'function') { _rollingLogFilePath = ''; return ''; }
    const userData = app.getPath('userData');
    if (!userData || typeof userData !== 'string') { _rollingLogFilePath = ''; return ''; }
    const logsDir = path.join(userData, 'logs');
    try { fs.mkdirSync(logsDir, { recursive: true }); } catch (_) { /* ignore */ }
    _rollingLogFilePath = path.join(logsDir, 'rolling-current.log');
    // v2.0.4-rc22 タスク 3（問題 ⑩ 案 ⑩-D）:
    //   起動時に前回セッションの rolling-current.log を読み込んで buffer 復元。
    //   SIGKILL 等で will-quit が走らなかった場合の前回ログを継続使用可能にする。
    //   同期 readFileSync 維持（_initRollingLog 全体が同期コンテキスト、rc18 設計遵守）。
    //   5 分 retention は次回 _flushRollingLog 発火時に既存ロジックで適用される。
    try {
      const old = fs.readFileSync(_rollingLogFilePath, 'utf8');
      old.split('\n').filter(Boolean).forEach((line) => {
        try { _rollingLogBuffer.push(JSON.parse(line)); } catch (_) { /* skip malformed line */ }
      });
    } catch (_) { /* ファイル不在 / parse 失敗時は空 buffer 開始 */ }
    // 30 秒定期 flush タイマー開始（rc18 で append 廃止、buffer から writeFile で全体上書き）
    if (_rollingLogTruncateTimer === null) {
      _rollingLogTruncateTimer = setInterval(() => {
        _flushRollingLog().catch(() => { /* never throw from logging */ });
      }, ROLLING_LOG_TRUNCATE_INTERVAL_MS);
      if (typeof _rollingLogTruncateTimer.unref === 'function') _rollingLogTruncateTimer.unref();
    }
    console.log('[rolling-log] file:', _rollingLogFilePath);
  } catch (_) { _rollingLogFilePath = ''; }
  return _rollingLogFilePath;
}
async function _flushRollingLog() {
  try {
    const file = _initRollingLog();
    if (!file || !_rollingLogBuffer.length) return;
    // 5 分 retention で filter
    const cutoff = Date.now() - ROLLING_LOG_RETENTION_MS;
    _rollingLogBuffer = _rollingLogBuffer.filter((entry) => {
      const t = Date.parse(entry.ts);
      return Number.isFinite(t) && t >= cutoff;
    });
    if (!_rollingLogBuffer.length) return;
    const out = _rollingLogBuffer.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await fs.promises.writeFile(file, out);
  } catch (_) { /* never throw */ }
}
// v2.1.20-rc6-meas3: 優先ラベル専用バッファ機構。
//   メイン rolling buffer が高頻度ラベルで埋まっても、HDMI 系・PRE_START 配信系・error 系は別バッファに保管。
//   priority-events.log に 30 秒ごとに append（rolling buffer とは独立）。
//   サイズ上限 10000 行で循環（無限増加を防止）。
const PRIORITY_LOG_BUFFER_MAX = 10000;
const PRIORITY_LOG_LABELS = new Set([
  'display-removed',
  'display-added',
  'switchOperatorToSolo:enter',
  'switchOperatorToSolo:exit',
  'switchSoloToOperator:enter',
  'switchSoloToOperator:exit',
  'preStart:operator:send',
  'operator:preStartResync:sent',
  'operator:applyPreStartState:apply',
  // prestart-zero-stall 根治（2026-05-30, v2.4.1）: 0 着地後に届いた古い PRE_START 復元 payload を
  //   破棄した証拠ラベル（巻き戻し撲滅の決定的観測。これが出れば stale restore を弾けている）
  'operator:applyPreStartState:discard-stale-restore',
  // v2.1.20-rc10.1 追加（rc10-audit 高優先 #1 / #2 / #10）
  'hdmi:display-removed:dual-sync-stale',
  'hdmi:dialog-blocked:switchOperatorToSolo',
  'timer:reset:race-window-entry',
  // v2.2.2 hotfix Phase 2 第 1 段階: 観測ログ仕込み（rAF chain breakage + OS suspend 捕捉）
  //   詳細: NEXT_CC_PROMPT.md §A.1〜A.5、CC_REPORT.md §16 参照
  //   仮 hotfix 用、Phase 3 真因確定後に削除予定
  'prestart:tick',
  'prestart:tick:zero-detected',
  'prestart:tick:after-isPreStart-false',
  'prestart:tick:after-onPreStartEnd',
  'prestart:tick:after-onPreStartCancel',
  'prestart:tick:before-startAtLevel',
  'prestart:tick:after-startAtLevel',
  'prestart:tick:raf-gap',
  'timer:startAtLevel:enter',
  'timer:startAtLevel:setState-running',
  'timer:startAtLevel:before-startLoop',
  'timer:startLoop:enter',
  'timer:startLoop:rafId-set',
  'timer:tick:enter',
  'timer:tick:zero-detected',
  'timer:tick:raf-gap',
  'window:visibilitychange',
  'window:blur',
  'window:focus',
  'window:rAF-gap',
  'timer:reset:caller',
  'timer:cancelPreStart:caller',
  'power:blocker:app-suspension:start',
  'power:blocker:app-suspension:stop',
  'power:blocker:display-sleep:start',
  'power:blocker:display-sleep:stop',
  // v2.2.2 hotfix Phase 2 第 1.5 段階: §8.B-2 setTimeout フォールバック観測ラベル
  //   prestart:fallback:fired が 1 件でも本番ログで発火 = 仮説 F が現実に発生した決定的証拠
  'prestart:fallback:scheduled',
  'prestart:fallback:cleared',
  'prestart:fallback:fired'
]);
let _priorityLogBuffer = [];
let _priorityLogFilePath = null;
let _priorityLogFlushTimer = null;
function _isPriorityLabel(label) {
  if (typeof label !== 'string') return false;
  if (PRIORITY_LOG_LABELS.has(label)) return true;
  if (label.startsWith('error:caught:')) return true;
  return false;
}
function _appendPriorityLog(entry) {
  try {
    // v2.1.20-rc7: 初回 entry 追加時に init + setInterval 登録（idempotent、2 回目以降は path 返却のみ）
    _initPriorityLogFile();
    _priorityLogBuffer.push(entry);
    if (_priorityLogBuffer.length > PRIORITY_LOG_BUFFER_MAX) _priorityLogBuffer.shift();
  } catch (_) {}
}
function _initPriorityLogFile() {
  if (_priorityLogFilePath !== null) return _priorityLogFilePath;
  try {
    if (typeof app.getPath !== 'function') { _priorityLogFilePath = ''; return ''; }
    const userData = app.getPath('userData');
    if (!userData) { _priorityLogFilePath = ''; return ''; }
    const logsDir = path.join(userData, 'logs');
    try { fs.mkdirSync(logsDir, { recursive: true }); } catch (_) {}
    _priorityLogFilePath = path.join(logsDir, 'priority-events.log');
    // 30 秒 interval で priority buffer を append flush
    if (_priorityLogFlushTimer === null) {
      _priorityLogFlushTimer = setInterval(() => {
        _flushPriorityLog().catch(() => {});
      }, 30 * 1000);
      if (typeof _priorityLogFlushTimer.unref === 'function') _priorityLogFlushTimer.unref();
    }
  } catch (_) { _priorityLogFilePath = ''; }
  return _priorityLogFilePath;
}
async function _flushPriorityLog() {
  try {
    const file = _initPriorityLogFile();
    if (!file || !_priorityLogBuffer.length) return;
    const snapshot = _priorityLogBuffer.slice();
    _priorityLogBuffer = [];
    const out = snapshot.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await fs.promises.appendFile(file, out);
  } catch (_) { /* never throw from priority log */ }
}
// v2.0.15 Fix 3（M2 Sec-4）: rolling-log への出力時に店舗識別情報（presetName 等）を
//   SHA-256 短縮ハッシュに置換する PII 配慮。ハッシュ化は rolling-log への出力時のみで、
//   store / IPC / UI 表示等の本来データはハッシュ化しない。
const _hashPIICrypto = require('crypto');
function hashPII(value) {
  if (!value) return '';
  return _hashPIICrypto.createHash('sha256').update(String(value)).digest('hex').substring(0, 8);
}
function rollingLog(label, data) {
  // main プロセスから直接呼ぶエントリポイント。renderer からは IPC 'rolling-log:write' 経由。
  try {
    const entry = { ts: new Date().toISOString(), label: String(label || ''), data: data || null };
    _rollingLogBuffer.push(entry);
    if (_rollingLogBuffer.length > ROLLING_LOG_BUFFER_MAX) {
      _rollingLogBuffer.shift();   // 古いエントリ自動削除
    }
    // v2.1.20-rc6-meas3: priority label は別バッファにも記録（HDMI 系・PRE_START 配信系・error 系）
    if (_isPriorityLabel(entry.label)) {
      _appendPriorityLog(entry);
    }
  } catch (_) { /* never throw from logging */ }
}
// rolling ログ用ヘルパ（display イベント用、IIFE で既存テスト regex を破壊しないため別関数化）
function _safeDisplaysCount() {
  const out = { count: null };
  try {
    if (typeof screen !== 'undefined' && typeof screen.getAllDisplays === 'function') {
      const all = screen.getAllDisplays();
      out.count = Array.isArray(all) ? all.length : null;
    }
  } catch (_) { /* ignore */ }
  return out;
}
function _safeDisplayRemovedSnapshot(removedDisplay) {
  const out = _safeDisplaysCount();
  out.displayId = removedDisplay && removedDisplay.id || null;
  return out;
}
// ============================================================
// v2.0.4-rc15 タスク 2 ここまで
// ============================================================

// 列挙値（store マイグレーションや IPC 検証で参照されるため、store 初期化より前で宣言）
// STEP 10 フェーズC.1.3: 9 種類目「カスタム画像」を追加（'image'）
const VALID_BACKGROUNDS = ['black', 'navy', 'carbon', 'felt', 'burgundy', 'midnight', 'emerald', 'obsidian', 'image'];
// STEP 10 フェーズC.1.3: 背景画像 overlay の暗くする強度（弱 30% / 中 50% / 強 70%）
const VALID_BG_OVERLAYS = ['low', 'mid', 'high'];
// STEP 10 フェーズC.1.3: 背景画像 base64 data URL のサイズ上限（5MB）と形式チェック
//   ファイル原寸 5MB → base64 化で約 6.7MB の文字列。data URL 全体（プレフィックス含む）の長さで判定。
const BACKGROUND_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const BACKGROUND_IMAGE_DATA_URL_MAX_LEN = Math.ceil(BACKGROUND_IMAGE_MAX_BYTES * 4 / 3) + 64;
const BACKGROUND_IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;
// 背景画像 data URL のサニタイズ。不正なら fallback、サイズ超過なら null（呼出側で error）。
function sanitizeBackgroundImage(value, fallback) {
  if (typeof value !== 'string') return (typeof fallback === 'string') ? fallback : '';
  if (value === '') return '';
  if (!BACKGROUND_IMAGE_DATA_URL_RE.test(value)) return (typeof fallback === 'string') ? fallback : '';
  if (value.length > BACKGROUND_IMAGE_DATA_URL_MAX_LEN) return null;   // サイズ超過は呼出側で warning
  return value;
}
function sanitizeBackgroundOverlay(value, fallback) {
  if (typeof value !== 'string' || !VALID_BG_OVERLAYS.includes(value)) {
    return VALID_BG_OVERLAYS.includes(fallback) ? fallback : 'mid';
  }
  return value;
}
// STEP 10 フェーズC.1.4: 休憩中スライドショー
//   breakImages: data URL 配列、最大 20 枚、各要素は sanitizeBackgroundImage 同等の検証
//   breakImageInterval: スライドショー切替間隔（秒）3〜60、範囲外は 10 に補正
//   pipSize: 'small' | 'medium' | 'large'、それ以外は 'medium' に補正
const BREAK_IMAGES_MAX_COUNT = 20;
const VALID_PIP_SIZES = ['small', 'medium', 'large'];
function sanitizeBreakImages(value, fallback) {
  const fb = Array.isArray(fallback) ? fallback : [];
  if (!Array.isArray(value)) return fb.slice(0, BREAK_IMAGES_MAX_COUNT);
  const out = [];
  for (const item of value) {
    if (out.length >= BREAK_IMAGES_MAX_COUNT) break;
    const s = sanitizeBackgroundImage(item, '');
    // null（サイズ超過）と空文字は捨てる、有効な data URL のみ採用
    if (typeof s === 'string' && s !== '') out.push(s);
  }
  return out;
}
function sanitizeBreakImageInterval(value, fallback) {
  const fb = (typeof fallback === 'number' && fallback >= 3 && fallback <= 60) ? Math.floor(fallback) : 10;
  if (typeof value !== 'number' || !Number.isFinite(value)) return fb;
  const v = Math.floor(value);
  if (v < 3 || v > 60) return 10;
  return v;
}
function sanitizePipSize(value, fallback) {
  if (typeof value !== 'string' || !VALID_PIP_SIZES.includes(value)) {
    return VALID_PIP_SIZES.includes(fallback) ? fallback : 'medium';
  }
  return value;
}
// STEP 10 フェーズC.1.8: ランタイム情報の sanitize（負値防止 / NaN 弾き / 整数化）
//   playersInitial / playersRemaining / reentryCount / addOnCount すべて 0 以上の整数。
function sanitizeRuntime(value, fallback) {
  const fb = (fallback && typeof fallback === 'object') ? fallback : { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 };
  if (!value || typeof value !== 'object') return { ...fb };
  const toNonNegInt = (v, fbV) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return Math.max(0, Math.floor(fbV || 0));
    return Math.floor(v);
  };
  const playersInitial = toNonNegInt(value.playersInitial, fb.playersInitial);
  return {
    playersInitial,
    // v2.1.0 Fix 4 (M10 Edge-6): playersRemaining > playersInitial の異常状態を Math.min で正規化（avg stack 異常防止）
    playersRemaining: Math.min(toNonNegInt(value.playersRemaining, fb.playersRemaining), playersInitial),
    reentryCount:     toNonNegInt(value.reentryCount,     fb.reentryCount),
    addOnCount:       toNonNegInt(value.addOnCount,       fb.addOnCount)
  };
}
const VALID_TIMER_FONTS = ['jetbrains', 'roboto', 'space'];
const VALID_VARIANTS = ['default', 'variant2'];
// tournament-start-voice: 開始ボイス選択の許容値（'off' + 女性4 + 男性4）
const VALID_START_VOICES = ['off', 'female-1', 'female-2', 'female-3', 'female-4', 'male-1', 'male-2', 'male-3', 'male-4'];

// ===== STEP 10 フェーズA: ゲーム種拡張（11ゲーム × 4構造型） =====
// STEP 10 フェーズC.2.3: Limit Hold'em / MIX / その他 を追加（11 → 14 種類）
// ドロップダウン表示順は GAMES の宣言順
const GAMES = Object.freeze([
  { id: 'nlh',           name: 'NLH',                 type: 'BLIND' },
  { id: 'plo',           name: 'PLO',                 type: 'BLIND' },
  { id: 'plo5',          name: '5 Card PLO',          type: 'BLIND' },
  { id: 'plo8',          name: 'PLO8',                type: 'BLIND' },
  { id: 'big-o-blind',   name: 'Big O (Blind)',       type: 'BLIND' },
  { id: 'big-o-limit',   name: 'Big O (Limit)',       type: 'LIMIT_BLIND' },
  { id: 'omaha-hilo',    name: 'Omaha Hi-Lo',         type: 'LIMIT_BLIND' },
  { id: 'limit-holdem',  name: "Limit Hold'em",       type: 'LIMIT_BLIND' },   // C.2.3: MIX 構成要素として追加
  { id: 'short-deck',    name: 'Short Deck',          type: 'SHORT_DECK' },
  { id: 'stud',          name: 'Stud',                type: 'STUD' },
  { id: 'razz',          name: 'Razz',                type: 'STUD' },
  { id: 'stud-hilo',     name: 'Stud Hi-Lo',          type: 'STUD' },
  { id: 'mix',           name: 'MIX (10-Game)',       type: 'MIX' },           // C.2.3: WSOP 10-Game Mix
  { id: 'other',         name: 'その他（自由記入）', type: 'BLIND' }            // C.2.3: 自由記入、構造は BLIND 互換
]);

// 構造型 → フィールド定義（フェーズB でメイン画面 / エディタの動的レンダリングに使う）
// STEP 10 フェーズC.2.3: MIX 追加。MIX は固定 fields を持たず、各レベルの subStructureType で動的決定
const STRUCTURE_TYPES = Object.freeze({
  BLIND:        { fields: ['sb', 'bb', 'bbAnte'] },
  LIMIT_BLIND:  { fields: ['sb', 'bb', 'smallBet', 'bigBet'] },
  SHORT_DECK:   { fields: ['ante', 'buttonBlind'] },
  STUD:         { fields: ['ante', 'bringIn', 'smallBet', 'bigBet'] },
  MIX:          { fields: [] }   // C.2.3: 動的、各レベルの subStructureType を参照
});

// STEP 10 フェーズC.2.3: WSOP 10-Game Mix のローテーション（編集不可、固定順）
const MIX_ROTATION = Object.freeze([
  { gameId: 'nlh',           subStructureType: 'BLIND' },
  { gameId: 'plo',           subStructureType: 'BLIND' },
  { gameId: 'plo8',          subStructureType: 'BLIND' },
  { gameId: 'limit-holdem',  subStructureType: 'LIMIT_BLIND' },
  { gameId: 'omaha-hilo',    subStructureType: 'LIMIT_BLIND' },
  { gameId: 'razz',          subStructureType: 'STUD' },
  { gameId: 'stud',          subStructureType: 'STUD' },
  { gameId: 'stud-hilo',     subStructureType: 'STUD' },
  { gameId: 'short-deck',    subStructureType: 'SHORT_DECK' },
  { gameId: 'big-o-limit',   subStructureType: 'LIMIT_BLIND' }
]);

// 旧 gameType コード → 新コード のエイリアス（マイグレーション専用）。
// 既存配布版（〜1.1.0）の VALID_GAME_TYPES = ['NLHE', 'PLO', 'NLO8', 'Stud', 'Mixed', 'Other']
// に加えて、過去の表記揺れもまとめて吸収。
const LEGACY_GAME_TYPE_ALIAS = Object.freeze({
  'NLHE':              'nlh',
  'NoLimitHoldem':     'nlh',
  'No Limit Hold em':  'nlh',
  "No Limit Hold'em":  'nlh',
  'PLO':               'plo',
  'PLO4':              'plo',
  'PLO5':              'plo5',
  '5CardPLO':          'plo5',
  'PLO8':              'plo8',
  'NLO8':              'plo8',           // 旧 'NLO8' は PLO8 と同等扱い（ハイ・ロー O8）
  'OmahaHiLo':         'omaha-hilo',
  'Stud':              'stud',
  'Razz':              'razz',
  'StudHiLo':          'stud-hilo',
  // 旧の汎用枠（'Mixed'/'Other'）は対応する 1 種にできないので 'nlh' フォールバック
  'Mixed':             'nlh',
  'Other':             'nlh'
});

// ヘルパ
function getStructureTypeForGame(gameId) {
  const g = GAMES.find((x) => x.id === gameId);
  return g?.type || 'BLIND';   // 不明なら BLIND にフォールバック
}
function getStructureFields(structureType) {
  return STRUCTURE_TYPES[structureType]?.fields || STRUCTURE_TYPES.BLIND.fields;
}
function isValidNewGameId(id) {
  return GAMES.some((g) => g.id === id);
}
// 入力 gameType（旧コード or 新コード or 不明）→ 必ず新コードに正規化
function normalizeGameType(gameType) {
  if (typeof gameType !== 'string') return 'nlh';
  if (isValidNewGameId(gameType)) return gameType;
  if (LEGACY_GAME_TYPE_ALIAS[gameType]) return LEGACY_GAME_TYPE_ALIAS[gameType];
  return 'nlh';
}

// 永続化形式は新コード統一だが、互換のため旧コードも一時的に受理する集合（マイグレーション直前まで）
const VALID_GAME_TYPES_NEW = GAMES.map((g) => g.id);
const VALID_GAME_TYPES_LEGACY = Object.keys(LEGACY_GAME_TYPE_ALIAS);
const VALID_GAME_TYPES = [...VALID_GAME_TYPES_NEW, ...VALID_GAME_TYPES_LEGACY];

// STEP 10 フェーズB: ゲーム種変更時の「空テンプレ」自動生成（5レベル分、blind値 0、duration 維持）
//   prevLevelsOrUndefined: 旧 levels 配列を渡すと durationMinutes をその non-break 行から流用
//                          （足りなければ 15 で補完）
function getEmptyStructureForGame(gameId, prevLevelsOrUndefined) {
  const structureType = getStructureTypeForGame(gameId);
  const fields = getStructureFields(structureType);
  const prevDurations = Array.isArray(prevLevelsOrUndefined)
    ? prevLevelsOrUndefined.filter((lv) => !lv?.isBreak).map((lv) => lv?.durationMinutes ?? 15)
    : [];
  const levels = Array.from({ length: 5 }, (_, i) => {
    const lv = { level: i + 1, durationMinutes: prevDurations[i] ?? 15, isBreak: false };
    fields.forEach((f) => { lv[f] = 0; });
    return lv;
  });
  return { structureType, levels };
}

// トーナメント新規フィールド（STEP 6 / 6.5）のデフォルト
const VALID_PAYOUT_ROUNDINGS = [1, 10, 100, 1000];
// STEP 6.8: 運用柔軟性のため allowedUntilLevel / allowedAtBreak は削除（強制ロジックも未実装）
// STEP 6.9: rebuy → reentry リネーム、specialStack 追加（早期着席特典 / VIP特典等の運用カテゴリ）
const DEFAULT_TOURNAMENT_EXT = Object.freeze({
  startingStack: 10000,
  buyIn:   { fee: 3000, chips: 10000 },
  reentry: { fee: 2000, chips: 8000 },
  addOn:   { fee: 2000, chips: 10000 },
  payouts: [
    { rank: 1, percentage: 50 },
    { rank: 2, percentage: 30 },
    { rank: 3, percentage: 20 }
  ],
  gameType: 'nlh',
  // STEP 6.5
  guarantee: 0,            // GTD保証賞金（0 なら無効、計算プールがそのまま使われる）
  payoutRounding: 100,     // 配当端数の丸め単位（1 / 10 / 100 / 1000 円）
  // v2.5.2: 賞金傾斜モード（'percent'=プール比例 / 'amount'=入力額固定）。
  //   migration は payouts の amount 有無から推論、新規 save は renderer が 'amount' を送信。
  //   ここ（DEFAULT）は最終 fallback 用で 'percent'（既存挙動＝プール比例を安全側に維持）。
  payoutMode: 'percent',
  // STEP 6.7: 賞金区分（自由入力、空文字なら表示しない）
  // 例: 「ハウスチケット」「ポイント」「景品」「賞品」など、店舗運用に応じて
  prizeCategory: '',
  // STEP 6.9: 特殊スタック（早期着席特典・VIP特典など、初回エントリーとは別の追加配布）
  specialStack: { enabled: false, label: '早期着席特典', chips: 5000, appliedCount: 0 },
  // STEP 6.17: メインタイトル色（hex #RRGGBB、デフォルト白）
  titleColor: '#FFFFFF',
  // STEP 10 フェーズC.2.3: 「その他」ゲーム種選択時のカスタムゲーム名（最大 30 文字、空文字許可）
  customGameName: '',
  // STEP 10 フェーズC.2.3: ブレイク終了後に自動一時停止する設定
  pauseAfterBreak: false,
  // STEP 6.21: トーナメント別タイマー状態（独立した経過時間・レベル管理）
  // status: 'idle' | 'running' | 'paused'
  timerState: { status: 'idle', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: null },
  // STEP 6.21.6: トーナメント別表示設定（背景・時計フォント）
  // 新規作成時はその時点のグローバル display 値で初期化（getDefaultDisplaySettings 参照）
  // STEP 10 フェーズC.1.3: 背景画像（base64 data URL）と暗くする強度を追加
  // STEP 10 フェーズC.1.4: 休憩中スライドショー breakImages / breakImageInterval / pipSize を追加
  displaySettings: {
    background: 'navy', timerFont: 'jetbrains',
    backgroundImage: '', backgroundOverlay: 'mid',
    breakImages: [], breakImageInterval: 10, pipSize: 'medium'
  },
  // STEP 10 フェーズC.1.8: ランタイム情報（playersInitial / Remaining / reentryCount / addOnCount）の永続化。
  // 旧バージョン（v1.3.0 まで）では renderer メモリのみで保持していたため、アプリ終了 → 再起動で消失していた。
  runtime: { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 },
  // STEP 6.22.1: トーナメント別テロップ設定
  // 新規作成時はその時点のグローバル marquee 値で初期化
  marqueeSettings: { enabled: true, text: '', speed: 'normal' },
  // v2.4.0: プール率（賞金プール反映率、各フィー個別、0〜100 整数）
  //   このデフォルト値（100%）は migration / fallback 経路で使われる「既存互換」用。
  //   新規トーナメント作成時は store.appConfig.poolRatesDefault（=0%）から積込まれる。
  poolRates: { buyIn: 100, reentry: 100, addOn: 100 },
  // v2.6.0: POT（店内通貨 $ の1件あたり拠出額、¥フィー独立）。pool = Σ(potAmounts × 件数)。
  //   既定 0（店が都度設定。0 なら賞金プールが立たない）。migration で poolRates から変換。
  potAmounts: { buyIn: 0, reentry: 0, addOn: 0 }
});

// STEP 6.22.1: テロップ速度の許容値 + サニタイズ共通関数
// settings:setMarquee と tournaments:setMarqueeSettings / migrate / normalize 全てで使用
const VALID_MARQUEE_SPEEDS = ['slow', 'normal', 'fast'];
// STEP 10 フェーズC.2.7-audit-fix: テロップテキスト長さ上限。
//   巨大テキスト（10MB 等）が DOM textContent 代入時に UI freeze する事故を防ぐ。
//   実用上は 200 文字で十分（マーキー 1 周はそれ以上だと読み切れない）。超過分は切り捨て。
const MARQUEE_TEXT_MAX = 200;
function sanitizeMarqueeSettings(value, fallback) {
  const fb = fallback || { enabled: true, text: '', speed: 'normal' };
  if (!value || typeof value !== 'object') return { ...fb };
  let text = typeof value.text === 'string' ? value.text : fb.text;
  if (text.length > MARQUEE_TEXT_MAX) text = text.slice(0, MARQUEE_TEXT_MAX);
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : fb.enabled,
    text,
    speed: VALID_MARQUEE_SPEEDS.includes(value.speed) ? value.speed : fb.speed
  };
}

// v2.4.0: プール率（0〜100 整数）の sanitize。
//   - Number.isFinite なら Math.floor で整数化、Math.max/min で 0〜100 clamp
//   - 不正値（NaN / Infinity / null / undefined / 文字列）は fallback を採用
//   - 負値は 0、100 超は 100 に clamp（小数は切捨て）
function sanitizePoolRate(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const fb = Number(fallback);
    if (!Number.isFinite(fb)) return 0;
    return Math.max(0, Math.min(100, Math.floor(fb)));
  }
  return Math.max(0, Math.min(100, Math.floor(n)));
}

// v2.4.0: poolRates オブジェクト（{ buyIn, reentry, addOn }）の sanitize。
//   - value が object でなければ fallback を全フィールド sanitize して返す
//   - 各フィールドは sanitizePoolRate で個別 sanitize
//   - 既存トーナメント migration は fallback=DEFAULT_TOURNAMENT_EXT.poolRates（100%）
//   - 新規トーナメント作成は fallback=appConfig.poolRatesDefault（0%）
function sanitizePoolRates(value, fallback) {
  const fb = (fallback && typeof fallback === 'object')
    ? fallback
    : { buyIn: 0, reentry: 0, addOn: 0 };
  if (!value || typeof value !== 'object') {
    return {
      buyIn:   sanitizePoolRate(fb.buyIn,   0),
      reentry: sanitizePoolRate(fb.reentry, 0),
      addOn:   sanitizePoolRate(fb.addOn,   0)
    };
  }
  return {
    buyIn:   sanitizePoolRate(value.buyIn,   fb.buyIn),
    reentry: sanitizePoolRate(value.reentry, fb.reentry),
    addOn:   sanitizePoolRate(value.addOn,   fb.addOn)
  };
}

// v2.6.0: POT（店内通貨 $ の1件あたり拠出額）の sanitize。
//   - 非負整数。¥フィーとは独立（プール拠出専用）。安全のため大きめ上限 cap。
//   - poolRates%（v2.4.0）を置換する新モデル。pool = Σ(potAmounts × 件数)。
const MAX_POT_AMOUNT = 1_000_000_000; // 拠出上限（オーバーフロー/誤入力ガード）
function sanitizePotAmount(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    const fb = Number(fallback);
    return Number.isFinite(fb) && fb >= 0 ? Math.min(Math.floor(fb), MAX_POT_AMOUNT) : 0;
  }
  return Math.min(Math.floor(n), MAX_POT_AMOUNT);
}

// v2.6.0: potAmounts オブジェクト（{ buyIn, reentry, addOn }）の sanitize（sanitizePoolRates と同型）
function sanitizePotAmounts(value, fallback) {
  const fb = (fallback && typeof fallback === 'object')
    ? fallback
    : { buyIn: 0, reentry: 0, addOn: 0 };
  if (!value || typeof value !== 'object') {
    return {
      buyIn:   sanitizePotAmount(fb.buyIn,   0),
      reentry: sanitizePotAmount(fb.reentry, 0),
      addOn:   sanitizePotAmount(fb.addOn,   0)
    };
  }
  return {
    buyIn:   sanitizePotAmount(value.buyIn,   fb.buyIn),
    reentry: sanitizePotAmount(value.reentry, fb.reentry),
    addOn:   sanitizePotAmount(value.addOn,   fb.addOn)
  };
}

// STEP 6.21.6: 新規トーナメントの displaySettings 既定値を、その時点のグローバル display から算出
function getDefaultDisplaySettings() {
  const g = store?.get?.('display') || {};
  return {
    background: VALID_BACKGROUNDS.includes(g.background) ? g.background : 'navy',
    timerFont:  VALID_TIMER_FONTS.includes(g.timerFont)   ? g.timerFont  : 'jetbrains',
    // STEP 10 フェーズC.1.3: 背景画像 / overlay 強度の既定値はグローバルから引継ぎ。
    backgroundImage: (typeof g.backgroundImage === 'string') ? g.backgroundImage : '',
    backgroundOverlay: VALID_BG_OVERLAYS.includes(g.backgroundOverlay) ? g.backgroundOverlay : 'mid',
    // STEP 10 フェーズC.1.4: 休憩中スライドショー（グローバルから引継ぎ）
    breakImages: sanitizeBreakImages(g.breakImages, []),
    breakImageInterval: sanitizeBreakImageInterval(g.breakImageInterval, 10),
    pipSize: sanitizePipSize(g.pipSize, 'medium')
  };
}

// STEP 6.21: timerState の status 列挙
// STEP 10 フェーズC.1.2 Fix 2: 'finished' を追加 — 全レベル完走時の明示的な完了状態。
//   computeLiveTimerState は完走時 'finished' を返し、applyTimerStateToTimer は idle 同様タイマー再開しない。
//   再起動しても 'finished' を保持、メイン画面に「トーナメント終了」オーバーレイ表示。
const VALID_TIMER_STATUS = ['idle', 'running', 'paused', 'finished'];

// STEP 6.23 / STEP 10 フェーズA: PC間データ移行（JSON Export / Import）
//   v1: 旧 gameType コード（'NLHE' 等）+ 旧 levels フィールド名（smallBlind/bigBlind/ante）
//   v2: 新 gameType コード（'nlh' 等）。levels フィールド名はフェーズA では未変換（フェーズB で対応）
//       v2 取り込み時は validateImportPayload が gameType のみ正規化（互換変換）
const EXPORT_FORMAT = 'PokerTimerPLUS+ Tournament Export';
const EXPORT_VERSION = 2;

function buildExportPayload(kind, tournaments, userPresets) {
  // timerState を初期化（進行中の状態は別 PC に持っていかない）
  // v2.5.0: 背景画像 / 休憩スライドショー（backgroundImage / breakImages）は引き継がない（ローカル専用・軽量化）。
  //   その他の設定（テロップ marqueeSettings 含む）は全て引き継ぐ。
  const cleanTournaments = tournaments.map((t) => {
    const ds = (t && t.displaySettings) || {};
    const nextDs = { ...ds };
    delete nextDs.backgroundImage;
    delete nextDs.breakImages;
    return {
      ...t,
      displaySettings: nextDs,
      timerState: { status: 'idle', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: null }
    };
  });
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    kind,
    tournaments: cleanTournaments,
    userPresets: userPresets || []
  };
}

function validateImportPayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'invalid-json', message: '不正な JSON データです' };
  if (payload.format !== EXPORT_FORMAT)         return { ok: false, error: 'wrong-format', message: 'PokerTimerPLUS+ のエクスポート形式ではありません' };
  if (typeof payload.version !== 'number')      return { ok: false, error: 'no-version', message: 'バージョン情報がありません' };
  if (payload.version > EXPORT_VERSION)         return { ok: false, error: 'version-too-new', message: 'このアプリより新しいバージョンの形式です。アプリをアップデートしてください' };
  if (!Array.isArray(payload.tournaments))      return { ok: false, error: 'no-tournaments', message: 'tournaments 配列がありません' };
  if (!Array.isArray(payload.userPresets))      return { ok: false, error: 'no-presets', message: 'userPresets 配列がありません' };

  // STEP 10 フェーズC.2 中 4: userPresets の levels が空配列のものは拒否（取込後タイマー無動作で気付きにくいため）
  for (const p of payload.userPresets) {
    if (p && typeof p === 'object' && Array.isArray(p.levels) && p.levels.length === 0) {
      return { ok: false, error: 'empty-levels', message: `ユーザープリセット「${p.name || p.id || '(無名)'}」のレベルが空です` };
    }
  }

  // STEP 10 フェーズA/B: v1 ペイロードの互換変換
  //   - 旧 gameType コード（'NLHE' 等）→ 新コード（'nlh' 等）に正規化（フェーズA）
  //   - userPresets の structureType 補完 + levels フィールドリネーム sb/bb/bbAnte（フェーズB）
  if (payload.version === 1) {
    payload.tournaments = payload.tournaments.map((t) => ({
      ...t,
      gameType: normalizeGameType(t.gameType)
    }));
    payload.userPresets = payload.userPresets.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const structureType = (typeof p.structureType === 'string' && STRUCTURE_TYPES[p.structureType])
        ? p.structureType : 'BLIND';
      const levels = Array.isArray(p.levels) ? p.levels.map(convertLegacyBlindLevel) : [];
      return { ...p, structureType, levels };
    });
    payload.version = EXPORT_VERSION;
  }
  return { ok: true };
}

// STEP 6.22: venueName（店舗名「Presented by ○○」表記）
// 半角英数 + 半角スペース + 一部記号、最大 30 文字、先頭は英数のみ、空欄許可
const VENUE_NAME_MAX = 30;
const VENUE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 '\-&.,]{0,29}$/;

// venueName をサニタイズ。戻り値: 正常文字列 / '' / null（不正、呼出側で error）
function sanitizeVenueName(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().slice(0, VENUE_NAME_MAX);
  if (trimmed === '') return '';
  if (!VENUE_NAME_RE.test(trimmed)) return null;
  return trimmed;
}

// STEP 6.21: timerState を正規化 / 補完
function normalizeTimerState(ts) {
  const def = { status: 'idle', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: null };
  if (!ts || typeof ts !== 'object') return { ...def };
  const status = VALID_TIMER_STATUS.includes(ts.status) ? ts.status : 'idle';
  const currentLevel = (typeof ts.currentLevel === 'number' && ts.currentLevel >= 1)
    ? Math.floor(ts.currentLevel) : 1;
  const elapsedSecondsInLevel = (typeof ts.elapsedSecondsInLevel === 'number' && ts.elapsedSecondsInLevel >= 0)
    ? Math.floor(ts.elapsedSecondsInLevel) : 0;
  const startedAt = (typeof ts.startedAt === 'number' && ts.startedAt > 0) ? ts.startedAt : null;
  const pausedAt  = (typeof ts.pausedAt  === 'number' && ts.pausedAt  > 0) ? ts.pausedAt  : null;
  return { status, currentLevel, elapsedSecondsInLevel, startedAt, pausedAt };
}

// STEP 6.17: タイトル色 hex バリデーション（#RRGGBB 形式のみ許可、3桁短縮 #RGB は不可）
const TITLE_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

// STEP 6.7: トーナメント保存上限・ユーザープリセット保存上限
const MAX_TOURNAMENTS = 100;
const MAX_USER_PRESETS = 100;

// 永続設定ストア（electron-store）
const store = new Store({
  defaults: {
    marquee: {
      enabled: true,
      text: '',
      speed: 'normal'
    },
    display: {
      background: 'navy',
      timerFont: 'jetbrains',  // 'jetbrains' | 'roboto' | 'space'
      // STEP 6.7: ボトムバー非表示トグル（H キーで切替、永続化）
      bottomBarHidden: false,
      // STEP 10 フェーズC.1.3: 背景画像（base64 data URL）と暗くする強度（low/mid/high）
      backgroundImage: '',
      backgroundOverlay: 'mid',
      // STEP 10 フェーズC.1.4: 休憩中スライドショー
      breakImages: [],
      breakImageInterval: 10,
      pipSize: 'medium'
    },
    userPresets: [],   // STEP 3b: ユーザー作成のブラインド構造プリセット配列
    // STEP 3b 拡張: 複数トーナメント保存。旧 tournament（単一）は migrateTournament で配列に変換
    tournaments: [{
      id: 'tournament-default',
      name: 'ポーカートーナメント',
      subtitle: '',
      currencySymbol: '$',   // v2.6.0: 店内通貨（既定 $）
      blindPresetId: 'demo-fast',
      // STEP 6: バイイン・賞金構造・ゲーム種
      startingStack: 10000,
      buyIn:   { fee: 3000, chips: 10000 },
      reentry: { fee: 2000, chips: 8000 },
      addOn:   { fee: 2000, chips: 10000 },
      payouts: [
        { rank: 1, percentage: 50 },
        { rank: 2, percentage: 30 },
        { rank: 3, percentage: 20 }
      ],
      gameType: 'nlh',
      // STEP 6.5
      guarantee: 0,
      payoutRounding: 100,
      // STEP 6.7
      prizeCategory: '',
      // STEP 6.9
      specialStack: { enabled: false, label: '早期着席特典', chips: 5000, appliedCount: 0 },
      // STEP 6.17
      titleColor: '#FFFFFF',
      // STEP 10 フェーズC.2.3: その他ゲーム種のカスタム名 / ブレイク後自動一時停止
      customGameName: '',
      pauseAfterBreak: false,
      // STEP 6.21: 個別 timerState
      timerState: { status: 'idle', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: null },
      // STEP 6.21.6: トーナメント別表示設定
      // STEP 10 フェーズC.1.3: 背景画像 / overlay 強度を追加
      // STEP 10 フェーズC.1.4: 休憩中スライドショー breakImages / breakImageInterval / pipSize を追加
      displaySettings: {
        background: 'navy', timerFont: 'jetbrains',
        backgroundImage: '', backgroundOverlay: 'mid',
        breakImages: [], breakImageInterval: 10, pipSize: 'medium'
      },
      // STEP 10 フェーズC.1.8: ランタイム永続化
      runtime: { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 },
      // STEP 6.22.1: トーナメント別テロップ設定
      marqueeSettings: { enabled: true, text: '', speed: 'normal' }
    }],
    activeTournamentId: 'tournament-default',
    // STEP 4: 通知音設定。マスター音量と各音 ON/OFF（mp3 サンプル方式）
    // STEP 6.22: 店舗名「Presented by ○○」表記（グローバル、トーナメント単位ではない）
    venueName: '',
    // STEP 9-B: メイン画面左上ロゴの設定（グローバル）
    //   kind: 'placeholder'（初期：中立プレースホルダー）/ 'plus2'（同梱 PLUS2 ロゴ）/ 'custom'（ユーザー画像）
    //   customPath: kind='custom' のとき %APPDATA%\PokerTimerPLUS+\custom-logo.{ext} の絶対パス
    logo: {
      kind: 'placeholder',
      customPath: null
    },
    audio: {
      masterVolume: 0.8,            // 0.0〜1.0
      warning1MinEnabled: true,     // 1分前警告音
      warning10SecEnabled: true,    // 10秒前警告音
      countdown5SecEnabled: true,   // 5秒前カウントダウン音（5,4,3,2,1秒で鳴る）
      levelEndEnabled: true,        // レベル終了チャイム
      breakEndEnabled: true,        // ブレイク終了音
      startEnabled: true,           // STEP 5: スタート音（プレスタート終了/レベル1開始時）
      reverbEnabled: true,          // STEP 4 仕上げ②: 互換のため残置（事実上 dead key）
      // STEP 4 仕上げ④: 音色2バリアント切替（'default' | 'variant2'）
      levelEndVariant: 'default',
      countdownTickVariant: 'default',
      // tournament-start-voice: トーナメント開始ボイス（アプリ全体共通）。'off'＝従来動作（PRE_START→start.mp3 / 即時→無音）
      startVoice: 'off'
    },
    // v2.4.0: 店舗デフォルトのプール率（賞金プール反映率、新規トーナメント作成時にコピーされる初期値）
    //   0%＝安全側（景品表示法・風営法対応）。既存トーナメントは migration で 100% 補完されるため挙動完全維持。
    appConfig: {
      poolRatesDefault: { buyIn: 0, reentry: 0, addOn: 0 },
      // v2.6.0: 店舗デフォルトの POT（店内通貨 $ の1件あたり拠出、新規トーナメントにコピー）。既定 0。
      potDefaults: { buyIn: 0, reentry: 0, addOn: 0 }
    },
    // remote-control Phase 1a: スマホ遠隔操作（実験的機能）。既定 OFF ＝ サーバを一切起動しない
    //   ＝現行と完全同一（後方互換）。ON にした時だけ main が LAN サーバを起動する。
    remoteControl: { enabled: false },
    // 外部DB連携 STEP2-K1: 連携先(店舗アプリのサーバー)設定。既定=未設定（url/storeKey 空）
    //   ＝外部接続を一切しない。links = PC 側トーナメント id → 紐づけ対応表1行（K1 では保持のみ・送信なし）。
    //   ※ tournaments 配列の要素には持たせない（normalizeTournament が未知キーを落とすため隔離保存）。
    dbLink: { url: '', storeKey: '', links: {} }
  }
});

// ===== v2.5.0: 画像専用ストア（tournament-bloat 根治）=====
// 背景画像 / 休憩スライドショーの base64 を tournaments 配列から分離し、別ファイル
// tournament-images.json に保持する。毎秒 tournaments:list・毎操作の全件書込から画像を外し、
// config.json を 62KB 級に保つ（重さの根治）。画像はローカル専用（PC 間で引き継がない）。
const imagesStore = new Store({ name: 'tournament-images', defaults: {} });

// 画像取得（無ければ空）。返り値は常に { backgroundImage: string, breakImages: string[] }。
function getTournamentImages(id) {
  if (typeof id !== 'string' || !id) return { backgroundImage: '', breakImages: [] };
  const rec = imagesStore.get(id) || {};
  const sanImage = sanitizeBackgroundImage(rec.backgroundImage, '');
  return {
    backgroundImage: (sanImage === null) ? '' : sanImage,
    breakImages: sanitizeBreakImages(rec.breakImages, [])
  };
}

// 画像部分更新（backgroundImage / breakImages のうち渡されたものだけ更新）。
//   両方とも空になったらキーごと削除して tournament-images.json を最小化。
function setTournamentImages(id, patch) {
  if (typeof id !== 'string' || !id) return;
  const cur = imagesStore.get(id) || {};
  const next = {
    backgroundImage: (typeof cur.backgroundImage === 'string') ? cur.backgroundImage : '',
    breakImages: Array.isArray(cur.breakImages) ? cur.breakImages : []
  };
  if (patch && 'backgroundImage' in patch) {
    const s = sanitizeBackgroundImage(patch.backgroundImage, cur.backgroundImage || '');
    next.backgroundImage = (s === null) ? (cur.backgroundImage || '') : s;
  }
  if (patch && 'breakImages' in patch) {
    next.breakImages = sanitizeBreakImages(patch.breakImages, cur.breakImages || []);
  }
  if (!next.backgroundImage && next.breakImages.length === 0) {
    imagesStore.delete(id);
  } else {
    imagesStore.set(id, next);
  }
}

function deleteTournamentImages(id) {
  if (typeof id !== 'string' || !id) return;
  imagesStore.delete(id);
}

// displaySettings（image-free）に imagesStore の画像を再マージして返す。
//   getActive / setActive / save の戻り値・hall への broadcast で使用（applyTournament 経路を無改造で動かす）。
function mergeImagesIntoDisplaySettings(id, baseDs) {
  const img = getTournamentImages(id);
  return { ...(baseDs || {}), backgroundImage: img.backgroundImage, breakImages: img.breakImages };
}

// v2.5.0: 画像分離 migration（起動時 1 回・冪等）。inline 画像を imagesStore へ移し tournaments から strip。
//   ① backup → ② imagesStore へ移行 → ③ 枚数・バイト一致検証 → ④ OK のみ strip → ⑤ 冪等フラグ。
//   検証不一致 / backup 失敗は strip せず中断（フラグ立てず次回再試行）。runtime 等は保持。
function migrateTournamentImages(s) {
  try {
    if (s.get('imageSplitMigrated')) return;
    const list = s.get('tournaments') || [];
    // 移行前の画像実数（検証用）
    let srcCount = 0, srcBytes = 0;
    for (const t of list) {
      const ds = (t && t.displaySettings) || {};
      if (typeof ds.backgroundImage === 'string' && ds.backgroundImage) { srcCount += 1; srcBytes += ds.backgroundImage.length; }
      if (Array.isArray(ds.breakImages)) for (const im of ds.breakImages) if (typeof im === 'string' && im) { srcCount += 1; srcBytes += im.length; }
    }
    // backup（既存ならスキップ）
    try {
      const userData = app.getPath('userData');
      const cfgPath = path.join(userData, 'config.json');
      const backupPath = path.join(userData, 'config.pre-image-split.backup.json');
      if (fs.existsSync(cfgPath) && !fs.existsSync(backupPath)) {
        fs.copyFileSync(cfgPath, backupPath);
      }
    } catch (e) {
      console.error('[image-split] backup 失敗、移行中断:', e && e.message);
      return;
    }
    // 移行: imagesStore へ書込
    let dstCount = 0, dstBytes = 0;
    for (const t of list) {
      const id = t && t.id;
      const ds = (t && t.displaySettings) || {};
      const bg = (typeof ds.backgroundImage === 'string') ? ds.backgroundImage : '';
      const brk = Array.isArray(ds.breakImages) ? ds.breakImages.filter((im) => typeof im === 'string' && im) : [];
      if (!id) continue;
      if (bg || brk.length > 0) {
        imagesStore.set(id, { backgroundImage: bg, breakImages: brk });
        if (bg) { dstCount += 1; dstBytes += bg.length; }
        for (const im of brk) { dstCount += 1; dstBytes += im.length; }
      }
    }
    // 検証（移行漏れ / 破損があれば strip しない）
    if (dstCount !== srcCount || dstBytes !== srcBytes) {
      console.error(`[image-split] 検証不一致 src(${srcCount}/${srcBytes}) != dst(${dstCount}/${dstBytes})、strip 中断`);
      return;  // フラグ立てない（次回再試行）
    }
    // strip（runtime 等は保持、displaySettings から画像 2 フィールドのみ除去）
    const stripped = list.map((t) => {
      const ds = (t && t.displaySettings) || {};
      const nextDs = { ...ds };
      delete nextDs.backgroundImage;
      delete nextDs.breakImages;
      return { ...t, displaySettings: nextDs };
    });
    s.set('tournaments', stripped);
    s.set('imageSplitMigrated', true);
    console.log(`[image-split] 移行完了: ${dstCount} 枚 / ${dstBytes} bytes を tournament-images.json へ分離`);
  } catch (e) {
    console.error('[image-split] migration 例外:', e && e.message);
  }
}

// 旧 `tournament` キー（単一）が残っていれば配列構造へマイグレーション。
// 既に tournaments が入っていれば触らない（多重実行安全）。
function migrateTournament(s) {
  const oldT = s.get('tournament');
  const tournaments = s.get('tournaments');
  if (oldT && (!tournaments || tournaments.length === 0)) {
    const id = (typeof oldT.id === 'string' && oldT.id) ? oldT.id : `tournament-${Date.now()}`;
    const migrated = {
      id,
      name: oldT.title || oldT.name || 'ポーカートーナメント',
      subtitle: oldT.subtitle || '',
      currencySymbol: oldT.currencySymbol || '$',
      blindPresetId: oldT.blindPresetId || 'demo-fast'
    };
    s.set('tournaments', [migrated]);
    s.set('activeTournamentId', id);
    s.delete('tournament');
  }
}
migrateTournament(store);
// v2.5.0: 画像分離 migration は schema migration より前に実行（生の inline 画像を読むため）
migrateTournamentImages(store);

// STEP 6: 既存トーナメントに新規フィールドのデフォルト値を充填
function migrateTournamentSchema(s) {
  const list = s.get('tournaments') || [];
  let changed = false;
  let filledTimerState = 0;       // STEP 6.21: timerState 補完件数（ログ用）
  let filledDisplaySettings = 0;  // STEP 6.21.6: displaySettings 補完件数（ログ用）
  let intermediatePoolRateCount = 0; // v2.6.0: 中間%（0/100以外）の項目数（poolRate→POT 変換で数値ズレ可能性の監査ログ）
  let filledMarqueeSettings = 0;  // STEP 6.22.1: marqueeSettings 補完件数（ログ用）
  const globalDisplay = s.get('display') || {};
  const fallbackDisplay = {
    background: VALID_BACKGROUNDS.includes(globalDisplay.background) ? globalDisplay.background : 'navy',
    timerFont:  VALID_TIMER_FONTS.includes(globalDisplay.timerFont)   ? globalDisplay.timerFont  : 'jetbrains',
    backgroundOverlay: VALID_BG_OVERLAYS.includes(globalDisplay.backgroundOverlay) ? globalDisplay.backgroundOverlay : 'mid',
    // v2.5.0: backgroundImage / breakImages は tournament-images.json へ分離（tournament displaySettings は image-free）
    breakImageInterval: sanitizeBreakImageInterval(globalDisplay.breakImageInterval, 10),
    pipSize: sanitizePipSize(globalDisplay.pipSize, 'medium')
  };
  // STEP 6.22.1: テロップのフォールバック値はグローバル marquee から都度算出（ループ前 1 回のみ）
  const fallbackMarquee = sanitizeMarqueeSettings(s.get('marquee'), null);
  const next = list.map((t) => {
    const m = { ...t };
    let touched = false;
    if (typeof m.startingStack !== 'number') { m.startingStack = DEFAULT_TOURNAMENT_EXT.startingStack; touched = true; }
    if (!m.buyIn  || typeof m.buyIn  !== 'object') { m.buyIn  = { ...DEFAULT_TOURNAMENT_EXT.buyIn  }; touched = true; }
    // stack-unify（2026-06-08）: 初期スタックを buyIn.chips に統一。未 unified の各トーナメントに
    //   buyIn.chips := startingStack（旧 AVG STACK が使っていた値）を一度きり設定 → 移行後も AVG STACK
    //   数値を完全保全。startingStack は dormant 温存（削除しない＝downgrade ロールバック安全）。
    //   marker stackModel='unified' で再変換しない（後続のスタック編集を巻き戻さない）。
    //   旧形式 export の import は normalizeTournament 側の同 gated ブロックで unify。
    if (m.stackModel !== 'unified') {
      m.buyIn.chips = Number(m.startingStack) || 0;
      m.stackModel = 'unified';
      touched = true;
    }
    // STEP 6.9: rebuy → reentry リネーム（旧データ存在時は移行 + 旧キー削除）
    if (m.rebuy && typeof m.rebuy === 'object' && !m.reentry) {
      m.reentry = { fee: m.rebuy.fee || 0, chips: m.rebuy.chips || 0 };
      delete m.rebuy;
      touched = true;
    } else if (m.rebuy) {
      // reentry が既に存在 → rebuy は廃棄
      delete m.rebuy;
      touched = true;
    }
    if (!m.reentry || typeof m.reentry !== 'object') { m.reentry = { ...DEFAULT_TOURNAMENT_EXT.reentry }; touched = true; }
    if (!m.addOn  || typeof m.addOn  !== 'object') { m.addOn  = { ...DEFAULT_TOURNAMENT_EXT.addOn  }; touched = true; }
    if (!Array.isArray(m.payouts) || m.payouts.length === 0) {
      m.payouts = DEFAULT_TOURNAMENT_EXT.payouts.map((p) => ({ ...p }));
      touched = true;
    }
    // v2.5.2: payoutMode 補完（既存トーナメント）。amount 全ランク保持 → 'amount'（固定）、
    //   それ以外 → 'percent'（プール比例、既存挙動維持）。TOTAL POOL 総額は変えない。
    if (m.payoutMode !== 'amount' && m.payoutMode !== 'percent') {
      const allHaveAmount = Array.isArray(m.payouts) && m.payouts.length > 0
        && m.payouts.every((p) => p && Number.isFinite(Number(p.amount)) && Number(p.amount) >= 0);
      m.payoutMode = allHaveAmount ? 'amount' : 'percent';
      touched = true;
    }
    if (typeof m.gameType !== 'string' || !VALID_GAME_TYPES.includes(m.gameType)) {
      m.gameType = DEFAULT_TOURNAMENT_EXT.gameType;
      touched = true;
    }
    if (typeof m.guarantee !== 'number' || m.guarantee < 0) {
      m.guarantee = DEFAULT_TOURNAMENT_EXT.guarantee;
      touched = true;
    }
    if (typeof m.payoutRounding !== 'number' || !VALID_PAYOUT_ROUNDINGS.includes(m.payoutRounding)) {
      m.payoutRounding = DEFAULT_TOURNAMENT_EXT.payoutRounding;
      touched = true;
    }
    // STEP 6.7: prizeCategory のマイグレーション（既存トーナメントには空文字を補完）
    if (typeof m.prizeCategory !== 'string') {
      m.prizeCategory = '';
      touched = true;
    }
    // STEP 6.8: 旧 allowedUntilLevel / allowedAtBreak は廃止（運用柔軟性のため削除）
    if (m.reentry && 'allowedUntilLevel' in m.reentry) {
      const next = { fee: m.reentry.fee, chips: m.reentry.chips };
      m.reentry = next;
      touched = true;
    }
    if (m.addOn && 'allowedAtBreak' in m.addOn) {
      const next = { fee: m.addOn.fee, chips: m.addOn.chips };
      m.addOn = next;
      touched = true;
    }
    // STEP 6.17: titleColor 補完
    if (typeof m.titleColor !== 'string' || !TITLE_COLOR_RE.test(m.titleColor)) {
      m.titleColor = '#FFFFFF';
      touched = true;
    }
    // STEP 6.9: specialStack 補完
    if (!m.specialStack || typeof m.specialStack !== 'object') {
      m.specialStack = { ...DEFAULT_TOURNAMENT_EXT.specialStack };
      touched = true;
    } else {
      const ss = m.specialStack;
      const next = {
        enabled: typeof ss.enabled === 'boolean' ? ss.enabled : false,
        label: typeof ss.label === 'string' ? ss.label.slice(0, 20) : '早期着席特典',
        chips: (typeof ss.chips === 'number' && ss.chips >= 0) ? ss.chips : 5000,
        appliedCount: (typeof ss.appliedCount === 'number' && ss.appliedCount >= 0) ? Math.floor(ss.appliedCount) : 0
      };
      // 何か違っていたら差し替え
      if (next.enabled !== ss.enabled || next.label !== ss.label || next.chips !== ss.chips || next.appliedCount !== ss.appliedCount) {
        m.specialStack = next;
        touched = true;
      }
    }
    // v2.4.0: poolRates 補完（既存トーナメントには poolRates 不在 → 既存挙動完全維持のため 100% で補完）
    //   §11.2 解釈 B 採用（既存 100%、新規 0%）。
    //   新規作成経路は tournaments:save → normalizeTournament の既定補完が appConfig.poolRatesDefault を読む。
    if (!m.poolRates || typeof m.poolRates !== 'object') {
      m.poolRates = { ...DEFAULT_TOURNAMENT_EXT.poolRates };  // = { buyIn: 100, reentry: 100, addOn: 100 }
      touched = true;
    } else {
      const before = JSON.stringify(m.poolRates);
      const fixed = sanitizePoolRates(m.poolRates, DEFAULT_TOURNAMENT_EXT.poolRates);
      if (JSON.stringify(fixed) !== before) {
        m.poolRates = fixed;
        touched = true;
      }
    }
    // v2.6.0: poolRates%（旧）→ potAmounts$（新）へ一度だけ変換（POT = round(fee × poolRate / 100)）。
    //   poolRate 100%（既存支配ケース）→ POT=fee 数値厳密一致 / 0%→0 ＝ TOTAL POOL 数値不変（v2.4.0 不変条件維持）。
    //   旧 poolRates は削除せず温存（dormant、ロールバック可）。pool 計算は今後 potAmounts のみ参照。
    if (!m.potAmounts || typeof m.potAmounts !== 'object') {
      const feeOf = (o) => (o && typeof o === 'object' && Number.isFinite(Number(o.fee))) ? Number(o.fee) : 0;
      const rate = m.poolRates || {};
      // 中間%（0/100 以外）の検出 → 数値ズレ可能性を集計ログ（v2.4.0 不変条件の実データ監査用）
      for (const k of ['buyIn', 'reentry', 'addOn']) {
        const rv = Number(rate[k]);
        if (rv !== 0 && rv !== 100) intermediatePoolRateCount += 1;
      }
      m.potAmounts = {
        buyIn:   sanitizePotAmount(Math.round(feeOf(m.buyIn)   * (Number(rate.buyIn)   || 0) / 100)),
        reentry: sanitizePotAmount(Math.round(feeOf(m.reentry) * (Number(rate.reentry) || 0) / 100)),
        addOn:   sanitizePotAmount(Math.round(feeOf(m.addOn)   * (Number(rate.addOn)   || 0) / 100))
      };
      touched = true;
    } else {
      const before = JSON.stringify(m.potAmounts);
      const fixed = sanitizePotAmounts(m.potAmounts, DEFAULT_TOURNAMENT_EXT.potAmounts);
      if (JSON.stringify(fixed) !== before) {
        m.potAmounts = fixed;
        touched = true;
      }
    }
    // v2.6.0: 通貨記号を店内通貨 $ へ読み替え。リテラル '¥'（既定値）のみ置換し、カスタム記号は不可侵。
    //   TOTAL POOL 等の数値は不変（表示記号のみの変更、前原承認済の店内通貨表示）。
    if (m.currencySymbol === '¥') {
      m.currencySymbol = '$';
      touched = true;
    }
    // STEP 10 フェーズC.1.8: runtime 補完（旧バージョンデータには runtime フィールドなし）
    if (!m.runtime || typeof m.runtime !== 'object') {
      m.runtime = { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 };
      touched = true;
    } else {
      const before = JSON.stringify(m.runtime);
      const fixed = sanitizeRuntime(m.runtime, { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 });
      if (JSON.stringify(fixed) !== before) {
        m.runtime = fixed;
        touched = true;
      }
    }
    // STEP 6.21: timerState 補完（無い・status enum 外なら新規デフォルトに置換）
    if (!m.timerState || typeof m.timerState !== 'object'
        || !VALID_TIMER_STATUS.includes(m.timerState.status)) {
      m.timerState = { status: 'idle', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: null };
      touched = true;
      filledTimerState += 1;
    } else {
      const before = JSON.stringify(m.timerState);
      const after = normalizeTimerState(m.timerState);
      if (JSON.stringify(after) !== before) {
        m.timerState = after;
        touched = true;
      }
    }
    // STEP 6.21.6: displaySettings 補完（既存件はグローバル現値でコピー初期化）
    if (!m.displaySettings || typeof m.displaySettings !== 'object') {
      m.displaySettings = { ...fallbackDisplay };
      touched = true;
      filledDisplaySettings += 1;
    } else {
      const ds = m.displaySettings;
      // v2.5.0: 画像 2 フィールド（backgroundImage / breakImages）は migrateTournamentImages で imagesStore へ分離済。
      //   ここでは非画像フィールドのみ正規化し、万一画像フィールドが残存していても（migration abort 時の保険）保持する。
      const fixed = {
        background: VALID_BACKGROUNDS.includes(ds.background) ? ds.background : fallbackDisplay.background,
        timerFont:  VALID_TIMER_FONTS.includes(ds.timerFont)   ? ds.timerFont  : fallbackDisplay.timerFont,
        backgroundOverlay: sanitizeBackgroundOverlay(ds.backgroundOverlay, fallbackDisplay.backgroundOverlay),
        breakImageInterval: sanitizeBreakImageInterval(ds.breakImageInterval, fallbackDisplay.breakImageInterval),
        pipSize: sanitizePipSize(ds.pipSize, fallbackDisplay.pipSize)
      };
      if (fixed.background !== ds.background || fixed.timerFont !== ds.timerFont
          || fixed.backgroundOverlay !== ds.backgroundOverlay
          || fixed.breakImageInterval !== ds.breakImageInterval
          || fixed.pipSize !== ds.pipSize) {
        m.displaySettings = { ...ds, ...fixed };  // 既存の画像フィールド（あれば）を保持してマージ
        touched = true;
      }
    }
    // STEP 6.22.1: marqueeSettings 補完（既存件はグローバル現値でコピー初期化）
    if (!m.marqueeSettings || typeof m.marqueeSettings !== 'object') {
      m.marqueeSettings = { ...fallbackMarquee };
      touched = true;
      filledMarqueeSettings += 1;
    } else {
      const fixed = sanitizeMarqueeSettings(m.marqueeSettings, fallbackMarquee);
      // v2.1.0 Fix 6 (M9 Edge-4) NOTE: JSON.stringify 比較はキー順依存。将来 displaySettings 等の
      //   schema 拡張時はキー順を維持するか、L766-770 の field-by-field 比較に置換すること（誤検知防止）
      if (JSON.stringify(fixed) !== JSON.stringify(m.marqueeSettings)) {
        m.marqueeSettings = fixed;
        touched = true;
      }
    }
    if (touched) changed = true;
    return m;
  });
  if (filledTimerState > 0) {
    console.log(`[STEP 6.21] timerState 補完: ${filledTimerState}/${list.length} 件`);
  }
  if (filledDisplaySettings > 0) {
    console.log(`[STEP 6.21.6] displaySettings 補完: ${filledDisplaySettings}/${list.length} 件 (fallback=${JSON.stringify(fallbackDisplay)})`);
  }
  if (filledMarqueeSettings > 0) {
    console.log(`[STEP 6.22.1] marqueeSettings 補完: ${filledMarqueeSettings}/${list.length} 件 (fallback=${JSON.stringify(fallbackMarquee)})`);
  }
  // v2.6.0: poolRate→POT 変換の数値ズレ監査。中間%（0/100以外）があれば POT=round(fee×%/100) で ≤数円ズレうる
  //   → 前原承認・report 明記用に件数を必ずログ。0 件なら全件 TOTAL POOL 数値厳密一致（v2.4.0 不変条件維持）。
  console.log(`[v2.6.0] poolRate→POT 変換: 中間%(0/100以外)の項目数 = ${intermediatePoolRateCount}/${list.length}件 (0 なら TOTAL POOL 数値厳密一致)`);
  if (changed) s.set('tournaments', next);
}
migrateTournamentSchema(store);

// STEP 10 フェーズA: gameType を新コードに正規化
//   旧 'NLHE' / 'PLO' / 'NLO8' / 'Stud' / 'Mixed' / 'Other' → 新 'nlh' / 'plo' / 'plo8' / 'stud' / 'nlh' / 'nlh'
//   既に新コードのトーナメントは無変換でスキップ。
//   levels フィールド名のリネームはフェーズB で実施（このフェーズでは触らない）。
function migrateTournamentSchema_v2(s) {
  const list = s.get('tournaments') || [];
  let migratedCount = 0;
  const next = list.map((t) => {
    const newGameType = normalizeGameType(t.gameType);
    if (newGameType !== t.gameType) {
      migratedCount += 1;
      return { ...t, gameType: newGameType };
    }
    return t;
  });
  if (migratedCount > 0) {
    s.set('tournaments', next);
    console.log(`[STEP 10] gameType migrated to new codes: ${migratedCount}/${list.length} 件`);
  }
}
migrateTournamentSchema_v2(store);

// STEP 10 フェーズB: userPresets を v2 形式へマイグレーション（structureType 補完 + フィールドリネーム）
//   関数定義は後方（isValidPreset 直後）に存在するが、関数宣言は巻き上げにより呼び出し可能。
//   ※ migrateTournamentSchema_v2 の直後、venueName より前で実行。
migrateUserPresets_v2(store);

// STEP 6.22: venueName の初期化・サニタイズ
function migrateVenueName(s) {
  const v = s.get('venueName');
  if (typeof v !== 'string') {
    s.set('venueName', '');
    return;
  }
  const cleaned = sanitizeVenueName(v);
  // sanitize が null（不正）or 元値と異なる（trim 等で変化）なら正規化
  if (cleaned === null) {
    s.set('venueName', '');
  } else if (cleaned !== v) {
    s.set('venueName', cleaned);
  }
}
migrateVenueName(store);

// STEP 9-B: logo フィールドの初期化・正規化
//   既存ストアに logo キーが無い、または kind が enum 外なら placeholder にリセット
const VALID_LOGO_KINDS = ['placeholder', 'plus2', 'custom'];
function migrateLogo(s) {
  const cur = s.get('logo');
  if (!cur || typeof cur !== 'object' || !VALID_LOGO_KINDS.includes(cur.kind)) {
    s.set('logo', { kind: 'placeholder', customPath: null });
    return;
  }
  // custom かつ customPath が文字列でなければ placeholder にフォールバック（壊れたデータ救済）
  if (cur.kind === 'custom' && (typeof cur.customPath !== 'string' || !cur.customPath)) {
    s.set('logo', { kind: 'placeholder', customPath: null });
    return;
  }
  // custom かつファイル実体が消えている場合も placeholder に戻す（手動削除等を救済）
  if (cur.kind === 'custom' && !fs.existsSync(cur.customPath)) {
    s.set('logo', { kind: 'placeholder', customPath: null });
  }
}
migrateLogo(store);

// 旧 'major' フォントを STEP 4 仕上げ④ で廃止 → 'jetbrains' へマイグレーション
function migrateTimerFont(s) {
  const display = s.get('display') || {};
  if (display.timerFont && !VALID_TIMER_FONTS.includes(display.timerFont)) {
    s.set('display', { ...display, timerFont: 'jetbrains' });
  }
}
migrateTimerFont(store);

// 同梱プリセット一覧（src/presets/*.json）。順序がドロップダウン表示順
// STEP 10 フェーズB.fix5: structureType を明示。listBuiltin / 構造型フィルタで参照される。
const BUILTIN_PRESETS = [
  { id: 'demo-fast',         name: 'デモ用ファスト構造',          file: 'demo-fast.json',         structureType: 'BLIND' },
  { id: 'preset-turbo',      name: 'ターボ（短時間決着）',        file: 'turbo.json',             structureType: 'BLIND' },
  { id: 'preset-regular',    name: 'レギュラー（標準）',          file: 'regular.json',           structureType: 'BLIND' },
  { id: 'preset-deep',       name: 'ディープ（じっくり進行）',    file: 'deep.json',              structureType: 'BLIND' },
  // STEP 10 フェーズB.fix5: 構造型ごとの同梱フォーマット
  { id: 'limit-regular',     name: 'Limit 標準',                  file: 'limit-regular.json',     structureType: 'LIMIT_BLIND' },
  { id: 'shortdeck-regular', name: 'Short Deck 標準',             file: 'shortdeck-regular.json', structureType: 'SHORT_DECK' },
  { id: 'stud-regular',      name: 'Stud 標準',                   file: 'stud-regular.json',      structureType: 'STUD' },
  // STEP 10 フェーズC.2.3: MIX 用同梱フォーマット（10-Game ローテーション）
  { id: 'mix-regular',       name: 'MIX 標準（10-Game）',         file: 'mix-regular.json',       structureType: 'MIX' }
];

function loadBuiltinPresetById(id) {
  const meta = BUILTIN_PRESETS.find((p) => p.id === id);
  if (!meta) return null;
  const filePath = path.join(__dirname, 'presets', meta.file);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`同梱プリセット読込失敗 (${id}):`, err);
    return null;
  }
}

// ユーザープリセットの最小バリデーション
// STEP 10 フェーズB: structureType を考慮、各構造型のフィールドリストで検証。
//   structureType が無いプリセットは BLIND として扱う（フェーズB マイグレーションで補完済み想定）。
function isValidPreset(p) {
  if (!p || typeof p !== 'object') return false;
  if (typeof p.id !== 'string' || !p.id) return false;
  if (typeof p.name !== 'string' || !p.name) return false;
  if (!Array.isArray(p.levels) || p.levels.length === 0) return false;
  const structureType = (typeof p.structureType === 'string' && STRUCTURE_TYPES[p.structureType])
    ? p.structureType
    : 'BLIND';
  const fields = getStructureFields(structureType);
  // v2.1.0 Fix 5 (M11 Edge-8): renderer 側 validateStructure と整合性を保つため通常レベル件数を追跡
  let regularLevelCount = 0;
  for (const lv of p.levels) {
    if (!lv || typeof lv !== 'object') return false;
    if (typeof lv.durationMinutes !== 'number' || lv.durationMinutes <= 0) return false;
    if (lv.isBreak === true) {
      // ブレイクは label のみ任意。構造型のフィールドは不問
      continue;
    }
    regularLevelCount += 1;
    for (const f of fields) {
      if (typeof lv[f] !== 'number' || lv[f] < 0) return false;
    }
  }
  // v2.1.0 Fix 5 (M11 Edge-8): 通常レベル 0 件は renderer 側 validateStructure で reject されるため main 側でも一致
  if (regularLevelCount === 0) return false;
  return true;
}

// STEP 10 フェーズB: 旧フィールド名（smallBlind/bigBlind/ante）→ 新フィールド名（sb/bb/bbAnte）への
//   レベル単位コンバート。BLIND 型のみ対応（他構造型は新規作成のため変換不要）。
//   isBreak 行は対象外。
function convertLegacyBlindLevel(lv) {
  if (!lv || typeof lv !== 'object' || lv.isBreak === true) return lv;
  // 既に新フィールド名なら無変換
  if (typeof lv.sb === 'number' || typeof lv.bb === 'number' || typeof lv.bbAnte === 'number') {
    return lv;
  }
  const next = { ...lv };
  if (typeof next.smallBlind === 'number') { next.sb = next.smallBlind; delete next.smallBlind; }
  if (typeof next.bigBlind   === 'number') { next.bb = next.bigBlind;   delete next.bigBlind; }
  if (typeof next.ante       === 'number') { next.bbAnte = next.ante;   delete next.ante; }
  return next;
}

// userPresets を v2 形式へマイグレーション:
//   - structureType 未設定なら 'BLIND' を補完
//   - levels の旧フィールド名（smallBlind/bigBlind/ante）を新（sb/bb/bbAnte）にリネーム
function migrateUserPresets_v2(s) {
  const list = s.get('userPresets') || [];
  let migratedCount = 0;
  const next = list.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const needsStructure = typeof p.structureType !== 'string' || !STRUCTURE_TYPES[p.structureType];
    const newLevels = Array.isArray(p.levels) ? p.levels.map(convertLegacyBlindLevel) : [];
    const levelsChanged = newLevels.some((lv, i) => lv !== p.levels[i]);
    if (needsStructure || levelsChanged) {
      migratedCount += 1;
      return { ...p, structureType: needsStructure ? 'BLIND' : p.structureType, levels: newLevels };
    }
    return p;
  });
  if (migratedCount > 0) {
    s.set('userPresets', next);
    console.log(`[STEP 10] userPresets migrated to v2: ${migratedCount}/${list.length} 件`);
  }
}

let mainWindow = null;
// v2.0.0 STEP 1: ホール側ウィンドウ（HDMI 接続時のみ）。STEP 1 では参照のみ、STEP 3 で表示専用化、STEP 5 で抜き差し追従。
let hallWindow = null;

// v2.0.0 STEP 2: 2 画面間の状態同期キャッシュ。main プロセスを単一の真実源とし、
//   operator 側の操作 → store 更新 → cache 更新 → hall に差分 push の一方向フロー。
//   operator-solo（単画面）モードでは hallWindow が存在しないので broadcast は no-op、
//   v1.3.0 と完全同等の挙動を維持（後方互換不変条件）。
//   ポーリング禁止、必ずイベント駆動（既存ハンドラ末尾で _broadcastDualState を呼ぶ）。
//   注意: timerState は C.2.7-D Fix 3 の destructure 除外を踏襲、別 kind で送る。
const _dualStateCache = {
  timerState: null,        // { status, currentLevelIndex, ... }
  structure: null,         // { levels: [...] }（preset 適用 or save 時にキャッシュ）
  displaySettings: null,
  marqueeSettings: null,
  tournamentRuntime: null,
  tournamentBasics: null,  // { id, name, subtitle, titleColor, venueName, blindPresetId }
  audioSettings: null,
  logoUrl: null,
  venueName: null,
  // v2.0.4-rc10 Fix 1-A: Ctrl+E（特別スタック ±1）が hall に反映されない 3 重断絶を解消。
  //   _publishDualState は hasOwnProperty チェックで未登録 kind を早期 return するため、
  //   このキー追加が無いと publish が完全 no-op になる（rc10 事前調査 §2.3 確定真因）。
  specialStack: null,
  // v2.1.6: PRE_START（開始前カウントダウン）の hall 同期用 session state。
  //   v2.0.3 Fix L で PRE_START は永続化対象外（renderer.js:1271 で 'idle' 化）のため、
  //   timerState では届かない。専用 kind で session state として broadcast する。
  //   payload 形: { isActive: bool, totalMs?: number, remainingMs?: number, startAtMs?: number }
  preStartState: null
};
// v2.1.20-rc10.1: preStartState cache の最終更新時刻（rc10-audit #1 race 観測用、ms epoch）
let _preStartStateCacheUpdatedAt = 0;
function _broadcastDualState(channel, payload) {
  if (!hallWindow || hallWindow.isDestroyed()) return;
  try {
    hallWindow.webContents.send(channel, payload);
  } catch (_) { /* hall window may be in transition; ignore broadcast errors */ }
}
// _dualStateCache の特定 kind を更新 + 同 kind を hall に broadcast。
//   呼出側: 既存 IPC ハンドラの末尾で `_publishDualState('timerState', value)` のように使う。
//   差分送信のみ（all-state ポーリングは禁止、v2-dual-screen.md §1.3）。
function _publishDualState(kind, value) {
  if (!Object.prototype.hasOwnProperty.call(_dualStateCache, kind)) return;
  _dualStateCache[kind] = value;
  // v2.1.20-rc10.1: preStartState cache 更新時刻記録（rc10-audit #1 race 観測用）
  if (kind === 'preStartState') {
    _preStartStateCacheUpdatedAt = Date.now();
  }
  // v2.0.4-rc17: 常時 3 ラベル rolling ログ #1（timerState 送信 ts）
  if (kind === 'timerState') {
    try { rollingLog('timer:state:send', { status: value?.status, level: value?.currentLevel, elapsed: value?.elapsedSecondsInLevel }); } catch (_) { /* never throw from logging */ }
  }
  // v2.0.4-rc18 第 1 弾 タスク 4: 常時 2 ラベル追加（runtime / blindPreset 送信 ts）
  if (kind === 'tournamentRuntime') {
    try { rollingLog('runtime:state:send', { playersInitial: value?.playersInitial, playersRemaining: value?.playersRemaining, reentryCount: value?.reentryCount, addOnCount: value?.addOnCount }); } catch (_) { /* never throw from logging */ }
  }
  if (kind === 'tournamentBasics') {
    // v2.0.15 Fix 3（M2 Sec-4）: presetName を hashPII でハッシュ化（rolling-log 出力時のみ）
    try { rollingLog('blindPreset:state:send', { presetId: value?.blindPresetId, presetName: hashPII(value?.name), structureLength: value?.structure?.levels?.length || 0 }); } catch (_) { /* never throw from logging */ }
  }
  _broadcastDualState('dual:state-sync', { kind, value });
  // v2.1.20-rc5: preStartState だけは operator (mainWindow) にも送信する。
  //   _broadcastDualState は hall 限定送信のため、HDMI 抜き差し後の operator 再生成時に
  //   PRE_START 状態が消失して Space キーが IDLE 分岐に振られる（→ タイマースタートダイアログが開く）構造的問題を根治。
  //   他 kind（timerState 等）は operator 側で個別 IPC 経由で取得しているため対象外、preStartState のみ追加。
  if (kind === 'preStartState' && mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('dual:state-sync', { kind, value });
      try { rollingLog('preStart:operator:send', { isActive: value?.isActive, isPaused: !!value?.isPaused }); } catch (_) {}
    } catch (_) { /* operator may be in transition (reload after HDMI replug), ignore */ }
  }
}

// v2.0.0 STEP 1: 共通の webPreferences ベース（operator / hall で同一の Electron セキュリティ設定）。
//   既存 v1.3.0 の値をそのまま踏襲、追加するのは additionalArguments のみ。
function buildWebPreferences(role) {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    devTools: true,
    // perf-heaviness（2026-06-08）: 背面/最小化時の省電力化。
    //   true は 2 画面モードの手元制御窓 operator のみ。
    //   hall（会場表示）と operator-solo（単画面で会場表示を兼務／HDMI 抜き時に動的にこの role へ）は
    //   会場表示窓のカクつきを避けるため false 据置（review 2026-06-08 確定）。
    //   ※ Chromium の backgroundThrottling は window が hidden/minimized/occluded のときのみ
    //     rAF/timer を絞る（visible-but-unfocused では絞らない）→ 可視運用時は挙動完全不変。
    backgroundThrottling: role === 'operator',
    // v2.0.0 STEP 1: preload.js が process.argv から `--role=...` を抽出して
    //   document.documentElement に data-role 属性を付与する。CSP 不変、inline script 不要。
    // perf-heaviness: PERF_METRICS env 時のみ `--perf-metrics=1` も渡す（renderer rAF Hz 計測ゲート、本番無効）。
    additionalArguments: process.env.PERF_METRICS === '1'
      ? [`--role=${role}`, '--perf-metrics=1']
      : [`--role=${role}`]
  };
}

// v2.0.4-rc8 案 X: hall → operator のキーフォワードを完全無効化（最小変更）。
//   前原さん要望「会場モニターにフォーカスして使う操作は完全に無効にして、
//   手元 PC にフォーカスしないと動かない方がわかりやすい」を実現。
//   IPC 経路（before-input-event ハンドラ + hall:forwarded-key 送信 + preload / renderer 受信）は
//   rc8 では削除せず残す（dead code、将来再有効化が容易）。Set を空にすることで全 keydown が
//   line 1080 の `if (!FORWARD_KEYS_FROM_HALL.has(input.code)) return;` で早期 return される。
//   さらに rc8 Fix 2 で hallWindow に `focusable: false` を設定し、そもそも hall がフォーカスを
//   取れないようにする多重防御で「会場モニターでキーが効かない」を保証。
const FORWARD_KEYS_FROM_HALL = new Set([
  // 空 Set = forward 対象なし（rc4-rc7 の Space / Arrow×4 / KeyR/A/E/S/M/T/H は全廃止）
]);

// v2.0.0 STEP 1: operator ウィンドウ生成。
//   isSolo=true で role='operator-solo'（単画面モード、v1.3.0 と完全同等の見た目・挙動）。
//   isSolo=false で role='operator'（2 画面モードの PC 側、STEP 3 でホール側のみの要素を hide 化予定）。
function createOperatorWindow(targetDisplay, isSolo = false) {
  // v2.0.4-rc6 Fix 1-C: 既存 mainWindow が残存していれば防御的に close（多重発火経路の保険）
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow._suppressCloseConfirm = true; mainWindow.close(); } catch (_) { /* ignore */ }
  }
  mainWindow = null;
  const role = isSolo ? 'operator-solo' : 'operator';
  const opts = {
    title: WINDOW_TITLE,
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#0A1F3D',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: buildWebPreferences(role)
  };
  if (targetDisplay && targetDisplay.bounds) {
    opts.x = targetDisplay.bounds.x + 40;
    opts.y = targetDisplay.bounds.y + 40;
  }
  // v2.0.1: ウィンドウ参照 race 防止 — closed ハンドラで「自分自身がクローズした時だけ」mainWindow をクリア。
  //   旧実装では switchOperatorToSolo で window1 close → 新 window2 生成後に window1 の closed が遅延発火し、
  //   新 window2 への参照が誤って null 上書きされる race があった（v2.0.1 stabilization で発見）。
  const win = new BrowserWindow(opts);
  mainWindow = win;

  win.on('page-title-updated', (event) => {
    event.preventDefault();
  });
  win.setTitle(WINDOW_TITLE);

  // 外部リンク（target="_blank"）はデフォルトブラウザで開く（ハウス情報タブの効果音ラボリンク等）
  // Electron 22+ ではデフォルトで window.open は deny されるため、明示的に shell.openExternal を呼ぶ
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // STEP 6.21: F12 / Ctrl+Shift+I のフォールバック登録
  // globalShortcut.register('F12') がフォーカス都合で効かない環境向けの保険
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') {
      toggleDevTools();
      event.preventDefault();
      return;
    }
    if ((input.control || input.meta) && input.shift && input.key && input.key.toLowerCase() === 'i') {
      toggleDevTools();
      event.preventDefault();
    }
  });

  // v2.0.4-rc3: × ボタンで操作画面を閉じようとした時に確認ダイアログを表示。
  //   rc2 試験で「× で閉じると hall window だけ残って操作不能になる」致命的 UX バグを発見。
  //   モード切替（switchOperatorToSolo / switchSoloToOperator）と confirmQuit / app.quit 経由は
  //   `win._suppressCloseConfirm = true` をセットしてから close を呼ぶことで無音で通過する。
  //   operator-solo（v1.3.0 互換モード）でも適用 — 操作ミス防止は普遍的価値（仕様書記載）。
  // v2.0.4-rc9 Fix 2-C: rc6 で導入した解除時案内ポップアップ（_showRestoreNoticeOnce）は撤去。
  //   rc9 Fix 2-A で switchOperatorToSolo が show() による自動前面表示に変更され、
  //   minimize 経路自体が消滅したため案内ポップアップが不要になった。

  win._suppressCloseConfirm = false;
  win.on('close', (event) => {
    if (win._suppressCloseConfirm) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['アプリを終了', 'キャンセル'],
      defaultId: 1,
      cancelId: 1,
      title: '操作画面を閉じますか？',
      message: '操作画面を閉じるとアプリ全体が終了します。よろしいですか？'
    });
    if (choice === 0) {
      win._suppressCloseConfirm = true;
      app.quit();
    }
  });
  // v2.0.1: race 防止 — このウィンドウが「現在の mainWindow」である場合のみ null クリア
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
  return win;
}

// v2.0.0 STEP 1: hall ウィンドウ生成（最小骨格、STEP 3 で frame: false / fullscreen 等を追加）。
//   現状は operator と同じ index.html をロード、role='hall' のみ差別化。
//   状態同期は STEP 2 で実装。
// v2.0.4-rc2: ホール側は起動時に自動全画面化（rc1 試験で「普通のウィンドウサイズで開く + レイアウトはみ出し」
//   問題を確認。仮説: x/y で対象モニターに配置した上で fullscreen:true により当該モニター全画面化。
//   レイアウトは vw/vh 基準のため、画面いっぱいに広がれば想定通りのサイズに収まる）。
function createHallWindow(targetDisplay) {
  // v2.0.4-rc6 Fix 1-C: 既存 hallWindow が残存していれば防御的に close（orphan H2/H3 並行存在を防御）
  if (hallWindow && !hallWindow.isDestroyed()) {
    try { hallWindow.close(); } catch (_) { /* ignore */ }
  }
  hallWindow = null;
  const opts = {
    title: WINDOW_TITLE + ' (Hall)',
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    fullscreen: true,   // v2.0.4-rc2: 起動時に対象モニターで全画面化
    // v2.0.4-rc8 Fix 2: 会場モニターはフォーカス不可（手元 PC にフォーカスが残る）。
    //   focusable: false により hall ウィンドウをクリックしてもフォーカスが移らず、
    //   手元 PC（mainWindow）でキーボード操作が継続できる。FORWARD_KEYS_FROM_HALL 空 Set 化（Fix 1）と
    //   多重防御で「hall でキーが効かない」を保証。globalShortcut（F11 等）は webContents の
    //   フォーカス可否と無関係に動作するため影響なし。
    focusable: false,
    // v2.0.4-rc9 Fix 1-A: focusable:false が描画優先度を下げる Windows 挙動を回避するため、
    //   show:true を明示化 + paintWhenInitiallyHidden:true（webPreferences）で初期描画を保証。
    //   省電力スロットルは buildWebPreferences(role) 側で role 別に決定し、hall は据置（会場表示の
    //   カクつき回避、perf-heaviness 2026-06-08）。ここでは重複指定しない。
    show: true,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      ...buildWebPreferences('hall'),
      // v2.0.4-rc9 Fix 1-A: focusable:false 環境下でも初期 paint を即座に行う
      paintWhenInitiallyHidden: true
    }
  };
  if (targetDisplay && targetDisplay.bounds) {
    opts.x = targetDisplay.bounds.x + 40;
    opts.y = targetDisplay.bounds.y + 40;
  }
  // v2.0.1: ウィンドウ参照 race 防止（createOperatorWindow と同パターン）
  const win = new BrowserWindow(opts);
  hallWindow = win;
  win.on('page-title-updated', (event) => {
    event.preventDefault();
  });
  win.setTitle(WINDOW_TITLE + ' (Hall)');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // v2.0.4-rc4: hall にフォーカスがある状態で押された操作系キーを IPC 経由で operator に転送。
  //   rc3 sendInputEvent 方式の構造的制約（letter キーで event.code が空文字）を解消するため、
  //   論理キーオブジェクトを `hall:forwarded-key` チャネルで直接送る IPC 化を採用。
  //   operator 側 renderer は dispatchClockShortcut(eventLike) で同じ分岐を流用する。
  //   preventDefault で hall 自身は消化しない（二重発火防止）。
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (!FORWARD_KEYS_FROM_HALL.has(input.code)) return;
    event.preventDefault();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      mainWindow.webContents.send('hall:forwarded-key', {
        code: input.code,
        key: input.key,
        shift: input.shift,
        control: input.control,
        alt: input.alt,
        meta: input.meta
      });
    } catch (_) { /* mainWindow transition 中は黙って無視 */ }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // v2.0.4-rc2: 保険として ready-to-show 時にも setFullScreen(true) を再適用。
  //   一部の Windows 環境では BrowserWindow の opts.fullscreen が
  //   x/y と協調しないケースがあるため、対象ディスプレイでの全画面化を二重に保証。
  win.once('ready-to-show', () => {
    if (!win.isDestroyed() && !win.isFullScreen()) {
      win.setFullScreen(true);
    }
  });
  // v2.0.1: race 防止 — このウィンドウが「現在の hallWindow」である場合のみ null クリア
  win.on('closed', () => {
    if (hallWindow === win) {
      hallWindow = null;
    }
  });
  return win;
}

// v2.0.0 STEP 4: 2 画面検出時、ホール側にするモニターを起動時に毎回手動選択させる。
//   - displays.length < 2: 単画面 → null を返して呼出側で operator-solo 起動
//   - 選択完了: 該当 display.id を返す（store.preferredHallDisplayId に「次回参考用」として保存）
//   - キャンセル（ウィンドウを閉じる）: null を返す → 単画面モード（operator-solo）で起動
//   skills/v2-dual-screen.md §4.2 「起動ごとに毎回選択（記憶しない）」要件を満たす。
//   保存値は次回ダイアログのデフォルト選択（バッジ表示）にのみ使い、自動選択はしない。
async function chooseHallDisplayInteractive(displays) {
  if (!displays || displays.length < 2) return null;

  const lastSelected = store.get('preferredHallDisplayId') || null;

  return new Promise((resolve) => {
    const pickerWin = new BrowserWindow({
      width: 480,
      height: 360,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      title: 'PokerTimerPLUS+ — モニター選択',
      backgroundColor: '#0A1F3D',
      icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        additionalArguments: ['--role=picker']
      }
    });

    pickerWin.on('page-title-updated', (event) => event.preventDefault());
    pickerWin.setTitle('PokerTimerPLUS+ — モニター選択');
    // picker 内の「前回選択」用に lastSelected を渡す（fetchDisplays IPC で再取得）
    // picker → main の選択結果は ipcMain.on('dual:select-hall-monitor', ...) で受信
    let resolved = false;
    const handler = (_event, displayId) => {
      if (resolved) return;
      resolved = true;
      ipcMain.removeListener('dual:select-hall-monitor', handler);
      if (typeof displayId === 'number' || typeof displayId === 'string') {
        store.set('preferredHallDisplayId', displayId);
        resolve(displayId);
      } else {
        resolve(null);
      }
      if (!pickerWin.isDestroyed()) pickerWin.close();
    };
    ipcMain.on('dual:select-hall-monitor', handler);

    pickerWin.on('closed', () => {
      ipcMain.removeListener('dual:select-hall-monitor', handler);
      if (!resolved) {
        resolved = true;
        resolve(null);   // キャンセル相当
      }
    });

    pickerWin.loadFile(path.join(__dirname, 'renderer', 'display-picker.html'));
  });
}

// v2.0.0 STEP 5: HDMI 抜き → 単画面モードに統合。
//   - hallWindow が抜けた display 上にあった場合に呼ばれる
//   - operator (mainWindow) を close → operator-solo モードで再生成
//   - additionalArguments は process.argv に乗るため reload では role 変更不可、再生成必須
//   - タイマー進行は main プロセスで持続（store の timerState）、新ウィンドウは起動時 subscribe で復元
// v2.0.4-rc6 Fix 1-A: モード切替の再入ガード（display-added / -removed の同時多発に対応）
let _isSwitchingMode = false;

// v2.0.4-rc6 Fix 2-A: HDMI 切断時は operator を close せず保持（前原さん要望）。
//   旧実装は close → createOperatorWindow(_, true) で operator-solo 役割に動的切替していたが、
//   close 完了が非同期で「手元 PC が裏に残って見える」race の元だった。Fix 2 で:
//     - operator は close せず保持 → race が原理的に消滅
//     - role='operator' を IPC 経由で 'operator-solo' に動的切替（rc7）
//   これにより operator-solo 動的切替は廃止。最初から HDMI なし起動の v1.3.0 互換 operator-solo は
//   従来通り createOperatorWindow(_, true) で起動するため影響なし。
// v2.0.4-rc9 Fix 2-A: minimize を完全廃止し、show() + focus() で即時前面表示に変更。
//   rc6/rc8 の minimize 方式では、minimize 中に届いた IPC（dual:role-changed 等）が
//   描画キューで遅延し、ユーザーが手動復元した時点で「タイマー画面（.clock）が見えず、
//   手元 PC ペイン（.operator-pane）の枠だけ残る」症状が発生していた（前原さん観察）。
//   show() で即時前面表示にすれば role 切替 IPC も即時反映され、症状が根治する。
//   close ではなく show なので race ゼロは維持。Fix 2-C で _showRestoreNoticeOnce ポップアップも撤去。
async function switchOperatorToSolo() {
  // v2.1.20-rc10.1 観測: 関数所要時間計測（autoUpdater 等の Win32 メッセージループ遮断 race 検出用）
  const _switchStartTimeMs = Date.now();
  rollingLog('switchOperatorToSolo:enter', { isSwitchingMode: _isSwitchingMode });
  if (_isSwitchingMode) return;
  _isSwitchingMode = true;
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // hall 側だけ閉じる（operator は保持）
    if (hallWindow && !hallWindow.isDestroyed()) {
      try { hallWindow.close(); } catch (_) { /* ignore */ }
      hallWindow = null;
    }
    // v2.0.4-rc10 Fix 2-A (B-1): show の「前」に role 切替 IPC を 1 回送信。
    //   show 直後の初期 paint タイミングで data-role が 'operator' のままだと
    //   `[data-role="operator"] .clock { display: none !important }` が当たり続ける可能性
    //   （rc10 事前調査 §3.4 候補 B-α）。show 前にも IPC を送って初期描画タイミングを保証。
    //   後段の従来送信（show 後）と二重送信になるが idempotent なので無害。
    try { mainWindow.webContents.send('dual:role-changed', 'operator-solo'); } catch (_) { /* ignore */ }
    // v2.0.4-rc10 Fix 2-B (B-2): app.focus({ steal: true }) で前面化保険。
    //   hall close 直後に Windows OS が app 全体の focus を失う事例が Electron Issue で報告されており、
    //   mainWindow.focus() 単独では前面化しないケースの保険（rc10 事前調査 §3.4 候補 B-γ）。
    try { app.focus({ steal: true }); } catch (_) { /* ignore */ }
    // v2.0.4-rc9 Fix 2-A: minimize → show + focus（自動復元）
    try { mainWindow.show(); } catch (_) { /* ignore */ }
    try { mainWindow.focus(); } catch (_) { /* ignore */ }
    // v2.0.4-rc7 Fix 1-A: renderer の role を 'operator-solo' に動的切替して
    //   表示踏襲問題（rc6: minimize 後も data-role="operator" が持続して 2 画面用 CSS が
    //   単画面状態のデータを描画する）を解消。ウィンドウ生成は伴わないため race ゼロ。
    //   v2.0.4-rc10 Fix 2-A: 上の show 前送信と合わせて二重送信、idempotent で無害。
    try {
      mainWindow.webContents.send('dual:role-changed', 'operator-solo');
    } catch (_) { /* ignore */ }
  } finally {
    _isSwitchingMode = false;
    rollingLog('switchOperatorToSolo:exit', null);
    // v2.1.20-rc10.1 観測: 50ms 以上かかった場合、dialog ブロック等の race を検出
    const _switchDurationMs = Date.now() - _switchStartTimeMs;
    if (_switchDurationMs >= 50) {
      try { rollingLog('hdmi:dialog-blocked:switchOperatorToSolo', { durationMs: _switchDurationMs }); } catch (_) {}
    }
  }
}

// v2.0.0 STEP 5: HDMI 再接続 → 2 画面モードに復帰。
//   - operator (mainWindow) を close → operator モードで再生成 + hallWindow を新規生成
//   - hall 側は hall 側起動時に initDualSyncForHall で main から state を再同期（既存 STEP 2 経路）
// v2.0.4-rc6 Fix 1-A: 再入ガード + orphan hallWindow 防御
async function switchSoloToOperator(hallDisplay) {
  rollingLog('switchSoloToOperator:enter', { hallDisplayId: hallDisplay && hallDisplay.id });
  if (_isSwitchingMode) return;
  _isSwitchingMode = true;
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!hallDisplay) return;
    // orphan hallWindow 検出 + close（display-added 多重発火による H2/H3 並行存在を防御）
    if (hallWindow && !hallWindow.isDestroyed()) {
      try { hallWindow.close(); } catch (_) { /* ignore */ }
      hallWindow = null;
    }
    const operatorDisplay = screen.getPrimaryDisplay();
    // v2.0.4-rc3: モード切替時の close は確認ダイアログを抑制
    mainWindow._suppressCloseConfirm = true;
    try { mainWindow.close(); } catch (_) { /* ignore */ }
    mainWindow = null;
    createOperatorWindow(operatorDisplay, false);
    createHallWindow(hallDisplay);
    // v2.0.4-rc7 Fix 1-A: 新規 operator window は preload で role='operator' 起動済だが、
    //   renderer の onRoleChanged ハンドラ整合性のため明示通知（idempotent、二重 setAttribute は無害）。
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('dual:role-changed', 'operator');
      }
    } catch (_) { /* ignore */ }
    // v2.1.20-rc5: 新 operator window load 完了後に PRE_START 状態を 1 回再同期。
    //   HDMI 挿し直しで operator window が close → 再生成され、renderer.js / timer.js が初期化されるため
    //   PRE_START 中の state が消失する。cache に保持された preStartState が active なら、
    //   load 完了タイミングで 1 回 push して applyOperatorPreStartState 経路で復元させる。
    //   Fix 1 の常時 broadcast と二重保険（cache の値 vs. broadcast タイミングの race どちらにも耐える設計）。
    if (_dualStateCache.preStartState && _dualStateCache.preStartState.isActive) {
      const cachedPreStart = _dualStateCache.preStartState;
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.once('did-finish-load', () => {
            try {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('dual:state-sync', { kind: 'preStartState', value: cachedPreStart });
                try { rollingLog('operator:preStartResync:sent', { isActive: cachedPreStart.isActive, isPaused: !!cachedPreStart.isPaused, ctx: 'switchSoloToOperator' }); } catch (_) {}
              }
            } catch (_) { /* never throw from resync */ }
          });
        }
      } catch (_) { /* never throw from listener registration */ }
    }
  } finally {
    _isSwitchingMode = false;
    rollingLog('switchSoloToOperator:exit', null);
  }
}

// v2.0.0 STEP 5: display-added / display-removed のイベント駆動追従（ポーリング禁止）。
//   - removed: hallWindow がその display 上にあれば close + operator-solo 切替
//   - added:   2 画面以上検出 + hallWindow 不在 → モニター選択ダイアログ → 2 画面復帰
//   v2-dual-screen.md §3.1: 検出から状態切替まで 2 秒以内（ウィンドウ再生成 ~250ms × 2 で達成）
// v2.0.4-rc6 Fix 1-B: display イベント多重発火の debounce ガード。
//   Windows は HDMI 接続/切断時に display-added/-removed を複数回発火することがあり、
//   旧実装ではガードが「hallWindow 存在チェック」だけだったため picker 並行起動 → orphan window が発生。
let _displayAddedPending = false;
let _displayRemovedPending = false;

function setupDisplayChangeListeners() {
  screen.on('display-removed', async (_event, removedDisplay) => {
    if (_displayRemovedPending) return;
    if (!hallWindow || hallWindow.isDestroyed()) return;
    _displayRemovedPending = true;
    // v2.0.4-rc15 タスク 2: rolling ログに記録（`_displayRemovedPending` チェック後で確実に 1 回）
    rollingLog('display-removed', _safeDisplayRemovedSnapshot(removedDisplay));
    // v2.1.20-rc10.1 観測: preStartState cache が 500ms 以上古い場合に警告ラベル（PRE_START 消失の早期発見）
    if (_dualStateCache.preStartState && _dualStateCache.preStartState.isActive && _preStartStateCacheUpdatedAt > 0) {
      const cacheAgeMs = Date.now() - _preStartStateCacheUpdatedAt;
      if (cacheAgeMs >= 500) {
        try { rollingLog('hdmi:display-removed:dual-sync-stale', { cacheAgeMs, isActive: true }); } catch (_) {}
      }
    }
    try {
      // v2.0.4-rc23 タスク 1（問題 ⑩ 真因根治）:
      //   rc22 計測ビルド実機ログで真因確定 = HDMI 抜き直後 Windows が hallWindow を新 primary display
      //   に瞬時移動 → 旧 isWindowOnDisplay 左上座標判定が必ず false 返却 → switchOperatorToSolo 不発火
      //   → タイマー画面消失症状。前原さん運用方針 A（PC + HDMI 1 本のみ）確定により、display-removed
      //   = 会場モニター消失と同義で扱える。hallWindow alive なら無条件 solo モード遷移。
      try { hallWindow.close(); } catch (_) { /* ignore */ }
      hallWindow = null;
      // hall 不在のため _broadcastDualState は STEP 2 で確立した no-op ガードで自動的に止まる
      await switchOperatorToSolo();
    } finally {
      _displayRemovedPending = false;
    }
  });

  screen.on('display-added', async () => {
    if (_displayAddedPending) return;
    if (_multiModeActive) return;   // multi-tournament-4up Phase 1: マルチ表示中は picker を出さない（HDMI 本格追従は Phase 3）
    if (hallWindow && !hallWindow.isDestroyed()) return;   // 既に 2 画面状態
    _displayAddedPending = true;
    // v2.0.4-rc15 タスク 2: rolling ログに記録（`_displayAddedPending` チェック後で確実に 1 回）
    rollingLog('display-added', _safeDisplaysCount());
    try {
      const displays = screen.getAllDisplays();
      if (!displays || displays.length < 2) return;
      // picker 起動前に再チェック（前回 await 中に状態が変わった race を救う）
      if (hallWindow && !hallWindow.isDestroyed()) return;
      const hallId = await chooseHallDisplayInteractive(displays);
      if (hallId == null) return;   // キャンセル時は単画面のまま
      const hallDisplay = displays.find((d) => d.id === hallId);
      if (!hallDisplay) return;
      await switchSoloToOperator(hallDisplay);
    } finally {
      _displayAddedPending = false;
    }
  });
}

// v2.0.0 STEP 1+4: 起動時のウィンドウ生成エントリ。
//   - 単画面（displays.length < 2）: operator-solo 1 ウィンドウのみ → v1.3.0 と完全同等
//   - 2 画面以上: モニター選択ダイアログ → 選択結果でホール側決定 → 2 ウィンドウ生成
//   - ダイアログをキャンセル: 単画面モード（operator-solo）で起動
async function createMainWindow() {
  const displays = screen.getAllDisplays();
  if (!displays || displays.length < 2) {
    return createOperatorWindow(displays && displays[0], true);
  }
  const hallId = await chooseHallDisplayInteractive(displays);
  if (hallId == null) {
    // キャンセル → 単画面モード（primary に operator-solo）
    return createOperatorWindow(screen.getPrimaryDisplay(), true);
  }
  const hallDisplay = displays.find((d) => d.id === hallId);
  const operatorDisplay = displays.find((d) => d.id !== hallId) || screen.getPrimaryDisplay();
  createOperatorWindow(operatorDisplay, false);
  createHallWindow(hallDisplay);
  return mainWindow;
}

// ===== multi-tournament-4up Phase 1: マルチ4分割表示モード（新規追加ブロック・既存関数は無改変） =====
//   設計: .cc-plans/2026-07-07_multi-tournament-4up_phase1_plan.md（Phase 0 plan §5 の確定設計）
//   - 第3のウィンドウ種別 role='multi-control'（手元PC操作盤・状態の真実源）/ 'multi-grid'（会場2×2表示専用）。
//     両方とも独立 HTML（renderer/index.html を読まない = display-picker 前例）。
//   - 状態同期は multi:* の別チャンネル + 別キャッシュ（既存 dual:* / _dualStateCache には触れない）。
//   - store への書込なし（トーナメントは読み取り専用 snapshot。致命保護⑤ runtime 永続化と構造的に非衝突）。
//   - HDMI 抜き差しの本格追従は Phase 3（マルチ中は display-added の picker 起動のみ 1 行ガードで抑止）。
let multiControlWindow = null;
let multiGridWindow = null;
let _multiModeActive = false;
let _multiTransitioning = false; // enter/exit 中の再入・close 連鎖ガード
const _multiPaneCache = [null, null, null, null]; // multi:publish kind='pane' のキャッシュ（grid 初期同期用）
let _multiUiCache = null; // Phase 2: multi:publish kind='ui'（キーボード操作の選択区画/ヘルプ）のキャッシュ

function _resetMultiPaneCache() {
  for (let i = 0; i < _multiPaneCache.length; i++) _multiPaneCache[i] = null;
  _multiUiCache = null;
}

// ----- Phase 2e: 停電・クラッシュ復帰用の一時セッションファイル -----
//   保存先は electron-store の config とは別の専用ファイル（store.set 不使用 = store 書込ゼロ原則を維持。
//   単一モードの tournaments / runtime 永続化 8 箇所には一切触れない）。
//   「ファイルが残存 = 異常終了」を signal にする: 正常終了（exitMultiMode / アプリ正常 quit）では必ず削除し、
//   電源断・クラッシュ・タスクキルでは削除経路が走らないため残存する。恒久保存機能ではない。
const { pathToFileURL } = require('url');
const MULTI_SESSION_SCHEMA = 1;
let _multiSessionSaveTimer = null;

function _multiSessionPath() {
  return path.join(app.getPath('userData'), 'multi-session.json');
}

// publish（edge イベント）相乗りの debounce 書出し（1 秒。大会中の高頻度操作でも I/O を張り付かせない）
function _scheduleMultiSessionSave() {
  if (!_multiModeActive || _multiSessionSaveTimer) return;
  _multiSessionSaveTimer = setTimeout(() => {
    _multiSessionSaveTimer = null;
    _writeMultiSession();
  }, 1000);
}

async function _writeMultiSession() {
  if (!_multiModeActive) return;
  const file = _multiSessionPath();
  const tmp = file + '.tmp';
  try {
    const payload = JSON.stringify({
      schema: MULTI_SESSION_SCHEMA,
      savedAtMs: Date.now(),
      panes: _multiPaneCache,
      ui: _multiUiCache
    });
    // tmp へ書いて rename（書込中の電源断でも旧ファイルが生存。中途破損は parse 失敗 → 復元せず破棄の網にかかる）
    await fs.promises.writeFile(tmp, payload, 'utf8');
    // 書込（非同期）中に exitMultiMode の削除が走った場合、rename でファイルが復活し
    // 「正常終了なのに残存 = 偽の復元確認」になる競合窓を閉じる（rename 直前に再チェック）
    if (!_multiModeActive) {
      try { await fs.promises.unlink(tmp); } catch (_) { /* ignore */ }
      return;
    }
    await fs.promises.rename(tmp, file);
  } catch (_) { /* 書出し失敗は無視（次の debounce で再試行） */ }
}

function _deleteMultiSession() {
  if (_multiSessionSaveTimer) {
    clearTimeout(_multiSessionSaveTimer);
    _multiSessionSaveTimer = null;
  }
  try { fs.unlinkSync(_multiSessionPath()); } catch (_) { /* 不在なら無視 */ }
  try { fs.unlinkSync(_multiSessionPath() + '.tmp'); } catch (_) { /* 不在なら無視 */ }
}

// Phase 2f 追補: 復元ダイアログ用「前回終了からの経過時間」表示（復元方式を選ぶ判断材料）。
//   1 分未満 / 約N分 / 約N時間 / 約N時間M分。計算不能（非有限）は空文字 = 表示側で括弧ごと省略。
function _formatMultiSessionAge(savedAtMs, nowMs) {
  if (!Number.isFinite(savedAtMs) || !Number.isFinite(nowMs)) return '';
  const mins = Math.floor(Math.max(0, nowMs - savedAtMs) / 60000);
  if (mins < 1) return '1分未満';
  if (mins < 60) return `約${mins}分`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `約${h}時間` : `約${h}時間${m}分`;
}

// 残存セッションの読取（破損 / スキーマ版数不一致は null = 復元せず破棄する安全側）
function _readMultiSession() {
  try {
    const raw = fs.readFileSync(_multiSessionPath(), 'utf8');
    const data = JSON.parse(raw);
    if (!data || data.schema !== MULTI_SESSION_SCHEMA || !Array.isArray(data.panes) || !Number.isFinite(data.savedAtMs)) {
      return null;
    }
    return data;
  } catch (_) {
    return null;
  }
}

// 削除経路は exitMultiMode（+ 復元確認での「破棄」/ 破損検出）に限定する設計。
//   - マルチ在席中のアプリ終了は closed ハンドラ → exitMultiMode 連鎖で削除される（正常終了網羅）。
//   - マルチ未使用のアプリ起動 / 終了ではファイルに触れない = 停電後に一度単一モードだけ使って
//     終了しても復元機会が消えない（unconditional な will-quit 削除はこれを壊すため置かない。
//     will-quit は v2.0.3 P4 で 1 ハンドラに統合済＝単一モード経路のため触れない）。

// ----- Phase 3c: 正常終了の確認（前原実機 FB 第 6 弾） -----
//   停電等の異常終了は multi-session.json 残存で復元できるが、× / 終了ボタンの正常終了は
//   exitMultiMode がセッションファイルを削除する = 復元不可。この非対称を「消える前に警告」で緩和する。
//   削除挙動そのものは不変（確認で gate するだけ）。

// 進行中区画（running / prestart / paused）があるか。finished / idle は「失う進行」がないため対象外。
// ※ _multiPaneCache の各要素は publish payload の pane（engine は getRecord() の record）
//    = 参照は pane.engine.status（Plan 軽量 review ピン留め: トップレベル .status は存在しない）
function _hasActiveMultiPane() {
  return _multiPaneCache.some((p) => {
    const st = p && p.engine && p.engine.status;
    return st === 'running' || st === 'prestart' || st === 'paused';
  });
}

// 終了確認。進行中区画がなければ確認なしで true（摩擦ゼロ）。default はキャンセル（誤爆防止・
// 単一モード × 確認の defaultId:1 と整合）。
function _confirmMultiExit(parentWin) {
  if (!_hasActiveMultiPane()) return true;
  const choice = dialog.showMessageBoxSync(parentWin && !parentWin.isDestroyed() ? parentWin : undefined, {
    type: 'question',
    title: 'マルチ表示モードの終了',
    message: 'マルチ表示モードを終了しますか？',
    detail: '終了すると各区画の進行状況（タイマー・エントリー数など）は保存されず、元に戻せません。\n'
      + '（停電などの異常終了と違い、正常な終了では復元できません）',
    buttons: ['終了する', 'キャンセル'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  return choice === 0;
}

// 会場側 2×2 グリッドウィンドウ（createHallWindow の配置パターンを踏襲した新関数）
function createMultiGridWindow(targetDisplay) {
  if (multiGridWindow && !multiGridWindow.isDestroyed()) {
    try { multiGridWindow.close(); } catch (_) { /* ignore */ }
  }
  multiGridWindow = null;
  const opts = {
    title: WINDOW_TITLE + ' (Multi Grid)',
    width: 1280,
    height: 720,
    fullscreen: true,
    focusable: false,           // 会場モニターはフォーカス不可（操作は手元 PC、hall と同じ思想）
    show: true,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      ...buildWebPreferences('multi-grid'),
      paintWhenInitiallyHidden: true
    }
  };
  if (targetDisplay && targetDisplay.bounds) {
    opts.x = targetDisplay.bounds.x + 40;
    opts.y = targetDisplay.bounds.y + 40;
  }
  const win = new BrowserWindow(opts);
  multiGridWindow = win;
  win.on('page-title-updated', (event) => event.preventDefault());
  win.setTitle(WINDOW_TITLE + ' (Multi Grid)');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'renderer', 'multi', 'multi-grid.html'));
  win.once('ready-to-show', () => {
    if (!win.isDestroyed() && !win.isFullScreen()) win.setFullScreen(true);
  });
  win.on('closed', () => {
    if (multiGridWindow === win) multiGridWindow = null;
    // grid が不意に消えた場合は孤児操作盤を残さない（exitMultiMode 内の close 連鎖は
    // _multiModeActive=false 済のため再入しない）
    if (_multiModeActive) exitMultiMode();
  });
  return win;
}

// 手元 PC 側 操作盤ウィンドウ
function createMultiControlWindow(targetDisplay) {
  if (multiControlWindow && !multiControlWindow.isDestroyed()) {
    try { multiControlWindow.close(); } catch (_) { /* ignore */ }
  }
  multiControlWindow = null;
  const opts = {
    title: WINDOW_TITLE + ' (Multi Control)',
    width: 1100,
    height: 700,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0A1F3D',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: buildWebPreferences('multi-control')
  };
  if (targetDisplay && targetDisplay.bounds) {
    opts.x = targetDisplay.bounds.x + 40;
    opts.y = targetDisplay.bounds.y + 40;
  }
  const win = new BrowserWindow(opts);
  multiControlWindow = win;
  win.on('page-title-updated', (event) => event.preventDefault());
  win.setTitle(WINDOW_TITLE + ' (Multi Control)');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'renderer', 'multi', 'multi-control.html'));
  // Phase 3c: × / Alt+F4 の正常終了に確認を挟む（単一モード L1545 パターン準拠・専用 suppress フラグ =
  // 単一モードの _suppressCloseConfirm とは共有しない）。exitMultiMode 経由の close は suppress 済で素通し。
  // 進行中区画がなければ preventDefault せず素通し（既存 closed → exitMultiMode 連鎖で摩擦ゼロ終了）。
  win._suppressMultiExitConfirm = false;
  win.on('close', (event) => {
    if (win._suppressMultiExitConfirm || !_multiModeActive) return;
    if (!_hasActiveMultiPane()) return;
    event.preventDefault();
    if (_confirmMultiExit(win)) {
      win._suppressMultiExitConfirm = true;
      exitMultiMode(); // _multiModeActive=false 先行 + suppress 済のため再確認・closed 再入なし
    }
  });
  win.on('closed', () => {
    if (multiControlWindow === win) multiControlWindow = null;
    // × で操作盤を閉じた場合も通常モードへ復帰（grid 孤児化 = 操作不能状態を防ぐ。
    //   exitMultiMode 経由の close は _multiModeActive=false 済のため再入しない）
    if (_multiModeActive) exitMultiMode();
  });
  return win;
}

// マルチ表示モードへ入る（operator の設定画面から multi:enter IPC 経由）
async function enterMultiMode() {
  if (_multiModeActive || _multiTransitioning) return { ok: false, reason: 'already' };
  if (_isSwitchingMode) return { ok: false, reason: 'busy' };
  // 安全ゲート: 単一モードのタイマー進行中は開始不可（Phase 1 仕様）。
  //   operator は hide されるが renderer は生き続けるため、backgroundThrottling(role='operator')
  //   により rAF が絞られ「隠れたタイマーが遅れて進む」事故が起き得る。入口で構造的に排除する。
  //   判定は confirmQuit と同じ store 参照 + PRE_START は dual cache 参照（読み取りのみ）。
  try {
    const activeId = store.get('activeTournamentId');
    const list = store.get('tournaments') || [];
    const active = list.find((t) => t.id === activeId);
    const status = active?.timerState?.status;
    if (status === 'running' || status === 'paused' || status === 'break') {
      return { ok: false, reason: 'timer-active' };
    }
  } catch (_) { /* store 判定不能は稀。PRE_START ガードは下で別途効く */ }
  if (_dualStateCache.preStartState && _dualStateCache.preStartState.isActive) {
    return { ok: false, reason: 'pre-start-active' };
  }
  // Phase 2f 追補2: モード開始時の確認モーダル（前原指示 2026-07-08）。
  //   「登録トーナメントは読み込むだけで、このモードでの進行・操作は保存・上書きされない
  //   （store 書込ゼロ）。停電復帰だけは一時ファイルで対応」をユーザーに開始前に明示する。
  //   キャンセルは reason 'cancelled'（picker キャンセルと同じ = operator 側は無言で戻る既存経路）。
  {
    const startChoice = dialog.showMessageBoxSync(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
      type: 'question',
      title: 'マルチ表示モード（4分割）',
      message: 'マルチ表示モード（4分割）を開始しますか？',
      detail: '・各区画には、登録済みトーナメントの内容（ブラインド構造など）をそのまま読み込んで使います。\n'
        + '・このモードでの進行や操作（タイマー・エントリー数など）は、登録トーナメントのデータには保存・上書きされません（モード終了とともに消えます）。\n'
        + '・停電などで不意に終了した場合のみ、次回開始時に直前の状態から復元できます。',
      buttons: ['開始する', 'キャンセル'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (startChoice !== 0) return { ok: false, reason: 'cancelled' };
  }
  // Phase 2e: 異常終了セッションの検出と復元確認（picker 前）。
  //   破損 / 版数不一致は確認を出さず破棄して新規開始（安全側）。
  //   キャンセル = マルチ開始自体を中止しファイルは温存（誤操作で復元機会を失わない）。
  let _restoreSession = null;
  let _restoreMode = 'paused'; // Phase 2f: 'paused'=そこから再開（2e 現行挙動） / 'elapsed'=経過を反映
  try {
    if (fs.existsSync(_multiSessionPath())) {
      const data = _readMultiSession();
      if (!data) {
        _deleteMultiSession();
      } else {
        // Phase 2f: 復元方式の選択（前原 FB 第 5 弾）。「そこから再開」= 2e 現行挙動（default・安全側）/
        // 「経過を反映」= 停電〜再入場の実時間も進んだ扱い（2e 壁打ちの「壁時計継続は不採用」を選択制へ上書き）
        const sessionAge = _formatMultiSessionAge(data.savedAtMs, Date.now());
        const choice = dialog.showMessageBoxSync(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
          type: 'question',
          title: 'マルチ表示の復元',
          message: `前回のマルチ表示が正常に終了しませんでした${sessionAge ? `（終了から${sessionAge}）` : ''}。直前の状態をどう復元しますか？`,
          detail: 'そこから再開: 各区画は前回終了時点の残り時間で一時停止して戻ります（停電中に時計は進みません）。\n'
            + '経過を反映: 前回終了から今までの経過時間ぶんタイマーを進めた位置で一時停止して戻ります（レベルが繰り上がり、全レベルを終えた区画は終了として戻ります）。\n'
            + 'どちらもスペースキー / 一時停止ボタンで再開できます。',
          buttons: ['そこから再開（時計は進めない）', '経過を反映して復元（時計を進める）', '破棄して新規で始める', 'キャンセル'],
          defaultId: 0,
          cancelId: 3,
          noLink: true
        });
        if (choice === 3) return { ok: false, reason: 'restore-cancelled' };
        if (choice === 2) _deleteMultiSession();
        else {
          _restoreSession = data;
          _restoreMode = (choice === 1) ? 'elapsed' : 'paused';
        }
      }
    }
  } catch (_) { /* 検出失敗時は新規開始 */ }
  _multiTransitioning = true;
  try {
    // グリッド表示モニターの選択（2 画面以上なら picker = 既存 chooseHallDisplayInteractive を呼ぶだけ。
    //   単画面なら primary に全画面表示（動作確認用途。実運用は extend = 2 画面）
    const displays = screen.getAllDisplays();
    let gridDisplay = screen.getPrimaryDisplay();
    if (displays && displays.length >= 2) {
      const gridId = await chooseHallDisplayInteractive(displays);
      if (gridId == null) return { ok: false, reason: 'cancelled' };
      gridDisplay = displays.find((d) => d.id === gridId) || gridDisplay;
    }
    _multiModeActive = true;
    setupMultiDisplayChangeListeners(); // Phase 3a: HDMI 抜き差し追従（初回のみ登録・idempotent）
    _resetMultiPaneCache();
    // Phase 2e/2f: 復元 prime。engine record はここで選択方式に応じて「書出し時点で一時停止」（paused）
    //   or「経過を反映した位置で一時停止」（elapsed）へ変換してから配る
    //   （grid / control とも最初から止まった時計を受け取る = 跳んだ時計を一瞬も見せない）。
    //   変換ロジックは multi-engine.mjs の純粋関数を動的 import で共用（二重実装を作らない）。
    if (_restoreSession) {
      try {
        const engineMod = await import(pathToFileURL(path.join(__dirname, 'renderer', 'multi', 'multi-engine.mjs')).href);
        // Phase 2f: 「経過を反映」の基準時刻はループ前に 1 回だけ捕捉（全区画で同一値 = 区画間の一貫性）
        const restoreNow = Date.now();
        for (let i = 0; i < _multiPaneCache.length; i++) {
          const p = _restoreSession.panes[i];
          if (!p || typeof p !== 'object') continue;
          const pane = { ...p };
          if (pane.engine) {
            pane.engine = (_restoreMode === 'elapsed')
              ? engineMod.toPowerLossElapsedRecord(pane.engine, (pane.snapshot && Array.isArray(pane.snapshot.levels)) ? pane.snapshot.levels : [], restoreNow)
              : engineMod.toPowerLossPausedRecord(pane.engine, _restoreSession.savedAtMs);
          }
          _multiPaneCache[i] = pane;
        }
        _multiUiCache = (_restoreSession.ui && typeof _restoreSession.ui === 'object') ? _restoreSession.ui : null;
        try { rollingLog('multi:session-restored', { savedAtMs: _restoreSession.savedAtMs, mode: _restoreMode }); } catch (_) { /* ignore */ }
      } catch (_) {
        _resetMultiPaneCache(); // 復元失敗は新規開始（安全側）
      }
    }
    // 既存 hall は閉じる（dual broadcast は hallWindow null で自動 no-op = 既存 STEP 2 設計）
    if (hallWindow && !hallWindow.isDestroyed()) {
      try { hallWindow.close(); } catch (_) { /* ignore */ }
      hallWindow = null;
    }
    // operator は close せず hide（close 確認ダイアログ・再生成 race を持ち込まない）
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.hide(); } catch (_) { /* ignore */ }
    }
    const controlDisplay = (screen.getAllDisplays() || []).find((d) => d.id !== gridDisplay.id)
      || screen.getPrimaryDisplay();
    // grid → control の順で生成（単画面動作確認時に操作盤が全画面 grid の前面に来るように）
    createMultiGridWindow(gridDisplay);
    createMultiControlWindow(controlDisplay);
    try { rollingLog('multi:enter', { gridDisplayId: gridDisplay && gridDisplay.id }); } catch (_) { /* ignore */ }
    return { ok: true };
  } finally {
    _multiTransitioning = false;
  }
}

// マルチ表示モードを終了して通常モードへ復帰
async function exitMultiMode() {
  if (!_multiModeActive) return { ok: false, reason: 'not-active' };
  if (_multiTransitioning) return { ok: false, reason: 'busy' };
  _multiTransitioning = true;
  try {
    _multiModeActive = false; // 先に落とす = close 連鎖（closed ハンドラ）の再入を構造的に防ぐ
    _deleteMultiSession();    // Phase 2e: 正常終了 = セッションファイル削除（恒久保存しない）
    const gw = multiGridWindow; multiGridWindow = null;
    const cw = multiControlWindow; multiControlWindow = null;
    if (gw && !gw.isDestroyed()) { try { gw.close(); } catch (_) { /* ignore */ } }
    if (cw && !cw.isDestroyed()) { try { cw._suppressMultiExitConfirm = true; cw.close(); } catch (_) { /* ignore */ } } // Phase 3c: 二重ダイアログ防止
    _resetMultiPaneCache();
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { app.focus({ steal: true }); } catch (_) { /* ignore */ }
      try { mainWindow.show(); } catch (_) { /* ignore */ }
      try { mainWindow.focus(); } catch (_) { /* ignore */ }
      // hall の再生成は起動時と同じ「毎回手動選択」フロー（既存ヘルパを呼ぶだけ・switch 系には触れない）
      const displays = screen.getAllDisplays();
      if (displays && displays.length >= 2) {
        const hallId = await chooseHallDisplayInteractive(displays);
        const hallDisplay = (hallId != null) ? displays.find((d) => d.id === hallId) : null;
        if (hallDisplay) {
          createHallWindow(hallDisplay);
          try { mainWindow.webContents.send('dual:role-changed', 'operator'); } catch (_) { /* ignore */ }
          try { rollingLog('multi:exit', { restored: 'dual' }); } catch (_) { /* ignore */ }
          return { ok: true };
        }
      }
      // 単画面 or picker キャンセル → operator-solo 表示（既存の動的 role 切替 IPC・idempotent）
      try { mainWindow.webContents.send('dual:role-changed', 'operator-solo'); } catch (_) { /* ignore */ }
    }
    try { rollingLog('multi:exit', { restored: 'solo' }); } catch (_) { /* ignore */ }
    return { ok: true };
  } finally {
    _multiTransitioning = false;
  }
}

// multi:* IPC 登録（モジュールロード時に即登録。registerIpcHandlers 本体には触れない）
function registerMultiIpcHandlers() {
  ipcMain.handle('multi:enter', () => enterMultiMode());
  // Phase 3c: 終了ボタン経由も確認を gate（キャンセルは picker と同じ reason = operator/control 側は無言）
  ipcMain.handle('multi:exit', () => {
    if (!_multiModeActive) return { ok: false, reason: 'not-active' };
    if (!_confirmMultiExit(multiControlWindow)) return { ok: false, reason: 'cancelled' };
    return exitMultiMode();
  });
  // multi-control（真実源）→ main（キャッシュ）→ multi-grid の edge イベント中継。
  // Phase 2: kind='ui'（キーボード操作の選択区画ハイライト / ヘルプ / リセット確認）も同経路で受理
  ipcMain.on('multi:publish', (_event, payload) => {
    if (!_multiModeActive) return;
    if (!payload || !payload.value || typeof payload.value !== 'object') return;
    if (payload.kind === 'pane') {
      const idx = Number(payload.value.index);
      if (!Number.isInteger(idx) || idx < 0 || idx > 3) return;
      _multiPaneCache[idx] = payload.value.pane || null;
    } else if (payload.kind === 'ui') {
      _multiUiCache = payload.value;
    } else {
      return;
    }
    _scheduleMultiSessionSave(); // Phase 2e: edge イベント相乗りの debounce 書出し（停電復帰用）
    if (multiGridWindow && !multiGridWindow.isDestroyed()) {
      try { multiGridWindow.webContents.send('multi:state-sync', payload); } catch (_) { /* ignore */ }
    }
  });
  // grid 起動時の全量 1 回同期（venueName / logo は store 読み取りのみ）
  ipcMain.handle('multi:state-sync-init', () => ({
    panes: _multiPaneCache.slice(),
    ui: _multiUiCache,
    global: {
      venueName: store.get('venueName') || '',
      logo: store.get('logo') || null
    }
  }));
  // Phase 2: 空き区画フィラー用の画像ファイル選択（読み取りのみ・store 書込なし・
  // 選択パスは control 側のセッション内 state にのみ保持 = electron-store 非永続化）
  ipcMain.handle('multi:pick-filler-image', async () => {
    if (!_multiModeActive || !multiControlWindow || multiControlWindow.isDestroyed()) return { path: '' };
    try {
      const result = await dialog.showOpenDialog(multiControlWindow, {
        title: 'フィラー画像を選択',
        properties: ['openFile'],
        filters: [{ name: '画像ファイル', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
      });
      if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) return { path: '' };
      return { path: result.filePaths[0] };
    } catch (_) {
      return { path: '' };
    }
  });
  // Phase 2: mirror（複製 = 1 台運用）の前面切替。grid は focusable:false のため moveTop しても
  // focus は control に残り、キーボード操作（control の keydown）が継続できる（globalShortcut 不使用）
  ipcMain.on('multi:grid-front', () => {
    if (!_multiModeActive) return;
    if (multiGridWindow && !multiGridWindow.isDestroyed()) {
      try { multiGridWindow.moveTop(); } catch (_) { /* ignore */ }
    }
  });
  ipcMain.on('multi:control-front', () => {
    if (!_multiModeActive) return;
    if (multiControlWindow && !multiControlWindow.isDestroyed()) {
      try { multiControlWindow.moveTop(); } catch (_) { /* ignore */ }
      try { multiControlWindow.focus(); } catch (_) { /* ignore */ }
    }
  });
}
registerMultiIpcHandlers();

// ===== remote-control Phase 1a: スマホ遠隔操作サーバの lifecycle + IPC（新規ブロック・既存関数は無改変） =====
//   設計: .cc-plans/2026-07-08_remote-control_phase1a-core_plan.md / 正典 docs/remote-control_roadmap.md
//   - 既定 OFF（store.remoteControl.enabled）。ON の時だけ LAN サーバを起動（OFF=現行完全同一・後方互換）。
//   - 配線点①（本ブロック）: server.onOp → mainWindow.webContents.send('remote:op', payload)。
//     配線点②（renderer.js）: operator-solo でも受信するリスナー → dispatchClockShortcut(payload)。
//   - PIN は起動のたびにランダム 6 桁生成（設定画面に表示・QR には含めない＝Phase 1b）。
//   - runtime を変える操作は既存 dispatchClockShortcut→setRuntime→sanitizeRuntime→既存 debounce のみ経由
//     （独自の store 書込経路は作らない＝致命バグ保護⑤ runtime 永続化 8 箇所を割らない）。
let _remoteServerHandle = null; // remoteServer.start() の戻り { server, port, host, close, pushState }
let _remotePin = null;          // 現行 PIN（サーバ起動のたび再生成・停止で null）
let _remoteStarting = false;    // 起動処理の再入ガード
// 1b: スマホへ SSE で送る現在状態スナップショット。renderer（真実源）からの【読み取り送信】で更新するだけ。
//   ここでは store へ一切書かない（致命バグ保護⑤ runtime 永続化 8 箇所に非接触）。
let _remoteState = null;

// 1b: renderer から来た状態を安全な原始値のみに正規化（過大 / 予期せぬ型を弾く・読み取り専用）。
function _sanitizeRemoteState(s) {
  if (!s || typeof s !== 'object') return null;
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const str = (v) => (typeof v === 'string' ? v.slice(0, 120) : '');
  return {
    playersInitial: num(s.playersInitial),
    playersRemaining: num(s.playersRemaining),
    reentryCount: num(s.reentryCount),
    addOnCount: num(s.addOnCount),
    specialCount: num(s.specialCount),
    tableName: str(s.tableName)
  };
}

function _generateRemotePin() {
  // crypto.randomInt で一様な 6 桁（000000〜999999）。Math.random は使わない。
  const n = _hashPIICrypto.randomInt(0, 1000000);
  return String(n).padStart(6, '0');
}

function _remoteConnectUrl() {
  if (!_remoteServerHandle) return null;
  const lan = remoteDiscover.primaryLanIPv4();
  const ip = lan ? lan.address : '127.0.0.1';
  return { ip, port: _remoteServerHandle.port, url: `http://${ip}:${_remoteServerHandle.port}` };
}

async function startRemoteServer() {
  if (_remoteServerHandle || _remoteStarting) return; // 既に稼働 / 起動中なら no-op
  _remoteStarting = true;
  try {
    _remotePin = _generateRemotePin();
    _remoteServerHandle = await remoteServer.start({
      getPin: () => _remotePin,
      port: 0,          // OS 空きポート自動選択（ポート衝突を構造的に回避）
      host: '0.0.0.0',  // LAN バインド（別端末=スマホから到達可能）
      onOp: (payload) => {
        // 配線点①: 認証を通過した操作のみ renderer へ。runtime は触らない（payload を渡すだけ）。
        if (!mainWindow || mainWindow.isDestroyed()) return;
        try { mainWindow.webContents.send('remote:op', payload); } catch (_) { /* transition 中は無視 */ }
      },
      // 1b: SSE 接続時の初期状態送信用（読み取りのみ・server は状態を保持しない）。
      getState: () => _remoteState
    });
    try { rollingLog('remote:started', { port: _remoteServerHandle.port }); } catch (_) {}
  } catch (err) {
    _remotePin = null;
    _remoteServerHandle = null;
    try { rollingLog('remote:start-error', { message: err && err.message }); } catch (_) {}
  } finally {
    _remoteStarting = false;
  }
}

async function stopRemoteServer() {
  const h = _remoteServerHandle;
  _remoteServerHandle = null;
  _remotePin = null;
  _remoteState = null;
  if (h) {
    try { await h.close(); } catch (_) { /* ignore */ }
    try { rollingLog('remote:stopped', null); } catch (_) {}
  }
}

function _remoteStatus() {
  const enabled = !!(store.get('remoteControl') || {}).enabled;
  const running = !!_remoteServerHandle;
  const conn = running ? _remoteConnectUrl() : null;
  // 1b-qr: 稼働中は接続 URL の QR 行列を同梱（PIN は含めない＝URL のみ）。生成失敗は null（UI は非表示）。
  let qr = null;
  if (conn && conn.url) {
    try { qr = remoteQr.generate(conn.url); } catch (_) { qr = null; }
  }
  return {
    enabled,
    running,
    pin: running ? _remotePin : null,
    ip: conn ? conn.ip : null,
    port: conn ? conn.port : null,
    url: conn ? conn.url : null,
    qr // { size, modules } or null
  };
}

// remote:* IPC 登録（registerMultiIpcHandlers と同型・registerIpcHandlers 本体には触れない）
function registerRemoteIpcHandlers() {
  ipcMain.handle('remote:getStatus', () => _remoteStatus());
  ipcMain.handle('remote:setEnabled', async (_event, enabled) => {
    const on = !!enabled;
    const cur = store.get('remoteControl') || {};
    store.set('remoteControl', { ...cur, enabled: on });
    if (on) await startRemoteServer();
    else await stopRemoteServer();
    return _remoteStatus();
  });
  // 1b: renderer（真実源）→ main への【読み取り送信】。現在状態を SSE 用スナップショットに反映して
  //   全 SSE クライアントへ push するだけ（store 書込ゼロ・setRuntime/sanitizeRuntime 経路に非接触）。
  ipcMain.on('remote:state', (_event, state) => {
    if (!_remoteServerHandle) return; // OFF/停止中は破棄
    _remoteState = _sanitizeRemoteState(state);
    try { _remoteServerHandle.pushState(_remoteState); } catch (_) { /* ignore */ }
  });
}
registerRemoteIpcHandlers();

// 外部DB連携 STEP2-K1: dblink:* IPC 登録（registerRemoteIpcHandlers と同型・registerIpcHandlers 本体には触れない）。
//   通信はすべて src/link/db-link.js（main 側・plain fetch）に集約＝renderer CSP 無改変。未設定時は inert。
//   店舗キー方式（壁打ち記録 §7）: login/logout チャネルは撤去済（PC はログインしない）。
function registerDbLinkIpcHandlers() {
  dbLink.init(store, (event) => { try { rollingLog(event, null); } catch (_) { /* ignore */ } }, {
    // K3: 切断/復帰・conflict 時の DB 状態を renderer へ push（全 window へ broadcast。
    //   hall/multi 側は listener を持たない or ゲートで無視するため実質 index の operator のみが反応）
    notify: (payload) => {
      try {
        for (const w of BrowserWindow.getAllWindows()) {
          try { w.webContents.send('dblink:event', payload); } catch (_) { /* ignore */ }
        }
      } catch (_) { /* ignore */ }
    }
  });
  ipcMain.handle('dblink:getStatus', () => dbLink.getStatus());
  ipcMain.handle('dblink:setConfig', (_event, cfg) => dbLink.setConfig(cfg || {}));
  ipcMain.handle('dblink:listTodayTournaments', () => dbLink.listTodayTournaments());
  ipcMain.handle('dblink:setTournamentLink', (_event, p) => dbLink.setTournamentLink(p || {}));
  // K2: 紐づけ確定（構成 upload → clock/init → 対応表保存）
  ipcMain.handle('dblink:linkAndInit', (_event, p) => dbLink.linkAndInit(p || {}));
  // K3: 復帰 probe（GET /clock 読取のみ）と チェック OFF=配信停止（POST /clock/stop + 行削除）
  ipcMain.handle('dblink:probe', (_event, p) => dbLink.probe(p && p.tournamentId));
  ipcMain.handle('dblink:stopLink', (_event, p) => dbLink.stopLink(p || {}));
  // K2: 状態送信（fire-and-forget・renderer は応答を待たない。coalescer/楽観ロックは db-link.js 側）
  ipcMain.on('dblink:publishRecord', (_event, p) => {
    try { dbLink.publishRecord(p && p.tournamentId, p && p.record); } catch (_) { /* never throw */ }
  });
  ipcMain.on('dblink:publishRuntime', (_event, p) => {
    try { dbLink.publishRuntime(p && p.tournamentId, p && p.runtime); } catch (_) { /* never throw */ }
  });
}
registerDbLinkIpcHandlers();

// ----- Phase 3a: マルチ表示中の HDMI 抜き差し追従 -----
//   既存 setupDisplayChangeListeners は無改変（マルチ中は display-removed が hallWindow ガード、
//   display-added が _multiModeActive ガードで元々 no-op）。screen.on の多重登録で独立に追加する。
//   運用方針 A（PC + HDMI 1 本・v2.0.4-rc23 で確立）: マルチ中の display-removed = 会場スクリーン消失と同義。
//   grid は close せず hide（close は closed → exitMultiMode 連鎖でモードごと終了してしまう。
//   タイマー進行の真実源は control 側のため、表示喪失中も各区画は継続する）。
//   挿し直しは picker を出さず新 display へ自動復帰（状態は control が真実源のため無損失）。
//   Windows は抜き差しで display イベントを複数発火することがあるため、時間窓 debounce で吸収する
//   （既存 _displayAddedPending / _displayRemovedPending とは別管理 = 単一モード経路と共有しない）。
//   登録はモジュールロード時ではなく enterMultiMode 初回の遅延 1 回（idempotent）。モジュールロード時に
//   screen へ触れると、electron を stub して main.js を require する静的テスト（data-transfer 等）が
//   uncaughtException → exit 0 の「0 件実行の偽 PASS」になる罠（2e 懐疑役検出と同型）を構造的に避ける。
const MULTI_DISPLAY_EVENT_DEBOUNCE_MS = 1500;
let _multiDisplayRemovedAtMs = 0;
let _multiDisplayAddedAtMs = 0;
let _multiDisplayListenersInstalled = false;

function setupMultiDisplayChangeListeners() {
  if (_multiDisplayListenersInstalled) return;
  _multiDisplayListenersInstalled = true;
  screen.on('display-removed', () => {
    if (!_multiModeActive) return;
    if (!multiGridWindow || multiGridWindow.isDestroyed()) return;
    const now = Date.now();
    if (now - _multiDisplayRemovedAtMs < MULTI_DISPLAY_EVENT_DEBOUNCE_MS) return;
    _multiDisplayRemovedAtMs = now;
    try { multiGridWindow.hide(); } catch (_) { /* ignore */ }
    try { rollingLog('multi:display-removed:grid-hidden', null); } catch (_) { /* ignore */ }
  });
  screen.on('display-added', (_event, newDisplay) => {
    if (!_multiModeActive) return;
    if (!multiGridWindow || multiGridWindow.isDestroyed()) return;
    const now = Date.now();
    if (now - _multiDisplayAddedAtMs < MULTI_DISPLAY_EVENT_DEBOUNCE_MS) return;
    _multiDisplayAddedAtMs = now;
    try {
      // fullscreen ウィンドウの display 間移動は 一旦解除 → bounds 移動 → 再全画面 が必要
      if (newDisplay && newDisplay.bounds) {
        multiGridWindow.setFullScreen(false);
        multiGridWindow.setBounds({ x: newDisplay.bounds.x + 40, y: newDisplay.bounds.y + 40, width: 1280, height: 720 });
      }
      multiGridWindow.show();   // focusable:false のため focus は control に残る（キーボード操作継続）
      multiGridWindow.setFullScreen(true);
      multiGridWindow.moveTop();
      rollingLog('multi:display-added:grid-restored', { displayId: newDisplay && newDisplay.id });
    } catch (_) { /* ignore */ }
  });
}

function toggleFullScreen() {
  // v2.0.4-rc6 Fix 3: 2 画面モード時は常に hall を toggle（hall 側全画面解除等の操作者ニーズ）。
  //   rc2 改修の「focused window を toggle」は実運用で前提崩れ（操作者は PC 側で操作するため
  //   hall focused は発生しない → 常に operator が全画面化される問題があった）。
  //   単画面モード（hallWindow 不在）では mainWindow を toggle（v1.3.0 完全互換維持）。
  const target = (hallWindow && !hallWindow.isDestroyed()) ? hallWindow : mainWindow;
  if (!target || target.isDestroyed()) return;
  target.setFullScreen(!target.isFullScreen());
}

async function confirmQuit() {
  if (!mainWindow) return;
  // STEP 10 フェーズC.1.2 Fix 1: タイマー進行中なら警告メッセージを表示。
  //   active トーナメントの timerState を store から読み、status が 'running' / 'paused' / 'break' なら警告。
  //   idle / done では従来通り。
  let isTimerActive = false;
  try {
    const activeId = store.get('activeTournamentId');
    const tournaments = store.get('tournaments') || [];
    const active = tournaments.find((t) => t.id === activeId);
    const status = active?.timerState?.status;
    isTimerActive = (status === 'running' || status === 'paused' || status === 'break');
  } catch (_) { /* 続行、保守的に false */ }
  const message = isTimerActive
    ? 'タイマーが進行中です。本当に終了しますか？\n（保存していない進行データが失われる可能性があります）'
    : 'PokerTimerPLUS+ を終了しますか？';
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['キャンセル', '終了'],
    defaultId: 0,
    cancelId: 0,
    title: '終了確認',
    message
  });
  if (result.response === 1) {
    // v2.0.4-rc3: confirmQuit 経由は専用ダイアログで既に確認済のため、
    //   close ハンドラの二重ダイアログを抑制してから app.quit へ。
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow._suppressCloseConfirm = true;
    // Phase 3c 追補（完了 review 懐疑役指摘）: マルチ表示中の Ctrl+Q も確認済扱い =
    // control の close インターセプト（第4経路）で quit が中断されないよう suppress を立てる
    if (multiControlWindow && !multiControlWindow.isDestroyed()) multiControlWindow._suppressMultiExitConfirm = true;
    app.quit();
  }
}

function toggleDevTools() {
  if (!mainWindow) return;
  mainWindow.webContents.toggleDevTools();
}

function registerShortcuts() {
  // v2.1.18-meas1 ui:keypress: globalShortcut のキー押下を rolling-log に記録（main プロセス）
  globalShortcut.register('F11', () => {
    try { rollingLog('ui:keypress', { key: 'F11', ctx: 'main:globalShortcut' }); } catch (_) {}
    toggleFullScreen();
  });
  globalShortcut.register('CommandOrControl+Q', () => {
    try { rollingLog('ui:keypress', { key: 'CommandOrControl+Q', ctx: 'main:globalShortcut' }); } catch (_) {}
    confirmQuit();
  });
  // STEP 6.21: 配布版（isDev=false）でも F12 で DevTools を開けるよう常時登録
  // before-input-event 側にもフォールバックを置いてあるので二重登録だが副作用なし
  globalShortcut.register('F12', () => {
    try { rollingLog('ui:keypress', { key: 'F12', ctx: 'main:globalShortcut' }); } catch (_) {}
    toggleDevTools();
  });
  // v2.0.4-rc22 タスク 2（問題 ⑩ 案 ⑩-A）:
  //   タイマー画面消失時にも UI 不要でログフォルダを開けるようにする救済策。
  //   _flushRollingLog で in-memory buffer を確実にディスクに反映してから shell.openPath。
  //   rc18 第 1 弾の I/O 順序保証維持のため、必ず await で待つ。
  // v2.1.18-meas1 Fix 4: 既存 Ctrl+Shift+L 機構を「拡張」。flush + フォルダオープンに加えて、
  //   押下時点の rolling-current.log のスナップショットを `op-{NN}-{ISO timestamp}.log` 形式で別保存する。
  //   保存仕様:
  //     - `_measOpCounter` は app セッション開始時 0、押下のたびに increment（1, 2, 3, ...）
  //     - ファイル名: `op-{counter:02d}-{ISO}.log`（ISO は : と . と Z を除去）
  //     - ヘッダ行: `# captured at ISO / op N / version vX.Y.Z` を先頭に付与
  //     - rollingLog('meas:capture') で保存先パスを記録（テスト・分析用）
  //   既存の「フォルダを開く」動作は維持（前原さんが保存した op-NN ファイルをすぐ確認できるよう）。
  globalShortcut.register('CommandOrControl+Shift+L', async () => {
    try { rollingLog('ui:keypress', { key: 'CommandOrControl+Shift+L', ctx: 'main:globalShortcut' }); } catch (_) {}
    try { await _flushRollingLog(); } catch (_) { /* never throw from logging */ }
    // v2.1.18-meas1: スナップショット保存
    try {
      _measOpCounter++;
      const isoRaw = new Date().toISOString();
      const isoForName = isoRaw.replace(/[:.]/g, '').replace(/Z$/, '');
      const fname = `op-${String(_measOpCounter).padStart(2, '0')}-${isoForName}.log`;
      const logsDir = _resolveLogsDir();
      if (logsDir) {
        const dst = path.join(logsDir, fname);
        const src = path.join(logsDir, 'rolling-current.log');
        const header = `# captured at ${isoRaw} / op ${_measOpCounter} / version ${app.getVersion()}\n`;
        const content = await fs.promises.readFile(src, 'utf8').catch(() => '');
        await fs.promises.writeFile(dst, header + content);
        rollingLog('meas:capture', { op: _measOpCounter, file: fname });
      }
    } catch (e) {
      // v2.1.18-meas1 error:caught:meas:capture
      try { rollingLog('error:caught:meas:capture', { message: e?.message }); } catch (_) {}
    }
    try {
      const dir = _resolveLogsDir();
      if (dir) shell.openPath(dir);
    } catch (_) { /* shell.openPath 失敗時は何もしない */ }
  });
}

// IPC: 設定ストアのブリッジ（preload経由でレンダラに公開）
function registerIpcHandlers() {
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('settings:getAll', () => store.store);
  // STEP 7: settings:setMarquee は削除（呼び出し元ゼロ、tournaments:setMarqueeSettings に完全移行済）。
  //   グローバル marquee は store.defaults と migrateTournamentSchema の fallback で参照されるのみで残置。
  ipcMain.handle('settings:setDisplay', (_event, partial) => {
    if (!partial || typeof partial !== 'object') {
      return store.get('display');
    }
    const current = store.get('display') || {};
    const merged = { ...current };
    if (typeof partial.background === 'string' && VALID_BACKGROUNDS.includes(partial.background)) {
      merged.background = partial.background;
    }
    if (typeof partial.timerFont === 'string' && VALID_TIMER_FONTS.includes(partial.timerFont)) {
      merged.timerFont = partial.timerFont;
    }
    // STEP 6.7: ボトムバー非表示状態（boolean）
    if (typeof partial.bottomBarHidden === 'boolean') {
      merged.bottomBarHidden = partial.bottomBarHidden;
    }
    // STEP 10 フェーズC.1.3: backgroundImage / backgroundOverlay の更新（バリデーションあり）
    if ('backgroundImage' in partial) {
      const sanImage = sanitizeBackgroundImage(partial.backgroundImage, current.backgroundImage || '');
      if (sanImage === null) {
        // サイズ超過は更新せず、警告を含めて呼出側に返す
        return { ...merged, _warning: 'image-too-large' };
      }
      merged.backgroundImage = sanImage;
    }
    if ('backgroundOverlay' in partial) {
      merged.backgroundOverlay = sanitizeBackgroundOverlay(partial.backgroundOverlay, current.backgroundOverlay || 'mid');
    }
    // STEP 10 フェーズC.1.4: 休憩中スライドショー
    if ('breakImages' in partial) {
      merged.breakImages = sanitizeBreakImages(partial.breakImages, current.breakImages || []);
    }
    if ('breakImageInterval' in partial) {
      merged.breakImageInterval = sanitizeBreakImageInterval(partial.breakImageInterval, current.breakImageInterval ?? 10);
    }
    if ('pipSize' in partial) {
      merged.pipSize = sanitizePipSize(partial.pipSize, current.pipSize || 'medium');
    }
    store.set('display', merged);
    return merged;
  });

  // STEP 6.22: 店舗名「Presented by ○○」表記の保存（グローバル）
  ipcMain.handle('settings:setVenueName', (_event, value) => {
    const sanitized = sanitizeVenueName(value);
    if (sanitized === null) {
      return {
        ok: false,
        error: 'invalid-format',
        message: '半角英数と一部記号（\'-&.,スペース）のみ、30文字以内、先頭は英数で入力してください'
      };
    }
    store.set('venueName', sanitized);
    // v2.0.0 STEP 2: hall に店舗名（Presented by ○○）を broadcast
    _publishDualState('venueName', sanitized);
    return { ok: true, venueName: sanitized };
  });

  // v2.4.0: 店舗デフォルト プール率の保存（appConfig.poolRatesDefault）
  //   新規トーナメント作成時に normalizeTournament の既定補完で参照される（既存トーナメントは migration 100% 維持）。
  //   value: { buyIn, reentry, addOn } の各 0〜100 整数（sanitizePoolRates が clamp）。
  //   hall 側は計算しないため dual-sync broadcast 不要（operator / operator-solo の設定 UI 専用）。
  ipcMain.handle('settings:setPoolRatesDefault', (_event, value) => {
    const sanitized = sanitizePoolRates(value, { buyIn: 0, reentry: 0, addOn: 0 });
    const cur = store.get('appConfig') || {};
    store.set('appConfig', { ...cur, poolRatesDefault: sanitized });
    return { ok: true, poolRatesDefault: sanitized };
  });

  // v2.6.0: 店舗デフォルト POT（appConfig.potDefaults、店内通貨 $ の1件あたり拠出）の保存。
  //   新規トーナメント作成時に normalizeTournament の既定補完で参照される。value: { buyIn, reentry, addOn }（$、非負整数）。
  ipcMain.handle('settings:setPotDefaults', (_event, value) => {
    const sanitized = sanitizePotAmounts(value, { buyIn: 0, reentry: 0, addOn: 0 });
    const cur = store.get('appConfig') || {};
    store.set('appConfig', { ...cur, potDefaults: sanitized });
    return { ok: true, potDefaults: sanitized };
  });

  // ===== STEP 9-B: ロゴ設定 IPC =====
  // ファイル選択 + userData ディレクトリへコピー（custom モードへ即移行）
  ipcMain.handle('logo:selectFile', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no-window' };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'ロゴ画像を選択',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths?.[0]) return { ok: false, error: 'canceled' };

    const srcPath = result.filePaths[0];
    let stats;
    try {
      stats = fs.statSync(srcPath);
    } catch (err) {
      return { ok: false, error: 'stat-failed', message: 'ファイルにアクセスできません' };
    }
    if (stats.size > 5 * 1024 * 1024) {
      return { ok: false, error: 'file-too-large', message: 'ファイルサイズは5MB以下にしてください' };
    }

    const userDir = app.getPath('userData');
    // 既存 custom-logo.* を全拡張子分削除（拡張子変更時のゴミ防止）
    for (const ext of ['png', 'jpg', 'jpeg', 'svg']) {
      const p = path.join(userDir, `custom-logo.${ext}`);
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) { /* ignore */ }
    }
    const ext = path.extname(srcPath).slice(1).toLowerCase();
    const destPath = path.join(userDir, `custom-logo.${ext}`);
    try {
      fs.copyFileSync(srcPath, destPath);
    } catch (err) {
      return { ok: false, error: 'copy-failed', message: 'ファイルのコピーに失敗しました' };
    }

    const logoState = { kind: 'custom', customPath: destPath };
    store.set('logo', logoState);
    _publishDualState('logoUrl', logoState);  // v2.0.1 Fix B4: ロゴ変更を hall に broadcast
    return { ok: true, kind: 'custom', customPath: destPath };
  });

  // モード切替（placeholder / plus2 のみ。custom は selectFile を経由）
  ipcMain.handle('logo:setMode', (_event, kind) => {
    if (!VALID_LOGO_KINDS.includes(kind)) return { ok: false, error: 'invalid-kind' };
    if (kind === 'custom') return { ok: false, error: 'use-selectFile-for-custom' };
    const logoState = { kind, customPath: null };
    store.set('logo', logoState);
    _publishDualState('logoUrl', logoState);  // v2.0.1 Fix B4: ロゴ変更を hall に broadcast
    return { ok: true, kind };
  });

  // ===== STEP 10 フェーズC.1.3: 背景画像 IPC =====
  // OS ファイルダイアログで PNG/JPG/JPEG/WebP を選び、5MB 以下なら base64 data URL で返す。
  // 永続化は呼出側で tournaments.setDisplaySettings / settings.setDisplay を経由する。
  ipcMain.handle('display:selectBackgroundImage', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no-window' };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '背景画像を選択',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths?.[0]) return { ok: false, error: 'canceled' };
    const srcPath = result.filePaths[0];
    let stats;
    try { stats = fs.statSync(srcPath); }
    catch (_) { return { ok: false, error: 'stat-failed', message: 'ファイルにアクセスできません' }; }
    if (stats.size > BACKGROUND_IMAGE_MAX_BYTES) {
      return { ok: false, error: 'file-too-large', message: '画像が大きすぎます（5MB 以下）' };
    }
    const ext = path.extname(srcPath).slice(1).toLowerCase();
    const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
               : (ext === 'png')                   ? 'image/png'
               : (ext === 'webp')                  ? 'image/webp' : null;
    if (!mime) return { ok: false, error: 'unsupported-format', message: 'PNG / JPEG / WebP のみ対応' };
    let buf;
    try { buf = fs.readFileSync(srcPath); }
    catch (_) { return { ok: false, error: 'read-failed', message: 'ファイル読込に失敗しました' }; }
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    return { ok: true, dataUrl };
  });

  // STEP 10 フェーズC.1.4: 休憩中スライドショー用 — 複数画像を一括選択して base64 配列で返す
  ipcMain.handle('display:selectBreakImages', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no-window' };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '休憩中の画像を選択（複数選択可）',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled || !result.filePaths?.length) return { ok: false, error: 'canceled' };
    const dataUrls = [];
    const errors = [];
    for (const srcPath of result.filePaths) {
      let stats;
      try { stats = fs.statSync(srcPath); }
      catch (_) { errors.push({ path: srcPath, error: 'stat-failed' }); continue; }
      if (stats.size > BACKGROUND_IMAGE_MAX_BYTES) {
        errors.push({ path: srcPath, error: 'file-too-large' });
        continue;
      }
      const ext = path.extname(srcPath).slice(1).toLowerCase();
      const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
                 : (ext === 'png')                   ? 'image/png'
                 : (ext === 'webp')                  ? 'image/webp' : null;
      if (!mime) { errors.push({ path: srcPath, error: 'unsupported-format' }); continue; }
      let buf;
      try { buf = fs.readFileSync(srcPath); }
      catch (_) { errors.push({ path: srcPath, error: 'read-failed' }); continue; }
      dataUrls.push(`data:${mime};base64,${buf.toString('base64')}`);
    }
    if (dataUrls.length === 0) {
      return { ok: false, error: 'all-failed', message: '画像の読込に失敗しました（5MB 以下、PNG/JPEG/WebP のみ）', errors };
    }
    return { ok: true, dataUrls, errors };
  });

  // ===== STEP 3b: ブラインド構造プリセット IPC =====

  // 同梱プリセットのメタ一覧
  // STEP 10 フェーズB.fix5: structureType も返す（renderer 側の構造型フィルタで参照）
  ipcMain.handle('presets:listBuiltin', () => {
    return BUILTIN_PRESETS.map((p) => ({
      id: p.id, name: p.name, builtin: true, structureType: p.structureType || 'BLIND'
    }));
  });

  // 同梱プリセットの中身
  ipcMain.handle('presets:loadBuiltin', (_event, presetId) => {
    return loadBuiltinPresetById(presetId);
  });

  // ユーザープリセット一覧（メタのみ）
  // STEP 10 フェーズB.fix5: structureType も返す（マイグレーション後は全件補完済）
  ipcMain.handle('presets:listUser', () => {
    const presets = store.get('userPresets') || [];
    return presets.map((p) => ({
      id: p.id, name: p.name, builtin: false,
      structureType: (typeof p.structureType === 'string' && STRUCTURE_TYPES[p.structureType]) ? p.structureType : 'BLIND'
    }));
  });

  // ユーザープリセットの中身
  ipcMain.handle('presets:loadUser', (_event, presetId) => {
    const presets = store.get('userPresets') || [];
    return presets.find((p) => p.id === presetId) || null;
  });

  // ユーザープリセット保存（同 id があれば更新、なければ追加）
  ipcMain.handle('presets:saveUser', (_event, preset) => {
    if (!isValidPreset(preset)) {
      return { ok: false, error: 'invalid-preset' };
    }
    // 同梱プリセットID と衝突する場合は新規 id を強制（誤操作防止）
    const builtinIds = new Set(BUILTIN_PRESETS.map((p) => p.id));
    let id = preset.id;
    if (builtinIds.has(id)) {
      id = `user-${Date.now()}`;
    }
    const presets = store.get('userPresets') || [];
    const idx = presets.findIndex((p) => p.id === id);
    // STEP 6.7: 新規追加時は MAX_USER_PRESETS（100件）上限。同梱4種は対象外（userPresets のみカウント）
    if (idx < 0 && presets.length >= MAX_USER_PRESETS) {
      return { ok: false, error: 'limit-exceeded', message: `ユーザープリセットは ${MAX_USER_PRESETS} 件までです` };
    }
    // STEP 10 フェーズB: structureType も保存（無ければ 'BLIND' で補完）
    const structureType = (typeof preset.structureType === 'string' && STRUCTURE_TYPES[preset.structureType])
      ? preset.structureType : 'BLIND';
    // STEP 10 フェーズC.1-A Fix 3: テンプレ名の JS 側 sanitize（IPC 経由で巨大文字列が来た場合の防御）。
    //   HTML maxlength=50 と二重防御。50 文字を超える分は切り捨て。
    const safeName = String(preset.name).slice(0, 50);
    const sanitized = { id, name: safeName, structureType, levels: preset.levels };
    if (idx >= 0) {
      presets[idx] = sanitized;
    } else {
      presets.push(sanitized);
    }
    store.set('userPresets', presets);
    // v2.0.4-rc20 タスク 1（案 A、問題 ⑥ 根治）:
    // アクティブトーナメントが当該 preset を使っている場合のみ structure を hall に強制 publish。
    // _dualStateCache.structure は v2.0.0 STEP 2 で予約済みの kind 枠（line 963）を活性化する。
    // 既存 tournamentBasics 経路（rc18 第 1 弾の loadPresetById フォールバック）と非干渉。
    // 前原さん判断 ③ c により、進行中レベルの残り時間には影響しない（hall 側 setStructure のみ、timer.js 不変）。
    try {
      const activeId = store.get('activeTournamentId');
      const tournaments = store.get('tournaments') || [];
      const activeT = tournaments.find((x) => x && x.id === activeId);
      if (activeT && activeT.blindPresetId === id) {
        _publishDualState('structure', sanitized);
        // v2.0.4-rc20 タスク 3: 配布版常時記録ラベル（rc18 第 1 弾の 4 ラベルと同パターン）
        try {
          rollingLog('structure:state:send', {
            presetId: id,
            structureLength: sanitized?.levels?.length || 0
          });
        } catch (_) { /* never throw from logging */ }
      }
    } catch (_) { /* never throw from publish */ }
    return { ok: true, id };
  });

  // ユーザープリセット削除（同梱プリセットは削除不可）
  ipcMain.handle('presets:deleteUser', (_event, presetId) => {
    const builtinIds = new Set(BUILTIN_PRESETS.map((p) => p.id));
    if (builtinIds.has(presetId)) {
      return { ok: false, error: 'builtin-cannot-delete' };
    }
    const presets = store.get('userPresets') || [];
    const next = presets.filter((p) => p.id !== presetId);
    store.set('userPresets', next);
    return { ok: true };
  });

  // ===== STEP 3b 拡張: 複数トーナメント IPC =====

  // 既存トーナメント参照に対する blindPresetId バリデーション（同梱 or ユーザー）
  function isValidBlindPresetId(id) {
    if (typeof id !== 'string' || !id) return false;
    const builtinIds = new Set(BUILTIN_PRESETS.map((p) => p.id));
    const userIds = new Set((store.get('userPresets') || []).map((p) => p.id));
    return builtinIds.has(id) || userIds.has(id);
  }

  // フォーム入力（あるいは partial）を正規化したトーナメントへ変換。
  // 旧 `title` キーは互換のため `name` にマップする。
  // 数値の安全変換（Number.isFinite + 非負）
  function toNonNegNumber(v, def) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : def;
  }

  // payouts 配列をバリデート: rank 1..N の連番、percentage 数値、合計 100 を許容範囲（±0.01）
  // v2.1.4 方針 A: amount フィールド（円単位の整数、任意）が有限の非負数値ならば保存。
  //   金額モードでの精度損失（toFixed(2) 丸め）を回避するため、絶対金額を保持する。
  function normalizePayouts(arr, fallback) {
    if (!Array.isArray(arr) || arr.length === 0) return fallback.map((p) => ({ ...p }));
    const cleaned = [];
    for (let i = 0; i < arr.length && cleaned.length < 9; i++) {
      const p = arr[i];
      if (!p || typeof p !== 'object') continue;
      const rank = Math.max(1, Math.floor(Number(p.rank)) || (cleaned.length + 1));
      const pct = toNonNegNumber(p.percentage, 0);
      // v2.1.4: amount は Number.isFinite(n) && n >= 0 のときだけ保存（NaN / 負値 / 文字列は捨てる）
      const amtNum = Number(p.amount);
      const hasAmount = Number.isFinite(amtNum) && amtNum >= 0;
      cleaned.push(hasAmount
        ? { rank, percentage: pct, amount: amtNum }
        : { rank, percentage: pct });
    }
    if (cleaned.length === 0) return fallback.map((p) => ({ ...p }));
    // rank の重複排除＆連番化
    cleaned.sort((a, b) => a.rank - b.rank);
    return cleaned.map((p, idx) => {
      const out = { rank: idx + 1, percentage: p.percentage };
      if ('amount' in p) out.amount = p.amount;
      return out;
    });
  }

  function normalizeTournament(t, fallback = {}) {
    if (!t || typeof t !== 'object') return null;
    const out = { ...fallback };
    if (typeof t.id === 'string' && t.id) out.id = t.id;
    // 旧 title キーも受ける
    const nameSrc = (typeof t.name === 'string' ? t.name : (typeof t.title === 'string' ? t.title : undefined));
    if (typeof nameSrc === 'string' && nameSrc.length <= 60) out.name = nameSrc;
    if (typeof t.subtitle === 'string' && t.subtitle.length <= 60) out.subtitle = t.subtitle;
    if (typeof t.currencySymbol === 'string' && t.currencySymbol.length > 0 && t.currencySymbol.length <= 3) {
      out.currencySymbol = t.currencySymbol;
    }
    if (typeof t.blindPresetId === 'string' && t.blindPresetId.length > 0) {
      if (isValidBlindPresetId(t.blindPresetId)) {
        out.blindPresetId = t.blindPresetId;
      }
    }
    // STEP 6: 拡張フィールド
    // STEP 10 フェーズA: 入力 gameType（旧/新どちらでも）を必ず新コードに正規化して保存
    if (typeof t.gameType === 'string' && t.gameType.length > 0) {
      out.gameType = normalizeGameType(t.gameType);
    }
    if ('startingStack' in t) {
      out.startingStack = toNonNegNumber(t.startingStack, fallback.startingStack ?? DEFAULT_TOURNAMENT_EXT.startingStack);
    }
    if (t.buyIn && typeof t.buyIn === 'object') {
      out.buyIn = {
        fee:   toNonNegNumber(t.buyIn.fee,   fallback.buyIn?.fee   ?? DEFAULT_TOURNAMENT_EXT.buyIn.fee),
        chips: toNonNegNumber(t.buyIn.chips, fallback.buyIn?.chips ?? DEFAULT_TOURNAMENT_EXT.buyIn.chips)
      };
    }
    // STEP 6.9: reentry（旧 rebuy も受ける）
    const reentrySrc = (t.reentry && typeof t.reentry === 'object') ? t.reentry
                     : (t.rebuy   && typeof t.rebuy   === 'object') ? t.rebuy
                     : null;
    if (reentrySrc) {
      out.reentry = {
        fee:   toNonNegNumber(reentrySrc.fee,   fallback.reentry?.fee   ?? DEFAULT_TOURNAMENT_EXT.reentry.fee),
        chips: toNonNegNumber(reentrySrc.chips, fallback.reentry?.chips ?? DEFAULT_TOURNAMENT_EXT.reentry.chips)
      };
    }
    if (t.addOn && typeof t.addOn === 'object') {
      out.addOn = {
        fee:   toNonNegNumber(t.addOn.fee,   fallback.addOn?.fee   ?? DEFAULT_TOURNAMENT_EXT.addOn.fee),
        chips: toNonNegNumber(t.addOn.chips, fallback.addOn?.chips ?? DEFAULT_TOURNAMENT_EXT.addOn.chips)
      };
    }
    if ('payouts' in t) {
      out.payouts = normalizePayouts(t.payouts, fallback.payouts ?? DEFAULT_TOURNAMENT_EXT.payouts);
    }
    // STEP 6.5
    if ('guarantee' in t) {
      out.guarantee = toNonNegNumber(t.guarantee, fallback.guarantee ?? DEFAULT_TOURNAMENT_EXT.guarantee);
    }
    if ('payoutRounding' in t) {
      const n = Number(t.payoutRounding);
      out.payoutRounding = VALID_PAYOUT_ROUNDINGS.includes(n) ? n : (fallback.payoutRounding ?? DEFAULT_TOURNAMENT_EXT.payoutRounding);
    }
    // v2.5.2: 賞金傾斜モード（whitelist 検証。不正値は percent 扱い）
    if ('payoutMode' in t) {
      out.payoutMode = (t.payoutMode === 'amount') ? 'amount' : 'percent';
    }
    // STEP 6.7: 賞金区分（空文字も許容、最大20文字）
    if ('prizeCategory' in t) {
      const s = (typeof t.prizeCategory === 'string') ? t.prizeCategory.slice(0, 20) : '';
      out.prizeCategory = s;
    }
    // STEP 6.17: titleColor（#RRGGBB 形式のみ許可）
    if ('titleColor' in t) {
      const c = (typeof t.titleColor === 'string') ? t.titleColor : '';
      out.titleColor = TITLE_COLOR_RE.test(c) ? c : (fallback.titleColor ?? '#FFFFFF');
    }
    // STEP 10 フェーズC.2.3: customGameName（空文字許可、最大 30 文字）
    if ('customGameName' in t) {
      const s = (typeof t.customGameName === 'string') ? t.customGameName.slice(0, 30) : '';
      out.customGameName = s;
    }
    // STEP 10 フェーズC.2.3: pauseAfterBreak（boolean）
    if ('pauseAfterBreak' in t) {
      out.pauseAfterBreak = Boolean(t.pauseAfterBreak);
    }
    // STEP 6.21: timerState の取り込み（部分更新可、status enum 検証）
    if ('timerState' in t) {
      out.timerState = normalizeTimerState(t.timerState);
    }
    // STEP 10 フェーズC.1.8: runtime の取り込み（部分更新可、整数化 + 負値防止）
    if ('runtime' in t) {
      out.runtime = sanitizeRuntime(t.runtime, fallback.runtime || DEFAULT_TOURNAMENT_EXT.runtime);
    }
    // STEP 6.21.6: displaySettings の取り込み（値域検証）
    // STEP 10 フェーズC.1.3: backgroundImage / backgroundOverlay も同経路で取り込み。
    if ('displaySettings' in t) {
      const ds = t.displaySettings;
      const fb = fallback.displaySettings || DEFAULT_TOURNAMENT_EXT.displaySettings;
      // v2.5.0: backgroundImage / breakImages は imagesStore へ分離（ここでは取り込まない = image-free）。
      //   旧形式 import で画像が混ざっていても無視（前原方針: 画像はローカル専用・PC 間で非引継ぎ）。
      out.displaySettings = {
        background: VALID_BACKGROUNDS.includes(ds?.background) ? ds.background : (fb.background || 'navy'),
        timerFont:  VALID_TIMER_FONTS.includes(ds?.timerFont)   ? ds.timerFont  : (fb.timerFont  || 'jetbrains'),
        backgroundOverlay: sanitizeBackgroundOverlay(ds?.backgroundOverlay, fb.backgroundOverlay || 'mid'),
        breakImageInterval: sanitizeBreakImageInterval(ds?.breakImageInterval, fb.breakImageInterval ?? 10),
        pipSize: sanitizePipSize(ds?.pipSize, fb.pipSize || 'medium')
      };
    }
    // STEP 6.22.1: marqueeSettings の取り込み（値域検証は sanitizeMarqueeSettings）
    if ('marqueeSettings' in t) {
      out.marqueeSettings = sanitizeMarqueeSettings(t.marqueeSettings, fallback.marqueeSettings);
    }
    // STEP 6.9: specialStack
    if (t.specialStack && typeof t.specialStack === 'object') {
      const ss = t.specialStack;
      const fb = fallback.specialStack || DEFAULT_TOURNAMENT_EXT.specialStack;
      out.specialStack = {
        enabled: typeof ss.enabled === 'boolean' ? ss.enabled : (fb.enabled || false),
        label: (typeof ss.label === 'string' ? ss.label : (fb.label || '早期着席特典')).slice(0, 20),
        chips: toNonNegNumber(ss.chips, fb.chips ?? 5000),
        appliedCount: Math.min(999, Math.max(0, Math.floor(toNonNegNumber(ss.appliedCount, fb.appliedCount ?? 0))))
      };
    }
    // v2.4.0: poolRates 取込（部分更新可、sanitize 経由）。v2.6.0 で計算からは外したが dormant 温存
    if (t.poolRates && typeof t.poolRates === 'object') {
      out.poolRates = sanitizePoolRates(
        t.poolRates,
        fallback.poolRates || DEFAULT_TOURNAMENT_EXT.poolRates
      );
    }
    // v2.6.0: potAmounts 取込（店内通貨 $ の1件あたり拠出、部分更新可）
    if (t.potAmounts && typeof t.potAmounts === 'object') {
      out.potAmounts = sanitizePotAmounts(
        t.potAmounts,
        fallback.potAmounts || DEFAULT_TOURNAMENT_EXT.potAmounts
      );
    }

    // 既定値補完
    if (!out.name) out.name = 'ポーカートーナメント';
    if (typeof out.subtitle !== 'string') out.subtitle = '';
    if (typeof out.currencySymbol !== 'string') out.currencySymbol = '$';
    if (typeof out.blindPresetId !== 'string') out.blindPresetId = 'demo-fast';
    // STEP 10 フェーズA: 補完時も必ず新コードに正規化（旧コードが既定値に紛れ込むのを防ぐ）
    out.gameType = normalizeGameType(out.gameType ?? DEFAULT_TOURNAMENT_EXT.gameType);
    if (typeof out.startingStack !== 'number') out.startingStack = DEFAULT_TOURNAMENT_EXT.startingStack;
    if (!out.buyIn)   out.buyIn   = { ...DEFAULT_TOURNAMENT_EXT.buyIn };
    if (!out.reentry) out.reentry = { ...DEFAULT_TOURNAMENT_EXT.reentry };
    if (!out.addOn)   out.addOn   = { ...DEFAULT_TOURNAMENT_EXT.addOn };
    // stack-unify（2026-06-08）: 初期スタックを buyIn.chips に統一。入力（t）も fallback も未 unified の
    //   場合のみ buyIn.chips := startingStack を実施し AVG STACK を保全（旧形式 export の import 救済）。
    //   既 unified（renderer 保存は stackModel='unified' を送る / 既存 store は migration 済）は再変換しない
    //   ＝後続のスタック編集を巻き戻さない。startingStack は dormant 温存。正規化後は必ず unified。
    {
      const wasUnified = (t.stackModel === 'unified') || (fallback.stackModel === 'unified');
      if (!wasUnified) out.buyIn.chips = Number(out.startingStack) || 0;
      out.stackModel = 'unified';
    }
    if (!Array.isArray(out.payouts) || out.payouts.length === 0) {
      out.payouts = DEFAULT_TOURNAMENT_EXT.payouts.map((p) => ({ ...p }));
    }
    if (typeof out.guarantee !== 'number' || out.guarantee < 0) {
      out.guarantee = DEFAULT_TOURNAMENT_EXT.guarantee;
    }
    if (typeof out.payoutRounding !== 'number' || !VALID_PAYOUT_ROUNDINGS.includes(out.payoutRounding)) {
      out.payoutRounding = DEFAULT_TOURNAMENT_EXT.payoutRounding;
    }
    // v2.5.2: payoutMode 既定補完（fallback 優先、なければ percent）
    if (out.payoutMode !== 'amount' && out.payoutMode !== 'percent') {
      out.payoutMode = (fallback.payoutMode === 'amount' || fallback.payoutMode === 'percent')
        ? fallback.payoutMode : 'percent';
    }
    if (typeof out.prizeCategory !== 'string') out.prizeCategory = '';
    if (!out.specialStack || typeof out.specialStack !== 'object') {
      out.specialStack = { ...DEFAULT_TOURNAMENT_EXT.specialStack };
    }
    if (typeof out.titleColor !== 'string' || !TITLE_COLOR_RE.test(out.titleColor)) {
      out.titleColor = '#FFFFFF';
    }
    // STEP 10 フェーズC.2.3: customGameName / pauseAfterBreak の既定補完
    if (typeof out.customGameName !== 'string') out.customGameName = '';
    if (typeof out.pauseAfterBreak !== 'boolean') out.pauseAfterBreak = false;
    // v2.4.0: poolRates 既定補完
    //   優先順位: out.poolRates（取込済）> fallback.poolRates（既存上書き時の旧値）>
    //             appConfig.poolRatesDefault（新規作成時、store.defaults で 0%）>
    //             DEFAULT_TOURNAMENT_EXT.poolRates（最終 fallback、100%）
    //   経路: 既存上書き save → fallback=list[idx] で 100% 維持、新規 save → fallback={id} で 0% 採用
    if (!out.poolRates || typeof out.poolRates !== 'object') {
      const fbRates = (fallback.poolRates && typeof fallback.poolRates === 'object')
        ? fallback.poolRates
        : ((store.get('appConfig') || {}).poolRatesDefault || { buyIn: 0, reentry: 0, addOn: 0 });
      out.poolRates = sanitizePoolRates(undefined, fbRates);
    }
    // v2.6.0: potAmounts 既定補完（優先: 取込済 > fallback.potAmounts > appConfig.potDefaults > DEFAULT=0）。
    //   新規 save（fallback={id}）は potDefaults（0）採用、既存上書き（fallback=list[idx]）は旧 POT 維持。
    if (!out.potAmounts || typeof out.potAmounts !== 'object') {
      const fbPot = (fallback.potAmounts && typeof fallback.potAmounts === 'object')
        ? fallback.potAmounts
        : ((store.get('appConfig') || {}).potDefaults || { buyIn: 0, reentry: 0, addOn: 0 });
      out.potAmounts = sanitizePotAmounts(undefined, fbPot);
    }
    // STEP 6.21: timerState 既定補完
    out.timerState = normalizeTimerState(out.timerState ?? fallback.timerState);
    // STEP 10 フェーズC.1.8: runtime 既定補完
    out.runtime = sanitizeRuntime(out.runtime ?? fallback.runtime, DEFAULT_TOURNAMENT_EXT.runtime);
    // STEP 6.21.6: displaySettings 既定補完
    // STEP 10 フェーズC.1.3: backgroundImage / backgroundOverlay も補完
    if (!out.displaySettings || typeof out.displaySettings !== 'object') {
      const fb = fallback.displaySettings || getDefaultDisplaySettings();
      // v2.5.0: image-free（backgroundImage / breakImages は imagesStore へ分離）
      out.displaySettings = {
        background: VALID_BACKGROUNDS.includes(fb.background) ? fb.background : 'navy',
        timerFont:  VALID_TIMER_FONTS.includes(fb.timerFont)   ? fb.timerFont  : 'jetbrains',
        backgroundOverlay: VALID_BG_OVERLAYS.includes(fb.backgroundOverlay) ? fb.backgroundOverlay : 'mid',
        breakImageInterval: sanitizeBreakImageInterval(fb.breakImageInterval, 10),
        pipSize: sanitizePipSize(fb.pipSize, 'medium')
      };
    }
    // STEP 6.22.1: marqueeSettings 既定補完（fallback または現グローバル marquee）
    out.marqueeSettings = sanitizeMarqueeSettings(
      out.marqueeSettings,
      fallback.marqueeSettings || sanitizeMarqueeSettings(store.get('marquee'), null)
    );
    return out;
  }

  // 旧 API 互換用: active トーナメントを title 別名つきで返す
  function getActiveTournamentWithAliases() {
    const id = store.get('activeTournamentId');
    const list = store.get('tournaments') || [];
    const found = list.find((t) => t.id === id) || list[0] || null;
    if (!found) return null;
    // v2.5.0: displaySettings に imagesStore の画像を再マージ（applyTournament の画像反映経路を無改造で動かす）
    return { ...found, title: found.name, displaySettings: mergeImagesIntoDisplaySettings(found.id, found.displaySettings) };
  }

  // 一覧（フル）— STEP 6 で追加した拡張フィールドも含めて返す
  ipcMain.handle('tournaments:list', () => {
    return (store.get('tournaments') || []).map((t) => ({
      id: t.id,
      name: t.name,
      subtitle: t.subtitle,
      currencySymbol: t.currencySymbol,
      blindPresetId: t.blindPresetId,
      gameType: t.gameType ?? DEFAULT_TOURNAMENT_EXT.gameType,
      startingStack: t.startingStack ?? DEFAULT_TOURNAMENT_EXT.startingStack,
      buyIn:   t.buyIn   ?? { ...DEFAULT_TOURNAMENT_EXT.buyIn },
      // STEP 6.9: rebuy フォールバック互換（旧データが残っている場合）
      reentry: t.reentry ?? (t.rebuy ? { fee: t.rebuy.fee || 0, chips: t.rebuy.chips || 0 } : { ...DEFAULT_TOURNAMENT_EXT.reentry }),
      addOn:   t.addOn   ?? { ...DEFAULT_TOURNAMENT_EXT.addOn },
      payouts: Array.isArray(t.payouts) && t.payouts.length > 0
        ? t.payouts.map((p) => ({ ...p }))
        : DEFAULT_TOURNAMENT_EXT.payouts.map((p) => ({ ...p })),
      guarantee: t.guarantee ?? DEFAULT_TOURNAMENT_EXT.guarantee,
      payoutRounding: t.payoutRounding ?? DEFAULT_TOURNAMENT_EXT.payoutRounding,
      // v2.5.2: 賞金傾斜モード（renderer applyTournament が読む）
      payoutMode: (t.payoutMode === 'amount' || t.payoutMode === 'percent') ? t.payoutMode : 'percent',
      prizeCategory: typeof t.prizeCategory === 'string' ? t.prizeCategory : '',
      specialStack: t.specialStack ?? { ...DEFAULT_TOURNAMENT_EXT.specialStack },
      // v2.4.0: poolRates 同梱（renderer 側 applyTournament が読む）。v2.6.0 で dormant だが温存
      poolRates: sanitizePoolRates(t.poolRates, DEFAULT_TOURNAMENT_EXT.poolRates),
      // v2.6.0: potAmounts 同梱（renderer 側 applyTournament が読む。pool = Σ(POT × 件数)）
      potAmounts: sanitizePotAmounts(t.potAmounts, DEFAULT_TOURNAMENT_EXT.potAmounts),
      // STEP 6.17
      titleColor: TITLE_COLOR_RE.test(t.titleColor || '') ? t.titleColor : '#FFFFFF',
      // STEP 10 フェーズC.2.3
      customGameName: typeof t.customGameName === 'string' ? t.customGameName.slice(0, 30) : '',
      pauseAfterBreak: Boolean(t.pauseAfterBreak),
      // STEP 6.21
      timerState: normalizeTimerState(t.timerState),
      // STEP 10 フェーズC.1.8: runtime 永続化
      runtime: sanitizeRuntime(t.runtime, DEFAULT_TOURNAMENT_EXT.runtime),
      // STEP 6.21.6: トーナメント別表示設定（背景・時計フォント）
      // STEP 10 フェーズC.1.3: backgroundImage / backgroundOverlay も同梱
      // STEP 10 フェーズC.1.4: breakImages / breakImageInterval / pipSize も同梱
      displaySettings: (() => {
        const ds = t.displaySettings || {};
        // v2.5.0: backgroundImage / breakImages は返さない（毎秒走る hot path を軽量化＝重さの根治）。
        //   画像が要る経路（loadTournamentIntoForm 等）は tournaments:getImages で別途取得する。
        return {
          background: VALID_BACKGROUNDS.includes(ds.background) ? ds.background : 'navy',
          timerFont:  VALID_TIMER_FONTS.includes(ds.timerFont)   ? ds.timerFont  : 'jetbrains',
          backgroundOverlay: sanitizeBackgroundOverlay(ds.backgroundOverlay, 'mid'),
          breakImageInterval: sanitizeBreakImageInterval(ds.breakImageInterval, 10),
          pipSize: sanitizePipSize(ds.pipSize, 'medium')
        };
      })(),
      // STEP 6.22.1: トーナメント別テロップ設定
      marqueeSettings: sanitizeMarqueeSettings(t.marqueeSettings, sanitizeMarqueeSettings(store.get('marquee'), null))
    }));
  });

  // active 取得
  ipcMain.handle('tournaments:getActive', () => getActiveTournamentWithAliases());

  // v2.5.0: 指定トーナメントの画像（背景 / 休憩スライドショー）を tournament-images.json から取得。
  //   tournaments:list は image-free のため、画像が要る経路（loadTournamentIntoForm 等）が id 指定で取り直す。
  ipcMain.handle('tournaments:getImages', (_event, id) => getTournamentImages(id));

  // active 切替（id が存在することを確認）
  ipcMain.handle('tournaments:setActive', (_event, id) => {
    // v2.0.14 Fix 1（M8 / C-2）: HDMI 切替中の旧 window 由来 IPC が新 window state を
    //   踏み潰すのを防ぐ。setTimerState（L2139）と同等のガードを追加。
    if (_isSwitchingMode) return null;
    const list = store.get('tournaments') || [];
    const found = list.find((t) => t.id === id);
    if (!found) return null;
    store.set('activeTournamentId', id);
    // v2.0.0 STEP 2: active 切替を hall に full snapshot で broadcast（kind ごとに個別配信）
    _publishDualState('tournamentBasics', {
      id: found.id, name: found.name, subtitle: found.subtitle,
      titleColor: found.titleColor, blindPresetId: found.blindPresetId
    });
    if (found.timerState)        _publishDualState('timerState',         normalizeTimerState(found.timerState));
    // v2.5.0: hall へは画像を再マージした displaySettings を配信（hall 表示で画像が消えないように）
    if (found.displaySettings)   _publishDualState('displaySettings',    mergeImagesIntoDisplaySettings(found.id, found.displaySettings));
    if (found.marqueeSettings)   _publishDualState('marqueeSettings',    found.marqueeSettings);
    if (found.runtime)           _publishDualState('tournamentRuntime',  found.runtime);
    // v2.1.14 Fix R1（穴 2 根治）: トーナメント切替時にも構造を hall に broadcast。
    //   hall 側 renderer.js:7137-7146 の `loadPresetById` fallback は無傷で残置（保険）。
    //   structure broadcast は冪等なので race による副作用なし
    //   （setStructure が同データで 2 回呼ばれても結果同じ、blinds.js:20-26）。
    //   前原さん判断 ③ c により、進行中レベルの残り時間には影響しない（hall 側 setStructure のみ、timer.js 不変）。
    if (typeof found.blindPresetId === 'string' && found.blindPresetId) {
      try {
        const userPresets = store.get('userPresets') || [];
        const preset = userPresets.find((p) => p.id === found.blindPresetId)
          || BUILTIN_PRESETS.find((p) => p.id === found.blindPresetId);
        if (preset && Array.isArray(preset.levels)) {
          _publishDualState('structure', preset);
        }
      } catch (_) { /* never throw from broadcast */ }
    }
    // v2.5.0: 戻り値の displaySettings に画像を再マージ（applyTournament 経路を無改造で動かす）
    return { ...found, title: found.name, displaySettings: mergeImagesIntoDisplaySettings(found.id, found.displaySettings) };
  });

  // 保存（同 id があれば更新、なければ追加）
  // STEP 6.7: 新規追加時は MAX_TOURNAMENTS（100件）上限を超えないようガード。
  //           既存IDの上書きはカウントに影響しないため常に許可。
  ipcMain.handle('tournaments:save', (_event, t) => {
    // v2.0.15 Fix 1（H1 Edge-1）: HDMI 切替中の旧 window 由来 IPC が新 window state を踏み潰すのを防ぐ
    if (_isSwitchingMode) return { ok: false, error: 'switching-mode' };
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id) {
      return { ok: false, error: 'invalid-tournament' };
    }
    const list = store.get('tournaments') || [];
    const idx = list.findIndex((x) => x.id === t.id);
    if (idx < 0 && list.length >= MAX_TOURNAMENTS) {
      return { ok: false, error: 'limit-exceeded', message: `トーナメントは ${MAX_TOURNAMENTS} 件までです` };
    }
    const fallback = idx >= 0 ? list[idx] : { id: t.id };
    const validated = normalizeTournament(t, fallback);
    if (!validated) return { ok: false, error: 'invalid-tournament' };
    if (idx >= 0) list[idx] = validated;
    else list.push(validated);
    store.set('tournaments', list);
    // v2.0.0 STEP 2: 保存対象が active トーナメントなら hall に basics + displaySettings + marquee を再送
    if (validated.id === store.get('activeTournamentId')) {
      // v2.0.4-rc19 タスク 2（問題 ⑥ 残部、案 ⑥-A）:
      // hall 側の loadPresetById IPC 2 段化を回避するため、structure を payload に直接同梱。
      // hall 受信側で value.structure があれば setStructure を直接呼び、無ければ既存フォールバック。
      // v2.0.4-rc20 (c) 並存方針: 本 structure フィールドは normalizeTournament が t.structure を
      // out に伝播しないため現在常に undefined となる dead code。rc20 タスク 1 で案 A の
      // `_publishDualState('structure', sanitized)`（presets:saveUser ハンドラ末尾）に置換済。
      // 履歴保護 + 将来 normalizeTournament 修正時の自動有効化保険のため残置。
      _publishDualState('tournamentBasics', {
        id: validated.id, name: validated.name, subtitle: validated.subtitle,
        titleColor: validated.titleColor, blindPresetId: validated.blindPresetId,
        structure: validated.structure
      });
      // v2.5.0: hall へは画像を再マージした displaySettings を配信
      if (validated.displaySettings)  _publishDualState('displaySettings', mergeImagesIntoDisplaySettings(validated.id, validated.displaySettings));
      if (validated.marqueeSettings)  _publishDualState('marqueeSettings', validated.marqueeSettings);
      if (validated.runtime)          _publishDualState('tournamentRuntime', validated.runtime);
    }
    // v2.5.0: 戻り値の displaySettings に画像を再マージ（applyTournament 経路を無改造で動かす）
    return { ok: true, tournament: { ...validated, title: validated.name, displaySettings: mergeImagesIntoDisplaySettings(validated.id, validated.displaySettings) } };
  });

  // STEP 6.21: timerState のみを部分更新（性能のため normalizeTournament を通さない）
  ipcMain.handle('tournaments:setTimerState', (_event, payload) => {
    // v2.0.4-rc9 Fix 1-B: HDMI 切替（switchOperatorToSolo / switchSoloToOperator）中は
    //   旧 window 由来の遅延した IPC が新 window state を踏み潰すため、ガードして無視する。
    //   切替完了後は通常の subscribe 経路で state が再同期されるため副作用なし。
    if (_isSwitchingMode) return { ok: false, error: 'switching-mode' };
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'invalid-payload' };
    const { id, timerState } = payload;
    if (typeof id !== 'string' || !id) return { ok: false, error: 'invalid-id' };
    const list = store.get('tournaments') || [];
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return { ok: false, error: 'not-found' };
    const next = { ...list[idx], timerState: normalizeTimerState(timerState) };
    list[idx] = next;
    store.set('tournaments', list);
    // v2.0.0 STEP 2: hall に timerState 差分を broadcast（active トーナメントのみ）
    if (id === store.get('activeTournamentId')) {
      _publishDualState('timerState', next.timerState);
    }
    return { ok: true, tournament: { ...next, title: next.name } };
  });

  // STEP 10 フェーズC.1.8: runtime（playersInitial / Remaining / reentryCount / addOnCount）の部分更新。
  //   renderer 側で値が変わるたびに呼ばれる（debounce 500ms）。
  //   アプリ終了 → 再起動でランタイムが消失する重大バグの修正。
  ipcMain.handle('tournaments:setRuntime', (_event, payload) => {
    // v2.0.15 Fix 1（H1 Edge-1）: HDMI 切替中の旧 window 由来 IPC が新 window state を踏み潰すのを防ぐ
    if (_isSwitchingMode) return { ok: false, error: 'switching-mode' };
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'invalid-payload' };
    const { id, runtime } = payload;
    if (typeof id !== 'string' || !id) return { ok: false, error: 'invalid-id' };
    const list = store.get('tournaments') || [];
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return { ok: false, error: 'not-found' };
    const cur = list[idx].runtime || DEFAULT_TOURNAMENT_EXT.runtime;
    const next = sanitizeRuntime(runtime, cur);
    list[idx] = { ...list[idx], runtime: next };
    store.set('tournaments', list);
    // v2.0.0 STEP 2: hall に runtime 差分を broadcast（active トーナメントのみ）
    if (id === store.get('activeTournamentId')) {
      _publishDualState('tournamentRuntime', next);
    }
    return { ok: true, runtime: next };
  });

  // STEP 6.22.1: marqueeSettings のみを部分更新（テロップ enabled/text/speed の即時保存用）
  ipcMain.handle('tournaments:setMarqueeSettings', (_event, payload) => {
    // v2.0.15 Fix 1（H1 Edge-1）: HDMI 切替中の旧 window 由来 IPC が新 window state を踏み潰すのを防ぐ
    if (_isSwitchingMode) return { ok: false, error: 'switching-mode' };
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'invalid-payload' };
    const { id, marqueeSettings } = payload;
    if (typeof id !== 'string' || !id) return { ok: false, error: 'invalid-id' };
    const list = store.get('tournaments') || [];
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return { ok: false, error: 'not-found' };
    const cur = list[idx].marqueeSettings || { enabled: true, text: '', speed: 'normal' };
    const next = sanitizeMarqueeSettings(marqueeSettings, cur);
    list[idx] = { ...list[idx], marqueeSettings: next };
    store.set('tournaments', list);
    // v2.0.0 STEP 2: hall にテロップ設定差分を broadcast（active トーナメントのみ）
    if (id === store.get('activeTournamentId')) {
      _publishDualState('marqueeSettings', next);
    }
    return { ok: true, marqueeSettings: next };
  });

  // STEP 6.21.6: displaySettings のみを部分更新（背景プリセット / タイマーフォントの即時保存用）
  // STEP 10 フェーズC.1.3: backgroundImage / backgroundOverlay も部分更新可能
  ipcMain.handle('tournaments:setDisplaySettings', (_event, payload) => {
    // v2.0.15 Fix 1（H1 Edge-1）: HDMI 切替中の旧 window 由来 IPC が新 window state を踏み潰すのを防ぐ
    if (_isSwitchingMode) return { ok: false, error: 'switching-mode' };
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'invalid-payload' };
    const { id, displaySettings } = payload;
    if (typeof id !== 'string' || !id) return { ok: false, error: 'invalid-id' };
    const list = store.get('tournaments') || [];
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return { ok: false, error: 'not-found' };
    const cur = list[idx].displaySettings || {};
    const ds = displaySettings || {};
    // v2.5.0: 画像 2 フィールド（backgroundImage / breakImages）は tournament-images.json へ分離して保存。
    //   tournaments 配列には書かない（毎操作の全件書込から画像を外す＝重さの根治）。
    //   サイズ超過は error で返し、永続化しない（従来挙動維持）。
    const imagePatch = {};
    if ('backgroundImage' in ds) {
      const sanImage = sanitizeBackgroundImage(ds.backgroundImage, getTournamentImages(id).backgroundImage);
      if (sanImage === null) {
        return { ok: false, error: 'image-too-large', message: '画像が大きすぎます（5MB 以下）' };
      }
      imagePatch.backgroundImage = sanImage;
    }
    if ('breakImages' in ds) {
      imagePatch.breakImages = ds.breakImages;   // sanitize は setTournamentImages 内
    }
    if (Object.keys(imagePatch).length > 0) {
      setTournamentImages(id, imagePatch);
    }
    // 非画像フィールドのみ tournaments へ（image-free・軽量）
    const nextDs = {
      background: VALID_BACKGROUNDS.includes(ds.background) ? ds.background : (cur.background || 'navy'),
      timerFont:  VALID_TIMER_FONTS.includes(ds.timerFont)   ? ds.timerFont  : (cur.timerFont  || 'jetbrains'),
      backgroundOverlay: ('backgroundOverlay' in ds)
        ? sanitizeBackgroundOverlay(ds.backgroundOverlay, cur.backgroundOverlay || 'mid')
        : (VALID_BG_OVERLAYS.includes(cur.backgroundOverlay) ? cur.backgroundOverlay : 'mid'),
      breakImageInterval: ('breakImageInterval' in ds)
        ? sanitizeBreakImageInterval(ds.breakImageInterval, cur.breakImageInterval ?? 10)
        : sanitizeBreakImageInterval(cur.breakImageInterval, 10),
      pipSize: ('pipSize' in ds)
        ? sanitizePipSize(ds.pipSize, cur.pipSize || 'medium')
        : sanitizePipSize(cur.pipSize, 'medium')
    };
    list[idx] = { ...list[idx], displaySettings: nextDs };
    store.set('tournaments', list);
    // 戻り値・broadcast は画像を再マージした displaySettings（renderer の res.displaySettings.breakImages 読戻し / hall 表示と整合）
    const merged = mergeImagesIntoDisplaySettings(id, nextDs);
    if (id === store.get('activeTournamentId')) {
      _publishDualState('displaySettings', merged);
    }
    return { ok: true, displaySettings: merged };
  });

  // ===== STEP 6.23: PC間データ移行 IPC =====
  // 単体エクスポート（active 1 件 + 参照プリセット 0〜1 件）
  ipcMain.handle('tournaments:exportSingle', (_event, tournamentId) => {
    const list = store.get('tournaments') || [];
    const t = list.find((x) => x.id === tournamentId);
    if (!t) return { ok: false, error: 'not-found' };
    const userPresets = store.get('userPresets') || [];
    const builtinIds = new Set(BUILTIN_PRESETS.map((p) => p.id));
    // builtin 参照は同梱済のため除外、user 参照のみ同梱
    const linkedPresets = builtinIds.has(t.blindPresetId)
      ? []
      : userPresets.filter((p) => p.id === t.blindPresetId);
    return { ok: true, payload: buildExportPayload('single', [t], linkedPresets) };
  });

  // 一括エクスポート（全 tournaments + 全 userPresets）
  ipcMain.handle('tournaments:exportBulk', () => {
    const tournaments = store.get('tournaments') || [];
    const userPresets = store.get('userPresets') || [];
    return { ok: true, payload: buildExportPayload('bulk', tournaments, userPresets) };
  });

  // ファイル書き込み（OS 保存ダイアログ経由）
  ipcMain.handle('tournaments:writeExportFile', async (_event, payload, defaultFileName) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no-window' };
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'エクスポート先を選択',
      defaultPath: defaultFileName || 'pokertimerplus-export.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, error: 'canceled' };
    try {
      fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
      return { ok: true, filePath: result.filePath };
    } catch (err) {
      return { ok: false, error: 'write-failed', message: err.message };
    }
  });

  // ファイル読み込み（OS 選択ダイアログ経由）
  ipcMain.handle('tournaments:readImportFile', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no-window' };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'インポート元ファイルを選択',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths?.[0]) return { ok: false, error: 'canceled' };
    try {
      // v2.1.0 Fix 3 (M8 Edge-3): import 前に size 上限（50MB）チェック、巨大 JSON で OOM 予防
      const stat = fs.statSync(result.filePaths[0]);
      if (stat.size > 50 * 1024 * 1024) return { ok: false, error: 'file-too-large', message: 'インポートファイルは 50MB 以下にしてください' };
      const raw = fs.readFileSync(result.filePaths[0], 'utf8');
      // STEP 10 フェーズC.2.7-audit-fix: UTF-8 BOM 混入対策（外部由来の JSON で先頭 0xFEFF が混じることがある）
      const cleaned = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
      const payload = JSON.parse(cleaned);
      const v = validateImportPayload(payload);
      if (!v.ok) return v;
      return { ok: true, payload };
    } catch (err) {
      return { ok: false, error: 'parse-failed', message: err.message };
    }
  });

  // 取り込み実行（renderer 側で _action 付きペイロードを構築して送る）
  // params: { tournaments: [{ ...t, _action: 'overwrite'|'rename'|'skip' }], userPresets: [...] }
  ipcMain.handle('tournaments:importPayload', (_event, params) => {
    if (!params || typeof params !== 'object') return { ok: false, error: 'invalid-params' };
    const tournaments = store.get('tournaments') || [];
    const userPresets = store.get('userPresets') || [];

    let importedT = 0, importedP = 0;
    let skippedByLimit = 0;

    // userPresets は tournaments より先に書き込む（blindPresetId 参照解決のため）
    for (const p of params.userPresets || []) {
      if (p._action === 'skip') continue;
      // STEP 10 フェーズB: structureType も import に含める
      const importedStructureType = (typeof p.structureType === 'string' && STRUCTURE_TYPES[p.structureType])
        ? p.structureType : 'BLIND';
      const cleaned = { id: p.id, name: p.name, structureType: importedStructureType, levels: p.levels };
      if (!isValidPreset(cleaned)) continue;
      if (p._action === 'rename') {
        cleaned.id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        cleaned.name = `${cleaned.name} (コピー)`;
      }
      const idx = userPresets.findIndex((x) => x.id === cleaned.id);
      // ユーザープリセット上限チェック（追加時のみ）
      if (idx < 0 && userPresets.length >= MAX_USER_PRESETS) continue;
      if (idx >= 0) userPresets[idx] = cleaned;
      else userPresets.push(cleaned);
      importedP += 1;
    }

    for (const t of params.tournaments || []) {
      if (t._action === 'skip') continue;
      // _action は normalizeTournament の対象外フィールドだが、無害（ignored）
      let normalized = normalizeTournament(t, t);
      if (!normalized) continue;
      if (t._action === 'rename') {
        normalized = {
          ...normalized,
          id: `tournament-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: `${normalized.name} (コピー)`
        };
      }
      const idx = tournaments.findIndex((x) => x.id === normalized.id);
      if (idx >= 0) {
        tournaments[idx] = normalized;
        importedT += 1;
      } else if (tournaments.length < MAX_TOURNAMENTS) {
        tournaments.push(normalized);
        importedT += 1;
      } else {
        skippedByLimit += 1;
      }
    }

    store.set('tournaments', tournaments);
    store.set('userPresets', userPresets);
    // v2.0.1 Fix B2: インポート後に active トーナメントの最新状態を hall に broadcast
    const activeIdAfterImport = store.get('activeTournamentId');
    const activeAfterImport = tournaments.find((t) => t.id === activeIdAfterImport);
    if (activeAfterImport) {
      _publishDualState('tournamentBasics', {
        id: activeAfterImport.id, name: activeAfterImport.name, subtitle: activeAfterImport.subtitle,
        titleColor: activeAfterImport.titleColor, blindPresetId: activeAfterImport.blindPresetId
      });
      if (activeAfterImport.timerState)      _publishDualState('timerState',        normalizeTimerState(activeAfterImport.timerState));
      if (activeAfterImport.displaySettings) _publishDualState('displaySettings',   mergeImagesIntoDisplaySettings(activeAfterImport.id, activeAfterImport.displaySettings));
      if (activeAfterImport.marqueeSettings) _publishDualState('marqueeSettings',   activeAfterImport.marqueeSettings);
      if (activeAfterImport.runtime)         _publishDualState('tournamentRuntime', activeAfterImport.runtime);
    }
    return { ok: true, importedTournaments: importedT, importedPresets: importedP, skippedByLimit };
  });

  // 削除（最後の1個は削除不可）
  ipcMain.handle('tournaments:delete', (_event, id) => {
    let list = store.get('tournaments') || [];
    if (list.length <= 1) return { ok: false, error: 'last-tournament' };
    if (!list.find((t) => t.id === id)) return { ok: false, error: 'not-found' };
    list = list.filter((t) => t.id !== id);
    store.set('tournaments', list);
    // v2.5.0: 削除トーナメントの画像も tournament-images.json から後片付け（孤児防止）
    deleteTournamentImages(id);
    if (store.get('activeTournamentId') === id) {
      store.set('activeTournamentId', list[0].id);
    }
    // v2.0.1 Fix B2: active が変わった（または active が削除された）場合、hall に新 active を broadcast
    const newActiveId = store.get('activeTournamentId');
    const newActive = list.find((t) => t.id === newActiveId);
    if (newActive) {
      _publishDualState('tournamentBasics', {
        id: newActive.id, name: newActive.name, subtitle: newActive.subtitle,
        titleColor: newActive.titleColor, blindPresetId: newActive.blindPresetId
      });
      if (newActive.timerState)      _publishDualState('timerState',        normalizeTimerState(newActive.timerState));
      if (newActive.displaySettings) _publishDualState('displaySettings',   mergeImagesIntoDisplaySettings(newActive.id, newActive.displaySettings));
      if (newActive.marqueeSettings) _publishDualState('marqueeSettings',   newActive.marqueeSettings);
      if (newActive.runtime)         _publishDualState('tournamentRuntime', newActive.runtime);
    }
    return { ok: true, activeId: newActiveId };
  });

  // ===== 旧 API 互換: tournament:get / tournament:set は active を読み書き =====
  ipcMain.handle('tournament:get', () => getActiveTournamentWithAliases());

  // ===== STEP 4: 通知音設定 IPC =====
  ipcMain.handle('audio:get', () => store.get('audio'));
  ipcMain.handle('audio:set', (_event, partial) => {
    if (!partial || typeof partial !== 'object') return store.get('audio');
    const current = store.get('audio') || {};
    const merged = { ...current, ...partial };
    if (typeof merged.masterVolume === 'number') {
      merged.masterVolume = Math.max(0, Math.min(1, merged.masterVolume));
    } else {
      merged.masterVolume = current.masterVolume ?? 0.8;
    }
    // 各 enabled は boolean 強制
    for (const k of ['warning1MinEnabled', 'warning10SecEnabled', 'countdown5SecEnabled',
                     'levelEndEnabled', 'breakEndEnabled', 'startEnabled', 'reverbEnabled']) {
      if (k in merged) merged[k] = Boolean(merged[k]);
      else merged[k] = current[k] ?? true;
    }
    // 音色バリアント（STEP 4 仕上げ④）: enum 検証
    for (const k of ['levelEndVariant', 'countdownTickVariant']) {
      if (typeof merged[k] === 'string' && VALID_VARIANTS.includes(merged[k])) {
        // OK
      } else {
        merged[k] = current[k] && VALID_VARIANTS.includes(current[k]) ? current[k] : 'default';
      }
    }
    // tournament-start-voice: 開始ボイス enum 検証（不正は current → さらに不正なら 'off' の二段ガード）
    if (typeof merged.startVoice === 'string' && VALID_START_VOICES.includes(merged.startVoice)) {
      // OK
    } else {
      merged.startVoice = (typeof current.startVoice === 'string' && VALID_START_VOICES.includes(current.startVoice))
        ? current.startVoice : 'off';
    }
    store.set('audio', merged);
    // v2.0.0 STEP 2: hall に audio 設定を broadcast（音はホール側で鳴る想定、設定読込は hall で初期化）
    _publishDualState('audioSettings', merged);
    return merged;
  });

  // ===== STEP 10 フェーズC.2.7-audit-fix: powerSaveBlocker IPC =====
  //   RUNNING 中はディスプレイスリープを抑止。renderer の subscribe で start/stop を切替。
  //   blocker ID は単一保持、二重 start は no-op。終了時に確実に解放。
  let _powerSaveBlockerId = null;
  ipcMain.handle('power:preventDisplaySleep', () => {
    try {
      if (_powerSaveBlockerId !== null && powerSaveBlocker.isStarted(_powerSaveBlockerId)) {
        return { ok: true, alreadyActive: true };
      }
      _powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
      // v2.2.2 hotfix Phase 2 第 1 段階: blocker 状態変化を観測ログに記録
      try { rollingLog('power:blocker:display-sleep:start', { blockerId: _powerSaveBlockerId, perfNow: Date.now() }); } catch (_) {}
      return { ok: true, alreadyActive: false };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('power:allowDisplaySleep', () => {
    try {
      if (_powerSaveBlockerId !== null && powerSaveBlocker.isStarted(_powerSaveBlockerId)) {
        powerSaveBlocker.stop(_powerSaveBlockerId);
        // v2.2.2 hotfix Phase 2 第 1 段階: blocker 状態変化を観測ログに記録
        try { rollingLog('power:blocker:display-sleep:stop', { blockerId: _powerSaveBlockerId, perfNow: Date.now() }); } catch (_) {}
      }
      _powerSaveBlockerId = null;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // v2.2.2 hotfix Phase 2 第 1 段階 §B: prevent-app-suspension 並行採用
  //   仮説 F（Windows OS レベルのプロセス suspension）対策。PRE_START 中のみ発火、終了時に即解除。
  //   既存 _powerSaveBlockerId（display-sleep 用）とは別の blocker ID で並行管理 = 副作用ゼロ。
  //   Electron 公式仕様: powerSaveBlocker.start('prevent-app-suspension') は Windows / macOS で動作、
  //   Linux は no-op（ただし副作用なし）。Phase 3 真因確定後に必要に応じて維持 or 撤去。
  let _appSuspensionBlockerId = null;
  ipcMain.handle('power:preventAppSuspension', () => {
    try {
      if (_appSuspensionBlockerId !== null && powerSaveBlocker.isStarted(_appSuspensionBlockerId)) {
        return { ok: true, alreadyActive: true };
      }
      _appSuspensionBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      try { rollingLog('power:blocker:app-suspension:start', { blockerId: _appSuspensionBlockerId, perfNow: Date.now() }); } catch (_) {}
      return { ok: true, alreadyActive: false };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('power:allowAppSuspension', () => {
    try {
      if (_appSuspensionBlockerId !== null && powerSaveBlocker.isStarted(_appSuspensionBlockerId)) {
        powerSaveBlocker.stop(_appSuspensionBlockerId);
        try { rollingLog('power:blocker:app-suspension:stop', { blockerId: _appSuspensionBlockerId, perfNow: Date.now() }); } catch (_) {}
      }
      _appSuspensionBlockerId = null;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  // v2.0.3 P4 fix: アプリ終了時のクリーンアップを 1 ハンドラに統合
  //   旧構造: powerSaveBlocker 解放（ここ）+ globalShortcut.unregisterAll（whenReady の外）の 2 個別登録。
  //   保守性のため 1 つにまとめ、漏れ・重複登録のリスクを排除。
  app.on('will-quit', () => {
    // v2.0.4-rc15 タスク 2: 終了直前にイベント記録 + 切捨タイマー停止
    rollingLog('app:before-quit', null);
    try {
      if (_rollingLogTruncateTimer !== null) {
        clearInterval(_rollingLogTruncateTimer);
        _rollingLogTruncateTimer = null;
      }
    } catch (_) { /* ignore */ }
    try {
      if (_powerSaveBlockerId !== null && powerSaveBlocker.isStarted(_powerSaveBlockerId)) {
        powerSaveBlocker.stop(_powerSaveBlockerId);
      }
    } catch (_) { /* ignore */ }
    _powerSaveBlockerId = null;
    // v2.2.2 hotfix Phase 2 第 1 段階: app-suspension blocker も終了時に確実に解放
    try {
      if (_appSuspensionBlockerId !== null && powerSaveBlocker.isStarted(_appSuspensionBlockerId)) {
        powerSaveBlocker.stop(_appSuspensionBlockerId);
      }
    } catch (_) { /* ignore */ }
    _appSuspensionBlockerId = null;
    // 2 つ目の will-quit ハンドラから統合
    try { globalShortcut.unregisterAll(); } catch (_) { /* ignore */ }
    // remote-control Phase 1a: 遠隔操作サーバが稼働中なら終了時に閉じる（fire-and-forget）。
    try { stopRemoteServer(); } catch (_) { /* ignore */ }
    // v2.0.4-rc18 第 1 弾 タスク 3: 終了直前に最終 flush（fire-and-forget、5,000 件 buffer × 5 分 retention）
    try { _flushRollingLog(); } catch (_) { /* never throw from logging */ }
  });

  ipcMain.handle('tournament:set', (_event, partial) => {
    // v2.0.15 Fix 1（H1 Edge-1）: HDMI 切替中の旧 window 由来 IPC が新 window state を踏み潰すのを防ぐ
    if (_isSwitchingMode) return getActiveTournamentWithAliases();
    if (!partial || typeof partial !== 'object') {
      return getActiveTournamentWithAliases();
    }
    const id = store.get('activeTournamentId');
    const list = store.get('tournaments') || [];
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return getActiveTournamentWithAliases();
    const updated = normalizeTournament({ ...partial, id }, list[idx]);
    list[idx] = updated;
    store.set('tournaments', list);
    // v2.0.4-rc10 Fix 1-B: tournament:set 経路で specialStack 変更があった場合、
    //   hall に dual:state-sync で broadcast する。Ctrl+E の AVG STACK / op-pane / 表示反映が
    //   hall 側でリアルタイム同期されるようになる（rc10 事前調査 §2.3 確定真因の根治）。
    //   partial に specialStack が含まれる場合のみ publish（idempotent、副作用なし）。
    if (partial && partial.specialStack !== undefined && updated && updated.specialStack !== undefined) {
      try { _publishDualState('specialStack', updated.specialStack); } catch (_) { /* ignore */ }
    }
    return { ...updated, title: updated.name };
  });

  // ===== v2.0.0 STEP 4: モニター選択ダイアログ用 IPC =====
  //   picker.html → preload (window.api.dual.fetchDisplays) → ここで displays + lastSelected を返す。
  //   ipcMain.on('dual:select-hall-monitor', ...) は chooseHallDisplayInteractive 内で動的登録するため、
  //   ここで登録するのは fetch のみ（永続ハンドラ）。
  ipcMain.handle('display-picker:fetch', () => {
    const all = screen.getAllDisplays();
    const primaryId = (() => { try { return screen.getPrimaryDisplay().id; } catch (_) { return null; } })();
    const list = (Array.isArray(all) ? all : []).map((d) => ({
      id: d.id,
      label: typeof d.label === 'string' ? d.label : '',
      bounds: { width: d.bounds?.width || 0, height: d.bounds?.height || 0 },
      isPrimary: d.id === primaryId
    }));
    return {
      displays: list,
      lastSelected: store.get('preferredHallDisplayId') || null
    };
  });

  // ===== v2.0.0 STEP 2: 2 画面間の状態同期 IPC =====
  //   hall 起動時に 1 回だけ呼ばれる初期同期。_dualStateCache の現在値を返す。
  //   未キャッシュ（cache が null）の項目は active トーナメントから補完して返す。
  //   operator-solo モードでは hall が存在しないので呼ばれない（renderer 側ガード）。
  ipcMain.handle('dual:state-sync-init', () => {
    // active トーナメントから cache 未設定項目を補完（hall 初期表示で空にならないように）
    const list = store.get('tournaments') || [];
    const activeId = store.get('activeTournamentId');
    const active = list.find((t) => t.id === activeId);
    const snapshot = { ..._dualStateCache };
    if (active) {
      if (snapshot.timerState         === null) snapshot.timerState         = normalizeTimerState(active.timerState);
      if (snapshot.displaySettings    === null) snapshot.displaySettings    = active.displaySettings || null;
      if (snapshot.marqueeSettings    === null) snapshot.marqueeSettings    = active.marqueeSettings || null;
      if (snapshot.tournamentRuntime  === null) snapshot.tournamentRuntime  = active.runtime || null;
      if (snapshot.tournamentBasics   === null) snapshot.tournamentBasics   = {
        id: active.id, name: active.name, subtitle: active.subtitle,
        titleColor: active.titleColor, blindPresetId: active.blindPresetId
      };
      // v2.1.14 Fix R-init（穴 1 根治、BREAK 中スライドショー不発の本丸）:
      //   hall 起動時に structure を補完して snapshot に同梱。
      //   _dualStateCache.structure は presets:saveUser 時のみセットされる設計（main.js:1803）のため、
      //   起動直後 snapshot.structure === null となり hall 側 isBreakLevel が常に false →
      //   ブレイク挿入が反映されず BREAK 中スライドショーが起動しない真因となっていた。
      //   active.blindPresetId から store の userPresets / BUILTIN_PRESETS を引いて補完する。
      //   null のままでも renderer.js:7117-7149 の tournamentBasics 経由 loadPresetById fallback で
      //   間接取得は可能だが、初期化を確実にするため明示補完。
      if (snapshot.structure === null && typeof active.blindPresetId === 'string' && active.blindPresetId) {
        try {
          const userPresets = store.get('userPresets') || [];
          const preset = userPresets.find((p) => p.id === active.blindPresetId)
            || BUILTIN_PRESETS.find((p) => p.id === active.blindPresetId);
          if (preset && Array.isArray(preset.levels)) {
            snapshot.structure = preset;
          }
        } catch (_) { /* never throw from snapshot init */ }
      }
    }
    if (snapshot.audioSettings === null) snapshot.audioSettings = store.get('audio') || null;
    if (snapshot.venueName     === null) snapshot.venueName     = store.get('venueName') || '';
    if (snapshot.logoUrl       === null) snapshot.logoUrl       = store.get('logo') || null;
    return snapshot;
  });

  // v2.0.2: dual:operator-action ハンドラ + _DUAL_ACTION_ROUTE は削除（デッドコード除去）。
  //   STEP 3 で operator → main → hall を経由する設計だったが、実際は renderer → main の
  //   既存 IPC（tournaments:setTimerState 等）を直接呼び、main 側で _publishDualState する
  //   経路で動作している。dual:operator-action は validate して payloadShape を返すだけの
  //   no-op だったため、関連する preload.js notifyOperatorAction と
  //   renderer.js notifyOperatorActionIfNeeded も同時撤去。

  // v2.0.4-rc6 Fix 4-C: ESC キーで hall 全画面解除（renderer から ipcRenderer.send で通知）。
  //   案 i 採用: dispatcher 到達時 dialog 無し前提（dialog[open] ガードを通過したケース）。
  //   hall が fullscreen の時のみ解除する。operator-solo / hall 不在 / 既に窓化済の場合は no-op。
  ipcMain.on('dual:request-exit-fullscreen', () => {
    if (hallWindow && !hallWindow.isDestroyed() && hallWindow.isFullScreen()) {
      try { hallWindow.setFullScreen(false); } catch (_) { /* ignore */ }
    }
  });

  // v2.0.4-rc6 Fix 5-M: operator 側でミュート切替された時、hall 側 audio もミュート同期。
  //   operator (PC) で M キー → audioToggleMute は operator の AudioContext のみミュート、
  //   hall 側は別 renderer の AudioContext で音を出すため、本来別途同期が必要。
  //   renderer → main → hall の 3 段で論理ステートを通す（preload で broadcastMuteState 公開）。
  ipcMain.on('dual:broadcast-mute-state', (_event, muted) => {
    if (hallWindow && !hallWindow.isDestroyed()) {
      try { hallWindow.webContents.send('dual:mute-state-changed', !!muted); } catch (_) { /* ignore */ }
    }
  });

  // v2.0.4-rc6 Fix 5-H: operator 側でボトムバートグルされた時、hall 側にも同期。
  //   既存の settings:setDisplay 経路は永続化のみで hall への runtime broadcast がないため、
  //   M と同じ追加チャネルで明示的に通知する（永続化は既存経路に任せる）。
  ipcMain.on('dual:broadcast-bottombar-state', (_event, hidden) => {
    if (hallWindow && !hallWindow.isDestroyed()) {
      try { hallWindow.webContents.send('dual:bottombar-state-changed', !!hidden); } catch (_) { /* ignore */ }
    }
  });

  // v2.1.6: PRE_START（開始前カウントダウン）の hall 同期。
  //   v2.0.3 Fix L で PRE_START は永続化対象外（renderer.js:1271 で 'idle' 化）のため、
  //   timerState では届かない。本ハンドラで _publishDualState('preStartState', ...) 経由で
  //   hall に session state として broadcast し、hall 側でカウントダウン + スライドショー連動。
  //   payload 形: { isActive: bool, totalMs?: number, remainingMs?: number, startAtMs?: number }
  //   不正 payload は no-op（rolling log のみ）。
  ipcMain.on('dual:publish-pre-start-state', (_event, payload) => {
    try {
      if (!payload || typeof payload !== 'object') return;
      const isActive = !!payload.isActive;
      const sanitized = { isActive };
      if (isActive) {
        // v2.1.20-rc7 真因根治: tick / pause / resume / adjust 経由の publish では totalMs / startAtMs が
        //   含まれないため、cache から維持する（HDMI 抜き差し時の operator 復元で totalMs が必要）。
        //   feedback_ipc_sanitization_field_drop.md パターン（v2.1.15→16→17）の再発を防止。
        //   PRE_START 開始時（renderer.js:2401）は totalMs / startAtMs を必ず送るため、初回は新値で確定、
        //   以後の tick / pause / resume / adjust は cache の値を維持し続ける。
        const prev = _dualStateCache.preStartState || {};
        let mergedFromCache = false;
        if (Number.isFinite(payload.totalMs) && payload.totalMs >= 0) {
          sanitized.totalMs = Math.floor(payload.totalMs);
        } else if (Number.isFinite(prev.totalMs) && prev.totalMs >= 0) {
          sanitized.totalMs = prev.totalMs;
          mergedFromCache = true;
        }
        if (Number.isFinite(payload.remainingMs) && payload.remainingMs >= 0) {
          sanitized.remainingMs = Math.floor(payload.remainingMs);
        } else if (Number.isFinite(prev.remainingMs) && prev.remainingMs >= 0) {
          sanitized.remainingMs = prev.remainingMs;
          mergedFromCache = true;
        }
        if (Number.isFinite(payload.startAtMs) && payload.startAtMs >= 0) {
          sanitized.startAtMs = Math.floor(payload.startAtMs);
        } else if (Number.isFinite(prev.startAtMs) && prev.startAtMs >= 0) {
          sanitized.startAtMs = prev.startAtMs;
          mergedFromCache = true;
        }
        // v2.1.17 ① 真の根治: isPaused フィールドを sanitization で転送（v2.1.15/v2.1.16 で追加された renderer 側機構が
        //   ここで落とされて hall に届かないため、PRE_START 一時停止が hall に反映されない真因。
        //   payload.isPaused が boolean 型のときのみ転送（型安全 + 既存 sanitization パターンと整合）。
        if (typeof payload.isPaused === 'boolean') {
          sanitized.isPaused = payload.isPaused;
        } else if (typeof prev.isPaused === 'boolean') {
          sanitized.isPaused = prev.isPaused;
          mergedFromCache = true;
        }
        // v2.1.20-rc7 新規確証ラベル: cache merge が発火した = 受信 payload に欠落フィールドがあった証拠
        if (mergedFromCache) {
          try { rollingLog('preStart:cache:merge', { totalMs: sanitized.totalMs, remainingMs: sanitized.remainingMs, hasIsPaused: typeof sanitized.isPaused === 'boolean' }); } catch (_) {}
        }
      }
      _publishDualState('preStartState', sanitized);
    } catch (err) {
      try { rollingLog('preStart:publish-error', { message: err && err.message }); } catch (_) {}
      // v2.1.18-meas1 error:caught:main.dual.publishPreStartState
      try { rollingLog('error:caught:main.dual.publishPreStartState', { message: err && err.message, stack_top: (err && err.stack || '').split('\n')[1] }); } catch (_) {}
    }
  });

  // v2.0.4-rc15 タスク 2: rolling ログ機構の IPC エンドポイント
  //   renderer は直接 fs アクセス禁止。'rolling-log:write' で main に集約してロックフリー化。
  //   payload は { label: string, data: object } 形式（preload で String キャスト済）。
  ipcMain.on('rolling-log:write', (_event, payload) => {
    try {
      if (!payload || typeof payload !== 'object') return;
      const label = (typeof payload.label === 'string') ? payload.label : 'renderer:unknown';
      rollingLog(label, payload.data || null);
      // perf-heaviness: PERF_METRICS 時のみ renderer の perf:* ラベル（rAF Hz 等）を perf-metrics.log に合流。本番無効。
      if (_PERF_METRICS_ON && label.indexOf('perf:') === 0) {
        _perfLogAppend({ ts: new Date().toISOString(), label, data: payload.data || null });
      }
    } catch (_) { /* never throw from logging */ }
  });
  // 'ログフォルダを開く' ボタンから呼ばれる。shell.openPath で OS のファイルマネージャで logs/ を表示。
  //   _resolveLogsDir は inline object literal を持たない（既存テスト regex 互換、
  //   `[\s\S]*?\}\s*\)\s*;` パターンに引っかかる { recursive: true } を関数化で回避）。
  ipcMain.handle('logs:openFolder', async () => {
    // v2.0.4-rc18 第 1 弾 タスク 3: フォルダを開く前に最新状態を確実に書き出す
    try { await _flushRollingLog(); } catch (_) { /* never throw from logging */ }
    const dir = _resolveLogsDir();
    if (!dir) return { ok: false, error: 'app.getPath unavailable' };
    const result = await shell.openPath(dir);
    return { ok: result === '', error: result || null, path: dir };
  });
}
// rolling ログ用ヘルパ: <userData>/logs/ ディレクトリのパス解決 + 必要なら作成
function _resolveLogsDir() {
  try {
    if (typeof app.getPath !== 'function') return null;
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (_) { return null; }
}

// ============================================================
// perf-heaviness 計測ハーネス（2026-06-08、PERF_METRICS env ゲート＝本番完全無効）
//   PERF_METRICS=1 のときだけ app.getAppMetrics() を 2s 間隔でサンプリングし、
//   各プロセス（Browser[main] / Tab[renderer] / GPU / Utility）の CPU% / 物理メモリを
//   <userData>/logs/perf-metrics.log に JSON 1 行ずつ追記する。
//   renderer の rAF Hz は 'rolling-log:write' 経由 'perf:raf-hz' を同ファイルに合流（下の IPC 分岐）。
//   未設定（通常起動・本番）では一切動かない＝「念のためコード追加禁止」原則に合致。
// ============================================================
const _PERF_METRICS_ON = process.env.PERF_METRICS === '1';
let _perfMetricsTimer = null;
function _perfLogAppend(entry) {
  try {
    const dir = _resolveLogsDir();
    if (!dir) return;
    fs.appendFileSync(path.join(dir, 'perf-metrics.log'), JSON.stringify(entry) + '\n');
  } catch (_) { /* never throw from perf log */ }
}
function _startPerfMetricsSampler() {
  if (!_PERF_METRICS_ON || _perfMetricsTimer) return;
  _perfLogAppend({ ts: new Date().toISOString(), label: 'perf:session', data: { electron: process.versions.electron, platform: process.platform } });
  _perfMetricsTimer = setInterval(() => {
    try {
      const metrics = (typeof app.getAppMetrics === 'function') ? app.getAppMetrics() : [];
      const snapshot = metrics.map((m) => ({
        pid: m.pid,
        type: m.type,
        cpu: (m.cpu && typeof m.cpu.percentCPUUsage === 'number') ? Math.round(m.cpu.percentCPUUsage * 100) / 100 : null,
        // workingSetSize は KB 単位 → MB（小数 1 桁）
        memMB: (m.memory && typeof m.memory.workingSetSize === 'number') ? Math.round(m.memory.workingSetSize / 1024 * 10) / 10 : null
      }));
      _perfLogAppend({ ts: new Date().toISOString(), label: 'perf:metrics', data: snapshot });
    } catch (_) { /* never throw from perf sampler */ }
  }, 2000);
}

app.whenReady().then(async () => {
  // v2.0.4-rc10 Fix 3 (修正案 C-1): 単一インスタンス制御。
  //   2 個目を起動した場合は即時 quit、既存の 1 個目を最前面化する（Electron 標準パターン）。
  //   未実装のままだと electron-store の tournaments 配列 / runtime 永続化（致命バグ保護 C.1.8）に
  //   write race が起きて「気づかぬデータ消失」のリスクあり（rc10 事前調査 §4.2 確定）。
  //   2 個目起動時に呼ばれる second-instance ハンドラ内で mainWindow を restore + focus。
  //   app.whenReady().then 冒頭に配置（テスト stub の whenReady never-resolves で副作用回避、
  //   配布版では即実行されるため挙動同等）。
  const _gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!_gotSingleInstanceLock) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    rollingLog('second-instance', null);
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      } catch (_) { /* ignore */ }
    }
  });

  // v2.0.4-rc15 タスク 2: rolling ログ初期化 + app:ready 記録（最初のイベント）
  _initRollingLog();
  rollingLog('app:ready', { version: app.getVersion(), isPackaged: app.isPackaged });

  // v2.1.18-meas1 meas:session:start: セッション情報（version / electron / displays）を 1 回だけ記録
  try {
    rollingLog('meas:session:start', {
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      displays: screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor }))
    });
  } catch (_) {}

  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  registerIpcHandlers();
  // v2.0.0 STEP 4: createMainWindow が async（モニター選択ダイアログを await）になったため、
  //   shortcuts 登録より前に await して mainWindow が確実に生成された状態にする。
  await createMainWindow();
  // perf-heaviness 計測ハーネス起動（PERF_METRICS env ゲート、本番無効）。ウィンドウ生成後に開始。
  _startPerfMetricsSampler();
  registerShortcuts();
  // v2.0.0 STEP 5: HDMI 抜き差しイベント駆動追従の購読開始（ポーリング禁止、screen API のみ）
  setupDisplayChangeListeners();

  // remote-control Phase 1a: 起動時に remoteControl.enabled=true の時だけ LAN サーバを起動する。
  //   既定 OFF のため通常起動では一切サーバを立てない（listener 非生成＝現行完全同一・後方互換）。
  try {
    if ((store.get('remoteControl') || {}).enabled === true) {
      startRemoteServer(); // fire-and-forget（await しても whenReady 後続に依存関係なし）
    }
  } catch (_) { /* remote 起動失敗はアプリ本体に影響させない */ }

  // STEP 9.fix2: 全権限要求を明示的に拒否（位置情報・カメラ・マイク・通知等は一切使用しない）。
  //   配布版 Windows 側で「位置情報を許可しますか？」ダイアログが出る件を抑止。
  //   STEP 6.23 のデータ移行（クリップボード Copy/Paste）のためクリップボード系のみホワイトリスト。
  const ALLOWED_PERMISSIONS = new Set([
    'clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'
  ]);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (ALLOWED_PERMISSIONS.has(permission)) {
      callback(true);
      return;
    }
    console.log(`[security] permission request denied: ${permission}`);
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return ALLOWED_PERMISSIONS.has(permission);
  });

  // STEP 10 フェーズC.1.2 Fix 3 + v2.0.8 真因修正: 自動更新（electron-updater）— 配布版のみ動作、開発時はスキップ。
  //   GitHub Releases から新版をチェック → 通知 → ダウンロード → ユーザー確認後に再起動。
  //   isDev のときは何もせず（npm start での誤動作 / GitHub レート消費を防止）。
  //
  // v2.0.8 真因修正: 旧コードは pkg.build.publish の存在判定で条件分岐していたが、
  //   electron-builder は asar 内 package.json から build フィールドを削除するため、
  //   pkg.build.publish 参照は常に undefined → 条件が常に false で
  //   autoUpdater が一度も起動していなかった（v2.0.4〜v2.0.7 全バージョンで自動更新不能）。
  //   autoUpdater は app-update.yml（electron-builder がビルド時に生成）を内部で読むため
  //   package.json の build.publish チェックは不要。app.isPackaged のみで判定する。
  // v2.0.10 ログ機構追加（観測のみ、機能変更なし）: setup-enter / event-name / check-call / catch
  //   をすべて rollingLog（Ctrl+Shift+L で取得）+ electron-log（%APPDATA%/PokerTimerPLUS+/logs/main.log）に記録。
  //   既存の console.log/warn は完全維持、ダイアログ文言・quitAndInstall ロジックも完全維持。
  //   v2.0.4〜v2.0.9 で自動更新が機能しない真因を実機ログで確定するための観測手段。
  rollingLog('autoUpdater:setup-enter', { isDev, hasAutoUpdater: !!autoUpdater, isPackaged: app.isPackaged, version: app.getVersion() });

  // v2.0.14 Fix 7（M11 / C-11）: autoUpdater error / check-rejected 時のダイアログ通知。
  //   既存の rollingLog + console.warn は完全維持、追加で「初回のみ」ダイアログ表示する。
  //   再試行ボタン → autoUpdater.checkForUpdatesAndNotify() を再実行。
  //   セッション中の重複表示防止フラグで頻発を抑制（毎回出すと UX 悪化）。
  let _autoUpdaterErrorDialogShown = false;
  function notifyAutoUpdaterError(err) {
    if (_autoUpdaterErrorDialogShown) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    _autoUpdaterErrorDialogShown = true;
    const message = (err && err.message) || '不明なエラー';
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '自動更新の確認に失敗しました',
      message: '更新の確認に失敗しました。',
      detail: `理由: ${message}\n\nネットワーク接続をご確認のうえ、必要であれば再試行してください。`,
      buttons: ['再試行', '閉じる'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0 && autoUpdater) {
        _autoUpdaterErrorDialogShown = false;  // 再試行を許可するため flag をリセット
        try {
          autoUpdater.checkForUpdatesAndNotify().catch((err2) => {
            rollingLog('autoUpdater:retry-rejected', { message: err2 && err2.message });
          });
        } catch (_) {}
      }
    }).catch(() => {});
  }

  if (!isDev && autoUpdater && app.isPackaged) {
    try {
      // v2.0.10: electron-log 統合（autoUpdater.logger 設定、公式推奨パターン）
      try {
        const log = require('electron-log');
        autoUpdater.logger = log;
        log.transports.file.level = 'info';
        // v2.0.15 Fix 2（M7 Perf-9）: 長期運用でのログファイル肥大化を防ぐローテーション設定
        log.transports.file.maxSize = 5 * 1024 * 1024;   // 5MB ローテ
        log.transports.file.archiveLogFn = (oldLogFile) => {
          // archive 1 世代のみ保持（main.old.log）
          const newPath = oldLogFile.toString().replace(/\.log$/, '.old.log');
          try { fs.renameSync(oldLogFile.toString(), newPath); } catch (_) { /* never throw from logging */ }
        };
        let logPath = null;
        try { logPath = log.transports.file.getFile && log.transports.file.getFile().path; } catch (_) {}
        rollingLog('autoUpdater:logger-attached', { logPath });
      } catch (err) {
        rollingLog('autoUpdater:logger-attach-failed', { message: err && err.message });
      }
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;   // v2.1.2 方針 Z: 通常終了で installer 自動実行（次回起動時更新）
      // v2.0.10 追加 3 イベントハンドラ（観測のみ、ダウンロード進捗 / 更新確認開始 / 最新済の判定タイミング把握）
      autoUpdater.on('checking-for-update', () => {
        rollingLog('autoUpdater:checking-for-update', null);
      });
      autoUpdater.on('update-not-available', (info) => {
        rollingLog('autoUpdater:update-not-available', { version: info?.version, releaseDate: info?.releaseDate });
      });
      autoUpdater.on('download-progress', (progress) => {
        rollingLog('autoUpdater:download-progress', { percent: Math.floor(progress?.percent || 0), transferred: progress?.transferred, total: progress?.total });
      });
      autoUpdater.on('error', (err) => {
        rollingLog('autoUpdater:error', { message: err && err.message, stack: err && err.stack });
        console.warn('[auto-updater] error:', err && err.message);
        notifyAutoUpdaterError(err);
      });
      autoUpdater.on('update-available', (info) => {
        rollingLog('autoUpdater:update-available', { version: info?.version, releaseDate: info?.releaseDate });
        console.log('[auto-updater] update-available:', info?.version);
      });
      autoUpdater.on('update-downloaded', async (info) => {
        rollingLog('autoUpdater:update-downloaded', { version: info?.version });
        if (!mainWindow || mainWindow.isDestroyed()) return;
        // v2.1.2 方針 Z: quitAndInstall を呼ばず、ダイアログを通知のみに変更。
        //   autoInstallOnAppQuit: true により、次回アプリ通常終了時 → 次回起動時の流れで installer が自動実行される。
        //   v2.1.1 で発生した「アプリが終了できません」エラー + NSIS UI 表示は本設計で根本回避。
        // v2.1.5: NSIS installer 処理時間（実測 30〜60 秒）を考慮し、「2 分待機」を明示。
        //   v2.1.2 配布で「閉じてすぐ再起動」によるインストール失敗が頻発したための UX 改善。
        await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '更新の準備ができました',
          message: `新しいバージョン v${info?.version || '最新版'} が準備できました。\nアプリを閉じてから2分以上待って再起動すると、自動的に最新版に切り替わります。\n（installer の処理に時間がかかるため、すぐ再起動するとアップグレードに失敗する場合があります）`,
          buttons: ['OK'],
          defaultId: 0,
          cancelId: 0
        });
      });
      rollingLog('autoUpdater:check-call', null);
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        // ネットワーク不通 / レート制限 / app-update.yml 不在など — 通常運用に影響なし
        rollingLog('autoUpdater:check-rejected', { message: err && err.message, stack: err && err.stack });
        console.log('[auto-updater] update check skipped:', err && err.message);
        notifyAutoUpdaterError(err);
      });
    } catch (err) {
      rollingLog('autoUpdater:setup-error', { message: err && err.message, stack: err && err.stack });
      console.log('[auto-updater] setup skipped:', err && err.message);
    }
  }

  // STEP 6.21.4: PC スリープ → 復帰時にレンダラへ通知
  // レンダラ側で active トーナメントの timerState を時刻ベースで再同期する
  powerMonitor.on('resume', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('system:resume');
    }
  });

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // v2.0.0 STEP 4: dock click 等での再起動時もモニター選択をやり直す（毎回手動の要件）
      await createMainWindow();
    }
  });
});

// v2.0.3 P4 fix: 旧 will-quit ハンドラ（globalShortcut.unregisterAll）は
//   registerIpcHandlers 内の powerSaveBlocker 解放ハンドラに統合済（重複登録を解消）。

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// STEP 6.23 テスト用エクスポート（Electron 本体は CommonJS の module.exports を使わないので副作用なし）
// テスト側で require('main.js') して pure なロジックだけ取り出して検証する
module.exports = {
  buildExportPayload,
  validateImportPayload,
  sanitizeMarqueeSettings,
  sanitizeVenueName,
  normalizeTimerState,
  BUILTIN_PRESETS,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  MAX_TOURNAMENTS,
  MAX_USER_PRESETS,
  // STEP 10 フェーズA: ゲーム種拡張で新規追加
  GAMES,
  STRUCTURE_TYPES,
  LEGACY_GAME_TYPE_ALIAS,
  normalizeGameType,
  getStructureTypeForGame,
  getStructureFields,
  isValidNewGameId,
  // STEP 10 フェーズB: プリセット構造型対応・テンプレ生成
  isValidPreset,
  convertLegacyBlindLevel,
  getEmptyStructureForGame
};
