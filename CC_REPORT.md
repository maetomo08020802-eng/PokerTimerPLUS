# CC_REPORT — 2026-05-01 v2.0.4-rc5 試験版ビルド（M/H/F2/F12整理 + テロップ + 操作一覧再構成 + ミュート視覚 全 role 適用）

## 1. サマリー

rc4 試験フィードバックに基づく整理リリース:

- **キーフォワード**: KeyM / KeyH を `FORWARD_KEYS_FROM_HALL` に追加（rc4 の「H は PC 側のみ」判断撤回、便利機能の対称性）
- **F2 削除**: 操作一覧 + docs/specs.md §7（実装無し、rc4 F1 削除と同要領）
- **F12 削除**: 操作一覧のみ（既存コード + specs §7 表記は維持）
- **テロップ表記統一**: UI に出る「マーキー」を「テロップ」に置換（コード内部 `marquee*` 変数名は維持）
- **操作一覧 5 カテゴリ再構成**: タイマー操作 / プレイヤー操作 / エントリー操作 / ダイアログ表示 / アプリ
- **ミュート視覚フィードバック（全 role 適用）**: hall / operator-solo 右下に「🔇 ミュート中」、operator は運用情報「音」項目で代替（v1.3.0 互換例外、配布前提の便利機能拡張）

新規テスト 18 件追加 + 既存テスト 4 件更新で **282 → 302 全 PASS**、`.exe` 再ビルド成功。

## 2. ビルド成果物

| 項目 | 値 |
|---|---|
| **絶対パス** | `C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock\dist\PokerTimerPLUS+ (Test) Setup 2.0.4-rc5.exe` |
| **ファイルサイズ** | 82,969,556 bytes（約 80 MB）|
| **version** | `2.0.4-rc5`（latest.yml で確認済）|
| **productName** | `PokerTimerPLUS+ (Test)`（rc1〜rc4 と同じ）|
| **appId** | `com.shitamachi.pokertimerplus.test`（rc1〜rc4 と同じ）|
| **生成日時** | 2026-05-01T08:26:46.586Z |

## 3. 修正対象ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `src/main.js` | `FORWARD_KEYS_FROM_HALL` に `'KeyM'`, `'KeyH'` 追加 + コメント更新 |
| `src/renderer/index.html` | operator-pane の操作一覧を 5 カテゴリ `<div class="shortcut-section">` に再構成 / F2 / F12 を操作一覧から削除 / Ctrl+T を「テロップ編集」表記 / 運用情報に `<dt>音</dt><dd id="op-pane-mute-status">通常</dd>` 追加（8 項目に）/ `<div class="mute-indicator" id="js-mute-indicator" hidden>🔇 ミュート中</div>` 追加 |
| `src/renderer/style.css` | `.mute-indicator` 全 role 共通スタイル + `[data-role="operator"] .mute-indicator { display: none }` / `.shortcut-section` のセクション h3 + ul スタイル / `#op-pane-mute-status[data-muted="true"]` の赤系強調 |
| `src/renderer/renderer.js` | `updateMuteIndicator()` 新規関数 / `updateOperatorPane` 内で `op-pane-mute-status` 反映（`audioIsMuted` 経由）/ `case 'KeyM'` ブロック末尾に `updateMuteIndicator()` 呼出追加 / `initialize` 末尾で `updateMuteIndicator()` 起動時反映 |
| `docs/specs.md` | §7 から F2 行削除 + Ctrl+T を「テロップ編集ダイアログ」に更新 + rc5 補足を末尾注記に追記 |
| `package.json` | `version`: `2.0.4-rc4` → `2.0.4-rc5` / `scripts.test` に新規 1 ファイル追加 |
| `tests/v130-features.test.js` | T11 version 期待値 → `2.0.4-rc5` |
| `tests/v204-rc4-keyforward.test.js` | T2 を「KeyH 含まれない」→「KeyH 含まれる」に逆転（rc5 撤回反映）|
| `tests/v204-rc4-operator-pane.test.js` | HTML-3 を 7 項目 → 8 項目（音追加）/ HTML-4 を 5 カテゴリ構造検証に更新 / HTML-5 マーキー残存禁止 / HTML-6 mute-indicator 存在検証を追加 |
| `tests/v204-rc5-mute-indicator.test.js` | 新規 18 件（KeyM/KeyH forward / mute-indicator HTML/CSS/JS / op-pane-mute-status / F2/F12 削除 / テロップ表記 / 5 カテゴリ / 致命バグ保護）|

## 4. 修正コード抜粋

### A-1: KeyM / KeyH 追加（main.js）
```js
const FORWARD_KEYS_FROM_HALL = new Set([
  'Space', 'Enter', 'Escape',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyR', 'KeyA', 'KeyE', 'KeyS', 'KeyM', 'KeyT', 'KeyH'
]);
```

