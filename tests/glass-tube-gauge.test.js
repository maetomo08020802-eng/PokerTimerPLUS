/**
 * glass-tube-gauge（2026-10-10）回帰テスト
 *
 *   時計下のガラス管ゲージ（残り時間 / そのレベルの全体時間）と、ゲーム種ラベルとの排他切替の検証。
 *   - 純粋関数 computeGaugeRatio / formatGaugeMinutes / sanitizeGaugeMode を実ソースから抽出して実行（v272 同パターン）。
 *   - 設定キー gaugeMode が displaySettings の全経路（既定・migration・IPC・import・一覧）に載っていることを静的検証。
 *   - 色は既存の data-timer-state / data-status に連動（新しいしきい値なし）・layout 原則（scale / fixed 不使用）。
 *   - 対象外（4分割 multi / DB 連携 / remote / dual-sync）に差分が及んでいないこと。
 *
 *   実行: node tests/glass-tube-gauge.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const read     = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const RENDERER = read('src', 'renderer', 'renderer.js');
const MAIN_JS  = read('src', 'main.js');
const HTML     = read('src', 'renderer', 'index.html');
const CSS      = read('src', 'renderer', 'style.css');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// function NAME(...) { ... } の全文を波括弧マッチで抽出
function extractFunctionSource(source, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\(`);
  const m = source.match(re);
  if (!m) return null;
  const braceStart = source.indexOf('{', m.index);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(m.index, i + 1); }
  }
  return null;
}
function load(source, name, prelude = '') {
  const src = extractFunctionSource(source, name);
  assert.ok(src, `${name} が見つからない`);
  return new Function(`${prelude}\n${src}\nreturn ${name};`)();
}

const computeGaugeRatio  = load(RENDERER, 'computeGaugeRatio');
const formatGaugeMinutes = load(RENDERER, 'formatGaugeMinutes');
const sanitizeGaugeMode  = load(MAIN_JS, 'sanitizeGaugeMode', "const VALID_GAUGE_MODES = ['tube', 'gameType'];");

// 新ブロック（style.css 末尾の glass-tube-gauge 節）
const CSS_BLOCK = CSS.slice(CSS.indexOf('/* ===== glass-tube-gauge'));

// ============================================================
// 純関数: 水位・分数
// ============================================================
test('R1: 水位 = 残り / 全体（開始直後 1・中間 0.5・残り 0 で 0）', () => {
  assert.equal(computeGaugeRatio(20 * 60 * 1000, 20), 1);
  assert.equal(computeGaugeRatio(10 * 60 * 1000, 20), 0.5);
  assert.equal(computeGaugeRatio(0, 20), 0);
});
test('R2: 水位は 0〜1 に clamp（超過・負値）', () => {
  assert.equal(computeGaugeRatio(25 * 60 * 1000, 20), 1);
  assert.equal(computeGaugeRatio(-5000, 20), 0);
});
test('R3: 全体時間が不明 / 0 / 非数なら満タン（1）', () => {
  assert.equal(computeGaugeRatio(5000, undefined), 1);
  assert.equal(computeGaugeRatio(5000, 0), 1);
  assert.equal(computeGaugeRatio(5000, NaN), 1);
  assert.equal(computeGaugeRatio(undefined, 20), 1);
});
test('R4: 右端の数字は分数のみ（20 → "20"・ブレイク 10 → "10"・Level や秒を含まない）', () => {
  assert.equal(formatGaugeMinutes(20), '20');
  assert.equal(formatGaugeMinutes(10), '10');
  assert.doesNotMatch(formatGaugeMinutes(15), /Level|:|分/);
});
test('R5: 分数が不明なら空文字', () => {
  assert.equal(formatGaugeMinutes(undefined), '');
  assert.equal(formatGaugeMinutes(0), '');
  assert.equal(formatGaugeMinutes(-3), '');
});

// ============================================================
// renderer: 描画経路・負荷・排他切替
// ============================================================
test('D1: renderTime の通常分岐末尾で renderTimeGauge を呼ぶ（PRE_START 2 分岐の return 後）', () => {
  const body = extractFunctionSource(RENDERER, 'renderTime');
  const lastReturn = body.lastIndexOf('return;');
  const call = body.indexOf('renderTimeGauge(remainingMs)');
  assert.ok(call > lastReturn && lastReturn > 0, 'PRE_START 分岐より後で呼ばれていない');
});
test('D2: renderTimeGauge は DOM 書込のみ（setState / dual 送信 / publish を追加しない）・値変化時のみ書込', () => {
  const body = extractFunctionSource(RENDERER, 'renderTimeGauge');
  assert.doesNotMatch(body, /setState|publish|dual|ipc|api\./i);
  assert.match(body, /ratio !== _gaugeCache\.ratio/);
  assert.match(body, /label !== _gaugeCache\.minutes/);
  // codex-fixes ①: 全体時間は state.totalMs 基準（期待値を仕様変更に合わせて更新）
  assert.match(body, /resolveGaugeMinutes\(totalMs,/);
});
test('D3: applyGaugeMode は不正値を tube に倒し data-gauge-mode をセット', () => {
  const body = extractFunctionSource(RENDERER, 'applyGaugeMode');
  assert.match(body, /VALID_GAUGE_MODES\.includes\(value\) \? value : 'tube'/);
  assert.match(body, /dataset\.gaugeMode = v/);
});
test('D4: renderer の反映経路 4 箇所（applyTournament / 起動初期化 / hall dual 受信 / 設定 UI 保存）', () => {
  assert.match(RENDERER, /applyGaugeMode\(ds\.gaugeMode\)/, 'applyTournament');
  assert.match(RENDERER, /gaugeModeInit = activeT\?\.displaySettings\?\.gaugeMode \?\? all\?\.display\?\.gaugeMode \?\? 'tube'/, '起動初期化');
  assert.match(RENDERER, /applyGaugeMode\(gaugeModeInit\)/, '起動初期化の適用');
  assert.match(RENDERER, /typeof value\.gaugeMode === 'string'\) applyGaugeMode\(value\.gaugeMode\)/, 'hall dual 受信');
  assert.match(RENDERER, /setDisplaySettings\(tournamentState\.id, \{ gaugeMode: value \}\)/, '設定 UI 保存');
});
test('D5: index.html — 管は .clock__timer の後・.card-stack の前、設定ラジオ 2 択', () => {
  const iTimer = HTML.indexOf('<div class="clock__timer">');
  const iGauge = HTML.indexOf('id="js-time-gauge"');
  const iStack = HTML.indexOf('<div class="card-stack">');
  assert.ok(iTimer < iGauge && iGauge < iStack, '配置順が違う');
  assert.match(HTML, /name="gauge-mode" value="tube"/);
  assert.match(HTML, /name="gauge-mode" value="gameType"/);
});

// ============================================================
// CSS: 色連動・layout 原則・PRE_START・排他
// ============================================================
test('C1: 色は既存の data-timer-state / data-status に連動（新しいしきい値定数なし）', () => {
  assert.match(CSS_BLOCK, /\.clock\[data-timer-state="warn"\]\s+\.time-gauge/);
  assert.match(CSS_BLOCK, /\.clock\[data-timer-state="danger"\]\s+\.time-gauge/);
  assert.match(CSS_BLOCK, /\.clock\[data-status="BREAK"\]\s+\.time-gauge/);
  assert.equal((RENDERER.match(/WARN_THRESHOLD_MS\s*=/g) || []).length, 1);
  assert.equal((RENDERER.match(/DANGER_THRESHOLD_MS\s*=/g) || []).length, 1);
  assert.doesNotMatch(RENDERER, /GAUGE_[A-Z_]*THRESHOLD/);
});
test('C2: 一時停止中は水をくすませ気泡アニメを止める', () => {
  assert.match(CSS_BLOCK, /\.clock\[data-status="PAUSED"\] \.time-gauge__liquid \{ filter: grayscale/);
  assert.match(CSS_BLOCK, /animation-play-state: paused/);
});
test('C3: PRE_START（一時停止含む）は visibility: hidden で領域保持', () => {
  // codex-fixes ②④: 非表示条件に data-prestart-format / clock--timer-finished を追加（期待値を仕様変更に合わせて更新）
  assert.match(CSS_BLOCK, /\.clock\[data-status="PRE_START"\] \.time-gauge,\s*\.clock\[data-prestart-paused="true"\] \.time-gauge,\s*\.clock\[data-prestart-format\] \.time-gauge,\s*\.clock--timer-finished \.time-gauge,\s*\.time-gauge\[data-ended\] \{\s*visibility: hidden;/);
});
test('C4: 排他 — tube でゲーム種行を高さごと消す / gameType で管を消す', () => {
  assert.match(CSS_BLOCK, /:root\[data-gauge-mode="tube"\] \.event-game-type \{ display: none; \}/);
  assert.match(CSS_BLOCK, /:root\[data-gauge-mode="gameType"\] \.time-gauge \{ display: none; \}/);
});
test('C5: layout 原則 — 新ブロックに transform: scale / position: fixed なし・水位は clip-path・外寸固定', () => {
  const code = CSS_BLOCK.replace(/\/\*[\s\S]*?\*\//g, '');   // コメント中の説明文は除外
  assert.doesNotMatch(code, /transform\s*:[^;]*\bscale/);   // grayscale() は対象外（\b で除外）
  assert.doesNotMatch(code, /position\s*:\s*fixed/);
  assert.match(CSS_BLOCK, /clip-path: inset\(0 calc\(\(1 - var\(--gauge-ratio, 1\)\) \* 100%\)/);
  assert.match(CSS_BLOCK, /\.time-gauge \{[^}]*width: 54vw;[^}]*height: 2\.6vh;/);
});
test('C6: 時計本体の寸法は不変（.clock__time font-size / .clock__timer min-height / カード 54vw・46vw）', () => {
  assert.match(CSS, /font-size: clamp\(min\(8vw, 16vh\), calc\(min\(22vw, 32vh\) \* var\(--font-timer-scale, 1\)\), 22vw\);/);
  assert.match(CSS, /\.clock__timer \{[^}]*min-height: 22vh;/);
  assert.match(CSS, /\.card-blinds \{[^}]*width: 54vw;/);
  assert.doesNotMatch(CSS_BLOCK, /\.clock__time\b|\.clock__timer\b|\.card-blinds|\.card-next/);
});

// ============================================================
// main.js: 設定キー gaugeMode の全経路
// ============================================================
test('M1: sanitizeGaugeMode — 正値はそのまま・欠落 / 不正 / null は fallback → tube', () => {
  assert.equal(sanitizeGaugeMode('tube', 'tube'), 'tube');
  assert.equal(sanitizeGaugeMode('gameType', 'tube'), 'gameType');
  assert.equal(sanitizeGaugeMode(undefined, 'tube'), 'tube');
  assert.equal(sanitizeGaugeMode(null, 'gameType'), 'gameType');
  assert.equal(sanitizeGaugeMode('xxx', 'bad'), 'tube');
});
test('M2: 既定値 tube（DEFAULT_TOURNAMENT_EXT / store defaults display / tournaments[0]）', () => {
  assert.ok((MAIN_JS.match(/gaugeMode: 'tube'/g) || []).length >= 3);
});
test('M3: VALID_TIMER_FONTS の各経路に gaugeMode が並走（既定算出 / migration / setDisplay / import / normalize / 一覧 / setDisplaySettings）', () => {
  const regions = [
    ['getDefaultDisplaySettings', /gaugeMode: sanitizeGaugeMode\(g\.gaugeMode, 'tube'\)/],
    ['migrateTournamentSchema',   /gaugeMode: sanitizeGaugeMode\(ds\.gaugeMode, fallbackGaugeMode\)/]
  ];
  for (const [fn, re] of regions) {
    assert.match(extractFunctionSource(MAIN_JS, fn), re, fn);
  }
  assert.match(MAIN_JS, /merged\.gaugeMode = sanitizeGaugeMode\(partial\.gaugeMode/, 'settings:setDisplay');
  assert.match(MAIN_JS, /gaugeMode: sanitizeGaugeMode\(ds\?\.gaugeMode, fb\.gaugeMode \|\| 'tube'\)/, 'import');
  assert.match(MAIN_JS, /gaugeMode: sanitizeGaugeMode\(fb\.gaugeMode, 'tube'\)/, 'normalize');
  assert.match(MAIN_JS, /gaugeMode: sanitizeGaugeMode\(ds\.gaugeMode, 'tube'\)/, 'tournaments 一覧');
  assert.match(MAIN_JS, /\('gaugeMode' in ds\)\s*\?\s*sanitizeGaugeMode\(ds\.gaugeMode, cur\.gaugeMode \|\| 'tube'\)/, 'setDisplaySettings');
});
test('M4: migration — キー無し/不正値を補完し差分検知、既存フィールド（画像含む）は {...ds, ...fixed} で保持', () => {
  const body = extractFunctionSource(MAIN_JS, 'migrateTournamentSchema');
  assert.match(body, /const fallbackGaugeMode = sanitizeGaugeMode\(globalDisplay\.gaugeMode, 'tube'\)/);
  assert.match(body, /m\.displaySettings = \{ \.\.\.fallbackDisplay, gaugeMode: fallbackGaugeMode \}/);
  assert.match(body, /\|\| fixed\.gaugeMode !== ds\.gaugeMode/);
  assert.match(body, /m\.displaySettings = \{ \.\.\.ds, \.\.\.fixed \}/);
});

// ============================================================
// 対象外の非接触
// ============================================================
test('N1: 4分割 multi / DB 連携 / remote / dual-sync / timer.js に gaugeMode・time-gauge の出現なし', () => {
  const dirs = [['src', 'renderer', 'multi'], ['src', 'link'], ['src', 'remote']];
  const files = [];
  for (const d of dirs) {
    for (const f of fs.readdirSync(path.join(ROOT, ...d))) {
      const p = path.join(ROOT, ...d, f);
      if (fs.statSync(p).isFile()) files.push(p);
    }
  }
  files.push(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), path.join(ROOT, 'src', 'renderer', 'timer.js'));
  for (const p of files) {
    const txt = fs.readFileSync(p, 'utf8');
    assert.doesNotMatch(txt, /gaugeMode|time-gauge|gauge-mode/, path.relative(ROOT, p));
  }
});
test('N2: 致命バグ保護 5 件の識別子が存続', () => {
  assert.match(RENDERER, /function resetBlindProgressOnly/);
  assert.match(RENDERER, /function ensureEditorEditableState/);
  assert.match(RENDERER, /function handleReset/);
});
test('N3: scripts.test に本テストが登録', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.test, /tests\/glass-tube-gauge\.test\.js/);
});

console.log(`\nglass-tube-gauge.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
