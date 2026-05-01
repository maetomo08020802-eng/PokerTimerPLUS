// PokerTimerPLUS+ レンダラエントリポイント
// 役割: 各モジュール（state / blinds / timer / marquee）を組み立て、UI と入力を接続する。

import { States, getState, subscribe } from './state.js';
import {
  loadPreset,
  getLevel,
  getNextLevel,
  getLevelCount,
  getStructure,
  setStructure,
  cloneStructure,
  validateStructure,
  checkStructureSoftWarnings,
  exportToJSON,
  importFromJSON,
  renumberLevels
} from './blinds.js';
import {
  setHandlers,
  start as timerStart,
  startAtLevel as timerStartAtLevel,
  startPreStart as timerStartPreStart,
  cancelPreStart as timerCancelPreStart,
  isPreStartActive,
  getPreStartTotalMs,
  pause as timerPause,
  resume as timerResume,
  reset as timerReset,
  // STEP 6.21.3: 60秒単位 → 30秒単位
  advance30Seconds,
  rewind30Seconds,
  // STEP 6.21: 経過秒復元のため advanceTimeBy を低レベル呼び出しで使う
  advanceTimeBy as timerAdvanceBy
} from './timer.js';
import {
  initMarquee,
  applyMarquee,
  openMarqueeDialog,
  closeMarqueeDialog,
  readMarqueeForm
} from './marquee.js';
import {
  initAudio,
  ensureAudioReady,
  setMasterVolume as audioSetMasterVolume,
  setEnabled as audioSetEnabled,
  setVariant as audioSetVariant,
  applyAudioSettings,
  playSound,
  playSoundForce,
  toggleMute as audioToggleMute,
  isMuted as audioIsMuted,
  getMasterVolume as audioGetMasterVolume
} from './audio.js';
// v2.0.0 STEP 2: hall 側のみで起動する状態同期レイヤ。operator / operator-solo では no-op。
// v2.0.1 #A1: registerDualDiffHandler で受信した差分を実 DOM 更新に反映する経路を追加。
import { initDualSyncForHall, registerDualDiffHandler } from './dual-sync.js';

console.log('PokerTimerPLUS+ 起動');

// v2.0.2: notifyOperatorActionIfNeeded ヘルパー撤去。
//   元々 main 側 dual:operator-action へ通知する薄い wrapper だったが、main 側ハンドラが
//   validate して payloadShape を返すだけの no-op だったため、preload + main と同時撤去。
//   operator → hall の状態伝播は既存 IPC（tournaments:setTimerState 等）→ main 側
//   _publishDualState 経路で正常動作している。

const WARN_THRESHOLD_MS = 60 * 1000;
const DANGER_THRESHOLD_MS = 10 * 1000;

// STEP 6: ランタイム値（参加人数 / リバイ / アドオン）— トーナメント開始時に設定、
// ↑↓ Ctrl+R Ctrl+A 等で動的更新。実プールやアベスタックはここから計算する。
const tournamentRuntime = {
  playersInitial: 0,        // 開始時の参加者数（プレスタートダイアログで設定）
  playersRemaining: 0,      // 現在の残り人数
  // STEP 6.9: rebuyCount → reentryCount
  reentryCount: 0,
  addOnCount: 0
};

// トーナメント基本情報（mutable、トーナメントタブで編集可）
// electron-store 永続化、起動時 + 保存時に applyTournament で反映
// STEP 3b 拡張: id を追加（複数保存対応、active トーナメントの参照）
const tournamentState = {
  id: 'tournament-default',
  title: 'ポーカートーナメント',
  subtitle: '',
  currencySymbol: '¥',
  blindPresetId: 'demo-fast',   // 起動時に復元するブラインド構造ID（適用は「保存して適用」）
  // STEP 6: 拡張フィールド
  // STEP 10 フェーズA: defaults を新コードに統一（マイグレーション後の永続化形式と整合）
  gameType: 'nlh',
  startingStack: 10000,
  buyIn:   { fee: 3000, chips: 10000 },
  // STEP 6.8: allowedUntilLevel / allowedAtBreak は削除（運用柔軟性のため）
  // STEP 6.9: rebuy → reentry リネーム + specialStack 追加
  reentry: { fee: 2000, chips: 8000 },
  addOn:   { fee: 2000, chips: 10000 },
  payouts: [
    { rank: 1, percentage: 50 },
    { rank: 2, percentage: 30 },
    { rank: 3, percentage: 20 }
  ],
  // STEP 6.5
  guarantee: 0,
  payoutRounding: 100,
  // STEP 6.7
  prizeCategory: '',
  // STEP 6.9: 特殊スタック（早期着席特典・VIP特典など）
  specialStack: { enabled: false, label: '早期着席特典', chips: 5000, appliedCount: 0 },
  // STEP 6.17: メインタイトル色（hex #RRGGBB）
  titleColor: '#FFFFFF',
  // STEP 10 フェーズC.2.3: その他ゲーム種のカスタム名 / ブレイク後一時停止
  customGameName: '',
  pauseAfterBreak: false
};

// STEP 6.17: タイトル色 hex バリデーション（#RRGGBB のみ許可）
const TITLE_COLOR_RE_RENDERER = /^#[0-9A-Fa-f]{6}$/;

// STEP 6.9: HTML エスケープ（specialStack ラベルはユーザー入力のため XSS 対策必須）
function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// STEP 6.7: 100件上限（main.js の MAX_TOURNAMENTS / MAX_USER_PRESETS と同期）
const MAX_TOURNAMENTS = 100;
const MAX_USER_PRESETS = 100;

// STEP 6.8: SB 進行順序（同梱プリセットと共通の刻み）。
// 新規レベル追加時、直前 SB の次の値を返す。完全一致が無い場合は直近の大きい値、
// 範囲外（>100000）は従来通り 2 倍。
const SB_PROGRESSION = Object.freeze([
  100, 200, 300, 400, 500, 600, 800, 1000, 1200,
  1600, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000, 12000,
  16000, 20000, 25000, 30000, 40000, 50000, 60000, 80000, 100000
]);

function getNextSB(currentSB) {
  const cur = Number(currentSB) || 0;
  const idx = SB_PROGRESSION.indexOf(cur);
  if (idx >= 0 && idx < SB_PROGRESSION.length - 1) {
    return SB_PROGRESSION[idx + 1];
  }
  for (const v of SB_PROGRESSION) {
    if (v > cur) return v;
  }
  return cur > 0 ? cur * 2 : 100;
}

// 賞金構造エディタの入力モード（'percent' | 'amount'）。内部スキーマは常に % を保持
let payoutInputMode = 'percent';

// ゲーム種コード → 表示文字列
// STEP 10 フェーズA: 新コード（'nlh' 等）と旧コード（'NLHE' 等）の両対応マップ。
//   マイグレーション後の永続化形式は新コードに統一されるが、表示時のフォールバック用に旧コードも残置。
//   フェーズB で 11 ゲームすべてのドロップダウン UI を整備する。
const GAME_TYPE_LABEL = Object.freeze({
  // 新コード（STEP 10 GAMES と同じラベル）
  'nlh':          'NLH',
  'plo':          'PLO',
  'plo5':         '5 Card PLO',
  'plo8':         'PLO8',
  'big-o-blind':  'Big O (Blind)',
  'big-o-limit':  'Big O (Limit)',
  'omaha-hilo':   'Omaha Hi-Lo',
  'short-deck':   'Short Deck',
  'stud':         'Stud',
  'razz':         'Razz',
  'stud-hilo':    'Stud Hi-Lo',
  'limit-holdem': "Limit Hold'em",
  'mix':          'MIX (10-Game)',
  'other':        'その他',
  // 旧コード（マイグレーション漏れ救済の表示フォールバック）
  NLHE:  "No Limit Hold'em",
  PLO:   'Pot Limit Omaha',
  NLO8:  'No Limit Omaha 8',
  Stud:  'Stud',
  Mixed: 'Mixed',
  Other: 'その他'
});

// 賞金プリセット（順位数 → % 配列）
// 15 / 20 / 30 位は WPT/WSOP 風の段階的配分。合計が必ず 100% になるよう正規化済み。
const PAYOUT_PRESETS = Object.freeze({
  1:  [100],
  2:  [60, 40],
  3:  [50, 30, 20],
  5:  [40, 25, 18, 11, 6],
  9:  [30, 20, 15, 11, 8, 6, 4, 3, 3],
  15: [27, 17, 12, 8, 6.5, 5, 4, 3.5, 3, 2.5, 2.5, 2.5, 2.5, 2, 2],
  20: [22, 14, 10, 7.5, 6, 5, 4.5, 4, 3.5, 3, 2.7, 2.4, 2.1, 1.9, 1.7, 1.5, 1.4, 1.3, 1.2, 1.3],
  30: [18, 11.5, 8.5, 6.5, 5, 4.2, 3.6, 3.2, 2.8, 2.5, 2.3, 2.1, 1.9, 1.8, 1.7, 1.6, 1.5, 1.4, 1.3, 1.2, 1.1, 1, 0.9, 0.8, 0.8, 0.7, 0.7, 0.6, 0.6, 1.7]
});

const el = {
  clock: document.querySelector('.clock'),
  time: document.getElementById('js-time'),
  eventTitle: document.getElementById('js-event-title'),
  eventSubtitle: document.getElementById('js-event-subtitle'),
  eventGameType: document.getElementById('js-event-game-type'),
  eventPrizeCategory: document.getElementById('js-event-prize-category'),
  levelNum: document.getElementById('js-level-num'),
  // STEP 10 フェーズB: BLINDS / NEXT LEVEL カードを構造型ごとの動的レンダリング化
  //   旧 js-blinds-current / js-ante-row / js-ante-value / js-next-blinds / js-next-ante-row / js-next-ante-value は廃止
  //   新: js-blinds-content / js-blinds-next-content（フィールド + 値の grid を JS で描画）
  blindsContent:     document.getElementById('js-blinds-content'),
  blindsNextContent: document.getElementById('js-blinds-next-content'),
  nextBreak: document.getElementById('js-next-break'),
  // STEP 10 フェーズC.1.6 Fix 2: NEXT BREAK IN ↔ TOTAL GAME TIME のラベル切替用
  nextBreakLabel: document.getElementById('js-next-break-label'),
  payoutsList: document.getElementById('js-payouts-list'),
  totalPool: document.getElementById('js-total-pool'),
  poolNote: document.getElementById('js-pool-note'),
  finishedOverlay: document.getElementById('js-finished-overlay'),
  avgStack: document.getElementById('js-avg-stack'),
  playersValue: document.getElementById('js-players'),
  // STEP 6.9: REBUY → REENTRY 改名
  reentryValue: document.getElementById('js-reentry'),
  addonValue: document.getElementById('js-addon'),
  // STEP 6.11: 0 時非表示 / 0→1 ぼわーん演出のため行要素を取得
  reentryRow: document.getElementById('js-reentry-row'),
  addonRow:   document.getElementById('js-addon-row'),
  // STEP 6.9: 特殊スタック表示行
  // STEP 6.10: 単一テキスト要素「特殊配布: {label} {合計}」に整理（label/value 分割は廃止）
  specialStackRow:  document.getElementById('js-special-stack-row'),
  specialStackText: document.getElementById('js-special-stack-text'),
  btnStart: document.getElementById('js-btn-start'),
  btnPause: document.getElementById('js-btn-pause'),
  btnReset: document.getElementById('js-btn-reset'),
  resetDialog: document.getElementById('js-reset-dialog'),
  resetCancel: document.getElementById('js-reset-cancel'),
  resetOk: document.getElementById('js-reset-ok'),
  prestartDialog: document.getElementById('js-prestart-dialog'),
  prestartOptions: document.getElementById('js-prestart-options'),
  prestartCustomMin: document.getElementById('js-prestart-custom-min'),
  prestartPlayers: document.getElementById('js-prestart-players'),   // STEP 6
  prestartCancel: document.getElementById('js-prestart-cancel'),
  prestartOk: document.getElementById('js-prestart-ok'),

  marquee: document.getElementById('js-marquee'),
  marqueeContent: document.getElementById('js-marquee-content'),
  marqueeDialog: document.getElementById('js-marquee-dialog'),
  marqueeEnabled: document.getElementById('js-marquee-enabled'),
  marqueeText: document.getElementById('js-marquee-text'),
  marqueeSpeedRadios: document.getElementsByName('marquee-speed'),
  marqueePreview: document.getElementById('js-marquee-preview'),
  marqueeSave: document.getElementById('js-marquee-save'),
  marqueeClose: document.getElementById('js-marquee-close'),

  settingsDialog: document.getElementById('js-settings-dialog'),
  settingsClose: document.getElementById('js-settings-close'),
  bgPicker: document.getElementById('js-bg-picker'),
  // STEP 10 フェーズC.1.3: カスタム画像詳細パネル
  bgImagePanel: document.getElementById('js-bg-image-panel'),
  bgImageSelect: document.getElementById('js-bg-image-select'),
  bgImageClear: document.getElementById('js-bg-image-clear'),
  bgImagePreview: document.getElementById('js-bg-image-preview'),
  bgImagePlaceholder: document.getElementById('js-bg-image-placeholder'),
  bgImageError: document.getElementById('js-bg-image-error'),
  bgImageOverlay: document.getElementById('js-bg-image-overlay'),
  // STEP 10 フェーズC.1.4-fix3 Fix 3: 画像合計サイズ警告アイコン
  sizeWarningBg: document.getElementById('js-size-warning-bg'),
  sizeWarningBreak: document.getElementById('js-size-warning-break'),
  // STEP 10 フェーズC.1.4: 休憩中スライドショー
  breakImagesAdd: document.getElementById('js-break-images-add'),
  breakImagesList: document.getElementById('js-break-images-list'),
  breakImagesPlaceholder: document.getElementById('js-break-images-placeholder'),
  breakImagesCount: document.getElementById('js-break-images-count'),
  breakImageInterval: document.getElementById('js-break-image-interval'),
  breakImagesClear: document.getElementById('js-break-images-clear'),
  breakImagesError: document.getElementById('js-break-images-error'),
  slideshowStage: document.getElementById('js-slideshow-stage'),
  slideshowImg: document.getElementById('js-slideshow-img'),
  pipTimer: document.getElementById('js-pip-timer'),
  pipDigits: document.getElementById('js-pip-digits'),
  pipLabel: document.getElementById('js-pip-label'),
  pipShowTimer: document.getElementById('js-pip-show-timer'),
  pipShowSlideshow: document.getElementById('js-pip-show-slideshow'),
  fontPicker: document.getElementById('js-font-picker'),

  // STEP 6.22: 店舗名「Presented by ○○」関連
  presentedBy:     document.getElementById('js-presented-by'),
  venueNameInput:  document.getElementById('js-venue-name'),
  venueNameError:  document.getElementById('js-venue-name-error'),
  venueSaveBtn:    document.getElementById('js-venue-save'),

  // STEP 9-B: 左上ロゴ関連
  clockLogo:           document.getElementById('js-clock-logo'),
  logoPlaceholder:     document.getElementById('js-logo-placeholder'),
  logoImg:             document.getElementById('js-logo-img'),
  logoModeRadios:      document.getElementsByName('logo-mode'),
  logoSelectFileBtn:   document.getElementById('js-logo-select-file'),
  logoHint:            document.getElementById('js-logo-hint'),

  // STEP 6.23: PC間データ移行（エクスポート/インポート）関連
  exportSingleFileBtn:      document.getElementById('js-export-single-file'),
  exportSingleClipboardBtn: document.getElementById('js-export-single-clipboard'),
  exportBulkFileBtn:        document.getElementById('js-export-bulk-file'),
  importFileBtn:            document.getElementById('js-import-file'),
  importClipboardBtn:       document.getElementById('js-import-clipboard'),
  dataTransferHint:         document.getElementById('js-data-transfer-hint'),
  // インポート戦略選択ダイアログ
  importStrategyDialog:     document.getElementById('js-import-strategy-dialog'),
  importCount:              document.getElementById('js-import-count'),
  importCancel:             document.getElementById('js-import-cancel'),
  importStrategyRename:     document.getElementById('js-import-strategy-rename'),
  importStrategyOverwrite:  document.getElementById('js-import-strategy-overwrite'),

  // 設定タブ版テロップフォーム（Ctrl+T ダイアログとは別 DOM、データは electron-store で共有）
  marqueeTabEnabled: document.getElementById('js-marquee-tab-enabled'),
  marqueeTabText: document.getElementById('js-marquee-tab-text'),
  marqueeTabSpeedRadios: document.getElementsByName('marquee-tab-speed'),
  marqueeTabPreview: document.getElementById('js-marquee-tab-preview'),
  marqueeTabSave: document.getElementById('js-marquee-tab-save'),
  marqueeTabHint: document.getElementById('js-marquee-tab-hint'),

  // 音タブ（STEP 4）
  audioMasterVolume:    document.getElementById('js-audio-master-volume'),
  audioVolumeDisplay:   document.getElementById('js-audio-volume-display'),
  audioWarning1Min:     document.getElementById('js-audio-warning-1min'),
  audioWarning10Sec:    document.getElementById('js-audio-warning-10sec'),
  audioCountdown5Sec:   document.getElementById('js-audio-countdown-5sec'),
  audioLevelEnd:        document.getElementById('js-audio-level-end'),
  audioBreakEnd:        document.getElementById('js-audio-break-end'),
  audioStart:           document.getElementById('js-audio-start'),
  audioVariantLevelEnd:        document.getElementById('js-audio-variant-level-end'),
  audioVariantCountdownTick:   document.getElementById('js-audio-variant-countdown-tick'),
  audioTestButtons:     document.querySelectorAll('[data-test-sound]'),
  audioHint:            document.getElementById('js-audio-hint'),

  // ハウス情報タブ
  appVersion: document.getElementById('js-app-version'),

  // タブ系
  settingsTabBtns: document.querySelectorAll('.settings-tab-btn'),
  settingsTabPanels: document.querySelectorAll('.settings-tab'),

  // トーナメントエディタ（STEP 3b、設定タブ「トーナメント」）
  // STEP 3b 拡張: 複数保存対応のセレクタ・操作ボタン
  tournamentSelect: document.getElementById('js-tournament-select'),
  // STEP 6.21: 状態バッジ + 操作ボタン付きリスト
  tournamentList: document.getElementById('js-tournament-list'),
  tournamentNew: document.getElementById('js-tournament-new'),
  tournamentDuplicate: document.getElementById('js-tournament-duplicate'),
  // STEP 7.x ③-a: tournamentDelete（ヘッダー削除ボタン）は撤去。各行の🗑ボタンに移行
  // STEP 7.x ③-d: 削除確認ダイアログ
  tournamentDeleteDialog:  document.getElementById('js-tournament-delete-dialog'),
  tournamentDeleteName:    document.getElementById('js-tournament-delete-name'),
  tournamentDeleteCancel:  document.getElementById('js-tournament-delete-cancel'),
  tournamentDeleteOk:      document.getElementById('js-tournament-delete-ok'),
  tournamentTitle: document.getElementById('js-tournament-title'),
  tournamentSubtitle: document.getElementById('js-tournament-subtitle'),
  tournamentCurrency: document.getElementById('js-tournament-currency'),
  tournamentBlindPreset: document.getElementById('js-tournament-blind-preset'),
  tournamentEditBlinds: document.getElementById('js-tournament-edit-blinds'),
  tournamentSave: document.getElementById('js-tournament-save'),
  tournamentSaveApply: document.getElementById('js-tournament-save-apply'),
  tournamentHint: document.getElementById('js-tournament-hint'),
  // STEP 6: 拡張フィールド
  tournamentGameType: document.getElementById('js-tournament-game-type'),
  // STEP 10 フェーズC.2.3: その他ゲーム種のカスタム名 / ブレイク後一時停止
  tournamentCustomGame:        document.getElementById('js-tournament-custom-game'),
  tournamentCustomGameWrapper: document.getElementById('js-tournament-custom-game-wrapper'),
  tournamentPauseAfterBreak:   document.getElementById('js-tournament-pause-after-break'),
  tournamentStartingStack: document.getElementById('js-tournament-starting-stack'),
  tournamentBuyinFee:    document.getElementById('js-tournament-buyin-fee'),
  tournamentBuyinChips:  document.getElementById('js-tournament-buyin-chips'),
  // STEP 6.9: rebuy → reentry リネーム
  tournamentReentryFee:    document.getElementById('js-tournament-reentry-fee'),
  tournamentReentryChips:  document.getElementById('js-tournament-reentry-chips'),
  tournamentAddonFee:      document.getElementById('js-tournament-addon-fee'),
  tournamentAddonChips:    document.getElementById('js-tournament-addon-chips'),
  // STEP 6.9: 特殊スタック フォーム
  tournamentSpecialStackEnabled: document.getElementById('js-tournament-special-stack-enabled'),
  tournamentSpecialStackLabel:   document.getElementById('js-tournament-special-stack-label'),
  tournamentSpecialStackChips:   document.getElementById('js-tournament-special-stack-chips'),
  tournamentSpecialStackCount:   document.getElementById('js-tournament-special-stack-count'),
  tournamentPayoutCount: document.getElementById('js-tournament-payout-count'),
  tournamentPayoutPreset:document.getElementById('js-tournament-payout-preset'),
  tournamentPayoutsEditor: document.getElementById('js-tournament-payouts-editor'),
  tournamentPayoutsSum:  document.getElementById('js-tournament-payouts-sum'),
  // STEP 6.5
  tournamentGuarantee:      document.getElementById('js-tournament-guarantee'),
  tournamentPayoutRounding: document.getElementById('js-tournament-payout-rounding'),
  tournamentPayoutMode:     document.getElementById('js-tournament-payout-mode'),
  // STEP 6.7
  tournamentPrizeCategory:  document.getElementById('js-tournament-prize-category'),
  tournamentTitleCounter:   document.getElementById('js-tournament-title-counter'),
  // STEP 6.17: サブタイトル文字数カウンタ
  tournamentSubtitleCounter: document.getElementById('js-tournament-subtitle-counter'),
  // STEP 6.17: タイトル色ピッカー
  titleColorPicker:       document.getElementById('js-tournament-title-color-picker'),
  titleColorCustomInput:  document.getElementById('js-tournament-title-color-custom'),
  tournamentCount:          document.getElementById('js-tournament-count'),
  presetCount:              document.getElementById('js-preset-count'),
  // STEP 6.8: 適用モード選択ダイアログ（リセット / 継続 / キャンセル）
  applyModeDialog:    document.getElementById('js-apply-mode-dialog'),
  applyModeHint:      document.getElementById('js-apply-mode-hint'),
  applyReset:         document.getElementById('js-apply-reset'),
  applyContinue:      document.getElementById('js-apply-continue'),
  applyOnly:          document.getElementById('js-apply-only'),
  applyCancel:        document.getElementById('js-apply-cancel'),
  // STEP 6.21.5.1: ブラインド適用モード選択（リセット / 経過保持 / キャンセル）
  blindsApplyDialog:  document.getElementById('js-blinds-apply-mode-dialog'),
  blindsApplyHint:    document.getElementById('js-blinds-apply-mode-hint'),
  blindsApplyReset:   document.getElementById('js-blinds-apply-reset'),
  blindsApplyContinue: document.getElementById('js-blinds-apply-continue'),
  blindsApplyOnly:    document.getElementById('js-blinds-apply-only'),
  blindsApplyCancel:  document.getElementById('js-blinds-apply-cancel'),

  // ブラインド構造エディタ（STEP 3b）
  presetSelect: document.getElementById('js-preset-select'),
  presetNew: document.getElementById('js-preset-new'),
  presetDuplicate: document.getElementById('js-preset-duplicate'),
  presetDelete: document.getElementById('js-preset-delete'),
  presetName: document.getElementById('js-preset-name'),
  presetDirty: document.getElementById('js-preset-dirty'),
  // STEP 6.21.5: ブラインド共有 / フォーマット化ヒント
  blindsShareHint: document.getElementById('js-blinds-share-hint'),
  blindsTbody: document.getElementById('js-blinds-tbody'),
  // STEP 10 フェーズB: 構造型に応じて thead を動的生成するため要素参照を追加
  blindsThead: document.getElementById('js-blinds-thead'),
  blindsTable: document.getElementById('js-blinds-table'),
  addLevelBtn: document.getElementById('js-add-level'),
  // STEP 6.8: addBreakBtn は廃止（ブレイクは行のチェックボックスで作成）
  presetExport: document.getElementById('js-preset-export'),
  presetImport: document.getElementById('js-preset-import'),
  presetImportFile: document.getElementById('js-preset-import-file'),
  presetSave: document.getElementById('js-preset-save'),
  presetApply: document.getElementById('js-preset-apply'),
  blindsHint: document.getElementById('js-blinds-hint'),
  // STEP 7.x ①: 同梱プリセット編集警告
  blindsBuiltinWarning: document.getElementById('js-blinds-builtin-warning')
};

// STEP 10 フェーズC.1.3: 9 種類目「カスタム画像」を追加（'image'）
const VALID_BACKGROUNDS = ['black', 'navy', 'carbon', 'felt', 'burgundy', 'midnight', 'emerald', 'obsidian', 'image'];
// STEP 10 フェーズC.1.3: 暗くする overlay 強度マッピング（low 30% / mid 50% / high 70%）
const BG_OVERLAY_ALPHA = { low: 0.3, mid: 0.5, high: 0.7 };
// 直近の "色プリセット"（image 以外）を覚えて、画像未設定時のフォールバック先にする。
let _lastColorBackground = 'navy';
// STEP 10 フェーズC.1.3-fix1 Fix 2: ユーザーが最後にチップで選択した値（image 含む）。
//   フォールバック後の effective 値（dataset.bg）と分離して記録することで、
//   「画像チップ選択 → 画像ロード」の初回自動反映を成立させる。
let _userBgChoice = 'navy';
// 現在のカスタム画像状態（applyTournament / 設定保存で更新）
const bgImageState = { dataUrl: '', overlay: 'mid' };

// STEP 10 フェーズC.1.4: 休憩中スライドショー
const VALID_PIP_SIZES = ['small', 'medium', 'large'];
const BREAK_IMAGES_MAX_COUNT = 20;
const SLIDESHOW_AUTO_END_MS = 60_000;   // 残り 60 秒で自動 OFF
// STEP 10 フェーズC.1.4-fix2 Fix 1: BREAK 突入から 30 秒経過後に初回スライドショー開始（PRE_START は対象外）
const SLIDESHOW_BREAK_DELAY_MS = 30_000;
// STEP 10 フェーズC.1.4-fix3 Fix 3: 画像合計サイズ警告閾値（150 MB）
const IMAGE_SIZE_WARNING_THRESHOLD_BYTES = 150 * 1024 * 1024;
// 1 セッションで警告ポップアップは 1 度のみ
let imageSizeWarningShownInSession = false;
// breakImages / 切替間隔 / pipSize の現在値（applyTournament で同期）
const breakImagesState = { images: [], intervalSec: 10, pipSize: 'medium' };
// スライドショー状態管理
//   active: 現在スライドショー表示中か
//   currentIndex: 表示中の画像インデックス
//   intervalId: setInterval ID
//   userOverride: 'auto'（自動）/ 'force-timer'（ユーザーが手動でタイマー画面に戻した）
//   autoEndedAt: 残り何 ms で自動 OFF したか（重複発火防止）
const slideshowState = {
  active: false,
  currentIndex: 0,
  intervalId: null,
  userOverride: 'auto',
  autoEndedAt: null,
  // STEP 10 フェーズC.1.4-fix2 Fix 1: BREAK 突入時の Date.now()。PRE_START では設定しない（即時表示維持）。
  breakStartedAt: null
};

// ===== フォーマッタ =====

