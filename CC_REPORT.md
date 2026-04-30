# CC_REPORT — 2026-05-01 v2.0.0 STEP 3: PC 側 UI の分離（役割ガード方式）

## 1. サマリー

- `style.css` に `[data-role]` セレクタを本格実装。hall は操作 UI を完全 hidden、operator は大表示を hidden + ミニ状態バー、operator-solo は一切無変更（v1.3.0 完全同等）
- STEP 1 の視認用バッジ（🖥 HALL / 💻 OPERATOR）は **削除**（本番運用でお客様に見える可能性を排除）
- `renderer.js` の主要操作 handler **14 箇所**の冒頭に `window.appRole === 'hall'` ガード追加
- `notifyOperatorActionIfNeeded` ヘルパー追加（role==="operator" 限定）+ btnStart / btnPause click で呼出有効化
- `index.html` に `.operator-status-bar`（Level / Time / Status の 1 行表示）を新規追加 + `updateOperatorStatusBar` 関数で既存 subscribe 経由更新
- `tests/v2-role-guard.test.js`（新規、8 件）+ `package.json` 更新
- 既存 138 + STEP 2 新規 8 + STEP 3 新規 8 = **154 件すべて PASS**
- 致命バグ保護 5 件すべて影響なし、commit `e577618` push 済（**PR は作らず**、承認②で STEP 3+4+5 まとめて作成予定）

---

## 2. 修正ファイル

| ファイル | 変更点（短く） |
| --- | --- |
| `src/renderer/style.css` | STEP 1 バッジ削除 → `[data-role]` 本格分離（hall 4 セレクタ、operator 6 セレクタ + ミニ状態バー） |
| `src/renderer/index.html` | `.operator-status-bar` 要素新規追加（Level / Time / Status の 3 項目） |
| `src/renderer/renderer.js` | 主要 handler 14 箇所に hall ガード、`notifyOperatorActionIfNeeded` + `updateOperatorStatusBar` 追加 |
| `tests/v2-role-guard.test.js`（新規） | 8 件の静的解析テスト |
| `package.json` | test スクリプトに `v2-role-guard.test.js` 追加 |

---

## 3. 主要変更点

**style.css: 役割別 UI 分離**

```css
/* hall: 操作 UI 完全 hidden */
[data-role="hall"] .bottom-bar,
[data-role="hall"] .form-dialog,
[data-role="hall"] .confirm-dialog,
[data-role="hall"] .pip-action-btn { display: none !important; }

/* operator: 大表示 hidden + ミニ状態バー */
[data-role="operator"] .clock,
[data-role="operator"] .marquee,
[data-role="operator"] .slideshow-stage,
[data-role="operator"] .pip-timer,
[data-role="operator"] .pip-action-btn,
[data-role="operator"] .bg-image-overlay { display: none !important; }
[data-role="operator"] .operator-status-bar {
  display: flex !important; position: fixed; top: 0; ... height: 36px;
}
/* operator-solo: 何も変えない（v1.3.0 完全同等）*/
```

**renderer.js: handler 冒頭の hall ガード（14 箇所、抜粋）**

```js
function handleStartPauseToggle() {
  if (window.appRole === 'hall') return;
  ensureAudioReady();
  // ... 既存ロジック
}
async function handleTournamentNew() {
  if (window.appRole === 'hall') return;
  // ... 既存ロジック
}
```

ガード追加箇所（全 14 件）:
1. `handleStartPauseToggle`
2. `openResetDialog`
3. `openPreStartDialog`
4. `openSettingsDialog`
5. `handleTournamentNew`
6. `handleTournamentDuplicate`
7. `handleTournamentRowDelete`
8. `handleTournamentSave`
9. `handlePresetSave`
10. `handlePresetApply`
11. `handleMarqueeSave`
12. `handleReset`
13. `addNewEntry`
14. `eliminatePlayer`

加えてボタン click handler（`btnStart` / `btnPause` / `btnReset`）の冒頭にも多重防御の hall ガードを追加。

**renderer.js: notifyOperatorAction wrapper**

```js
function notifyOperatorActionIfNeeded(action, payload) {
  if (typeof window === 'undefined') return;
  if (window.appRole !== 'operator') return;     // operator-solo / hall では no-op
  const dual = window.api && window.api.dual;
  if (!dual || typeof dual.notifyOperatorAction !== 'function') return;
  try { dual.notifyOperatorAction(action, payload || {}); } catch (_) { /* ignore */ }
}
```

**renderer.js: ミニ状態バー更新（既存 subscribe 経由、tick ごとではなく差分更新）**