### A-6: ミュート視覚フィードバック（renderer.js）
```js
function updateMuteIndicator() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const indicator = document.getElementById('js-mute-indicator');
  if (!indicator) return;
  const muted = (typeof audioIsMuted === 'function') ? audioIsMuted() : false;
  if (muted) indicator.removeAttribute('hidden');
  else indicator.setAttribute('hidden', '');
  // operator role の運用情報「音」項目も同期更新
  const muteEl = document.getElementById('op-pane-mute-status');
  if (muteEl) {
    muteEl.textContent = muted ? 'ミュート中' : '通常';
    muteEl.setAttribute('data-muted', muted ? 'true' : 'false');
  }
}
```

### A-6-4: operator-pane の「音」項目（updateOperatorPane 内、抜粋）
```js
if (muteEl) {
  const muted = (typeof audioIsMuted === 'function') ? audioIsMuted() : false;
  muteEl.textContent = muted ? 'ミュート中' : '通常';
  muteEl.setAttribute('data-muted', muted ? 'true' : 'false');
}
```

### A-5: 操作一覧 5 カテゴリ（HTML 抜粋）
```html
<div class="shortcut-section"><h3>タイマー操作</h3><ul>...</ul></div>
<div class="shortcut-section"><h3>プレイヤー操作</h3><ul>...</ul></div>
<div class="shortcut-section"><h3>エントリー操作</h3><ul>...</ul></div>
<div class="shortcut-section"><h3>ダイアログ / 表示</h3><ul>...</ul></div>
<div class="shortcut-section"><h3>アプリ</h3><ul>...</ul></div>
```

## 5. テスト結果

| 件数 | 結果 |
|---|---|
| **302** | **全 PASS（0 件 FAIL）** |

内訳:
- 既存 138 件（v1.x〜v2.0.0）→ 全 PASS
- v2 専用 7 ファイル 52 件 → 全 PASS
- v2-window-race 4 件 / v2-stabilization 27 件 / v2-cleanup 8 件 / v2-coverage 9 件 → 全 PASS
- v204-hall-fullscreen 6 件 / v204-window-protection 11 件 → 全 PASS
- v204-rc4-keyforward 12 件（T2 更新）→ 全 PASS
- v204-rc4-operator-pane 17 件（HTML-3 / HTML-4 更新 + HTML-5 / HTML-6 新規）→ 全 PASS
- **v204-rc5-mute-indicator 18 件（新規）→ 全 PASS**

## 6. 致命バグ保護 5 件への影響評価

すべて影響なし:
- C.2.7-A `resetBlindProgressOnly`: 影響なし
- C.2.7-D `setDisplaySettings` destructure: 影響なし
- C.1-A2 `ensureEditorEditableState`: 影響なし
- C.1.7 AudioContext resume: 影響なし
- C.1.8 runtime 永続化 8 箇所: 影響なし（dispatcher の `case 'KeyM'` / `'KeyH'` → audioToggleMute / toggleBottomBar、tournamentRuntime には触れない）

cross-check テスト（v204-rc5-mute-indicator.test.js 末尾 2 件）で C.1.8 不変条件（schedulePersistRuntime 6 箇所以上）を継続担保。

## 7. 網羅再点検結果（22 キーの動作確認）