function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function formatHMS(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// ===== STEP 10 フェーズB.fix9: 入力中保護の統一ヘルパ =====
//   ユーザーが「打鍵で値が変わる」入力欄（text/number/textarea/contentEditable）にフォーカス中は true。
//   checkbox / radio / button / file / color / range は除外（fix8 と同等、打鍵で値が変わらない要素）。
//   この関数は以下の関数で「入力中の自動同期/再描画スキップ」のガード判定に使われる:
//     - renderTournamentList（1 秒タイマー駆動）
//     - renderBlindsTable（編集テーブル再構築）
//     - syncTournamentFormFromState（フォーム値同期）
//     - loadTournamentIntoForm（active 切替時のフォーム同期）
//     - populateTournamentBlindPresets / refreshPresetList（select 再構築）
//     - syncMarqueeTabFormFromCurrent（テロップフォーム同期）
//   これにより「打鍵中の文字消失」「カーソルジャンプ」を原理的に防止する。
//   再発防止メモ: 新たに input/textarea を再生成 or .value= 上書きする関数を追加した場合、
//                 必ずこのヘルパでガードを入れる（CC_REPORT.md §再発防止策 参照）
function isUserTypingInInput() {
  const ae = document.activeElement;
  if (!ae) return false;
  if (ae.isContentEditable) return true;
  if (ae.tagName === 'TEXTAREA') return true;
  if (ae.tagName === 'INPUT') {
    const type = (ae.type || '').toLowerCase();
    const NON_TYPING = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color', 'range', 'image']);
    return !NON_TYPING.has(type);
  }
  return false;
}

const formatNumber = (n) => n.toLocaleString('ja-JP');
// 通貨記号は tournamentState から取得（トーナメントタブ「保存」で即時更新）
const formatCurrency = (n) => `${tournamentState.currencySymbol}${formatNumber(n)}`;

// ===== STEP 10 フェーズB: 構造型ヘルパ + 動的レンダリング =====

// 構造型 → フィールド一覧（main.js の STRUCTURE_TYPES と同じ。renderer 側ローカル定義で IPC 不要）
// STEP 10 フェーズC.2.3: MIX 追加（fields: 動的、レベルの subStructureType を参照）
const STRUCTURE_FIELDS = Object.freeze({
  BLIND:        ['sb', 'bb', 'bbAnte'],
  LIMIT_BLIND:  ['sb', 'bb', 'smallBet', 'bigBet'],
  SHORT_DECK:   ['ante', 'buttonBlind'],
  STUD:         ['ante', 'bringIn', 'smallBet', 'bigBet'],
  MIX:          []
});

// gameType → structureType（main.js の GAMES と同じ）
// STEP 10 フェーズC.2.3: limit-holdem / mix / other 追加
const GAME_STRUCTURE_TYPE = Object.freeze({
  'nlh':           'BLIND',
  'plo':           'BLIND',
  'plo5':          'BLIND',
  'plo8':          'BLIND',
  'big-o-blind':   'BLIND',
  'big-o-limit':   'LIMIT_BLIND',
  'omaha-hilo':    'LIMIT_BLIND',
  'limit-holdem':  'LIMIT_BLIND',
  'short-deck':    'SHORT_DECK',
  'stud':          'STUD',
  'razz':          'STUD',
  'stud-hilo':     'STUD',
  'mix':           'MIX',
  'other':         'BLIND'
});

// フィールドキー → 表示ラベル
const FIELD_LABEL = Object.freeze({
  sb:           'SB',
  bb:           'BB',
  bbAnte:       'BB Ante',
  smallBet:     'Small Bet',
  bigBet:       'Big Bet',
  ante:         'Ante',
  bringIn:      'Bring-In',
  buttonBlind:  'Button Blind'
});

// STEP 10 フェーズB.fix5: 構造型 → デフォルト同梱フォーマット ID
//   ゲーム種変更時、対応する構造型のデフォルト同梱フォーマットを自動ロード（雛形として提示）
const DEFAULT_PRESET_FOR_STRUCTURE = Object.freeze({
  BLIND:        'preset-regular',
  LIMIT_BLIND:  'limit-regular',
  SHORT_DECK:   'shortdeck-regular',
  STUD:         'stud-regular',
  MIX:          'mix-regular'
});

// STEP 10 フェーズC.2.5: MIX 用ゲーム種候補（10 種、固定）
//   各レベルの subGameType ドロップダウン選択肢。「その他（自由記入）」「MIX in MIX」は不可。
const MIX_GAMES = Object.freeze([
  { id: 'nlh',          label: 'NLH',           structureType: 'BLIND' },
  { id: 'plo',          label: 'PLO',           structureType: 'BLIND' },
  { id: 'plo8',         label: 'PLO8',          structureType: 'BLIND' },
  { id: 'limit-holdem', label: "Limit Hold'em", structureType: 'LIMIT_BLIND' },
  { id: 'omaha-hilo',   label: 'Omaha Hi-Lo',   structureType: 'LIMIT_BLIND' },
  { id: 'razz',         label: 'Razz',          structureType: 'STUD' },
  { id: 'stud',         label: 'Stud',          structureType: 'STUD' },
  { id: 'stud-hilo',    label: 'Stud Hi-Lo',    structureType: 'STUD' },
  { id: 'short-deck',   label: 'Short Deck',    structureType: 'SHORT_DECK' },
  { id: 'big-o-limit',  label: 'Big O Limit',   structureType: 'LIMIT_BLIND' }
]);
const MIX_GAME_IDS = MIX_GAMES.map((g) => g.id);
function getMixSubStructureType(subGameType) {
  const g = MIX_GAMES.find((x) => x.id === subGameType);
  return g ? g.structureType : null;
}

// MIX テンプレ内の通常レベル（!isBreak）に出現する subGameType のユニーク数
//   レベルが空 / break のみ / subGameType 未設定なら 0 を返す。
function countUniqueMixGames(levels) {
  if (!Array.isArray(levels)) return 0;
  const set = new Set();
  for (const lv of levels) {
    if (!lv || lv.isBreak) continue;
    if (typeof lv.subGameType === 'string' && lv.subGameType.length > 0) {
      set.add(lv.subGameType);
    }
  }
  return set.size;
}
function getDefaultPresetIdForStructure(structureType) {
  return DEFAULT_PRESET_FOR_STRUCTURE[structureType] || 'preset-regular';
}

function getStructureTypeForGameRenderer(gameType) {
  return GAME_STRUCTURE_TYPE[gameType] || 'BLIND';
}
function getStructureFieldsRenderer(structureType) {
  return STRUCTURE_FIELDS[structureType] || STRUCTURE_FIELDS.BLIND;
}

// 現在の active トーナメントの structureType を取得
// STEP 10 フェーズB.fix2: 優先順位を反転（ゲーム種優先）
//   従来: プリセット側 structureType（同梱4種は全て BLIND）が常勝 → ゲーム種を Stud にしても BLIND 表示で固まるバグ
//   修正: ゲーム種優先で導出、無効な場合のみプリセット側にフォールバック
//   フェーズB.fix1 の構造型違い→空テンプレ強制により、通常はプリセットとゲーム種の構造型は一致するが、
//   データ移行や手動操作で乖離が起こり得る。その場合は「ゲーム種が真の意図」として優先する。
function getCurrentStructureType() {
  // 1. ゲーム種から構造型を導出（最優先）
  const fromGame = getStructureTypeForGameRenderer(tournamentState.gameType);
  if (STRUCTURE_FIELDS[fromGame]) return fromGame;
  // 2. フォールバック: ゲーム種が無効ならプリセット側の structureType
  const struct = (typeof getStructure === 'function') ? getStructure() : null;
  if (struct && typeof struct.structureType === 'string' && STRUCTURE_FIELDS[struct.structureType]) {
    return struct.structureType;
  }
  // 3. 最終フォールバック
  return 'BLIND';
}

// blinds-content / blinds-next-content の中身（grid セル）をレベル + structureType で再描画
// targetEl: 対象 .blinds-content 要素
// level: 表示するレベル（null / undefined / break / 通常 を許容）
// structureType: 'BLIND' / 'LIMIT_BLIND' / 'SHORT_DECK' / 'STUD'
// opts: { isNext: boolean }（NEXT LEVEL カードかどうか、break ラベル表記の差分用）
function renderBlindsContent(targetEl, level, structureType, opts = {}) {
  if (!targetEl) return;
  const isNext = Boolean(opts.isNext);
  // STEP 10 フェーズC.2.3: MIX のとき、各レベルの subStructureType で実際の表示構造型を決定
  let effectiveStructure = structureType;
  if (structureType === 'MIX' && level && !level.isBreak && typeof level.subStructureType === 'string'
      && STRUCTURE_FIELDS[level.subStructureType] && level.subStructureType !== 'MIX') {
    effectiveStructure = level.subStructureType;
  }
  // 構造型属性は CSS の grid-template-columns 切替用
  targetEl.dataset.structure = effectiveStructure;

  // 「最終レベル」「ブレイク」は単一セル占有表記。data-state 属性で CSS が grid を 1 列に切替
  if (!level) {
    targetEl.dataset.state = 'empty';
    delete targetEl.dataset.maxDigits;
    targetEl.innerHTML = `<div class="blinds-field blinds-field--full"><span class="blinds-field__value">— (最終)</span></div>`;
    return;
  }
  if (level.isBreak) {
    targetEl.dataset.state = 'break';
    delete targetEl.dataset.maxDigits;
    const label = level.label || 'ブレイク';
    targetEl.innerHTML = `<div class="blinds-field blinds-field--full"><span class="blinds-field__value">${escapeHtml(label)}</span></div>`;
    return;
  }
  targetEl.dataset.state = 'normal';
  // STEP 10 フェーズC.2.3: effectiveStructure（MIX のとき level.subStructureType で動的決定）から fields を取得
  const fields = getStructureFieldsRenderer(effectiveStructure);
  // STEP 10 フェーズC.2.7-A patch2: フィールド単位の data-digits 縮小をやめ、
  //   カード内最大桁数（data-max-digits）でカード全体を統一縮小に変更。
  //   不揃い解消のため、カード親要素 (.blinds-content) に max を集約する。
  let maxDigits = 0;
  for (const f of fields) {
    const v = level[f];
    if (typeof v === 'number' && v > 0) {
      const d = String(Math.floor(Math.abs(v))).length;
      if (d > maxDigits) maxDigits = d;
    }
  }
  if (maxDigits > 0) targetEl.dataset.maxDigits = String(maxDigits);
  else delete targetEl.dataset.maxDigits;
  const cellsHtml = fields.map((f) => {
    const v = level[f];
    const value = (typeof v === 'number') ? formatNumber(v) : '—';
    return `<div class="blinds-field" data-field="${f}">
      <span class="blinds-field__label">${escapeHtml(FIELD_LABEL[f] || f)}</span>
      <span class="blinds-field__value">${escapeHtml(value)}</span>
    </div>`;
  }).join('');
  targetEl.innerHTML = cellsHtml;
}

function renderCurrentLevel(index) {
  const level = getLevel(index);
  if (!level) return;
  const structureType = getCurrentStructureType();
  if (level.isBreak) {
    el.levelNum.textContent = 'BREAK';
  } else {
    el.levelNum.textContent = `Level ${level.level}`;
  }
  renderBlindsContent(el.blindsContent, level, structureType, { isNext: false });
  // STEP 10 フェーズC.2.5 Fix 2-A/B: MIX ゲーム数を実際のテンプレート内ユニーク数で動的表示
  //   旧: 固定 "MIX (10-Game)" → 新: "MIX (${count}-Game)"。3-Game / 6-Game の店舗カスタムにも対応。
  if (el.eventGameType && tournamentState.gameType === 'mix') {
    const struct = getStructure();
    const count = struct ? countUniqueMixGames(struct.levels) : 0;
    const countLabel = count > 0 ? `MIX (${count}-Game)` : 'MIX';
    const subLabel = (level && !level.isBreak && typeof level.subGameType === 'string')
      ? (GAME_TYPE_LABEL[level.subGameType] || level.subGameType)
      : '';
    el.eventGameType.textContent = subLabel
      ? `${countLabel} — 現在: ${subLabel}`
      : countLabel;
  }
}

function renderNextLevel(index) {
  const next = getNextLevel(index);
  const structureType = getCurrentStructureType();
  renderBlindsContent(el.blindsNextContent, next || null, structureType, { isNext: true });
}

function classifyTimerState(remainingMs) {
  if (remainingMs <= 0) return 'normal';
  if (remainingMs <= DANGER_THRESHOLD_MS) return 'danger';
  if (remainingMs <= WARN_THRESHOLD_MS) return 'warn';
  return 'normal';
}

// PRE_START 用フォーマット: 選択時間が 60 分以上なら HH:MM:SS 固定、未満なら MM:SS 固定。
// （プレスタート総時間で1度だけ決まるため、進行中に表示桁数が変わらず layout shift しない）
function formatPreStartTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const useHMS = getPreStartTotalMs() >= 60 * 60 * 1000;
  return useHMS
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

// タイマーは単一要素テキストで更新（モノスペースフォントが桁幅を保証する）
function renderTime(remainingMs) {
  const { status } = getState();
  if (status === States.PRE_START) {
    el.time.textContent = formatPreStartTime(remainingMs);
    // PRE_START では最後10秒のみ赤、それ以外は通常色
    el.clock.dataset.timerState = remainingMs > 0 && remainingMs <= DANGER_THRESHOLD_MS ? 'danger' : 'normal';
    // フォーマット属性: 60分以上は HH:MM:SS（hms）、未満は MM:SS（ms）→ CSS が font-size を切替
    el.clock.dataset.prestartFormat = getPreStartTotalMs() >= 60 * 60 * 1000 ? 'hms' : 'ms';
    return;
  }
  // PAUSED 中も PRE_START 由来なら同じフォーマットを維持
  if (status === States.PAUSED && isPreStartActive()) {
    el.time.textContent = formatPreStartTime(remainingMs);
    el.clock.dataset.timerState = 'normal';
    el.clock.dataset.prestartFormat = getPreStartTotalMs() >= 60 * 60 * 1000 ? 'hms' : 'ms';
    return;
  }
  // PRE_START 終了 / RUNNING / IDLE / etc → 属性をクリア
  if ('prestartFormat' in el.clock.dataset) delete el.clock.dataset.prestartFormat;
  el.time.textContent = formatTime(remainingMs);
  el.clock.dataset.timerState = status === States.BREAK ? 'normal' : classifyTimerState(remainingMs);
}

function computeNextBreakMs(remainingMs, currentIndex) {
  const structure = getStructure();
  if (!structure) return null;
  const levels = structure.levels;
  if (levels[currentIndex]?.isBreak) return 0;
  let total = remainingMs;
  for (let i = currentIndex + 1; i < levels.length; i++) {
    if (levels[i].isBreak) return total;
    total += levels[i].durationMinutes * 60 * 1000;
  }
  return null;
}

// STEP 10 フェーズC.1.6 Fix 2: トーナメント開始（PRE_START 終了）からの累積ゲーム時間を計算。
//   全完了レベル（currentLevelIndex 未満）の duration 合計 + 現在レベルの経過分。
//   PAUSED 中は remainingMs が止まっているのでこの式も止まる、RUNNING/BREAK 中は進む。
//   IDLE / PRE_START 中はトーナメント未開始なので 0。FINISHED 後は最終値で停止。
function computeTotalGameTimeMs() {
  const structure = getStructure();
  if (!structure || !Array.isArray(structure.levels)) return 0;
  const { status, currentLevelIndex, remainingMs } = getState();
  if (status === States.IDLE || status === States.PRE_START) return 0;
  let total = 0;
  for (let i = 0; i < currentLevelIndex; i++) {
    const lv = structure.levels[i];
    if (!lv) continue;
    total += (typeof lv.durationMinutes === 'number' ? lv.durationMinutes : 0) * 60 * 1000;
  }
  // 現在レベルの経過 = 全 duration - remainingMs（負値防止）
  const cur = structure.levels[currentLevelIndex];
  if (cur) {
    const dur = (typeof cur.durationMinutes === 'number' ? cur.durationMinutes : 0) * 60 * 1000;
    total += Math.max(0, dur - remainingMs);
  }
  return total;
}

function renderNextBreak(remainingMs, currentIndex) {
  const ms = computeNextBreakMs(remainingMs, currentIndex);
  // STEP 10 フェーズC.1.6 Fix 2: 残ブレイクなし → TOTAL GAME TIME ラベル + 累積時間表示に切替
  if (ms === null) {
    if (el.nextBreakLabel) el.nextBreakLabel.textContent = 'TOTAL GAME TIME';
    el.nextBreak.textContent = formatHMS(computeTotalGameTimeMs());
  } else {
    if (el.nextBreakLabel) el.nextBreakLabel.textContent = 'NEXT BREAK IN';
    el.nextBreak.textContent = formatHMS(ms);
  }
}

function renderControls(status) {
  el.clock.dataset.status = status;
  switch (status) {
    case States.IDLE:
      el.btnStart.disabled = false;
      el.btnStart.textContent = 'スタート';
      el.btnPause.disabled = true;
      el.btnPause.textContent = '一時停止';
      break;
    case States.PRE_START:
      // PRE_START 中: スタートボタンは disable、一時停止は受付
      el.btnStart.disabled = true;
      el.btnStart.textContent = 'スタート';
      el.btnPause.disabled = false;
      el.btnPause.textContent = '一時停止';
      break;
    case States.RUNNING:
    case States.BREAK:
      el.btnStart.disabled = true;
      el.btnPause.disabled = false;
      el.btnPause.textContent = '一時停止';
      break;
    case States.PAUSED:
      el.btnStart.disabled = true;
      el.btnPause.disabled = false;
      el.btnPause.textContent = '再開';
      break;
    default:
      break;
  }
}

// STEP 6: 動的計算ヘルパ（STEP 6.5: GTD 対応）
//
// 計算プール = buyIn.fee × playersInitial + reentry.fee × reentryCount + addOn.fee × addOnCount
// 実効プール = max(計算プール, guarantee)  ※ guarantee = 0 は実質無効
// STEP 6.9: 特殊スタックは fee がないため賞金プールには寄与しない（チップのみ加算 → AVG STACK 側で反映）
function computeCalculatedPool() {
  const buyIn   = tournamentState.buyIn   || { fee: 0 };
  const reentry = tournamentState.reentry || { fee: 0 };
  const addOn   = tournamentState.addOn   || { fee: 0 };
  return (buyIn.fee   || 0) * tournamentRuntime.playersInitial
       + (reentry.fee || 0) * tournamentRuntime.reentryCount
       + (addOn.fee   || 0) * tournamentRuntime.addOnCount;
}

function computeTotalPool() {
  const calc = computeCalculatedPool();
  const gtd  = Number(tournamentState.guarantee) || 0;
  return Math.max(calc, gtd);
}

// GTD が効いているか（GTD > 計算プールのとき true）
function isGuaranteeActive() {
  const calc = computeCalculatedPool();
  const gtd  = Number(tournamentState.guarantee) || 0;
  return gtd > 0 && gtd > calc;
}

// STEP 6.9: AVG STACK 計算に specialStack（chips × appliedCount）を加算
// TOTAL チップ = startingStack × playersInitial + reentry.chips × reentryCount
//              + addOn.chips × addOnCount + (specialStack.enabled ? chips × appliedCount : 0)
function computeAvgStack() {
  const startingStack = Number(tournamentState.startingStack) || 0;
  const reentry = tournamentState.reentry || { chips: 0 };
  const addOn   = tournamentState.addOn   || { chips: 0 };
  const ss      = tournamentState.specialStack || { enabled: false };
  const ssChips = (ss.enabled ? (Number(ss.chips) || 0) * (Number(ss.appliedCount) || 0) : 0);
  const totalChips = startingStack * tournamentRuntime.playersInitial
                   + (reentry.chips || 0) * tournamentRuntime.reentryCount
                   + (addOn.chips   || 0) * tournamentRuntime.addOnCount
                   + ssChips;
  return tournamentRuntime.playersRemaining > 0
    ? Math.floor(totalChips / tournamentRuntime.playersRemaining)
    : 0;
}

// STEP 6.5: 配当金額丸め単位の許容値（main.js の VALID_PAYOUT_ROUNDINGS と同期）
const VALID_PAYOUT_ROUNDINGS_RENDERER = [1, 10, 100, 1000];

// STEP 6.5: 配当金額を計算（端数処理 + 余りを1位に上乗せ）
// 戻り値: payouts と同順の数値配列（円単位）
function computeRoundedAmounts() {
  const pool = computeTotalPool();
  const rounding = VALID_PAYOUT_ROUNDINGS_RENDERER.includes(tournamentState.payoutRounding)
    ? tournamentState.payoutRounding : 100;
  const payouts = tournamentState.payouts || [];
  if (payouts.length === 0 || pool <= 0) return payouts.map(() => 0);
  // 各順位を端数処理
  const amounts = payouts.map((p) => {
    const raw = pool * (Number(p.percentage) || 0) / 100;
    return Math.floor(raw / rounding) * rounding;
  });
  // 端数の合計（pool - sum）を 1 位に上乗せ
  const sum = amounts.reduce((s, v) => s + v, 0);
  const remainder = pool - sum;
  if (remainder > 0 && amounts.length > 0) {
    amounts[0] += remainder;
  }
  return amounts;
}

function renderPayouts() {
  if (!el.payoutsList) return;
  el.payoutsList.innerHTML = '';
  const amounts = computeRoundedAmounts();
  const payouts = tournamentState.payouts || [];
  payouts.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'payouts-row';
    // STEP 6.5: 4位以下はコンパクト表示
    if (index >= 3) row.classList.add('payouts-row--secondary');
    const rank = document.createElement('span');
    rank.className = 'payouts-row__rank';
    rank.textContent = `${item.rank}位`;
    const amount = document.createElement('span');
    amount.className = 'payouts-row__amount';
    amount.textContent = formatCurrency(amounts[index] ?? 0);
    row.append(rank, amount);
    el.payoutsList.append(row);
  });
}

// STEP 6.5: トーナメント終了オーバーレイの表示制御
function updateFinishedOverlay() {
  if (!el.clock) return;
  const isFinished = tournamentRuntime.playersInitial > 0
                  && tournamentRuntime.playersRemaining === 0;
  el.clock.classList.toggle('clock--finished', isFinished);
}

// メイン画面の動的値を再計算・反映（プレイヤー操作 / トーナメント保存後など）
function renderStaticInfo() {
  if (el.totalPool) {
    // C.1.7-patch 2026-04-30: TOTAL PRIZE POOL は元サイズ（.stat-value--xl 4.5vw）に戻すが
    //   7 桁以上（¥1,000,000 以上）になった時のみ font-size を 0.85 倍に縮小して見切れ防止
    const poolValue = computeTotalPool();
    el.totalPool.textContent = formatCurrency(poolValue);
    el.totalPool.classList.toggle('is-7digit', String(Math.floor(Math.abs(poolValue))).length >= 7);
  }
  // GTD注記
  if (el.poolNote) {
    el.poolNote.classList.toggle('is-visible', isGuaranteeActive());
  }
  if (el.avgStack) {
    // C.1.4-fix3-patch 2026-04-30: avg stack が 8 桁以上の時のみ font-size を 0.8 倍に縮小
    //   （右カラム幅 18vw を 8 桁数字が超えないようにするための自動調整）
    const avgValue = computeAvgStack();
    el.avgStack.textContent = formatNumber(avgValue);
    el.avgStack.classList.toggle('is-8digit', String(Math.floor(Math.abs(avgValue))).length >= 8);
  }
  if (el.playersValue)  el.playersValue.textContent = `${tournamentRuntime.playersRemaining} / ${tournamentRuntime.playersInitial}`;
  if (el.reentryValue)  el.reentryValue.textContent = String(tournamentRuntime.reentryCount);
  if (el.addonValue)    el.addonValue.textContent = String(tournamentRuntime.addOnCount);
  // STEP 6.11: REENTRY / ADDON 行は 0 のとき非表示、0→1 でぼわーんフェードイン
  updateCountRowVisibility(el.reentryRow, tournamentRuntime.reentryCount, '_lastReentry');
  updateCountRowVisibility(el.addonRow,   tournamentRuntime.addOnCount,   '_lastAddon');
  // STEP 6.9: 特殊配布行の表示制御
  renderSpecialStackRow();
  renderPayouts();
  updateFinishedOverlay();
}

// STEP 6.11: カウント行の表示制御（0 時は visibility: hidden、0→1 で reveal アニメーション）
//   - 直近のカウントを `_visibilityCache[trackKey]` に保持し、0→1 遷移を検出して `is-just-revealed` を 0.7s 付与
//   - 1→0 への遷移はアニメーションなしで即時 hidden（地味でOK 仕様）
//   - min-height は CSS 側で確保しているため layout shift しない
const _visibilityCache = Object.create(null);
function updateCountRowVisibility(rowEl, count, trackKey) {
  if (!rowEl) return;
  const prev = _visibilityCache[trackKey] ?? 0;
  const visible = count > 0;
  rowEl.classList.toggle('is-visible', visible);
  if (prev === 0 && count > 0) {
    rowEl.classList.add('is-just-revealed');
    setTimeout(() => rowEl.classList.remove('is-just-revealed'), 700);
  }
  _visibilityCache[trackKey] = count;
}

// STEP 6.9: 特殊配布行の表示制御。
// enabled かつ appliedCount > 0 のときのみ表示。それ以外は visibility: hidden で領域占有のみ。
// STEP 6.10: 1行表示「特殊配布: {label} {合計chips}」に整理。「(N人)」表記は廃止。
//   - 合計 = chips × appliedCount をカンマ区切り表示
//   - ラベルは textContent 経由で挿入 → 自動的に HTML エスケープされる（XSS 対策）
function renderSpecialStackRow() {
  if (!el.specialStackRow) return;
  const ss = tournamentState.specialStack || { enabled: false, label: '', chips: 0, appliedCount: 0 };
  const visible = !!ss.enabled && (Number(ss.appliedCount) || 0) > 0;
  el.specialStackRow.classList.toggle('is-visible', visible);
  if (visible && el.specialStackText) {
    const total = (Number(ss.chips) || 0) * (Number(ss.appliedCount) || 0);
    const label = (ss.label || '').trim();
    el.specialStackText.textContent = label
      ? `特殊配布: ${label} ${formatNumber(total)}`
      : `特殊配布: ${formatNumber(total)}`;
  }
}

// トーナメント基本情報をメイン画面に反映（起動時 + 保存時）
// 反映先: イベントタイトル / サブタイトル / 賞金プール / PAYOUTS（通貨記号変更で再描画）
function applyTournament(t) {
  if (!t || typeof t !== 'object') return;
  // STEP 10 フェーズC.2 Fix 0: 入力中保護のため、フォーム要素 (.value) への書込は
  //   isUserTypingInInput() で局所ガード。memory 上の tournamentState 更新は続行する
  //   （後段のメイン画面表示更新には必要、入力欄に影響しない）。
  const _typingGuard = isUserTypingInInput();
  if (typeof t.id === 'string' && t.id) tournamentState.id = t.id;
  // 旧 title / 新 name 両対応
  const titleSrc = (typeof t.title === 'string') ? t.title
                  : (typeof t.name === 'string') ? t.name : undefined;
  if (typeof titleSrc === 'string') tournamentState.title = titleSrc;
  if (typeof t.subtitle === 'string') tournamentState.subtitle = t.subtitle;
  if (typeof t.currencySymbol === 'string' && t.currencySymbol.length > 0) {
    tournamentState.currencySymbol = t.currencySymbol;
  }
  if (typeof t.blindPresetId === 'string' && t.blindPresetId.length > 0) {
    tournamentState.blindPresetId = t.blindPresetId;
    if (el.tournamentBlindPreset && !_typingGuard) {
      el.tournamentBlindPreset.value = t.blindPresetId;
    }
  }
  // STEP 6: 拡張フィールド
  if (typeof t.gameType === 'string' && t.gameType in GAME_TYPE_LABEL) {
    tournamentState.gameType = t.gameType;
  }
  if (typeof t.startingStack === 'number' && t.startingStack >= 0) {
    tournamentState.startingStack = t.startingStack;
  }
  if (t.buyIn   && typeof t.buyIn   === 'object') tournamentState.buyIn   = { ...tournamentState.buyIn,   ...t.buyIn };
  // STEP 6.9: reentry（旧 rebuy も互換受信）
  if (t.reentry && typeof t.reentry === 'object') tournamentState.reentry = { ...tournamentState.reentry, ...t.reentry };
  else if (t.rebuy && typeof t.rebuy === 'object') tournamentState.reentry = { fee: t.rebuy.fee || 0, chips: t.rebuy.chips || 0 };
  if (t.addOn   && typeof t.addOn   === 'object') tournamentState.addOn   = { ...tournamentState.addOn,   ...t.addOn };
  // STEP 6.9: specialStack
  if (t.specialStack && typeof t.specialStack === 'object') {
    const cur = tournamentState.specialStack || {};
    tournamentState.specialStack = {
      enabled: typeof t.specialStack.enabled === 'boolean' ? t.specialStack.enabled : !!cur.enabled,
      label:  typeof t.specialStack.label === 'string' ? t.specialStack.label.slice(0, 20) : (cur.label || '早期着席特典'),
      chips:  Number.isFinite(Number(t.specialStack.chips)) ? Number(t.specialStack.chips) : (cur.chips ?? 5000),
      appliedCount: Math.max(0, Math.min(999, Math.floor(Number(t.specialStack.appliedCount)) || 0))
    };
  }
  if (Array.isArray(t.payouts) && t.payouts.length > 0) {
    tournamentState.payouts = t.payouts.map((p) => ({ rank: p.rank, percentage: Number(p.percentage) || 0 }));
  }
  // STEP 6.5
  if (typeof t.guarantee === 'number' && t.guarantee >= 0) {
    tournamentState.guarantee = t.guarantee;
  }
  if (typeof t.payoutRounding === 'number' && VALID_PAYOUT_ROUNDINGS_RENDERER.includes(t.payoutRounding)) {
    tournamentState.payoutRounding = t.payoutRounding;
  }
  // STEP 6.7: 賞金区分
  if (typeof t.prizeCategory === 'string') {
    tournamentState.prizeCategory = t.prizeCategory.slice(0, 20);
  }
  // STEP 6.17: タイトル色（hex #RRGGBB のみ受理）
  if (typeof t.titleColor === 'string' && TITLE_COLOR_RE_RENDERER.test(t.titleColor)) {
    tournamentState.titleColor = t.titleColor;
  }
  // STEP 10 フェーズC.2.3: customGameName / pauseAfterBreak
  if (typeof t.customGameName === 'string') {
    tournamentState.customGameName = t.customGameName.slice(0, 30);
  }
  if (typeof t.pauseAfterBreak === 'boolean') {
    tournamentState.pauseAfterBreak = t.pauseAfterBreak;
  }
  // STEP 6.21.6: トーナメント別 displaySettings を即時 UI 反映
  // active 切替・起動初期化どちらでも呼ばれるパスのため、ここで集約するのが最もシンプル
  if (t.displaySettings && typeof t.displaySettings === 'object') {
    // STEP 10 フェーズC.1.3: backgroundImage / backgroundOverlay を applyBackground より先に state へ反映
    const ds = t.displaySettings;
    bgImageState.dataUrl = (typeof ds.backgroundImage === 'string') ? ds.backgroundImage : '';
    bgImageState.overlay = (typeof ds.backgroundOverlay === 'string' && BG_OVERLAY_ALPHA[ds.backgroundOverlay])
      ? ds.backgroundOverlay : 'mid';
    refreshBgImagePreview();
    // STEP 10 フェーズC.1.4: 休憩中スライドショーの state 同期
    breakImagesState.images = Array.isArray(ds.breakImages) ? ds.breakImages : [];
    breakImagesState.intervalSec = (typeof ds.breakImageInterval === 'number') ? ds.breakImageInterval : 10;
    breakImagesState.pipSize = (typeof ds.pipSize === 'string' && VALID_PIP_SIZES.includes(ds.pipSize)) ? ds.pipSize : 'medium';
    renderBreakImagesList();
    applyPipSize(breakImagesState.pipSize);
    if (typeof ds.background === 'string') {
      applyBackground(ds.background);
    }
    if (typeof ds.timerFont === 'string') {
      applyTimerFont(ds.timerFont);
    }
  }
  // STEP 10 フェーズC.1.8: ランタイム復元（再起動 / トーナメント切替時の永続値読込）。
  //   C.2.7-A 致命バグ修正の不変条件「ブラインド構造を変えても tournamentRuntime は消えない」と整合。
  //   resetBlindProgressOnly はこの値に触らない（renderer メモリ内の現在値を維持）。
  //   ここでは applyTournament の経路で永続値を読込んでメモリへ反映する。
  if (t.runtime && typeof t.runtime === 'object') {
    const rt = t.runtime;
    if (typeof rt.playersInitial === 'number')   tournamentRuntime.playersInitial   = Math.max(0, Math.floor(rt.playersInitial));
    if (typeof rt.playersRemaining === 'number') tournamentRuntime.playersRemaining = Math.max(0, Math.floor(rt.playersRemaining));
    if (typeof rt.reentryCount === 'number')     tournamentRuntime.reentryCount     = Math.max(0, Math.floor(rt.reentryCount));
    if (typeof rt.addOnCount === 'number')       tournamentRuntime.addOnCount       = Math.max(0, Math.floor(rt.addOnCount));
  }
  // STEP 6.22.1: トーナメント別 marqueeSettings を即時 UI 反映
  // applyTournament を経由する全パス（active 切替 / 新規 / 複製 / 削除後 / 起動初期化）で自動反映
  if (t.marqueeSettings && typeof t.marqueeSettings === 'object') {
    lastMarqueeSettings = { ...t.marqueeSettings };
    // STEP 6.22.1.fix: active 切替でプレビュー解除（新トーナメントの保存値で上書きされるため）
    _marqueePreviewing = false;
    applyMarquee(t.marqueeSettings);
    // 設定タブが開いている場合はフォーム値も同期（タブ閉時は早期 return で no-op）
    syncMarqueeTabFormFromCurrent();
  }

  // メイン画面のテキスト更新
  if (el.eventTitle) {
    el.eventTitle.textContent = tournamentState.title || 'ポーカートーナメント';
  }
  if (el.eventSubtitle) {
    if (tournamentState.subtitle && tournamentState.subtitle.length > 0) {
      el.eventSubtitle.textContent = tournamentState.subtitle;
      el.eventSubtitle.hidden = false;
    } else {
      el.eventSubtitle.hidden = true;
    }
  }
  if (el.eventGameType) {
    // STEP 10 フェーズC.2.3: gameType='other' は customGameName を表示、MIX は別途 renderCurrentLevel で補助表示
    let label = '';
    if (tournamentState.gameType === 'other') {
      label = (tournamentState.customGameName || '').trim() || 'その他';
    } else {
      label = GAME_TYPE_LABEL[tournamentState.gameType] || '';
    }
    el.eventGameType.textContent = label;
  }
  // STEP 6.7 / 6.11 / 6.12: 賞金区分の表示制御。
  //   - 空文字なら visibility: hidden で領域占有のみ（layout shift なし）
  //   - STEP 6.12: 「※ PRIZEは◯◯として付与」形式で意図をさらに明示
  //   - textContent 経由なので XSS 安全
  if (el.eventPrizeCategory) {
    const pc = tournamentState.prizeCategory || '';
    el.eventPrizeCategory.textContent = pc ? `※ PRIZEは${pc}として付与` : '';
    el.clock?.classList.toggle('clock--has-prize-category', pc.length > 0);
  }
  // STEP 6.8: 賞金端数プルダウンのラベルを通貨記号と連動して再生成
  refreshPayoutRoundingLabels();
  // STEP 6.17: タイトル色を CSS 変数に反映（メイン画面の .event-title が var(--title-color) を参照）
  document.documentElement.style.setProperty('--title-color', tournamentState.titleColor || '#FFFFFF');
  // 動的値（プール / アベスタック / PAYOUTS）も再計算
  renderStaticInfo();
  // STEP 10 フェーズB.fix3: ゲーム種変更後の保存・active 切替・起動時すべてで BLINDS / NEXT LEVEL カードを再描画。
  //   tournamentState.gameType が新値に更新済の状態で getCurrentStructureType() が正しい構造型を返し、
  //   renderBlindsContent が新しいフィールドラベル + 値で再描画される。
  //   handleTournamentGameTypeChange での eager 呼び出しは fix3 で除去（input ブロック回避）。
  try {
    const { currentLevelIndex } = getState();
    renderCurrentLevel(currentLevelIndex);
    renderNextLevel(currentLevelIndex);
  } catch (err) {
    console.warn('applyTournament: BLINDS カード再描画失敗:', err);
  }
  // STEP 10 フェーズC.2.4 Fix 1: 起動直後・active 切替時に自由記入欄の hidden を確実化
  //   （CSS .form-row[hidden] と二重防御。'other' 以外なら必ず非表示）
  if (el.tournamentCustomGameWrapper) {
    el.tournamentCustomGameWrapper.hidden = (tournamentState.gameType !== 'other');
  }
}

// STEP 6.8: 賞金端数 <select> の option ラベルを現在の通貨記号で再構築
// 内部値（1/10/100/1000）は維持。表示文字列のみ動的に変更。
function refreshPayoutRoundingLabels() {
  if (!el.tournamentPayoutRounding) return;
  const sym = tournamentState.currencySymbol || '¥';
  const prev = el.tournamentPayoutRounding.value;
  for (const opt of el.tournamentPayoutRounding.options) {
    opt.textContent = `${sym}${opt.value}`;
  }
  // 選択値が消えないよう復元
  if (prev) el.tournamentPayoutRounding.value = prev;
}

// プリセットIDから本体をロード（同梱→ユーザーの順で探す）
async function loadPresetById(presetId) {
  if (!presetId || !window.api?.presets) return null;
  try {
    const builtin = await window.api.presets.loadBuiltin(presetId);
    if (builtin) return builtin;
  } catch (_) { /* ignore */ }
  try {
    const user = await window.api.presets.loadUser(presetId);
    if (user) return user;
  } catch (_) { /* ignore */ }
  return null;
}

// ===== STEP 6.21 / 6.21.2: トーナメント別 timerState 永続化・復元 =====

// state.js の States を保存用 status 文字列にマップ。
// PRE_START / BREAK は実質「進行中」相当として 'running'、PAUSED は 'paused'、IDLE は 'idle'
function mapStateToStorageStatus(status) {
  if (status === States.RUNNING || status === States.BREAK || status === States.PRE_START) return 'running';
  if (status === States.PAUSED) return 'paused';
  return 'idle';
}

// 現在の timer.js + state.js の状況を timerState（保存形式）へ変換
// STEP 6.21.2: running 中は「rebase」方式 — startedAt = now、elapsedSecondsInLevel に現在地の経過秒を入れる
//              これで store の値だけで future の live elapsed = elapsed + (future_now - startedAt) で計算可能
function captureCurrentTimerState() {
  const s = getState();
  // v2.0.3 Fix L: PRE_START 中はスリープ復帰で誤進行する race を防ぐため、idle 相当として保存。
  //   旧実装では PRE_START の totalMs（例 5 分）が「Level 1 の経過秒」として保存され、
  //   スリープ復帰時の computeLiveTimerState が Level 1 の長さで判定してレベル繰上げを起こしていた。
  //   PRE_START → idle 化により、スリープ復帰時はユーザーが再度プレスタートを開始する経路に戻る（安全側）。
  if (s.status === States.PRE_START) {
    return { status: 'idle', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: null };
  }
  const status = mapStateToStorageStatus(s.status);
  const totalSec = Math.max(0, Math.round((s.totalMs || 0) / 1000));
  const remainSec = Math.max(0, Math.round((s.remainingMs || 0) / 1000));
  const elapsed = Math.max(0, totalSec - remainSec);
  const now = Date.now();
  return {
    status,
    currentLevel: (s.currentLevelIndex || 0) + 1,
    elapsedSecondsInLevel: elapsed,
    startedAt: status === 'running' ? now : null,
    pausedAt:  status === 'paused'  ? now : null
  };
}

// STEP 6.21.2: 並行進行モデルのコア — store の timerState と blinds（preset.levels）から
//              現在の live な状態を時刻計算で導出。停電中もレベル進行を含めて計算。
//
// 入力:
//   ts: { status, currentLevel, elapsedSecondsInLevel, startedAt, pausedAt }
//   levels: 配列。各 level に durationMinutes（または durationSeconds）を持つ
// 出力: live な { status, currentLevel, elapsedSecondsInLevel, startedAt, pausedAt }
//
// 境界条件:
//   - levels 空 → 入力 ts をそのまま返す（無害）
//   - status !== 'running' → 入力 ts をそのまま返す
//   - 全レベル完走超過 → 最終レベル末尾で paused 扱い
function computeLiveTimerState(ts, levels) {
  if (!ts || typeof ts !== 'object') {
    return { status: 'idle', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: null };
  }
  if (ts.status !== 'running' || !ts.startedAt) return { ...ts };
  if (!Array.isArray(levels) || levels.length === 0) return { ...ts };

  // running 中の総経過秒 = 累積 + (now - startedAt)
  let elapsed = (Number(ts.elapsedSecondsInLevel) || 0) + Math.max(0, (Date.now() - Number(ts.startedAt)) / 1000);
  let level = Math.max(1, Number(ts.currentLevel) || 1);

  // レベル長は durationMinutes（既存仕様）から秒換算
  const durSecOf = (idx) => {
    const lv = levels[idx];
    if (!lv) return Infinity;
    if (typeof lv.durationSeconds === 'number') return lv.durationSeconds;
    if (typeof lv.durationMinutes === 'number') return lv.durationMinutes * 60;
    return Infinity;
  };

  // レベル繰り上げ（停電中の進行分も含む）
  while (true) {
    const dur = durSecOf(level - 1);
    if (elapsed < dur) break;
    elapsed -= dur;
    level += 1;
    if (level > levels.length) {
      // STEP 10 フェーズC.1.2 Fix 2: 全レベル完走 → 'finished' 状態（明示的な完了）。
      //   旧: 'paused' で済ませていたが、再起動時に再開できる紛らわしい状態だった。
      //   新: 'finished' で完了を明示、applyTimerStateToTimer は idle 同様タイマー再開しない。
      level = levels.length;
      const lastDur = durSecOf(level - 1);
      return {
        ...ts,
        status: 'finished',
        currentLevel: level,
        elapsedSecondsInLevel: lastDur,
        startedAt: null,
        pausedAt: null
      };
    }
  }
  return { ...ts, currentLevel: level, elapsedSecondsInLevel: Math.floor(elapsed) };
}

// STEP 6.21.2: blindPresetId → levels 配列のキャッシュ
// renderTournamentList が 1秒ごとに呼ばれるため、毎回 fetch すると重い → 起動時/プリセット変更時のみ load
const blindPresetCache = new Map();
async function getCachedLevels(presetId) {
  if (!presetId) return null;
  if (blindPresetCache.has(presetId)) return blindPresetCache.get(presetId);
  const preset = await loadPresetById(presetId);
  const levels = preset?.levels || null;
  if (levels) blindPresetCache.set(presetId, levels);
  return levels;
}

// timerState（保存形式）を timer.js に復元する。
// STEP 6.21.2: 復元前に computeLiveTimerState で停電中のレベル進行を計算済の値に変換してから timer.js に適用。
//              第二引数 levels が undefined の場合は現在ロード済の structure（getLevelCount）を用いる
//              opts.silent: true なら復元直後の音再生（5,4,3,2,1 等）をスキップ
function applyTimerStateToTimer(ts, levels, opts = {}) {
  // v2.0.4 E-1 fix: idle / 不正値復元時も clock--timer-finished オーバーレイを解除する。
  //   旧実装では running/paused/break への遷移時のみ class を消していたため、
  //   終了済みトーナメントから別 t に切替（idle 復元）すると overlay が残るバグがあった。
  if (!ts || typeof ts !== 'object') {
    el.clock?.classList.remove('clock--timer-finished');
    timerReset();
    return;
  }
  if (ts.status === 'idle') {
    el.clock?.classList.remove('clock--timer-finished');
    timerReset();
    return;
  }
  // STEP 10 フェーズC.1.2 Fix 2: 'finished' 状態は idle 同様タイマー再開しない（完走表示のみ）。
  //   ユーザーが「タイマーリセット」を押すと idle に戻り、新規エントリーで再開可能。
  //   メイン画面に「トーナメント終了」オーバーレイを表示（緑系、playersRemaining=0 とは別経路）。
  if (ts.status === 'finished') {
    timerReset();
    el.clock?.classList.add('clock--timer-finished');
    return;
  }
  // それ以外の status（running/paused/break）への遷移時は finished オーバーレイを解除
  el.clock?.classList.remove('clock--timer-finished');
  // 停電中の進行を反映した live state を算出
  const live = (Array.isArray(levels) && levels.length > 0)
    ? computeLiveTimerState(ts, levels)
    : ts;
  const levelCount = getLevelCount();
  if (levelCount === 0) { timerReset(); return; }
  const idx = Math.max(0, Math.min(levelCount - 1, (live.currentLevel || 1) - 1));
  // 該当レベルから即時開始 → RUNNING / BREAK
  timerStartAtLevel(idx);
  // 経過秒ぶん進める（advanceTimeBy は負値で時間を進める）
  const elapsedMs = Math.max(0, Math.floor(live.elapsedSecondsInLevel || 0)) * 1000;
  if (elapsedMs > 0) timerAdvanceBy(-elapsedMs);
  if (live.status === 'paused') timerPause();
  // STEP 6.21.4.1: 復元直後の音抑止は明示的な one-shot フラグで実装。
  // 旧設計（lastAudioTriggerSec を直接書換え）は onLevelChange 経路と競合して
  // 継続的に音が鳴らなくなる可能性があったため、フラグ方式に変更。
  // 真因: timerStartAtLevel → onLevelChange が lastAudioTriggerSec=-1 にリセット後、
  //       silent block で remainSec に上書き。Math.ceil の境界条件によっては「次秒」が
  //       極端に長く同値判定にハマる可能性があり、安全のため独立フラグに切り出す。
  if (opts.silent) {
    audioSuppressOnce = true;
  }
}

// 指定 id の保存済み timerState を取得（list を都度引く軽量実装）
async function fetchTimerState(id) {
  if (!id || !window.api?.tournaments) return null;
  try {
    const list = await window.api.tournaments.list() || [];
    const found = list.find((t) => t.id === id);
    return found?.timerState || null;
  } catch (_) { return null; }
}

// 永続化: アクティブ id に対して timerState を保存（debounce 500ms）
// STEP 6.21.1: pending タイマーをキャンセルする外部 API も追加（active 切替前にクリア）
let timerStatePersistTimer = null;
function schedulePersistTimerState() {
  if (window.appRole === 'hall') return;  // v2.0.1: hall は purely consumer、逆書込禁止
  if (timerStatePersistTimer) clearTimeout(timerStatePersistTimer);
  timerStatePersistTimer = setTimeout(() => {
    timerStatePersistTimer = null;
    const id = tournamentState.id;
    if (!id || !window.api?.tournaments?.setTimerState) return;
    const ts = captureCurrentTimerState();
    window.api.tournaments.setTimerState(id, ts).catch((err) => {
      console.warn('timerState 保存失敗:', err);
    });
  }, 500);
}
function cancelPendingTimerStatePersist() {
  if (timerStatePersistTimer) {
    clearTimeout(timerStatePersistTimer);
    timerStatePersistTimer = null;
  }
}

