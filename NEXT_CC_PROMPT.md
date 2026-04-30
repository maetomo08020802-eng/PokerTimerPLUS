# v2.0.0 STEP 6: テスト拡充（既存 170 + 統合・後方互換・エッジケース）

## 状況
v2.0.0 STEP 0+1+2+3+4+5 完了。承認①の PR #1 + 承認②の PR #2 すべて main マージ済み。
本 STEP 6 は **テスト拡充** に集中（実装変更なし、テストファイル追加のみ）。STEP 7（最終検証 + version bump）の前に、配布前の最終品質を担保する。
完了時に PR は作らない（承認③は STEP 7 完了時にまとめる）。

参照ドキュメント:
- `skills/v2-dual-screen.md` §6（テスト方針）
- `skills/cc-operation-pitfalls.md`（公式準拠の絶対遵守事項、本フェーズ開始時に必ず Read）

---

## ⚠️ スコープ制限（厳守）

**本 STEP 6 で実行するのは以下のみ:**
1. `tests/v2-integration.test.js`（新規、統合テスト 6〜8 件）— STEP 0〜5 の組み合わせ動作の静的解析
2. `tests/v2-backward-compat.test.js`（新規、v1.3.0 後方互換 4〜6 件）— `operator-solo` モードの強化テスト
3. `tests/v2-edge-cases.test.js`（新規、エッジケース 4〜6 件）— モニター 3 枚以上 / キャンセル経路 / 異常系
4. `package.json` 更新（test スクリプトに 3 ファイル追加）
5. 既存 170 テスト全 PASS 維持
6. コミット & push、**PR は作らない**（承認③で STEP 6+7 まとめる方針）

**禁止事項:**
- `src/` 配下の本体コード変更**一切**（テストファイルと package.json のみ）
- 既存テストの skip / 無効化
- 致命バグ保護 5 件への影響変更
- **並列 sub-agent / Task は最大 3 体まで**（`skills/cc-operation-pitfalls.md` §1.1）
- **「念のため」コード追加禁止**（`skills/cc-operation-pitfalls.md` §1.2）
- 「ついでに既存リファクタ」一切禁止
- ドキュメント更新（specs.md / skills/ / CHANGELOG.md 等）は **STEP 7 で行う**ので本 STEP では触らない
- version bump（package.json の version）は STEP 7

---

## Fix 1: `tests/v2-integration.test.js`（新規、6〜8 件）

STEP 0〜5 の組み合わせが正しく機能するかを静的解析で検証。

カバー対象（CC が既存テストパターン踏襲して実装）:
- T1: 起動シーケンス全体フロー（`app.whenReady` → `screen.getAllDisplays` → `chooseHallDisplayInteractive` → `createOperatorWindow` / `createHallWindow` → `setupDisplayChangeListeners`）が main.js に揃っている
- T2: `dual:state-sync-init`（STEP 2）+ `dual:operator-action`（STEP 2）+ `display-picker:fetch`（STEP 4）+ `display-removed` / `display-added` ハンドラ（STEP 5）すべての IPC ハンドラが共存
- T3: `additionalArguments` で role（operator / hall / operator-solo / picker）4 種類すべてが設定可能なコードパスが存在
- T4: renderer.js の起動部 role 分岐（hall / operator / operator-solo）が `dual-sync.js` の import + `notifyOperatorActionIfNeeded` + `ensureAudioReady` をすべて含む
- T5: hallWindow 不在時の `_broadcastDualState` no-op + `_publishDualState` の安全性（STEP 2 + STEP 5 の連携）
- T6: `chooseHallDisplayInteractive` のキャンセル経路（resolve(null)）から `createOperatorWindow(_, true)` 単画面起動（STEP 4 + STEP 5 の連携）
- T7: HDMI 抜き → operator-solo 切替時に `ensureAudioReady` が呼ばれる経路（STEP 5 + C.1.7 の連携）
- T8: 致命バグ保護 5 件すべての関数本体・呼出経路が renderer.js / main.js / audio.js に維持されている（cross-step 静的検査）

---

## Fix 2: `tests/v2-backward-compat.test.js`（新規、4〜6 件）

`operator-solo` モード（単画面、HDMI なし環境）が v1.3.0 と完全同等に動作することを担保。

カバー対象:
- T1: `operator-solo` で起動した renderer.js が v1.3.0 と同じ初期化パス（`initialize()` 単独呼出）を経由
- T2: `[data-role="operator-solo"]` セレクタが style.css で「すべての要素を hidden にしない」（v1.3.0 のレイアウトを完全維持）
- T3: `operator-solo` モードでは `notifyOperatorActionIfNeeded` の no-op 早期 return が機能（main 経由 broadcast を起こさない）
- T4: `dual-sync.js` の `initDualSyncForHall` が `window.appRole !== 'hall'` で早期 return（operator-solo で誤作動しない）
- T5: 既存致命バグ修正（C.2.7-A `resetBlindProgressOnly` / C.2.7-D `timerState` destructure 除外 / C.1-A2 `ensureEditorEditableState` 4 重防御 / C.1.7 `_play()` resume / C.1.8 runtime 永続化 8 箇所）が `operator-solo` で全て機能
- T6: STEP 1〜5 で追加した CSS / JS / IPC / ハンドラが v1.3.0 配布物の挙動を一切壊していない（既存 138 テストの抜き打ち再確認）

