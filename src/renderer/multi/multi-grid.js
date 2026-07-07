// PokerTimerPLUS+ multi-tournament-4up Phase 1b — 会場側 2×2 グリッド（表示専用）
//
// 設計原則（Phase 1 brief B / F / H + phase1b-grid-parity）:
//   - 各区画 = 単一モード会場画面（index.html の .clock + event-header）と同一の DOM 構造。
//     見た目は multi.css が style.css の値を cqw/cqh 換算で移植した「忠実な 1/4 縮小」。
//     JS 参照フックは js-* クラス（id は 4 区画で重複するため使わない）。
//   - 独立 HTML の純粋 consumer。既存 renderer.js / state.js / timer.js / audio.js は import しない
//   - 状態の真実源は multi-control。ここは multi:state-sync（edge イベント）を受けて
//     endAtMs seed で自走描画する（hall の renderHallTickFrame と同じ実証済みパターン・ポーリングなし）
//   - rAF ループは 1 本（4 区画ぶんを 1 ループで回す）
//   - DOM 書込は「表示文字列が変わった時のみ」（rAF は判定のみ・毎秒粒度）
//   - store への書込は一切しない（必要データは control が snapshot で送る）
//   - 音 / スライドショー / テロップ / PIP / ミュートバッジは DOM ごと存在しない

import { computePaneNow, computeNextBreakMsFor, computeTotalGameTimeMsFor, formatPreStartClock, levelDurationMs, ENGINE_STATUS } from './multi-engine.mjs';

const PANE_COUNT = 4;