// STEP 10 フェーズC.1.8: ランタイム永続化（debounce 500ms）。
//   tournamentRuntime のフィールド変更時に呼ばれ、active id に対して store へ保存。
//   アプリ終了 → 再起動でプレイヤー人数 / リエントリー / アドオン数が消失する重大バグの修正。
let runtimePersistTimer = null;
function schedulePersistRuntime() {
  if (window.appRole === 'hall') return;  // v2.0.1: hall は purely consumer、逆書込禁止
  if (runtimePersistTimer) clearTimeout(runtimePersistTimer);
  runtimePersistTimer = setTimeout(() => {
    runtimePersistTimer = null;
    if (_tournamentSwitching) return;  // v2.0.1 Fix B3: 切替中は古い id に書き込まない
    const id = tournamentState.id;
    if (!id || !window.api?.tournaments?.setRuntime) return;
    const rt = {
      playersInitial: tournamentRuntime.playersInitial,
      playersRemaining: tournamentRuntime.playersRemaining,
      reentryCount: tournamentRuntime.reentryCount,
      addOnCount: tournamentRuntime.addOnCount
    };
    window.api.tournaments.setRuntime(id, rt).catch((err) => {
      console.warn('runtime 保存失敗:', err);
    });
  }, 500);
}

// STEP 10 フェーズC.1.1 Fix 2: トーナメント切替中フラグ。
//   handleTournamentNew / handleTournamentDuplicate / handleTournamentSelectChange の処理中、
//   periodicPersistAllRunning を skip させて、active id 切替の最中に古い state が新 id に書き込まれる
//   race の可能性を defense in depth で抑止する。設定後 finally で必ず false へ。
let _tournamentSwitching = false;

// STEP 6.21.2: 5秒ごとの全 running トーナメント保存（並行進行モデル対応）
// active のみならず**全ての running**を rebase 保存（startedAt = now、elapsedSecondsInLevel に live 値）
// 強制終了時の最大誤差は5秒、復元時は store 値 + (now - startedAt) で進める方向のみ
let timerStatePeriodicInterval = null;
function startPeriodicTimerStatePersist() {
  if (window.appRole === 'hall') return;  // v2.0.1: hall は purely consumer、逆書込禁止
  if (timerStatePeriodicInterval) return;
  timerStatePeriodicInterval = setInterval(periodicPersistAllRunning, 5000);
}
function stopPeriodicTimerStatePersist() {
  if (timerStatePeriodicInterval) {
    clearInterval(timerStatePeriodicInterval);
    timerStatePeriodicInterval = null;
  }
}
async function periodicPersistAllRunning() {
  if (!window.api?.tournaments?.setTimerState) return;
  // STEP 10 フェーズC.1.1 Fix 2: トーナメント切替中は skip（active id 切替と periodic の race 防御）
  if (_tournamentSwitching) return;
  let list;
  try { list = await window.api.tournaments.list() || []; } catch (_) { return; }
  for (const t of list) {
    const isActive = (t.id === tournamentState.id);
    let ts;
    if (isActive) {
      // active はライブの timer.js から（rebase は captureCurrentTimerState 内で実施済）
      ts = captureCurrentTimerState();
    } else {
      const stored = t.timerState || {};
      if (stored.status !== 'running') continue;  // 非アクティブで running のみ rebase
      const levels = await getCachedLevels(t.blindPresetId);
      const live = (levels) ? computeLiveTimerState(stored, levels) : stored;
      ts = {
        ...live,
        startedAt: live.status === 'running' ? Date.now() : null,
        pausedAt:  live.status === 'paused'  ? Date.now() : null
      };
    }
    if (ts.status !== 'running') continue;
    try {
      await window.api.tournaments.setTimerState(t.id, ts);
    } catch (err) {
      console.warn('timerState 定期保存失敗:', err);
    }
  }
}

// STEP 6.21.2: リスト UI の 1秒ごとリアルタイム再描画（並行進行の経過時間を動的表示）
let listRefreshInterval = null;
function startListRefreshInterval() {
  if (listRefreshInterval) return;
  listRefreshInterval = setInterval(() => {
    renderTournamentList().catch(() => {});
  }, 1000);
}
function stopListRefreshInterval() {
  if (listRefreshInterval) {
    clearInterval(listRefreshInterval);
    listRefreshInterval = null;
  }
}
// メモリリーク対策: ウィンドウクローズ時に必ずクリア
window.addEventListener('beforeunload', () => {
  stopPeriodicTimerStatePersist();
  cancelPendingTimerStatePersist();
  stopListRefreshInterval();
});

// STEP 6.21.1: 重複しない新規トーナメント名を採番
//   base 単独が未使用ならそのまま返す。使用中なら base + ' ' + 最小未使用整数（2 以上）を返す
//   既存名「新規トーナメント, 新規トーナメント 2, 新規トーナメント 4」→ 次は「新規トーナメント 3」
function generateUniqueTournamentName(list, base = '新規トーナメント') {
  const names = new Set((list || []).map((t) => t.name));
  if (!names.has(base)) return base;
  for (let n = 2; n <= 9999; n++) {
    const candidate = `${base} ${n}`;
    if (!names.has(candidate)) return candidate;
  }
  // 万一 9999 件全て埋まっていた場合のフォールバック（実用上は到達しない、MAX_TOURNAMENTS=100）
  return `${base} ${Date.now()}`;
}

// ===== 状態購読 =====

// STEP 10 フェーズC.2.7-audit-fix: powerSaveBlocker — RUNNING/PRE_START/BREAK 中は
//   ディスプレイスリープを抑止。営業中にスクリーンロックでタイマーが見えなくなる事故を防ぐ。
//   PAUSED / IDLE / DONE では解除して、通常の OS 電源管理に従う。
function syncPowerSaveBlocker(status) {
  const active = status === States.RUNNING || status === States.PRE_START || status === States.BREAK;
  try {
    if (active) {
      window.api?.power?.preventDisplaySleep?.().catch(() => { /* ignore */ });
    } else {
      window.api?.power?.allowDisplaySleep?.().catch(() => { /* ignore */ });
    }
  } catch (_) { /* ignore */ }
}

subscribe((state, prev) => {
  if (state.status !== prev.status) {
    renderControls(state.status);
    syncPowerSaveBlocker(state.status);
  }
  if (state.currentLevelIndex !== prev.currentLevelIndex) {
    renderCurrentLevel(state.currentLevelIndex);
    renderNextLevel(state.currentLevelIndex);
    // STEP 10 フェーズC.2.3 Fix 4: ブレイク終了直後（break → 通常レベル）で pauseAfterBreak が true なら自動一時停止
    //   - 直前の prev レベルが break、現在のレベルが通常 → トリガー
    //   - 設定 ON の場合のみ。OFF（デフォルト）は従来通り自動進行
    try {
      if (tournamentState.pauseAfterBreak === true) {
        const prevLv = getLevel(prev.currentLevelIndex);
        const curLv = getLevel(state.currentLevelIndex);
        if (prevLv?.isBreak && curLv && !curLv.isBreak && state.status === States.RUNNING) {
          // pause 実装: timerPause を呼ぶ（state.js 経由で PAUSED 状態へ）
          timerPause();
          setTournamentHint('ブレイク終了。一時停止しました（再開ボタンで開始）', 'success');
          setTimeout(() => setTournamentHint(''), 4000);
        }
      }
    } catch (err) { console.warn('pauseAfterBreak 処理失敗:', err); }
  }
  renderTime(state.remainingMs);
  renderNextBreak(state.remainingMs, state.currentLevelIndex);
  // STEP 6.21: status / level 変化時にアクティブ TimerState を保存
  if (state.status !== prev.status || state.currentLevelIndex !== prev.currentLevelIndex) {
    schedulePersistTimerState();
    // リスト UI も状態反映のため再描画（軽量）
    renderTournamentList().catch(() => {});
    // STEP 10 フェーズC.1.4: 状態が変わったら autoEndedAt をクリア（次回 BREAK で再判定可能に）
    if (state.status !== prev.status) {
      slideshowState.autoEndedAt = null;
      // STEP 10 フェーズC.1.4-fix2 Fix 1: BREAK 突入で開始時刻を記録、抜けたら null
      if (state.status === States.BREAK && prev.status !== States.BREAK) {
        slideshowState.breakStartedAt = Date.now();
      } else if (state.status !== States.BREAK) {
        slideshowState.breakStartedAt = null;
      }
    }
  }
  // STEP 10 フェーズC.1.4: スライドショー / PIP の状態同期
  syncSlideshowFromState(state.remainingMs);
  // v2.0.0 STEP 3: operator モードのみミニ状態バーを更新（hall / operator-solo は no-op）
  updateOperatorStatusBar(state);
});

