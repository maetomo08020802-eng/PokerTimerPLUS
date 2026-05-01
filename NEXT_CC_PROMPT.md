# v2.0.2: 残課題対応（軽量）

新ブランチを main から切って作業:

```bash
git checkout main && git pull
git checkout -b feature/v2.0.2-followup
```

タスク:

1. **dual:operator-action ハンドラのデッドコード削除**（main.js）
   - validate して `{ok:true}` を返すだけの未使用コードを削除
   - 削除に伴う関連テスト調整（既存テストが該当する場合）

2. **残提案項目（実装しない、保留記載）**
   - P2: preset フィルタ不整合
   - P3: sanitize else 分岐
   - P4: will-quit 二重登録
   - CC_REPORT.md に「次フェーズで構築士判断」として記載のみ

要件:
- 既存 221 テストすべて PASS 維持
- 致命バグ保護 5 件は変更禁止
- 並列 sub-agent 最大 3 体
- 完了後、`gh pr create` で PR 作成（base: main / head: feature/v2.0.2-followup）
- CC_REPORT.md に結果と PR URL 記載
