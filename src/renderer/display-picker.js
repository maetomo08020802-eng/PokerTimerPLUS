// PokerTimerPLUS+ v2.0.0 STEP 4: モニター選択ダイアログ
// 役割: 起動時に検出されたモニター一覧を表示し、ホール側として使うモニターを 1 つ選ぶ。
// 動作:
//   - main から `dual.fetchDisplays` で displays + lastSelected を受信
//   - 各モニターをカードで表示、前回選択は「前回選択」バッジ付き
//   - 「このモニターをホール側にする」クリックで `dual.selectHallMonitor(displayId)` 送信
//   - 「キャンセル」クリックで window.close() → main 側で resolve(null) → 単画面モード起動
// 設計:
//   - inline script 禁止（CSP `script-src 'self'`）、本ファイルが唯一のスクリプト
//   - 独立した小規模 UI、既存 renderer.js / state.js は読み込まない（picker は role 無関係）

'use strict';

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function buildLabel(d, index) {
  // Windows 環境では display.label が空の場合あり。fallback ラベル生成（v2-design.md §2.2）。
  if (d && typeof d.label === 'string' && d.label.trim() !== '') return d.label;
  return `モニター ${index + 1}`;
}

async function init() {
  const list = document.getElementById('displayList');
  const cancelBtn = document.getElementById('cancelBtn');
  if (!list || !cancelBtn) return;

  const dual = window.api && window.api.dual;
  if (!dual || typeof dual.fetchDisplays !== 'function') {
    list.textContent = 'モニター情報の取得に失敗しました（API 未接続）';
    return;
  }

  let data;
  try {
    data = await dual.fetchDisplays();
  } catch (err) {
    list.textContent = 'モニター情報の取得に失敗しました';
    return;
  }
  if (!data || !Array.isArray(data.displays) || data.displays.length === 0) {
    list.textContent = 'モニターが検出されませんでした';
    return;
  }

  data.displays.forEach((d, i) => {
    const card = document.createElement('div');
    card.className = 'display-card';
    if (data.lastSelected != null && d.id === data.lastSelected) {
      card.classList.add('is-last-selected');
    }
    const info = document.createElement('div');
    info.className = 'display-card__info';
    const name = document.createElement('div');
    name.className = 'display-card__name';
    name.textContent = buildLabel(d, i);
    const detail = document.createElement('div');
    detail.className = 'display-card__detail';
    const w = (d.bounds && d.bounds.width) || 0;
    const h = (d.bounds && d.bounds.height) || 0;
    detail.textContent = `${w}×${h}${d.isPrimary ? '（プライマリ）' : ''}`;
    info.appendChild(name);
    info.appendChild(detail);

    if (data.lastSelected != null && d.id === data.lastSelected) {
      const badge = document.createElement('span');
      badge.className = 'display-card__badge';
      badge.textContent = '前回選択';
      info.appendChild(badge);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-select';
    btn.textContent = 'このモニターをホール側にする';
    btn.addEventListener('click', () => {
      try {
        dual.selectHallMonitor(d.id);
      } catch (_) { /* fail-silent: window.close 経由で main は resolve(null) する */ }
    });

    card.appendChild(info);
    card.appendChild(btn);
    list.appendChild(card);
  });

  cancelBtn.addEventListener('click', () => {
    // BrowserWindow が閉じる → main 側 'closed' イベントで resolve(null) → 単画面モードで起動
    window.close();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
