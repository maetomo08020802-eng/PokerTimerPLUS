# v2.0.0 STEP 3: PC 側 UI の分離（役割ガード方式）

## 状況
v2.0.0 STEP 0+1+2 完了 + **承認①の PR #1 マージ済**（main に反映、2026-05-01）。
本 STEP 3 は **役割ガードによる UI 分離**。CC の STEP 0 調査結果（v2-design.md §5 リスク 1）に従い、別ファイル分離ではなく **既存 renderer.js 流用 + 役割フラグでガード** 方式を採用。

参照ドキュメント:
- `skills/v2-dual-screen.md` §1.1（役割分離原則）+ §5（禁止事項）
- `skills/cc-operation-pitfalls.md`（公式準拠の絶対遵守事項、本フェーズ開始時に必ず Read）
- `docs/v2-design.md` §5 リスク 1（renderer.js 6106 行の役割分離方針 = 流用方式）

---

## ⚠️ スコープ制限（厳守）

**本 STEP 3 で実行するのは以下のみ:**
1. `src/renderer/style.css` の `[data-role]` セレクタを本格分離に発展
   - `role=hall`: 操作 UI（設定ダイアログ、操作ボタン、編集 UI 等）を完全 hidden
   - `role=operator`: 大きい表示要素（タイマー大表示、ブラインドカード等）を hidden、最低限の状態把握用ミニ表示を組み込み
   - `role=operator-solo`: **すべて ON（v1.3.0 完全同等）**
2. `src/renderer/renderer.js` の主要 handler 関数冒頭に role ガード追加（`if (window.appRole === 'hall') return;`）
3. STEP 1 で追加した視認用バッジ（🖥 HALL / 💻 OPERATOR）を「開発時のみ表示 or 完全削除」に変更（CC 判断）
4. operator → main への `notifyOperatorAction` 通知を有効化（STEP 2 で作った枠組みを実装で使う、主要操作のみ）
5. 既存 138 + STEP 2 新規 8 = 146 テスト全 PASS 維持
6. v2 専用テスト追加（`tests/v2-role-guard.test.js` 新規、5〜8 件、静的解析ベース）

**禁止事項:**
- HDMI 抜き差し追従（STEP 5）
- モニター選択ダイアログ（STEP 4）
- AudioContext 関連変更（STEP 5）
- **単画面モード（operator-solo）の挙動変更**（v1.3.0 完全同等を維持）
- 既存 138 テストの skip / 無効化
- 致命バグ保護 5 件への影響変更
- **並列 sub-agent / Task は最大 3 体まで**（公式 Agent Teams 推奨、`skills/cc-operation-pitfalls.md` §1.1）
- **「念のため」コード追加禁止**（`skills/cc-operation-pitfalls.md` §1.2）
- 「ついでに既存リファクタ」一切禁止
- CSP `script-src 'self'` 不変
- ポーリング禁止、必ずイベント駆動
- ホール側 renderer.js から `index.html` を別ファイル化しない（v2-design.md §5 リスク 1 の方針）

---

## Fix 1: `src/renderer/style.css` の `[data-role]` セレクタ本格分離

STEP 1 で追加した最小サンプル（バッジのみ）を発展させ、本格的な UI 分離を実装。

```css
/* === v2.0.0 STEP 3: 役割別 UI 分離 === */

/* === role=hall: 表示専用、操作 UI 完全 hidden === */
[data-role="hall"] .settings-button,
[data-role="hall"] .tournament-controls,
[data-role="hall"] .blinds-editor-trigger,
[data-role="hall"] .form-dialog,           /* 設定ダイアログ */
[data-role="hall"] .preset-controls,
[data-role="hall"] .reset-button,
[data-role="hall"] .start-button,
[data-role="hall"] .pause-button,
[data-role="hall"] .player-edit-controls,
/* ★ 実際の class 名は CC が renderer 側を grep で特定して列挙 */
{
  display: none !important;
}

/* === role=operator: 操作専用、大表示 hidden、ミニ状態表示残す === */
[data-role="operator"] .timer-display-large,
[data-role="operator"] .blinds-card,
[data-role="operator"] .next-blinds-card,
[data-role="operator"] .marquee,
[data-role="operator"] .pip-timer,
[data-role="operator"] .slideshow-stage,
[data-role="operator"] .background-image-overlay,
/* ★ 実際の class 名は CC が renderer 側を grep で特定 */
{
  display: none !important;
}

/* operator 側ミニ状態表示（最低限の状況把握用、操作 UI に組み込み） */
[data-role="operator"] .operator-status-bar {
  display: flex;   /* 既存に無ければ新規追加 */
  /* レイアウト詳細は CC 判断、画面上部に小さく「Level X / 残時間 / 状態」程度 */
}

/* === role=operator-solo: 全部 ON、v1.3.0 完全同等 === */
[data-role="operator-solo"] .operator-status-bar {
  display: none;   /* solo モードでは大表示があるので mini 不要 */
}
/* それ以外は何も変えない（既存 v1.3.0 のレイアウトそのまま）*/
```