// ===== フォーマッタ（renderer.js の同名関数の移植・引数化版。同値検証はテストで担保） =====
function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
function formatHMS(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(totalSec / 3600))}:${pad(Math.floor((totalSec % 3600) / 60))}:${pad(totalSec % 60)}`;
}
const formatNumber = (n) => Number(n || 0).toLocaleString('ja-JP');

// ===== 構造型マップ（renderer.js STRUCTURE_FIELDS 等の移植） =====
const STRUCTURE_FIELDS = Object.freeze({
  BLIND:       ['sb', 'bb', 'bbAnte'],
  LIMIT_BLIND: ['sb', 'bb', 'smallBet', 'bigBet'],
  SHORT_DECK:  ['ante', 'buttonBlind'],
  STUD:        ['ante', 'bringIn', 'smallBet', 'bigBet'],
  MIX:         []
});
const GAME_STRUCTURE_TYPE = Object.freeze({
  'nlh': 'BLIND', 'plo': 'BLIND', 'plo5': 'BLIND', 'plo8': 'BLIND', 'big-o-blind': 'BLIND',
  'big-o-limit': 'LIMIT_BLIND', 'omaha-hilo': 'LIMIT_BLIND', 'limit-holdem': 'LIMIT_BLIND',
  'short-deck': 'SHORT_DECK', 'stud': 'STUD', 'razz': 'STUD', 'stud-hilo': 'STUD',
  'mix': 'MIX', 'other': 'BLIND'
});
const FIELD_LABEL = Object.freeze({
  sb: 'SB', bb: 'BB', bbAnte: 'BB Ante', smallBet: 'Small Bet', bigBet: 'Big Bet',
  ante: 'Ante', bringIn: 'Bring-In', buttonBlind: 'Button Blind'
});
const GAME_TYPE_LABEL = Object.freeze({
  'nlh': 'NLH', 'plo': 'PLO', 'plo5': '5 Card PLO', 'plo8': 'PLO8',
  'big-o-blind': 'Big O (Blind)', 'big-o-limit': 'Big O (Limit)', 'omaha-hilo': 'Omaha Hi-Lo',
  'short-deck': 'Short Deck', 'stud': 'Stud', 'razz': 'Razz', 'stud-hilo': 'Stud Hi-Lo',
  'limit-holdem': "Limit Hold'em", 'mix': 'MIX', 'other': 'その他'
});
const WARN_MS = 60 * 1000;
const DANGER_MS = 10 * 1000;
const VALID_BG = new Set(['black', 'navy', 'carbon', 'felt', 'burgundy', 'midnight', 'emerald', 'obsidian', 'image']);
const VALID_FONT = new Set(['jetbrains', 'roboto', 'space']);
// engine 状態 → 単一モードの data-status 値（CSS セレクタ互換のため大文字表記に揃える）
const STATUS_ATTR = Object.freeze({ idle: 'IDLE', prestart: 'PRE_START', running: 'RUNNING', paused: 'PAUSED', finished: 'IDLE' });
const FILLER_KINDS = new Set(['blank', 'logo', 'image', 'text']);

// filler の正規化: Phase 1 の文字列（'blank'|'logo'）と Phase 2 のオブジェクト
// （{kind, imagePath, text}）の両形を受け付ける（起動順 race で古い payload が届いても安全）
function normalizeFiller(f) {
  if (f && typeof f === 'object') {
    return {
      kind: FILLER_KINDS.has(f.kind) ? f.kind : 'blank',
      imagePath: typeof f.imagePath === 'string' ? f.imagePath : '',
      text: typeof f.text === 'string' ? f.text : ''
    };
  }
  return { kind: f === 'logo' ? 'logo' : 'blank', imagePath: '', text: '' };
}

// ===== 賞金計算（renderer.js computeCalculatedPool / computeTotalPool / computeAvgStack /
//        computeRoundedAmounts の移植・snapshot 引数化版） =====
function computeCalculatedPoolFor(snap) {
  const pot = snap.potAmounts || { buyIn: 0, reentry: 0, addOn: 0 };
  const rt = snap.runtime || { playersInitial: 0, reentryCount: 0, addOnCount: 0 };
  return (Number(pot.buyIn) || 0) * (rt.playersInitial || 0)
       + (Number(pot.reentry) || 0) * (rt.reentryCount || 0)
       + (Number(pot.addOn) || 0) * (rt.addOnCount || 0);
}
function computeTotalPoolFor(snap) {
  return Math.max(computeCalculatedPoolFor(snap), Number(snap.guarantee) || 0);
}
function isGuaranteeActiveFor(snap) {
  const gtd = Number(snap.guarantee) || 0;
  return gtd > 0 && gtd > computeCalculatedPoolFor(snap);
}
function computeAvgStackFor(snap) {
  const rt = snap.runtime || { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 };
  const ss = snap.specialStack || { enabled: false };
  const ssChips = ss.enabled ? (Number(ss.chips) || 0) * (Number(ss.appliedCount) || 0) : 0;
  const totalChips = (Number(snap.buyIn?.chips) || 0) * (rt.playersInitial || 0)
                   + (Number(snap.reentry?.chips) || 0) * (rt.reentryCount || 0)
                   + (Number(snap.addOn?.chips) || 0) * (rt.addOnCount || 0)
                   + ssChips;
  return (rt.playersRemaining || 0) > 0 ? Math.floor(totalChips / rt.playersRemaining) : 0;
}
const VALID_PAYOUT_ROUNDINGS = [1, 10, 100, 1000];
function computeRoundedAmountsFor(snap) {
  const pool = computeTotalPoolFor(snap);
  const rounding = VALID_PAYOUT_ROUNDINGS.includes(snap.payoutRounding) ? snap.payoutRounding : 100;
  const payouts = snap.payouts || [];
  if (payouts.length === 0 || pool <= 0) return payouts.map(() => 0);
  if (snap.payoutMode === 'amount') {
    return payouts.map((p) =>
      (Number.isFinite(p.amount) && p.amount >= 0)
        ? p.amount
        : Math.floor(pool * (Number(p.percentage) || 0) / 100 / rounding) * rounding
    );
  }
  const raws = payouts.map((p) => pool * (Number(p.percentage) || 0) / 100);
  const amounts = raws.map((raw) => Math.floor(raw / rounding) * rounding);
  const remainders = raws.map((raw, i) => raw - amounts[i]);
  const order = payouts.map((_, i) => i).sort((a, b) => remainders[b] - remainders[a]);
  let units = Math.floor((pool - amounts.reduce((s, v) => s + v, 0)) / rounding);
  for (let k = 0; units > 0 && order.length > 0; k++, units--) {
    amounts[order[k % order.length]] += rounding;
  }
  const residual = pool - amounts.reduce((s, v) => s + v, 0);
  if (residual !== 0 && amounts.length > 0) {
    amounts[order.length > 0 ? order[0] : 0] += residual;
  }
  return amounts;
}

// ===== 区画 DOM 構築（単一モード index.html の会場表示部と同一構造） =====
const gridRoot = document.getElementById('js-mgrid');
const panes = []; // { root, clock, els, data, last }

function buildPane(index) {
  const root = document.createElement('section');
  root.className = 'pane';
  root.dataset.pane = String(index);
  root.dataset.assigned = 'false';
  root.dataset.bg = 'black';
  root.innerHTML = `
    <div class="pane-bg-image"></div>
    <main class="clock js-clock" data-status="IDLE" data-timer-state="normal">
      <aside class="clock__left">
        <div class="left-group left-group--top clock__logo">
          <div class="clock__logo-placeholder js-logo-placeholder">
            <span class="clock__logo-placeholder-icon">📷</span>
            <span class="clock__logo-placeholder-text">ここにロゴを<br>入れてください</span>
          </div>
          <img src="" alt="" class="clock__logo-img js-logo" hidden>
          <div class="clock__presented-by js-presented-by"></div>
        </div>
        <div class="left-group left-group--mid clock__payouts">
          <div class="stat-label">PAYOUTS</div>
          <div class="payouts-list js-payouts"></div>
        </div>
        <div class="left-group left-group--bot clock__pool">
          <div class="stat-label">TOTAL PRIZE POOL</div>
          <div class="stat-value stat-value--gold stat-value--xl js-total-pool">¥0</div>
          <div class="clock__pool-note js-pool-note">（GTD）</div>
        </div>
      </aside>
      <section class="clock__center">
        <header class="event-header">
          <div class="event-title-wrap"><div class="event-title js-title">ポーカートーナメント</div></div>
          <div class="event-subtitle-wrap"><div class="event-subtitle js-subtitle"></div></div>
          <div class="event-game-type js-gametype"></div>
          <div class="event-prize-category js-prize-category"></div>
          <div class="level-display js-level">Level 1</div>
        </header>
        <div class="clock__timer">
          <div class="clock__pre-start-label">トーナメントスタートまで</div>
          <div class="clock__time js-time">--:--</div>
          <div class="clock__pause-label">一時停止中</div>
          <div class="clock__finished-overlay">TOURNAMENT FINISHED</div>
          <div class="clock__timer-finished-overlay">
            <span class="clock__timer-finished-main">トーナメント終了</span>
            <span class="clock__timer-finished-sub">TOURNAMENT COMPLETE</span>
          </div>
        </div>
        <div class="card-stack">
          <div class="card card-blinds">
            <div class="card-label">BLINDS</div>
            <div class="blinds-content js-blinds-current" data-structure="BLIND" data-state="empty"></div>
          </div>
          <div class="card card-next">
            <div class="card-label">NEXT LEVEL</div>
            <div class="blinds-content blinds-content--next js-blinds-next" data-structure="BLIND" data-state="empty"></div>
          </div>
        </div>
      </section>
      <aside class="clock__right">
        <div class="stat-group stat-group--top">
          <div class="stat stat--right">
            <div class="stat-label js-break-label">NEXT BREAK IN</div>
            <div class="next-break-value js-next-break">00:00:00</div>
          </div>
        </div>
        <div class="stat-group stat-group--mid">
          <div class="stat stat--right">
            <div class="stat-label">AVG STACK</div>
            <div class="stat-value js-avg-stack">0</div>
          </div>
        </div>
        <div class="stat-group stat-group--bot">
          <div class="stat stat--right stat--lead">
            <div class="stat-label">PLAYERS</div>
            <div class="stat-value stat-value--md js-players">0 / 0</div>
          </div>
          <div class="stat-group__inline">
            <div class="stat-row stat-row--right stat-row--optional js-reentry-row">
              <span class="stat-label-inline">REENTRY</span>
              <span class="stat-value-small js-reentry">0</span>
            </div>
            <div class="stat-row stat-row--right stat-row--optional js-addon-row">
              <span class="stat-label-inline">ADDON</span>
              <span class="stat-value-small js-addon">0</span>
            </div>
            <div class="stat-row stat-row--right stat-row--optional special-stack-row js-special-stack-row">
              <span class="special-stack-text js-special-stack">—</span>
            </div>
          </div>
        </div>
      </aside>
    </main>
    <div class="pane-filler" data-filler="blank">
      <img class="pane-filler__logo" src="../../assets/logo-plus2-default.png" alt="">
      <img class="pane-filler__image" alt="">
      <div class="pane-filler__text"></div>
    </div>
    <div class="pane-reset-arm">もう一度 R でリセット</div>
    <div class="pane-active-badge js-active-badge"></div>`;
  gridRoot.appendChild(root);
  const q = (sel) => root.querySelector(sel);
  return {
    root,
    clock: q('.js-clock'),
    els: {
      bgImage: q('.pane-bg-image'),
      title: q('.js-title'), subtitle: q('.js-subtitle'),
      gametype: q('.js-gametype'), prizeCategory: q('.js-prize-category'),
      logo: q('.js-logo'), logoPlaceholder: q('.js-logo-placeholder'), presentedBy: q('.js-presented-by'),
      payouts: q('.js-payouts'), totalPool: q('.js-total-pool'), poolNote: q('.js-pool-note'),
      level: q('.js-level'), time: q('.js-time'),
      blindsCurrent: q('.js-blinds-current'), blindsNext: q('.js-blinds-next'),
      breakLabel: q('.js-break-label'), nextBreak: q('.js-next-break'),
      avgStack: q('.js-avg-stack'), players: q('.js-players'),
      reentryRow: q('.js-reentry-row'), reentry: q('.js-reentry'),
      addonRow: q('.js-addon-row'), addon: q('.js-addon'),
      specialStackRow: q('.js-special-stack-row'), specialStack: q('.js-special-stack'),
      filler: q('.pane-filler'), fillerImage: q('.pane-filler__image'), fillerText: q('.pane-filler__text'),
      resetArm: q('.pane-reset-arm'), activeBadge: q('.js-active-badge')
    },
    data: { assigned: false, filler: normalizeFiller('blank'), snapshot: null, engine: null },
    last: { time: null, levelIndex: null, status: null, timerState: null, nextBreak: null, prestartFormat: null }
  };
}

// ===== 静的部分の描画（割当 / edge イベント時のみ） =====
// renderer.js renderBlindsContent の移植: 単一モードと同一の data 属性 + セル構造で描画する
function renderBlindsInto(targetEl, level, structureType) {
  if (!targetEl) return;
  let effective = structureType;
  if (structureType === 'MIX' && level && !level.isBreak && typeof level.subStructureType === 'string'
      && STRUCTURE_FIELDS[level.subStructureType] && level.subStructureType !== 'MIX') {
    effective = level.subStructureType;
  }
  targetEl.dataset.structure = effective;
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
  const fields = STRUCTURE_FIELDS[effective] || STRUCTURE_FIELDS.BLIND;
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
  targetEl.innerHTML = fields.map((f) => {
    const v = level[f];
    const value = (typeof v === 'number') ? formatNumber(v) : '—';
    return `<div class="blinds-field" data-field="${f}">
      <span class="blinds-field__label">${escapeHtml(FIELD_LABEL[f] || f)}</span>
      <span class="blinds-field__value">${escapeHtml(value)}</span>
    </div>`;
  }).join('');
}

function countUniqueMixGames(levels) {
  const set = new Set();
  for (const lv of levels || []) {
    if (!lv || lv.isBreak) continue;
    if (typeof lv.subGameType === 'string' && lv.subGameType.length > 0) set.add(lv.subGameType);
  }
  return set.size;
}

function renderGameTypeLabel(pane, levelIndex) {
  const snap = pane.data.snapshot;
  if (!snap) return;
  if (snap.gameType === 'mix') {
    const levels = snap.levels || [];
    const count = countUniqueMixGames(levels);
    const countLabel = count > 0 ? `MIX (${count}-Game)` : 'MIX';
    const lv = levels[levelIndex];
    const subLabel = (lv && !lv.isBreak && typeof lv.subGameType === 'string')
      ? (GAME_TYPE_LABEL[lv.subGameType] || lv.subGameType) : '';
    pane.els.gametype.textContent = subLabel ? `${countLabel} — 現在: ${subLabel}` : countLabel;
  } else if (snap.gameType === 'other') {
    pane.els.gametype.textContent = snap.customGameName || GAME_TYPE_LABEL.other;
  } else {
    pane.els.gametype.textContent = GAME_TYPE_LABEL[snap.gameType] || '';
  }
}

function renderPaneStatic(pane, globalData) {
  const { els, data } = pane;
  pane.root.dataset.assigned = data.assigned ? 'true' : 'false';
  // フィラー（Phase 2: 無地 / ロゴ / 任意画像 / テキスト）。画像未選択の image はまだ無地扱い
  const filler = data.filler;
  const fillerKind = (filler.kind === 'image' && !filler.imagePath) ? 'blank' : filler.kind;
  els.filler.dataset.filler = fillerKind;
  if (fillerKind === 'image') {
    // ロゴ custom と同じ file:/// 参照（完全ローカル・外部ネットワーク送信なし）
    els.fillerImage.src = `file:///${String(filler.imagePath).replace(/\\/g, '/')}`;
  } else {
    els.fillerImage.removeAttribute('src');
  }
  els.fillerText.textContent = fillerKind === 'text' ? filler.text : '';
  if (!data.assigned || !data.snapshot) return;
  const snap = data.snapshot;

  // 区画テーマ（トーナメント毎設定を尊重・区画コンテナ単位。前原確定 2026-07-07 #2）
  const ds = snap.displaySettings || {};
  pane.root.dataset.bg = VALID_BG.has(ds.background) ? ds.background : 'navy';
  pane.root.dataset.timerFont = VALID_FONT.has(ds.timerFont) ? ds.timerFont : 'jetbrains';
  pane.root.dataset.bgOverlay = (ds.backgroundOverlay === 'low' || ds.backgroundOverlay === 'strong') ? ds.backgroundOverlay : 'mid';
  els.bgImage.style.backgroundImage = (ds.background === 'image' && typeof snap.backgroundImage === 'string' && snap.backgroundImage)
    ? `url("${snap.backgroundImage}")` : '';

  // ヘッダ（タイトル色は単一モードと同じ --title-color 変数を区画 .clock スコープで適用）
  pane.clock.style.setProperty('--title-color', /^#[0-9a-fA-F]{6}$/.test(snap.titleColor || '') ? snap.titleColor : '#FFFFFF');
  els.title.textContent = snap.title || 'ポーカートーナメント';
  els.subtitle.textContent = snap.subtitle || '';
  els.prizeCategory.textContent = snap.prizeCategory ? `※ PRIZEは${snap.prizeCategory}として付与` : '';

  // ロゴ / presented by（グローバル設定・全区画共通。renderer.js applyLogo と同じ 3 モード）
  const logo = globalData?.logo || { kind: 'placeholder' };
  if (logo.kind === 'plus2') {
    els.logo.src = '../../assets/logo-plus2-default.png';
    els.logo.hidden = false; els.logoPlaceholder.hidden = true;
  } else if (logo.kind === 'custom' && logo.customPath) {
    els.logo.src = `file:///${String(logo.customPath).replace(/\\/g, '/')}`;
    els.logo.hidden = false; els.logoPlaceholder.hidden = true;
  } else {
    els.logo.hidden = true; els.logo.removeAttribute('src'); els.logoPlaceholder.hidden = false;
  }
  const venue = (globalData?.venueName || '').trim();
  els.presentedBy.textContent = venue ? `Presented by ${venue}` : '';
  els.presentedBy.classList.toggle('is-visible', venue.length > 0);

  // 賞金 / 統計（snapshot の runtime は割当時点の値・読み取り専用）
  const symbol = snap.currencySymbol || '¥';
  const pool = computeTotalPoolFor(snap);
  els.totalPool.textContent = `${symbol}${formatNumber(pool)}`;
  els.totalPool.classList.toggle('is-7digit', String(Math.floor(Math.abs(pool))).length >= 7);
  els.poolNote.classList.toggle('is-visible', isGuaranteeActiveFor(snap));
  const amounts = computeRoundedAmountsFor(snap);
  els.payouts.innerHTML = (snap.payouts || []).map((p, i) =>
    `<div class="payouts-row${i >= 3 ? ' payouts-row--secondary' : ''}">
      <span class="payouts-row__rank">${escapeHtml(String(p.rank))}位</span>
      <span class="payouts-row__amount">${escapeHtml(symbol + formatNumber(amounts[i] ?? 0))}</span>
    </div>`).join('');
  const avgValue = computeAvgStackFor(snap);
  els.avgStack.textContent = formatNumber(avgValue);
  els.avgStack.classList.toggle('is-8digit', String(Math.floor(Math.abs(avgValue))).length >= 8);
  const rt = snap.runtime || { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 };
  els.players.textContent = `${rt.playersRemaining || 0} / ${rt.playersInitial || 0}`;
  els.reentry.textContent = String(rt.reentryCount || 0);
  els.reentryRow.classList.toggle('is-visible', (rt.reentryCount || 0) > 0);
  els.addon.textContent = String(rt.addOnCount || 0);
  els.addonRow.classList.toggle('is-visible', (rt.addOnCount || 0) > 0);
  const ss = snap.specialStack || { enabled: false };
  const ssVisible = !!ss.enabled && (Number(ss.appliedCount) || 0) > 0;
  els.specialStackRow.classList.toggle('is-visible', ssVisible);
  if (ssVisible) {
    const total = (Number(ss.chips) || 0) * (Number(ss.appliedCount) || 0);
    const label = (ss.label || '').trim();
    els.specialStack.textContent = label ? `特殊配布: ${label} ${formatNumber(total)}` : `特殊配布: ${formatNumber(total)}`;
  }
  // 残0人オーバーレイ（TOURNAMENT FINISHED = 単一モードの clock--finished と同じクラス運用）
  pane.clock.classList.toggle('clock--finished', (rt.playersInitial || 0) > 0 && (rt.playersRemaining || 0) === 0);

  // タイマー系キャッシュを無効化して次フレームで必ず再描画
  pane.last = { time: null, levelIndex: null, status: null, timerState: null, nextBreak: null, prestartFormat: null };
}