```js
function updateOperatorStatusBar(state) {
  if (typeof window === 'undefined' || window.appRole !== 'operator') return;
  // Level / Time / Status の 3 要素を innerText 更新
}
```

---

## 4. 致命バグ保護への影響評価

| 致命バグ保護 | 影響評価 | 根拠 |
| --- | --- | --- |
| `resetBlindProgressOnly`（C.2.7-A）| **影響なし** | 関数本体に hall ガード**追加せず**（PC 側で必ず動作する必要、T7 で静的担保）。`handleReset` のみガード追加、`resetBlindProgressOnly` 経路は無傷 |
| `timerState` destructure 除外（C.2.7-D Fix 3）| **影響なし** | 本 STEP は CSS / handler ガードのみ、IPC payload 構造には一切触らない |
| `ensureEditorEditableState` 4 重防御（C.1-A2 系）| **影響なし** | 関数本体に hall ガード**追加せず**（PC 側で必ず動作する必要、T7 で静的担保）。`handleTournamentNew` 等のガードは関数冒頭のみ、内部の `ensureEditorEditableState` 呼出は無傷 |
| AudioContext resume（C.1.7）| **影響なし** | `_play()` 内 resume 防御は無変更。`audio.js` も無変更 |
| runtime 永続化 8 箇所（C.1.8）| **影響なし** | `addNewEntry` / `eliminatePlayer` は hall ガード追加（hall で無効化）。PC 側では既存 `schedulePersistRuntime` 経路がそのまま動作 |

**結論**: 5 件すべて完全継承。STEP 3 で破壊的変更なし。T7 テストで「致命バグ関連関数に hall ガードが**ない**こと」を静的担保。

---

## 5. 並列起動した sub-agent / Task 数

**0 体**（直接実行、`skills/cc-operation-pitfalls.md` §1.1 公式推奨遵守）

調査・実装すべて main session で順次実行。並列 Agent を使う必要のない粒度（既存ファイル把握 → CSS 編集 → JS 編集 → テスト追加が線形依存）。

---

## 6. テスト結果

```
=== Summary: 7 + 6 + 9 + 9 + 5 + 4 + 7 + 8 + 8 + 12 + 19 + 24 + 8 + 6 + 6 + 8 + 8 = 154 passed / 0 failed ===
```

- 既存 138 件: すべて PASS（影響なし確認）
- STEP 2 新規 8 件: すべて PASS（v2-dual-sync）
- STEP 3 新規 8 件（v2-role-guard）: すべて PASS
  - T1: `[data-role]` セレクタ群の存在（hall / operator / operator-solo + ミニ状態バー）
  - T2: 主要 handler 5 箇所以上に hall ガード（14 箇所中 14 箇所検出）
  - T3: STEP 1 バッジ（🖥 HALL / 💻 OPERATOR）が削除されている
  - T4: `notifyOperatorActionIfNeeded` 内の `role !== "operator"` 早期 return + 主要操作で呼出
  - T5: `index.html` に `.operator-status-bar` 要素 + 子 span 3 個
  - T6: `<dialog>` 自体に `display: flex` が当たっていない（feedback_dialog_no_flex 維持）
  - T7: `resetBlindProgressOnly` / `ensureEditorEditableState` / `resetTournamentRuntime` に hall ガードが**ない**
  - T8: operator-solo モードで `.clock` / `.bottom-bar` / `.marquee` に hidden が当たっていない（v1.3.0 完全同等）

---

## 7. オーナー向け確認

1. **単画面 PC（HDMI なし）で起動**: v1.3.0 配布版と完全同じ見た目・動作になるか確認してください（operator-solo モード、`[data-role]` セレクタは一切当たらず、ミニ状態バーも hidden のまま）
2. **2 画面環境（HDMI モニターあり）で起動**: 
   - **ホール側**: 大きいタイマー + ブラインドカード + テロップ等の表示要素のみ表示、操作ボタン・設定ダイアログ・ショートカット説明バーは**一切表示されない**こと
   - **PC 側（前原さん操作用）**: 大きいタイマー / ブラインドカード等は**非表示**、画面上部に小さなミニ状態バー（Level X / Time MM:SS / Status）+ 既存の操作 UI（設定ダイアログ・ボタン等）のみ表示されること
3. **PC 側で操作 → ホール側に同期反映** が STEP 2 同様に動作するか確認してください
4. **本フェーズで PR は作成していません**（承認②で STEP 3+4+5 まとめて 1 PR にする方針）。承認①の PR #1 が引き続き main 待ちのままです
