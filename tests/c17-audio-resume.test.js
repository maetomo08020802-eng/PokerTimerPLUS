/**
 * STEP 10 フェーズC.1.7 — PAUSED 復帰後の音欠落バグ修正の回帰防止テスト
 *
 * 真因: AudioContext が長時間 PAUSED / バックグラウンド遷移で suspended 状態に遷移し、
 *       resume せずに source.start() を呼んでも音が鳴らない。
 *
 * 修正: _play() 冒頭で audioContext.state === 'suspended' を検出 → resume() 呼出（fire-and-forget）。
 *       これで playSound の全発火パス（warning-1min / warning-10sec / countdown-tick /
 *       level-end / break-end / start）が suspend 状態でも音を鳴らす。
 *
 * 実行: node tests/c17-audio-resume.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT     = path.join(__dirname, '..');
const AUDIO    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

function extractFunctionBody(source, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = source.match(re);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(start + 1, i); }
  }
  return null;
}

// ============================================================
// T37: _play 関数で AudioContext suspend → resume 防御
// ============================================================
test('T37: _play 内で audioContext.state === \'suspended\' チェック + resume() 呼出', () => {
  assert.match(AUDIO, /function\s+_play\s*\(/, '_play 関数定義がない');
  const body = extractFunctionBody(AUDIO, '_play');
  assert.ok(body, '_play 関数本体抽出失敗');
  // suspend 検出
  assert.match(body, /audioContext\.state\s*===\s*['"]suspended['"]/,
    '_play 内で audioContext.state === "suspended" チェックがない（C.1.7 修正の核心）');
  // resume 呼出（fire-and-forget でも catch があるので resume は呼ばれているはず）
  assert.match(body, /audioContext\.resume\s*\(\s*\)/,
    '_play 内で audioContext.resume() 呼出がない');
});

// ============================================================
// T38: handleAudioOnTick の BREAK 経路で 0 秒 break-end 発火（回帰防止）
// ============================================================
test("T38: handleAudioOnTick の BREAK 経路で remainingSec === 0 → playSound('break-end')", () => {
  const body = extractFunctionBody(RENDERER, 'handleAudioOnTick');
  assert.ok(body, 'handleAudioOnTick 関数本体抽出失敗');
  // BREAK 中の status 分岐 + 0 秒で break-end
  assert.match(body, /States\.BREAK[\s\S]*?remainingSec\s*===\s*0[\s\S]*?break-end/,
    'BREAK 中で remainingSec === 0 → break-end 発火経路がない（音欠落の根本経路）');
});

// ============================================================
// T39: lastAudioTriggerSec のリセット箇所（onLevelChange + onPreStartEnd）が維持
// ============================================================
test('T39: lastAudioTriggerSec のリセット箇所が onLevelChange + onPreStartEnd で維持', () => {
  // onLevelChange handler に -1 リセット
  assert.match(RENDERER, /onLevelChange:\s*\([^)]*\)\s*=>\s*\{[\s\S]*?lastAudioTriggerSec\s*=\s*-1/,
    'onLevelChange で lastAudioTriggerSec = -1 リセットがない');
  // onPreStartEnd handler に -1 リセット
  assert.match(RENDERER, /onPreStartEnd:\s*\([^)]*\)\s*=>\s*\{[\s\S]*?lastAudioTriggerSec\s*=\s*-1/,
    'onPreStartEnd で lastAudioTriggerSec = -1 リセットがない');
});

// ============================================================
// T40: onLevelEnd で isBreak チェック後に level-end 発火（回帰防止）
// ============================================================
test("T40: onLevelEnd 内で !lv.isBreak かつ playSound('level-end') 発火", () => {
  // setHandlers の onLevelEnd handler に isBreak ガード + level-end
  assert.match(RENDERER, /onLevelEnd:\s*\([^)]*\)\s*=>\s*\{[\s\S]*?!lv\.isBreak[\s\S]*?level-end/,
    'onLevelEnd で !lv.isBreak ガード + level-end 発火経路がない');
});

// ============================================================
// T41: handleAudioOnTick / handleAudioOnPreStartTick の audioSuppressOnce 早期 return が維持
// ============================================================
test('T41: handleAudioOnTick + handleAudioOnPreStartTick で audioSuppressOnce 1回限り消費', () => {
  // onTick 側
  const tickBody = extractFunctionBody(RENDERER, 'handleAudioOnTick');
  assert.ok(tickBody, 'handleAudioOnTick 関数本体抽出失敗');
  assert.match(tickBody, /audioSuppressOnce[\s\S]*?audioSuppressOnce\s*=\s*false[\s\S]*?return/,
    'handleAudioOnTick で audioSuppressOnce の 1回限り消費経路がない');
  // PreStartTick 側
  const preBody = extractFunctionBody(RENDERER, 'handleAudioOnPreStartTick');
  assert.ok(preBody, 'handleAudioOnPreStartTick 関数本体抽出失敗');
  assert.match(preBody, /audioSuppressOnce[\s\S]*?audioSuppressOnce\s*=\s*false[\s\S]*?return/,
    'handleAudioOnPreStartTick で audioSuppressOnce 消費経路がない');
});

// ============================================================
// 不変条件: 致命バグ修正の保護（C.2.7-A）
// ============================================================
test('T42: handlePresetApply の reset 分岐は引き続き resetBlindProgressOnly（致命バグ保護）', () => {
  const body = extractFunctionBody(RENDERER, 'handlePresetApply');
  assert.ok(body, 'handlePresetApply 関数本体抽出失敗');
  assert.match(body, /resetBlindProgressOnly\s*\(\s*\)/,
    'handlePresetApply 内で resetBlindProgressOnly が呼ばれていない（致命バグリグレッション）');
});

console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