// ===== タイマー描画（rAF 1 本・変化時のみ DOM 書込） =====
function renderPaneTick(pane, nowMs) {
  const { data, els, last } = pane;
  if (!data.assigned || !data.snapshot) return;
  const levels = data.snapshot.levels || [];
  const now = computePaneNow(data.engine, levels, nowMs);
  const level = levels[now.levelIndex] || null;
  const isBreak = !!(level && level.isBreak);
  const isPreStart = !!now.preStart; // 開始前カウントダウン由来（prestart 進行中 / その一時停止）

  // 大タイマー（文字列が変わった時のみ）。PRE_START は単一モード formatPreStartTime と同フォーマット
  //（60 分以上 HH:MM:SS / 未満 MM:SS）+ data-prestart-format で font-size 切替
  let timeText;
  let prestartFormat = null;
  if (isPreStart) {
    const f = formatPreStartClock(now.remainingMs);
    timeText = f.text;
    prestartFormat = f.format;
  } else {
    timeText = formatTime(now.remainingMs);
  }
  if (timeText !== last.time) { els.time.textContent = timeText; last.time = timeText; }
  if (prestartFormat !== last.prestartFormat) {
    if (prestartFormat) pane.clock.dataset.prestartFormat = prestartFormat;
    else delete pane.clock.dataset.prestartFormat;
    last.prestartFormat = prestartFormat;
  }

  // 警告色（RUNNING 中のみ。BREAK は金色 = data-status 側で表現、renderer.js renderTime と同義。
  //   PRE_START は最後 10 秒のみ赤・一時停止中は normal = renderer.js:941-950 と同義）
  const timerState = isPreStart
    ? ((now.status === ENGINE_STATUS.PRESTART && now.remainingMs > 0 && now.remainingMs <= DANGER_MS) ? 'danger' : 'normal')
    : ((now.status === ENGINE_STATUS.RUNNING && !isBreak) ?
      (now.remainingMs <= DANGER_MS ? 'danger' : (now.remainingMs <= WARN_MS ? 'warn' : 'normal')) : 'normal');
  if (timerState !== last.timerState) { pane.clock.dataset.timerState = timerState; last.timerState = timerState; }

  // 区画状態: 単一モードと同一の data-status 値（BREAK は RUNNING + isBreak から導出）+
  //           全レベル完走は clock--timer-finished クラス（単一モードの storage 'finished' 相当）。
  //           PRE_START 一時停止は hall と同じく data-status="PRE_START" 維持 + data-prestart-paused
  const statusKey = isPreStart
    ? (now.status === ENGINE_STATUS.PAUSED ? 'prestart-paused' : 'prestart')
    : ((now.status === ENGINE_STATUS.RUNNING && isBreak) ? 'break' : now.status);
  if (statusKey !== last.status) {
    if (isPreStart) {
      pane.clock.dataset.status = 'PRE_START';
      if (statusKey === 'prestart-paused') pane.clock.dataset.prestartPaused = 'true';
      else delete pane.clock.dataset.prestartPaused;
    } else {
      pane.clock.dataset.status = statusKey === 'break' ? 'BREAK' : (STATUS_ATTR[now.status] || 'IDLE');
      delete pane.clock.dataset.prestartPaused;
    }
    pane.clock.classList.toggle('clock--timer-finished', now.status === ENGINE_STATUS.FINISHED);
    last.status = statusKey;
  }

  // レベル表示 + ブラインドカード + MIX ラベル（レベルが変わった時のみ）
  if (now.levelIndex !== last.levelIndex) {
    els.level.textContent = isBreak ? 'BREAK' : `Level ${level ? level.level : now.levelIndex + 1}`;
    const structureType = GAME_STRUCTURE_TYPE[data.snapshot.gameType] || 'BLIND';
    renderBlindsInto(els.blindsCurrent, level, structureType);
    renderBlindsInto(els.blindsNext, levels[now.levelIndex + 1] || null, structureType);
    renderGameTypeLabel(pane, now.levelIndex);
    last.levelIndex = now.levelIndex;
  }

  // NEXT BREAK IN / TOTAL GAME TIME（秒粒度の文字列比較で変化時のみ）。
  // PRE_START 中は基準を Lv0 満了 duration に差し替え（renderer.js:997-1011 v2.6.1 fix ① と同義）、
  // TOTAL GAME TIME はトーナメント未開始なので 0（status に prestart を渡す）
  const breakMs = isPreStart
    ? computeNextBreakMsFor(levels, 0, levelDurationMs(levels, 0))
    : computeNextBreakMsFor(levels, now.levelIndex, now.remainingMs);
  let breakText;
  if (breakMs === null) {
    breakText = 'T|' + formatHMS(computeTotalGameTimeMsFor(levels, now.levelIndex, now.remainingMs,
      isPreStart ? ENGINE_STATUS.PRESTART : now.status));
  } else {
    breakText = 'B|' + formatHMS(breakMs);
  }
  if (breakText !== last.nextBreak) {
    els.breakLabel.textContent = breakText[0] === 'T' ? 'TOTAL GAME TIME' : 'NEXT BREAK IN';
    els.nextBreak.textContent = breakText.slice(2);
    last.nextBreak = breakText;
  }
}

