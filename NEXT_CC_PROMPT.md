# v2.0.3: P2〜P4 修正 + 残検証項目

新ブランチを main から切って作業:

```bash
git checkout main && git pull
git checkout -b feature/v2.0.3-cleanup
```

## タスク 1: 残提案項目 P2〜P4 修正

1. **P2**: `refreshPresetList` 末尾に「フィルタ後 option が無ければ draft クリア」追加（5 行 / renderer.js）
2. **P3**: `sanitizeBreakImages` の else 分岐で `cur.breakImages || []` 直接代入（1 行 / main.js）
3. **P4**: `app.on('will-quit')` の二重登録を 1 ハンドラに統合（5 行 / main.js）

各修正に対応する静的解析テストを `tests/v2-stabilization.test.js` 等に追加（または新規ファイル）。

## タスク 2: 残検証項目（実コードで再現するもののみ修正）

以下を順番にコードリーディング + 静的解析で確認:

- **L. PC スリープ復帰**: `powerMonitor.on('resume')` の処理経路、経過時間引継ぎ
- **M. PC 間データ移行**: JSON Export/Import、BOM 対応、バージョン互換性
- **N. アプリ再起動**: 設定ファイル保持、ランタイム永続化（C.1.8）の起動時復元

実コードで再現するバグがあれば最小修正、なければ「再現なし」と CC_REPORT.md に記載。

## 要件

- 既存 221 テストすべて PASS 維持
- 致命バグ保護 5 件は変更禁止
- 並列 sub-agent 最大 3 体
- 完了後 `gh pr create`（base: main / head: feature/v2.0.3-cleanup）
- CC_REPORT.md に結果と PR URL 記載
