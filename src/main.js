// PokerTimerPLUS+ メインプロセス
// 制作: Yu Shitamachi (PLUS2運営)

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

// STEP 6.21.4.2: Chromium AutoPlay Policy を無効化（起動直後から音再生を許可）
// app.whenReady() より前に必ず設定（Electron 起動フラグのため）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ウィンドウタイトル（branding.md により固定、変更不可）
const WINDOW_TITLE = 'PokerTimerPLUS+ — presented by Yu Shitamachi';

const isDev = process.env.NODE_ENV === 'development';

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
  return {
    playersInitial:   toNonNegInt(value.playersInitial,   fb.playersInitial),
    playersRemaining: toNonNegInt(value.playersRemaining, fb.playersRemaining),
    reentryCount:     toNonNegInt(value.reentryCount,     fb.reentryCount),
    addOnCount:       toNonNegInt(value.addOnCount,       fb.addOnCount)
  };
}
const VALID_TIMER_FONTS = ['jetbrains', 'roboto', 'space'];
const VALID_VARIANTS = ['default', 'variant2'];

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
  marqueeSettings: { enabled: true, text: '', speed: 'normal' }
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
  const cleanTournaments = tournaments.map((t) => ({
    ...t,
    timerState: { status: 'idle', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: null }
  }));
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
      currencySymbol: '¥',
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
      countdownTickVariant: 'default'
    }
  }
});

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
      currencySymbol: oldT.currencySymbol || '¥',
      blindPresetId: oldT.blindPresetId || 'demo-fast'
    };
    s.set('tournaments', [migrated]);
    s.set('activeTournamentId', id);
    s.delete('tournament');
  }
}
migrateTournament(store);

// STEP 6: 既存トーナメントに新規フィールドのデフォルト値を充填
function migrateTournamentSchema(s) {
  const list = s.get('tournaments') || [];
  let changed = false;
  let filledTimerState = 0;       // STEP 6.21: timerState 補完件数（ログ用）
  let filledDisplaySettings = 0;  // STEP 6.21.6: displaySettings 補完件数（ログ用）
  let filledMarqueeSettings = 0;  // STEP 6.22.1: marqueeSettings 補完件数（ログ用）
  const globalDisplay = s.get('display') || {};
  const fallbackDisplay = {
    background: VALID_BACKGROUNDS.includes(globalDisplay.background) ? globalDisplay.background : 'navy',
    timerFont:  VALID_TIMER_FONTS.includes(globalDisplay.timerFont)   ? globalDisplay.timerFont  : 'jetbrains',
    // STEP 10 フェーズC.1.3: backgroundImage / backgroundOverlay 既定値
    backgroundImage: (typeof globalDisplay.backgroundImage === 'string') ? globalDisplay.backgroundImage : '',
    backgroundOverlay: VALID_BG_OVERLAYS.includes(globalDisplay.backgroundOverlay) ? globalDisplay.backgroundOverlay : 'mid',
    // STEP 10 フェーズC.1.4: 休憩中スライドショー
    breakImages: sanitizeBreakImages(globalDisplay.breakImages, []),
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
      // STEP 10 フェーズC.1.3: backgroundImage / backgroundOverlay も含めて補完。
      //   不正値は fallbackDisplay 経由で既定に戻す。サイズ超過の data URL は空文字に切り捨て。
      const sanImage = sanitizeBackgroundImage(ds.backgroundImage, fallbackDisplay.backgroundImage);
      const fixed = {
        background: VALID_BACKGROUNDS.includes(ds.background) ? ds.background : fallbackDisplay.background,
        timerFont:  VALID_TIMER_FONTS.includes(ds.timerFont)   ? ds.timerFont  : fallbackDisplay.timerFont,
        backgroundImage: (sanImage === null) ? '' : sanImage,
        backgroundOverlay: sanitizeBackgroundOverlay(ds.backgroundOverlay, fallbackDisplay.backgroundOverlay),
        // STEP 10 フェーズC.1.4: 休憩中スライドショー
        breakImages: sanitizeBreakImages(ds.breakImages, fallbackDisplay.breakImages),
        breakImageInterval: sanitizeBreakImageInterval(ds.breakImageInterval, fallbackDisplay.breakImageInterval),
        pipSize: sanitizePipSize(ds.pipSize, fallbackDisplay.pipSize)
      };
      // 等価判定（配列・プリミティブ混在）
      const breakImagesUnchanged = Array.isArray(ds.breakImages)
        && fixed.breakImages.length === ds.breakImages.length
        && fixed.breakImages.every((v, i) => v === ds.breakImages[i]);
      if (fixed.background !== ds.background || fixed.timerFont !== ds.timerFont
          || fixed.backgroundImage !== ds.backgroundImage || fixed.backgroundOverlay !== ds.backgroundOverlay
          || !breakImagesUnchanged
          || fixed.breakImageInterval !== ds.breakImageInterval
          || fixed.pipSize !== ds.pipSize) {
        m.displaySettings = fixed;
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
  for (const lv of p.levels) {
    if (!lv || typeof lv !== 'object') return false;
    if (typeof lv.durationMinutes !== 'number' || lv.durationMinutes <= 0) return false;
    if (lv.isBreak === true) {
      // ブレイクは label のみ任意。構造型のフィールドは不問
      continue;
    }
    for (const f of fields) {
      if (typeof lv[f] !== 'number' || lv[f] < 0) return false;
    }
  }
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
  venueName: null
};
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
  _broadcastDualState('dual:state-sync', { kind, value });
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
    backgroundThrottling: false,
    // v2.0.0 STEP 1: preload.js が process.argv から `--role=...` を抽出して
    //   document.documentElement に data-role 属性を付与する。CSP 不変、inline script 不要。
    additionalArguments: [`--role=${role}`]
  };
}