let rafId = null;
function tickLoop() {
  const nowMs = Date.now();
  for (const pane of panes) renderPaneTick(pane, nowMs);
  rafId = requestAnimationFrame(tickLoop);
}

// ===== 同期受信（multi:state-sync — edge イベント駆動・ポーリングなし） =====
let globalData = null;
let helpEl = null; // Phase 2: キー割当ヘルプオーバーレイ（H でトグル）
let lastUi = null; // Phase 2b: 直近の ui payload（割当変更時にバッジを再評価するため保持）

// Phase 2b: 選択区画のハイライト枠 + トーナメント名バッジ（操作対象の視認性）。
// 選択変化（ui payload）と割当変化（pane payload）の両方から呼ばれ、旧選択区画の表示は
// 全区画ループで必ず落とす（残留なし）
function refreshActiveBadges() {
  const active = (lastUi && Number.isInteger(lastUi.activePane) && lastUi.activePane >= 0 && lastUi.activePane < PANE_COUNT)
    ? lastUi.activePane : null;
  panes.forEach((pane, i) => {
    const on = i === active;
    if ((pane.root.dataset.active === 'true') !== on) pane.root.dataset.active = on ? 'true' : 'false';
    let text = '';
    if (on) {
      const title = (pane.data.assigned && pane.data.snapshot) ? (pane.data.snapshot.title || 'ポーカートーナメント') : '';
      text = title ? `操作中｜区画 ${i + 1}: 〔${title}〕` : `操作中｜区画 ${i + 1}（未割当）`;
    }
    if (pane.els.activeBadge.textContent !== text) pane.els.activeBadge.textContent = text;
    pane.els.activeBadge.classList.toggle('is-visible', on);
  });
}