| カテゴリ | キー | dispatcher case | FORWARD_KEYS | 3 role 動作 |
|---|---|---|---|---|
| タイマー | Space | `'Space'` → handleStartPauseToggle | ✓ | 全 role ✓ |
| タイマー | Enter | （switch にない、ダイアログ確定で消費）| ✓ | 全 role ✓（dialog 内のみ）|
| タイマー | → | `'ArrowRight'` → advance30Seconds | ✓ | 全 role ✓ |
| タイマー | ← | `'ArrowLeft'` → rewind30Seconds | ✓ | 全 role ✓ |
| タイマー | R | `'KeyR'` (no ctrl) → openResetDialog | ✓ | 全 role ✓ |
| プレイヤー | ↑ | `'ArrowUp'` (no shift) → addNewEntry | ✓ | 全 role ✓ |
| プレイヤー | Shift+↑ | `'ArrowUp'` (shift) → cancelNewEntry | ✓ | 全 role ✓ |
| プレイヤー | ↓ | `'ArrowDown'` (no shift) → eliminatePlayer | ✓ | 全 role ✓ |
| プレイヤー | Shift+↓ | `'ArrowDown'` (shift) → revivePlayer | ✓ | 全 role ✓ |
| エントリー | Ctrl+R | `'KeyR'` (ctrl, no shift) → adjustReentry(+1) | ✓ | 全 role ✓ |
| エントリー | Ctrl+Shift+R | `'KeyR'` (ctrl, shift) → adjustReentry(-1) | ✓ | 全 role ✓ |
| エントリー | Ctrl+A | `'KeyA'` (ctrl, no shift) → adjustAddOn(+1) | ✓ | 全 role ✓ |
| エントリー | Ctrl+Shift+A | `'KeyA'` (ctrl, shift) → adjustAddOn(-1) | ✓ | 全 role ✓ |
| エントリー | Ctrl+E | `'KeyE'` (ctrl, no shift) → adjustSpecialStack(+1) | ✓ | 全 role ✓ |
| エントリー | Ctrl+Shift+E | `'KeyE'` (ctrl, shift) → adjustSpecialStack(-1) | ✓ | 全 role ✓ |
| ダイアログ | S | `'KeyS'` (no ctrl) → openSettingsDialog | ✓ | 全 role ✓ |
| ダイアログ | Ctrl+T | top branch (ctrl + KeyT) → openMarqueeDialog | ✓ | 全 role ✓ |
| ダイアログ | M | `'KeyM'` (no ctrl) → audioToggleMute + updateMuteIndicator | ✓（rc5 追加）| 全 role ✓ |
| ダイアログ | H | `'KeyH'` (no ctrl) → toggleBottomBar | ✓（rc5 追加、判断撤回）| 全 role ✓ |
| アプリ | F11 | globalShortcut → toggleFullScreen (focused window) | ✗（focused が反応すべき）| 全 role ✓（rc2 改修）|
| アプリ | Ctrl+Q | globalShortcut → confirmQuit | ✗（global なので forward 不要）| 全 role ✓ |
| アプリ | Esc | （switch にない、dialog default で消費）| ✓ | 全 role ✓（dialog 内のみ）|

→ 22 キーすべて正常動作見込み（実機確認は前原さんへ依頼）。

## 8. ミュート視覚フィードバックの 3 role 動作確認

| role | mute-indicator (画面右下) | operator-pane の「音」項目 |
|---|---|---|
| operator (AC) | **非表示**（CSS `[data-role="operator"] .mute-indicator { display: none !important }`）| **「ミュート中」表示**（`#op-pane-mute-status[data-muted="true"]` で赤系強調）|
| hall (B) | **表示**（HTML hidden 属性が JS で外れる）| なし（pane 自体が hall に存在しない、CSS で打ち消し済）|
| operator-solo (単画面) | **表示**（v1.3.0 互換例外、便利機能適用）| なし（pane 自体が operator-solo に存在しない）|

## 9. v1.3.0 互換からの「ミュート視覚」例外の妥当性評価

**妥当**:
- 前原さん指示「便利機能はどっちのモードにも適用したい」に従う
- v2.0.4 の `.exe` 全国配布構想に向け、単画面ユーザーにも便利機能改善を提供する戦略的判断
- **既存挙動の破壊ではなく純粋な追加**（UX 改善）
- 致命バグ保護 5 件への影響なし
- v1.3.0 で動いていた挙動は何一つ削除・変更しない

例外の範囲は **ミュート視覚フィードバックのみ**（プロンプト指示通り、他の便利機能例外は禁止事項）。

## 10. 並列 sub-agent 数

**0 体**（プロンプト指示通り、修正範囲が明確で並列不要）

## 11. ブランチ状態

- 現在ブランチ: `feature/v2.0.4-rc1-test-build`（rc1 → rc2 → rc3 → rc4 → rc5 連続使用）
- main マージ: しない
- リモート push: しない
- ローカルコミット: 実施予定（rc4 → rc5 差分追跡）

## 12. オーナー向け確認

1. **試験版 rc5 インストーラ生成完了**:
   `C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock\dist\PokerTimerPLUS+ (Test) Setup 2.0.4-rc5.exe`（約 80MB）

2. **前原さん再試験項目**:
   - 操作一覧が **5 カテゴリ**（タイマー操作 / プレイヤー操作 / エントリー操作 / ダイアログ表示 / アプリ）に分かれているか
   - 「マーキー」が「**テロップ**」になっているか（Ctrl+T 行）
   - **F2 / F12 が操作一覧から消えている**か
   - **B フォーカスで M / H が反応する**か（rc4 で M のみ反応、rc5 で両方反応すべき）
   - **B にフォーカスがある状態でミュート切替** → B の右下に「🔇 ミュート中」赤帯が表示されるか
   - **AC の運用情報に「音」項目** が出る + ミュート中は赤色で「ミュート中」表示されるか
   - **単画面モード（HDMI なし PC で起動した時）にもミュート切替** → 右下に「🔇 ミュート中」が出るか（v1.3.0 互換例外、便利機能適用）
   - 既存挙動（HDMI 抜き差し / × 確認 / Space / 矢印 / F11 / R / Ctrl+E など）が崩れていないか