注意:
- 実際の class 名・id は CC が renderer.js / index.html を grep で特定して列挙
- **operator-solo の見た目は v1.3.0 と完全同等**を維持（カード幅 54vw / 46vw、Barlow Condensed、すべて不変）
- `<dialog>` 要素自体に `display: flex` 等を当ててはいけない（feedback_dialog_no_flex 不変条件）
- ホール側でダイアログを完全 hidden にするのは `display: none` で OK

---

## Fix 2: `src/renderer/renderer.js` の handler 関数に role ガード

主要 handler 関数の冒頭に role ガードを追加:

```js
function someHandler(...) {
  if (window.appRole === 'hall') return;  // ホール側は操作不可
  // 既存ロジック
}
```

**ガード対象（CC が grep で該当箇所を特定して追加）:**

操作系（hall で動作してはいけない）:
- `handleTournamentNew` / `handleTournamentDuplicate` / `handleTournamentDelete`
- `handlePresetApply` / `handlePresetSave` / `handlePresetDiscard` / `handlePresetDuplicate`
- `handleResetButton` / `_handleResetImpl`
- `handleStartButton` / `handlePauseButton` / `handleNextLevelButton`
- `showSettingsDialog` / `closeSettingsDialog`
- `showApplyOnlyDialog` / `showApplyModeDialog`
- `handleAddPlayer` / `handleEliminatePlayer` / `handleAddOn` / `handleReentry`
- 編集系: `handleBlindsTableEdit` / `handleMarqueeEdit` / `handleDisplaySettingsEdit`

表示更新系（両側で動作 OK、ガード不要）:
- `renderTimer` / `renderBlindsTable` / `applyTournament` / `renderTournamentList` 等
- これらは hall 側で表示更新のため必須

**重要**:
- 全 handler に機械的に追加するのは禁止（スコープ越え）
- 上記の「操作系」のみガード追加、表示更新系は触らない
- ガード追加箇所は CC_REPORT に列挙

---

## Fix 3: STEP 1 のバッジを開発時のみ表示 or 削除

STEP 1 で追加した `[data-role="hall"] body::before { content: "🖥 HALL"; }` 等のバッジ:
- 本番運用では不要（お客様に見える可能性、運営感を損なう）
- 推奨対応: **完全削除**（最もシンプル）
- 別案: `process.env.NODE_ENV === 'development'` で分岐、本番ビルドで除外

CC 判断で OK、CC_REPORT で「どちらを採用したか」を明記。

---

## Fix 4: operator → main の operator-action 通知有効化

STEP 2 で作った `window.api.dual.notifyOperatorAction(action, payload)` を**実際に呼ぶ**。

対象（最小限、主要操作のみ）:
- タイマー start / pause / next-level
- preset apply
- tournament setActive

**operator-solo モードでは呼ばない**（main 経由 broadcast の必要なし、直接 timer.js / state.js を操作）。`role === 'operator'` のみで通知有効化。

実装パターン:
```js
async function handleStartButton() {
  if (window.appRole === 'hall') return;
  if (window.appRole === 'operator') {
    await window.api.dual.notifyOperatorAction('timer:start', { ... });
  } else {
    // operator-solo: 既存ロジックそのまま
    await timerStart();
  }
}
```

---

## Fix 5: v2 専用テスト追加