---

## Fix 3: `tests/v2-edge-cases.test.js`（新規、4〜6 件）

エッジケース・異常系のテスト。

カバー対象:
- T1: モニター 3 枚以上検出時、`chooseHallDisplayInteractive` が全モニターを表示する（`displays.length >= 3` でも動作）
- T2: `display-picker:fetch` で `display.label` が空文字列の場合、フォールバックラベル生成ロジックが機能する位置に存在
- T3: `display-removed` で operator 側 display が抜けたケース（hall ではなく operator）— 現状は何もしない（warn ログ程度）が、設計意図として実装されているか確認
- T4: `display-added` で 3 枚目が追加されたケース（既に 2 画面の時）— 何もしない早期 return が存在
- T5: `chooseHallDisplayInteractive` の Promise が二重 resolve しない（`resolved` フラグの存在）
- T6: `_dualStateCache` のキー（timerState / structure / displaySettings / marqueeSettings / runtime / tournamentBasics / audioSettings / logoUrl 等 9 種類）に未知のキーが追加されていない（仕様の固定）

---

## Fix 4: `package.json` 更新

test スクリプトに 3 ファイルを追加:

```json
"test": "node --test tests/data-transfer.test.js tests/runtime-preservation.test.js ... tests/v2-display-change.test.js tests/v2-integration.test.js tests/v2-backward-compat.test.js tests/v2-edge-cases.test.js"
```

実際の test スクリプトは既存形式を踏襲、3 ファイル追加のみ。

---

## Fix 5: 既存 170 テスト全 PASS 維持

```bash
npm test
# Summary: 170 + N (>=14) = >=184 passed / 0 failed
```

1 件でも FAIL したら**即停止**、CC_REPORT に「何が壊れたか」「致命バグ保護への影響有無」明記。

---

## Fix 6: コミット & push（PR は STEP 7 完了時）

```bash
git add -A
git status
git -c user.name="Yu Shitamachi" -c user.email="ymng2@icloud.com" commit -m "v2.0.0 STEP 6: テスト拡充（統合 + 後方互換 + エッジケース）"
git push origin feature/v2.0.0
```

**PR は作らない**。承認③（STEP 7 完了時）で STEP 6+7 を 1 つの PR にまとめる方針。

---

## Fix 7: CC_REPORT.md（公式準拠フォーマット）

CC_REPORT.md を STEP 6 完了報告に書き換え:
1. **サマリ**: 3 テストファイル新規 / 合計テスト件数 / 既存 170 件影響なし確認
2. **修正ファイル**: 表形式（テストファイル 3 つ + package.json）
3. **主要変更点**: 各テストファイルの T1〜TN リスト
4. **致命バグ保護への影響評価**: 5 件すべて「影響なし」（テストのみのため、本体実装に変更なし）
5. **並列起動した sub-agent / Task 数**（0〜3 体は OK、4 体以上は警告）
6. **構築士への質問**（あれば、なければ省略）
7. **オーナー向け確認**:
   - 単画面 PC で起動 → v1.3.0 と完全同等（変化なし）
   - 全テスト件数（>=184）が緑色で PASS していること
   - PR は未作成（承認③で STEP 6+7 まとめて作る）

---

## 維持事項

- 既存 170 テスト全 PASS 維持（+ STEP 6 新規 14〜20 件追加）
- **`operator-solo` モード（単画面）は v1.3.0 と完全同等**（変更なし、テストで担保強化）
- 致命バグ保護 5 件すべて完全維持（変更なし、テストで cross-step 静的検査）
- カード幅 / Barlow Condensed / `<dialog>` flex 禁止
- `skills/v2-dual-screen.md`「§5 禁止事項」全項目
- `skills/cc-operation-pitfalls.md`「§1 絶対禁止事項」全項目
- CSP `script-src 'self'` 不変
- ポーリング禁止、イベント駆動

---

## 完了条件

- [ ] `feature/v2.0.0` ブランチで STEP 6 のコミット作成 + push
- [ ] `tests/v2-integration.test.js`（新規）6〜8 件
- [ ] `tests/v2-backward-compat.test.js`（新規）4〜6 件
- [ ] `tests/v2-edge-cases.test.js`（新規）4〜6 件
- [ ] `package.json` 更新（test スクリプト）
- [ ] `npm test` で **既存 170 + 新規 14〜20 = >=184 件すべて PASS**
- [ ] `src/` 配下の本体コード変更ゼロ（git diff src/ で確認）
- [ ] 致命バグ保護 5 件すべて影響なし確認
- [ ] 並列 sub-agent / Task 数を CC_REPORT で報告（4 体以上禁止）
- [ ] CC_REPORT.md 完了報告