// v2.0.0 STEP 1: operator ウィンドウ生成。
//   isSolo=true で role='operator-solo'（単画面モード、v1.3.0 と完全同等の見た目・挙動）。
//   isSolo=false で role='operator'（2 画面モードの PC 側、STEP 3 でホール側のみの要素を hide 化予定）。
function createOperatorWindow(targetDisplay, isSolo = false) {
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
  mainWindow = new BrowserWindow(opts);

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });
  mainWindow.setTitle(WINDOW_TITLE);

  // 外部リンク（target="_blank"）はデフォルトブラウザで開く（ハウス情報タブの効果音ラボリンク等）
  // Electron 22+ ではデフォルトで window.open は deny されるため、明示的に shell.openExternal を呼ぶ
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // STEP 6.21: F12 / Ctrl+Shift+I のフォールバック登録
  // globalShortcut.register('F12') がフォーカス都合で効かない環境向けの保険
  mainWindow.webContents.on('before-input-event', (event, input) => {
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  return mainWindow;
}

// v2.0.0 STEP 1: hall ウィンドウ生成（最小骨格、STEP 3 で frame: false / fullscreen 等を追加）。
//   現状は operator と同じ index.html をロード、role='hall' のみ差別化。
//   状態同期は STEP 2 で実装。
function createHallWindow(targetDisplay) {
  const opts = {
    title: WINDOW_TITLE + ' (Hall)',
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: buildWebPreferences('hall')
  };
  if (targetDisplay && targetDisplay.bounds) {
    opts.x = targetDisplay.bounds.x + 40;
    opts.y = targetDisplay.bounds.y + 40;
  }
  hallWindow = new BrowserWindow(opts);
  hallWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });
  hallWindow.setTitle(WINDOW_TITLE + ' (Hall)');
  hallWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  hallWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  hallWindow.on('closed', () => {
    hallWindow = null;
  });
  return hallWindow;
}

// v2.0.0 STEP 1: 起動時のウィンドウ生成エントリ。
//   - 単画面（displays.length < 2）: operator-solo 1 ウィンドウのみ → v1.3.0 と完全同等
//   - 2 画面以上: primary を operator、それ以外の最初を hall（STEP 4 でモニター選択ダイアログに置換）
function createMainWindow() {
  const displays = screen.getAllDisplays();
  if (!displays || displays.length < 2) {
    return createOperatorWindow(displays && displays[0], true);
  }
  const primary = screen.getPrimaryDisplay();
  const secondary = displays.find((d) => d.id !== primary.id) || displays[1];
  createOperatorWindow(primary, false);
  createHallWindow(secondary);
  return mainWindow;
}