`tests/v2-role-guard.test.js`（新規、5〜8 件）:
- T1: `style.css` に `[data-role="hall"]` / `[data-role="operator"]` / `[data-role="operator-solo"]` のセレクタが存在
- T2: `renderer.js` の主要 handler 関数（5 箇所以上指定）冒頭に `window.appRole === 'hall'` ガードが存在
- T3: バッジセレクタが本番ビルドで生成されない（削除 or 開発モード分岐）
- T4: `operator-solo` モードで全 UI 要素が表示される（hidden が当たっていない）
- T5: `notifyOperatorAction` の呼出が `role === 'operator'` 限定（条件分岐の存在）
- T6: `<dialog>` 要素自体に `display: flex` / `flex-direction: column` / `overflow: hidden` が当たっていない（feedback_dialog_no_flex 静的担保）
- T7: 致命バグ保護関連の関数（`resetBlindProgressOnly` / `ensureEditorEditableState`）が role ガードで誤って skip されていない（PC 側で動作必須）

---

## Fix 6: 138 + 8 + α テスト全 PASS 維持

```bash
npm test
# Summary: 138 + 8 + N (>=5) = >=151 passed / 0 failed
```

1 件でも FAIL したら**即停止**、CC_REPORT に「何が壊れたか」「致命バグ保護への影響有無」明記。

---

## Fix 7: コミット & push（PR はまだ作らない）

```bash
git add -A
git status
git -c user.name="Yu Shitamachi" -c user.email="ymng2@icloud.com" commit -m "v2.0.0 STEP 3: PC 側 UI の分離（役割ガード方式）"
git push origin feature/v2.0.0
```

**PR は作らない**。承認②（STEP 5 完了時）で STEP 3+4+5 を 1 つの PR にまとめる方針。

---

## Fix 8: CC_REPORT.md（公式準拠フォーマット）

CC_REPORT.md を STEP 3 完了報告に書き換え:
1. **サマリ**: CSS 分離 / role ガード追加箇所数 / バッジ対応 / operator-action 有効化 / テスト件数
2. **修正ファイル**: 表形式
3. **主要変更点**: コード抜粋 5 行以内/件
4. **致命バグ保護への影響評価**: 5 件すべて「影響なし / 要注意 / 影響あり」明記（必須）
5. **並列起動した sub-agent / Task 数**（0〜3 体は OK、4 体以上は警告 + 設計見直し提案）
6. **構築士への質問**（あれば、なければ省略）
7. **オーナー向け確認**:
   - 単画面で起動 → v1.3.0 と完全同等の見た目・動作（変化なし）
   - 2 画面で起動（HDMI あれば）→ ホール側に操作ボタン・設定ダイアログが**出ない**、PC 側に大きいタイマー表示が**出ない**（操作 UI のみ）
   - PC 側で操作 → ホール側に反映される（STEP 2 の同期が役割ガード適用後も動く）

---

## 維持事項

- 既存 138 + STEP 2 新規 8 = 146 テスト全 PASS 維持（+ STEP 3 新規 5〜8 件追加）
- **`operator-solo` モード（単画面）は v1.3.0 と完全同等**
- 致命バグ保護 5 件すべて完全維持:
  - `resetBlindProgressOnly`（C.2.7-A）
  - `timerState` destructure 除外（C.2.7-D Fix 3）
  - `ensureEditorEditableState` 4 重防御（C.1-A2 + C.1.2-bugfix + C.1.4-fix1）
  - AudioContext resume in `_play()`（C.1.7、本 STEP では触らない）
  - runtime 永続化 8 箇所（C.1.8）
- カード幅 54vw / 46vw、Barlow Condensed 700、`<dialog>` flex 禁止
- `skills/v2-dual-screen.md`「§5 禁止事項」全項目
- `skills/cc-operation-pitfalls.md`「§1 絶対禁止事項」全項目
- CSP `script-src 'self'` 不変

---

## 完了条件

- [ ] `feature/v2.0.0` ブランチで STEP 3 のコミット作成 + push
- [ ] `style.css` に role 別の本格 UI 分離セレクタ追加
- [ ] `renderer.js` の主要操作系 handler 5 箇所以上に role ガード追加
- [ ] バッジ本番除外（削除 or 開発モード分岐）
- [ ] `notifyOperatorAction` を主要操作で有効化（`role === 'operator'` 限定）
- [ ] `tests/v2-role-guard.test.js`（新規）5〜8 件
- [ ] `npm test` で **既存 146 + 新規 5〜8 = >=151 件すべて PASS**
- [ ] 致命バグ保護 5 件すべて影響なし確認
- [ ] 並列 sub-agent / Task 数を CC_REPORT で報告（4 体以上禁止）
- [ ] CC_REPORT.md 完了報告（オーナー向け確認 3 項目記載）
