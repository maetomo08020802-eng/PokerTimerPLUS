# v2.0.0 STEP 7: 最終検証 + ドキュメント更新 + version bump【承認③対象、v2.0.0 完成判定】

## 状況
v2.0.0 STEP 0+1+2+3+4+5+6 完了。承認①の PR #1 + 承認②の PR #2 すべて main マージ済み。
合計 190 テスト全 PASS。実装は完成、ドキュメントと version のみが残っている。
本 STEP 7 で **v2.0.0 完成判定 + 承認③の PR 作成**（feature/v2.0.0 → main、STEP 6+7 まとめ）。

参照ドキュメント:
- `skills/v2-dual-screen.md` 全体
- `skills/cc-operation-pitfalls.md`（公式準拠の絶対遵守事項、本フェーズ開始時に必ず Read）
- 既存 v1.3.0 の docs / skills / CHANGELOG.md / README.md（参考）

---

## ⚠️ スコープ制限（厳守）

**本 STEP 7 で実行するのは以下のみ:**
1. `docs/specs.md` に「v2.0.0 機能追加（2 画面対応）」セクション追記
2. `skills/timer-logic.md` に v2 の不変条件追記（既存 v1.x 不変条件は維持、追加分のみ）
3. `CHANGELOG.md` に v2.0.0 セクション追加（Keep a Changelog 形式、v1.3.0 の上に配置）
4. `README.md` に v2.0.0 機能（2 画面対応）の説明追記（任意、CC 判断）
5. `package.json` の `version`: `"1.3.0"` → `"2.0.0"`
6. `CLAUDE.md` の v2.0.0 STEP 順序セクションに「STEP 7 完了 = v2.0.0 完成」状態を追記
7. 既存 190 テスト全 PASS 維持
8. **承認③の PR 作成**（feature/v2.0.0 → main、STEP 6+7 まとめ）
9. CC_REPORT.md 完了報告 + PR URL 記載

**禁止事項:**
- `src/` 配下の本体コード変更**一切**（version bump は package.json のみ、本体は無変更）
- 既存 190 テストの skip / 無効化
- 致命バグ保護 5 件への影響変更
- **並列 sub-agent / Task は最大 3 体まで**（`skills/cc-operation-pitfalls.md` §1.1）
- **「念のため」コード追加禁止**（`skills/cc-operation-pitfalls.md` §1.2）
- 「ついでに既存リファクタ」一切禁止
- v2.0.0 配布物（.exe）のビルド実行は禁止（前原さんの配布判断後、別途）
- GitHub Releases タグ作成は禁止（前原さんの配布判断後、別途）

---

## Fix 1: `docs/specs.md` 更新

末尾に「v2.0.0 機能追加（2 画面対応大改修）」セクション追記。既存の「STEP 10 機能追加（v1.2.0）」セクション後ろに配置。

記載内容:
- 2 画面対応の概要（ホール側 = 表示専用、PC 側 = 操作専用、operator-solo = 単画面 v1.3.0 完全同等）
- 起動時のモニター選択ダイアログ仕様
- HDMI 抜き差し追従仕様（display-added / display-removed イベント駆動）
- AudioContext 再初期化対応（C.1.7 強化）
- 状態同期の精度基準（タイマー ±100ms、操作レスポンス 300ms、構造変更 500ms、設定変更 200ms）
- 後方互換: HDMI なし環境では v1.3.0 と完全同等

5〜10 サブセクション、合計 80〜120 行程度。

---

## Fix 2: `skills/timer-logic.md` 更新

既存「STEP 10 で確定した不変条件 (v1.2.0)」セクション後ろに「v2.0.0 で追加した不変条件」を追加。

記載内容:
- ホール側ウィンドウは purely consumer（main への送信なし）
- 状態同期は IPC 集約、ウィンドウ間直接通信禁止
- 単画面モード（operator-solo）は v1.3.0 と完全同等
- HDMI 抜き差し時のウィンドウ再生成方式（reload では role 変更不可、再生成必須）
- AudioContext 再初期化フロー（C.1.7 + STEP 5 強化）
- ポーリング禁止、必ずイベント駆動