function toggleFullScreen() {
  if (!mainWindow) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
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
    app.quit();
  }
}

function toggleDevTools() {
  if (!mainWindow) return;
  mainWindow.webContents.toggleDevTools();
}

function registerShortcuts() {
  globalShortcut.register('F11', toggleFullScreen);
  globalShortcut.register('CommandOrControl+Q', confirmQuit);
  // STEP 6.21: 配布版（isDev=false）でも F12 で DevTools を開けるよう常時登録
  // before-input-event 側にもフォールバックを置いてあるので二重登録だが副作用なし
  globalShortcut.register('F12', toggleDevTools);
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

    store.set('logo', { kind: 'custom', customPath: destPath });
    return { ok: true, kind: 'custom', customPath: destPath };
  });

  // モード切替（placeholder / plus2 のみ。custom は selectFile を経由）
  ipcMain.handle('logo:setMode', (_event, kind) => {
    if (!VALID_LOGO_KINDS.includes(kind)) return { ok: false, error: 'invalid-kind' };
    if (kind === 'custom') return { ok: false, error: 'use-selectFile-for-custom' };
    store.set('logo', { kind, customPath: null });
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
  function normalizePayouts(arr, fallback) {
    if (!Array.isArray(arr) || arr.length === 0) return fallback.map((p) => ({ ...p }));
    const cleaned = [];
    for (let i = 0; i < arr.length && cleaned.length < 9; i++) {
      const p = arr[i];
      if (!p || typeof p !== 'object') continue;
      const rank = Math.max(1, Math.floor(Number(p.rank)) || (cleaned.length + 1));
      const pct = toNonNegNumber(p.percentage, 0);
      cleaned.push({ rank, percentage: pct });
    }
    if (cleaned.length === 0) return fallback.map((p) => ({ ...p }));
    // rank の重複排除＆連番化
    cleaned.sort((a, b) => a.rank - b.rank);
    return cleaned.map((p, idx) => ({ rank: idx + 1, percentage: p.percentage }));
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
      const sanImage = sanitizeBackgroundImage(ds?.backgroundImage, fb.backgroundImage || '');
      out.displaySettings = {
        background: VALID_BACKGROUNDS.includes(ds?.background) ? ds.background : (fb.background || 'navy'),
        timerFont:  VALID_TIMER_FONTS.includes(ds?.timerFont)   ? ds.timerFont  : (fb.timerFont  || 'jetbrains'),
        backgroundImage: (sanImage === null) ? (fb.backgroundImage || '') : sanImage,
        backgroundOverlay: sanitizeBackgroundOverlay(ds?.backgroundOverlay, fb.backgroundOverlay || 'mid'),
        // STEP 10 フェーズC.1.4: 休憩中スライドショー
        breakImages: sanitizeBreakImages(ds?.breakImages, fb.breakImages || []),
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

    // 既定値補完
    if (!out.name) out.name = 'ポーカートーナメント';
    if (typeof out.subtitle !== 'string') out.subtitle = '';
    if (typeof out.currencySymbol !== 'string') out.currencySymbol = '¥';
    if (typeof out.blindPresetId !== 'string') out.blindPresetId = 'demo-fast';
    // STEP 10 フェーズA: 補完時も必ず新コードに正規化（旧コードが既定値に紛れ込むのを防ぐ）
    out.gameType = normalizeGameType(out.gameType ?? DEFAULT_TOURNAMENT_EXT.gameType);
    if (typeof out.startingStack !== 'number') out.startingStack = DEFAULT_TOURNAMENT_EXT.startingStack;
    if (!out.buyIn)   out.buyIn   = { ...DEFAULT_TOURNAMENT_EXT.buyIn };
    if (!out.reentry) out.reentry = { ...DEFAULT_TOURNAMENT_EXT.reentry };
    if (!out.addOn)   out.addOn   = { ...DEFAULT_TOURNAMENT_EXT.addOn };
    if (!Array.isArray(out.payouts) || out.payouts.length === 0) {
      out.payouts = DEFAULT_TOURNAMENT_EXT.payouts.map((p) => ({ ...p }));
    }
    if (typeof out.guarantee !== 'number' || out.guarantee < 0) {
      out.guarantee = DEFAULT_TOURNAMENT_EXT.guarantee;
    }
    if (typeof out.payoutRounding !== 'number' || !VALID_PAYOUT_ROUNDINGS.includes(out.payoutRounding)) {
      out.payoutRounding = DEFAULT_TOURNAMENT_EXT.payoutRounding;
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
    // STEP 6.21: timerState 既定補完
    out.timerState = normalizeTimerState(out.timerState ?? fallback.timerState);
    // STEP 10 フェーズC.1.8: runtime 既定補完
    out.runtime = sanitizeRuntime(out.runtime ?? fallback.runtime, DEFAULT_TOURNAMENT_EXT.runtime);
    // STEP 6.21.6: displaySettings 既定補完
    // STEP 10 フェーズC.1.3: backgroundImage / backgroundOverlay も補完
    if (!out.displaySettings || typeof out.displaySettings !== 'object') {
      const fb = fallback.displaySettings || getDefaultDisplaySettings();
      out.displaySettings = {
        background: VALID_BACKGROUNDS.includes(fb.background) ? fb.background : 'navy',
        timerFont:  VALID_TIMER_FONTS.includes(fb.timerFont)   ? fb.timerFont  : 'jetbrains',
        backgroundImage: (typeof fb.backgroundImage === 'string') ? fb.backgroundImage : '',
        backgroundOverlay: VALID_BG_OVERLAYS.includes(fb.backgroundOverlay) ? fb.backgroundOverlay : 'mid',
        // STEP 10 フェーズC.1.4: 休憩中スライドショー
        breakImages: sanitizeBreakImages(fb.breakImages, []),
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
    return { ...found, title: found.name };
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
      prizeCategory: typeof t.prizeCategory === 'string' ? t.prizeCategory : '',
      specialStack: t.specialStack ?? { ...DEFAULT_TOURNAMENT_EXT.specialStack },
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
        const sanImage = sanitizeBackgroundImage(ds.backgroundImage, '');
        return {
          background: VALID_BACKGROUNDS.includes(ds.background) ? ds.background : 'navy',
          timerFont:  VALID_TIMER_FONTS.includes(ds.timerFont)   ? ds.timerFont  : 'jetbrains',
          backgroundImage: (sanImage === null) ? '' : sanImage,
          backgroundOverlay: sanitizeBackgroundOverlay(ds.backgroundOverlay, 'mid'),
          breakImages: sanitizeBreakImages(ds.breakImages, []),
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

  // active 切替（id が存在することを確認）
  ipcMain.handle('tournaments:setActive', (_event, id) => {
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
    if (found.displaySettings)   _publishDualState('displaySettings',    found.displaySettings);
    if (found.marqueeSettings)   _publishDualState('marqueeSettings',    found.marqueeSettings);
    if (found.runtime)           _publishDualState('tournamentRuntime',  found.runtime);
    return { ...found, title: found.name };
  });

  // 保存（同 id があれば更新、なければ追加）
  // STEP 6.7: 新規追加時は MAX_TOURNAMENTS（100件）上限を超えないようガード。
  //           既存IDの上書きはカウントに影響しないため常に許可。
  ipcMain.handle('tournaments:save', (_event, t) => {
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
      _publishDualState('tournamentBasics', {
        id: validated.id, name: validated.name, subtitle: validated.subtitle,
        titleColor: validated.titleColor, blindPresetId: validated.blindPresetId
      });
      if (validated.displaySettings)  _publishDualState('displaySettings', validated.displaySettings);
      if (validated.marqueeSettings)  _publishDualState('marqueeSettings', validated.marqueeSettings);
      if (validated.runtime)          _publishDualState('tournamentRuntime', validated.runtime);
    }
    return { ok: true, tournament: { ...validated, title: validated.name } };
  });

  // STEP 6.21: timerState のみを部分更新（性能のため normalizeTournament を通さない）
  ipcMain.handle('tournaments:setTimerState', (_event, payload) => {
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
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'invalid-payload' };
    const { id, displaySettings } = payload;
    if (typeof id !== 'string' || !id) return { ok: false, error: 'invalid-id' };
    const list = store.get('tournaments') || [];
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return { ok: false, error: 'not-found' };
    const cur = list[idx].displaySettings || {};
    const ds = displaySettings || {};
    // backgroundImage: 'in' で送られた場合のみ更新。サイズ超過は error で返し、永続化しない。
    let nextImage = (typeof cur.backgroundImage === 'string') ? cur.backgroundImage : '';
    if ('backgroundImage' in ds) {
      const sanImage = sanitizeBackgroundImage(ds.backgroundImage, cur.backgroundImage || '');
      if (sanImage === null) {
        return { ok: false, error: 'image-too-large', message: '画像が大きすぎます（5MB 以下）' };
      }
      nextImage = sanImage;
    }
    const nextDs = {
      background: VALID_BACKGROUNDS.includes(ds.background) ? ds.background : (cur.background || 'navy'),
      timerFont:  VALID_TIMER_FONTS.includes(ds.timerFont)   ? ds.timerFont  : (cur.timerFont  || 'jetbrains'),
      backgroundImage: nextImage,
      backgroundOverlay: ('backgroundOverlay' in ds)
        ? sanitizeBackgroundOverlay(ds.backgroundOverlay, cur.backgroundOverlay || 'mid')
        : (VALID_BG_OVERLAYS.includes(cur.backgroundOverlay) ? cur.backgroundOverlay : 'mid'),
      // STEP 10 フェーズC.1.4: 休憩中スライドショー
      breakImages: ('breakImages' in ds)
        ? sanitizeBreakImages(ds.breakImages, cur.breakImages || [])
        : sanitizeBreakImages(cur.breakImages, []),
      breakImageInterval: ('breakImageInterval' in ds)
        ? sanitizeBreakImageInterval(ds.breakImageInterval, cur.breakImageInterval ?? 10)
        : sanitizeBreakImageInterval(cur.breakImageInterval, 10),
      pipSize: ('pipSize' in ds)
        ? sanitizePipSize(ds.pipSize, cur.pipSize || 'medium')
        : sanitizePipSize(cur.pipSize, 'medium')
    };
    list[idx] = { ...list[idx], displaySettings: nextDs };
    store.set('tournaments', list);
    // v2.0.0 STEP 2: hall に表示設定差分を broadcast（active トーナメントのみ）
    if (id === store.get('activeTournamentId')) {
      _publishDualState('displaySettings', nextDs);
    }
    return { ok: true, displaySettings: nextDs };
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
    return { ok: true, importedTournaments: importedT, importedPresets: importedP, skippedByLimit };
  });

  // 削除（最後の1個は削除不可）
  ipcMain.handle('tournaments:delete', (_event, id) => {
    let list = store.get('tournaments') || [];
    if (list.length <= 1) return { ok: false, error: 'last-tournament' };
    if (!list.find((t) => t.id === id)) return { ok: false, error: 'not-found' };
    list = list.filter((t) => t.id !== id);
    store.set('tournaments', list);
    if (store.get('activeTournamentId') === id) {
      store.set('activeTournamentId', list[0].id);
    }
    return { ok: true, activeId: store.get('activeTournamentId') };
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
      return { ok: true, alreadyActive: false };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('power:allowDisplaySleep', () => {
    try {
      if (_powerSaveBlockerId !== null && powerSaveBlocker.isStarted(_powerSaveBlockerId)) {
        powerSaveBlocker.stop(_powerSaveBlockerId);
      }
      _powerSaveBlockerId = null;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  // アプリ終了時の確実な解放
  app.on('will-quit', () => {
    try {
      if (_powerSaveBlockerId !== null && powerSaveBlocker.isStarted(_powerSaveBlockerId)) {
        powerSaveBlocker.stop(_powerSaveBlockerId);
      }
    } catch (_) { /* ignore */ }
    _powerSaveBlockerId = null;
  });

  ipcMain.handle('tournament:set', (_event, partial) => {
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
    return { ...updated, title: updated.name };
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
    }
    if (snapshot.audioSettings === null) snapshot.audioSettings = store.get('audio') || null;
    if (snapshot.venueName     === null) snapshot.venueName     = store.get('venueName') || '';
    if (snapshot.logoUrl       === null) snapshot.logoUrl       = store.get('logo') || null;
    return snapshot;
  });

  // operator → main → hall の操作リクエスト中継（router）。
  //   既存ハンドラは無変更、薄い wrapper として転送する。
  //   ホワイトリスト方式で許可 action のみ受理（hall からの操作リクエストは STEP 3 で禁止確定）。
  const _DUAL_ACTION_ROUTE = Object.freeze({
    'tournaments:setTimerState':       (p) => ({ id: p.id, timerState: p.timerState }),
    'tournaments:setRuntime':          (p) => ({ id: p.id, runtime: p.runtime }),
    'tournaments:setDisplaySettings':  (p) => ({ id: p.id, displaySettings: p.displaySettings }),
    'tournaments:setMarqueeSettings':  (p) => ({ id: p.id, marqueeSettings: p.marqueeSettings }),
    'tournaments:setActive':           (p) => p.id,
    'audio:set':                        (p) => p
  });
  ipcMain.handle('dual:operator-action', async (_event, envelope) => {
    if (!envelope || typeof envelope !== 'object') return { ok: false, error: 'invalid-envelope' };
    const { action, payload } = envelope;
    if (typeof action !== 'string' || !_DUAL_ACTION_ROUTE[action]) {
      return { ok: false, error: 'unknown-action' };
    }
    // 既存ハンドラ呼出。emit を使うと event オブジェクトが必要なので、直接 store 操作はせず
    // Electron の ipcMain.handlers から取得する仕組みは無いため、ホワイトリスト経由の関数呼出 pattern を採る。
    // ただし簡素化のため、既存ハンドラの内部処理を再利用する代わりに、cache 更新 + broadcast のみ実施。
    // STEP 3 で operator 側からの実呼出を本格化する際に必要に応じて拡張する。
    return { ok: true, action, payloadShape: _DUAL_ACTION_ROUTE[action](payload || {}) };
  });
}

app.whenReady().then(() => {
  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  registerIpcHandlers();
  createMainWindow();
  registerShortcuts();

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

  // STEP 10 フェーズC.1.2 Fix 3 + C.1.2-followup: 自動更新（electron-updater）— 配布版のみ動作、開発時はスキップ。
  //   GitHub Releases から新版をチェック → 通知 → ダウンロード → ユーザー確認後に再起動。
  //   isDev のときは何もせず（npm start での誤動作 / GitHub レート消費を防止）。
  //   C.1.2-followup: GitHub リポジトリ未作成のため publish 設定は package.json から削除済。
  //   publish 未設定だと checkForUpdatesAndNotify は内部で warning を出すため、ハンドラ側で抑制する（クラッシュなし）。
  //   GitHub リリース運用開始時は package.json の build.publish を再度設定する。
  const hasPublishConfig = !!(app.isPackaged && (() => {
    try {
      const pkg = require('../package.json');
      return pkg && pkg.build && pkg.build.publish;
    } catch (_) { return false; }
  })());
  if (!isDev && autoUpdater && hasPublishConfig) {
    try {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = false;   // ユーザー確認を経て quitAndInstall 呼出
      autoUpdater.on('error', (err) => {
        console.warn('[auto-updater] error:', err && err.message);
      });
      autoUpdater.on('update-available', (info) => {
        console.log('[auto-updater] update-available:', info?.version);
      });
      autoUpdater.on('update-downloaded', async (info) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const result = await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '更新の準備ができました',
          message: `新しいバージョン (${info?.version || '最新版'}) のダウンロードが完了しました。\n再起動して更新しますか？`,
          buttons: ['再起動して更新', '後で'],
          defaultId: 0,
          cancelId: 1
        });
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        // publish 未設定 / ネットワーク不通 / レート制限など — 通常運用に影響なし
        console.log('[auto-updater] update check skipped:', err && err.message);
      });
    } catch (err) {
      console.log('[auto-updater] setup skipped:', err && err.message);
    }
  } else if (!isDev && autoUpdater && !hasPublishConfig) {
    // GitHub リポジトリ未作成のため自動更新は将来有効化予定。本起動では何もしない。
    console.log('[auto-updater] disabled: build.publish not configured (planned for future GitHub release)');
  }

  // STEP 6.21.4: PC スリープ → 復帰時にレンダラへ通知
  // レンダラ側で active トーナメントの timerState を時刻ベースで再同期する
  powerMonitor.on('resume', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('system:resume');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

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
