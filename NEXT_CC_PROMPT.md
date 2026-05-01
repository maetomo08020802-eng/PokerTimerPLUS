# v2.0.4: 残検証項目を一気につぶす（D / E / I / J / K）

新ブランチを main から切って作業:

```bash
git checkout main && git pull
git checkout -b feature/v2.0.4-coverage
```

## タスク: 残 5 項目を並列調査（Agent Teams 推奨 3 体まで）

並列 sub-agent で担当を分けて静的解析:

- **Agent 1**: 検証項目 D + E
  - **D. トーナメント新規作成 / 編集 / 削除**: handleTournamentNew / Duplicate / Delete / Save、IDLE/RUNNING/PAUSED 各状態
  - **E. ブラインド構造の編集 / 適用**: 同梱プリセットの builtin 保護、複製して編集、IDLE/PAUSED/RUNNING の適用分岐、ブレイクチェック ON/OFF
- **Agent 2**: 検証項目 I + J
  - **I. スライドショー画像**: PNG/JPEG/WebP / 5MB 超 / 20 枚最大 / 150MB 警告 / BREAK 30 秒遅延 / 60 秒前自動復帰
  - **J. 設定タブ各項目**: venueName 正規表現、通貨記号、時計フォント、背景プリセット 8 種 + カスタム画像
- **Agent 3**: 検証項目 K
  - **K. ショートカットキー**: Space / R / Enter / Esc 等、IME 中の誤発火、ダイアログ open 時のグローバル発火防止

各 Agent には以下を必ず prompt に include:
- 担当範囲の明確指定
- 「実コードで再現するもののみ報告」
- 「致命バグ保護 5 件 / 不変条件には触れない」
- 出力形式（優先度 高/中/低、再現条件、修正方針）

## 修正

- 再現するバグのみ修正（C.2.6 教訓: 10 件中 9 件再現せず）
- 修正範囲 >100 行 / 設計判断要は CC_REPORT に保留として記載
- 各 Fix に対応する静的解析テスト追加（`tests/v2-coverage.test.js` 新規 or 既存に追加）

## 要件

- 既存 229 テストすべて PASS 維持
- 致命バグ保護 5 件は変更禁止
- 並列 sub-agent 最大 3 体（公式 Agent Teams 推奨）
- 完了後 `gh pr create`（base: main / head: feature/v2.0.4-coverage）
- CC_REPORT.md に結果と PR URL 記載