function applyPanePayload(value) {
  if (!value || typeof value !== 'object') return;
  const index = Number(value.index);
  if (!Number.isInteger(index) || index < 0 || index >= PANE_COUNT) return;
  const pane = panes[index];
  const p = value.pane || {};
  pane.data.assigned = !!p.assigned;
  pane.data.filler = normalizeFiller(p.filler);
  pane.data.snapshot = p.snapshot || null;
  pane.data.engine = p.engine || null;
  renderPaneStatic(pane, globalData);
  refreshActiveBadges(); // 選択中区画の割当が変わってもバッジのトーナメント名が追従
}

// Phase 2: キーボード操作の UI 状態（選択区画ハイライト / ヘルプ表示 / リセット確認バッジ）。
// 真実源は multi-control 側の state（kind:'ui' の edge イベントで受けるだけ・ここは表示専用）
function applyUiPayload(value) {
  if (!value || typeof value !== 'object') return;
  lastUi = value;
  const armIndex = (value.resetArm && Number.isInteger(value.resetArm.index)) ? value.resetArm.index : null;
  panes.forEach((pane, i) => {
    pane.els.resetArm.classList.toggle('is-visible', i === armIndex);
  });
  if (helpEl) helpEl.classList.toggle('is-visible', !!value.helpVisible);
  refreshActiveBadges();
}

