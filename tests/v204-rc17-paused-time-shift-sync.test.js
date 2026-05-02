/**
 * v2.0.4-rc17 — PAUSED 中の time-shift 同期トリガ追加 + 常時 3 ラベル rolling ログの静的解析テスト
 *
 * 対象修正:
 *   タスク 1: renderer.js の subscribe ガード条件に
 *             `state.status === States.PAUSED && state.remainingMs !== prev.remainingMs` 条件を追加。
 *             PAUSED 中の advance30Seconds / rewind30Seconds が schedulePersistTimerState を
 *             トリガできるようにする（修正案 ②-1）。
 *   タスク 2: 常時 3 ラベル rolling ログ追加。
 *             #1 timer:state:send       — main.js の _publishDualState で kind==='timerState' のみ
 *             #2 timer:state:recv:hall  — dual-sync.js の _applyDiffToState で kind==='timerState' のみ
 *             #3 render:tick:hall       — renderer.js の subscribe コールバックで hall ロール時のみ
 *
 * 既存 rc15 rolling ログ機構（window.api.log.write / main 側 rollingLog）を流用、新規 IPC 追加なし。
 * すべて try { ... } catch (_) {} で wrap、never throw from logging。
 *
 * 致命バグ保護 5 件（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）への影響なしも cross-check。
 *
 * 実行: node tests/v204-rc17-paused-time-shift-sync.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT      = path.join(__dirname, '..');
const MAIN      = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const DUAL_SYNC = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
const AUDIO     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// タスク 1: PAUSED 中の time-shift 同期トリガ
// ============================================================

test('T1: subscribe ガード条件に PAUSED 中の remainingMs 単独変化トリガが追加されている (advance30Seconds 経路)', () => {
  // ガード条件式の AND 部分を正規表現で検証
  //   state.status === States.PAUSED && state.remainingMs !== prev.remainingMs
  const re = /state\.status\s*===\s*States\.PAUSED\s*&&\s*state\.remainingMs\s*!==\s*prev\.remainingMs/;
  assert.match(RENDERER, re,
    'renderer.js の subscribe ガード条件に PAUSED 限定の remainingMs 変化トリガ条件式が含まれていない（タスク 1 不在）');
});

test('T2: rewind30Seconds 経路でも同じ条件式で同期される（remainingMs の前方/後方変化を区別しない）', () => {
  // T1 と同じ条件式が PAUSED 状態で remainingMs 変化を検出するため、
  //   advance / rewind の方向によらず同期される。!== 演算子使用で双方向対応を assert。
  const re = /state\.status\s*===\s*States\.PAUSED\s*&&\s*state\.remainingMs\s*!==\s*prev\.remainingMs/;
  const match = RENDERER.match(re);
  assert.ok(match, 'PAUSED 中の remainingMs 変化条件式が見つからない');
  // === ではなく !== である（advance / rewind の双方向に発火する）
  assert.match(match[0], /!==/, '!== 比較が使われていない（advance / rewind 双方向トリガが破壊）');
});

test('T3: ガード条件式は status === PAUSED 限定（RUNNING 中の onTick 由来 remainingMs 変化はトリガしない）', () => {
  // ガード条件全体を抽出（schedulePersistTimerState 呼出直前の if (...) 部分）
  const guardRe = /if\s*\(\s*state\.status\s*!==\s*prev\.status[\s\S]*?schedulePersistTimerState\s*\(\s*\)\s*;/;
  const m = RENDERER.match(guardRe);
  assert.ok(m, 'subscribe ガード if (...) { schedulePersistTimerState() } ブロックが見つからない');
  // PAUSED 条件は && で AND 接続、|| で OR される（status === PAUSED && remainingMs !== prev.remainingMs）
  assert.match(m[0], /state\.status\s*===\s*States\.PAUSED\s*&&\s*state\.remainingMs\s*!==\s*prev\.remainingMs/,
    'ガード条件の PAUSED 限定 AND 部分が見つからない（RUNNING 中も発火する設計に退化？）');
});

test('T4: 既存の status / level 変化トリガは維持（rc15 までの動作と後方互換）', () => {
  // 既存ガード条件 state.status !== prev.status と state.currentLevelIndex !== prev.currentLevelIndex は維持
  assert.match(RENDERER, /state\.status\s*!==\s*prev\.status/,
    '既存の status 変化トリガが消失（BREAK time-shift 等の既存経路が破壊）');
  assert.match(RENDERER, /state\.currentLevelIndex\s*!==\s*prev\.currentLevelIndex/,
    '既存の level 変化トリガが消失（rc15 までの level 進行同期が破壊）');
});

// ============================================================
// タスク 2: 常時 3 ラベル rolling ログ
// ============================================================

test('T5: main.js _publishDualState 内に timer:state:send ラベルの rollingLog 呼出が存在', () => {
  assert.match(MAIN, /'timer:state:send'/,
    'main.js に timer:state:send ラベル文字列が見つからない（タスク 2 #1 不在）');
  // _publishDualState 関数内の kind==='timerState' 限定で呼ばれること
  const re = /function\s+_publishDualState\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(\s*kind\s*===\s*['"]timerState['"]\s*\)\s*\{[\s\S]*?rollingLog\(\s*['"]timer:state:send['"]/;
  assert.match(MAIN, re,
    '_publishDualState 内の kind==="timerState" ガード経路で rollingLog("timer:state:send", ...) が呼ばれていない');
});

test('T6: dual-sync.js _applyDiffToState 入口に timer:state:recv:hall ラベルが存在', () => {
  assert.match(DUAL_SYNC, /'timer:state:recv:hall'/,
    'dual-sync.js に timer:state:recv:hall ラベル文字列が見つからない（タスク 2 #2 不在）');
  // _applyDiffToState 関数内の kind==='timerState' 限定で window.api.log.write 経由
  const re = /function\s+_applyDiffToState\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(\s*kind\s*===\s*['"]timerState['"]\s*\)\s*\{[\s\S]*?window\.api\?\.log\?\.write\?\.\(\s*['"]timer:state:recv:hall['"]/;
  assert.match(DUAL_SYNC, re,
    '_applyDiffToState 内の kind==="timerState" ガード経路で window.api.log.write("timer:state:recv:hall", ...) が呼ばれていない');
});

test('T7: renderer.js subscribe コールバック内に render:tick:hall ラベルが存在（hall ロール限定）', () => {
  assert.match(RENDERER, /'render:tick:hall'/,
    'renderer.js に render:tick:hall ラベル文字列が見つからない（タスク 2 #3 不在）');
  // window.appRole === 'hall' 限定で window.api.log.write 経由
  const re = /window\.appRole\s*===\s*['"]hall['"][\s\S]{0,200}?window\.api\?\.log\?\.write\?\.\(\s*['"]render:tick:hall['"]/;
  assert.match(RENDERER, re,
    'render:tick:hall は window.appRole === "hall" ガード経路で呼ばれていない（operator 側にも記録されるリスク）');
});

test('T8: 3 ラベルすべて try { ... } catch (_) で wrap されている（never throw from logging）', () => {
  // 各ラベル文字列の周辺（前 200 字以内）に try { が存在し、後 200 字以内に catch ( が存在する
  const labels = [
    { label: "'timer:state:send'", source: MAIN, name: 'main.js' },
    { label: "'timer:state:recv:hall'", source: DUAL_SYNC, name: 'dual-sync.js' },
    { label: "'render:tick:hall'", source: RENDERER, name: 'renderer.js' },
  ];
  for (const { label, source, name } of labels) {
    const idx = source.indexOf(label);
    assert.ok(idx >= 0, `${name} に ${label} が見つからない`);
    // ラベル前 200 字以内に try { が存在
    const before = source.slice(Math.max(0, idx - 200), idx);
    assert.match(before, /try\s*\{/, `${name} の ${label} 直前に try { が見つからない（never throw 違反）`);
    // ラベル後 300 字以内に catch ( が存在
    const after = source.slice(idx, Math.min(source.length, idx + 300));
    assert.match(after, /catch\s*\(/, `${name} の ${label} 直後に catch ( が見つからない（never throw 違反）`);
  }
});

// ============================================================
// 致命バグ保護 5 件 cross-check（rc17 で影響なしを担保）
// ============================================================

test('致命バグ保護 C.2.7-A: resetBlindProgressOnly が renderer.js に存在', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'resetBlindProgressOnly が消失（C.2.7-A 破壊）');
});

test('致命バグ保護 C.2.7-D: setDisplaySettings の timerState destructure 除外維持', () => {
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]tournaments:setDisplaySettings['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m);
  assert.doesNotMatch(m[0], /const\s*\{[^}]*\btimerState\b[^}]*\}\s*=/,
    'setDisplaySettings で timerState destructure が混入（C.2.7-D 致命バグ再発）');
});

test('致命バグ保護 C.1-A2: ensureEditorEditableState 関数定義が維持', () => {
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'ensureEditorEditableState が消失（C.1-A2 破壊）');
});

test('致命バグ保護 C.1.7: AudioContext suspend resume 経路が維持', () => {
  assert.match(AUDIO, /audioContext\.state\s*===?\s*['"]suspended['"]/,
    'audio.js から audioContext.state suspended 検出が消失（C.1.7 破壊）');
  assert.match(AUDIO, /audioContext\.resume\(\)/,
    'audio.js から audioContext.resume() 呼出が消失（C.1.7 破壊）');
});

test('致命バグ保護 C.1.8: tournaments:setRuntime IPC が維持', () => {
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]tournaments:setRuntime['"]/,
    'tournaments:setRuntime ハンドラが消失（C.1.8 破壊）');
});

// ============================================================
// rc15 rolling ログ機構 cross-check（rc17 で破壊しない）
// ============================================================

test('rc15 維持: main.js に rollingLog 関数定義が存在', () => {
  assert.match(MAIN, /function\s+rollingLog\s*\(\s*label\s*,\s*data\s*\)/,
    'main.js に rollingLog(label, data) 関数定義が消失（rc15 機構破壊）');
});

test('rc15 維持: preload.js に window.api.log.write が公開', () => {
  const PRELOAD = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
  assert.match(PRELOAD, /log\s*:\s*\{[\s\S]*?write\s*:[\s\S]*?\}/,
    'preload.js から window.api.log.write が消失（rc15 機構破壊）');
});

test('rc15 維持: handleAudioOnTick 内に window.api.log.write 呼出が混入していない（負荷主因回避）', () => {
  // タスク 2 #3 (render:tick:hall) は subscribe コールバック内であり handleAudioOnTick とは別
  const fnBody = (() => {
    const m = RENDERER.match(/function\s+handleAudioOnTick\s*\([^)]*\)\s*\{/);
    if (!m) return null;
    let depth = 1, i = m.index + m[0].length;
    while (i < RENDERER.length && depth > 0) {
      if (RENDERER[i] === '{') depth++;
      else if (RENDERER[i] === '}') depth--;
      i++;
    }
    return RENDERER.slice(m.index, i);
  })();
  assert.ok(fnBody, 'handleAudioOnTick 本体が見つからない');
  assert.doesNotMatch(fnBody, /window\.api\?\.log\?\.write/,
    'handleAudioOnTick 内に rolling ログ呼出が混入（タイマー 1 秒 tick の負荷主因が再発）');
});

// ============================================================
console.log('');
console.log(`Summary: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
