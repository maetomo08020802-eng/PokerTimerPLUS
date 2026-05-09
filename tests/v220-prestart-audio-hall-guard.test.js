/**
 * v2.1.8 静的解析テスト — PRE_START 関連 2 件のバグ根治
 *
 *   Fix 1: src/renderer/renderer.js handleAudioOnTick 冒頭に hall ガード
 *   Fix 2: src/renderer/renderer.js handleAudioOnPreStartTick 冒頭に hall ガード
 *   Fix 3: src/renderer/audio.js playSound 冒頭に hall ガード（多層防御）
 *   Fix 4: src/renderer/style.css の :root[data-slideshow="active"] .clock を
 *          display: none → opacity: 0; pointer-events: none に変更
 *
 * バグ A 真因: style.css の display: none → display: block 切替の reflow タイミングずれで、
 *              スライドショー終了時に PRE_START カウントダウンが visual に反映されない。
 * バグ B 真因: operator / hall 両 window で renderer.js が独立に動き、両方の timer loop が
 *              rAF 回転して playSound が発火 → 2 重再生。v2.1.7 buffer の setTimeout(0)
 *              macrotask 遅延（50〜200ms）でズレが顕在化。
 *
 * 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）。
 * v2.1.7 hall atomic update 機構（dual-sync buffer）と完全両立。
 *
 * 実行: node tests/v220-prestart-audio-hall-guard.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const AUDIO_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');
const STYLE_CSS= fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const DUAL_SYNC= fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
const MAIN_JS  = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// 関数本体（balanced brace）抽出ヘルパ
function extractFnBody(source, signatureRe) {
  const m = source.match(signatureRe);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(open + 1, i); }
  }
  return null;
}

// ============================================================
// T1 (Fix 1): renderer.js handleAudioOnTick 冒頭に hall ガード
// ============================================================
test('T1 (Fix 1): handleAudioOnTick 冒頭に window.appRole === "hall" の早期 return', () => {
  const body = extractFnBody(RENDERER, /function\s+handleAudioOnTick\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'handleAudioOnTick 関数本体が抽出できない');
  // 冒頭（先頭 600 文字以内）に hall ガード
  const head = body.slice(0, 600);
  assert.match(head, /window\.appRole\s*===\s*['"]hall['"][\s\S]{0,30}return/,
    'handleAudioOnTick 冒頭に window.appRole === "hall" 早期 return ガードがない');
});

// ============================================================
// T2 (Fix 2): renderer.js handleAudioOnPreStartTick 冒頭に hall ガード
// ============================================================
test('T2 (Fix 2): handleAudioOnPreStartTick 冒頭に window.appRole === "hall" の早期 return', () => {
  const body = extractFnBody(RENDERER, /function\s+handleAudioOnPreStartTick\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'handleAudioOnPreStartTick 関数本体が抽出できない');
  const head = body.slice(0, 600);
  assert.match(head, /window\.appRole\s*===\s*['"]hall['"][\s\S]{0,30}return/,
    'handleAudioOnPreStartTick 冒頭に window.appRole === "hall" 早期 return ガードがない');
});

// ============================================================
// T3 (Fix 3): audio.js playSound 冒頭に hall ガード（多層防御）
// ============================================================
test('T3 (Fix 3): audio.js playSound 冒頭に window.appRole === "hall" の早期 return', () => {
  const body = extractFnBody(AUDIO_JS, /export\s+function\s+playSound\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'playSound 関数本体が抽出できない');
  const head = body.slice(0, 600);
  assert.match(head, /window\.appRole\s*===\s*['"]hall['"][\s\S]{0,30}return/,
    'playSound 冒頭に window.appRole === "hall" 早期 return ガードがない');
  // playSoundForce には**追加されていない**こと（試聴用、operator のみ呼出経路）
  const forceBody = extractFnBody(AUDIO_JS, /export\s+function\s+playSoundForce\s*\([^)]*\)\s*\{/);
  assert.ok(forceBody, 'playSoundForce 関数本体が抽出できない');
  assert.doesNotMatch(forceBody, /window\.appRole\s*===\s*['"]hall['"]/,
    'playSoundForce に hall ガードが追加されている（試聴用は対象外、追加禁止）');
});

// ============================================================
// T4 (Fix 4): style.css の :root[data-slideshow="active"] .clock が
//             opacity: 0 + pointer-events: none を持つ
// ============================================================
test('T4 (Fix 4): :root[data-slideshow="active"] .clock が opacity: 0 + pointer-events: none', () => {
  // セレクタが他とまとめられている可能性があるので、.clock 単独ルール or 含むルールを探す
  // .clock セレクタを持つ active 系ルールを検索
  const re = /:root\[data-slideshow="active"\]\s*\.clock\s*\{([^}]+)\}/;
  const m = STYLE_CSS.match(re);
  assert.ok(m, ':root[data-slideshow="active"] .clock のスタンドアロンルールが見つからない');
  const props = m[1];
  assert.match(props, /opacity\s*:\s*0/, '.clock ルールに opacity: 0 がない');
  assert.match(props, /pointer-events\s*:\s*none/, '.clock ルールに pointer-events: none がない');
});

// ============================================================
// T5 (Fix 4 regression): :root[data-slideshow="active"] .clock が
//                        display: none を**持たない**こと
// ============================================================
test('T5 (Fix 4 regression): .clock 単独ルールに display: none が含まれない', () => {
  // .clock 単独ルール（T4 で確認したもの）
  const re = /:root\[data-slideshow="active"\]\s*\.clock\s*\{([^}]+)\}/;
  const m = STYLE_CSS.match(re);
  assert.ok(m, '.clock 単独ルールが見つからない（T4 と同じ）');
  assert.doesNotMatch(m[1], /display\s*:\s*none/,
    '.clock ルールに display: none が残っている（regression、バグ A 再発リスク）');

  // 同時に、.bottom-bar / .marquee / .event-header の display: none ルールは維持されていることを確認
  const otherRule = STYLE_CSS.match(/:root\[data-slideshow="active"\]\s*\.bottom-bar[\s\S]*?\}/);
  assert.ok(otherRule, '.bottom-bar 系の active ルールが見つからない');
  assert.match(otherRule[0], /display\s*:\s*none/,
    '.bottom-bar / .marquee / .event-header の display: none が消えている（過剰修正）');
});

// ============================================================
// T6: 致命バグ保護 5 件すべて維持
// ============================================================
test('T6: 致命バグ保護 5 件すべて維持', () => {
  // C.2.7-A: resetBlindProgressOnly が renderer.js に存在
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'C.2.7-A: resetBlindProgressOnly が renderer.js から消えている');
  // C.2.7-D: tournaments:setDisplaySettings の timerState destructure 除外
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/,
    'C.2.7-D: tournaments:setDisplaySettings ハンドラが消えている');
  // C.1-A2: ensureEditorEditableState が renderer.js に存在
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'C.1-A2: ensureEditorEditableState が renderer.js から消えている');
  // C.1.7: AudioContext suspend resume 経路が audio.js _play に存在
  assert.match(AUDIO_JS, /audioContext\.state\s*===\s*['"]suspended['"]/,
    'C.1.7: AudioContext suspend 検出が audio.js から消えている');
  // C.1.8: tournaments:setRuntime IPC が main.js に存在
  assert.match(MAIN_JS, /tournaments:setRuntime/,
    'C.1.8: tournaments:setRuntime IPC が main.js から消えている');
});

// ============================================================
// T7: v2.1.7 hall atomic update 機構（dual-sync buffer）が無変更で残る
// ============================================================
test('T7: v2.1.7 dual-sync buffer 機構が touch されていない', () => {
  // 主要シンボルが残っていること
  assert.match(DUAL_SYNC, /const\s+DIFF_BUFFER_MAX\s*=\s*100/,
    'DIFF_BUFFER_MAX = 100 が dual-sync.js から消えている');
  assert.match(DUAL_SYNC, /function\s+_bufferDiff\s*\(/,
    '_bufferDiff 関数が dual-sync.js から消えている');
  assert.match(DUAL_SYNC, /function\s+_flushDiffBuffer\s*\(/,
    '_flushDiffBuffer 関数が dual-sync.js から消えている');
  assert.match(DUAL_SYNC, /dual\.subscribeStateSync\s*\(\s*\(diff\)\s*=>\s*_bufferDiff\(diff\)\s*\)/,
    'subscribeStateSync が _bufferDiff 経由でなくなっている');
  // beforeunload cleanup
  // v2.1.9 で setTimeout → requestAnimationFrame 切替に伴い clearTimeout → cancelAnimationFrame に変更
  // 当 T7 は「機構が触られていない」確認なので、cleanup 経路の存在保証として cancelAnimationFrame で追従
  assert.match(DUAL_SYNC, /window\.addEventListener\(\s*['"]beforeunload['"][\s\S]*?cancelAnimationFrame\s*\(\s*_flushTimer\s*\)/,
    'beforeunload cleanup が dual-sync.js から消えている（v2.1.9 で cancelAnimationFrame に切替済）');
});

// ============================================================
// T8: package.json version 2.1.12 + scripts.test に v220 登録
// ============================================================
test('T8: package.json version は 2.1.12 + scripts.test に v220 登録', () => {
  assert.equal(PKG.version, '2.1.17-rc1',
    `package.json version が ${PKG.version}（期待 2.1.17-rc1）`);
  assert.match(PKG.scripts.test, /v220-prestart-audio-hall-guard\.test\.js/,
    'scripts.test に v220-prestart-audio-hall-guard.test.js が登録されていない');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