function buildHelpOverlay() {
  const aside = document.createElement('aside');
  aside.className = 'mgrid-help';
  aside.innerHTML = `
    <div class="mgrid-help__title">キーボード操作</div>
    <div class="mgrid-help__note">操作対象は選択中の区画だけ（他の区画は動きません）。<br>選択中の区画は水色の枠と左上の「操作中」バッジで確認できます。</div>
    <div><kbd>1</kbd>〜<kbd>4</kbd> 操作する区画を選択</div>
    <div><kbd>S</kbd> スタート（今すぐ）</div>
    <div><kbd>C</kbd> スタートまでカウントダウン開始（区画の開始タイミング設定）</div>
    <div><kbd>Space</kbd>/<kbd>P</kbd> 一時停止 / 再開</div>
    <div><kbd>←</kbd><kbd>→</kbd> レベル戻し / 送り（1 レベルずつ。30秒単位の時間調整はマルチ表示にはありません）</div>
    <div><kbd>R</kbd> リセット（3 秒以内にもう一度押して確定）</div>
    <div><kbd>H</kbd> このヘルプの表示 / 非表示</div>
    <div><kbd>G</kbd> グリッドを前面へ　<kbd>Esc</kbd> 操作盤を前面へ</div>`;
  document.body.appendChild(aside);
  return aside;
}

