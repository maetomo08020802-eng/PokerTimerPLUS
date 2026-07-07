// PokerTimerPLUS+ multi-tournament-4up Phase 1 — 会場側 2×2 グリッド（表示専用）
//
// 設計原則（Phase 1 brief B / F / H）:
//   - 独立 HTML の純粋 consumer。既存 renderer.js / state.js / timer.js / audio.js は import しない
//   - 状態の真実源は multi-control。ここは multi:state-sync（edge イベント）を受けて
//     endAtMs seed で自走描画する（hall の renderHallTickFrame と同じ実証済みパターン・ポーリングなし）
//   - rAF ループは 1 本（4 区画ぶんを 1 ループで回す）
//   - DOM 書込は「表示文字列が変わった時のみ」（rAF は判定のみ・毎秒粒度）
//   - store への書込は一切しない（読み取りすらしない: 必要データは control が snapshot で送る）
//   - 音 / スライドショー / テロップ / PIP / ミュートバッジは DOM ごと存在しない

import { computePaneNow, computeNextBreakMsFor, computeTotalGameTimeMsFor, ENGINE_STATUS } from './multi-engine.mjs';

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

// ===== 区画 DOM 構築 =====
const gridRoot = document.getElementById('js-mgrid');
const panes = []; // { root, els, data: {assigned, filler, snapshot, engine}, last: {…表示キャッシュ} }

function buildPane(index) {
  const root = document.createElement('section');
  root.className = 'pane';
  root.dataset.pane = String(index);
  root.dataset.assigned = 'false';
  root.dataset.bg = 'black';
  root.innerHTML = `
    <div class="pane-bg-image"></div>
    <div class="pane-inner">
      <header class="mp-header">
        <div class="mp-title js-title"></div>
        <div class="mp-subtitle js-subtitle"></div>
        <div class="mp-gametype js-gametype"></div>
        <div class="mp-prize-category js-prize-category"></div>
      </header>
      <div class="mp-body">
        <div class="mp-col mp-left">
          <div class="mp-logo-box">
            <img class="mp-logo-img js-logo" alt="" hidden>
            <span class="mp-logo-placeholder js-logo-placeholder">PokerTimerPLUS+</span>
            <span class="mp-presented-by js-presented-by"></span>
          </div>
          <span class="mp-section-label">PAYOUTS</span>
          <div class="mp-payouts js-payouts"></div>
          <span class="mp-total-pool-label">TOTAL PRIZE POOL</span>
          <span class="mp-total-pool js-total-pool"></span>
          <span class="mp-pool-note js-pool-note">（GTD）</span>
        </div>
        <div class="mp-col mp-center">
          <div class="mp-level js-level"></div>
          <div class="mp-time js-time">--:--</div>
          <div class="mp-blinds-cards">
            <div class="mp-blinds-card">
              <div class="mp-blinds-card__label">BLINDS</div>
              <div class="mp-blinds-content js-blinds-current"></div>
            </div>
            <div class="mp-blinds-card mp-blinds-card--next">
              <div class="mp-blinds-card__label">NEXT LEVEL</div>
              <div class="mp-blinds-content js-blinds-next"></div>
            </div>
          </div>
        </div>
        <div class="mp-col mp-right">
          <div class="mp-stat">
            <span class="mp-stat__label js-break-label">NEXT BREAK IN</span>
            <span class="mp-stat__value js-next-break">--:--:--</span>
          </div>
          <div class="mp-stat">
            <span class="mp-stat__label">AVG STACK</span>
            <span class="mp-stat__value js-avg-stack">0</span>
          </div>
          <div class="mp-stat">
            <span class="mp-stat__label">PLAYERS</span>
            <span class="mp-stat__value js-players">0 / 0</span>
          </div>
          <div class="mp-stat mp-stat--optional js-reentry-row">
            <span class="mp-stat__label">REENTRY</span>
            <span class="mp-stat__value js-reentry">0</span>
          </div>
          <div class="mp-stat mp-stat--optional js-addon-row">
            <span class="mp-stat__label">ADDON</span>
            <span class="mp-stat__value js-addon">0</span>
          </div>
          <div class="mp-special-stack js-special-stack"></div>
        </div>
      </div>
    </div>
    <div class="mp-finished-overlay"><span class="mp-finished-label">TOURNAMENT FINISHED</span></div>
    <div class="mp-pause-overlay"><span class="mp-pause-label">一時停止中</span></div>
    <div class="mp-complete-overlay">
      <span class="mp-complete-label">トーナメント終了</span>
      <span class="mp-complete-sub">TOURNAMENT COMPLETE</span>
    </div>
    <div class="pane-filler" data-filler="blank">
      <img class="pane-filler__logo" src="../../assets/logo-plus2-default.png" alt="">
    </div>`;
  gridRoot.appendChild(root);
  const q = (sel) => root.querySelector(sel);
  return {
    root,
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
      specialStack: q('.js-special-stack'),
      filler: q('.pane-filler')
    },
    data: { assigned: false, filler: 'blank', snapshot: null, engine: null },
    last: { time: null, levelIndex: null, status: null, timerState: null, nextBreak: null }
  };
}