10〜15 行程度の追記。

---

## Fix 3: `CHANGELOG.md` に v2.0.0 セクション

Keep a Changelog 形式、v1.3.0 の上に配置:

```markdown
## [2.0.0] - 2026-05-01

### Added
- 2 画面対応（HDMI 拡張モニターでホール側 / PC 側を分離）
- 起動時のモニター選択ダイアログ（毎回手動選択、前回選択を参考バッジ表示）
- HDMI 抜き差し追従（営業中の自動切替、タイマー進行中断なし）
- ホール側ウィンドウ用の `data-role` 属性（preload 経由、CSP 不変条件保護）
- main プロセスを単一の真実源とする状態キャッシュ + 差分 broadcast（ポーリング禁止、イベント駆動）
- v2.0.0 専用テスト 52 件追加（既存 138 + 新規 52 = 190 件）

### Changed
- AudioContext resume 強化（operator-solo 起動時に `ensureAudioReady` 明示呼出、HDMI 抜き直後の音欠落防止）
- renderer.js の主要操作 handler 14 箇所に `role === 'hall'` ガード追加（hall 側で操作不可）
- CSS `[data-role]` セレクタで役割別 UI 分離（hall = 操作 UI hidden、operator = 大表示 hidden + ミニ状態バー）

### Compatibility
- 単画面モード（HDMI なし環境）は v1.3.0 と完全同等
- 致命バグ保護 5 件（resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState / AudioContext resume / runtime 永続化）すべて完全維持

### Migration Notes
- v1.3.0 → v2.0.0 のデータ移行は不要（store スキーマ変更なし、既存 tournaments / settings / displaySettings そのまま使用可）
- HDMI モニターが繋がっていない環境では何も変わらない、自動的に operator-solo モードで起動
```

---

## Fix 4: `README.md` に v2.0.0 機能追記（任意、CC 判断）

既存の機能説明セクションに「2 画面対応」の項目を追加。長くする必要なし、3〜5 行程度。
README.md が存在しない or 大幅変更が必要なら CC_REPORT で構築士に確認。

---

## Fix 5: `package.json` の version bump

```json
{
  "name": "poker-timer-plus",
  "version": "2.0.0",   // ← 1.3.0 → 2.0.0
  ...
}
```

他の package.json フィールド（dependencies / scripts / build 等）には触らない。

---

## Fix 6: `CLAUDE.md` の v2.0.0 状態更新

`CLAUDE.md` の「v2.0.0 STEP 順序」セクションの先頭 or 末尾に以下を追記:

```markdown
**v2.0.0 状態（2026-05-01 時点）**: STEP 0〜7 すべて完了 → **v2.0.0 完成**。
配布判断は前原さん次第（GitHub Releases タグ作成 + .exe ビルド + アップロードで配布開始）。
```

---

## Fix 7: 既存 190 テスト全 PASS 維持

```bash
npm test
# Summary: 190 passed / 0 failed を確認
```

1 件でも FAIL したら**即停止**、CC_REPORT に「何が壊れたか」「致命バグ保護への影響有無」明記。

`src/` 配下無変更 + テストファイル無変更のため、当然 190 PASS のはず。最終確認として実行。

---

## Fix 8: コミット & push & 承認③の PR 作成

