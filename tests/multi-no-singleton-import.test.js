/**
 * multi-tournament-4up Phase 1 — 非接触性の静的検証
 *
 * 「multi 系新ファイルが既存シングルトン（timer.js / state.js / blinds.js / audio.js / dual-sync.js /
 *  marquee.js / renderer.js）を import しない」「store 書込 API を呼ばない」
 * 「ページ大域（document.documentElement）へ書かない」ことをソース文字列レベルで担保する。
 * これが破られると、単一モードとの状態衝突（Phase 0 plan §1.5 のシングルトン障害）が再発する。
 *
 * 実行: node tests/multi-no-singleton-import.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

const MULTI_DIR = path.join(__dirname, '..', 'src', 'renderer', 'multi');
const MULTI_FILES = ['multi-engine.mjs', 'multi-grid.js', 'multi-control.js', 'multi-grid.html', 'multi-control.html', 'multi.css'];
const sources = {};
for (const f of MULTI_FILES) {
  sources[f] = fs.readFileSync(path.join(MULTI_DIR, f), 'utf8');
}

// コメント（設計原則の説明文）は検査対象外にする。「〜は使わない」という原則コメント自体が
// 禁止パターンに誤検知されるため、コード実体のみを検査する。
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // JS/CSS ブロックコメント
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // JS 行コメント（URL の :// は除外）
    .replace(/<!--[\s\S]*?-->/g, '');   // HTML コメント
}
const code = {};
for (const f of MULTI_FILES) code[f] = stripComments(sources[f]);
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
const RENDERER = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');

// ============================================================
// 1. 既存シングルトンモジュールを import しない
// ============================================================
test('multi 系 JS は既存シングルトン（timer/state/blinds/audio/dual-sync/marquee/renderer）を import しない', () => {
  const banned = ['timer.js', 'state.js', 'blinds.js', 'audio.js', 'dual-sync.js', 'marquee.js', 'renderer.js'];
  for (const f of ['multi-engine.mjs', 'multi-grid.js', 'multi-control.js']) {
    const src = code[f];
    for (const b of banned) {
      assert.ok(!new RegExp(`import[^;]*['"][^'"]*${b.replace('.', '\\.')}['"]`).test(src),
        `${f} が ${b} を import している`);
    }
  }
});

test('multi HTML は index.html の資産（style.css / renderer.js / audio / marquee）を読み込まない', () => {
  for (const f of ['multi-grid.html', 'multi-control.html']) {
    const src = code[f];
    assert.ok(!/href="\.\.\/style\.css"|src="\.\.\/renderer\.js"|src="\.\.\/audio\.js"|src="\.\.\/marquee\.js"/.test(src),
      `${f} が単一モードの資産を読み込んでいる`);
  }
});

// ============================================================
// 2. 無効化 3 項目 + 付随（スライドショー / 音 / テロップ / PIP / ミュートバッジ）が DOM ごと存在しない
// ============================================================
test('multi-grid に スライドショー / 音 / テロップ / PIP / ミュートバッジ の痕跡がない', () => {
  const src = code['multi-grid.html'] + code['multi-grid.js'] + code['multi.css'];
  const banned = [/slideshow/i, /marquee/i, /AudioContext/, /playSound/, /pip-timer|pipTimer|data-pip/i, /mute-indicator|muteIndicator|ミュート中/];
  for (const re of banned) {
    assert.ok(!re.test(src), `multi-grid に ${re} の痕跡がある`);
  }
});

// ============================================================
// 3. store 書込 API を呼ばない（読み取り専用 snapshot 設計の担保 = 致命保護⑤非衝突の根拠）
// ============================================================
test('multi 系 JS は store 書込系 API（setTimerState/setRuntime/setActive/save/delete 等）を呼ばない', () => {
  const banned = ['setTimerState', 'setRuntime', 'setActive', 'tournaments.save', 'tournaments.delete',
    'setDisplaySettings', 'setMarqueeSettings', 'saveUser', 'deleteUser', 'importPayload', 'audio.set'];
  for (const f of ['multi-engine.mjs', 'multi-grid.js', 'multi-control.js']) {
    for (const b of banned) {
      assert.ok(!code[f].includes(b), `${f} が ${b} を呼んでいる`);
    }
  }
});

test('main.js の multi ブロックは store.set を呼ばない（読み取りのみ）', () => {
  // multi ブロック（マーカーコメント〜 registerMultiIpcHandlers() 呼出まで）を抽出して検証
  const m = MAIN.match(/\/\/ ===== multi-tournament-4up Phase 1[\s\S]*?registerMultiIpcHandlers\(\);/);
  assert.ok(m, 'main.js に multi ブロックが見つからない');
  assert.ok(!/store\.set\(/.test(m[0]), 'multi ブロックが store.set を呼んでいる');
  assert.ok(/store\.get\(/.test(m[0]), 'multi ブロックの store 参照は get のみのはず');
});

// ============================================================
// 4. ページ大域（document.documentElement）へ書かない（区画コンテナ単位テーマの担保）
// ============================================================
test('multi-grid.js / multi-control.js は document.documentElement に触れない', () => {
  for (const f of ['multi-grid.js', 'multi-control.js']) {
    assert.ok(!code[f].includes('document.documentElement'), `${f} が document.documentElement に触れている`);
  }
});

test('multi.css は transform: scale を使わない（レイアウトシフト撲滅原則）', () => {
  assert.ok(!/transform\s*:\s*scale/i.test(code['multi.css']), 'multi.css に transform: scale がある');
});

// ============================================================
// 5. 入口・チャンネルの配線が存在する（結線切れの検知）
// ============================================================
test('入口: index.html にボタン、renderer.js 末尾にハンドラ、preload に multi API がある', () => {
  assert.ok(INDEX_HTML.includes('js-multi-mode-enter'), 'index.html に入口ボタンがない');
  assert.ok(RENDERER.includes("getElementById('js-multi-mode-enter')"), 'renderer.js に入口ハンドラがない');
  assert.ok(PRELOAD.includes("'multi:enter'") && PRELOAD.includes("'multi:state-sync-init'"), 'preload.js に multi API がない');
});

test('main.js: multi:* IPC（enter/exit/publish/state-sync-init）が登録されている', () => {
  for (const ch of ["'multi:enter'", "'multi:exit'", "'multi:publish'", "'multi:state-sync-init'"]) {
    assert.ok(MAIN.includes(ch), `main.js に ${ch} ハンドラがない`);
  }
});

test('main.js: 既存 dual 系コアは無改変（_publishDualState の hallWindow 単一送信 / _dualStateCache 構造）', () => {
  // multi 追加後も dual-sync コアの不変条件が保たれていることの回帰ガード
  assert.match(MAIN, /function _broadcastDualState\(channel, payload\) \{\s*if \(!hallWindow \|\| hallWindow\.isDestroyed\(\)\) return;/,
    '_broadcastDualState の hall 単一送信ガードが変わっている');
  assert.ok(!/multiGridWindow/.test(MAIN.match(/function _publishDualState[\s\S]*?\n\}/)[0]),
    '_publishDualState が multi ウィンドウに送信している（別チャンネル原則違反）');
});

// ============================================================
// 6. phase1b-grid-parity: 区画 = 単一モード会場画面の 1/4 忠実縮小の構造担保
// ============================================================
test('phase1b: 区画テンプレートが単一モードの構造クラスを持つ（.clock 3カラム / カード / 統計群）', () => {
  const required = ['clock__left', 'clock__center', 'clock__right', 'event-header', 'event-title',
    'event-subtitle', 'event-game-type', 'event-prize-category', 'level-display', 'clock__time',
    'clock__timer', 'card-stack', 'card-blinds', 'card-next', 'blinds-content', 'blinds-field__value',
    'stat-group', 'stat-value--xl', 'next-break-value', 'payouts-list', 'payouts-row',
    'clock__presented-by', 'clock__pool-note', 'clock__pause-label',
    'clock__finished-overlay', 'clock__timer-finished-overlay', 'clock__logo-placeholder'];
  for (const cls of required) {
    assert.ok(code['multi-grid.js'].includes(cls), `multi-grid.js のテンプレートに ${cls} がない`);
    assert.ok(code['multi.css'].includes(`.${cls.split(' ')[0]}`) || code['multi.css'].includes(cls), `multi.css に ${cls} のスタイルがない`);
  }
});

test('phase1b: multi.css は cq 単位移植（レイアウトに vw/vh を使わない = 区画基準の 1/4 縮小）', () => {
  assert.ok(/cq[wh]/.test(code['multi.css']), 'multi.css に cq 単位がない');
  // .mgrid のビューポート全面指定（100vw/100vh）だけは許容。それ以外の vw/vh はページ全体基準に
  // なってしまい区画縮小が壊れるため禁止。
  const withoutGrid = code['multi.css'].replace(/100vw|100vh/g, '');
  assert.ok(!/[\d.](vw|vh)\b/.test(withoutGrid), 'multi.css のレイアウトに vw/vh が残っている');
  // 単一モードと同じ data 属性セレクタ（状態表現の互換）
  for (const sel of ['[data-status="PAUSED"]', '[data-status="BREAK"]', '[data-timer-state="warn"]', '[data-timer-state="danger"]', '[data-structure="LIMIT_BLIND"]', '[data-max-digits="8"]']) {
    assert.ok(code['multi.css'].includes(sel), `multi.css に ${sel} がない`);
  }
});

test('multi-grid.js は rAF ループ 1 本（requestAnimationFrame の自己再帰が 1 箇所）', () => {
  const count = (code['multi-grid.js'].match(/requestAnimationFrame\(/g) || []).length;
  // tickLoop 内の自己再帰 + 起動時の 1 回 = 2 呼出箇所まで（ループ自体は 1 本）
  assert.ok(count <= 2, `multi-grid.js の requestAnimationFrame 呼出が ${count} 箇所（rAF 1 本原則）`);
});

// ============================================================
// 7. Phase 2: PRE_START / キーボード / フィラー拡充の追随担保
// ============================================================
test('phase2: multi.css に PRE_START 表示パリティのセレクタがある（format 切替 / 最後10秒赤 / 一時停止）', () => {
  for (const sel of [
    '[data-status="PRE_START"][data-prestart-format="hms"]',
    '[data-status="PRE_START"][data-prestart-format="ms"]',
    '[data-status="PRE_START"][data-timer-state="danger"]',
    '[data-prestart-paused="true"]'
  ]) {
    assert.ok(code['multi.css'].includes(sel), `multi.css に ${sel} がない`);
  }
});

test('phase2: PRE_START 遷移とフォーマットの配線（engine の prestart / grid の formatPreStartClock）', () => {
  assert.ok(code['multi-engine.mjs'].includes('startPreStart'), 'multi-engine.mjs に startPreStart がない');
  assert.ok(code['multi-engine.mjs'].includes('cancelPreStart'), 'multi-engine.mjs に cancelPreStart がない');
  assert.ok(code['multi-engine.mjs'].includes("PRESTART: 'prestart'"), 'multi-engine.mjs に prestart status がない');
  assert.ok(code['multi-grid.js'].includes('formatPreStartClock'), 'multi-grid.js が formatPreStartClock を使っていない');
  assert.ok(code['multi-grid.js'].includes('prestartFormat'), 'multi-grid.js が data-prestart-format を書いていない');
  assert.ok(code['multi-control.js'].includes('startPreStart'), 'multi-control.js に カウントダウン開始経路がない');
});

test('phase2: キーボードは control 側 keydown（globalShortcut 不使用 = 単一モードのショートカット地層に非接触）', () => {
  assert.ok(code['multi-control.js'].includes("addEventListener('keydown'"), 'multi-control.js に keydown ハンドラがない');
  assert.ok(code['multi-control.js'].includes('isTypingTarget'), 'multi-control.js にタイピング中ガードがない');
  for (const f of MULTI_FILES) {
    assert.ok(!code[f].includes('globalShortcut'), `${f} が globalShortcut に触れている`);
  }
  const block = MAIN.match(/\/\/ ===== multi-tournament-4up Phase 1[\s\S]*?registerMultiIpcHandlers\(\);/);
  assert.ok(block, 'main.js に multi ブロックが見つからない');
  // 設計原則コメント内の言及は許容し、コード実体のみ検査（本ファイル冒頭の方針と同じ）
  assert.ok(!/globalShortcut/.test(stripComments(block[0])), 'main.js の multi ブロックが globalShortcut を呼んでいる');
});

test('phase2: 新 IPC（pick-filler-image / grid-front / control-front）と ui publish が配線されている', () => {
  for (const ch of ["'multi:pick-filler-image'", "'multi:grid-front'", "'multi:control-front'"]) {
    assert.ok(MAIN.includes(ch), `main.js に ${ch} ハンドラがない`);
    assert.ok(PRELOAD.includes(ch), `preload.js に ${ch} がない`);
  }
  assert.ok(code['multi-control.js'].includes("kind: 'ui'"), 'multi-control.js が ui 状態を publish していない');
  assert.ok(code['multi-grid.js'].includes('applyUiPayload'), 'multi-grid.js に ui 受信処理がない');
});

test('phase2: フィラー拡充（任意画像 / テキスト）の DOM と CSS がある', () => {
  for (const cls of ['pane-filler__image', 'pane-filler__text', 'pane-reset-arm', 'mgrid-help']) {
    assert.ok(code['multi-grid.js'].includes(cls), `multi-grid.js に ${cls} がない`);
    assert.ok(code['multi.css'].includes(`.${cls}`), `multi.css に .${cls} のスタイルがない`);
  }
  assert.ok(code['multi-control.js'].includes('pickFillerImage'), 'multi-control.js に画像選択経路がない');
  // 画像は object-fit: contain で区画枠に収める（はみ出し / レイアウトシフト防止）
  assert.match(code['multi.css'], /\.pane-filler__image[^}]*object-fit:\s*contain/s, 'フィラー画像が contain でない');
});

test('phase2: 新規の連続アニメを足していない（@keyframes は既存 mp-timer-pulse の 1 個のみ）', () => {
  const count = (code['multi.css'].match(/@keyframes/g) || []).length;
  assert.equal(count, 1, `multi.css の @keyframes が ${count} 個（新規常時アニメ禁止）`);
  assert.ok(code['multi.css'].includes('@keyframes mp-timer-pulse'), '既存 mp-timer-pulse が見つからない');
});

test('phase2: フィラー設定は electron-store に永続化しない（settings 系 API を呼ばない）', () => {
  // store 書込 API の網羅 ban はテスト 3 で担保済。ここでは filler が settings 保存系 IPC に
  // 触れていないことを追加で固定する（transient 方針の追随ガード）
  for (const banned of ['settings:set', 'appConfig', 'store.set']) {
    assert.ok(!code['multi-control.js'].includes(banned), `multi-control.js が ${banned} に触れている`);
    assert.ok(!code['multi-grid.js'].includes(banned), `multi-grid.js が ${banned} に触れている`);
  }
});

// ============================================================
// 8. Phase 2b: 操作対象の視認性 + キー一覧の分かりやすさ（前原実機フィードバック対応）
// ============================================================
test('phase2b: grid の選択区画にトーナメント名バッジ（未割当表示・ui/pane 両変化で追従）', () => {
  assert.ok(code['multi-grid.js'].includes('pane-active-badge'), 'multi-grid.js にバッジ DOM がない');
  assert.ok(code['multi.css'].includes('.pane-active-badge'), 'multi.css にバッジ style がない');
  assert.ok(code['multi-grid.js'].includes('未割当'), 'multi-grid.js に未割当時の表示がない');
  assert.ok(code['multi-grid.js'].includes('refreshActiveBadges'), 'multi-grid.js にバッジ再評価関数がない');
  // 選択変化（applyUiPayload）と割当変化（applyPanePayload）の両方から再評価される（追従要件）
  const calls = (code['multi-grid.js'].match(/refreshActiveBadges\(\)/g) || []).length;
  assert.ok(calls >= 2, `refreshActiveBadges の呼出が ${calls} 箇所（ui/pane 両変化での追従が必要）`);
  // 長名は ellipsis で区画外へはみ出さない
  assert.match(code['multi.css'], /\.pane-active-badge[^}]*text-overflow:\s*ellipsis/s, 'バッジに ellipsis がない');
});

test('phase2b: 操作盤側にキーボード操作対象の表示 + 選択ハイライト同期がある', () => {
  assert.ok(code['multi-control.html'].includes('js-mc-kb-target'), 'multi-control.html に操作対象表示欄がない');
  assert.ok(code['multi-control.js'].includes('refreshKbTarget'), 'multi-control.js に操作対象表示の更新関数がない');
  assert.ok(code['multi-control.js'].includes('kbActive'), 'multi-control.js に選択ハイライト（data-kb-active）がない');
  assert.ok(code['multi-control.html'].includes('data-kb-active'), 'multi-control.html にハイライト style がない');
  assert.ok(code['multi-control.js'].includes('未選択'), 'multi-control.js に未選択時の案内表示がない');
});

test('phase2b: ヘルプ/案内にレベル操作の説明と「操作対象は選択区画のみ」の注記がある', () => {
  // ※ Phase 2d でキー割当を単一モードに整合（←→=±30秒 / レベルは Shift+←→ へ移設）。
  //    古い「←→=レベル単位」案内は残さず置換されていることを含めて担保
  assert.ok(/レベル戻し \/ 送り（1 レベルずつ）/.test(code['multi-grid.js']),
    'grid ヘルプにレベル送り戻しの説明がない');
  assert.ok(code['multi-grid.js'].includes('選択中の区画だけ'), 'grid ヘルプに操作対象の明示がない');
  assert.ok(/Shift\+←→/.test(sources['multi-control.html']),
    '操作盤の案内文にレベル送り戻し（Shift+←→）の注記がない');
  assert.ok(!/←→キーはレベル単位/.test(sources['multi-control.html']),
    '操作盤に旧案内（←→=レベル単位）が残っている');
});

// ============================================================
// 9. Phase 2c: 選択ハイライト視認性 + ±30秒 時間微調整（前原実機フィードバック第2弾）
// ============================================================
test('phase2c: 選択ハイライトはオレンジ基調 --select の太枠で grid / バッジ / 操作盤の配色が一致', () => {
  assert.ok(code['multi.css'].includes('--select: #FFB300'), 'multi.css に --select 定義がない');
  const frame = code['multi.css'].match(/\.pane\[data-active="true"\]::after\s*\{[^}]*\}/s);
  assert.ok(frame, 'multi.css に選択枠ルールがない');
  assert.ok(/border:\s*1\.2cqw\s+solid\s+var\(--select\)/.test(frame[0]), '選択枠が --select の太枠（1.2cqw）でない');
  assert.ok(!/var\(--cyan\)/.test(frame[0]), '選択枠に旧水色（--cyan）が残っている');
  const badge = code['multi.css'].match(/\.pane-active-badge\s*\{[^}]*\}/s);
  assert.ok(badge && /var\(--select\)/.test(badge[0]), 'バッジが選択色 --select に統一されていない');
  // 操作盤側は独立 HTML のため同 hex 直書き（multi.css と一致することを担保）
  assert.ok(sources['multi-control.html'].includes('#FFB300'), 'multi-control.html のハイライトが #FFB300 でない');
  assert.ok(!/data-kb-active="true"\]\s*\{[^}]*#4FC3F7/s.test(sources['multi-control.html']),
    '操作盤ハイライトに旧水色が残っている');
});

test('phase2c: ±30秒（adjustTimeBy）がエンジン・操作盤ボタン・キーボード・ヘルプに配線されている', () => {
  assert.ok(code['multi-engine.mjs'].includes('adjustTimeBy'), 'multi-engine.mjs に adjustTimeBy がない');
  assert.ok(code['multi-control.js'].includes('adjustTimeBy'), 'multi-control.js が adjustTimeBy を呼んでいない');
  assert.ok(code['multi-control.js'].includes('30秒戻す') && code['multi-control.js'].includes('30秒進める'),
    '操作盤に 30秒進める/戻す ボタンがない（単一モード文言）');
  // Phase 2d 是正: ±30秒 は単一モードと同じ ←→（ArrowLeft/Right の非 Shift 分岐）
  assert.ok(code['multi-control.js'].includes("'ArrowLeft'") && code['multi-control.js'].includes("'ArrowRight'"),
    'キーボード ←→ の割当がない');
  assert.ok(/30秒戻す \/ 30秒進める/.test(code['multi-grid.js']), 'grid ヘルプに ←→=±30秒の説明がない');
  assert.ok(/←→<\/b>=30秒戻す\/進める/.test(sources['multi-control.html']), '操作盤案内に ←→=±30秒の説明がない');
});

// ============================================================
// 10. Phase 2d: 単一モード操作パリティ（runtime 操作一式 + キー割当是正）
// ============================================================
test('phase2d: runtime 操作（applyRuntimeOp）がエンジン・操作盤ボタン・キーボードに配線されている', () => {
  assert.ok(code['multi-engine.mjs'].includes('applyRuntimeOp'), 'multi-engine.mjs に applyRuntimeOp がない');
  assert.ok(code['multi-control.js'].includes('applyRuntimeOp'), 'multi-control.js が applyRuntimeOp を呼んでいない');
  // 単一モードと同じキー: ↑↓（エントリー/脱落・Shift で取消/復活）・Ctrl+R/A/E（e.code 判定）
  for (const marker of ["'ArrowUp'", "'ArrowDown'", "'KeyR'", "'KeyA'", "'KeyE'",
    'addEntry', 'cancelEntry', 'eliminate', 'revive', 'reentryPlus', 'addOnPlus', 'specialPlus']) {
    assert.ok(code['multi-control.js'].includes(marker), `multi-control.js に ${marker} の配線がない`);
  }
  // 操作盤の runtime ボタン群 + 現在値表示
  for (const cls of ['js-rt-entry-add', 'js-rt-eliminate', 'js-rt-re-plus', 'js-rt-ad-plus', 'js-rt-sp-plus', 'js-rt-status']) {
    assert.ok(code['multi-control.js'].includes(cls), `multi-control.js に ${cls} がない`);
  }
});

test('phase2d: キー割当の単一モード整合（S 即時スタート廃止・Space トグル・リセットは割当値復帰）', () => {
  assert.ok(!/case 's':/.test(code['multi-control.js']), 'S キー割当（即時スタート）が残っている');
  assert.ok(!/case 'p':/.test(code['multi-control.js']), 'P キー割当が残っている（Space に集約）');
  assert.ok(code['multi-control.js'].includes('opStartTimed'), '開始経路（開始タイミング設定に従う）がない');
  assert.ok(code['multi-control.js'].includes('assignRuntime'), 'リセット時の割当値復帰（assignRuntime）がない');
  // grid ヘルプが分類形式で runtime 操作を案内（transient の限界も明記）
  assert.ok(code['multi-grid.js'].includes('mgrid-help__section'), 'grid ヘルプが分類形式でない');
  assert.ok(code['multi-grid.js'].includes('保存はされません'), 'grid ヘルプに transient の限界説明がない');
  assert.ok(sources['multi-control.html'].includes('保存はされません'), '操作盤案内に transient の限界説明がない');
});

// ============================================================
// 11. Phase 2e: 停電・クラッシュ復帰（一時セッションファイル）
//    前提変更: main.js multi ブロックへの fs 書出しは許容。ただし store 書込ゼロ
//    （store.set 不使用＝テスト 3 の既存 assert）と単一経路・preload 非接触は維持
// ============================================================
test('phase2e: セッションファイルの配線（専用ファイル・savedAtMs・tmp+rename・正常終了/quit 削除）', () => {
  const m = MAIN.match(/\/\/ ===== multi-tournament-4up Phase 1[\s\S]*?registerMultiIpcHandlers\(\);/);
  assert.ok(m, 'main.js に multi ブロックが見つからない');
  const b = m[0];
  assert.ok(b.includes('multi-session.json'), '専用セッションファイル名がない');
  assert.ok(b.includes('savedAtMs'), 'savedAtMs（PAUSED 復元の基準時刻）がない');
  assert.ok(b.includes('MULTI_SESSION_SCHEMA'), 'スキーマ版数がない');
  assert.ok(/\.tmp/.test(b) && /rename\(/.test(b), 'tmp+rename の書出しでない（電源断中の破損対策）');
  // 「残存＝異常終了」signal の健全性: 正常終了は exitMultiMode で削除（マルチ在席中のアプリ終了も
  // closed → exitMultiMode 連鎖で網羅）。will-quit には登録しない（v2.0.3 P4 の 1 ハンドラ統合を維持 +
  // マルチ未使用のアプリ終了で復元機会を消さない）
  assert.ok(/_multiModeActive = false;[\s\S]{0,200}_deleteMultiSession\(\)/.test(b), 'exitMultiMode での削除がない');
  assert.ok(!/app\.on\('will-quit'/.test(b), 'multi ブロックが will-quit に登録している（P4 統合違反）');
  // 破損・版数不一致は復元せず破棄（安全側）
  assert.ok(b.includes('_readMultiSession'), 'セッション読取（検証付き）がない');
});

test('phase2e: 復元計算はエンジンの純粋関数を main/control で共用（二重実装なし・preload 無改変）', () => {
  assert.ok(code['multi-engine.mjs'].includes('toPowerLossPausedRecord'), 'エンジンに PAUSED 復元計算がない');
  assert.ok(code['multi-engine.mjs'].includes('sanitizeRecord'), 'エンジンに復元入力の防御検証がない');
  const b = MAIN.match(/\/\/ ===== multi-tournament-4up Phase 1[\s\S]*?registerMultiIpcHandlers\(\);/)[0];
  assert.ok(b.includes('toPowerLossPausedRecord'), 'main が復元計算を共用していない');
  assert.ok(!/function toPowerLossPausedRecord/.test(MAIN), 'main に復元計算の二重実装がある');
  assert.ok(code['multi-control.js'].includes('restorePanesFromInit'), 'control に復元再構築がない');
  assert.ok(code['multi-control.js'].includes('assignRuntime: pane.assignRuntime'),
    'publish payload に assignRuntime（リセット復帰先）がない');
  assert.ok(!PRELOAD.includes('multi-session'), 'preload にセッション関連が漏れている（無改変原則）');
});

// ============================================================
console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