// v2.0.0 STEP 3: operator モード（PC 側）専用のミニ状態バー更新。
//   既存 subscribe からのみ呼ばれるため tick ごとの再計算ではなく差分更新になる。
//   hall / operator-solo では DOM 自体が hidden なので早期 return（DOM 操作も省略）。
function updateOperatorStatusBar(state) {
  if (typeof window === 'undefined' || window.appRole !== 'operator') return;
  const levelEl = document.getElementById('js-operator-status-level');
  const timeEl  = document.getElementById('js-operator-status-time');
  const stateEl = document.getElementById('js-operator-status-state');
  if (!levelEl || !timeEl || !stateEl) return;
  // Level: 1-indexed 表示（getLevel は 0-indexed）
  levelEl.textContent = String((state.currentLevelIndex || 0) + 1);
  // Time: MM:SS 表示（既存 renderTime と同じ formatter を再利用したいが、最小実装のため自前計算）
  const ms = Math.max(0, state.remainingMs || 0);
  const totalSec = Math.ceil(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  timeEl.textContent = `${mm}:${ss}`;
  stateEl.textContent = state.status || 'IDLE';
}

// 通知音発火: 同じ秒で複数フレーム検出されても1回だけ鳴らすためのガード
// レベルが変わったら -1 にリセット（次レベルの 60s/10s/5..1 で再発火可能に）
let lastAudioTriggerSec = -1;

// STEP 6.21.4.1: 復元直後の音抑止フラグ（**1回限り**で必ずクリア）。
// applyTimerStateToTimer({silent: true}) で true にセット、handleAudioOnTick / handleAudioOnPreStartTick
// の冒頭で消費して false に戻す。これで「継続的に音が鳴らない」現象を原理的に排除。
let audioSuppressOnce = false;

function handleAudioOnTick(remainingMs, currentLevelIndex) {
  const remainingSec = Math.ceil(remainingMs / 1000);
  if (remainingSec === lastAudioTriggerSec) return;
  lastAudioTriggerSec = remainingSec;

  // STEP 6.21.4.1: 1回限りの音抑止（復元直後のみ）。フラグは必ずここでクリア
  if (audioSuppressOnce) {
    audioSuppressOnce = false;
    return;
  }

  const { status } = getState();
  if (status === States.BREAK) {
    // ブレイク中: 残り0秒でブレイク終了音（次レベルへ自動遷移）
    if (remainingSec === 0) playSound('break-end');
    return;
  }

  // RUNNING 中
  if (remainingSec === 60) playSound('warning-1min');
  if (remainingSec === 10) playSound('warning-10sec');
  if (remainingSec >= 1 && remainingSec <= 5) playSound('countdown-tick');
  // remainingSec === 0 は onLevelEnd で level-end を鳴らす
}

// PRE_START 中の音発火: 残り 5,4,3,2,1 秒で countdown-tick を1回ずつ。
// 0 秒は onPreStartEnd で start を鳴らす（onPreStartTick の remainingSec===0 検出は不確実）
function handleAudioOnPreStartTick(remainingMs) {
  const remainingSec = Math.ceil(remainingMs / 1000);
  if (remainingSec === lastAudioTriggerSec) return;
  lastAudioTriggerSec = remainingSec;
  // STEP 6.21.4.1: 1回限りの音抑止（同じくここでクリア）
  if (audioSuppressOnce) {
    audioSuppressOnce = false;
    return;
  }
  if (remainingSec >= 1 && remainingSec <= 5) playSound('countdown-tick');
}

setHandlers({
  onTick: (remainingMs) => {
    renderTime(remainingMs);
    const { currentLevelIndex } = getState();
    renderNextBreak(remainingMs, currentLevelIndex);
    handleAudioOnTick(remainingMs, currentLevelIndex);
    // STEP 10 フェーズC.1.4-fix1 Fix 2: スライドショー / PIP 同期は subscribe 経由のみで実施。
    //   timer.js が setState({ remainingMs }) を呼ぶと subscribe が発火 → syncSlideshowFromState
    //   が呼ばれるため、onTick handler 内で重複呼出する必要なし。
    //   onTick handler から削除することで warning-1min 等の音発火経路を C.1.4 以前と完全一致させる。
  },
  onLevelChange: (index) => {
    renderCurrentLevel(index);
    renderNextLevel(index);
    // レベル変更時は秒トリガをリセット（次レベルの 60s/10s/5..1 で再発火可能に）
    lastAudioTriggerSec = -1;
  },
  onLevelEnd: (index) => {
    // レベル終了の瞬間に level-end を1回鳴らす（onTick の remainingSec===0 検出より確実）
    const lv = getLevel(index);
    if (lv && !lv.isBreak) playSound('level-end');
  },
  onPreStartTick: (remainingMs) => {
    // renderTime は subscribe 側で発火するので、ここでは音のみ
    handleAudioOnPreStartTick(remainingMs);
    // STEP 10 フェーズC.1.4-fix1 Fix 2: スライドショー / PIP 同期は subscribe 経由（PRE_START 中も同様）
  },
  onPreStartEnd: () => {
    // PRE_START 残り 0 → start 音 → 直後に startAtLevel(0) が呼ばれる
    playSound('start');
    lastAudioTriggerSec = -1;
  }
});

// ===== 入力ハンドラ =====

function handleStartPauseToggle() {
  // v2.0.0 STEP 3: ホール側では一切の操作を受け付けない（CSS でも hidden だが多重防御）
  if (window.appRole === 'hall') return;
  // 初回ユーザー操作時に AudioContext を resume（fire-and-forget）
  ensureAudioReady();
  const { status } = getState();
  // IDLE: スタートボタンと同じ挙動（プレスタート選択ダイアログを開く）
  if (status === States.IDLE) openPreStartDialog();
  else if (status === States.RUNNING || status === States.BREAK || status === States.PRE_START) timerPause();
  else if (status === States.PAUSED) timerResume();
}

function openResetDialog() {
  if (window.appRole === 'hall') return;   // v2.0.0 STEP 3: ホール側はダイアログを開かせない
  if (typeof el.resetDialog.showModal === 'function') {
    el.resetDialog.showModal();
  } else if (window.confirm('タイマーをリセットしますか？')) {
    handleReset();   // STEP 6.6: tournamentRuntime もクリア
  }
}

// プレスタート時間選択ダイアログ（STEP 5 + STEP 6: 参加人数入力）
function openPreStartDialog() {
  if (window.appRole === 'hall') return;   // v2.0.0 STEP 3: ホール側はダイアログを開かせない
  if (!el.prestartDialog) return;
  // 開く度に「今すぐ開始」をデフォルトに戻す（前回の選択を引きずらない）
  const radios = el.prestartDialog.querySelectorAll('input[name="prestart-mode"]');
  for (const r of radios) {
    r.checked = (r.value === '0');
  }
  // 参加人数の初期値: 前回値 or 10 人（最初は store にデータがないので 10）
  if (el.prestartPlayers) {
    const prev = tournamentRuntime.playersInitial;
    el.prestartPlayers.value = prev > 0 ? String(prev) : '10';
  }
  if (typeof el.prestartDialog.showModal === 'function') {
    el.prestartDialog.showModal();
  }
}

// 参加人数を読む（プレスタートダイアログから）
function readPreStartPlayers() {
  const n = Number(el.prestartPlayers?.value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

// プレイヤー人数を初期化してメイン画面の動的値を更新
function initTournamentRuntime(playerCount) {
  tournamentRuntime.playersInitial = Math.max(0, Math.floor(Number(playerCount) || 0));
  tournamentRuntime.playersRemaining = tournamentRuntime.playersInitial;
  // STEP 6.9: rebuyCount → reentryCount
  tournamentRuntime.reentryCount = 0;
  tournamentRuntime.addOnCount = 0;
  renderStaticInfo();
  // STEP 10 フェーズC.1.8: 永続化（プレスタートで初期化された値を保存）
  schedulePersistRuntime();
}

// 選択中のモード値（'0' / '5' / '15' / '30' / '60' / 'custom'）から minutes を返す
function readPreStartMinutes() {
  const checked = el.prestartDialog?.querySelector('input[name="prestart-mode"]:checked');
  if (!checked) return 0;
  if (checked.value === 'custom') {
    const n = Number(el.prestartCustomMin?.value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(1, Math.min(180, Math.floor(n)));
  }
  return Math.max(0, Number(checked.value) || 0);
}

el.btnStart.addEventListener('click', () => {
  // v2.0.0 STEP 3: ホール側ではボタン自体が hidden だが多重防御
  if (window.appRole === 'hall') return;
  // 初回スタート時に AudioContext を resume（ブラウザ自動再生ポリシー対策）
  ensureAudioReady();
  // v2.0.0 STEP 3 → v2.0.2 cleanup: operator → hall の状態伝播は既存 IPC
  //   （tournaments:setTimerState 等）→ main 側 _publishDualState 経路で実施。
  //   notifyOperatorActionIfNeeded ヘルパー呼出は撤去（dual:operator-action がデッドコード）。
  if (getState().status === States.IDLE) openPreStartDialog();
});

el.prestartCancel?.addEventListener('click', () => el.prestartDialog?.close());
el.prestartOk?.addEventListener('click', () => {
  const minutes = readPreStartMinutes();
  const players = readPreStartPlayers();
  el.prestartDialog?.close();
  // STEP 6: 参加人数を runtime に設定 → プール / アベスタック / PAYOUTS が確定
  initTournamentRuntime(players);
  if (minutes <= 0) {
    timerStart();   // 「今すぐ開始」: 従来通り即時 startAtLevel(0)
  } else {
    timerStartPreStart(minutes);
  }
});

// 任意分入力欄にフォーカスが入ったら「任意」ラジオを自動選択
el.prestartCustomMin?.addEventListener('focus', () => {
  const customRadio = el.prestartDialog?.querySelector('input[name="prestart-mode"][value="custom"]');
  if (customRadio) customRadio.checked = true;
});
el.btnPause.addEventListener('click', () => {
  if (window.appRole === 'hall') return;   // v2.0.0 STEP 3: 多重防御
  ensureAudioReady();
  // v2.0.2 cleanup: notifyOperatorActionIfNeeded 呼出撤去（dual:operator-action がデッドコード）。
  handleStartPauseToggle();
});
el.btnReset.addEventListener('click', () => {
  if (window.appRole === 'hall') return;   // v2.0.0 STEP 3: 多重防御
  ensureAudioReady();
  openResetDialog();
});
el.resetCancel.addEventListener('click', () => el.resetDialog.close());
el.resetOk.addEventListener('click', () => {
  el.resetDialog.close();
  handleReset();   // STEP 6.6: tournamentRuntime もクリア → FINISHED 解除
});

// ===== 背景プリセット =====

// STEP 6.22: 店舗名「Presented by ○○」表示制御
//   value 空欄なら display:none で layout 占有ゼロ（layout shift 完全回避）
//   非空なら "Presented by {name}" を表示
const VENUE_NAME_RE_RENDERER = /^[A-Za-z0-9][A-Za-z0-9 '\-&.,]{0,29}$/;

function applyVenueName(value) {
  if (!el.presentedBy) return;
  const v = (typeof value === 'string') ? value.trim() : '';
  if (v === '') {
    el.presentedBy.textContent = '';
    el.presentedBy.classList.remove('is-visible');
  } else {
    el.presentedBy.textContent = `Presented by ${v}`;
    el.presentedBy.classList.add('is-visible');
  }
}

// 店舗名の保存ボタン: クライアント側バリデーション → IPC 保存 → 反映
// STEP 6.22.1.fix: ヒント要素（js-venue-name-error）はエラー / 成功を兼用、クラスで色制御
function _venueHintReset() {
  if (!el.venueNameError) return;
  el.venueNameError.hidden = true;
  el.venueNameError.classList.remove('settings-hint--error', 'settings-hint--success');
}
function _venueHintError(msg) {
  if (!el.venueNameError) return;
  el.venueNameError.textContent = msg;
  el.venueNameError.classList.remove('settings-hint--success');
  el.venueNameError.classList.add('settings-hint--error');
  el.venueNameError.hidden = false;
}
function _venueHintSuccess(msg, ttlMs = 2500) {
  if (!el.venueNameError) return;
  el.venueNameError.textContent = msg;
  el.venueNameError.classList.remove('settings-hint--error');
  el.venueNameError.classList.add('settings-hint--success');
  el.venueNameError.hidden = false;
  setTimeout(() => {
    if (el.venueNameError) {
      el.venueNameError.hidden = true;
      el.venueNameError.classList.remove('settings-hint--success');
    }
  }, ttlMs);
}

async function handleVenueSave() {
  const raw = el.venueNameInput?.value || '';
  const value = raw.trim();
  _venueHintReset();
  // クライアント側 validation（先頭英数 + 一部記号、空欄許可）
  if (value !== '' && !VENUE_NAME_RE_RENDERER.test(value)) {
    _venueHintError('半角英数と一部記号（\'-&.,スペース）のみ、30文字以内、先頭は英数で入力してください');
    return;
  }
  if (!window.api?.settings?.setVenueName) return;
  try {
    const result = await window.api.settings.setVenueName(value);
    if (!result?.ok) {
      _venueHintError(result?.message || '保存に失敗しました');
      return;
    }
    applyVenueName(result.venueName);
    // 入力欄も保存後の値（trim 済み）で同期
    if (el.venueNameInput) el.venueNameInput.value = result.venueName;
    // STEP 6.22.1.fix: 成功フィードバック（緑字 2.5 秒）
    _venueHintSuccess('保存しました');
  } catch (err) {
    console.warn('venueName 保存失敗:', err);
    _venueHintError('保存に失敗しました: ' + (err.message || err));
  }
}

el.venueSaveBtn?.addEventListener('click', handleVenueSave);

// ===== STEP 6.23: PC間データ移行（エクスポート / インポート） =====

const EXPORT_FORMAT_RENDERER = 'PokerTimerPLUS+ Tournament Export';
// v2.0.3 Fix M: main.js EXPORT_VERSION = 2 と同期（旧 1 のままだと自分自身がエクスポートした
//   v2 ペイロードを取り込めず、PC 間移行 UI が完全に壊れる致命バグがあった）。
const EXPORT_VERSION_RENDERER = 2;

function setDataTransferHint(message, kind = '') {
  if (!el.dataTransferHint) return;
  el.dataTransferHint.textContent = message || '';
  el.dataTransferHint.classList.remove('settings-hint--error', 'settings-hint--success');
  if (!message) {
    el.dataTransferHint.hidden = true;
    return;
  }
  if (kind === 'error')   el.dataTransferHint.classList.add('settings-hint--error');
  if (kind === 'success') el.dataTransferHint.classList.add('settings-hint--success');
  el.dataTransferHint.hidden = false;
  setTimeout(() => {
    if (el.dataTransferHint) {
      el.dataTransferHint.hidden = true;
      el.dataTransferHint.classList.remove('settings-hint--error', 'settings-hint--success');
    }
  }, 4000);
}

// クライアント側でも format/version の最低限チェック（main 側でも検証あり、二重ガード）
function quickValidateImport(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: '不正な JSON データです' };
  if (payload.format !== EXPORT_FORMAT_RENDERER) return { ok: false, error: 'PokerTimerPLUS+ のエクスポート形式ではありません' };
  if (typeof payload.version !== 'number') return { ok: false, error: 'バージョン情報がありません' };
  if (payload.version > EXPORT_VERSION_RENDERER) return { ok: false, error: 'このアプリより新しい形式です。アプリをアップデートしてください' };
  if (!Array.isArray(payload.tournaments)) return { ok: false, error: 'tournaments 配列がありません' };
  if (!Array.isArray(payload.userPresets)) return { ok: false, error: 'userPresets 配列がありません' };
  return { ok: true };
}

// ファイル名を安全な文字に正規化（.json 拡張子付与）
function safeFileName(base, suffix = '') {
  const cleaned = (base || 'tournament').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 50);
  return `${cleaned}${suffix}.json`;
}

async function handleExportSingleFile() {
  if (!window.api?.tournaments?.exportSingle) return;
  const result = await window.api.tournaments.exportSingle(tournamentState.id);
  if (!result?.ok) return setDataTransferHint('エクスポートに失敗しました', 'error');
  const fname = safeFileName(result.payload.tournaments[0]?.name);
  const wr = await window.api.tournaments.writeExportFile(result.payload, fname);
  if (!wr?.ok) {
    if (wr?.error === 'canceled') return; // キャンセルは無音
    return setDataTransferHint('保存に失敗しました', 'error');
  }
  setDataTransferHint(`保存しました: ${wr.filePath}`, 'success');
}

async function handleExportSingleClipboard() {
  if (!window.api?.tournaments?.exportSingle) return;
  const result = await window.api.tournaments.exportSingle(tournamentState.id);
  if (!result?.ok) return setDataTransferHint('エクスポートに失敗しました', 'error');
  try {
    await navigator.clipboard.writeText(JSON.stringify(result.payload, null, 2));
    setDataTransferHint('クリップボードにコピーしました', 'success');
  } catch (err) {
    console.warn('clipboard writeText 失敗:', err);
    setDataTransferHint('コピーに失敗しました: ' + (err.message || err), 'error');
  }
}

async function handleExportBulkFile() {
  if (!window.api?.tournaments?.exportBulk) return;
  const result = await window.api.tournaments.exportBulk();
  if (!result?.ok) return setDataTransferHint('エクスポートに失敗しました', 'error');
  // ファイル名: pokertimerplus-bulk-YYYYMMDD.json
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const fname = `pokertimerplus-bulk-${ymd}.json`;
  const wr = await window.api.tournaments.writeExportFile(result.payload, fname);
  if (!wr?.ok) {
    if (wr?.error === 'canceled') return;
    return setDataTransferHint('保存に失敗しました', 'error');
  }
  setDataTransferHint(`保存しました: ${wr.filePath}`, 'success');
}

// 戦略選択ダイアログ Promise ヘルパ（既存 showBlindsApplyModal と同パターン）
// STEP 7 (F-2): Esc キー（dialog cancel イベント）でも resolve('cancel') されるよう紐付け
let _importStrategyHandlers = null;
function showImportStrategyDialog() {
  return new Promise((resolve) => {
    if (!el.importStrategyDialog) { resolve('cancel'); return; }
    if (_importStrategyHandlers) {
      el.importStrategyOverwrite?.removeEventListener('click', _importStrategyHandlers.over);
      el.importStrategyRename?.removeEventListener('click', _importStrategyHandlers.rename);
      el.importCancel?.removeEventListener('click', _importStrategyHandlers.cancel);
      el.importStrategyDialog.removeEventListener('cancel', _importStrategyHandlers.escCancel);
    }
    const close = () => el.importStrategyDialog.close?.();
    const onOver   = () => { close(); resolve('overwrite'); };
    const onRename = () => { close(); resolve('rename'); };
    const onCancel = () => { close(); resolve('cancel'); };
    // Esc キー: dialog のデフォルト close に任せて、resolve だけ確実に
    const onEscCancel = () => { resolve('cancel'); };
    _importStrategyHandlers = { over: onOver, rename: onRename, cancel: onCancel, escCancel: onEscCancel };
    el.importStrategyOverwrite?.addEventListener('click', onOver);
    el.importStrategyRename?.addEventListener('click', onRename);
    el.importCancel?.addEventListener('click', onCancel);
    el.importStrategyDialog.addEventListener('cancel', onEscCancel);
    el.importStrategyDialog.showModal?.();
  });
}

// インポート共通フロー（ファイル / クリップボード両方からこれを呼ぶ）
async function processImport(payload) {
  const v = quickValidateImport(payload);
  if (!v.ok) return setDataTransferHint(`不正なデータ: ${v.error}`, 'error');
  if (el.importCount) el.importCount.textContent = String(payload.tournaments.length);
  const strategy = await showImportStrategyDialog();
  if (strategy === 'cancel') return;
  // 全件に _action を付与してから main へ
  const tournaments = payload.tournaments.map((t) => ({ ...t, _action: strategy }));
  const userPresets = payload.userPresets.map((p) => ({ ...p, _action: strategy }));
  const r = await window.api.tournaments.importPayload({ tournaments, userPresets });
  if (!r?.ok) return setDataTransferHint('取り込みに失敗しました', 'error');
  let msg = `取り込み完了: トーナメント ${r.importedTournaments} 件 / プリセット ${r.importedPresets} 件`;
  if (r.skippedByLimit > 0) msg += ` (上限超過で ${r.skippedByLimit} 件スキップ)`;
  setDataTransferHint(msg, 'success');
  // UI を再構築（既存のリフレッシュ関数を流用）
  await populateTournamentList();
  await populateTournamentBlindPresets();
}

async function handleImportFile() {
  if (!window.api?.tournaments?.readImportFile) return;
  const r = await window.api.tournaments.readImportFile();
  if (!r?.ok) {
    if (r?.error === 'canceled') return;
    return setDataTransferHint(`読込失敗: ${r.message || r.error}`, 'error');
  }
  await processImport(r.payload);
}

// STEP 10 フェーズC.2.7-audit-fix: BOM ストリップヘルパ。
//   Web 由来の JSON テキストには UTF-8 BOM (0xFEFF) が混入することがあり、JSON.parse が失敗する。
//   先頭の BOM を 1 文字だけ除去してから parse すると、ユーザーは「なぜ失敗？」と困惑しなくて済む。
function stripBom(text) {
  if (typeof text !== 'string') return text;
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

async function handleImportClipboard() {
  try {
    const raw = await navigator.clipboard.readText();
    const text = stripBom(raw);
    let payload;
    try { payload = JSON.parse(text); }
    catch (e) { return setDataTransferHint('クリップボードの内容が JSON として解析できません', 'error'); }
    await processImport(payload);
  } catch (err) {
    console.warn('clipboard readText 失敗:', err);
    setDataTransferHint('クリップボードの読込に失敗しました', 'error');
  }
}

el.exportSingleFileBtn?.addEventListener('click', handleExportSingleFile);
el.exportSingleClipboardBtn?.addEventListener('click', handleExportSingleClipboard);
el.exportBulkFileBtn?.addEventListener('click', handleExportBulkFile);
el.importFileBtn?.addEventListener('click', handleImportFile);
el.importClipboardBtn?.addEventListener('click', handleImportClipboard);

function applyBackground(value) {
  let bg = VALID_BACKGROUNDS.includes(value) ? value : 'navy';
  // STEP 10 フェーズC.1.3-fix1 Fix 2: ユーザー意図値を記録（image でも記録、フォールバックされても保持）。
  _userBgChoice = bg;
  // STEP 10 フェーズC.1.3: image 選択中で画像未設定なら、直近の色背景にフォールバック。
  //   ユーザー体験：「画像」を選んでもまだ画像をロードしていない場合は黒画面で困らないよう、
  //   前回の色背景を維持し、選択チップだけ「画像」をマーキング。
  const isImage = (bg === 'image');
  const hasImage = isImage && typeof bgImageState.dataUrl === 'string' && bgImageState.dataUrl !== '';
  const effective = (isImage && !hasImage) ? (_lastColorBackground || 'navy') : bg;
  document.documentElement.dataset.bg = effective;
  if (effective !== 'image') {
    _lastColorBackground = effective;   // 色背景時のみ記憶
  }
  // 画像時のみ CSS 変数をセット
  if (effective === 'image') {
    document.documentElement.style.setProperty('--custom-bg-image', `url("${bgImageState.dataUrl}")`);
    const alpha = BG_OVERLAY_ALPHA[bgImageState.overlay] ?? BG_OVERLAY_ALPHA.mid;
    document.documentElement.style.setProperty('--bg-overlay-alpha', String(alpha));
  } else {
    document.documentElement.style.removeProperty('--custom-bg-image');
    // overlay-alpha は他テーマでは未参照のため残置しても無害。確実性のため remove。
    document.documentElement.style.removeProperty('--bg-overlay-alpha');
  }
  // 選択中サムネイルにマーキングを反映（チップ表示は元の bg=「image」を維持）
  if (el.bgPicker) {
    const thumbs = el.bgPicker.querySelectorAll('.bg-thumb');
    for (const thumb of thumbs) {
      thumb.classList.toggle('is-selected', thumb.dataset.bgValue === bg);
    }
  }
  // カスタム画像詳細パネルの開閉
  if (el.bgImagePanel) {
    el.bgImagePanel.hidden = (bg !== 'image');
  }
}

// STEP 10 フェーズC.1.3: カスタム画像 state を更新して applyBackground を再描画
function setBgImageState(partial) {
  if (!partial || typeof partial !== 'object') return;
  if (typeof partial.dataUrl === 'string') bgImageState.dataUrl = partial.dataUrl;
  if (typeof partial.overlay === 'string' && BG_OVERLAY_ALPHA[partial.overlay]) {
    bgImageState.overlay = partial.overlay;
  }
  refreshBgImagePreview();
  // STEP 10 フェーズC.1.3-fix1 Fix 2: dataset.bg は画像未設定時にフォールバックされて 'image' でない可能性。
  //   ユーザーが「画像」チップを選択中（_userBgChoice === 'image'）なら、初回画像ロード時にも再描画する。
  if (_userBgChoice === 'image') {
    applyBackground('image');
  }
}

function refreshBgImagePreview() {
  if (!el.bgImagePreview || !el.bgImagePlaceholder) return;
  const has = !!bgImageState.dataUrl;
  el.bgImagePreview.hidden = !has;
  el.bgImagePlaceholder.hidden = has;
  if (has) el.bgImagePreview.src = bgImageState.dataUrl;
  else     el.bgImagePreview.removeAttribute('src');
  // 強度ラジオも同期
  const radios = document.querySelectorAll('input[name="bg-overlay-intensity"]');
  for (const r of radios) r.checked = (r.value === bgImageState.overlay);
}

function setBgImageError(msg) {
  if (!el.bgImageError) return;
  if (msg) {
    el.bgImageError.textContent = msg;
    el.bgImageError.hidden = false;
  } else {
    el.bgImageError.textContent = '';
    el.bgImageError.hidden = true;
  }
}

async function handleBgThumbClick(value) {
  applyBackground(value);
  setBgImageError('');
  // STEP 6.21.6: 保存先を active トーナメントの displaySettings に変更
  // グローバル display.background は新規トーナメント既定値供給用に残置（ここでは触らない）
  if (window.api?.tournaments?.setDisplaySettings && tournamentState.id) {
    try {
      await window.api.tournaments.setDisplaySettings(tournamentState.id, { background: value });
    } catch (err) {
      console.warn('背景設定の保存に失敗:', err);
    }
  }
}

// STEP 10 フェーズC.1.3: 「画像を選ぶ」ハンドラ
async function handleBgImageSelect() {
  setBgImageError('');
  if (!window.api?.display?.selectBackgroundImage) {
    setBgImageError('画像選択機能が利用できません');
    return;
  }
  let result;
  try { result = await window.api.display.selectBackgroundImage(); }
  catch (err) {
    setBgImageError('画像の読込に失敗しました');
    return;
  }
  if (!result || !result.ok) {
    if (result?.error === 'canceled') return;   // キャンセルは無音
    setBgImageError(result?.message || '画像の選択に失敗しました');
    return;
  }
  // 永続化（active トーナメント）
  if (window.api?.tournaments?.setDisplaySettings && tournamentState.id) {
    try {
      const res = await window.api.tournaments.setDisplaySettings(tournamentState.id, {
        backgroundImage: result.dataUrl,
        backgroundOverlay: bgImageState.overlay
      });
      if (!res?.ok) {
        setBgImageError(res?.message || '画像の保存に失敗しました');
        return;
      }
    } catch (err) {
      setBgImageError('画像の保存に失敗しました');
      return;
    }
  }
  setBgImageState({ dataUrl: result.dataUrl });
  // STEP 10 フェーズC.1.4-fix3 Fix 3: 背景画像追加で累積サイズ再評価
  checkImagesTotalSizeAndWarn().catch(() => {});
}

// STEP 10 フェーズC.1.3: 「画像を解除」ハンドラ
async function handleBgImageClear() {
  setBgImageError('');
  if (window.api?.tournaments?.setDisplaySettings && tournamentState.id) {
    try {
      await window.api.tournaments.setDisplaySettings(tournamentState.id, { backgroundImage: '' });
    } catch (err) { console.warn('画像解除の保存に失敗:', err); }
  }
  setBgImageState({ dataUrl: '' });
  // STEP 10 フェーズC.1.4-fix3 Fix 3: 背景画像解除で累積サイズ再評価（⚠ が消える可能性）
  checkImagesTotalSizeAndWarn().catch(() => {});
}

// STEP 10 フェーズC.1.3: 暗くする強度ラジオハンドラ
async function handleBgImageOverlayChange(value) {
  if (!BG_OVERLAY_ALPHA[value]) return;
  setBgImageState({ overlay: value });
  if (window.api?.tournaments?.setDisplaySettings && tournamentState.id) {
    try {
      await window.api.tournaments.setDisplaySettings(tournamentState.id, { backgroundOverlay: value });
    } catch (err) { console.warn('強度設定の保存に失敗:', err); }
  }
}

// ===== STEP 10 フェーズC.1.4: 休憩中スライドショー + PIP タイマー =====
//
// アクティベーション条件:
//   - status === States.BREAK または States.PRE_START
//   - breakImagesState.images.length > 0
//   - userOverride !== 'force-timer'
//   - 残り時間 > SLIDESHOW_AUTO_END_MS（60 秒）
//
// 残り 60 秒を切ったら autoEndedAt にフラグして 1 回だけ deactivate（再起動防止）。
// userOverride='force-timer' のときは active=false、「スライドショーに戻る」ボタンを表示。

function isSlideshowEligibleStatus(status) {
  return status === States.BREAK || status === States.PRE_START;
}

function applyPipSize(value) {
  const v = VALID_PIP_SIZES.includes(value) ? value : 'medium';
  document.documentElement.dataset.pipSize = v;
}

function activateSlideshow() {
  if (slideshowState.active) return;
  if (breakImagesState.images.length === 0) return;
  slideshowState.active = true;
  slideshowState.currentIndex = 0;
  document.documentElement.dataset.slideshow = 'active';
  // 1 枚目を表示
  if (el.slideshowImg) {
    el.slideshowImg.src = breakImagesState.images[0];
  }
  // setInterval で循環
  const intervalMs = Math.max(3, breakImagesState.intervalSec) * 1000;
  if (slideshowState.intervalId) clearInterval(slideshowState.intervalId);
  slideshowState.intervalId = setInterval(() => {
    if (!slideshowState.active || breakImagesState.images.length === 0) return;
    slideshowState.currentIndex = (slideshowState.currentIndex + 1) % breakImagesState.images.length;
    if (el.slideshowImg) {
      // クロスフェード（簡易、opacity 切替）
      el.slideshowImg.style.opacity = '0';
      setTimeout(() => {
        if (el.slideshowImg) {
          el.slideshowImg.src = breakImagesState.images[slideshowState.currentIndex];
          el.slideshowImg.style.opacity = '1';
        }
      }, 250);
    }
  }, intervalMs);
}

function deactivateSlideshow() {
  if (!slideshowState.active) {
    // active でなくても dataset は確実にクリア
    if (document.documentElement.dataset.slideshow) {
      delete document.documentElement.dataset.slideshow;
    }
    return;
  }
  slideshowState.active = false;
  if (slideshowState.intervalId) {
    clearInterval(slideshowState.intervalId);
    slideshowState.intervalId = null;
  }
  delete document.documentElement.dataset.slideshow;
}

// PIP タイマーの数字とラベルを更新
function updatePipTimer(remainingMs, status) {
  if (!el.pipDigits || !el.pipLabel) return;
  // フォーマット: PRE_START は formatPreStartTime、それ以外は formatTime（既存と整合）
  if (status === States.PRE_START) {
    el.pipDigits.textContent = formatPreStartTime(remainingMs);
    el.pipLabel.textContent = '開始まで';
  } else {
    el.pipDigits.textContent = formatTime(remainingMs);
    el.pipLabel.textContent = (status === States.BREAK) ? 'BREAK' : '';
  }
}

// 「スライドショーに戻る」ボタンの disabled 状態を残り時間で更新
function updatePipShowSlideshowDisabled(remainingMs) {
  if (!el.pipShowSlideshow) return;
  const disabled = (remainingMs <= SLIDESHOW_AUTO_END_MS);
  el.pipShowSlideshow.disabled = disabled;
  el.pipShowSlideshow.title = disabled ? '残り 1 分以内はスライドショーに戻れません' : '';
}

// 状態に応じて手動切替ボタンの hidden / disabled を再計算
function refreshPipActionButtons(status, remainingMs) {
  const eligibleStatus = isSlideshowEligibleStatus(status);
  const hasImages = breakImagesState.images.length > 0;
  const beforeAutoEnd = remainingMs > SLIDESHOW_AUTO_END_MS;
  const isAutoActive = eligibleStatus && hasImages && beforeAutoEnd && slideshowState.userOverride === 'auto';
  const userForcedTimer = eligibleStatus && hasImages && slideshowState.userOverride === 'force-timer';

  if (el.pipShowTimer) {
    // スライドショー active 中（自動表示）のみ「タイマー画面に戻す」を表示
    el.pipShowTimer.hidden = !isAutoActive;
  }
  if (el.pipShowSlideshow) {
    // BREAK/PRE_START 中で、ユーザー手動 OR 残り 60s 未満で自動 OFF された状態
    const showButton = eligibleStatus && hasImages && (userForcedTimer || (!beforeAutoEnd && slideshowState.userOverride === 'auto'));
    el.pipShowSlideshow.hidden = !showButton;
    updatePipShowSlideshowDisabled(remainingMs);
  }
}

// メインの状態遷移ハンドラ — onTick / subscribe から呼ぶ
function syncSlideshowFromState(remainingMs) {
  const { status } = getState();
  // PIP タイマー本体の数字更新（active/inactive 関係なく更新だけしておけば、active 切替で即映る）
  updatePipTimer(remainingMs, status);
  refreshPipActionButtons(status, remainingMs);

  const eligibleStatus = isSlideshowEligibleStatus(status);
  const hasImages = breakImagesState.images.length > 0;

  // 状態が抜けたら必ず deactivate + 状態リセット
  if (!eligibleStatus) {
    if (slideshowState.active) deactivateSlideshow();
    slideshowState.userOverride = 'auto';   // 次回 BREAK/PRE_START 突入で自動表示に戻す
    slideshowState.autoEndedAt = null;
    return;
  }

  if (!hasImages) {
    if (slideshowState.active) deactivateSlideshow();
    return;
  }

  // 残り 60 秒以内 → 1 回だけ autoEnd
  if (remainingMs <= SLIDESHOW_AUTO_END_MS) {
    if (slideshowState.active && slideshowState.autoEndedAt === null) {
      slideshowState.autoEndedAt = remainingMs;
      deactivateSlideshow();
    }
    return;
  }

  // STEP 10 フェーズC.1.4-fix1 Fix 3: 残り 60 秒を超えて戻った場合（30秒戻る等）に autoEndedAt 解除。
  //   これがないと、再度 60 秒以下に達した時 autoEndedAt !== null で 2 回目の deactivate がスキップされ、
  //   スライドショーが残り 40 秒等まで続いてしまう。
  if (slideshowState.autoEndedAt !== null) {
    slideshowState.autoEndedAt = null;
  }

  // 残り 60 秒以上で active 候補
  if (slideshowState.userOverride === 'force-timer') {
    if (slideshowState.active) deactivateSlideshow();
    return;
  }
  // STEP 10 フェーズC.1.4-fix2 Fix 1: BREAK 中は開始から 30 秒経過するまで active 化しない
  //   PRE_START は breakStartedAt === null のままなのでこの分岐をスキップ → 即時表示
  if (status === States.BREAK && slideshowState.breakStartedAt !== null) {
    const elapsed = Date.now() - slideshowState.breakStartedAt;
    if (elapsed < SLIDESHOW_BREAK_DELAY_MS) {
      if (slideshowState.active) deactivateSlideshow();
      return;
    }
  }
  // ここまで来たら自動表示を ON にすべき
  if (!slideshowState.active) {
    activateSlideshow();
  }
}

function handlePipShowTimer() {
  slideshowState.userOverride = 'force-timer';
  deactivateSlideshow();
  const { status, remainingMs } = getState();
  refreshPipActionButtons(status, remainingMs);
}

function handlePipShowSlideshow() {
  // 残り 60 秒以内なら disabled なので通常は来ないが、念のため二重チェック
  const { status, remainingMs } = getState();
  if (remainingMs <= SLIDESHOW_AUTO_END_MS) return;
  slideshowState.userOverride = 'auto';
  if (isSlideshowEligibleStatus(status) && breakImagesState.images.length > 0) {
    activateSlideshow();
  }
  refreshPipActionButtons(status, remainingMs);
}

// 設定 UI: サムネイル一覧再描画
function renderBreakImagesList() {
  if (!el.breakImagesList) return;
  // 既存 thumb をクリア（placeholder は残す）
  const thumbs = el.breakImagesList.querySelectorAll('.break-images-panel__thumb');
  for (const t of thumbs) t.remove();
  const images = breakImagesState.images;
  if (el.breakImagesPlaceholder) {
    el.breakImagesPlaceholder.hidden = (images.length > 0);
  }
  for (let i = 0; i < images.length; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'break-images-panel__thumb';
    wrap.dataset.index = String(i);
    const img = document.createElement('img');
    img.src = images[i];
    img.alt = `休憩中画像 ${i + 1}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'break-images-panel__thumb-remove';
    btn.textContent = '✕';
    btn.title = '削除';
    btn.addEventListener('click', () => handleBreakImageRemove(i));
    wrap.appendChild(img);
    wrap.appendChild(btn);
    el.breakImagesList.appendChild(wrap);
  }
  if (el.breakImagesCount) {
    el.breakImagesCount.textContent = `${images.length} / ${BREAK_IMAGES_MAX_COUNT} 枚`;
  }
  // 切替間隔・PIP サイズ入力を同期
  if (el.breakImageInterval) {
    el.breakImageInterval.value = String(breakImagesState.intervalSec);
  }
  const pipRadios = document.querySelectorAll('input[name="pip-size"]');
  for (const r of pipRadios) r.checked = (r.value === breakImagesState.pipSize);
}

function setBreakImagesError(msg) {
  if (!el.breakImagesError) return;
  if (msg) {
    el.breakImagesError.textContent = msg;
    el.breakImagesError.hidden = false;
  } else {
    el.breakImagesError.textContent = '';
    el.breakImagesError.hidden = true;
  }
}

async function persistBreakImagesField(field, value) {
  if (!window.api?.tournaments?.setDisplaySettings || !tournamentState.id) return;
  try {
    const res = await window.api.tournaments.setDisplaySettings(tournamentState.id, { [field]: value });
    if (res?.ok && res.displaySettings) {
      // sanitize 済の値を反映（capping や補正があった場合に UI と整合）
      breakImagesState.images = Array.isArray(res.displaySettings.breakImages) ? res.displaySettings.breakImages : breakImagesState.images;
      if (typeof res.displaySettings.breakImageInterval === 'number') breakImagesState.intervalSec = res.displaySettings.breakImageInterval;
      if (typeof res.displaySettings.pipSize === 'string') breakImagesState.pipSize = res.displaySettings.pipSize;
      renderBreakImagesList();
      applyPipSize(breakImagesState.pipSize);
    }
    // STEP 10 フェーズC.1.4-fix3 Fix 3: 画像追加 / 削除で累積サイズが変わるため再評価
    checkImagesTotalSizeAndWarn().catch(() => {});
  } catch (err) { console.warn('breakImages 保存失敗:', err); }
}

async function handleBreakImagesAdd() {
  setBreakImagesError('');
  if (!window.api?.display?.selectBreakImages) {
    setBreakImagesError('画像選択機能が利用できません');
    return;
  }
  let result;
  try { result = await window.api.display.selectBreakImages(); }
  catch (_) { setBreakImagesError('画像の読込に失敗しました'); return; }
  if (!result || !result.ok) {
    if (result?.error === 'canceled') return;
    setBreakImagesError(result?.message || '画像の選択に失敗しました');
    return;
  }
  // 既存リストに追加 → 上限超過は main 側 sanitize でカット
  const next = [...breakImagesState.images, ...result.dataUrls];
  await persistBreakImagesField('breakImages', next);
  if (Array.isArray(result.errors) && result.errors.length > 0) {
    setBreakImagesError(`${result.errors.length} 枚スキップ（5MB 超または非対応形式）`);
  }
}

async function handleBreakImageRemove(index) {
  setBreakImagesError('');
  if (index < 0 || index >= breakImagesState.images.length) return;
  const next = [...breakImagesState.images.slice(0, index), ...breakImagesState.images.slice(index + 1)];
  await persistBreakImagesField('breakImages', next);
}

async function handleBreakImagesClear() {
  setBreakImagesError('');
  if (breakImagesState.images.length === 0) return;
  if (!window.confirm('休憩中の画像をすべて削除しますか？')) return;
  await persistBreakImagesField('breakImages', []);
}

async function handleBreakImageIntervalChange(value) {
  setBreakImagesError('');
  const v = Number(value);
  if (!Number.isFinite(v)) return;
  await persistBreakImagesField('breakImageInterval', Math.floor(v));
}

async function handlePipSizeChange(value) {
  if (!VALID_PIP_SIZES.includes(value)) return;
  await persistBreakImagesField('pipSize', value);
}

// STEP 10 フェーズC.1.4-fix3 Fix 3: 画像合計サイズ計算 + 警告ポップアップ + ⚠ アイコン制御。
//   全 tournaments の displaySettings.backgroundImage / breakImages[] と
//   グローバル既定値 display.backgroundImage / breakImages[] の base64 文字列長を合計。
//   base64 → バイト換算は length × 0.75 で近似（厳密値ではないが警告判定には十分）。
function estimateBase64Bytes(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl === '') return 0;
  // "data:image/...;base64," プレフィックスを除外して length × 0.75
  const commaIdx = dataUrl.indexOf(',');
  const body = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return Math.floor(body.length * 0.75);
}

function computeImagesTotalBytes(allSettings) {
  let total = 0;
  // グローバル既定値
  const g = allSettings?.display || {};
  total += estimateBase64Bytes(g.backgroundImage);
  if (Array.isArray(g.breakImages)) {
    for (const url of g.breakImages) total += estimateBase64Bytes(url);
  }
  // 全トーナメント
  const tournaments = Array.isArray(allSettings?.tournaments) ? allSettings.tournaments : [];
  for (const t of tournaments) {
    const ds = t?.displaySettings || {};
    total += estimateBase64Bytes(ds.backgroundImage);
    if (Array.isArray(ds.breakImages)) {
      for (const url of ds.breakImages) total += estimateBase64Bytes(url);
    }
  }
  return total;
}

function setSizeWarningIcons(visible, totalBytes) {
  const mb = (totalBytes / 1024 / 1024).toFixed(1);
  const tooltip = `画像データが大きすぎます（合計 ${mb}MB）。不要な画像の削除をお勧めします`;
  for (const icon of [el.sizeWarningBg, el.sizeWarningBreak]) {
    if (!icon) continue;
    icon.hidden = !visible;
    if (visible) icon.title = tooltip;
  }
}

async function checkImagesTotalSizeAndWarn() {
  if (!window.api?.settings?.getAll) return;
  let all;
  try { all = await window.api.settings.getAll(); }
  catch (_) { return; }
  const total = computeImagesTotalBytes(all);
  const exceeded = total > IMAGE_SIZE_WARNING_THRESHOLD_BYTES;
  setSizeWarningIcons(exceeded, total);
  if (exceeded && !imageSizeWarningShownInSession) {
    imageSizeWarningShownInSession = true;
    const mb = (total / 1024 / 1024).toFixed(1);
    // 起動完了直後のためレンダリング後に少し遅らせて表示
    setTimeout(() => {
      window.alert(
        `画像データが大きくなっています\n\n` +
        `保存されている画像の合計サイズが ${mb}MB です。\n` +
        `アプリの動作が重くなる可能性があります。\n` +
        `不要な画像を削除することをお勧めします。`
      );
    }, 400);
  }
}

// ===== タイマーフォント切替（STEP 4 仕上げ②） =====
//
// data-timer-font 属性を documentElement にセット → CSS 変数 --font-timer 経由で
// 中央タイマー .clock__time と右上 .next-break-value が同時に切替わる。

const VALID_TIMER_FONTS = ['jetbrains', 'roboto', 'space'];

function applyTimerFont(value) {
  const v = VALID_TIMER_FONTS.includes(value) ? value : 'jetbrains';
  document.documentElement.dataset.timerFont = v;
  if (el.fontPicker) {
    const thumbs = el.fontPicker.querySelectorAll('.font-thumb');
    for (const thumb of thumbs) {
      thumb.classList.toggle('is-selected', thumb.dataset.fontValue === v);
    }
  }
}

async function handleFontThumbClick(value) {
  applyTimerFont(value);
  // STEP 6.21.6: 保存先を active トーナメントの displaySettings に変更
  if (window.api?.tournaments?.setDisplaySettings && tournamentState.id) {
    try {
      await window.api.tournaments.setDisplaySettings(tournamentState.id, { timerFont: value });
    } catch (err) {
      console.warn('フォント設定の保存に失敗:', err);
    }
  }
}

// ===== STEP 6.7: ボトムバー非表示トグル（H キー） =====
// body.bottom-bar-hidden クラスで CSS から bottom-bar を隠し、テロップを拡大表示する。
// 状態は display.bottomBarHidden に永続化（起動時に復元）。
let bottomBarHidden = false;

function applyBottomBarHidden(hidden) {
  bottomBarHidden = Boolean(hidden);
  document.body.classList.toggle('bottom-bar-hidden', bottomBarHidden);
}

async function toggleBottomBar() {
  applyBottomBarHidden(!bottomBarHidden);
  if (window.api?.settings?.setDisplay) {
    try {
      await window.api.settings.setDisplay({ bottomBarHidden });
    } catch (err) {
      console.warn('ボトムバー表示状態の保存に失敗:', err);
    }
  }
}

function openSettingsDialog() {
  if (window.appRole === 'hall') return;   // v2.0.0 STEP 3: ホール側は設定ダイアログを開かせない
  if (typeof el.settingsDialog?.showModal === 'function') {
    // STEP 6.22.fix: 開く度に「トーナメント」タブをデフォルト active（最左との整合性）
    activateSettingsTab('tournament');
    syncMarqueeTabFormFromCurrent();
    el.settingsDialog.showModal();
  }
}

// ===== 設定ダイアログのタブ切替 =====

function activateSettingsTab(tabName) {
  el.settingsTabBtns.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.tab === tabName);
  });
  el.settingsTabPanels.forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.tab === tabName);
  });
  // テロップタブを開いた時は最新値で同期（他で更新された場合に追従）
  if (tabName === 'marquee') {
    syncMarqueeTabFormFromCurrent();
  }
  // ブラインド構造タブを開いた時はエディタを初期化（IPC でプリセット一覧取得）
  if (tabName === 'blinds') {
    ensureBlindsEditorLoaded();
  }
  // トーナメントタブを開いた時は最新値をフォームに反映
  if (tabName === 'tournament') {
    syncTournamentFormFromState();
  }
  // 音タブを開いた時は store の最新値をフォームへ
  if (tabName === 'audio') {
    syncAudioFormFromState();
  }
  // STEP 9-B: ロゴタブを開いた時は現在のモードでラジオを同期
  if (tabName === 'logo') {
    syncLogoModeRadioFromState();
    setLogoHint('', '');
  }
}

// ===== STEP 9-B: 左上ロゴ管理 =====

// 現在のロゴ状態（applyLogo 反映ソース。初期値はマウント直後に store から書き換え）
let currentLogoState = { kind: 'placeholder', customPath: null };

// ロゴ表示更新（main 画面の左上）
function applyLogo(logoState) {
  currentLogoState = { ...logoState };
  if (!el.logoImg || !el.logoPlaceholder) return;
  const kind = logoState?.kind || 'placeholder';
  if (kind === 'placeholder') {
    el.logoPlaceholder.hidden = false;
    el.logoImg.hidden = true;
    el.logoImg.removeAttribute('src');
  } else if (kind === 'plus2') {
    el.logoPlaceholder.hidden = true;
    el.logoImg.hidden = false;
    el.logoImg.src = '../assets/logo-plus2-default.png';
  } else if (kind === 'custom' && logoState.customPath) {
    el.logoPlaceholder.hidden = true;
    el.logoImg.hidden = false;
    // file:/// で絶対パス読み込み（CSP の img-src 'self' file: を許可済）
    const normalized = String(logoState.customPath).replace(/\\/g, '/');
    el.logoImg.src = `file:///${normalized}`;
  } else {
    // 不正な状態は placeholder にフォールバック
    el.logoPlaceholder.hidden = false;
    el.logoImg.hidden = true;
    el.logoImg.removeAttribute('src');
  }
}

// 設定タブ「ロゴ」のラジオを現在のモードに同期
function syncLogoModeRadioFromState() {
  const kind = currentLogoState?.kind || 'placeholder';
  if (!el.logoModeRadios) return;
  Array.from(el.logoModeRadios).forEach((r) => {
    r.checked = (r.value === kind);
  });
}

// ロゴタブのヒント表示（type: '' | 'success' | 'error'）
function setLogoHint(message, type) {
  if (!el.logoHint) return;
  el.logoHint.textContent = message || '';
  el.logoHint.classList.remove('settings-hint--success', 'settings-hint--error');
  if (type === 'success') el.logoHint.classList.add('settings-hint--success');
  else if (type === 'error') el.logoHint.classList.add('settings-hint--error');
}

// モード変更ハンドラ（ラジオ操作 or 「画像を選ぶ」直押）
async function handleLogoModeChange(value) {
  if (!window.api?.logo) {
    setLogoHint('IPC が利用できません', 'error');
    return;
  }
  if (value === 'custom') {
    const result = await window.api.logo.selectFile();
    if (!result?.ok) {
      // キャンセル時は「元のラジオ」に戻す（モード変更しない）
      syncLogoModeRadioFromState();
      if (result?.error && result.error !== 'canceled') {
        setLogoHint(result.message || '失敗しました', 'error');
      } else {
        setLogoHint('', '');
      }
      return;
    }
    applyLogo({ kind: 'custom', customPath: result.customPath });
    syncLogoModeRadioFromState();
    setLogoHint('カスタムロゴを設定しました', 'success');
  } else {
    const result = await window.api.logo.setMode(value);
    if (!result?.ok) {
      setLogoHint('変更に失敗しました', 'error');
      syncLogoModeRadioFromState();
      return;
    }
    applyLogo({ kind: value, customPath: null });
    syncLogoModeRadioFromState();
    setLogoHint('変更しました', 'success');
  }
}

// メイン画面ロゴクリック → 設定ダイアログ「ロゴ」タブを開く
function openLogoTab() {
  if (typeof el.settingsDialog?.showModal !== 'function') return;
  activateSettingsTab('logo');
  if (!el.settingsDialog.open) el.settingsDialog.showModal();
}

// イベントバインド（DOM が存在する時のみ）
if (el.clockLogo) {
  el.clockLogo.addEventListener('click', openLogoTab);
  el.clockLogo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openLogoTab();
    }
  });
}
if (el.logoModeRadios) {
  Array.from(el.logoModeRadios).forEach((r) => {
    r.addEventListener('change', (e) => {
      if (e.target.checked) handleLogoModeChange(e.target.value);
    });
  });
}
if (el.logoSelectFileBtn) {
  el.logoSelectFileBtn.addEventListener('click', () => handleLogoModeChange('custom'));
}

// ===== STEP 3b: トーナメントエディタ =====

// STEP 10 フェーズB / fix5: ゲーム種ドロップダウン変更時のハンドリング
//   - 構造型が同じ場合（例 NLH ↔ PLO）: 無音でブラインド構造を流用（ラベルのみ更新）
//   - 構造型が違う場合（例 NLH → Stud）:
//       fix5 仕様: 編集中（dirty）なら確認ダイアログ。OK か非 dirty なら、その構造型のデフォルト同梱
//                 フォーマットを自動ロードして editor の出発点とする（雛形提示）。
//   ここではエディタ内の draft / フォーム値までを更新。永続化はトーナメント「保存」ボタン押下時に既存ロジック経由
async function handleTournamentGameTypeChange(newGameType) {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B5: hall はゲームタイプ変更不可
  const oldGameType = tournamentState.gameType || 'nlh';
  if (newGameType === oldGameType) return;
  // STEP 10 フェーズC.2.3: 「その他」選択時はカスタム名入力欄を表示
  if (el.tournamentCustomGameWrapper) {
    el.tournamentCustomGameWrapper.hidden = (newGameType !== 'other');
  }
  const oldStructureType = getStructureTypeForGameRenderer(oldGameType);
  const newStructureType = getStructureTypeForGameRenderer(newGameType);

  if (oldStructureType === newStructureType) {
    // 流用、ダイアログなし、無音切替
    tournamentState.gameType = newGameType;
    if (el.eventGameType) {
      el.eventGameType.textContent = GAME_TYPE_LABEL[newGameType] || '';
    }
    // STEP 10 フェーズB.fix1: テーブル列ラベル不変のため renderBlindsTable() 不要
    // STEP 10 フェーズB.fix3: メイン画面再描画は applyTournament 経由（保存時）
    return;
  }

  // 構造型違い: 編集中の変更がある場合のみ確認ダイアログ
  if (blindsEditor.draft && blindsEditor.isDirty) {
    const ok = window.confirm(
      `編集中の変更を捨てて、${GAME_TYPE_LABEL[newGameType] || newGameType}用の標準フォーマットに切り替えますか？`
    );
    if (!ok) {
      if (el.tournamentGameType) el.tournamentGameType.value = oldGameType;
      return;
    }
  }

  // STEP 10 フェーズB.fix5: 該当構造型のデフォルト同梱フォーマットを自動ロード（雛形提示）
  const defaultPresetId = getDefaultPresetIdForStructure(newStructureType);

  tournamentState.gameType = newGameType;
  tournamentState.blindPresetId = defaultPresetId;
  if (el.eventGameType) el.eventGameType.textContent = GAME_TYPE_LABEL[newGameType] || '';

  // 構造型違いに伴いブラインド構造ドロップダウンの選択肢を再構築（フィルタ適用）
  try { await populateTournamentBlindPresets(); } catch (_) { /* 続行 */ }
  if (el.tournamentBlindPreset) el.tournamentBlindPreset.value = defaultPresetId;

  // editor の draft を新フォーマットでロード
  try {
    const preset = await window.api?.presets?.loadBuiltin?.(defaultPresetId);
    if (preset) {
      blindsEditor.draft = cloneStructure(preset);
      blindsEditor.draft.levels = renumberLevels(blindsEditor.draft.levels);
      blindsEditor.meta = { id: preset.id, name: preset.name, builtin: true };
      if (el.presetSelect) el.presetSelect.value = preset.id;
      if (el.presetName) el.presetName.value = preset.name;
      setDirty(false);
      // ブラインドタブ用ドロップダウンも構造型フィルタ反映
      try { await refreshPresetList(); } catch (_) { /* 続行 */ }
      renderBlindsTable();
      updatePresetActions();

      // ★ STEP 10 フェーズB.fix9 Fix 2: タイマー idle 時のみ active 構造も即座に切り替える ★
      //   - idle なら setStructure 実行で BLINDS カードに即時反映
      //   - running/paused 時は触らない（fix9）+ STEP 10 フェーズC.2 中 3: 警告ヒント表示
      const { status, currentLevelIndex } = getState();
      if (status === States.IDLE) {
        try {
          setStructure(cloneStructure(preset));   // active 構造を切替
          renderCurrentLevel(currentLevelIndex || 0);
          renderNextLevel(currentLevelIndex || 0);
        } catch (err2) {
          console.warn('idle 時 active 構造切替失敗:', err2);
        }
      } else {
        // STEP 10 フェーズC.2 中 3: running/paused 時、editor と main の表示乖離をユーザーに警告
        setTournamentHint(
          'タイマー進行中のためメイン画面には反映されていません。「保存して適用」で反映してください',
          'error'
        );
        setTimeout(() => setTournamentHint(''), 4000);
      }
    }
  } catch (err) {
    console.warn('構造型変更時のフォーマットロード失敗:', err);
  }

  setBlindsHint(
    `${GAME_TYPE_LABEL[newGameType] || newGameType}用の標準フォーマットに切り替えました。編集後は別名で保存してください。`,
    'success'
  );
}

// ドロップダウン change イベント登録（DOM 存在時のみ）
if (el.tournamentGameType) {
  el.tournamentGameType.addEventListener('change', (e) => {
    handleTournamentGameTypeChange(e.target.value).catch((err) => {
      console.warn('handleTournamentGameTypeChange 失敗:', err);
    });
  });
}

function syncTournamentFormFromState() {
  if (!el.tournamentTitle) return;
  // STEP 10 フェーズB.fix9: 入力中ならフォーム上書きをスキップ（打鍵中の文字消失防止）
  //   ユーザーがタイトル/サブタイトル/数値欄を入力中、別の経路で本関数が呼ばれてもフォーム値は維持される。
  //   フォーカスを外せば次回呼び出しで同期される（race-safe）。
  if (isUserTypingInInput()) return;
  el.tournamentTitle.value = tournamentState.title || '';
  el.tournamentSubtitle.value = tournamentState.subtitle || '';
  el.tournamentCurrency.value = tournamentState.currencySymbol || '¥';
  // STEP 6: 拡張フィールド
  if (el.tournamentGameType)        el.tournamentGameType.value        = tournamentState.gameType || 'nlh';
  if (el.tournamentStartingStack)   el.tournamentStartingStack.value   = String(tournamentState.startingStack ?? 10000);
  if (el.tournamentBuyinFee)        el.tournamentBuyinFee.value        = String(tournamentState.buyIn?.fee ?? 0);
  if (el.tournamentBuyinChips)      el.tournamentBuyinChips.value      = String(tournamentState.buyIn?.chips ?? 0);
  // STEP 6.9: rebuy → reentry リネーム
  if (el.tournamentReentryFee)      el.tournamentReentryFee.value      = String(tournamentState.reentry?.fee ?? 0);
  if (el.tournamentReentryChips)    el.tournamentReentryChips.value    = String(tournamentState.reentry?.chips ?? 0);
  if (el.tournamentAddonFee)        el.tournamentAddonFee.value        = String(tournamentState.addOn?.fee ?? 0);
  if (el.tournamentAddonChips)      el.tournamentAddonChips.value      = String(tournamentState.addOn?.chips ?? 0);
  // STEP 6.9: 特殊スタック フォーム
  const ss = tournamentState.specialStack || { enabled: false, label: '早期着席特典', chips: 5000, appliedCount: 0 };
  if (el.tournamentSpecialStackEnabled) el.tournamentSpecialStackEnabled.checked = !!ss.enabled;
  if (el.tournamentSpecialStackLabel)   el.tournamentSpecialStackLabel.value     = ss.label || '';
  if (el.tournamentSpecialStackChips)   el.tournamentSpecialStackChips.value     = String(ss.chips ?? 5000);
  if (el.tournamentSpecialStackCount)   el.tournamentSpecialStackCount.value     = String(ss.appliedCount ?? 0);
  applySpecialStackEnabledState();
  // STEP 6.5
  if (el.tournamentGuarantee)       el.tournamentGuarantee.value       = String(tournamentState.guarantee ?? 0);
  if (el.tournamentPayoutRounding)  el.tournamentPayoutRounding.value  = String(tournamentState.payoutRounding ?? 100);
  // STEP 6.7
  if (el.tournamentPrizeCategory)   el.tournamentPrizeCategory.value   = tournamentState.prizeCategory || '';
  // STEP 10 フェーズC.2.3: customGameName / pauseAfterBreak フォーム同期
  if (el.tournamentCustomGame)        el.tournamentCustomGame.value        = tournamentState.customGameName || '';
  if (el.tournamentPauseAfterBreak)   el.tournamentPauseAfterBreak.checked = !!tournamentState.pauseAfterBreak;
  // 「その他」選択時のみカスタム名入力欄を表示
  if (el.tournamentCustomGameWrapper) {
    el.tournamentCustomGameWrapper.hidden = (tournamentState.gameType !== 'other');
  }
  updateTitleCounter();
  updateSubtitleCounter();
  // STEP 6.17: タイトル色 UI 同期（プリセットの選択ハイライト + カラーピッカー値）
  syncTitleColorPicker();
  // 入力モードは常に % をデフォルトに戻す（保存値ではない、UI 状態）
  payoutInputMode = 'percent';
  if (el.tournamentPayoutMode) {
    const radios = el.tournamentPayoutMode.querySelectorAll('input[name="payout-mode"]');
    for (const r of radios) r.checked = (r.value === 'percent');
  }
  // 賞金構造エディタの再構築
  renderPayoutsEditor(tournamentState.payouts || []);
  // ブラインド構造プルダウンを最新の同梱+ユーザー一覧で再構築（タブ表示時に毎回呼ぶ）
  populateTournamentBlindPresets();
  // トーナメント一覧を再構築（タブ表示時に最新化）
  populateTournamentList();
  setTournamentHint('');
}

// ===== STEP 6: 賞金構造エディタ =====

// 入力値の合計を計算 + 100% / プール合致 のバリデーション表示
// %モード: 合計が 100% でなければ NG
// 金額モード: 合計が pool 以下なら OK（pool は editor 上のプール額をフォーム値から計算）
function updatePayoutsSum() {
  if (!el.tournamentPayoutsEditor || !el.tournamentPayoutsSum) return 0;
  const inputs = el.tournamentPayoutsEditor.querySelectorAll('.payouts-editor__pct-input');
  let sum = 0;
  for (const inp of inputs) sum += Number(inp.value) || 0;
  if (payoutInputMode === 'amount') {
    const pool = computeTotalPoolFromForm();
    const rounded = Math.round(sum);
    if (pool > 0 && Math.abs(rounded - pool) < 1) {
      el.tournamentPayoutsSum.textContent = `合計: ${formatNumber(rounded)} / プール ${formatNumber(pool)} ✓`;
      el.tournamentPayoutsSum.classList.remove('is-invalid');
    } else if (pool > 0 && rounded < pool) {
      el.tournamentPayoutsSum.textContent = `合計: ${formatNumber(rounded)} / プール ${formatNumber(pool)}（不足）`;
      el.tournamentPayoutsSum.classList.add('is-invalid');
    } else {
      el.tournamentPayoutsSum.textContent = `合計: ${formatNumber(rounded)} / プール ${formatNumber(pool)}（超過）`;
      el.tournamentPayoutsSum.classList.add('is-invalid');
    }
    return rounded;
  }
  // % モード（既存）
  const rounded = Math.round(sum * 100) / 100;
  if (Math.abs(rounded - 100) < 0.01) {
    el.tournamentPayoutsSum.textContent = `合計: ${rounded}% ✓`;
    el.tournamentPayoutsSum.classList.remove('is-invalid');
  } else {
    el.tournamentPayoutsSum.textContent = `合計: ${rounded}%（100% にしてください）`;
    el.tournamentPayoutsSum.classList.add('is-invalid');
  }
  return rounded;
}

// 編集中フォームからプール額を計算（プレイヤー人数は runtime を使う）
// 金額モードでの合計バリデーションと、% → 金額換算の表示で使用
function computeTotalPoolFromForm() {
  const num = (e, def) => {
    const n = Number(e?.value);
    return Number.isFinite(n) && n >= 0 ? n : def;
  };
  const buyInFee   = num(el.tournamentBuyinFee,   tournamentState.buyIn?.fee   ?? 0);
  // STEP 6.9: rebuy → reentry
  const reentryFee = num(el.tournamentReentryFee, tournamentState.reentry?.fee ?? 0);
  const addOnFee   = num(el.tournamentAddonFee,   tournamentState.addOn?.fee   ?? 0);
  const guarantee  = num(el.tournamentGuarantee,  tournamentState.guarantee    ?? 0);
  const calc = buyInFee   * tournamentRuntime.playersInitial
             + reentryFee * tournamentRuntime.reentryCount
             + addOnFee   * tournamentRuntime.addOnCount;
  return Math.max(calc, guarantee);
}

// 賞金構造エディタを描画（モードに応じて %値 or 金額値 を入力欄に流す）
function renderPayoutsEditor(payouts) {
  if (!el.tournamentPayoutsEditor) return;
  // STEP 10 フェーズC.2 Fix 0: 入力中なら payouts editor の再構築をスキップ。
  //   各行 input にフォーカスがある状態で innerHTML='' すると入力中の値が消える。
  if (isUserTypingInInput()) return;
  el.tournamentPayoutsEditor.innerHTML = '';
  const pool = (payoutInputMode === 'amount') ? computeTotalPoolFromForm() : 0;
  payouts.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'payouts-editor__row';
    const rank = document.createElement('span');
    rank.className = 'payouts-editor__rank';
    rank.textContent = `${p.rank}位`;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'payouts-editor__pct-input';
    input.min = '0';
    if (payoutInputMode === 'amount') {
      input.step = '100';
      input.value = String(Math.floor(pool * (Number(p.percentage) || 0) / 100));
    } else {
      input.max = '100';
      input.step = '0.5';
      input.value = String(p.percentage ?? 0);
    }
    input.addEventListener('input', updatePayoutsSum);
    row.append(rank, input);
    el.tournamentPayoutsEditor.append(row);
  });
  // 順位数プルダウンを現在の長さに同期
  if (el.tournamentPayoutCount) {
    const opts = Array.from(el.tournamentPayoutCount.options).map((o) => Number(o.value));
    const target = payouts.length;
    el.tournamentPayoutCount.value = opts.includes(target) ? String(target) : '3';
  }
  updatePayoutsSum();
}