async function init() {
  for (let i = 0; i < PANE_COUNT; i++) panes.push(buildPane(i));
  helpEl = buildHelpOverlay();

  const api = window.api && window.api.multi;
  if (api && typeof api.subscribeStateSync === 'function') {
    api.subscribeStateSync((payload) => {
      if (!payload || typeof payload !== 'object') return;
      if (payload.kind === 'pane') applyPanePayload(payload.value);
      else if (payload.kind === 'ui') applyUiPayload(payload.value);
    });
  }
  if (api && typeof api.fetchInitialState === 'function') {
    try {
      const snapshot = await api.fetchInitialState();
      globalData = snapshot?.global || null;
      const initPanes = Array.isArray(snapshot?.panes) ? snapshot.panes : [];
      initPanes.forEach((p, i) => { if (p) applyPanePayload({ index: i, pane: p }); });
      // globalData 確定後に全区画を再描画（fetch 前に届いた pane イベントとの race を吸収）
      for (const pane of panes) renderPaneStatic(pane, globalData);
      if (snapshot?.ui) applyUiPayload(snapshot.ui);
    } catch (_) { /* 初期同期失敗時も rAF は開始（後続の state-sync で復帰） */ }
  }
  rafId = requestAnimationFrame(tickLoop);
}

init();
