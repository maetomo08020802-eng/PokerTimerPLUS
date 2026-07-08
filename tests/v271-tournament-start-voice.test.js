/**
 * v2.6.4 回帰テスト — tournament-start-voice（トーナメント開始ボイス選択・アプリ全体共通）
 *
 *   仕様: 音タブで開始ボイス（なし + 女性1-4 + 男性1-4 の 9 状態）を選択。グローバル store キー
 *         `startVoice` に永続化。トーナメント開始（即時開始 / PRE_START 0着地 両方）で選択ボイスを
 *         1 回再生し、start.mp3 を置換（二重再生なし）。OFF は各経路で従来動作の厳密保存
 *         （PRE_START→start.mp3 / 即時→無音）。hall ガード + AudioContext resume は playSound 経由で継承。
 *
 *   検証観点:
 *     振る舞い（実ソース抽出 → new Function）:
 *       T1  playTournamentStartVoiceIfSelected: OFF → false・playSound 不呼出
 *       T2  〃: ボイス選択 → true・playSound('start-voice') 1 回
 *       T3  〃: 空文字 / undefined → false（防御）
 *     静的（audio.js）:
 *       T4  SOUND_FILES['start-voice'] が 8 ボイス→実ファイル名に一致
 *       T5  variantState['start-voice'] / enabledMap['start-voice'] 追加
 *       T6  applyAudioSettings の startVoice 分岐（'off' 以外かつ有効 key のみ variantState 更新）
 *     静的（main.js）:
 *       T7  default audio.startVoice='off' + VALID_START_VOICES 9 値
 *       T8  audio:set 正規化に startVoice enum + 二段フォールバック（current→'off'）
 *     静的（renderer.js 経路・置換/二重再生防止）:
 *       T9  onPreStartEnd が `if (!playTournamentStartVoiceIfSelected()) playSound('start')`（置換）
 *       T10 即時開始（timerStart 直後）に playTournamentStartVoiceIfSelected()（OFF 無音保存）
 *       T11 ボイス選択 change ハンドラ + 専用試聴ハンドラ（OFF は hint・無音）
 *     静的（index.html UI）:
 *       T12 js-audio-start-voice（off + 8 = 9 option）+ js-audio-start-voice-test ボタン
 *     致命バグ保護 5 件 cross-check（特に AudioContext resume _play 無改変）:
 *       T13
 *     version:
 *       T14 package.json.version 一致
 *
 *   実行: node tests/v271-tournament-start-voice.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT      = path.join(__dirname, '..');
const PKG       = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const AUDIO     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');
const MAIN_JS   = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const INDEX     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

function extractInnerBody(source, signatureRe) {
  const m = source.match(signatureRe);
  if (!m) return null;
  const openIdx = m.index + m[0].length - 1;
  let depth = 1, i = openIdx + 1;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(openIdx + 1, i - 1);
}

const VOICE_FILES = {
  'female-1': 'shuffle-up-and-deal-female-1.mp3',
  'female-2': 'shuffle-up-and-deal-female-2.mp3',
  'female-3': 'shuffle-up-and-deal-female-3.mp3',
  'female-4': 'shuffle-up-and-deal-female-4.mp3',
  'male-1':   'shuffle-up-and-deal-male-clear-1.mp3',
  'male-2':   'shuffle-up-and-deal-male-clear-2.mp3',
  'male-3':   'shuffle-up-and-deal-male-clear-3.mp3',
  'male-4':   'shuffle-up-and-deal-male-clear-4.mp3'
};

// ============================================================
// 振る舞い: playTournamentStartVoiceIfSelected（実ソース抽出 → new Function）
// ============================================================
function makeHelperRunner() {
  const body = extractInnerBody(RENDERER, /function\s+playTournamentStartVoiceIfSelected\s*\(\s*\)\s*\{/);
  assert.ok(body, 'playTournamentStartVoiceIfSelected 本体の抽出に失敗');
  const fn = new Function('audioState', 'playSound', body);
  return (startVoice) => {
    const calls = [];
    const ret = fn({ startVoice }, (id) => calls.push(id));
    return { ret, calls };
  };
}

test('T1: OFF → false・playSound 不呼出', () => {
  const run = makeHelperRunner();
  const { ret, calls } = run('off');
  assert.equal(ret, false, 'OFF で true を返した');
  assert.equal(calls.length, 0, 'OFF で playSound が呼ばれた（無音保存違反）');
});

test('T2: ボイス選択 → true・playSound("start-voice") を 1 回', () => {
  const run = makeHelperRunner();
  for (const v of ['female-1', 'male-4']) {
    const { ret, calls } = run(v);
    assert.equal(ret, true, `${v} で false を返した`);
    assert.deepEqual(calls, ['start-voice'], `${v} で playSound('start-voice') が 1 回呼ばれていない`);
  }
});

test('T3: 空文字 / undefined → false（防御）', () => {
  const run = makeHelperRunner();
  assert.equal(run('').ret, false, '空文字で true');
  assert.equal(run(undefined).ret, false, 'undefined で true');
  assert.equal(run('').calls.length, 0, '空文字で playSound 呼出');
});

// ============================================================
// 静的: audio.js
// ============================================================
test('T4: SOUND_FILES["start-voice"] が 8 ボイス→実ファイル名に一致', () => {
  const dict = extractInnerBody(AUDIO, /'start-voice'\s*:\s*\{/);
  assert.ok(dict, "SOUND_FILES['start-voice'] dict が見つからない");
  for (const [id, file] of Object.entries(VOICE_FILES)) {
    const re = new RegExp(`'${id}'\\s*:\\s*'\\.\\./audio/${file.replace(/[-.]/g, '\\$&')}'`);
    assert.match(dict, re, `start-voice['${id}'] が ../audio/${file} にマップされていない`);
    // 実ファイルの存在も確認
    assert.ok(fs.existsSync(path.join(ROOT, 'src', 'audio', file)), `実ファイル ${file} が存在しない`);
  }
});

test('T5: variantState["start-voice"] / enabledMap["start-voice"] が追加されている', () => {
  assert.match(AUDIO, /variantState\s*=\s*\{[\s\S]*?'start-voice'\s*:\s*'female-1'[\s\S]*?\}/,
    "variantState に 'start-voice': 'female-1' が無い（getSoundPath が有効 key を引けない恐れ）");
  assert.match(AUDIO, /enabledMap\s*=\s*\{[\s\S]*?'start-voice'\s*:\s*true[\s\S]*?\}/,
    "enabledMap に 'start-voice': true が無い");
});

test('T6: applyAudioSettings の startVoice 分岐（off 以外 + 有効 key のみ variantState 更新）', () => {
  const body = extractInnerBody(AUDIO, /export\s+function\s+applyAudioSettings\s*\(\s*settings\s*\)\s*\{/);
  assert.ok(body, 'applyAudioSettings 本体の抽出に失敗');
  assert.match(body, /settings\.startVoice\s*!==\s*'off'/, "startVoice の 'off' 除外ガードが無い");
  assert.match(body, /variantState\['start-voice'\]\s*=\s*settings\.startVoice/,
    'variantState["start-voice"] への代入が無い');
  assert.match(body, /hasOwnProperty\.call\(\s*voiceEntry\s*,\s*settings\.startVoice\s*\)|voiceEntry\s*\[\s*settings\.startVoice\s*\]/,
    '有効 voice key 検証が無い');
});

// ============================================================
// 静的: main.js
// ============================================================
test('T7: default audio.startVoice="off" + VALID_START_VOICES 9 値', () => {
  assert.match(MAIN_JS, /audio\s*:\s*\{[\s\S]*?startVoice\s*:\s*'off'[\s\S]*?\}/,
    "store default audio に startVoice: 'off' が無い");
  const m = MAIN_JS.match(/VALID_START_VOICES\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'VALID_START_VOICES 定義が無い');
  const vals = m[1].split(',').map(s => s.trim()).filter(Boolean);
  assert.equal(vals.length, 9, `VALID_START_VOICES が 9 値でない（${vals.length}）`);
  for (const need of ["'off'", "'female-1'", "'male-4'"]) {
    assert.ok(vals.includes(need), `VALID_START_VOICES に ${need} が無い`);
  }
});

test('T8: audio:set 正規化に startVoice enum + 二段フォールバック（current→off）', () => {
  // ハンドラ全体を含む十分な範囲を見る
  assert.match(MAIN_JS, /VALID_START_VOICES\.includes\(\s*merged\.startVoice\s*\)/,
    'audio:set に merged.startVoice の enum 検証が無い');
  assert.match(MAIN_JS, /merged\.startVoice\s*=\s*\([\s\S]*?current\.startVoice[\s\S]*?\)\s*\?\s*current\.startVoice\s*:\s*'off'/,
    '不正時に current.startVoice → なお不正なら off へ落とす二段フォールバックが無い');
});

// ============================================================
// 静的: renderer.js 経路（置換 / 二重再生防止 / OFF 無音保存）
// ============================================================
test('T9: onPreStartEnd が置換形 `if (!playTournamentStartVoiceIfSelected()) playSound("start")`', () => {
  const body = extractInnerBody(RENDERER, /onPreStartEnd\s*:\s*\(\s*\)\s*=>\s*\{/);
  assert.ok(body, 'onPreStartEnd ハンドラ本体の抽出に失敗');
  assert.match(body, /if\s*\(\s*!\s*playTournamentStartVoiceIfSelected\s*\(\s*\)\s*\)\s*playSound\s*\(\s*'start'\s*\)/,
    'onPreStartEnd が置換形になっていない（ボイス選択時に start.mp3 も鳴る二重再生の恐れ）');
});

test('T10: 即時開始（timerStart 直後）に playTournamentStartVoiceIfSelected()（OFF 無音保存）', () => {
  // prestartOk の minutes<=0 分岐: timerStart(); の直後に helper 呼出、start.mp3 は鳴らさない
  const region = RENDERER.slice(RENDERER.indexOf("timerStart();   // 「今すぐ開始」"));
  assert.ok(region, '即時開始（timerStart 今すぐ開始）箇所が見つからない');
  const head = region.slice(0, 400);
  assert.match(head, /timerStart\(\)\s*;[\s\S]*?playTournamentStartVoiceIfSelected\s*\(\s*\)/,
    '即時開始直後に playTournamentStartVoiceIfSelected() が無い（即時開始でボイスが鳴らない）');
  assert.doesNotMatch(head, /playSound\s*\(\s*'start'\s*\)/,
    '即時開始経路に playSound("start") が混入（OFF 無音保存の逸脱＝既存挙動変更）');
});

test('T11: ボイス選択 change ハンドラ + 専用試聴ハンドラ（OFF は hint・無音）', () => {
  assert.match(RENDERER, /el\.audioStartVoice\?\.addEventListener\('change'/,
    'audioStartVoice の change ハンドラが無い');
  assert.match(RENDERER, /persistAudioPartial\(\s*\{\s*startVoice:\s*value\s*\}\s*\)/,
    'startVoice の永続化（persistAudioPartial）が無い');
  const testBody = extractInnerBody(RENDERER, /el\.audioStartVoiceTest\?\.addEventListener\('click',\s*async\s*\(\s*\)\s*=>\s*\{/);
  assert.ok(testBody, '専用試聴ハンドラ（audioStartVoiceTest）が無い');
  assert.match(testBody, /===\s*'off'/, '試聴ハンドラに OFF ガードが無い');
  assert.match(testBody, /playSoundForce\s*\(\s*'start-voice'\s*\)/, '試聴で playSoundForce("start-voice") が無い');
  // OFF 時は playSoundForce より前に return（無音）
  const offIdx = testBody.indexOf("=== 'off'");
  const forceIdx = testBody.indexOf("playSoundForce");
  const returnAfterOff = testBody.indexOf('return', offIdx);
  assert.ok(offIdx >= 0 && returnAfterOff > offIdx && returnAfterOff < forceIdx,
    'OFF 時に playSoundForce 前で return していない（OFF 試聴で誤再生の恐れ）');
});

// ============================================================
// 静的: index.html UI
// ============================================================
test('T12: js-audio-start-voice（off + 8 = 9 option）+ js-audio-start-voice-test ボタン', () => {
  const selIdx = INDEX.indexOf('id="js-audio-start-voice"');
  assert.ok(selIdx >= 0, 'js-audio-start-voice select が無い');
  const selEnd = INDEX.indexOf('</select>', selIdx);
  const selBlock = INDEX.slice(selIdx, selEnd);
  const optCount = (selBlock.match(/<option\s/g) || []).length;
  assert.equal(optCount, 9, `開始ボイス select の option が 9 個でない（${optCount}）`);
  for (const v of ['off', 'female-1', 'female-4', 'male-1', 'male-4']) {
    assert.match(selBlock, new RegExp(`value="${v}"`), `option value="${v}" が無い`);
  }
  assert.match(INDEX, /id="js-audio-start-voice-test"/, 'js-audio-start-voice-test ボタンが無い');
  // 専用ハンドラと二重バインドしないため data-test-sound は付けない
  assert.doesNotMatch(selBlock, /data-test-sound/, 'start-voice select 周辺に data-test-sound が混入');
});

// ============================================================
// 致命バグ保護 5 件 cross-check（特に AudioContext resume _play 無改変）
// ============================================================
test('T13: 致命5件 cross-check — _play の resume 防御 / playSound hall ガード / 各保護が健在', () => {
  // AudioContext resume 防御（#4）: _play 内の suspended 検出 + resume が無改変で健在
  const playBody = extractInnerBody(AUDIO, /function\s+_play\s*\(\s*soundId\s*\)\s*\{/);
  assert.ok(playBody, '_play 本体の抽出に失敗');
  assert.match(playBody, /audioContext\.state\s*===\s*'suspended'/, '_play の suspended 検出が消えた（致命#4）');
  assert.match(playBody, /audioContext\.resume\s*\(/, '_play の audioContext.resume() が消えた（致命#4）');
  // playSound の hall ガード（二画面二重再生防止）健在
  const psBody = extractInnerBody(AUDIO, /export\s+function\s+playSound\s*\(\s*soundId\s*\)\s*\{/);
  assert.ok(psBody, 'playSound 本体の抽出に失敗');
  assert.match(psBody, /window\.appRole\s*===\s*'hall'/, 'playSound の hall ガードが消えた（二重再生防止）');
  // 残り 4 件のマーカー
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, '致命: resetBlindProgressOnly 消失');
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, '致命: ensureEditorEditableState 消失');
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, '致命: schedulePersistRuntime（runtime 永続化）消失');
  assert.match(MAIN_JS, /ipcMain\.handle\(\s*'tournaments:setRuntime'/, '致命: setRuntime IPC 消失');
});

// ============================================================
// version
// ============================================================
test('T14: package.json.version 一致', () => {
  assert.equal(PKG.version, '2.7.0', `package.json.version が ${PKG.version}（配信時 2.6.4 へ bump 予定）`);
  assert.match(PKG.scripts.test, /v271-tournament-start-voice\.test\.js/, 'scripts.test に v271 が未登録');
});

console.log(`\nv271 tournament-start-voice: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
