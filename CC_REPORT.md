# CC_REPORT — 2026-05-01 v2.0.2 残課題対応（軽量フォローアップ）

## 1. サマリー

v2.0.1 で構築士判断保留としていた #P1（dual:operator-action デッドコード）を完全削除。関連する preload.js / renderer.js の wrapper、4 テストファイルの該当 assertion も同時撤去。221 テスト全 PASS 維持。

## 2. 修正ファイル

| ファイル | 変更点 |
| --- | --- |
| `src/main.js` | `_DUAL_ACTION_ROUTE` + `dual:operator-action` ハンドラ削除 → 撤去経緯コメント残す |
| `src/preload.js` | `notifyOperatorAction` 削除 + コメント更新 |
| `src/renderer/renderer.js` | `notifyOperatorActionIfNeeded` 関数 + 2 呼出（btnStart / btnPause）削除 |
| `tests/v2-backward-compat.test.js` | T3: 「ヘルパー削除済み」アサート転換 |
| `tests/v2-dual-sync.test.js` | T3: 「ハンドラ削除済み」アサート転換 / T5: notifyOperatorAction 撤去アサート |
| `tests/v2-integration.test.js` | T2: dual:operator-action アサート削除 / T4: ヘルパー撤去アサート |
| `tests/v2-role-guard.test.js` | T4: 「ヘルパー削除済み」アサート転換 |

## 3. 主要変更点（要点のみ）

### #P1 削除: dual:operator-action ハンドラ + 関連 wrapper

main.js から以下を削除（コメント残す）:
```js
// v2.0.2: dual:operator-action ハンドラ + _DUAL_ACTION_ROUTE は削除（デッドコード除去）
```

preload.js から `notifyOperatorAction` 行を削除、renderer.js から `notifyOperatorActionIfNeeded` 関数本体と 2 箇所の呼出（`timer:start` / `timer:pause`）を削除。

### テスト調整: 削除を**正の制約**として担保

旧テストは「存在を確認」する `assert.match` だったため、削除すると FAIL する。
これを `assert.doesNotMatch` に転換し「v2.0.2 で削除済み」を新たな不変条件として担保。
こうすると次フェーズで誤って復活させた場合に検出できる。

## 4. 致命バグ保護 5 件への影響評価

全削除対象は v2 STEP 3 で追加された wrapper のみで、致命バグ保護 5 件には**影響なし**:
- `resetBlindProgressOnly`（C.2.7-A）: 触れていない
- `timerState` destructure 除外（C.2.7-D）: 触れていない
- `ensureEditorEditableState` 4 重防御: 触れていない
- AudioContext resume in `_play()`（C.1.7）: 触れていない
- runtime 永続化 8 箇所（C.1.8）: 触れていない

operator → hall の状態伝播は既存 IPC（`tournaments:setTimerState` 等）→ main 側 `_publishDualState` 経路で正常動作（v2.0.1 で確認済）、削除による機能後退なし。

## 5. テスト結果

| 対象 | 件数 | 結果 |
| --- | --- | --- |
| 既存 138 件（v1.x〜v2.0.0）| 138 | 全 PASS |
| v2 専用 7 ファイル（修正後）| 52 | 全 PASS |
| v2-window-race | 4 | 全 PASS |
| v2-stabilization | 27 | 全 PASS |
| **合計** | **221** | **0 失敗** |

## 6. 並列 sub-agent 数

なし（軽量フォローアップのため、sub-agent 起動不要と判断）

## 7. 残提案項目（実装せず保留 — 構築士判断要）

| ID | 内容 | 修正規模 |
| --- | --- | --- |
| **#P2** | preset フィルタ後 option 不整合 UX → `refreshPresetList` 末尾に「無ければ draft クリア」 | 約 5 行 / renderer.js |
| **#P3** | `sanitizeBreakImages` else 分岐で fallback 再 sanitize → `cur.breakImages || []` 直接代入 | 約 1 行 / main.js |
| **#P4** | `app.on('will-quit')` 二重登録 → 1 ハンドラに統合 | 約 5 行 / main.js |

いずれも実害はほぼ無い保守性向上案。次フェーズで構築士の判断を仰ぎたい:
- a. v2.0.3 として小修正パッチに統合
- b. 配布後の様子を見て後日対応
- c. 現状維持（実害なしのため積極修正不要）

## 8. PR

- **PR URL**: （`gh pr create` 後に追記）
- **base**: `main`
- **head**: `feature/v2.0.2-followup`
- **commit 数**: 1（dead code removal + test updates 一括）

## 9. オーナー向け確認

1. **既存機能は完全維持**: 削除した 3 つの関数はいずれも「validate して結果を返すだけ / 何もしない wrapper」で、実機能には影響しません。221 テストすべて PASS で確認済
2. **コードがシンプルに**: 約 35 行のデッドコードが消えて将来の v3.0.0 設計検討時の混乱を防ぎます
3. **次フェーズ判断**: 残提案項目 P2〜P4（実害なし）の対応方針を決めていただきたい（CC_REPORT 7 節参照）