// ===== 静的部分の描画（割当 / runtime 変更などの edge イベント時のみ） =====
function renderBlindsInto(targetEl, level, structureType, isNext) {
  let effective = structureType;
  if (structureType === 'MIX' && level && !level.isBreak && typeof level.subStructureType === 'string'
      && STRUCTURE_FIELDS[level.subStructureType] && level.subStructureType !== 'MIX') {
    effective = level.subStructureType;
  }
  if (!level) {
    targetEl.innerHTML = `<div class="mp-blinds-field mp-blinds-field--full"><span class="mp-blinds-field__value">— (最終)</span></div>`;
    return;
  }
  if (level.isBreak) {
    const label = level.label || 'ブレイク';
    targetEl.innerHTML = `<div class="mp-blinds-field mp-blinds-field--full"><span class="mp-blinds-field__value">${escapeHtml(label)}</span></div>`;
    return;
  }
  const fields = STRUCTURE_FIELDS[effective] || STRUCTURE_FIELDS.BLIND;
  targetEl.innerHTML = fields.map((f) => {
    const v = level[f];
    const value = (typeof v === 'number') ? formatNumber(v) : '—';
    return `<div class="mp-blinds-field">
      <span class="mp-blinds-field__label">${escapeHtml(FIELD_LABEL[f] || f)}</span>
      <span class="mp-blinds-field__value">${escapeHtml(value)}</span>
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
  els.filler.dataset.filler = data.filler === 'logo' ? 'logo' : 'blank';
  if (!data.assigned || !data.snapshot) return;
  const snap = data.snapshot;

  // 区画テーマ（トーナメント毎設定を尊重・区画コンテナ単位。前原確定 2026-07-07 #2）
  const ds = snap.displaySettings || {};
  pane.root.dataset.bg = VALID_BG.has(ds.background) ? ds.background : 'navy';
  pane.root.dataset.timerFont = VALID_FONT.has(ds.timerFont) ? ds.timerFont : 'jetbrains';
  pane.root.dataset.bgOverlay = (ds.backgroundOverlay === 'low' || ds.backgroundOverlay === 'strong') ? ds.backgroundOverlay : 'mid';
  els.bgImage.style.backgroundImage = (ds.background === 'image' && typeof snap.backgroundImage === 'string' && snap.backgroundImage)
    ? `url("${snap.backgroundImage}")` : '';

  // ヘッダ
  pane.root.style.setProperty('--pane-title-color', /^#[0-9a-fA-F]{6}$/.test(snap.titleColor || '') ? snap.titleColor : '#FFFFFF');
  els.title.textContent = snap.title || 'ポーカートーナメント';
  els.subtitle.textContent = snap.subtitle || '';
  els.prizeCategory.textContent = snap.prizeCategory ? `※ PRIZEは${snap.prizeCategory}として付与` : '';

  // ロゴ / presented by（グローバル設定・全区画共通）
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
  els.poolNote.classList.toggle('is-visible', isGuaranteeActiveFor(snap));
  const amounts = computeRoundedAmountsFor(snap);
  els.payouts.innerHTML = (snap.payouts || []).map((p, i) =>
    `<div class="mp-payouts-row${i >= 3 ? ' mp-payouts-row--secondary' : ''}">
      <span>${escapeHtml(String(p.rank))}位</span><span>${escapeHtml(symbol + formatNumber(amounts[i] ?? 0))}</span>
    </div>`).join('');
  els.avgStack.textContent = formatNumber(computeAvgStackFor(snap));
  const rt = snap.runtime || { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 };
  els.players.textContent = `${rt.playersRemaining || 0} / ${rt.playersInitial || 0}`;
  els.reentry.textContent = String(rt.reentryCount || 0);
  els.reentryRow.classList.toggle('is-visible', (rt.reentryCount || 0) > 0);
  els.addon.textContent = String(rt.addOnCount || 0);
  els.addonRow.classList.toggle('is-visible', (rt.addOnCount || 0) > 0);
  const ss = snap.specialStack || { enabled: false };
  const ssVisible = !!ss.enabled && (Number(ss.appliedCount) || 0) > 0;
  els.specialStack.classList.toggle('is-visible', ssVisible);
  if (ssVisible) {
    const total = (Number(ss.chips) || 0) * (Number(ss.appliedCount) || 0);
    const label = (ss.label || '').trim();
    els.specialStack.textContent = label ? `特殊配布: ${label} ${formatNumber(total)}` : `特殊配布: ${formatNumber(total)}`;
  }
  // 残0人オーバーレイ（TOURNAMENT FINISHED）
  pane.root.classList.toggle('is-players-finished', (rt.playersInitial || 0) > 0 && (rt.playersRemaining || 0) === 0);

  // タイマー系キャッシュを無効化して次フレームで必ず再描画
  pane.last = { time: null, levelIndex: null, status: null, timerState: null, nextBreak: null };
}

// ===== タイマー描画（rAF 1 本・変化時のみ DOM 書込） =====
function renderPaneTick(pane, nowMs) {
  const { data, els, last } = pane;
  if (!data.assigned || !data.snapshot) return;
  const levels = data.snapshot.levels || [];
  const now = computePaneNow(data.engine, levels, nowMs);
  const level = levels[now.levelIndex] || null;
  const isBreak = !!(level && level.isBreak);

  // 大タイマー（文字列が変わった時のみ）
  const timeText = formatTime(now.remainingMs);
  if (timeText !== last.time) { els.time.textContent = timeText; last.time = timeText; }

  // 警告色（RUNNING 中のみ。BREAK は金色 = data-status 側で表現、renderer.js renderTime と同義）
  const timerState = (now.status === ENGINE_STATUS.RUNNING && !isBreak) ?
    (now.remainingMs <= DANGER_MS ? 'danger' : (now.remainingMs <= WARN_MS ? 'warn' : 'normal')) : 'normal';
  if (timerState !== last.timerState) { pane.root.dataset.timerState = timerState; last.timerState = timerState; }

  // 区画状態（idle / running / break / paused / finished）
  const status = (now.status === ENGINE_STATUS.RUNNING && isBreak) ? 'break' : now.status;
  if (status !== last.status) { pane.root.dataset.status = status; last.status = status; }

  // レベル表示 + ブラインドカード + MIX ラベル（レベルが変わった時のみ）
  if (now.levelIndex !== last.levelIndex) {
    els.level.textContent = isBreak ? 'BREAK' : `Level ${level ? level.level : now.levelIndex + 1}`;
    const structureType = GAME_STRUCTURE_TYPE[data.snapshot.gameType] || 'BLIND';
    renderBlindsInto(els.blindsCurrent, level, structureType, false);
    renderBlindsInto(els.blindsNext, levels[now.levelIndex + 1] || null, structureType, true);
    renderGameTypeLabel(pane, now.levelIndex);
    last.levelIndex = now.levelIndex;
  }

  // NEXT BREAK IN / TOTAL GAME TIME（秒粒度の文字列比較で変化時のみ）
  const breakMs = computeNextBreakMsFor(levels, now.levelIndex, now.remainingMs);
  let breakText;
  if (breakMs === null) {
    breakText = 'T|' + formatHMS(computeTotalGameTimeMsFor(levels, now.levelIndex, now.remainingMs, now.status));
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

function applyPanePayload(value) {
  if (!value || typeof value !== 'object') return;
  const index = Number(value.index);
  if (!Number.isInteger(index) || index < 0 || index >= PANE_COUNT) return;
  const pane = panes[index];
  const p = value.pane || {};
  pane.data.assigned = !!p.assigned;
  pane.data.filler = p.filler === 'logo' ? 'logo' : 'blank';
  pane.data.snapshot = p.snapshot || null;
  pane.data.engine = p.engine || null;
  renderPaneStatic(pane, globalData);
}

async function init() {
  for (let i = 0; i < PANE_COUNT; i++) panes.push(buildPane(i));

  const api = window.api && window.api.multi;
  if (api && typeof api.subscribeStateSync === 'function') {
    api.subscribeStateSync((payload) => {
      if (!payload || typeof payload !== 'object') return;
      if (payload.kind === 'pane') applyPanePayload(payload.value);
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
    } catch (_) { /* 初期同期失敗時も rAF は開始（後続の state-sync で復帰） */ }
  }
  rafId = requestAnimationFrame(tickLoop);
}

init();