// 配列を合計100%に正規化（誤差±0.01 以内）。1位に余りを上乗せして整える。
function normalizeToHundred(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const cleaned = arr.map((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  const sum = cleaned.reduce((s, v) => s + v, 0);
  if (sum <= 0) {
    // 全 0 → 等分配
    const base = Math.round((100 / cleaned.length) * 100) / 100;
    const out = cleaned.map(() => base);
    out[0] = Math.round((100 - base * (out.length - 1)) * 100) / 100;
    return out;
  }
  // 100/sum でスケール、小数点 2 位で丸め
  const scaled = cleaned.map((v) => Math.round((v * 100 / sum) * 100) / 100);
  const newSum = scaled.reduce((s, v) => s + v, 0);
  const remainder = Math.round((100 - newSum) * 100) / 100;
  scaled[0] = Math.round((scaled[0] + remainder) * 100) / 100;
  return scaled;
}

// 順位数を変更（プルダウン or プリセット適用）
// STEP 6.6: 上限 9 → 30 に拡張、プリセットは合計 100% 正規化を必須化
function setPayoutRankCount(n, applyPreset = false) {
  const count = Math.max(1, Math.min(30, Math.floor(Number(n) || 1)));
  let percentages;
  if (PAYOUT_PRESETS[count]) {
    percentages = normalizeToHundred(PAYOUT_PRESETS[count].slice());
  } else {
    // プリセット未定義（例: count=4, 6, 7, 8, 10〜14, 16〜19, 21〜29）→ 等分配
    const base = Math.round((100 / count) * 100) / 100;
    percentages = Array(count).fill(base);
    percentages[0] = Math.round((100 - base * (count - 1)) * 100) / 100;
  }
  const next = percentages.map((pct, i) => ({ rank: i + 1, percentage: pct }));
  renderPayoutsEditor(next);
}

// フォームから現在の賞金構造を取り出す（内部スキーマは常に %）
// 金額モードの場合: 各順位の入力金額 ÷ プール × 100 で % へ換算して保存
function readPayoutsFromForm() {
  if (!el.tournamentPayoutsEditor) return tournamentState.payouts || [];
  const rows = el.tournamentPayoutsEditor.querySelectorAll('.payouts-editor__row');
  const out = [];
  if (payoutInputMode === 'amount') {
    const pool = computeTotalPoolFromForm();
    rows.forEach((row, i) => {
      const inp = row.querySelector('.payouts-editor__pct-input');
      const amt = Number(inp?.value) || 0;
      const pct = pool > 0 ? Number((amt / pool * 100).toFixed(2)) : 0;
      out.push({ rank: i + 1, percentage: pct });
    });
  } else {
    rows.forEach((row, i) => {
      const inp = row.querySelector('.payouts-editor__pct-input');
      out.push({ rank: i + 1, percentage: Number(inp?.value) || 0 });
    });
  }
  return out;
}

// 順位数プルダウン: 値変更 → エディタ再構築（プリセットは「適用」ボタンで明示）
el.tournamentPayoutCount?.addEventListener('change', () => {
  const n = Number(el.tournamentPayoutCount.value) || 3;
  // 既存の入力値を活かしつつ count に合わせて伸縮
  const current = readPayoutsFromForm();
  let next;
  if (current.length === n) {
    next = current;
  } else if (current.length < n) {
    // 不足分は 0% で追加
    next = [...current, ...Array(n - current.length).fill(0).map((_, i) => ({ rank: current.length + i + 1, percentage: 0 }))];
  } else {
    next = current.slice(0, n).map((p, i) => ({ rank: i + 1, percentage: p.percentage }));
  }
  renderPayoutsEditor(next);
});

el.tournamentPayoutPreset?.addEventListener('click', () => {
  const n = Number(el.tournamentPayoutCount?.value) || 3;
  setPayoutRankCount(n, true);
});

// STEP 6.5: 入力モード切替（% / 金額）
el.tournamentPayoutMode?.addEventListener('change', (event) => {
  const target = event.target;
  if (!target || target.name !== 'payout-mode') return;
  // 切替前に現在の入力値を % に正規化（金額モードからの切替なら換算）してから再描画
  const currentPayouts = readPayoutsFromForm();
  payoutInputMode = (target.value === 'amount') ? 'amount' : 'percent';
  renderPayoutsEditor(currentPayouts);
});

// STEP 6.5: GTD / 端数 / バイインフィー等が変わったら、金額モード表示を即時再描画
function rerenderPayoutsEditorIfNeeded() {
  if (payoutInputMode === 'amount' && el.tournamentPayoutsEditor) {
    // 現在の % を保持して金額表示だけ再計算（プール額が変わったため）
    renderPayoutsEditor(readPayoutsFromFormAsPercent());
  } else {
    updatePayoutsSum();
  }
}

// 金額モード時でも、内部 % で取り出すヘルパ（再描画用）
function readPayoutsFromFormAsPercent() {
  const rows = el.tournamentPayoutsEditor?.querySelectorAll('.payouts-editor__row') || [];
  const pool = computeTotalPoolFromForm();
  const out = [];
  rows.forEach((row, i) => {
    const inp = row.querySelector('.payouts-editor__pct-input');
    if (payoutInputMode === 'amount') {
      const amt = Number(inp?.value) || 0;
      const pct = pool > 0 ? Number((amt / pool * 100).toFixed(2)) : 0;
      out.push({ rank: i + 1, percentage: pct });
    } else {
      out.push({ rank: i + 1, percentage: Number(inp?.value) || 0 });
    }
  });
  return out;
}

// STEP 6.9: rebuy → reentry リネーム
['tournamentGuarantee','tournamentBuyinFee','tournamentReentryFee','tournamentAddonFee'].forEach((key) => {
  el[key]?.addEventListener('input', rerenderPayoutsEditorIfNeeded);
});

el.tournamentPayoutRounding?.addEventListener('change', () => {
  // メイン画面の PAYOUTS は保存時に反映されるので、エディタ自体は再描画不要
  // ただし金額モードの合計が丸めの影響を受ける場合に備えて再描画
  rerenderPayoutsEditorIfNeeded();
});

// ===== STEP 3b 拡張: 複数トーナメント管理 =====

// 一覧を読み込んで <select>（互換用）+ 状態付きリスト両方を再構築 + 削除ボタン活性制御
async function populateTournamentList() {
  if (!window.api?.tournaments) return;
  let list = [];
  try {
    list = await window.api.tournaments.list() || [];
  } catch (err) {
    console.warn('トーナメント一覧取得失敗:', err);
  }
  // 互換用 <select>（hidden だが値は維持）
  if (el.tournamentSelect) {
    el.tournamentSelect.innerHTML = '';
    for (const t of list) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name || '(無題)';
      el.tournamentSelect.appendChild(opt);
    }
    if (tournamentState.id) el.tournamentSelect.value = tournamentState.id;
  }
  // STEP 6.21: 構造化リストを再描画
  await renderTournamentList(list);
  // STEP 7.x ③-a: ヘッダーの el.tournamentDelete は撤去済。各行 🗑 ボタンの disabled 制御は
  //               renderTournamentList → buildTournamentListItem 内で list.length <= 1 を渡して制御
  // STEP 6.7: 保存数表示「保存中: N/100 件」、上限到達時は赤字
  if (el.tournamentCount) {
    el.tournamentCount.textContent = `保存中: ${list.length}/${MAX_TOURNAMENTS} 件`;
    el.tournamentCount.classList.toggle('is-limit', list.length >= MAX_TOURNAMENTS);
  }
  // 100件到達時は新規・複製を非活性
  const atLimit = list.length >= MAX_TOURNAMENTS;
  if (el.tournamentNew)       el.tournamentNew.disabled       = atLimit;
  if (el.tournamentDuplicate) el.tournamentDuplicate.disabled = atLimit;
}

// STEP 6.21: 状態バッジ + 経過情報 + 操作ボタン付きリストを描画
//   状態は各トーナメントの保存済み timerState から判定。アクティブのみ生きた timer.js から上書き
function formatLevelTime(elapsedSec) {
  const sec = Math.max(0, Math.floor(elapsedSec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function renderTournamentList(prefetched) {
  if (!el.tournamentList) return;
  // STEP 6.21.4.2 / STEP 10 フェーズB.fix9: 入力中スキップ。統一ヘルパに置換。
  // 1秒ごとの自動再描画で focus/打鍵イベントが奪われる現象を原理的に防止。
  if (isUserTypingInInput()) return;
  let list = prefetched;
  if (!Array.isArray(list)) {
    try { list = await window.api?.tournaments?.list() || []; } catch (_) { list = []; }
  }
  el.tournamentList.innerHTML = '';
  for (const t of list) {
    const isActive = (t.id === tournamentState.id);
    let ts;
    if (isActive) {
      // アクティブはライブの timer.js 状態（毎フレーム更新される）
      ts = captureCurrentTimerState();
    } else {
      // STEP 6.21.2: 非アクティブは store の値 + 時刻計算で live を導出（並行進行）
      const stored = t.timerState || { status: 'idle', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: null };
      const levels = await getCachedLevels(t.blindPresetId);
      ts = (levels && stored.status === 'running')
        ? computeLiveTimerState(stored, levels)
        : stored;
    }
    // STEP 7.x ③-e: list.length を渡して、最後の1件は🗑ボタンを disabled に
    el.tournamentList.appendChild(buildTournamentListItem(t, ts, isActive, list.length));
  }
}

function buildTournamentListItem(t, ts, isActive, listLength = 99) {
  const li = document.createElement('li');
  li.className = 'tournament-list__item';
  if (isActive) li.classList.add('is-active');

  const badge = document.createElement('span');
  badge.className = 'tournament-status-badge';
  // STEP 6.21.3: PRE_START（カウントダウン中）は active 行のみ表示を Lv 0 に差し替える
  // store のデータ（currentLevel: 1）には触らず、UI 表示だけを変える。
  // 非 active では PRE_START は発生しない（PRE_START は timer.js のローカル状態のため）
  const isPreStart = isActive && (getState().status === States.PRE_START);
  const displayLevel = isPreStart ? 0 : ts.currentLevel;
  if (ts.status === 'running') {
    badge.classList.add('is-running');
    badge.textContent = `実行中 Lv${displayLevel} / ${formatLevelTime(ts.elapsedSecondsInLevel)}`;
  } else if (ts.status === 'paused') {
    badge.classList.add('is-paused');
    badge.textContent = `一時停止中 Lv${displayLevel} / ${formatLevelTime(ts.elapsedSecondsInLevel)}`;
  } else {
    badge.textContent = '未開始';
  }
  li.appendChild(badge);

  const name = document.createElement('span');
  name.className = 'tournament-list__name';
  name.textContent = t.name || '(無題)';
  li.appendChild(name);

  const actions = document.createElement('div');
  actions.className = 'tournament-list__actions';

  // 一時停止 / 再開 ボタン
  if (ts.status === 'running' || ts.status === 'paused') {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tournament-list__btn';
    toggle.textContent = (ts.status === 'running') ? '一時停止' : '再開';
    toggle.addEventListener('click', () => handleTournamentListToggle(t.id, ts.status));
    actions.appendChild(toggle);

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'tournament-list__btn';
    reset.textContent = 'リセット';
    reset.addEventListener('click', () => handleTournamentListReset(t.id, t.name));
    actions.appendChild(reset);
  }

  // 選択 ボタン（既にアクティブなら非表示）
  if (!isActive) {
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'tournament-list__btn is-primary';
    select.textContent = '選択';
    select.addEventListener('click', () => handleTournamentListSelect(t.id));
    actions.appendChild(select);
  }

  // STEP 7.x ③-b/c/e: 各行右端の🗑削除ボタン
  // - listLength <= 1 のとき disabled（最後の1件は削除不可、main.js IPC ガードと整合）
  // - click で stopPropagation → 行クリックの暴発抑止 + 削除確認ダイアログ
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'tournament-list__delete-btn';
  delBtn.textContent = '🗑';
  delBtn.setAttribute('aria-label', '削除');
  if (listLength <= 1) {
    delBtn.disabled = true;
    delBtn.title = '最後の1件は削除できません';
  }
  delBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    handleTournamentRowDelete(t.id, t.name);
  });
  actions.appendChild(delBtn);

  li.appendChild(actions);
  return li;
}

// 一覧の「一時停止 / 再開」ボタン: アクティブなら timer.js を直接操作、
// 非アクティブは並行進行モデルで rebase してトグル（startedAt / elapsedSecondsInLevel を正しく更新）
// STEP 6.21.2: 「裏で再開」が実際に時間を進める仕様（問題3対応）
async function handleTournamentListToggle(id, currentStatus) {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B5: hall はリスト操作不可
  const isActive = (id === tournamentState.id);
  if (isActive) {
    if (currentStatus === 'running') timerPause();
    else timerResume();
    return;
  }
  // 非アクティブ: list から live state を rebase してトグル
  let list = [];
  try { list = await window.api.tournaments.list() || []; } catch (_) { return; }
  const t = list.find((x) => x.id === id);
  if (!t || !t.timerState) return;
  const levels = await getCachedLevels(t.blindPresetId);
  const live = (levels && t.timerState.status === 'running')
    ? computeLiveTimerState(t.timerState, levels)
    : t.timerState;
  const now = Date.now();
  let next;
  if (currentStatus === 'running') {
    // running → paused: 現在地で固定（startedAt クリア）
    next = { ...live, status: 'paused', startedAt: null, pausedAt: now };
  } else {
    // paused/idle → running: ここを起点に時刻計算開始
    next = { ...live, status: 'running', startedAt: now, pausedAt: null };
  }
  await window.api.tournaments.setTimerState(id, next);
  await renderTournamentList();
}

// 一覧の「リセット」ボタン: 確認 → idle 状態に戻す。アクティブなら timer.js も reset()
async function handleTournamentListReset(id, name) {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B5: hall はリスト操作不可
  if (!window.confirm(`「${name || '(無題)'}」のタイマーをリセットします。よろしいですか？`)) return;
  const idleState = { status: 'idle', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: null };
  await window.api.tournaments.setTimerState(id, idleState);
  if (id === tournamentState.id) timerReset();
  await renderTournamentList();
}

// 一覧の「選択」ボタン: handleTournamentSelectChange と同じ流れ
async function handleTournamentListSelect(id) {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B5: hall はリスト操作不可
  if (!el.tournamentSelect) return;
  el.tournamentSelect.value = id;
  await handleTournamentSelectChange();
}

// 指定 id のトーナメントをフォームへ流し込む（タイマーには触らない）
async function loadTournamentIntoForm(id) {
  if (!window.api?.tournaments) return;
  let list = [];
  try {
    list = await window.api.tournaments.list() || [];
  } catch (_) { /* ignore */ }
  const found = list.find((t) => t.id === id);
  if (!found) return;
  // tournamentState を更新（メイン画面表示も applyTournament で同期）
  applyTournament({ ...found, title: found.name });
  // STEP 10 フェーズB.fix9: 入力中ならフォーム上書きをスキップ（typing 中の文字消失防止）
  //   active 切替・新規作成・複製等の操作はユーザーがボタン/リスト項目をクリックした時点で
  //   focus がそこに移るため通常は false。typing 中に外部経路で呼ばれた race を救う。
  if (isUserTypingInInput()) return;
  // フォームへ反映
  el.tournamentTitle.value = found.name || '';
  el.tournamentSubtitle.value = found.subtitle || '';
  el.tournamentCurrency.value = found.currencySymbol || '¥';
  if (el.tournamentBlindPreset) {
    // ブラインド構造プルダウンも紐付けに切替（プリセット一覧は populateTournamentBlindPresets 済み前提）
    el.tournamentBlindPreset.value = found.blindPresetId || 'demo-fast';
  }
  // STEP 6: 拡張フィールドのフォーム反映（applyTournament で tournamentState は同期済）
  syncTournamentFormFromState();
  setTournamentHint('');
}

// セレクタ変更時: 切替前にフォーム値を保持中の active へ即時保存（編集中の値消失防止）し、
// 新しい id を active に設定してフォームへロード。
// STEP 6.21.2: 仕様b（並行進行） — 旧 active は running のまま継続、自動一時停止は撤廃。
//              旧 active の最新 live state を rebase で保存（startedAt = now）してから切替。
async function handleTournamentSelectChange() {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B5: hall はリスト操作不可
  if (!el.tournamentSelect || !window.api?.tournaments) return;
  const newId = el.tournamentSelect.value;
  if (!newId || newId === tournamentState.id) return;

  // STEP 10 フェーズC.2 中 2: 切替前に賞金 % 合計が不正なら確認ダイアログ
  //   現状の form の payouts が 100% でないまま silent save される問題（fix11 B-1）対策
  if (!isPayoutsValid()) {
    const ok = window.confirm(
      '現在のトーナメントの賞金合計が 100% ではありません。\nこのまま切り替えると不正な値で保存されます。続行しますか？'
    );
    if (!ok) {
      // キャンセル: dropdown 値を旧 active に戻す
      el.tournamentSelect.value = tournamentState.id;
      return;
    }
  }

  // 1) 旧アクティブの timerState を rebase 保存（running なら startedAt=now で時刻計算の起点を更新）
  //    ※ pause はしない（裏で running を継続させる）
  const prevId = tournamentState.id;
  try {
    const prevTimerState = captureCurrentTimerState();
    await window.api.tournaments.setTimerState(prevId, prevTimerState);
  } catch (err) {
    console.warn('切替前 timerState 保存失敗:', err);
  }

  // 2) 切替前のフォーム編集内容を保存（旧 active の id で）
  try {
    const current = readTournamentForm();
    current.id = prevId;
    await window.api.tournaments.save(current);
  } catch (err) {
    console.warn('切替前の自動保存に失敗:', err);
  }

  // 3) active 切替 + UI 反映
  try {
    const result = await window.api.tournaments.setActive(newId);
    if (result) applyTournament(result);
  } catch (err) {
    console.warn('active 切替失敗:', err);
  }
  await loadTournamentIntoForm(newId);

  // 4) 新アクティブの blind preset を適用してから timerState を復元（時刻計算で live 復元 + silent）
  await restoreActiveTimerStateFromStore(newId, { silent: true });
  await renderTournamentList();
}

// STEP 6.21 / 6.21.2: 指定 id の保存済み timerState を timer.js に復元する。
// blindPresetId に応じて構造を再ロードしてから computeLiveTimerState 経由で applyTimerStateToTimer を呼ぶ。
// opts.silent: true なら復元直後の音再生を抑止
async function restoreActiveTimerStateFromStore(id, opts = {}) {
  try {
    const list = await window.api.tournaments.list() || [];
    const found = list.find((t) => t.id === id);
    if (!found) return;
    // ブラインド構造を切替（必要時）
    let levels = null;
    if (found.blindPresetId) {
      const preset = await loadPresetById(found.blindPresetId);
      if (preset) {
        try { setStructure(preset); } catch (err) { console.warn('構造切替失敗:', err); }
        levels = preset.levels || null;
        if (levels) blindPresetCache.set(found.blindPresetId, levels);
      }
    }
    applyTimerStateToTimer(found.timerState, levels, { silent: !!opts.silent });
  } catch (err) {
    console.warn('timerState 復元失敗:', err);
  }
}

// 「新規」: 空テンプレートを作成して active に設定
// STEP 6.7: 100件上限チェック → 超過時はダイアログ警告
// STEP 10 フェーズC.1.1 Fix 7: ID 衝突防止ヘルパ。
//   旧: `tournament-${Date.now()}` は 1ms 以内連続作成で衝突可能性あり。
//   新: Date.now() + Math.random base36 6 文字 で約 16M 通りの衝突空間確保。
//   実用上 1ms 以内に複数作成は稀だが、defense in depth で完全衝突回避。
function generateUniqueId(prefix) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${prefix}-${ts}-${rand}`;
}

async function handleTournamentNew() {
  if (window.appRole === 'hall') return;   // v2.0.0 STEP 3: ホール側は新規作成不可
  if (!window.api?.tournaments) return;
  // STEP 10 フェーズC.2 軽 11: 連打ガード（async 中の重複実行で複数の新規が作られないよう）
  if (handleTournamentNew._inFlight) return;
  handleTournamentNew._inFlight = true;
  // STEP 10 フェーズC.1.1 Fix 2: トーナメント切替中は periodic persist を skip させる
  _tournamentSwitching = true;
  try {
    return await _handleTournamentNewImpl();
  } finally {
    handleTournamentNew._inFlight = false;
    _tournamentSwitching = false;
  }
}
async function _handleTournamentNewImpl() {
  if (!window.api?.tournaments) return;
  // 事前に件数チェック + 既存名の取得（連番採番に使う）
  let existingList = [];
  try {
    existingList = await window.api.tournaments.list() || [];
    if (existingList.length >= MAX_TOURNAMENTS) {
      window.alert(`トーナメントの保存数が上限（${MAX_TOURNAMENTS} 件）に達しています。\n不要なトーナメントを削除してから新規作成してください。`);
      setTournamentHint('上限到達のため新規作成できません', 'error');
      return;
    }
  } catch (_) { /* 続行 */ }
  // STEP 6.21.1: 旧 active が running 中の場合、新規作成前に pending 保存を中断 + timer.js を停止
  // → 旧 active の running 状態が新トーナメントへ漏出しないようにする（問題5の真因対策）
  cancelPendingTimerStatePersist();
  const newT = {
    // STEP 10 フェーズC.1.1 Fix 7: Date.now() のみでは 1ms 以内連続作成で衝突可能 → generateUniqueId で衝突回避
    id: generateUniqueId('tournament'),
    // STEP 6.21.1: 連番採番で重複回避
    name: generateUniqueTournamentName(existingList),
    subtitle: '',
    currencySymbol: tournamentState.currencySymbol || '¥',
    blindPresetId: el.tournamentBlindPreset?.value || tournamentState.blindPresetId || 'demo-fast',
    // STEP 6.21: 新規は idle 状態で開始
    timerState: { status: 'idle', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: null }
  };
  const result = await window.api.tournaments.save(newT);
  if (!result?.ok) {
    if (result?.error === 'limit-exceeded') {
      window.alert(result.message || `トーナメントは ${MAX_TOURNAMENTS} 件までです`);
      setTournamentHint('上限到達のため新規作成できません', 'error');
    } else {
      setTournamentHint('新規作成に失敗しました', 'error');
    }
    return;
  }
  await window.api.tournaments.setActive(newT.id);
  applyTournament(result.tournament);
  // STEP 6.21.1: 新 active 切替後に必ず timer.js を idle へリセット
  // → captureCurrentTimerState がライブで idle を返し、リスト UI に旧状態が映らない
  timerReset();
  cancelPendingTimerStatePersist();
  await populateTournamentList();
  el.tournamentSelect.value = newT.id;
  await loadTournamentIntoForm(newT.id);
  setTournamentHint('新規トーナメントを作成しました', 'success');
  setTimeout(() => setTournamentHint(''), 2000);
  // STEP 10 フェーズC.1.2-bugfix: 新規トーナメント作成後も blinds editor の readonly 状態を整合させる。
  //   meta.builtin === true 時は no-op、user preset 時のみ readonly クリア（過剰防御だが安全）。
  ensureEditorEditableState();
  // 名前欄に focus + select で即座に編集できるように
  if (el.tournamentTitle) {
    requestAnimationFrame(() => {
      el.tournamentTitle.focus();
      el.tournamentTitle.select();
      // STEP 10 フェーズC.1.4-fix1 Fix 5: C.1.4 で applyTournament が breakImagesState 反映 +
      //   renderBreakImagesList を呼ぶようになり、その経路で blinds editor の readonly 状態が
      //   再付与される race が観測された（前原さん実機）。RAF 内で再度 ensureEditorEditableState を
      //   呼び、すべての DOM 操作が落ち着いた最終状態で editable に保証する。
      ensureEditorEditableState();
    });
  }
}

// 「複製」: 現在のフォーム値を新 id でコピー
// STEP 6.7: 100件上限チェック
async function handleTournamentDuplicate() {
  if (window.appRole === 'hall') return;   // v2.0.0 STEP 3: ホール側は複製不可
  if (!window.api?.tournaments) return;
  // v2.0.4 D-1 fix: 連打ガード（async 中の重複実行で複数の複製が作られないよう、
  //   handleTournamentNew と同じ _inFlight パターンを適用）
  if (handleTournamentDuplicate._inFlight) return;
  handleTournamentDuplicate._inFlight = true;
  // STEP 10 フェーズC.1.1 Fix 2: 複製も active 切替を伴うため periodic skip（finally で確実解除）
  _tournamentSwitching = true;
  try {
    return await _handleTournamentDuplicateImpl();
  } finally {
    handleTournamentDuplicate._inFlight = false;
    _tournamentSwitching = false;
  }
}
async function _handleTournamentDuplicateImpl() {
  try {
    const list = await window.api.tournaments.list() || [];
    if (list.length >= MAX_TOURNAMENTS) {
      window.alert(`トーナメントの保存数が上限（${MAX_TOURNAMENTS} 件）に達しています。\n不要なトーナメントを削除してから複製してください。`);
      setTournamentHint('上限到達のため複製できません', 'error');
      return;
    }
  } catch (_) { /* 続行 */ }
  // STEP 6.21.1: 旧 active の running 状態漏出を防ぐため pending 保存を中断
  cancelPendingTimerStatePersist();
  // STEP 10 フェーズB.fix11 シナリオ B-3 修正:
  //   旧実装は name/subtitle/currencySymbol/blindPresetId の 4 項目しか複製しておらず、
  //   gameType/buyIn/reentry/addOn/payouts/specialStack/guarantee/payoutRounding/prizeCategory/titleColor/startingStack
  //   が main.js の normalizeTournament でデフォルト値に reset されていた（複製機能の期待値違反）。
  //   readTournamentForm() の全フィールドを spread してから id / name / timerState / title だけ上書きする。
  const current = readTournamentForm();
  const cloned = {
    ...current,
    // STEP 10 フェーズC.1.1 Fix 7: ID 衝突防止
    id: generateUniqueId('tournament'),
    name: `${current.name || '無題'}（コピー）`,
    title: undefined,   // 旧コード互換 alias は捨てる（normalizeTournament が name から再導出）
    // STEP 6.21: 複製も idle で開始（経過時間を引き継がない）
    timerState: { status: 'idle', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: null }
  };
  delete cloned.title;
  const result = await window.api.tournaments.save(cloned);
  if (!result?.ok) {
    if (result?.error === 'limit-exceeded') {
      window.alert(result.message || `トーナメントは ${MAX_TOURNAMENTS} 件までです`);
      setTournamentHint('上限到達のため複製できません', 'error');
    } else {
      setTournamentHint('複製に失敗しました', 'error');
    }
    return;
  }
  await window.api.tournaments.setActive(cloned.id);
  applyTournament(result.tournament);
  // STEP 6.21.1: timer.js も idle へリセット（旧 active の状態を新行に映さない）
  timerReset();
  cancelPendingTimerStatePersist();
  await populateTournamentList();
  el.tournamentSelect.value = cloned.id;
  await loadTournamentIntoForm(cloned.id);
  setTournamentHint('トーナメントを複製しました', 'success');
  setTimeout(() => setTournamentHint(''), 2000);
  if (el.tournamentTitle) {
    requestAnimationFrame(() => {
      el.tournamentTitle.focus();
      el.tournamentTitle.select();
    });
  }
}

// STEP 7.x ③-d: トーナメント削除確認ダイアログ（Promise ベース、Esc → cancel 紐付け）
let _tournamentDeleteHandlers = null;
function showTournamentDeleteConfirm(name) {
  return new Promise((resolve) => {
    if (!el.tournamentDeleteDialog) { resolve(false); return; }
    if (el.tournamentDeleteName) el.tournamentDeleteName.textContent = name || '(無題)';
    if (_tournamentDeleteHandlers) {
      el.tournamentDeleteOk?.removeEventListener('click', _tournamentDeleteHandlers.ok);
      el.tournamentDeleteCancel?.removeEventListener('click', _tournamentDeleteHandlers.cancel);
      el.tournamentDeleteDialog.removeEventListener('cancel', _tournamentDeleteHandlers.escCancel);
    }
    const close = () => el.tournamentDeleteDialog.close?.();
    const onOk     = () => { close(); resolve(true); };
    const onCancel = () => { close(); resolve(false); };
    const onEscCancel = () => { resolve(false); };  // Esc キー
    _tournamentDeleteHandlers = { ok: onOk, cancel: onCancel, escCancel: onEscCancel };
    el.tournamentDeleteOk?.addEventListener('click', onOk);
    el.tournamentDeleteCancel?.addEventListener('click', onCancel);
    el.tournamentDeleteDialog.addEventListener('cancel', onEscCancel);
    el.tournamentDeleteDialog.showModal?.();
  });
}

// STEP 7.x ③-c: 各行🗑ボタンクリック時のハンドラ。引数で id / name を受ける（行コンテキスト）
// STEP 10 フェーズC.2.7-audit-fix: 二重起動防止（ダイアログ表示中に他行の🗑連打しても無視）
let _tournamentDeleteInFlight = false;
async function handleTournamentRowDelete(id, name) {
  if (window.appRole === 'hall') return;   // v2.0.0 STEP 3: ホール側は削除不可
  if (!window.api?.tournaments) return;
  if (_tournamentDeleteInFlight) return;   // ダイアログまたは IPC 進行中
  _tournamentDeleteInFlight = true;
  try {
    const confirmed = await showTournamentDeleteConfirm(name);
    if (!confirmed) return;
    const result = await window.api.tournaments.delete(id);
    if (!result?.ok) {
      if (result?.error === 'last-tournament') {
        setTournamentHint('最後の1つは削除できません', 'error');
      } else {
        setTournamentHint('削除に失敗しました', 'error');
      }
      return;
    }
    // active が切り替わっている可能性 → 取得し直してフォームへ
    const active = await window.api.tournaments.getActive();
    if (active) {
      applyTournament(active);
      await populateTournamentList();
      await loadTournamentIntoForm(active.id);
    }
    setTournamentHint('削除しました', 'success');
    setTimeout(() => setTournamentHint(''), 2000);
  } finally {
    _tournamentDeleteInFlight = false;
  }
}

// ブラインド構造プルダウンを構築（同梱 + ユーザー作成、構造型フィルタ適用）
// STEP 10 フェーズB.fix5: 現在のゲーム種から導出される structureType と一致するプリセットだけを表示。
//   これでゲーム種=Stud のときに BLIND 型 demo-fast 等が誤選択される事故を防ぐ。
async function populateTournamentBlindPresets() {
  if (!el.tournamentBlindPreset || !window.api?.presets) return;
  // STEP 10 フェーズB.fix9: 入力中なら select 再構築をスキップ（select.innerHTML='' 経由でも focus 影響回避）
  if (isUserTypingInInput()) return;
  let builtin = [];
  let user = [];
  try {
    builtin = await window.api.presets.listBuiltin() || [];
    user = await window.api.presets.listUser() || [];
  } catch (err) {
    console.warn('プリセット一覧取得失敗（トーナメントタブ）:', err);
  }
  // 構造型フィルタ
  const currentStructureType = getStructureTypeForGameRenderer(tournamentState.gameType || 'nlh');
  const matches = (p) => ((p.structureType || 'BLIND') === currentStructureType);
  const filteredBuiltin = builtin.filter(matches);
  const filteredUser = user.filter(matches);

  el.tournamentBlindPreset.innerHTML = '';
  if (filteredBuiltin.length > 0) {
    const og = document.createElement('optgroup');
    og.label = '同梱';
    for (const p of filteredBuiltin) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      og.appendChild(opt);
    }
    el.tournamentBlindPreset.appendChild(og);
  }
  if (filteredUser.length > 0) {
    const og = document.createElement('optgroup');
    og.label = 'ユーザー作成';
    for (const p of filteredUser) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      og.appendChild(opt);
    }
    el.tournamentBlindPreset.appendChild(og);
  }
  // 現在の選択状態を復元（フィルタ後に存在する場合のみ）
  if (tournamentState.blindPresetId
      && [...filteredBuiltin, ...filteredUser].some((p) => p.id === tournamentState.blindPresetId)) {
    el.tournamentBlindPreset.value = tournamentState.blindPresetId;
  }
}

function setTournamentHint(message, kind = '') {
  if (!el.tournamentHint) return;
  el.tournamentHint.textContent = message || '';
  el.tournamentHint.className = 'tournament-editor__hint';
  if (kind === 'error')   el.tournamentHint.classList.add('is-error');
  if (kind === 'success') el.tournamentHint.classList.add('is-success');
}

// トーナメントフォームの値を集約（保存・適用両方で使用）
// STEP 3b 拡張: name キーで返す（旧 title 互換のため title も併記）
function readTournamentForm() {
  const name = (el.tournamentTitle?.value || '').trim() || 'ポーカートーナメント';
  const num = (inputEl, fallback) => {
    const v = Number(inputEl?.value);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  return {
    id: tournamentState.id,
    name,
    title: name,   // 旧コード互換用エイリアス
    subtitle: el.tournamentSubtitle?.value || '',
    currencySymbol: (el.tournamentCurrency?.value || '').trim() || '¥',
    blindPresetId: el.tournamentBlindPreset?.value || tournamentState.blindPresetId,
    // STEP 6: 拡張フィールド
    gameType: el.tournamentGameType?.value || tournamentState.gameType || 'nlh',
    startingStack: num(el.tournamentStartingStack, tournamentState.startingStack ?? 10000),
    buyIn: {
      fee:   num(el.tournamentBuyinFee,   tournamentState.buyIn?.fee   ?? 0),
      chips: num(el.tournamentBuyinChips, tournamentState.buyIn?.chips ?? 0)
    },
    // STEP 6.9: rebuy → reentry
    reentry: {
      fee:   num(el.tournamentReentryFee,   tournamentState.reentry?.fee   ?? 0),
      chips: num(el.tournamentReentryChips, tournamentState.reentry?.chips ?? 0)
    },
    addOn: {
      fee:   num(el.tournamentAddonFee,   tournamentState.addOn?.fee   ?? 0),
      chips: num(el.tournamentAddonChips, tournamentState.addOn?.chips ?? 0)
    },
    // STEP 6.9: specialStack
    specialStack: {
      enabled: !!el.tournamentSpecialStackEnabled?.checked,
      label:  (el.tournamentSpecialStackLabel?.value || tournamentState.specialStack?.label || '早期着席特典').slice(0, 20),
      chips:  num(el.tournamentSpecialStackChips, tournamentState.specialStack?.chips ?? 5000),
      appliedCount: Math.max(0, Math.min(999, Math.floor(num(el.tournamentSpecialStackCount, tournamentState.specialStack?.appliedCount ?? 0))))
    },
    payouts: readPayoutsFromForm(),
    // STEP 6.5
    guarantee: num(el.tournamentGuarantee, tournamentState.guarantee ?? 0),
    payoutRounding: (() => {
      const n = Number(el.tournamentPayoutRounding?.value);
      return VALID_PAYOUT_ROUNDINGS_RENDERER.includes(n) ? n : (tournamentState.payoutRounding ?? 100);
    })(),
    // STEP 6.7
    prizeCategory: (el.tournamentPrizeCategory?.value || '').slice(0, 20),
    // STEP 6.17: タイトル色（fallback はステート値）
    titleColor: TITLE_COLOR_RE_RENDERER.test(tournamentState.titleColor || '') ? tournamentState.titleColor : '#FFFFFF',
    // STEP 10 フェーズC.2.3: customGameName / pauseAfterBreak
    customGameName: (el.tournamentCustomGame?.value || '').slice(0, 30),
    pauseAfterBreak: !!el.tournamentPauseAfterBreak?.checked
  };
}

// STEP 6.17: タイトル色ピッカーの UI 同期
function syncTitleColorPicker() {
  const cur = (tournamentState.titleColor || '#FFFFFF').toUpperCase();
  if (el.titleColorCustomInput) el.titleColorCustomInput.value = cur;
  if (!el.titleColorPicker) return;
  const swatches = el.titleColorPicker.querySelectorAll('.title-color-swatch');
  for (const sw of swatches) {
    const c = (sw.dataset.color || '').toUpperCase();
    sw.classList.toggle('is-selected', c === cur);
  }
}

// STEP 6.7 / 6.14 / 6.16: 中央列拡張で収容実測値が約22文字へ。閾値も再調整。
function updateTitleCounter() {
  if (!el.tournamentTitle || !el.tournamentTitleCounter) return;
  const len = el.tournamentTitle.value.length;
  el.tournamentTitleCounter.textContent = `${len} / 40`;
  el.tournamentTitleCounter.classList.toggle('is-warn', len > 22);
  if (len > 22) {
    el.tournamentTitleCounter.title = '約22文字を超えると画面で見切れる可能性があります。実機でご確認の上調整ください';
  } else {
    el.tournamentTitleCounter.title = '';
  }
}

// STEP 6.17: サブタイトル文字数カウンタ（約30文字超で警告）
function updateSubtitleCounter() {
  if (!el.tournamentSubtitle || !el.tournamentSubtitleCounter) return;
  const len = el.tournamentSubtitle.value.length;
  el.tournamentSubtitleCounter.textContent = `${len} / 60`;
  el.tournamentSubtitleCounter.classList.toggle('is-warn', len > 30);
  if (len > 30) {
    el.tournamentSubtitleCounter.title = '約30文字を超えると画面で見切れる可能性があります。実機でご確認の上調整ください';
  } else {
    el.tournamentSubtitleCounter.title = '';
  }
}

// 賞金構造の合計バリデーション（保存時のガード）
// % モード: 合計 100% ±0.01
// 金額モード: 合計 ≦ プール（プール 0 のときはスキップ＝OK扱い）
function isPayoutsValid() {
  const sum = updatePayoutsSum();
  if (payoutInputMode === 'amount') {
    const pool = computeTotalPoolFromForm();
    if (pool <= 0) return true;
    return Math.abs(sum - pool) < 1;
  }
  return Math.abs(sum - 100) < 0.01;
}

// 「保存」: 現在の active トーナメントへ上書き保存。タイマー無変更、メイン画面の表示のみ更新
async function handleTournamentSave() {
  if (window.appRole === 'hall') return;   // v2.0.0 STEP 3: ホール側は保存不可
  if (!el.tournamentTitle) return;
  if (!window.api?.tournaments?.save) {
    setTournamentHint('保存 API が利用できません', 'error');
    return;
  }
  if (!isPayoutsValid()) {
    setTournamentHint('賞金構造の合計を 100% にしてください', 'error');
    return;
  }
  // STEP 10 フェーズC.2 中 7: トーナメント名空で保存阻止
  const nameRaw = (el.tournamentTitle?.value || '').trim();
  if (!nameRaw) {
    setTournamentHint('トーナメント名を入力してください', 'error');
    return;
  }
  try {
    const form = readTournamentForm();
    // STEP 10 フェーズC.2 中 1: blindPresetId 変更検知
    const oldPresetId = tournamentState.blindPresetId;
    const newPresetId = form.blindPresetId;
    const presetChanged = oldPresetId !== newPresetId;

    const result = await window.api.tournaments.save(form);
    if (!result?.ok) {
      if (result?.error === 'limit-exceeded') {
        setTournamentHint(result.message || `トーナメントは ${MAX_TOURNAMENTS} 件までです`, 'error');
      } else {
        setTournamentHint('保存に失敗しました', 'error');
      }
      return;
    }
    applyTournament(result.tournament);   // メイン画面のテキスト・通貨・プルダウンを即時反映
    await populateTournamentList();        // 名前変更を一覧に反映

    // STEP 10 フェーズC.2 中 1: blindPresetId 変更時:
    //   idle なら自動 setStructure + メイン画面再描画、running/paused なら警告ヒント
    if (presetChanged) {
      const { status, currentLevelIndex } = getState();
      if (status === States.IDLE) {
        try {
          const newPreset = await loadPresetById(newPresetId);
          if (newPreset) {
            setStructure(newPreset);
            renderCurrentLevel(currentLevelIndex || 0);
            renderNextLevel(currentLevelIndex || 0);
            setTournamentHint('保存しました（ブラインド構造も反映）', 'success');
          } else {
            setTournamentHint('保存しました（ブラインド構造の読込に失敗）', 'error');
          }
        } catch (err) {
          console.warn('ブラインド構造の即時反映失敗:', err);
          setTournamentHint('保存しました（ブラインド構造は『保存して適用』で反映してください）', 'error');
        }
      } else {
        setTournamentHint('保存しました（ブラインド構造の変更は『保存して適用』で反映してください）', 'success');
      }
    } else {
      setTournamentHint('保存しました', 'success');
    }
    setTimeout(() => setTournamentHint(''), 2500);
  } catch (err) {
    console.warn('トーナメント保存失敗:', err);
    setTournamentHint('保存に失敗しました: ' + err.message, 'error');
  }
}

// STEP 6.8: 「保存して適用」は3択モーダルへ。
// - リセットして開始: 既存挙動（保存 → setStructure → handleReset → 新規エントリーで開始）
// - 現在のタイマーを継続: 保存 → setStructure のみ（timerReset しない、tournamentRuntime も保持）。
//   現在のレベル番号と残り時間を維持し、新構造の SB/BB/ANTE 値だけ反映。
//   新構造のレベル数が現在のレベル番号より少ない場合は「継続」を非活性。
// - キャンセル: 何もしない。
async function handleTournamentSaveApply() {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B5: hall は保存操作不可
  if (!el.tournamentTitle) return;
  if (!window.api?.tournaments?.save) {
    setTournamentHint('保存 API が利用できません', 'error');
    return;
  }
  if (!isPayoutsValid()) {
    setTournamentHint('賞金構造の合計を 100% にしてください', 'error');
    return;
  }
  // STEP 10 フェーズC.2.1 中 7 統合: トーナメント名空で阻止（save と同じガード）
  const nameRaw = (el.tournamentTitle?.value || '').trim();
  if (!nameRaw) {
    setTournamentHint('トーナメント名を入力してください', 'error');
    return;
  }

  // 現状のタイマー状態と新構造を事前に取得し、「継続」可否を判定
  const form = readTournamentForm();
  const newPreset = await loadPresetById(form.blindPresetId);
  const { status, currentLevelIndex } = getState();
  const isTimerActive = status !== States.IDLE;

  // ★ STEP 10 フェーズC.2.1 Fix 1: idle 時はダイアログを出さず「構造反映のみ」で完了 ★
  //   - 旧仕様: idle でも 3 択ダイアログ → 「経過保持」disabled → ユーザーは「リセットして開始」を選ぶしかなく、
  //             handleReset() + timerStart() で**タイマー暴発**していた（前原さん報告）
  //   - 新仕様: idle 時は 'apply-only' モードで構造反映のみ。タイマー停止のまま
  if (!isTimerActive) {
    if (!newPreset) {
      setTournamentHint('指定のブラインド構造を読み込めません', 'error');
      return;
    }
    return doApplyTournament({ form, newPreset }, 'apply-only');
  }

  // running / paused 時のみ 3 択ダイアログ
  const newLevelCount = newPreset ? (newPreset.levels?.length || 0) : 0;
  const continueAvailable = isTimerActive && newPreset && newLevelCount > currentLevelIndex;

  // ヒント表示
  if (el.applyModeHint) {
    if (!newPreset) {
      el.applyModeHint.textContent = '指定のブラインド構造を読み込めません。リセットして開始してください。';
    } else if (!continueAvailable) {
      el.applyModeHint.textContent = '新構造のレベル数が不足しています、リセットしてください。';
    } else {
      el.applyModeHint.textContent = '';
    }
  }
  if (el.applyContinue) el.applyContinue.disabled = !continueAvailable;

  // 保存対象（フォーム内容）と新構造をクロージャに固定して、ボタン押下時に走らせる
  // STEP 10 フェーズC.2.7-B Fix 4: PAUSED 限定で apply-only ボタン表示
  openApplyModeDialog({ form, newPreset }, { showApplyOnly: status === States.PAUSED });
}

// STEP 6.8: 適用モードダイアログのオーバーロード。
// 各ボタンに 1 回だけ click ハンドラを登録（前回のは removeEventListener で外す）して開く。
// STEP 10 フェーズC.2.7-B Fix 4: showApplyOnly オプション追加（PAUSED 専用 3 択目）
let _applyModeHandlers = null;
function openApplyModeDialog(ctx, { showApplyOnly = false } = {}) {
  if (!el.applyModeDialog) return;
  // 旧ハンドラを除去
  if (_applyModeHandlers) {
    el.applyReset?.removeEventListener('click', _applyModeHandlers.reset);
    el.applyContinue?.removeEventListener('click', _applyModeHandlers.cont);
    el.applyOnly?.removeEventListener('click', _applyModeHandlers.applyOnly);
    el.applyCancel?.removeEventListener('click', _applyModeHandlers.cancel);
  }
  // PAUSED 限定で apply-only ボタンを表示
  if (el.applyOnly) el.applyOnly.hidden = !showApplyOnly;
  const onReset     = () => { el.applyModeDialog.close(); doApplyTournament(ctx, 'reset'); };
  const onCont      = () => { el.applyModeDialog.close(); doApplyTournament(ctx, 'continue'); };
  const onApplyOnly = () => { el.applyModeDialog.close(); doApplyTournament(ctx, 'apply-only'); };
  const onCancel    = () => { el.applyModeDialog.close(); };
  _applyModeHandlers = { reset: onReset, cont: onCont, applyOnly: onApplyOnly, cancel: onCancel };
  el.applyReset?.addEventListener('click', onReset);
  el.applyContinue?.addEventListener('click', onCont);
  el.applyOnly?.addEventListener('click', onApplyOnly);
  el.applyCancel?.addEventListener('click', onCancel);
  if (typeof el.applyModeDialog.showModal === 'function') {
    el.applyModeDialog.showModal();
  }
}

// 実際の保存＋適用処理。mode は 'reset' | 'continue' | 'apply-only'
// STEP 10 フェーズC.2.1: 'apply-only' は idle 時専用、タイマーには触らず構造反映のみ
async function doApplyTournament({ form, newPreset }, mode) {
  try {
    const result = await window.api.tournaments.save(form);
    if (!result?.ok) {
      if (result?.error === 'limit-exceeded') {
        setTournamentHint(result.message || `トーナメントは ${MAX_TOURNAMENTS} 件までです`, 'error');
      } else {
        setTournamentHint('保存に失敗しました', 'error');
      }
      return;
    }
    await window.api.tournaments.setActive(form.id);
    applyTournament(result.tournament);
    await populateTournamentList();

    // 構造の解決（フォールバック付き）
    let preset = newPreset;
    if (!preset) {
      preset = await loadPresetById('demo-fast');
      if (!preset) {
        setTournamentHint('保存しましたがブラインド構造を読み込めませんでした', 'error');
        setTimeout(() => setTournamentHint(''), 2500);
        return;
      }
    }
    try {
      setStructure(preset);
      if (mode === 'apply-only') {
        // ★ STEP 10 フェーズC.2.1 Fix 1 / C.2.7-B Fix 4: idle / PAUSED 時は構造反映のみ、タイマーには触らない ★
        //   - handleReset()/timerStart() は呼ばない（タイマー暴発防止）
        //   - PAUSED 時は pausedRemainingMs / currentLevelIndex / status をすべて維持
        //   - メイン画面 BLINDS / NEXT カードを新構造で再描画
        // v2.0.4 E-1 fix: 終了済み（clock--timer-finished）からの apply-only 経路でも
        //   overlay を解除する（新ブラインド構造を適用したのに finished 表示が残る違和感を防止）。
        el.clock?.classList.remove('clock--timer-finished');
        const { status: curStatus, currentLevelIndex } = getState();
        renderCurrentLevel(currentLevelIndex);
        renderNextLevel(currentLevelIndex);
        const msg = curStatus === States.PAUSED
          ? '保存して適用しました（一時停止状態を維持）'
          : '保存して適用しました（タイマーは停止のまま）';
        setTournamentHint(msg, 'success');
        setTimeout(() => setTournamentHint(''), 2500);
        return;
      }
      if (mode === 'continue') {
        // タイマーは継続（リセットしない）。現レベルの SB/BB/ANTE 表示だけ更新する。
        const { currentLevelIndex } = getState();
        renderCurrentLevel(currentLevelIndex);
        renderNextLevel(currentLevelIndex);
        setTournamentHint('保存して適用しました（タイマー継続）', 'success');
      } else {
        // STEP 6.21.3: 「リセットして開始」は破壊的操作のため確認ダイアログ
        const confirmed = window.confirm(
          'このトーナメントの経過時間とレベルをリセットして、最初から開始します。\nよろしいですか？'
        );
        if (!confirmed) {
          setTournamentHint('保存しました（タイマーは変更なし）', 'success');
          setTimeout(() => setTournamentHint(''), 2500);
          return;
        }
        // STEP 6.21.2 問題1: 「リセットして開始」は単なる reset ではなく必ず running を開始させる
        // STEP 7 (D-4): 明示的な setTimerState 呼び出しは削除。timerStart() の状態変化が subscribe 経由で
        //               schedulePersistTimerState を発火させ active の timerState が自動保存される
        // STEP 10 フェーズC.2.7-A Fix 1（致命バグ 8-8 修正）: ブラインド構造のリセットのみ実施。
        //   tournamentRuntime（プレイヤー数・リエントリー・アドオン）は**保持**する。
        //   営業中の進行データを「保存して適用」で失わないため。
        resetBlindProgressOnly();   // tournamentRuntime は保護、timer.js を idle へ
        timerStart();    // レベル 0 から即時 RUNNING で開始（subscribe → 自動永続化）
        setTournamentHint('保存して適用しました（タイマーをリセットして開始）', 'success');
      }
    } catch (err) {
      setTournamentHint('保存しましたが構造の適用に失敗: ' + err.message, 'error');
    }
    setTimeout(() => setTournamentHint(''), 2500);
  } catch (err) {
    console.warn('トーナメント適用失敗:', err);
    setTournamentHint('適用に失敗しました: ' + err.message, 'error');
  }
}

// 「このブラインド構造を編集」: ブラインド構造タブへ切替 + 同じプリセットを選択
el.tournamentEditBlinds?.addEventListener('click', () => {
  const presetId = el.tournamentBlindPreset?.value || tournamentState.blindPresetId;
  activateSettingsTab('blinds');
  if (presetId && el.presetSelect && el.presetSelect.value !== presetId) {
    el.presetSelect.value = presetId;
    // change イベントを手動発火 → loadPresetIntoDraft が起動
    el.presetSelect.dispatchEvent(new Event('change'));
  }
});

el.tournamentSave?.addEventListener('click', handleTournamentSave);
el.tournamentSaveApply?.addEventListener('click', handleTournamentSaveApply);

// STEP 6.7: イベント名のカウンタ更新（リアルタイム）
el.tournamentTitle?.addEventListener('input', updateTitleCounter);
// STEP 6.17: サブタイトルのカウンタ更新
el.tournamentSubtitle?.addEventListener('input', updateSubtitleCounter);

// STEP 6.9: 特殊スタック有効化トグル → 入力欄の disabled 連動
el.tournamentSpecialStackEnabled?.addEventListener('change', applySpecialStackEnabledState);

// STEP 6.17: タイトル色ピッカー（プリセットボタン + カラーピッカー）
//   - クリック/変更で即時メイン画面に反映（CSS 変数 --title-color）
//   - 永続化は「保存」「保存して適用」ボタン押下時のみ（既存の readTournamentForm 経由）
function applyTitleColorImmediate(hex) {
  if (!TITLE_COLOR_RE_RENDERER.test(hex)) return;
  tournamentState.titleColor = hex;
  document.documentElement.style.setProperty('--title-color', hex);
  syncTitleColorPicker();
}

el.titleColorPicker?.addEventListener('click', (event) => {
  const btn = event.target.closest('.title-color-swatch');
  if (!btn) return;
  applyTitleColorImmediate(btn.dataset.color || '#FFFFFF');
});

el.titleColorCustomInput?.addEventListener('input', () => {
  applyTitleColorImmediate(el.titleColorCustomInput.value);
});

// STEP 6.8: 通貨記号変更時に賞金端数 <select> ラベルを再生成
el.tournamentCurrency?.addEventListener('input', () => {
  const sym = (el.tournamentCurrency.value || '').trim() || '¥';
  if (!el.tournamentPayoutRounding) return;
  const prev = el.tournamentPayoutRounding.value;
  for (const opt of el.tournamentPayoutRounding.options) {
    opt.textContent = `${sym}${opt.value}`;
  }
  if (prev) el.tournamentPayoutRounding.value = prev;
});

// STEP 3b 拡張: 複数トーナメント管理ハンドラ
el.tournamentSelect?.addEventListener('change', handleTournamentSelectChange);
el.tournamentNew?.addEventListener('click', handleTournamentNew);
el.tournamentDuplicate?.addEventListener('click', handleTournamentDuplicate);
// STEP 7.x ③-a: ヘッダー「削除」ボタンは撤去。削除は各行🗑（buildTournamentListItem 内で配線）

// 全タブボタンに切替ハンドラを登録
el.settingsTabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (tab) activateSettingsTab(tab);
  });
});

// ===== STEP 3b: ブラインド構造エディタ =====

// エディタ状態（タブ内に閉じる）
const blindsEditor = {
  draft: null,        // 編集中の構造（deep clone、active 構造には未反映）
  meta: null,         // { id, name, builtin } 現在選択中プリセットのメタ
  isDirty: false,     // 未保存変更フラグ
  presetList: [],     // [{id, name, builtin}] ドロップダウン用一覧
  initialized: false  // 初回ロード済みか
};

// ヒント表示（class で色分け）
function setBlindsHint(message, kind = '') {
  if (!el.blindsHint) return;
  el.blindsHint.textContent = message || '';
  el.blindsHint.className = 'blinds-editor__hint';
  if (kind === 'error')   el.blindsHint.classList.add('is-error');
  if (kind === 'success') el.blindsHint.classList.add('is-success');
}

function setDirty(dirty) {
  blindsEditor.isDirty = Boolean(dirty);
  if (el.presetDirty) el.presetDirty.hidden = !dirty;
}

// ドロップダウン再構築
async function refreshPresetList() {
  if (!window.api?.presets) return;
  let builtin = [];
  let user = [];
  try {
    builtin = await window.api.presets.listBuiltin() || [];
    user = await window.api.presets.listUser() || [];
  } catch (err) {
    console.warn('テンプレート一覧取得失敗:', err);
  }
  // STEP 10 フェーズB.fix5: presetList は全件保持（loadPresetIntoDraft が builtin 判定で参照するため）
  blindsEditor.presetList = [...builtin, ...user];

  // STEP 10 フェーズC.2.4 Fix 4: テンプレ ↔ トーナメントの紐づけマップを構築
  //   blindPresetId → tournament.name[] 。option の text に「『〇〇』で使用中」サフィックス付与
  let tournamentList = [];
  try { tournamentList = await window.api?.tournaments?.list?.() || []; } catch (_) { /* 続行 */ }
  const usageMap = new Map();
  for (const t of tournamentList) {
    if (!t || typeof t.blindPresetId !== 'string') continue;
    const arr = usageMap.get(t.blindPresetId) || [];
    arr.push(t.name || t.title || '(無題)');
    usageMap.set(t.blindPresetId, arr);
  }
  const usageSuffix = (presetId) => {
    const used = usageMap.get(presetId) || [];
    if (used.length === 0) return '  — 未使用';
    if (used.length === 1) return `  — 『${used[0]}』で使用中`;
    return `  — 『${used[0]}』他 ${used.length - 1} 件で使用中`;
  };
  // STEP 10 フェーズC.2.5 Fix 2-C: MIX 構造のテンプレ名にユニークゲーム数を補足
  //   同梱（mix-regular）は名前に「10-Game」が既に含まれているのでスキップ。
  //   ユーザー保存テンプレで MIX のものに `(N-Game)` を suffix として付与。
  const _mixCountCache = new Map();
  async function fetchMixCount(presetId, builtin) {
    if (_mixCountCache.has(presetId)) return _mixCountCache.get(presetId);
    let preset = null;
    try {
      preset = builtin
        ? await window.api.presets.loadBuiltin(presetId)
        : await window.api.presets.loadUser(presetId);
    } catch (_) { /* skip */ }
    const count = preset ? countUniqueMixGames(preset.levels) : 0;
    _mixCountCache.set(presetId, count);
    return count;
  }
  const mixSuffix = async (preset, isBuiltin) => {
    if ((preset.structureType || 'BLIND') !== 'MIX') return '';
    if (isBuiltin) return '';   // 同梱名にはすでに含まれているので付与しない
    if (/\(\d+-Game\)/.test(preset.name)) return '';   // 既に名前に入っていれば二重付与しない
    const c = await fetchMixCount(preset.id, false);
    return c > 0 ? ` (${c}-Game)` : '';
  };

  // 構造型フィルタ: 現在のゲーム種から導出される structureType と一致するもののみ表示
  const currentStructureType = getStructureTypeForGameRenderer(tournamentState.gameType || 'nlh');
  const matches = (p) => ((p.structureType || 'BLIND') === currentStructureType);
  const filteredBuiltin = builtin.filter(matches);
  const filteredUser = user.filter(matches);

  // <select> を再構築（同梱 / ユーザー作成 で <optgroup> 分離）
  el.presetSelect.innerHTML = '';
  if (filteredBuiltin.length > 0) {
    const og = document.createElement('optgroup');
    og.label = '同梱';
    for (const p of filteredBuiltin) {
      const opt = document.createElement('option');
      opt.value = p.id;
      // 同梱は MIX suffix なし（名前に既に「10-Game」が含まれる）
      opt.textContent = p.name + usageSuffix(p.id);
      og.appendChild(opt);
    }
    el.presetSelect.appendChild(og);
  }
  if (filteredUser.length > 0) {
    const og = document.createElement('optgroup');
    og.label = 'ユーザー作成';
    for (const p of filteredUser) {
      const opt = document.createElement('option');
      opt.value = p.id;
      const suffix = await mixSuffix(p, false);   // ユーザー保存テンプレで MIX なら (N-Game) 付与
      opt.textContent = p.name + suffix + usageSuffix(p.id);
      og.appendChild(opt);
    }
    el.presetSelect.appendChild(og);
  }
  // 現在の draft.meta があれば選択状態を復元（フィルタ後に存在する場合のみ）
  if (blindsEditor.meta && [...filteredBuiltin, ...filteredUser].some((p) => p.id === blindsEditor.meta.id)) {
    el.presetSelect.value = blindsEditor.meta.id;
  } else {
    // v2.0.3 P2 fix: フィルタ後に option が無ければ value を空文字でクリアし、
    //   ドロップダウン表示と内部 selection の不整合を防止する。
    el.presetSelect.value = '';
  }
  // STEP 6.7: ユーザープリセット数表示（同梱4種は対象外、フィルタ前の全件カウント）
  if (el.presetCount) {
    el.presetCount.textContent = `保存済みテンプレート: ${user.length}/${MAX_USER_PRESETS} 件`;
    el.presetCount.classList.toggle('is-limit', user.length >= MAX_USER_PRESETS);
  }
  // 100件到達時は新規・複製を非活性
  const atLimit = user.length >= MAX_USER_PRESETS;
  if (el.presetNew)       el.presetNew.disabled       = atLimit;
  if (el.presetDuplicate) el.presetDuplicate.disabled = atLimit;
}

// プリセットを draft に読込（IPC）
async function loadPresetIntoDraft(presetId) {
  const meta = blindsEditor.presetList.find((p) => p.id === presetId);
  if (!meta) {
    setBlindsHint('テンプレートが見つかりません', 'error');
    return;
  }
  let preset = null;
  try {
    if (meta.builtin) {
      preset = await window.api.presets.loadBuiltin(presetId);
    } else {
      preset = await window.api.presets.loadUser(presetId);
    }
  } catch (err) {
    console.warn('プリセット読込失敗:', err);
  }
  if (!preset) {
    setBlindsHint('テンプレートの読込に失敗しました', 'error');
    return;
  }
  blindsEditor.draft = cloneStructure(preset);
  blindsEditor.meta = { id: preset.id, name: preset.name, builtin: meta.builtin };
  blindsEditor.draft.levels = renumberLevels(blindsEditor.draft.levels);
  setDirty(false);
  setBlindsHint('');
  syncEditorUIFromDraft();
  updatePresetActions();
}

// 編集系ボタン (削除) の活性/非活性を更新
// STEP 6.21.5: フォーマット化に伴い builtin プリセットも編集可能（readOnly 撤廃）。
//              名前を変えずに保存しようとすると _savePresetCore 側で拒否される設計。
//              削除のみ無効化（フォーマットを誤削除させない）。
//              保存ボタンは builtin 選択時「複製して保存」、ユーザー作成は「保存」。
//              共有ヒントも状況に応じて切替。
function updatePresetActions() {
  if (!el.presetDelete) return;
  const isBuiltin = !blindsEditor.meta || blindsEditor.meta.builtin;
  el.presetDelete.disabled = isBuiltin;
  el.presetDelete.title = isBuiltin
    ? 'このブラインドはフォーマットのため削除できません'
    : '';

  // STEP 10 フェーズB.fix6: フォーマット選択時はプリセット名も編集不可
  if (el.presetName) {
    el.presetName.readOnly = isBuiltin;
    el.presetName.disabled = isBuiltin;
    el.presetName.classList.toggle('is-readonly', isBuiltin);
  }

  // STEP 10 フェーズB.fix6: 保存ボタンはフォーマット時 disabled。
  //   旧仕様（fix5 まで）: 「複製して保存」ラベルで builtin でも操作可だった。
  //   新仕様: builtin は完全 read-only。「複製して編集」ボタンでコピーを作ってから編集する設計。
  if (el.presetSave) {
    el.presetSave.disabled = isBuiltin;
    el.presetSave.textContent = '保存';
    el.presetSave.title = isBuiltin
      ? 'フォーマットは編集・保存できません。「複製して編集」でコピーを作ってください'
      : '';
  }

  // STEP 10 フェーズB.fix6: 行追加ボタンもフォーマット時 disabled
  if (el.addLevelBtn) {
    el.addLevelBtn.disabled = isBuiltin;
    el.addLevelBtn.title = isBuiltin ? 'フォーマットは編集できません' : '';
  }

  // STEP 10 フェーズB.fix6: 編集テーブル内のすべての input / button / select を一括 disabled
  setBlindsTableReadonly(isBuiltin);

  if (el.blindsShareHint) {
    el.blindsShareHint.textContent = isBuiltin
      ? '※ このブラインドはフォーマットです。「複製して編集」でコピーを作ってから編集してください'
      : '※ このブラインドを使用する全てのトーナメントで変更が反映されます';
  }
  // STEP 7.x ①: 同梱プリセット編集警告枠の表示制御（updatePresetActions が builtin 判定の唯一の経路）
  if (el.blindsBuiltinWarning) {
    el.blindsBuiltinWarning.hidden = !isBuiltin;
  }

  // STEP 10 フェーズB.fix6: .blinds-editor に data-builtin 属性を付与（CSS の「複製して編集」強調用）
  const editorRoot = document.querySelector('.blinds-editor');
  if (editorRoot) editorRoot.dataset.builtin = String(isBuiltin);
}

// STEP 10 フェーズC.1-A2: 編集可能状態への強制リセットヘルパ。
//   複製・新規・import 後の draft が user preset 扱いになる経路で、すべての readonly/disabled
//   状態を確実にクリアする。setBlindsTableReadonly(false) + el.presetName のリセットを 1 か所に集約。
//   呼び出し側で複数回呼んでも冪等。
// STEP 10 フェーズC.1.2-bugfix: meta.builtin === true 時は **no-op**（builtin readonly 保護）。
//   これにより呼出側は meta の状態を気にせず多くのタイミングで呼べる（防御的多重化の拡張）。
function ensureEditorEditableState() {
  // builtin プリセット選択中はガード（誤って編集可能化しない）
  if (blindsEditor.meta && blindsEditor.meta.builtin === true) return;
  if (el.presetName) {
    el.presetName.readOnly = false;
    el.presetName.disabled = false;
    el.presetName.classList.remove('is-readonly');
  }
  setBlindsTableReadonly(false);
  // editor data-builtin もリセット（CSS の builtin 強調表示を解除）
  const editorRoot = document.querySelector('.blinds-editor');
  if (editorRoot) editorRoot.dataset.builtin = 'false';
}

// STEP 10 フェーズB.fix6 / fix7: 編集テーブル内 input/button/select の disabled 制御。
//   - readonly=true: 全要素を強制 disabled（フォーマット保護）
//   - readonly=false: ユーザー編集可だが、break 行の blind/bet 系フィールドは buildNumberCell が
//     設定した「level.isBreak による disabled」を維持する（fix7 で追加した尊重ロジック）。
//   ARIA: readonly=true 時のみ aria-disabled 付与。
function setBlindsTableReadonly(readonly) {
  if (!el.blindsTbody) return;
  if (readonly) {
    el.blindsTbody.querySelectorAll('input, button, select').forEach((node) => {
      node.disabled = true;
      node.setAttribute('aria-disabled', 'true');
      // STEP 10 フェーズC.1-A2: readonly 属性も明示的に付与（防御的、CSS [readonly] セレクタとの整合）
      if (node.tagName === 'INPUT') node.setAttribute('readonly', '');
    });
    return;
  }
  // readonly=false: 行ごとに break 状態を尊重して enable
  el.blindsTbody.querySelectorAll('tr').forEach((tr) => {
    const isBreakRow = tr.classList.contains('is-break');
    tr.querySelectorAll('input, button, select').forEach((node) => {
      const field = node.dataset?.field;
      // break 行の blind/bet 系フィールド入力は disabled のまま（buildNumberCell の意図を維持）
      const isBlindFieldOnBreakRow = isBreakRow && field
        && field !== 'isBreak' && field !== 'durationMinutes';
      node.disabled = Boolean(isBlindFieldOnBreakRow);
      node.removeAttribute('aria-disabled');
      // STEP 10 フェーズC.1-A2: readonly 属性を明示クリア（複製後の readonly 残存バグ対策）。
      //   仮に builtin 状態の DOM ノードが流用された場合でも確実に編集可能化。
      if (node.tagName === 'INPUT') node.removeAttribute('readonly');
    });
  });
}

// draft の内容を UI（select / 名前 / テーブル）に反映
function syncEditorUIFromDraft() {
  if (!blindsEditor.draft) return;
  if (blindsEditor.meta && el.presetSelect.value !== blindsEditor.meta.id) {
    el.presetSelect.value = blindsEditor.meta.id;
  }
  el.presetName.value = blindsEditor.draft.name || '';
  renderBlindsTable();
}

// STEP 10 フェーズB: 編集ダイアログのテーブル列 = 構造型に応じて動的生成。
//   draft.structureType を参照（無ければ 'BLIND' フォールバック）。
function getDraftStructureType() {
  return (blindsEditor.draft && typeof blindsEditor.draft.structureType === 'string'
          && STRUCTURE_FIELDS[blindsEditor.draft.structureType])
    ? blindsEditor.draft.structureType : 'BLIND';
}

// thead を構造型に応じて再描画
//   STEP 10 フェーズC.2.5: MIX のとき「ゲーム種」列 + 全 sub-構造の全フィールド列を一括宣言。
//   行ごとに subStructureType に応じて該当フィールドの input セルを表示、それ以外は空セル。
//   こうすることで列数固定 → レイアウトシフト 0（既存 5 原則維持）。
function renderBlindsEditorHeader(structureType) {
  if (!el.blindsThead) return;
  const isMix = (structureType === 'MIX');
  let fieldHeaders = '';
  if (isMix) {
    // MIX: ゲーム種列 + 全 fields のユニオン
    const mixFields = getMixUnionFields();
    fieldHeaders = '<th class="blinds-table__col-game">ゲーム種</th>'
      + mixFields.map((f) =>
          `<th class="blinds-table__col-num" data-field="${f}">${escapeHtml(FIELD_LABEL[f] || f)}</th>`
        ).join('');
  } else {
    const fields = getStructureFieldsRenderer(structureType);
    fieldHeaders = fields.map((f) =>
      `<th class="blinds-table__col-num" data-field="${f}">${escapeHtml(FIELD_LABEL[f] || f)}</th>`
    ).join('');
  }
  el.blindsThead.innerHTML = `<tr>
    <th class="blinds-table__col-num">Lv#</th>
    ${fieldHeaders}
    <th class="blinds-table__col-num">時間(分)</th>
    <th class="blinds-table__col-break">ブレイク</th>
    <th class="blinds-table__col-actions">操作</th>
  </tr>`;
}

// MIX テーブル用: 4 sub-構造型の全フィールドのユニオン（重複除去 / 表示順を安定させる）
function getMixUnionFields() {
  const ordered = ['sb', 'bb', 'bbAnte', 'smallBet', 'bigBet', 'ante', 'bringIn', 'buttonBlind'];
  const seen = new Set();
  for (const sub of ['BLIND', 'LIMIT_BLIND', 'STUD', 'SHORT_DECK']) {
    for (const f of getStructureFieldsRenderer(sub)) seen.add(f);
  }
  return ordered.filter((f) => seen.has(f));
}

// レベル一覧テーブルの再描画（thead + tbody）
// STEP 10 フェーズB.fix1/fix8/fix9: 入力中の input にフォーカスがある状態で innerHTML='' すると
//   フォーカス + 打鍵中のキャラクタが破棄される。fix9 で統一ヘルパ isUserTypingInInput() に置換。
//   ヘルパは text/number/textarea/contentEditable のみ true（checkbox/radio/button は除外、
//   ブレイクチェックボックス change → 再描画 skip バグの fix8 修正を踏襲）。
function renderBlindsTable() {
  if (!el.blindsTbody || !blindsEditor.draft) return;
  if (isUserTypingInInput() && el.settingsDialog?.contains?.(document.activeElement)) {
    return;
  }
  const structureType = getDraftStructureType();
  renderBlindsEditorHeader(structureType);
  // テーブル全体の構造型を data 属性に（CSS の列数可変対応用）
  if (el.blindsTable) el.blindsTable.dataset.structure = structureType;
  el.blindsTbody.innerHTML = '';
  const levels = blindsEditor.draft.levels;
  // STEP 10 フェーズC.1-A Fix 4: DocumentFragment で行追加をバッチ化、reflow を 1 回に削減。
  //   旧実装: appendChild ループ N 回 → N 回の reflow（50+ 件で体感ラグ）
  //   新実装: 1 回の reflow + paint で完了。20-30 件でも体感改善、50+ 件で顕著
  const frag = document.createDocumentFragment();
  for (let i = 0; i < levels.length; i++) {
    frag.appendChild(buildRow(levels[i], i, levels.length, structureType));
  }
  el.blindsTbody.appendChild(frag);
  // STEP 10 フェーズB.fix6: 再描画後に readonly 状態を反映（新規生成された input/button にも disabled 伝播）
  const isBuiltin = !blindsEditor.meta || blindsEditor.meta.builtin;
  setBlindsTableReadonly(isBuiltin);
}

// 1行分の <tr> を生成（構造型のフィールドリストで列を動的に）
function buildRow(level, index, total, structureType) {
  const tr = document.createElement('tr');
  tr.dataset.index = String(index);
  if (level.isBreak) tr.classList.add('is-break');
  const isMix = (structureType === 'MIX');

  // Lv# 列
  const tdNum = document.createElement('td');
  if (level.isBreak) {
    tdNum.innerHTML = '<span class="break-label-text">休憩</span>';
  } else {
    const span = document.createElement('span');
    span.className = 'row-level-num';
    span.textContent = String(level.level ?? '?');
    tdNum.appendChild(span);
  }
  tr.appendChild(tdNum);

  // STEP 10 フェーズC.2.5: MIX のときゲーム種セル（select）を最初に配置。
  //   ブレイク行はグレーアウト + 操作不可。
  if (isMix) {
    tr.appendChild(buildMixGameCell(index, level));
  }

  // 構造型のフィールド列（step は NUMBER_FIELD_SPECS の defaults で 25 刻み）
  //   MIX のときは 4 sub-構造のユニオンを描画し、行の subStructureType に該当しない列は空セルにする。
  const fields = isMix
    ? getMixUnionFields()
    : getStructureFieldsRenderer(structureType || 'BLIND');
  const activeFields = isMix
    ? new Set(getStructureFieldsRenderer(level.subStructureType || 'BLIND'))
    : null;
  for (const f of fields) {
    if (isMix && level.isBreak) {
      tr.appendChild(buildEmptyCell());
    } else if (isMix && !activeFields.has(f)) {
      tr.appendChild(buildEmptyCell());
    } else {
      tr.appendChild(buildNumberCell(index, f, level[f], level.isBreak));
    }
  }

  // 時間（分）列
  tr.appendChild(buildNumberCell(index, 'durationMinutes', level.durationMinutes, false));

  // ブレイク チェック列
  const tdBreak = document.createElement('td');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = Boolean(level.isBreak);
  cb.dataset.index = String(index);
  cb.dataset.field = 'isBreak';
  tdBreak.appendChild(cb);
  tr.appendChild(tdBreak);

  // 操作列（STEP 6.9: ↑ ↓ ＋↓ ✕ の4ボタン構成。「＋↓」は直下挿入を意味するアイコン）
  const tdActions = document.createElement('td');
  const wrap = document.createElement('div');
  wrap.className = 'blinds-table__row-actions';
  wrap.appendChild(buildActionButton('↑',  'up',     index, index === 0,        false, '前の行と入れ替え'));
  wrap.appendChild(buildActionButton('↓',  'down',   index, index === total - 1, false, '次の行と入れ替え'));
  wrap.appendChild(buildActionButton('＋↓', 'insert', index, false,              false, 'この行の下にレベルを追加'));
  wrap.appendChild(buildActionButton('✕',  'delete', index, total <= 1,         true,  'この行を削除'));
  tdActions.appendChild(wrap);
  tr.appendChild(tdActions);

  return tr;
}

// 数値入力フィールドごとの step / min / max 仕様
// ポーカー単位に揃えてスピナークリックでの編集効率を上げる。直接タイプ入力では中間値も自由に入力可。
// STEP 10 フェーズB: 全構造型のフィールド網羅（sb/bb/bbAnte/smallBet/bigBet/ante/bringIn/buttonBlind）
const NUMBER_FIELD_SPECS = {
  sb:              { step: 25, min: 0 },
  bb:              { step: 50, min: 0 },
  bbAnte:          { step: 25, min: 0 },
  smallBet:        { step: 50, min: 0 },
  bigBet:          { step: 100, min: 0 },
  ante:            { step: 25, min: 0 },
  bringIn:         { step: 25, min: 0 },
  buttonBlind:     { step: 50, min: 0 },
  durationMinutes: { step: 1,  min: 1, max: 120 }
};

// STEP 10 フェーズC.2.5: MIX 行用ゲーム種セル（<select>）。
//   - ブレイク行は disabled（グレーアウト）
//   - 値は level.subGameType（未設定なら空欄）
function buildMixGameCell(index, level) {
  const td = document.createElement('td');
  td.className = 'blinds-table__col-game';
  if (level.isBreak) {
    td.appendChild(document.createElement('span'));
    return td;
  }
  const select = document.createElement('select');
  select.dataset.index = String(index);
  select.dataset.field = 'subGameType';
  select.className = 'blinds-table__game-select';
  // 未選択用プレースホルダ option（subGameType 未設定の旧データ救済）
  if (!level.subGameType || !MIX_GAME_IDS.includes(level.subGameType)) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— 選択 —';
    select.appendChild(opt);
  }
  for (const g of MIX_GAMES) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.label;
    select.appendChild(opt);
  }
  select.value = level.subGameType || '';
  td.appendChild(select);
  return td;
}

// 空セル（MIX で行の subStructureType に存在しないフィールド列を埋める）
function buildEmptyCell() {
  const td = document.createElement('td');
  td.className = 'blinds-table__col-num blinds-table__col-num--empty';
  td.appendChild(document.createElement('span'));
  return td;
}

function buildNumberCell(index, field, value, disabled) {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'numeric';
  const spec = NUMBER_FIELD_SPECS[field] || { step: 1, min: 0 };
  input.step = String(spec.step);
  input.min = String(spec.min);
  if (spec.max !== undefined) input.max = String(spec.max);
  input.value = value == null ? '' : String(value);
  input.disabled = Boolean(disabled);
  input.dataset.index = String(index);
  input.dataset.field = field;
  td.appendChild(input);
  return td;
}

function buildActionButton(label, action, index, disabled, isDelete = false, tooltip = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'blinds-table__action-btn';
  if (isDelete) btn.classList.add('blinds-table__action-btn--delete');
  btn.textContent = label;
  btn.disabled = Boolean(disabled);
  btn.dataset.action = action;
  btn.dataset.index = String(index);
  // STEP 6.9: tooltip（hover で表示）
  if (tooltip) btn.title = tooltip;
  return btn;
}

// テーブル内の入力 (change イベント) を委譲ハンドラで拾う
//
// 重要（修正1）: 数値フィールドの変更ではテーブルを **再描画しない**。
// スピナー連続クリック中に renderBlindsTable() で <input> が破棄されると、
// 連打挙動が不安定になる（2回目以降の値が下がる/止まる現象の原因）。
// データ更新のみで完結させ、再描画は構造変化（ブレイク切替・行追加/削除/並び替え）
// のときだけ行う。レベル番号は SB/BB/ANTE/時間の変更では変わらないため、
// 再採番も isBreak トグル時のみ。
el.blindsTbody?.addEventListener('change', (event) => {
  const target = event.target;
  if (!target || !blindsEditor.draft) return;
  const idx = Number(target.dataset.index);
  const field = target.dataset.field;
  if (Number.isNaN(idx) || !field) return;
  const lv = blindsEditor.draft.levels[idx];
  if (!lv) return;

  // STEP 10 フェーズC.2.5: MIX 行の subGameType 変更
  //   重なるフィールドは値保持、重ならないフィールドは 0 で初期化。
  //   subStructureType も自動更新。フィールド列の表示切替のため再描画必須。
  if (field === 'subGameType') {
    const newSub = String(target.value || '');
    if (!MIX_GAME_IDS.includes(newSub)) return;
    const oldStructure = lv.subStructureType || null;
    const newStructure = getMixSubStructureType(newSub);
    const oldFields = oldStructure ? new Set(getStructureFieldsRenderer(oldStructure)) : new Set();
    const newFields = getStructureFieldsRenderer(newStructure);
    // 重ならないフィールドを削除（値破棄）
    for (const f of oldFields) {
      if (!newFields.includes(f)) delete lv[f];
    }
    // 新しい構造で必要なフィールドを 0 初期化（値が無いものだけ）
    for (const f of newFields) {
      if (typeof lv[f] !== 'number') lv[f] = 0;
    }
    lv.subGameType = newSub;
    lv.subStructureType = newStructure;
    setDirty(true);
    renderBlindsTable();
    return;
  }

  if (field === 'isBreak') {
    // STEP 10 フェーズC.2.2: ブレイクチェックの仕様変更
    //   旧仕様: 通常レベル ⇄ ブレイク変換（数値が消える / 復元時 0 で UX 混乱）
    //   新仕様（業界標準）:
    //     - 通常レベル行で ON  → 直下に新規ブレイク行を挿入（現在の行の数値は維持）
    //     - ブレイク行で      OFF → そのブレイク行を削除
    //     - その他の組合わせは無視（チェック状態と行の状態が一致しないケースは無音 no-op）
    if (target.checked && !lv.isBreak) {
      // 通常レベル行で ON → 直下に新規ブレイク挿入。クリックされた checkbox は OFF に戻す
      target.checked = false;
      const newBreak = {
        level: null,
        durationMinutes: 10,
        isBreak: true,
        label: '休憩'
      };
      blindsEditor.draft.levels.splice(idx + 1, 0, newBreak);
      blindsEditor.draft.levels = renumberLevels(blindsEditor.draft.levels);
      setDirty(true);
      renderBlindsTable();
      return;
    }
    if (!target.checked && lv.isBreak) {
      // ブレイク行で OFF → その行を削除
      blindsEditor.draft.levels.splice(idx, 1);
      blindsEditor.draft.levels = renumberLevels(blindsEditor.draft.levels);
      setDirty(true);
      renderBlindsTable();
      return;
    }
    // 同状態のチェック操作（通常+OFF / ブレイク+ON）は no-op
    return;
  }

  // 数値フィールド変更: データだけ更新、再描画なし（スピナー連打安定性確保）
  if (field === 'durationMinutes') {
    const n = Number(target.value);
    lv.durationMinutes = Number.isFinite(n) && n > 0 ? n : 1;
  } else {
    const n = Number(target.value);
    lv[field] = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  setDirty(true);
});

// 操作ボタン（↑ ↓ ✕）の委譲ハンドラ
el.blindsTbody?.addEventListener('click', (event) => {
  const btn = event.target.closest('.blinds-table__action-btn');
  if (!btn || !blindsEditor.draft) return;
  const idx = Number(btn.dataset.index);
  const action = btn.dataset.action;
  if (Number.isNaN(idx) || !action) return;
  const levels = blindsEditor.draft.levels;

  if (action === 'up' && idx > 0) {
    [levels[idx - 1], levels[idx]] = [levels[idx], levels[idx - 1]];
  } else if (action === 'down' && idx < levels.length - 1) {
    [levels[idx], levels[idx + 1]] = [levels[idx + 1], levels[idx]];
  } else if (action === 'insert') {
    // STEP 6.8: 直下に新規レベル挿入
    insertLevelAfter(idx);
    return;   // insertLevelAfter 内で renumber + dirty + render 済み
  } else if (action === 'delete') {
    if (levels.length <= 1) return;
    levels.splice(idx, 1);
  } else {
    return;
  }
  blindsEditor.draft.levels = renumberLevels(blindsEditor.draft.levels);
  setDirty(true);
  renderBlindsTable();
});

// プリセット名変更
el.presetName?.addEventListener('input', () => {
  if (!blindsEditor.draft) return;
  blindsEditor.draft.name = el.presetName.value;
  setDirty(true);
});

// STEP 6.8 / STEP 10 フェーズB: 新規レベル生成ヘルパ。
//   構造型 BLIND は直前行の SB を参照して SB_PROGRESSION で次値、BB=SB×2、BB Ante=BB（BBアンティ方式）。
//   それ以外の構造型は前レベルの値をベースに 2 倍化（雑算でも UX 的に「上げる」目安として機能）。
//   STEP 10 フェーズC.2.5: MIX のときは prevLevel の subGameType / subStructureType を継承（同じゲーム種で進行値だけ上げる）。
//                           prevLevel が無い / break のみの場合は NLH をデフォルトに。
function buildNewLevelFromPrev(prevLevel) {
  const structureType = getDraftStructureType();
  const prevDur = prevLevel?.durationMinutes;
  const lv = { level: 0, durationMinutes: prevDur || 15, isBreak: false };
  if (structureType === 'MIX') {
    const subGame = (prevLevel && typeof prevLevel.subGameType === 'string' && MIX_GAME_IDS.includes(prevLevel.subGameType))
      ? prevLevel.subGameType
      : 'nlh';
    const subStructure = getMixSubStructureType(subGame) || 'BLIND';
    lv.subGameType = subGame;
    lv.subStructureType = subStructure;
    const subFields = getStructureFieldsRenderer(subStructure);
    for (const f of subFields) {
      const prev = typeof prevLevel?.[f] === 'number' ? prevLevel[f] : 0;
      lv[f] = prev > 0 ? prev * 2 : 0;
    }
    return lv;
  }
  const fields = getStructureFieldsRenderer(structureType);
  if (structureType === 'BLIND') {
    const prevSB = prevLevel?.sb;
    const sb = prevSB ? getNextSB(prevSB) : 100;
    lv.sb = sb;
    lv.bb = sb * 2;
    lv.bbAnte = sb * 2;   // BBアンティ方式
  } else {
    // それ以外の構造型は前値の 2 倍 fallback、なければ 100 / 50（控えめな初期値）
    for (const f of fields) {
      const prev = typeof prevLevel?.[f] === 'number' ? prevLevel[f] : 0;
      lv[f] = prev > 0 ? prev * 2 : 0;
    }
  }
  return lv;
}

// ＋ レベルを末尾に追加
el.addLevelBtn?.addEventListener('click', () => {
  if (!blindsEditor.draft) return;
  const levels = blindsEditor.draft.levels;
  const lastReg = [...levels].reverse().find((l) => !l.isBreak);
  levels.push(buildNewLevelFromPrev(lastReg));
  blindsEditor.draft.levels = renumberLevels(levels);
  setDirty(true);
  renderBlindsTable();
});

// STEP 6.8: 任意位置挿入（行操作列の「＋」ボタンから呼ぶ）。
// 押下行の直下に新規レベルを挿入する。直前の non-break 行を参照（自身が非ブレイクならその値を）
function insertLevelAfter(idx) {
  if (!blindsEditor.draft) return;
  const levels = blindsEditor.draft.levels;
  if (idx < 0 || idx >= levels.length) return;
  // 参照: idx 自身が非ブレイクならそれ、ブレイクなら手前を遡って探す
  let ref = null;
  for (let i = idx; i >= 0; i--) {
    if (!levels[i].isBreak) { ref = levels[i]; break; }
  }
  const newLv = buildNewLevelFromPrev(ref);
  const insertedAt = idx + 1;
  levels.splice(insertedAt, 0, newLv);
  blindsEditor.draft.levels = renumberLevels(levels);
  setDirty(true);
  renderBlindsTable();
  // STEP 6.9: 挿入直後に flash アニメーションを 0.6s 付与
  requestAnimationFrame(() => {
    const tr = el.blindsTbody?.querySelector(`tr[data-index="${insertedAt}"]`);
    if (!tr) return;
    tr.classList.add('level-row--just-inserted');
    setTimeout(() => tr.classList.remove('level-row--just-inserted'), 700);
  });
}

// プリセット ドロップダウン切替
// dirty 時は確認ダイアログを出して、未保存変更の誤破棄を防ぐ
el.presetSelect?.addEventListener('change', async (event) => {
  const newId = event.target.value;
  if (blindsEditor.isDirty) {
    const opt = event.target.options[event.target.selectedIndex];
    const newName = opt ? opt.text : '?';
    const ok = window.confirm(
      `現在のテンプレートには未保存の変更があります。\n` +
      `「${newName}」に切り替えると変更は失われます。\n\n` +
      `本当に切り替えますか？`
    );
    if (!ok) {
      // 元のプリセットに戻す（meta.id が options に存在すれば選択される、無ければ空欄）
      event.target.value = blindsEditor.meta?.id || '';
      return;
    }
  }
  await loadPresetIntoDraft(newId);
});

// STEP 6.7: ユーザープリセット数が上限到達時はメッセージで阻止
async function _checkUserPresetLimit() {
  try {
    const list = await window.api.presets.listUser() || [];
    if (list.length >= MAX_USER_PRESETS) {
      window.alert(`保存済みテンプレートの数が上限（${MAX_USER_PRESETS} 件）に達しています。\n不要なテンプレートを削除してから新規作成・複製してください。`);
      setBlindsHint('上限到達のため新規作成・複製できません', 'error');
      return false;
    }
  } catch (_) { /* 続行 */ }
  return true;
}

// 新規プリセット作成（ユーザー側）— 複製と同じく名前欄に focus + select
el.presetNew?.addEventListener('click', async () => {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B6: hall はプリセット操作不可
  if (!(await _checkUserPresetLimit())) return;
  // STEP 10 フェーズB: 新規プリセットは現在の structureType を継承（既存 draft 由来）し、
  //   無ければ 'BLIND' で開始。levels は新フィールド名（sb/bb/bbAnte）を初期値 0 で 1 行。
  const newStructureType = (blindsEditor.draft && blindsEditor.draft.structureType) || 'BLIND';
  const _newFields = getStructureFieldsRenderer(newStructureType);
  const _newLv = { level: 1, durationMinutes: 5, isBreak: false };
  for (const f of _newFields) _newLv[f] = 0;
  blindsEditor.draft = {
    id: generateUniqueId('user'),  // STEP 10 フェーズC.1.1 Fix 7: ID 衝突防止
    name: '新しいテンプレート',
    structureType: newStructureType,
    levels: renumberLevels([_newLv])
  };
  blindsEditor.meta = { id: blindsEditor.draft.id, name: blindsEditor.draft.name, builtin: false };
  setDirty(true);
  setBlindsHint('新規テンプレートを作成しました。名前を変更して「適用」で保存されます。');
  el.presetSelect.value = '';
  el.presetName.value = blindsEditor.draft.name;
  renderBlindsTable();
  updatePresetActions();
  // STEP 10 フェーズC.1-A2 Fix: 編集可能状態を強制保証（builtin → user 移行時の readonly 残存対策）
  ensureEditorEditableState();
  if (el.presetName) {
    requestAnimationFrame(() => {
      // RAF 内でも再保証（DOM 更新後のタイミング保護）
      ensureEditorEditableState();
      el.presetName.focus();
      el.presetName.select();
    });
  }
});

// プリセット複製（同梱でも複製先はユーザー扱い）
// 複製直後にユーザーがすぐ名前を変えられるよう、name 入力欄に focus + 全選択する
el.presetDuplicate?.addEventListener('click', async () => {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B6: hall はプリセット操作不可
  if (!blindsEditor.draft) return;
  if (!(await _checkUserPresetLimit())) return;
  const cloned = cloneStructure(blindsEditor.draft);
  cloned.id = generateUniqueId('user');  // STEP 10 フェーズC.1.1 Fix 7: ID 衝突防止
  cloned.name = (cloned.name || 'テンプレート') + '（コピー）';
  blindsEditor.draft = cloned;
  blindsEditor.meta = { id: cloned.id, name: cloned.name, builtin: false };
  setDirty(true);
  setBlindsHint('テンプレートを複製しました。名前を変更して「適用」で保存されます。');
  el.presetSelect.value = '';
  el.presetName.value = cloned.name;
  renderBlindsTable();
  updatePresetActions();   // ← これで readOnly=false が確定
  // STEP 10 フェーズC.1-A2 Fix: 「複製して編集」直後に readonly が残るバグ修正。
  //   builtin → user への移行で、setBlindsTableReadonly(false) が複数経路で確実に呼ばれるよう強化。
  //   ensureEditorEditableState は readOnly/disabled/aria-disabled/is-readonly クラスを一括リセット。
  ensureEditorEditableState();
  // 複製直後の名前編集を即座に可能にする
  if (el.presetName) {
    // 次フレームで focus + select（DOM 更新後でないと focus が外れることがある）+ 再保証
    requestAnimationFrame(() => {
      ensureEditorEditableState();   // RAF 内でも最終保証
      el.presetName.focus();
      el.presetName.select();
    });
  }
});

// プリセット削除（ユーザー作成のみ）
el.presetDelete?.addEventListener('click', async () => {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B6: hall はプリセット操作不可
  if (!blindsEditor.meta || blindsEditor.meta.builtin) return;
  const deletedId = blindsEditor.meta.id;
  const deletedName = blindsEditor.meta.name;
  // STEP 10 フェーズC.1.1 Fix 6: 参照中トーナメントを事前検出して警告。
  //   削除すると active な blindPresetId が孤児化し、demo-fast に silent fallback されるため、
  //   ユーザーに削除の影響を明示してから確認を取る。
  let confirmMsg = `テンプレート「${deletedName}」を削除しますか？`;
  try {
    const tournaments = await window.api.tournaments.list?.() || [];
    const usage = tournaments.filter((t) => t.blindPresetId === deletedId);
    if (usage.length > 0) {
      const names = usage.slice(0, 3).map((t) => `「${t.name || t.title || '(無題)'}」`).join('、');
      const moreSuffix = usage.length > 3 ? ` 他 ${usage.length - 3} 件` : '';
      confirmMsg = `テンプレート「${deletedName}」は ${names}${moreSuffix} で使用中です。\n`
                 + `削除すると、これらのトーナメントは「demo-fast」に自動切替されます。\n\n`
                 + `本当に削除しますか？`;
    }
  } catch (_) { /* 取得失敗時は通常の確認のみで続行 */ }
  if (!confirm(confirmMsg)) return;
  try {
    const result = await window.api.presets.deleteUser(deletedId);
    if (!result?.ok) {
      setBlindsHint('削除に失敗しました', 'error');
      return;
    }
    // STEP 7 (D-3): 削除されたプリセットの levels キャッシュをクリア
    blindPresetCache.delete(deletedId);
    await refreshPresetList();
    // 削除後は同梱の最初のプリセットへ
    const first = blindsEditor.presetList[0];
    if (first) {
      await loadPresetIntoDraft(first.id);
    } else {
      blindsEditor.draft = null;
      blindsEditor.meta = null;
    }
    setBlindsHint('テンプレートを削除しました', 'success');
  } catch (err) {
    setBlindsHint('削除エラー: ' + err.message, 'error');
  }
});

// JSON エクスポート（Blob + ダウンロードリンク）
el.presetExport?.addEventListener('click', () => {
  if (!blindsEditor.draft) return;
  const json = exportToJSON(blindsEditor.draft);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(blindsEditor.draft.name || 'preset').replace(/[\\/:*?"<>|]/g, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setBlindsHint('JSON をエクスポートしました', 'success');
});

// JSON インポート（隠しファイル input をトリガ）
el.presetImport?.addEventListener('click', () => {
  el.presetImportFile?.click();
});

el.presetImportFile?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const raw = await file.text();
    // STEP 10 フェーズC.2.7-audit-fix: BOM ストリップ
    const text = stripBom(raw);
    const parsed = importFromJSON(text);
    if (!parsed) {
      setBlindsHint('インポート失敗: JSON が無効です', 'error');
      return;
    }
    // 既存 ID と衝突する場合は新 ID を割り当てる
    const allIds = new Set(blindsEditor.presetList.map((p) => p.id));
    if (allIds.has(parsed.id)) {
      parsed.id = generateUniqueId('user');   // STEP 10 フェーズC.1.1 Fix 7: ID 衝突防止
    }
    const result = await window.api.presets.saveUser(parsed);
    if (!result?.ok) {
      setBlindsHint('インポート失敗: 保存できませんでした', 'error');
      return;
    }
    // STEP 7 (D-3): 保存後はキャッシュを無効化（古い levels を返さないように）
    blindPresetCache.delete(result.id);
    await refreshPresetList();
    await loadPresetIntoDraft(result.id);
    setBlindsHint('JSON をインポートしました', 'success');
  } catch (err) {
    setBlindsHint('インポート失敗: ' + err.message, 'error');
  } finally {
    event.target.value = '';   // 同じファイル再選択を許可
  }
});

// 保存ロジックの共通コア（「保存」「適用」両ボタンから呼ぶ）
// dirty な draft を電気的にユーザープリセットへ書き出す。
//
// 動作（STEP 6.21.5 改訂）:
// - 同梱プリセット（builtin）編集 → ユーザーが入力した name を使って新規ユーザープリセット作成
//   ただし name が builtin の元名と同一なら拒否（フォーマット保護、ユーザーに別名を促す）
//   旧仕様の「（編集版）」自動サフィックスは廃止
// - ユーザープリセット編集 → 上書き保存
// - 保存後、draft / meta / UI を同期し dirty 解除
//
// 呼び出し前に caller 側で `isDirty` と `validateStructure` をチェックする前提
// 戻り値: 成功時 true、失敗時 false
// STEP 10 フェーズB.fix4: active トーナメントの blindPresetId のみを永続化する最小ヘルパ。
//   _savePresetCore 内で呼び、新規/上書き保存したプリセットを active トーナメントに自動紐付けする。
//   API は window.api.tournaments.getActive + save（main.js 側の normalizeTournament が他フィールドを保持）。
//   失敗時は警告ログのみ（メモリ上の tournamentState は更新済、次回保存で復元可）。
async function persistActiveTournamentBlindPresetId(newPresetId) {
  if (!window.api?.tournaments?.getActive || !window.api?.tournaments?.save) {
    console.warn('persistActiveTournamentBlindPresetId: tournaments API 不在');
    return;
  }
  const active = await window.api.tournaments.getActive();
  if (!active || active.id !== tournamentState.id) {
    // 何らかの理由で active と tournamentState が乖離している場合はスキップ
    return;
  }
  // STEP 10 フェーズC.2.7-D Fix 3 (A2 race 修正): timerState を save payload から除外。
  //   問題: getActive と save の間に schedulePersistTimerState の 500ms debounce が発火すると
  //         setTimerState 経由で新 timerState が書き込まれる。`{...active, blindPresetId}` の
  //         active は getActive 時点のスナップショットで古い timerState を持つため、save で巻き戻る。
  //   解決: timerState を payload から除外すれば main 側 normalizeTournament の
  //         `'timerState' in t === false` 経路で既存値が保護される（fallback から維持）。
  //   関連: handleTournamentSave / SaveApply / SelectChange は readTournamentForm 経由で
  //         元から timerState を含めない設計のため影響なし。Duplicate / New は明示的に idle を設定（意図的）。
  const { timerState, ...rest } = active;
  const updated = { ...rest, blindPresetId: newPresetId };
  await window.api.tournaments.save(updated);
}

async function _savePresetCore() {
  let presetToSave;
  if (blindsEditor.meta?.builtin) {
    // STEP 6.21.5: フォーマット保護 — 元名と同一 / 空 のまま保存しようとしたら拒否
    const inputName = (blindsEditor.draft.name || '').trim();
    const builtinName = (blindsEditor.meta.name || '').trim();
    if (!inputName) {
      setBlindsHint('保存失敗: 名前を入力してください', 'error');
      return false;
    }
    if (inputName === builtinName) {
      setBlindsHint('保存失敗: フォーマットの上書きはできません。別の名前を入力してください', 'error');
      return false;
    }
    // 別 id でユーザープリセットへクローン保存（ユーザーが入力した名前をそのまま使う）
    presetToSave = cloneStructure(blindsEditor.draft);
    presetToSave.id = generateUniqueId('user');   // STEP 10 フェーズC.1.1 Fix 7: ID 衝突防止
    presetToSave.name = inputName;
  } else {
    // ユーザー → そのまま上書き保存
    presetToSave = cloneStructure(blindsEditor.draft);
  }

  try {
    const result = await window.api.presets.saveUser(presetToSave);
    if (!result?.ok) {
      if (result?.error === 'limit-exceeded') {
        setBlindsHint(result.message || `保存済みテンプレートは ${MAX_USER_PRESETS} 件までです`, 'error');
      } else {
        setBlindsHint('保存に失敗しました', 'error');
      }
      return false;
    }
    // STEP 7 (D-3): 保存後は該当プリセットのキャッシュを無効化
    blindPresetCache.delete(presetToSave.id);
    // draft / meta / UI を保存後の状態に同期
    blindsEditor.draft.id = presetToSave.id;
    blindsEditor.draft.name = presetToSave.name;
    blindsEditor.meta = { id: presetToSave.id, name: presetToSave.name, builtin: false };
    await refreshPresetList();
    el.presetSelect.value = presetToSave.id;
    el.presetName.value = presetToSave.name;
    setDirty(false);
    updatePresetActions();   // 同梱→ユーザーへ昇格時の readOnly 連動

    // ★ STEP 10 フェーズB.fix4: 保存したプリセットを active トーナメントに自動紐付け ★
    //   - 次回このトーナメントを再選択した際、自動的に保存したプリセットが復元される
    //   - tournamentState のメモリ更新 + フォーム ドロップダウン同期 + 永続化（save IPC 経由）
    //   - 失敗してもメモリ上は更新済 → 永続化失敗時は警告のみで保存処理は成功扱い
    if (tournamentState.id) {
      tournamentState.blindPresetId = presetToSave.id;
      if (el.tournamentBlindPreset) el.tournamentBlindPreset.value = presetToSave.id;
      try {
        await persistActiveTournamentBlindPresetId(presetToSave.id);
      } catch (err) {
        console.warn('blindPresetId 永続化に失敗:', err);
      }
    }

    return true;
  } catch (err) {
    setBlindsHint('保存エラー: ' + err.message, 'error');
    return false;
  }
}

// 「保存」ボタン: 保存のみ、タイマーには触らない（メインクロックは無変更）
async function handlePresetSave() {
  if (window.appRole === 'hall') return;   // v2.0.0 STEP 3: ホール側はプリセット保存不可
  if (!blindsEditor.draft) return;
  // STEP 10 フェーズC.2.5: MIX 専用事前チェック（より明確なエラーメッセージ）
  //   ブレイク以外の全レベルに subGameType が設定されているか確認。
  if (blindsEditor.draft.structureType === 'MIX') {
    const missing = blindsEditor.draft.levels.findIndex(
      (lv) => !lv.isBreak && (typeof lv.subGameType !== 'string' || !lv.subGameType)
    );
    if (missing >= 0) {
      setBlindsHint(`保存失敗: Lv${missing + 1} のゲーム種が未選択です`, 'error');
      return;
    }
  }
  if (!validateStructure(blindsEditor.draft)) {
    setBlindsHint('保存失敗: 通常レベル 1 件以上 + 各値が 0 以上の数値である必要があります', 'error');
    return;
  }
  if (!blindsEditor.isDirty) {
    setBlindsHint('変更がないため保存はスキップしました');
    setTimeout(() => setBlindsHint(''), 2000);
    return;
  }
  // STEP 10 フェーズC.2 軽 10: 保存中ロック UI（ボタンを一時 disabled）
  const _wasDisabled = el.presetSave?.disabled;
  if (el.presetSave) el.presetSave.disabled = true;
  try {
    const ok = await _savePresetCore();
    if (ok) {
      const soft = checkStructureSoftWarnings(blindsEditor.draft);
      // STEP 10 フェーズC.2.7-B Fix 2: タイマー進行中 / PAUSED 中は「適用」ボタンで反映する旨を明示。
      //   「保存」と「保存して適用」の役割分離を UI hint で伝える。
      const { status: _saveHintStatus } = getState();
      const isTimerActive = _saveHintStatus !== States.IDLE;
      const baseMsg = isTimerActive
        ? '保存しました（メイン画面に反映するには「適用」ボタンを押してください）'
        : '保存しました';
      const ttl = isTimerActive ? 4500 : 2000;
      if (!soft.ok) {
        setBlindsHint(`${baseMsg} 注意: ${soft.warnings[0]}`, 'success');
        setTimeout(() => setBlindsHint(''), Math.max(ttl, 4000));
      } else {
        setBlindsHint(baseMsg, 'success');
        setTimeout(() => setBlindsHint(''), ttl);
      }
    }
  } finally {
    // updatePresetActions が後で正しい disabled を再計算するが、
    // 即時 enable で UI 復帰させる（race してもユーザー操作優先）
    if (el.presetSave) el.presetSave.disabled = !!_wasDisabled;
  }
}

// STEP 6.21.5.1: 「ブラインド適用」3 択ダイアログを Promise ベースで開く
// 戻り値: 'reset' | 'continue' | 'apply-only' | 'cancel'
// STEP 10 フェーズC.2.7-B Fix 1: PAUSED 中は「構造のみ適用（一時停止維持）」ボタンを表示
//   - showApplyOnly=true（PAUSED 限定）で、構造を保存・適用するが timer 状態は無変更
//   - showApplyOnly=false（RUNNING/BREAK）で、apply-only ボタンは hidden
// STEP 7 (F-1): Esc キー（dialog cancel イベント）でも resolve('cancel') されるよう紐付け
let _blindsApplyHandlers = null;
function showBlindsApplyModal({ showApplyOnly = false } = {}) {
  return new Promise((resolve) => {
    if (!el.blindsApplyDialog) { resolve('cancel'); return; }
    // 旧ハンドラを除去（多重登録防止）
    if (_blindsApplyHandlers) {
      el.blindsApplyReset?.removeEventListener('click', _blindsApplyHandlers.reset);
      el.blindsApplyContinue?.removeEventListener('click', _blindsApplyHandlers.cont);
      el.blindsApplyOnly?.removeEventListener('click', _blindsApplyHandlers.applyOnly);
      el.blindsApplyCancel?.removeEventListener('click', _blindsApplyHandlers.cancel);
      el.blindsApplyDialog.removeEventListener('cancel', _blindsApplyHandlers.escCancel);
    }
    // PAUSED 限定で apply-only ボタンを表示
    if (el.blindsApplyOnly) el.blindsApplyOnly.hidden = !showApplyOnly;
    const close = () => {
      if (typeof el.blindsApplyDialog.close === 'function') el.blindsApplyDialog.close();
    };
    const onReset     = () => { close(); resolve('reset'); };
    const onCont      = () => { close(); resolve('continue'); };
    const onApplyOnly = () => { close(); resolve('apply-only'); };
    const onCancel    = () => { close(); resolve('cancel'); };
    // Esc: dialog のデフォルト close に任せて、resolve だけ確実に
    const onEscCancel = () => { resolve('cancel'); };
    _blindsApplyHandlers = { reset: onReset, cont: onCont, applyOnly: onApplyOnly, cancel: onCancel, escCancel: onEscCancel };
    el.blindsApplyReset?.addEventListener('click', onReset);
    el.blindsApplyContinue?.addEventListener('click', onCont);
    el.blindsApplyOnly?.addEventListener('click', onApplyOnly);
    el.blindsApplyCancel?.addEventListener('click', onCancel);
    el.blindsApplyDialog.addEventListener('cancel', onEscCancel);
    if (typeof el.blindsApplyDialog.showModal === 'function') {
      el.blindsApplyDialog.showModal();
    }
  });
}

// STEP 6.21.5.1: 「経過時間を保持して適用」処理
// 現タイマーの状態を捕獲 → 新 levels で computeLiveTimerState 再計算 → 適用
//   境界条件:
//     - 新 levels のレベル数が現 currentLevel より少ない / 経過時間超過
//       → computeLiveTimerState が最終レベル末尾 paused 化（STEP 6.21.2 で実装済）
async function applyBlindsKeepProgress(newDraft) {
  // 1) 現在の timerState を捕獲（active = 編集対象前提）
  const currentTs = captureCurrentTimerState();
  // 2) 新 levels を当てて live state を再計算（経過秒は維持、レベル繰上げ自動）
  const newLevels = newDraft.levels || [];
  // captureCurrentTimerState は status='running' 時に startedAt=Date.now() を返すため、
  // computeLiveTimerState は (now - startedAt)=0 の状態で純粋にレベル繰上げのみ計算
  const adjustedTs = computeLiveTimerState(currentTs, newLevels);
  // 3) 新ブラインド構造を timer.js に適用 + 経過時間を復元（音は通常通り）
  setStructure(cloneStructure(newDraft));
  // levels はキャッシュ（次回 renderTournamentList 等で参照）
  if (newDraft.id) blindPresetCache.set(newDraft.id, newLevels);
  applyTimerStateToTimer(adjustedTs, newLevels, { silent: false });
  // STEP 7 (D-4): applyTimerStateToTimer 内の timerStartAtLevel / timerAdvanceBy / timerPause が
  //               state 変化を起こすため、subscribe 経由で schedulePersistTimerState（debounce 500ms）が
  //               自動発火 → active の timerState が永続化される。明示的な setTimerState 呼び出しは冗長
}

// 「適用」ボタン: 保存（dirty 時のみ）+ 構造を active へ commit
// STEP 6.21.5.1: 進行中なら 3択モーダル（reset / continue / cancel）。idle は即時適用
async function handlePresetApply() {
  if (window.appRole === 'hall') return;   // v2.0.0 STEP 3: ホール側はプリセット適用不可
  if (!blindsEditor.draft) return;
  // STEP 10 フェーズC.2.5: MIX 専用事前チェック（保存と同じ整合性検証）
  if (blindsEditor.draft.structureType === 'MIX') {
    const missing = blindsEditor.draft.levels.findIndex(
      (lv) => !lv.isBreak && (typeof lv.subGameType !== 'string' || !lv.subGameType)
    );
    if (missing >= 0) {
      setBlindsHint(`適用失敗: Lv${missing + 1} のゲーム種が未選択です`, 'error');
      return;
    }
  }
  if (!validateStructure(blindsEditor.draft)) {
    setBlindsHint('適用失敗: 構造が無効です（数値や行を確認してください）', 'error');
    return;
  }
  const { status } = getState();
  const isTimerActive = status !== States.IDLE;

  // 進行中: 3 択モーダルでユーザー選択
  let mode = 'reset';   // idle / 即時適用時のデフォルト
  if (isTimerActive) {
    // ヒント文言（新 levels の数が現在 level より少ない場合は警告）
    if (el.blindsApplyHint) {
      const newLevelCount = (blindsEditor.draft.levels || []).length;
      const { currentLevelIndex } = getState();
      if (newLevelCount <= currentLevelIndex) {
        el.blindsApplyHint.textContent = '※ 新ブラインドのレベル数が現在のレベルより少ないため、保持選択時は最終レベル末尾で停止します';
      } else {
        el.blindsApplyHint.textContent = '';
      }
    }
    // STEP 10 フェーズC.2.7-B Fix 1: PAUSED 中は「構造のみ適用（一時停止維持）」を 3 択目として表示
    const showApplyOnly = (status === States.PAUSED);
    mode = await showBlindsApplyModal({ showApplyOnly });
    if (mode === 'cancel') {
      setBlindsHint('適用をキャンセルしました', '');
      setTimeout(() => setBlindsHint(''), 2000);
      return;
    }
  }

  // dirty 時のみ保存（クリーン状態で「適用」を押した場合はタイマー反映だけ）
  // ※ 保存は draft の id を変えうる（同梱→新 id）ため、以降は blindsEditor.draft を参照
  if (blindsEditor.isDirty) {
    const ok = await _savePresetCore();
    if (!ok) return;
  }

  try {
    if (mode === 'continue') {
      // STEP 6.21.5.1: 経過時間保持で適用
      await applyBlindsKeepProgress(blindsEditor.draft);
      setBlindsHint('適用しました（経過時間を保持）', 'success');
    } else if (mode === 'apply-only') {
      // STEP 10 フェーズC.2.7-B Fix 1: 構造のみ適用、タイマー状態は無変更（PAUSED 維持）。
      //   setStructure で active 構造を差し替え、メイン画面 BLINDS / NEXT カードを再描画。
      //   timer.js には触らない（pausedRemainingMs / currentLevelIndex / status はすべて維持）。
      setStructure(cloneStructure(blindsEditor.draft));
      if (blindsEditor.draft.id) {
        blindPresetCache.set(blindsEditor.draft.id, blindsEditor.draft.levels);
      }
      const { currentLevelIndex } = getState();
      renderCurrentLevel(currentLevelIndex);
      renderNextLevel(currentLevelIndex);
      setBlindsHint('適用しました（一時停止状態を維持、タイマー無変更）', 'success');
    } else {
      // 既定: リセット適用
      // STEP 10 フェーズC.2.7-A Fix 1（致命バグ 8-8 修正）: ブラインド構造のリセットのみ。
      //   tournamentRuntime（プレイヤー数・リエントリー・アドオン）は保持する。
      setStructure(cloneStructure(blindsEditor.draft));
      resetBlindProgressOnly();
      setBlindsHint(isTimerActive ? '適用しました（タイマーをリセット）' : '適用しました', 'success');
    }
    setTimeout(() => setBlindsHint(''), 2000);
  } catch (err) {
    setBlindsHint('適用失敗: ' + err.message, 'error');
  }
}

el.presetSave?.addEventListener('click', handlePresetSave);
el.presetApply?.addEventListener('click', handlePresetApply);

// 設定ダイアログを開く際 / blinds タブを表示する際にエディタを初期化
async function ensureBlindsEditorLoaded() {
  if (!window.api?.presets) return;
  await refreshPresetList();
  if (!blindsEditor.initialized) {
    // 初回: 現在の active 構造（起動時に loadPreset した demo-fast）を draft に流し込む
    const active = getStructure();
    if (active) {
      blindsEditor.draft = cloneStructure(active);
      blindsEditor.draft.levels = renumberLevels(blindsEditor.draft.levels);
      blindsEditor.meta = {
        id: active.id,
        name: active.name,
        builtin: blindsEditor.presetList.find((p) => p.id === active.id)?.builtin ?? false
      };
      el.presetSelect.value = active.id || '';
      el.presetName.value = active.name || '';
      renderBlindsTable();
      updatePresetActions();
    }
    blindsEditor.initialized = true;
  } else if (blindsEditor.draft) {
    // 既に初期化済み: ドロップダウンの選択状態だけ復元
    el.presetSelect.value = blindsEditor.meta?.id || '';
    // STEP 7.x ①: タブ再表示時も同梱警告の表示状態を最新化（meta が変わっていれば反映）
    updatePresetActions();
    // STEP 10 フェーズC.1.2-bugfix: タブ再表示時も editable state を再保証
    //   （meta.builtin===true なら no-op、user preset 時のみ確実に readonly クリア）
    ensureEditorEditableState();
  }
}

// ===== STEP 4: 音タブ =====

// 現在の音設定（store と同期）。永続化はチェックボックス change / 音量 input で都度行う
// reverbEnabled は STEP 4 仕上げ② で UI 削除。store には互換のため残置するが、レンダラ側では使わない
const audioState = {
  masterVolume: 0.8,
  warning1MinEnabled: true,
  warning10SecEnabled: true,
  countdown5SecEnabled: true,
  levelEndEnabled: true,
  breakEndEnabled: true,
  startEnabled: true,           // STEP 5: スタート音
  // STEP 4 仕上げ④: 音色2バリアント
  levelEndVariant: 'default',
  countdownTickVariant: 'default'
};

function setAudioHint(message, kind = '') {
  if (!el.audioHint) return;
  el.audioHint.textContent = message || '';
  el.audioHint.className = 'audio-editor__hint';
  if (kind === 'error')   el.audioHint.classList.add('is-error');
  if (kind === 'success') el.audioHint.classList.add('is-success');
}

// store → audioState → DOM
function syncAudioFormFromState() {
  if (!el.audioMasterVolume) return;
  const pct = Math.round((audioState.masterVolume ?? 0.8) * 100);
  el.audioMasterVolume.value = String(pct);
  if (el.audioVolumeDisplay) el.audioVolumeDisplay.textContent = `${pct}%`;
  if (el.audioWarning1Min)   el.audioWarning1Min.checked   = !!audioState.warning1MinEnabled;
  if (el.audioWarning10Sec)  el.audioWarning10Sec.checked  = !!audioState.warning10SecEnabled;
  if (el.audioCountdown5Sec) el.audioCountdown5Sec.checked = !!audioState.countdown5SecEnabled;
  if (el.audioLevelEnd)      el.audioLevelEnd.checked      = !!audioState.levelEndEnabled;
  if (el.audioBreakEnd)      el.audioBreakEnd.checked      = !!audioState.breakEndEnabled;
  if (el.audioStart)         el.audioStart.checked         = !!audioState.startEnabled;
  if (el.audioVariantLevelEnd) {
    el.audioVariantLevelEnd.value = audioState.levelEndVariant === 'variant2' ? 'variant2' : 'default';
  }
  if (el.audioVariantCountdownTick) {
    el.audioVariantCountdownTick.value = audioState.countdownTickVariant === 'variant2' ? 'variant2' : 'default';
  }
  setAudioHint('');
}

// 音量スライダーの IPC 保存を debounce（連続ドラッグ時の I/O 削減）
let audioSaveTimer = null;
function persistAudioPartial(partial) {
  if (audioSaveTimer) clearTimeout(audioSaveTimer);
  audioSaveTimer = setTimeout(async () => {
    audioSaveTimer = null;
    if (!window.api?.audio?.set) return;
    try {
      const merged = await window.api.audio.set(partial);
      if (merged) {
        Object.assign(audioState, merged);
        applyAudioSettings(merged);
      }
    } catch (err) {
      console.warn('音設定の保存に失敗:', err);
    }
  }, 200);
}

// 音量スライダー: input で即時 audioSetMasterVolume + 表示更新 + IPC保存（debounce）
el.audioMasterVolume?.addEventListener('input', async () => {
  const pct = Number(el.audioMasterVolume.value);
  const v = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) / 100 : 0.8;
  audioState.masterVolume = v;
  audioSetMasterVolume(v);
  if (el.audioVolumeDisplay) el.audioVolumeDisplay.textContent = `${Math.round(v * 100)}%`;
  // 初回ユーザー操作で AudioContext を resume
  await ensureAudioReady();
  persistAudioPartial({ masterVolume: v });
});

// 各チェックボックスの change ハンドラ生成
function bindAudioCheckbox(inputEl, storeKey, soundId) {
  if (!inputEl) return;
  inputEl.addEventListener('change', async () => {
    const enabled = Boolean(inputEl.checked);
    audioState[storeKey] = enabled;
    audioSetEnabled(soundId, enabled);
    await ensureAudioReady();
    persistAudioPartial({ [storeKey]: enabled });
  });
}

bindAudioCheckbox(el.audioWarning1Min,   'warning1MinEnabled',   'warning-1min');
bindAudioCheckbox(el.audioWarning10Sec,  'warning10SecEnabled',  'warning-10sec');
bindAudioCheckbox(el.audioCountdown5Sec, 'countdown5SecEnabled', 'countdown-tick');
bindAudioCheckbox(el.audioLevelEnd,      'levelEndEnabled',      'level-end');
bindAudioCheckbox(el.audioBreakEnd,      'breakEndEnabled',      'break-end');
bindAudioCheckbox(el.audioStart,         'startEnabled',         'start');

// 音色2バリアント切替（STEP 4 仕上げ④）
el.audioVariantLevelEnd?.addEventListener('change', async () => {
  const value = el.audioVariantLevelEnd.value === 'variant2' ? 'variant2' : 'default';
  audioState.levelEndVariant = value;
  await ensureAudioReady();
  await audioSetVariant('level-end', value);
  persistAudioPartial({ levelEndVariant: value });
});

el.audioVariantCountdownTick?.addEventListener('change', async () => {
  const value = el.audioVariantCountdownTick.value === 'variant2' ? 'variant2' : 'default';
  audioState.countdownTickVariant = value;
  await ensureAudioReady();
  await audioSetVariant('countdown-tick', value);
  persistAudioPartial({ countdownTickVariant: value });
});

// 試聴ボタン: ON/OFF を無視して必ず鳴らす（playSoundForce）
el.audioTestButtons?.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const soundId = btn.dataset.testSound;
    if (!soundId) return;
    await ensureAudioReady();
    playSoundForce(soundId);
    setAudioHint(`「${btn.textContent}」を再生`, 'success');
    setTimeout(() => setAudioHint(''), 1200);
  });
});

// ===== 設定タブ版マーキーフォーム =====
// Ctrl+T ダイアログとは別の DOM だが、データソースは同じ electron-store。
// プレビュー押下で applyMarquee + setMarquee を実行 → どちらの UI を次に開いても最新が反映される。

let lastMarqueeSettings = { enabled: true, text: '', speed: 'normal' };

// STEP 6.22.1.fix: テロップのプレビュー中フラグ。
// プレビュー押下 → true、保存または復元 → false。
// ダイアログ閉じ時 / 設定ダイアログ閉じ時 / active 切替時に true なら lastMarqueeSettings で applyMarquee を呼んで復元する。
let _marqueePreviewing = false;
function restoreMarqueeIfPreviewing() {
  if (_marqueePreviewing) {
    _marqueePreviewing = false;
    applyMarquee(lastMarqueeSettings);
  }
}

function syncMarqueeTabFormFromCurrent() {
  if (!el.marqueeTabEnabled) return;
  // STEP 10 フェーズB.fix9: 入力中（テロップ textarea にユーザーが文字打鍵中等）はスキップ
  //   applyTournament 経由で別トーナメントの marqueeSettings から上書きされる経路がある。
  //   ユーザーがフォーカスを外せば次回呼び出しで同期される。
  if (isUserTypingInInput()) return;
  el.marqueeTabEnabled.checked = Boolean(lastMarqueeSettings.enabled);
  el.marqueeTabText.value = lastMarqueeSettings.text || '';
  for (const radio of el.marqueeTabSpeedRadios) {
    radio.checked = radio.value === lastMarqueeSettings.speed;
  }
}

function readMarqueeTabForm() {
  let speed = 'normal';
  for (const radio of el.marqueeTabSpeedRadios) {
    if (radio.checked) { speed = radio.value; break; }
  }
  return {
    enabled: el.marqueeTabEnabled.checked,
    text: el.marqueeTabText.value,
    speed
  };
}

// STEP 6.8: プレビューは表示のみ（IPC 保存しない）。再起動で消える一時テスト用途。
// STEP 6.22.1.fix: プレビュー中フラグを立て、ダイアログ閉じ時に復元される
function handleMarqueeTabPreview() {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B6: hall はマーキー操作不可
  const next = readMarqueeTabForm();
  _marqueePreviewing = true;
  applyMarquee(next);
  setMarqueeTabHint('プレビュー中（保存はされていません。閉じると元に戻ります）');
  setTimeout(() => setMarqueeTabHint(''), 2500);
}

// STEP 6.8: 保存は永続化＋メイン画面反映。lastMarqueeSettings を更新して Ctrl+T 側にも同期。
async function handleMarqueeTabSave() {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B6: hall はマーキー操作不可
  const next = readMarqueeTabForm();
  lastMarqueeSettings = next;
  _marqueePreviewing = false;   // STEP 6.22.1.fix: 保存したのでプレビュー解除
  applyMarquee(next);
  // STEP 6.22.1: 保存先を active トーナメントの marqueeSettings に切替（グローバル marquee は触らない）
  if (window.api?.tournaments?.setMarqueeSettings && tournamentState.id) {
    try {
      await window.api.tournaments.setMarqueeSettings(tournamentState.id, next);
      setMarqueeTabHint('保存しました', 'success');
    } catch (err) {
      console.warn('マーキー設定の保存に失敗（タブ版）:', err);
      setMarqueeTabHint('保存に失敗しました', 'error');
    }
  }
  setTimeout(() => setMarqueeTabHint(''), 2500);
}

function setMarqueeTabHint(message, kind = '') {
  if (!el.marqueeTabHint) return;
  el.marqueeTabHint.textContent = message || '';
  el.marqueeTabHint.className = 'tournament-editor__hint';
  if (kind === 'error')   el.marqueeTabHint.classList.add('is-error');
  if (kind === 'success') el.marqueeTabHint.classList.add('is-success');
}

el.marqueeTabPreview?.addEventListener('click', handleMarqueeTabPreview);
el.marqueeTabSave?.addEventListener('click', handleMarqueeTabSave);

el.bgPicker?.addEventListener('click', (event) => {
  const target = event.target.closest('.bg-thumb');
  if (!target) return;
  const value = target.dataset.bgValue;
  if (value) handleBgThumbClick(value);
});

// STEP 10 フェーズC.1.3: カスタム画像詳細パネルのハンドラ群
el.bgImageSelect?.addEventListener('click', handleBgImageSelect);
el.bgImageClear?.addEventListener('click', handleBgImageClear);
document.querySelectorAll('input[name="bg-overlay-intensity"]').forEach((radio) => {
  radio.addEventListener('change', (e) => {
    if (e.target.checked) handleBgImageOverlayChange(e.target.value);
  });
});

// STEP 10 フェーズC.1.4: 休憩中スライドショー設定パネルのハンドラ群
el.breakImagesAdd?.addEventListener('click', handleBreakImagesAdd);
el.breakImagesClear?.addEventListener('click', handleBreakImagesClear);
el.breakImageInterval?.addEventListener('change', (e) => handleBreakImageIntervalChange(e.target.value));
document.querySelectorAll('input[name="pip-size"]').forEach((radio) => {
  radio.addEventListener('change', (e) => {
    if (e.target.checked) handlePipSizeChange(e.target.value);
  });
});
el.pipShowTimer?.addEventListener('click', handlePipShowTimer);
el.pipShowSlideshow?.addEventListener('click', handlePipShowSlideshow);

el.fontPicker?.addEventListener('click', (event) => {
  const target = event.target.closest('.font-thumb');
  if (!target) return;
  const value = target.dataset.fontValue;
  if (value) handleFontThumbClick(value);
});

// 設定ダイアログ閉じる: dirty 時は確認ダイアログ
// STEP 6.22.1.fix: 閉じる時にテロップのプレビューを保存値へ復元（dialog.close 経由でも発火）
el.settingsClose?.addEventListener('click', () => {
  if (blindsEditor.isDirty &&
      !window.confirm('ブラインド構造の編集に未保存の変更があります。閉じてよいですか？')) {
    return;
  }
  el.settingsDialog?.close();
});
// dialog の close イベント（Esc キー / バックドロップ / .close() 呼び出し全てで発火）でも復元
el.settingsDialog?.addEventListener('close', () => {
  restoreMarqueeIfPreviewing();
});
// STEP 10 フェーズC.2 中 6: Esc キー押下時の cancel イベントでも dirty 確認。
//   X ボタンには既に L4310 で confirm 入っているが、Esc では素通りしていた。
el.settingsDialog?.addEventListener('cancel', (event) => {
  if (blindsEditor.isDirty
      && !window.confirm('ブラインド構造の編集に未保存の変更があります。閉じてよいですか？')) {
    event.preventDefault();
  }
});

// STEP 7: レイアウト検証（__autoCheck / __pokerHooks）は配布前クリーンアップで削除済

// STEP 6.8: Ctrl+T ダイアログのプレビューは表示のみ（IPC 保存しない）
// STEP 6.22.1.fix: プレビュー中フラグを立て、ダイアログ閉じ時に復元される
function handleMarqueePreview() {
  const next = readMarqueeForm();
  _marqueePreviewing = true;
  applyMarquee(next);
}

// STEP 6.8: Ctrl+T ダイアログの「保存」ボタン → 永続化＋メイン画面反映
// STEP 6.22.1: 保存先を active トーナメントの marqueeSettings に切替（グローバル marquee は触らない）
async function handleMarqueeSave() {
  if (window.appRole === 'hall') return;   // v2.0.0 STEP 3: ホール側はテロップ保存不可
  const next = readMarqueeForm();
  lastMarqueeSettings = next;
  _marqueePreviewing = false;   // STEP 6.22.1.fix: 保存したのでプレビュー解除
  applyMarquee(next);
  if (window.api?.tournaments?.setMarqueeSettings && tournamentState.id) {
    try {
      await window.api.tournaments.setMarqueeSettings(tournamentState.id, next);
    } catch (err) {
      console.warn('マーキー設定の保存に失敗:', err);
    }
  }
  closeMarqueeDialog();
}

el.marqueePreview?.addEventListener('click', handleMarqueePreview);
el.marqueeSave?.addEventListener('click', handleMarqueeSave);
// STEP 6.22.1.fix: 閉じる時にプレビューを保存値へ復元
el.marqueeClose?.addEventListener('click', () => {
  restoreMarqueeIfPreviewing();
  closeMarqueeDialog();
});
// dialog の close イベント（Esc キー / バックドロップクリック等の経路）も同様に復元
el.marqueeDialog?.addEventListener('close', () => {
  restoreMarqueeIfPreviewing();
});

window.addEventListener('keydown', (event) => {
  if (el.resetDialog.open) return;

  // Ctrl+T: マーキー編集ダイアログを直接開く（input フォーカス中でも有効）
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyT') {
    event.preventDefault();
    openMarqueeDialog();
    return;
  }

  // 【最重要バグ修正】編集可能要素にフォーカスがある時は
  // クロックショートカット（Space/←/→/R/S）を一切発火させない。
  // dialog.open 判定ではエッジケース（フォーカスがダイアログ外要素に飛ぶ等）で
  // 抜けることがあるため、target ベースで確実にガードする。
  const target = event.target;
  if (target && (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )) return;

  // v2.0.4 B-1 fix: 任意の <dialog open> でショートカットを抑制（汎化）。
  //   旧実装では marqueeDialog / settingsDialog のみ列挙していたため、
  //   apply-mode / blinds-apply-mode / tournament-delete / import-strategy / prestart 等の
  //   他ダイアログ open 中にショートカットが誤発火する問題があった。
  if (document.querySelector('dialog[open]')) return;

  switch (event.code) {
    case 'Space':
      event.preventDefault();
      handleStartPauseToggle();
      break;
    case 'ArrowRight':
      // STEP 6.21.3: → : 30秒進める（残り時間 -30秒、ゲーム時間が早送り）
      event.preventDefault();
      advance30Seconds();
      break;
    case 'ArrowLeft':
      // STEP 6.21.3: ← : 30秒戻す（残り時間 +30秒、ゲーム時間が巻き戻し）
      event.preventDefault();
      rewind30Seconds();
      break;
    case 'KeyR':
      // STEP 6.9: Ctrl+Shift+R リエントリー -1 / Ctrl+R リエントリー +1 / 単独 R リセット
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        adjustReentry(event.shiftKey ? -1 : +1);
      } else {
        event.preventDefault();
        openResetDialog();
      }
      break;
    case 'KeyA':
      // Ctrl+Shift+A アドオン -1 / Ctrl+A アドオン +1
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        adjustAddOn(event.shiftKey ? -1 : +1);
      }
      break;
    case 'KeyE':
      // STEP 6.9: Ctrl+E 特殊スタック +1 / Ctrl+Shift+E 特殊スタック -1
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        adjustSpecialStack(event.shiftKey ? -1 : +1);
      }
      break;
    case 'ArrowUp':
      // STEP 6.6: ↑ 新規エントリー追加（playersInitial++ AND playersRemaining++）
      // STEP 6.7: Shift+↑ で新規エントリー取消（誤操作のリカバリ用）
      event.preventDefault();
      if (event.shiftKey) {
        cancelNewEntry();
      } else {
        addNewEntry();
      }
      break;
    case 'ArrowDown':
      // STEP 6.6: ↓ プレイヤー脱落（playersRemaining--、playersInitial 不変）
      // STEP 6.9: Shift+↓ で直前の脱落を取消（復活）。playersRemaining++（playersInitial を超えない）
      event.preventDefault();
      if (event.shiftKey) {
        revivePlayer();
      } else {
        eliminatePlayer();
      }
      break;
    case 'KeyS':
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        openSettingsDialog();
      }
      break;
    case 'KeyM':
      // ミュート切替（永続化しない、その場のみ）
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        ensureAudioReady().then(() => {
          const nowMuted = audioToggleMute();
          console.log(nowMuted ? 'ミュート: ON' : 'ミュート: OFF');
        });
      }
      break;
    case 'KeyH':
      // STEP 6.7: H キーでボトムバー非表示トグル（永続化）
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        toggleBottomBar();
      }
      break;
    default:
      break;
  }
});

// STEP 6.6: ランタイム値調整（キーボードショートカットから呼ばれる）
//
// ↑キー: 新規エントリー追加（レイトレジ等で遅れて入場した人をカウント）
//   - playersInitial++ AND playersRemaining++
//   - 結果: TOTAL POOL が buyIn.fee 分増加、PLAYERS が "N+1 / N+1"
//   - 上限 999（実用上の安全弁）
function addNewEntry() {
  if (window.appRole === 'hall') return;   // v2.0.0 STEP 3: ホール側はランタイム操作不可
  const MAX_PLAYERS = 999;
  if (tournamentRuntime.playersInitial >= MAX_PLAYERS) return;
  tournamentRuntime.playersInitial += 1;
  tournamentRuntime.playersRemaining += 1;
  renderStaticInfo();
  schedulePersistRuntime();
}

// STEP 6.7: Shift+↑ で新規エントリー取消（直前の addNewEntry を打ち消す）
//   - playersInitial-- AND playersRemaining--（両方を同期で戻す）
//   - 0 未満にはしない（保険）
function cancelNewEntry() {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B1: hall はランタイム操作不可
  if (tournamentRuntime.playersInitial <= 0) return;
  tournamentRuntime.playersInitial -= 1;
  // playersRemaining も合わせて戻す（addNewEntry の対称操作）
  tournamentRuntime.playersRemaining = Math.max(0, tournamentRuntime.playersRemaining - 1);
  renderStaticInfo();
  schedulePersistRuntime();
}

// ↓キー: プレイヤー脱落（playersRemaining のみ減少）
//   - playersInitial 不変
//   - 結果: PLAYERS が "N-1 / total" に、AVG STACK 再計算
//   - 下限 0
function eliminatePlayer() {
  if (window.appRole === 'hall') return;   // v2.0.0 STEP 3: ホール側は脱落操作不可
  if (tournamentRuntime.playersRemaining <= 0) return;
  tournamentRuntime.playersRemaining -= 1;
  renderStaticInfo();
  schedulePersistRuntime();
}

// STEP 6.9: Shift+↓ プレイヤー復活（直前の脱落を取消）。
//   - playersRemaining++ ただし playersInitial を超えない（保険）
//   - 既に最大なら何もしない（無音）
function revivePlayer() {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B1: hall はランタイム操作不可
  if (tournamentRuntime.playersRemaining >= tournamentRuntime.playersInitial) return;
  tournamentRuntime.playersRemaining += 1;
  renderStaticInfo();
  schedulePersistRuntime();
}

// STEP 6.6: タイマーリセット時にトーナメントランタイムも初期化
//   - FINISHED オーバーレイの解除
//   - 次回 Start ダイアログで人数再入力が必要
//   - timerReset を呼ぶ前/後どちらでも OK（renderStaticInfo は updateFinishedOverlay を含む）
function resetTournamentRuntime() {
  tournamentRuntime.playersInitial = 0;
  tournamentRuntime.playersRemaining = 0;
  // STEP 6.9: rebuyCount → reentryCount
  tournamentRuntime.reentryCount = 0;
  tournamentRuntime.addOnCount = 0;
  renderStaticInfo();
  // STEP 10 フェーズC.1.8: 明示的「タイマーリセット」時の 0 値も永続化（次回起動時も 0 を維持）
  schedulePersistRuntime();
}

// 全てのリセット経路で呼ぶラッパ。
// STEP 10 フェーズC.2.7-A Fix 1: 「ブラインド構造リセット」と「トーナメント全リセット」を分離。
//   handleReset は明示的な「タイマーリセット」ボタン経由のみで使う（runtime 含む完全リセット）。
//   ブラインド適用系（保存して適用→リセット選択 / handlePresetApply の reset モード）は
//   resetBlindProgressOnly を使い、tournamentRuntime（プレイヤー数・リエントリー・アドオン）を保護する。
//
//   【不変条件】ブラインド構造を変えても tournamentRuntime は絶対に消えない。
//   明示的「タイマーリセット」ボタン押下時のみ runtime クリアを許可する。
function handleReset() {
  if (window.appRole === 'hall') return;   // v2.0.0 STEP 3: ホール側はリセット操作不可
  resetTournamentRuntime();
  timerReset();
  // STEP 10 フェーズC.1.2 Fix 2: タイマーリセットで finished オーバーレイも解除
  el.clock?.classList.remove('clock--timer-finished');
}

// STEP 10 フェーズC.2.7-A Fix 1: ブラインド構造のリセット専用（currentLevel=0 + remainingMs=duration）。
//   tournamentRuntime（playersInitial / playersRemaining / reentryCount / addOnCount）は保持する。
//   8-8 致命バグ対策: PAUSED 中の「保存して適用→リセットして開始」で営業データが消える問題を解決。
function resetBlindProgressOnly() {
  timerReset();
  // STEP 10 フェーズC.1.2 Fix 2: ブラインドリセット時も finished オーバーレイを解除
  //   （新ブラインド構造での再開時は当然タイマー継続可能なので overlay 不要）
  el.clock?.classList.remove('clock--timer-finished');
}

// STEP 6.9: rebuy → reentry リネーム。0未満は無音ガード（取消ショートカットでも同様）
function adjustReentry(delta) {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B1: hall はランタイム操作不可
  const next = Math.max(0, tournamentRuntime.reentryCount + delta);
  if (next === tournamentRuntime.reentryCount) return;
  tournamentRuntime.reentryCount = next;
  renderStaticInfo();
  schedulePersistRuntime();
}

function adjustAddOn(delta) {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B1: hall はランタイム操作不可
  const next = Math.max(0, tournamentRuntime.addOnCount + delta);
  if (next === tournamentRuntime.addOnCount) return;
  tournamentRuntime.addOnCount = next;
  renderStaticInfo();
  schedulePersistRuntime();
}

// STEP 6.9: 特殊スタック適用人数（specialStack.appliedCount）を ±1 する。
//   - 0未満ガード、999 上限、無効時（!enabled）は何もしない
//   - 状態変更は tournamentState 側に直接反映 → 永続化は fire-and-forget で保存
function adjustSpecialStack(delta) {
  if (window.appRole === 'hall') return;  // v2.0.1 Fix B1: hall はランタイム操作不可
  const ss = tournamentState.specialStack;
  if (!ss || !ss.enabled) return;
  const cur = Number(ss.appliedCount) || 0;
  const next = Math.max(0, Math.min(999, cur + delta));
  if (next === cur) return;
  ss.appliedCount = next;
  // メイン画面（特殊配布行 / AVG STACK）を即時反映
  renderStaticInfo();
  // フォーム値が開いていれば同期
  if (el.tournamentSpecialStackCount) el.tournamentSpecialStackCount.value = String(next);
  // ストアに永続化（best-effort、UI ブロックしない）
  if (window.api?.tournament?.set) {
    window.api.tournament.set({ specialStack: { ...ss } }).catch(() => {});
  }
}

// STEP 6.9: 「特殊スタックを有効化」チェックボックスに応じて
//           ラベル / チップ / 人数 input を disabled / enabled 切替
function applySpecialStackEnabledState() {
  const enabled = !!el.tournamentSpecialStackEnabled?.checked;
  for (const inputEl of [el.tournamentSpecialStackLabel, el.tournamentSpecialStackChips, el.tournamentSpecialStackCount]) {
    if (inputEl) inputEl.disabled = !enabled;
  }
}

// ===== 初期化 =====

async function loadInitialSettings() {
  initMarquee({
    marquee: el.marquee,
    content: el.marqueeContent,
    dialog: el.marqueeDialog,
    enabledInput: el.marqueeEnabled,
    textInput: el.marqueeText,
    speedRadios: el.marqueeSpeedRadios,
    previewBtn: el.marqueePreview,
    closeBtn: el.marqueeClose
  });

  let marqueeInit = { enabled: true, text: '', speed: 'normal' };
  let bgInit = 'navy';
  let fontInit = 'jetbrains';
  let bottomBarHiddenInit = false;
  let venueNameInit = '';
  if (window.api?.settings?.getAll) {
    try {
      const all = await window.api.settings.getAll();
      // STEP 6.21.6 / 6.22.1: フォールバック順序 = active.{display,marquee}Settings → グローバル → ハードコード
      const activeId = all?.activeTournamentId;
      const activeT = (all?.tournaments || []).find((t) => t.id === activeId);
      // displaySettings
      if (activeT?.displaySettings?.background)      bgInit = activeT.displaySettings.background;
      else if (all?.display?.background)             bgInit = all.display.background;
      if (activeT?.displaySettings?.timerFont)       fontInit = activeT.displaySettings.timerFont;
      else if (all?.display?.timerFont)              fontInit = all.display.timerFont;
      // STEP 10 フェーズC.1.3: backgroundImage / backgroundOverlay の初期取込
      const dsImage   = activeT?.displaySettings?.backgroundImage   ?? all?.display?.backgroundImage   ?? '';
      const dsOverlay = activeT?.displaySettings?.backgroundOverlay ?? all?.display?.backgroundOverlay ?? 'mid';
      if (typeof dsImage === 'string')   bgImageState.dataUrl = dsImage;
      if (BG_OVERLAY_ALPHA[dsOverlay])   bgImageState.overlay = dsOverlay;
      // STEP 10 フェーズC.1.4: 休憩中スライドショーの初期取込
      const dsBreakImages   = activeT?.displaySettings?.breakImages       ?? all?.display?.breakImages       ?? [];
      const dsBreakInterval = activeT?.displaySettings?.breakImageInterval ?? all?.display?.breakImageInterval ?? 10;
      const dsPipSize       = activeT?.displaySettings?.pipSize           ?? all?.display?.pipSize           ?? 'medium';
      if (Array.isArray(dsBreakImages))         breakImagesState.images = dsBreakImages;
      if (typeof dsBreakInterval === 'number')  breakImagesState.intervalSec = dsBreakInterval;
      if (VALID_PIP_SIZES.includes(dsPipSize))  breakImagesState.pipSize = dsPipSize;
      // marqueeSettings（STEP 6.22.1）
      if (activeT?.marqueeSettings && typeof activeT.marqueeSettings === 'object') {
        marqueeInit = { ...activeT.marqueeSettings };
      } else if (all?.marquee) {
        marqueeInit = { ...all.marquee };
      }
      // bottomBarHidden はグローバル維持（運用習慣）
      if (typeof all?.display?.bottomBarHidden === 'boolean') bottomBarHiddenInit = all.display.bottomBarHidden;
      // STEP 6.22: 店舗名（グローバル）
      if (typeof all?.venueName === 'string') venueNameInit = all.venueName;
      // STEP 9-B: ロゴ初期状態（グローバル）
      if (all?.logo && typeof all.logo === 'object') {
        applyLogo(all.logo);
        syncLogoModeRadioFromState();
      } else {
        applyLogo({ kind: 'placeholder', customPath: null });
        syncLogoModeRadioFromState();
      }
    } catch (err) {
      console.warn('設定読込に失敗:', err);
    }
  }
  lastMarqueeSettings = marqueeInit;   // 設定タブ版フォームの初期値ソース
  // STEP 10 フェーズC.1.3: 背景画像 state 初期化を反映してから applyBackground を呼ぶ
  refreshBgImagePreview();
  // STEP 10 フェーズC.1.4: 休憩中スライドショー UI 初期化
  renderBreakImagesList();
  applyPipSize(breakImagesState.pipSize);
  applyBackground(bgInit);
  // STEP 10 フェーズC.1.4-fix3 Fix 3: 起動時に画像合計サイズを評価し、150MB 超なら警告ポップアップ + ⚠ 表示
  checkImagesTotalSizeAndWarn().catch(() => {});
  applyTimerFont(fontInit);
  applyMarquee(marqueeInit);
  applyBottomBarHidden(bottomBarHiddenInit);
  // STEP 6.22: 店舗名表示 + 入力欄の初期値同期
  applyVenueName(venueNameInit);
  if (el.venueNameInput) el.venueNameInput.value = venueNameInit;

  // STEP 4: 音響モジュール初期化と設定復元
  initAudio();
  // STEP 6.21.4.3: AudioContext を起動時に unlock 試行（Electron AutoPlay Policy 解除と組み合わせ）
  // Web Audio API は autoplay-policy フラグだけでは AudioContext.state が suspended のままになることがあり、
  // 明示的に resume() を呼ぶ必要がある。さらに保険として、最初の click / keydown でも unlock を試行する。
  ensureAudioReady().catch(() => { /* 起動時失敗時は保険ハンドラに任せる */ });
  const unlockOnUserGesture = () => {
    ensureAudioReady().catch((err) => console.warn('AudioContext unlock 失敗:', err));
  };
  document.addEventListener('click',   unlockOnUserGesture, { once: true, capture: true });
  document.addEventListener('keydown', unlockOnUserGesture, { once: true, capture: true });
  if (window.api?.audio?.get) {
    try {
      const audioCfg = await window.api.audio.get();
      if (audioCfg) {
        Object.assign(audioState, audioCfg);
        applyAudioSettings(audioCfg);
      }
    } catch (err) {
      console.warn('音設定の取得に失敗:', err);
    }
  }

  // STEP 3b 拡張: active トーナメントを読み込み → tournamentState 復元
  let activeTournament = null;
  if (window.api?.tournaments?.getActive) {
    try {
      activeTournament = await window.api.tournaments.getActive();
    } catch (err) {
      console.warn('active トーナメント取得失敗:', err);
    }
  }
  if (activeTournament) applyTournament(activeTournament);

  // 起動時: 保存された blindPresetId に基づいてブラインド構造を復元（成功時 true）
  if (tournamentState.blindPresetId) {
    const requestedId = tournamentState.blindPresetId;
    let preset = await loadPresetById(requestedId);
    // フォールバック: 削除された参照に対しては demo-fast を使用
    if (!preset) {
      console.warn(`blindPresetId '${requestedId}' が見つかりません。demo-fast を使用します`);
      preset = await loadPresetById('demo-fast');
      // STEP 10 フェーズC.2 中 5: フォールバックをユーザーに通知（要素が読めるタイミングで遅延表示）
      setTimeout(() => {
        try {
          setTournamentHint(`ブラインド構造『${requestedId}』が見つからないため demo-fast を使っています`, 'error');
          setTimeout(() => setTournamentHint(''), 5000);
        } catch (_) { /* ignore */ }
      }, 1000);
    }
    if (preset) {
      try {
        setStructure(preset);
        return true;   // 復元成功 → initialize 側で fetch fallback をスキップ
      } catch (err) {
        console.warn('保存されたブラインド構造の復元に失敗:', err);
      }
    }
  }
  return false;

  // ハウス情報タブのバージョン番号（IPC 経由で package.json から取得）
  if (el.appVersion && window.api?.app?.getVersion) {
    try {
      const version = await window.api.app.getVersion();
      el.appVersion.textContent = version;
    } catch (err) {
      console.warn('バージョン取得に失敗:', err);
      el.appVersion.textContent = '0.1.0';
    }
  } else if (el.appVersion) {
    el.appVersion.textContent = '0.1.0';
  }
}

async function initialize() {
  renderStaticInfo();
  renderPayouts();
  // loadInitialSettings は trueを返す＝blindPresetId からの復元成功
  const restored = await loadInitialSettings();

  if (!restored) {
    // フォールバック: 復元失敗時は demo-fast.json を fetch で読込
    try {
      await loadPreset('../presets/demo-fast.json');
    } catch (err) {
      console.warn('プリセット読み込みに失敗:', err);
      el.btnStart.disabled = true;
      el.time.textContent = '--:--';
      return;
    }
  }

  if (getLevelCount() === 0) {
    console.warn('プリセットにレベルが含まれていません');
    el.btnStart.disabled = true;
    return;
  }
  // STEP 6.21 / 6.21.2: 起動時に active トーナメントの timerState を復元
  //   並行進行モデル: 停電中の経過時間も computeLiveTimerState で計算してレベル進行まで反映
  //   silent: true で復元時の音は鳴らさない（停電中の通過分は無音、現在地から通常進行）
  let restoredFromTimerState = false;
  try {
    if (window.api?.tournaments?.list) {
      const list = await window.api.tournaments.list() || [];
      const found = list.find((t) => t.id === tournamentState.id);
      if (found && found.timerState && found.timerState.status !== 'idle') {
        const levels = found.blindPresetId ? await getCachedLevels(found.blindPresetId) : null;
        applyTimerStateToTimer(found.timerState, levels, { silent: true });
        restoredFromTimerState = true;
      }
    }
  } catch (err) {
    console.warn('起動時 timerState 復元失敗:', err);
  }
  if (!restoredFromTimerState) timerReset();
  // STEP 6.21.1: 5秒ごとの定期保存を開始（強制終了時の経過秒巻き戻し対策）
  startPeriodicTimerStatePersist();
  // STEP 6.21.2: リスト UI を 1秒ごとに再描画（並行進行の経過時間を動的表示）
  startListRefreshInterval();
  // STEP 6.21.4: PC スリープ復帰時に active タイマーを時刻ベースで再同期
  if (typeof window.api?.onSystemResume === 'function') {
    window.api.onSystemResume(async () => {
      try {
        // active トーナメントを computeLiveTimerState で再復元（停電復元と同じロジック）
        await restoreActiveTimerStateFromStore(tournamentState.id, { silent: true });
        // 全リスト即時再描画（非 active も rebase 済みの状態を反映）
        await renderTournamentList();
      } catch (err) {
        console.warn('スリープ復帰時の再同期失敗:', err);
      }
    });
  }
}

// v2.0.0 STEP 2: 起動時の役割分岐。
//   - 'hall'         : ホール側ウィンドウ。dual-sync を await してから既存の表示ロジックを起動
//   - 'operator'     : 2 画面モードの PC 側。STEP 3 で UI を操作専用化、本 STEP では既存ロジックそのまま
//   - 'operator-solo': 単画面モード（HDMI なし）。v1.3.0 と完全同等の挙動を維持（後方互換不変条件）
//   role 不明時は 'operator-solo' 扱い（preload.js の既定値と一致）。
const __appRole = (typeof window !== 'undefined' && window.appRole) || 'operator-solo';
if (__appRole === 'hall') {
  // v2.0.1 #A1: hall 側 dual-sync 差分ハンドラを登録。
  //   main からの broadcast を受信したとき、kind 別に該当する apply* 関数を呼ぶ。
  //   tournamentBasics 受信時は active トーナメント全体を再取得して applyTournament（最も安全）。
  //   timerState は applyTimerStateToTimer で同期、ただし silent: true で音を鳴らさない（ホール側で同期音が二重発火しないため）。
  //   ※ schedulePersistTimerState / schedulePersistRuntime は #A2 で hall ガード追加し、broadcast 経由で逆書込しない。
  registerDualDiffHandler((diff) => {
    if (!diff || typeof diff.kind !== 'string') return;
    const { kind, value } = diff;
    try {
      if (kind === 'marqueeSettings' && value) {
        applyMarquee(value);
      } else if (kind === 'displaySettings' && value) {
        // 背景プリセット / フォント / 背景画像 / overlay / breakImages / interval / pipSize の反映
        if (typeof value.background === 'string') applyBackground(value.background);
        if (typeof value.timerFont === 'string') applyTimerFont(value.timerFont);
        if (typeof value.backgroundImage === 'string') {
          bgImageState.dataUrl = value.backgroundImage;
        }
        if (typeof value.backgroundOverlay === 'string' && BG_OVERLAY_ALPHA[value.backgroundOverlay]) {
          bgImageState.overlay = value.backgroundOverlay;
        }
        // 画像更新後は applyBackground を再呼出して CSS 変数を更新
        if (typeof value.background === 'string') applyBackground(value.background);
        if (Array.isArray(value.breakImages)) breakImagesState.images = value.breakImages;
        if (typeof value.breakImageInterval === 'number') breakImagesState.intervalSec = value.breakImageInterval;
        if (typeof value.pipSize === 'string' && VALID_PIP_SIZES.includes(value.pipSize)) {
          breakImagesState.pipSize = value.pipSize;
          applyPipSize(value.pipSize);
        }
      } else if (kind === 'logoUrl' && value) {
        applyLogo(value);
      } else if (kind === 'venueName') {
        applyVenueName(typeof value === 'string' ? value : '');
      } else if (kind === 'audioSettings' && value) {
        applyAudioSettings(value);
      } else if (kind === 'tournamentRuntime' && value) {
        // tournamentRuntime に反映 + 静的情報を再描画
        if (typeof value.playersInitial === 'number') tournamentRuntime.playersInitial = value.playersInitial;
        if (typeof value.playersRemaining === 'number') tournamentRuntime.playersRemaining = value.playersRemaining;
        if (typeof value.reentryCount === 'number') tournamentRuntime.reentryCount = value.reentryCount;
        if (typeof value.addOnCount === 'number') tournamentRuntime.addOnCount = value.addOnCount;
        renderStaticInfo();
      } else if (kind === 'tournamentBasics' && value) {
        // basics（id / name / subtitle / titleColor / blindPresetId）変更時は active 全体を再取得
        // applyTournament が tournamentState 更新 + 表示反映を網羅、最も安全な経路。
        if (window.api?.tournaments?.getActive) {
          window.api.tournaments.getActive().then((t) => {
            if (t) applyTournament(t);
          }).catch(() => { /* ignore */ });
        }
      } else if (kind === 'timerState' && value) {
        // timerState 同期は applyTimerStateToTimer に委譲（既存経路、silent で音二重発火防止）
        // levels は現在の構造から取得（getStructure or active トーナメントの blindPresetId 経由）
        try {
          const levels = (typeof getStructure === 'function') ? getStructure() : null;
          applyTimerStateToTimer(value, levels, { silent: true });
        } catch (err) { console.warn('[dual-sync] timerState 適用失敗:', err); }
      }
      // structure / その他は initialize() 経由で active から取得済、broadcast での個別同期は B4 の構造変更時に対応
    } catch (err) {
      console.warn(`[dual-sync] kind=${kind} の適用に失敗:`, err);
    }
  });
  // hall: 初期同期 → 既存 initialize（DOM/タイマー描画ロジック）を起動。
  //   await の失敗で initialize が止まらないよう finally でフォールバック。
  initDualSyncForHall().finally(() => initialize());
} else if (__appRole === 'operator') {
  // operator（2 画面の PC 側）: 本 STEP では既存ロジックそのまま。
  //   STEP 3 で表示要素の hidden 化 + main への operator-action 通知へ移行する。
  initialize();
} else {
  // operator-solo（単画面、デフォルト）: v1.3.0 と完全同等。
  // v2.0.0 STEP 5: HDMI 抜き差し直後にウィンドウが再生成されるため、
  //   AudioContext が新しい renderer で suspend 状態になっている可能性。
  //   C.1.7 修正で _play() 内 resume が走るが、最初の音発火を待たずに
  //   起動直後の安全側として ensureAudioReady を明示呼出（fire-and-forget）。
  //   ensureAudioReady は冪等で副作用が小さい（suspend なら resume、それ以外 no-op）。
  initialize();
  ensureAudioReady();
}