```bash
git add -A
git status
git -c user.name="Yu Shitamachi" -c user.email="ymng2@icloud.com" commit -m "v2.0.0 STEP 7: ドキュメント更新 + version bump 1.3.0 → 2.0.0"
git push origin feature/v2.0.0

# 承認③の PR 作成（STEP 6+7 まとめ）
gh pr create \
  --base main \
  --head feature/v2.0.0 \
  --title "v2.0.0 STEP 6+7: テスト拡充 + ドキュメント + version 2.0.0" \
  --body "$(cat <<'EOF'
## サマリ
v2.0.0 大改修の最終 PR。STEP 6（テスト拡充 20 件）+ STEP 7（ドキュメント更新 + version bump）をまとめてマージ → v2.0.0 完成判定。

## 完了 STEP
- STEP 6: tests/v2-integration.test.js (8) + v2-backward-compat.test.js (6) + v2-edge-cases.test.js (6)、合計 20 件追加（src/ 配下無変更）
- STEP 7: docs/specs.md / skills/timer-logic.md / CHANGELOG.md 更新、package.json version 1.3.0 → 2.0.0

## 動作確認
- 単画面 PC: v1.3.0 と完全同等（operator-solo モード）
- 2 画面環境: 起動時ダイアログ → 選択 → 2 画面同期動作
- 営業中 HDMI 抜き → 単画面復帰、タイマー進行中断なし、音継続
- HDMI 再接続 → ダイアログ → 2 画面復帰、状態自動復元
- npm test: 190 件全 PASS

## 致命バグ保護
- 5 件すべて完全維持（resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState / AudioContext resume / runtime 永続化）
- AudioContext は STEP 5 で再初期化対応強化済み

## v1.3.0 → v2.0.0 移行
- データ移行不要、store スキーマ変更なし
- HDMI なし環境では自動的に operator-solo モードで v1.3.0 完全同等動作

## 残作業（v2.0.0 完成後、別フェーズ）
- 配布版（.exe）ビルド + GitHub Releases タグ作成（前原さんの配布判断後）
EOF
)"
```

PR URL を CC_REPORT に記載。

---

## Fix 9: CC_REPORT.md（公式準拠フォーマット）

CC_REPORT.md を STEP 7 完了報告に書き換え:
1. **サマリ**: ドキュメント 4 ファイル更新 / version 2.0.0 / テスト 190 維持 / PR URL
2. **修正ファイル**: 表形式（src/ 配下は package.json のみ、ほかは docs / skills / CHANGELOG / README / CLAUDE.md）
3. **主要変更点**: 各ファイルの追記内容を要約
4. **致命バグ保護への影響評価**: 5 件すべて「影響なし」（src/ 配下は package.json のみ、本体実装無変更）
5. **並列起動した sub-agent / Task 数**（0〜3 体は OK、4 体以上は警告）
6. **構築士への質問**（あれば、なければ省略）
7. **オーナー向け確認**:
   - 単画面 PC で起動 → v1.3.0 と完全同等（変化なし）
   - About 画面（タイトルバー）で「PokerTimerPLUS+ 2.0.0」表示確認
   - 全テスト 190 件 PASS
   - PR の URL（前原さんがブラウザで開いてマージ操作 → **v2.0.0 完成判定**）

---

## 維持事項

- 既存 190 テスト全 PASS 維持
- **`operator-solo` モード（単画面）は v1.3.0 と完全同等**（変更なし）
- 致命バグ保護 5 件すべて完全維持
- カード幅 / Barlow Condensed / `<dialog>` flex 禁止
- `skills/v2-dual-screen.md`「§5 禁止事項」全項目
- `skills/cc-operation-pitfalls.md`「§1 絶対禁止事項」全項目
- CSP `script-src 'self'` 不変
- ポーリング禁止、イベント駆動
- src/ 配下は **package.json の version bump のみ**、本体実装は完全無変更

---

## 完了条件

- [ ] `feature/v2.0.0` ブランチで STEP 7 のコミット作成 + push
- [ ] `docs/specs.md` に v2.0.0 セクション追記
- [ ] `skills/timer-logic.md` に v2 不変条件追記
- [ ] `CHANGELOG.md` に v2.0.0 セクション
- [ ] `README.md` に v2.0.0 機能追記（任意、CC 判断）
- [ ] `package.json` の version: `1.3.0` → `2.0.0`
- [ ] `CLAUDE.md` の v2.0.0 状態を「完成」に更新
- [ ] `npm test` で **190 件全 PASS** 維持確認
- [ ] 致命バグ保護 5 件すべて影響なし確認
- [ ] 並列 sub-agent / Task 数を CC_REPORT で報告（4 体以上禁止）
- [ ] **承認③の PR 作成完了**（feature/v2.0.0 → main、STEP 6+7 まとめ）
- [ ] CC_REPORT.md に PR URL 記載
