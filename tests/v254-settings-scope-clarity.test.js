/**
 * settings-scope-clarity STEP1 — 設定タブのスコープ可視化 + 現在トーナメント名の常時表示
 *
 * 検証対象（UI/CSS/ラベル/現在名表示のみ。データ構造・保存ロジックは無変更）:
 *   - タブ nav を「このトーナメント専用 / アプリ全体で共通」の2グループに視覚分割
 *   - data-tab 識別子は全7タブで不変（並び替え・グループ化しても値を変えない）
 *   - グループ振り分け: 専用[tournament/blinds/display/marquee] / 共通[logo/audio/about]
 *   - ダイアログ上部に現在トーナメント名ヘッダ（js-settings-current-tournament-name）
 *   - renderer.js に updateSettingsCurrentTournamentLabel + applyTournament/openSettingsDialog からの呼出
 *   - ブラインド構造タブに「共有テンプレート」軽い1行注記
 *   - v2.0.0 不変条件: <dialog> に flex 追加なし（再発防止の安全網）
 *
 * 実行: node tests/v254-settings-scope-clarity.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT     = path.join(__dirname, '..');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');

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

// settings-tab-nav の中身を抽出
function navBlock() {
  const m = HTML.match(/<nav class="settings-tab-nav"[\s\S]*?<\/nav>/);
  assert.ok(m, 'settings-tab-nav が見つからない');
  return m[0];
}

const ALL_TABS = ['tournament', 'blinds', 'display', 'marquee', 'logo', 'audio', 'about'];
const GROUP_TOURNAMENT = ['tournament', 'blinds', 'display', 'marquee'];
const GROUP_APP = ['logo', 'audio', 'about'];

// ============================================================
// T1: data-tab 識別子は全7タブで不変（並び替え・グループ化しても値を変えない）
// ============================================================
test('T1: nav に全7タブの data-tab 値が存在（識別子不変の回帰防止）', () => {
  const nav = navBlock();
  for (const tab of ALL_TABS) {
    assert.match(nav, new RegExp(`data-tab="${tab}"`),
      `data-tab="${tab}" が nav に存在しない（識別子が変わった可能性）`);
  }
  // 7個ちょうど（余計な data-tab 追加・欠落なし）
  const count = (nav.match(/data-tab="/g) || []).length;
  assert.equal(count, 7, `nav の data-tab 数が ${count}（期待 7）`);
});

// ============================================================
// T2: タブが2グループに視覚分割（data-scope の2グループ + 区切り）
// ============================================================
test('T2: nav に2グループ（data-scope=tournament / app）+ 区切りが存在', () => {
  const nav = navBlock();
  assert.match(nav, /class="settings-tab-group"\s+data-scope="tournament"/,
    'グループ「このトーナメント専用」(data-scope=tournament) がない');
  assert.match(nav, /class="settings-tab-group"\s+data-scope="app"/,
    'グループ「アプリ全体で共通」(data-scope=app) がない');
  assert.match(nav, /settings-tab-group__sep/, 'グループ区切り(settings-tab-group__sep) がない');
});

// ============================================================
// T3: グループ見出し文言が存在
// ============================================================
test('T3: グループ見出し2種の文言が存在', () => {
  assert.match(HTML, /このトーナメント専用/, '見出し「このトーナメント専用」がない');
  assert.match(HTML, /アプリ全体で共通/, '見出し「アプリ全体で共通」がない');
});

// ============================================================
// T4: グループ振り分けが正しい（区切りで2分割して包含チェック）
// ============================================================
test('T4: 専用グループ=tournament/blinds/display/marquee、共通グループ=logo/audio/about', () => {
  const nav = navBlock();
  const parts = nav.split('settings-tab-group__sep');
  assert.equal(parts.length, 2, '区切りで2分割できない（settings-tab-group__sep が1つでない）');
  const [groupA, groupB] = parts; // A=専用（区切り前）, B=共通（区切り後）

  for (const tab of GROUP_TOURNAMENT) {
    assert.match(groupA, new RegExp(`data-tab="${tab}"`),
      `専用グループに data-tab="${tab}" がない`);
    assert.doesNotMatch(groupB, new RegExp(`data-tab="${tab}"`),
      `data-tab="${tab}" が共通グループ側にも存在（振り分け誤り）`);
  }
  for (const tab of GROUP_APP) {
    assert.match(groupB, new RegExp(`data-tab="${tab}"`),
      `共通グループに data-tab="${tab}" がない`);
    assert.doesNotMatch(groupA, new RegExp(`data-tab="${tab}"`),
      `data-tab="${tab}" が専用グループ側にも存在（振り分け誤り）`);
  }
});

// ============================================================
// T5: 現在トーナメント名ヘッダ要素が存在
// ============================================================
test('T5: ダイアログ上部に現在トーナメント名表示要素（js-settings-current-tournament-name）', () => {
  assert.match(HTML, /id="js-settings-current-tournament-name"/,
    '現在トーナメント名表示先 id が index.html にない');
  // ヘッダ内（form-dialog__header）に置かれていること
  assert.match(HTML, /form-dialog__header[\s\S]*?js-settings-current-tournament-name[\s\S]*?<\/header>/,
    '現在名表示要素が form-dialog__header 内にない');
});

// ============================================================
// T6: renderer.js に同期ヘルパ + 呼出（切替即更新を担保）
// ============================================================
test('T6: updateSettingsCurrentTournamentLabel 定義 + applyTournament/openSettingsDialog から呼出', () => {
  assert.match(RENDERER, /function\s+updateSettingsCurrentTournamentLabel\s*\(/,
    'updateSettingsCurrentTournamentLabel 定義がない');
  assert.match(RENDERER, /settingsCurrentTournamentName:\s*document\.getElementById\('js-settings-current-tournament-name'\)/,
    'el.settingsCurrentTournamentName 参照がない');

  const applyBody = extractFunctionBody(RENDERER, 'applyTournament');
  assert.ok(applyBody, 'applyTournament が見つからない');
  assert.match(applyBody, /updateSettingsCurrentTournamentLabel\(\)/,
    'applyTournament から updateSettingsCurrentTournamentLabel 呼出がない（切替で更新されない）');

  const openBody = extractFunctionBody(RENDERER, 'openSettingsDialog');
  assert.ok(openBody, 'openSettingsDialog が見つからない');
  assert.match(openBody, /updateSettingsCurrentTournamentLabel\(\)/,
    'openSettingsDialog から updateSettingsCurrentTournamentLabel 呼出がない（開いた瞬間に反映されない）');
});

// ============================================================
// T7: 無名フォールバック表示がある
// ============================================================
test('T7: 現在名ヘルパに無名フォールバックがある', () => {
  const body = extractFunctionBody(RENDERER, 'updateSettingsCurrentTournamentLabel');
  assert.ok(body, 'updateSettingsCurrentTournamentLabel body 抽出失敗');
  assert.match(body, /（無名のトーナメント）/, '無名フォールバック文言がない');
});

// ============================================================
// T8: ブラインド構造タブに「共有テンプレート」軽い1行注記
// ============================================================
test('T8: ブラインド構造タブに共有テンプレートの軽い注記', () => {
  assert.match(HTML, /settings-scope-note/, 'settings-scope-note クラスがない');
  assert.match(HTML, /ブラインド構造は全トーナメントで共有のテンプレート/,
    '共有テンプレート注記の文言がない');
});

// ============================================================
// T9: グループ見出し / 区切りの CSS が存在
// ============================================================
test('T9: style.css にグループ見出し・区切り・現在名ヘッダのスタイル', () => {
  assert.match(STYLE, /\.settings-tab-group\s*\{/, '.settings-tab-group ブロックがない');
  assert.match(STYLE, /\.settings-tab-group__heading\s*\{/, '.settings-tab-group__heading ブロックがない');
  assert.match(STYLE, /\.settings-tab-group__sep\s*\{/, '.settings-tab-group__sep ブロックがない');
  assert.match(STYLE, /\.settings-current-tournament__name\s*\{/, '.settings-current-tournament__name ブロックがない');
});

// ============================================================
// T10: <dialog> に flex 追加なし（v2.0.0 不変条件・再発防止の安全網）
// ============================================================
test('T10: .form-dialog.form-dialog--tabs に display: flex が無い（feedback_dialog_no_flex 厳守）', () => {
  const block = STYLE.match(/\.form-dialog\.form-dialog--tabs\s*\{[\s\S]*?\}/);
  assert.ok(block, '.form-dialog.form-dialog--tabs ブロックがない');
  assert.doesNotMatch(block[0], /display:\s*flex/,
    '.form-dialog.form-dialog--tabs に display: flex が再発（dialog 自体は flex 化禁止）');
});

// ============================================================
// T11: CSS に transform: scale / position: fixed を本案件で持ち込んでいない（追加分の安全網）
//      ※ 既存 CSS 全体ではなく、本案件追加クラスのブロックに含まれないことを確認
// ============================================================
test('T11: 本案件追加クラスに transform: scale / position: fixed がない', () => {
  const targets = ['settings-tab-group', 'settings-tab-group__heading', 'settings-tab-group__sep',
                   'settings-current-tournament', 'settings-current-tournament__name',
                   'form-dialog__title-wrap', 'settings-scope-note'];
  for (const cls of targets) {
    const re = new RegExp(`\\.${cls.replace(/[-_]/g, '[-_]')}[^{]*\\{[\\s\\S]*?\\}`, 'g');
    let m;
    while ((m = re.exec(STYLE)) !== null) {
      assert.doesNotMatch(m[0], /transform:\s*scale/, `.${cls} に transform: scale が混入`);
      assert.doesNotMatch(m[0], /position:\s*fixed/, `.${cls} に position: fixed が混入`);
    }
  }
});

// ============================================================
// version assertion（version-pin、bump 追従の二重化）
// ============================================================
test('version: package.json は 2.5.1', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.5.1', `package.json version が ${pkg.version}（期待 2.5.1）`);
});

test('version: scripts.test に v254-settings-scope-clarity.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v254-settings-scope-clarity\.test\.js/,
    'package.json scripts.test に v254-settings-scope-clarity.test.js が含まれていない');
});

// ============================================================
console.log('');
console.log(`v254-settings-scope-clarity.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
