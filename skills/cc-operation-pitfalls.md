# skills/cc-operation-pitfalls.md - CC 運用アンチパターン排除ガイド（公式ドキュメント準拠）

## 適用範囲
**全 NEXT_CC_PROMPT.md 共通の絶対遵守事項**。CC は本ファイルを毎フェーズの開始時に Read tool で読込み、運用ルールに違反していないか自己検査すること。

参照元: docs.claude.com / docs.anthropic.com / code.claude.com の公式ドキュメント（2026-05-01 時点調査）。

---

## 1. 絶対禁止事項（破った場合は採点減点 + 即停止）

### 1.1 並列 sub-agent / Task は 3 体以下
- **同時起動できる sub-agent / Task は最大 3 体まで**
- 公式 Agent Teams 推奨数（3〜5 teammates）の安全側（3 体）を採用
- 4 体以上の並列起動は context 統合難易度・レート制限・実行効率の観点で逆効果
- 1 タスクで 4 件以上の調査が必要な場合、段階分割（3 体ずつ実行 → 結果統合 → 次の 3 体）

> 出典: [Orchestrate teams of Claude Code sessions](https://code.claude.com/docs/en/agent-teams)

### 1.2 「念のため」のコード追加禁止
- 特定テスト入力だけで動く workaround / hard-coded 値 / 過剰な防御コードを書かない
- 汎用解で対処、または「再現せず」として実装しない
- スコープ越えの最大要因

> 出典: [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)

### 1.3 NEXT_CC_PROMPT 指示外の実装禁止
- 発見した追加タスクは **CC_REPORT.md「構築士への質問」に提案として記載のみ**
- 致命級バグ発見時は CC_REPORT 冒頭で警告（自動修正禁止）
- 構築士の承認後、次フェーズで実装

### 1.4 同じバグで 2 回修正を試みる前に `/clear` 検討
- 同じ問題で 2 回以上修正試行 → context 肥大化のサイン
- CC_REPORT に「context 肥大化の可能性」を明記、構築士に判断を仰ぐ

> 出典: [Best Practices for Claude Code](https://code.claude.com/docs/en/best-practices)

### 1.5 既存致命バグ保護への影響変更禁止
本プロジェクト固有の絶対不変条件:
- `resetBlindProgressOnly`（C.2.7-A）
- `timerState` destructure 除外（C.2.7-D Fix 3）
- `ensureEditorEditableState` 4 重防御（C.1-A2 + C.1.2-bugfix + C.1.4-fix1）
- AudioContext resume in `_play()`（C.1.7）
- runtime 永続化 8 箇所（C.1.8）

これらの関数本体・呼出経路には触れない。役割ガード等の「呼出側」追加のみ可。

---

## 2. 推奨運用（積極的に従う）

### 2.1 Plan Mode 活用（複数ファイル変更時）
- 3 ファイル以上の変更が必要な場合、実装前に plan を立てる
- 不確実なアプローチは plan で構築士に確認を仰ぐ
- 「やってみてダメなら戻す」より「先に設計してから 1 回で動かす」

> 出典: [Best Practices for Claude Code](https://code.claude.com/docs/en/best-practices)

### 2.2 Sub-agent は context isolation 目的でのみ使う
- 高ボリュームな操作（test run、doc fetch、log processing、大量ファイル grep）は sub-agent に delegate
- 親 session には **summary のみ** 受け取り、生 output を蓄積させない
- 小さな修正（typo / log 1 行追加 / 変数リネーム）に sub-agent を使わない（overhead が逆効果）

> 出典: [Create custom subagents](https://code.claude.com/docs/en/sub-agents)

### 2.3 Sub-agent への情報渡しは prompt 文字列のみ
- 親の会話履歴は子に見えない
- ファイルパス・エラー内容・決定事項を **明示的に prompt に include**
- 「文脈察してくれるはず」は失敗の元

> 出典: [Subagents in the SDK](https://platform.claude.com/docs/en/agent-sdk/subagents)

### 2.4 Context 監視を習慣化
- 大規模変更時は CC_REPORT に **「現在の context 消費率（推定）」** を記載
- 70% 超過したら、次フェーズ開始前に新規セッション化を構築士に提案

### 2.5 Tight feedback loop 維持
- 同一エラーが 2 回続いたら戦略変更（同じ修正を繰り返さない）
- テスト失敗 → 原因分析 → 修正 → 再テストのループは 1 サイクルで決める

---

## 3. ファイルサイズ制約

### 3.1 CLAUDE.md は 200 行以下を厳守
- 200 行超で context 消費増加 + 遵守率低下（公式記述）
- 詳細は skills/ 配下に分離

> 出典: [Best Practices for Claude Code](https://code.claude.com/docs/en/best-practices)

### 3.2 SKILL.md（個別 skill）は 500 行以下
- 500 行超で性能低下
- 大きい skill は複数ファイルに分割

> 出典: [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### 3.3 NEXT_CC_PROMPT.md は 250 行以下を目安
- 大規模 STEP でも 250 行を超えるなら STEP を分割する判断
- 過度に詳細な指示はかえって遵守率を下げる

---

## 4. CC_REPORT.md フォーマット強化（公式準拠）

既存フォーマットに加えて、以下を必須化:

### 4.1 致命バグ保護への影響評価セクション
本ガイド §1.5 の 5 件すべてについて「影響なし / 要注意 / 影響あり」を明記。「影響あり」の場合は構築士判断を仰ぐ。

### 4.2 並列起動した sub-agent / Task 数の報告
- 0 体: 直接実行
- 1〜3 体: 並列実行 OK
- 4 体以上: **公式推奨違反、CC_REPORT 冒頭で警告 + 設計見直し提案**

### 4.3 context 消費の自己申告（大規模 STEP のみ）
1000 行超の変更を伴う STEP 完了時、CC_REPORT 末尾に「現在の context 消費（推定 X%）」を記載。

---

## 5. 構築士採点への影響

本ガイドの違反は採点に直接反映:
- §1.1〜1.5（絶対禁止）違反 → 指示忠実性 30 点中、最大 25 点減点
- §2.x（推奨運用）軽視 → 実装精度 25 点中、最大 10 点減点
- §3.x（ファイルサイズ）違反 → 副作用配慮 15 点中、最大 5 点減点

---

## 6. NEXT_CC_PROMPT.md 禁止事項テンプレ（スコープ越え再発防止）

### 6.1 背景
肯定形「○○を Fix」のみの指示書では、CC が親切心で関連箇所を勝手に直す事故が起きやすい（C.2.7-audit-fix の事例: 構築士の指示は 1 件、CC が 6 件を即時修正）。指示書のフォーマットを「Fix する範囲」と「触らない範囲」のペアで明示することで再発を抑制する。

### 6.2 標準フォーマット
すべての NEXT_CC_PROMPT.md には以下の 2 ブロックを冒頭に**ペアで**記載する:

```
## ■ 今回 Fix する範囲（ホワイトリスト）
- Fix-1: <具体的な修正内容>
- Fix-2: ...

## ■ 今回 触ってはいけない範囲（ブラックリスト）
- 致命バグ保護 5 件（cc-operation-pitfalls.md §1.5 参照）
- 上記 Fix 項目以外の改善・最適化・リファクタ
- 新規テストの自発追加（指示があった場合のみ）
- 発見した別問題は CC_REPORT「構築士への質問」に提案として記載のみ
```

### 6.3 致命級バグ発見時の例外
CC が調査中に致命級バグを発見した場合のみ、CC_REPORT 冒頭に **🚨警告** セクションを追加して報告する。実装はせず、構築士判断を仰ぐ。

---

## 7. モデル切替判断チェックリスト（AUP 事故再発防止）

### 7.1 背景
2026-05-01 に Opus 4.6 で AUP False Positive が 60 時間以上継続発症する事故が発生。Sonnet 4.6 をデフォルトとするが、いつ Opus に切替えるかの基準がなく判断が属人化していた。

### 7.2 5 行チェックリスト
1. **デフォルトは Sonnet 4.6**（コスト最適 + AUP 検知が緩い）
2. Sonnet で 1 時間以内にテスト全通過 → **Sonnet 続行**
3. 3 ファイル超の大改修 + 設計判断複数回 → Opus 検討、ただし Plan Mode で先に設計確認
4. AUP エラー発生 → **即 Sonnet に戻す**（時間待ちは無効、60 時間以上継続事例あり）
5. 月コスト超過の兆し → Sonnet に戻す

### 7.3 切替方法
Claude Code Desktop で `/model claude-sonnet-4-6` または `/model claude-opus-4-6` を実行。NEXT_CC_PROMPT.md の冒頭に推奨モデルを明記すると、構築士からも追跡しやすい。

---

## 8. 参照リンク（公式）

| トピック | URL |
| --- | --- |
| Best Practices | https://code.claude.com/docs/en/best-practices |
| Sub-agents | https://code.claude.com/docs/en/sub-agents |
| Agent Teams | https://code.claude.com/docs/en/agent-teams |
| Common workflows | https://code.claude.com/docs/en/common-workflows |
| Prompting best practices | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices |
| Context engineering | https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools |
| Skill authoring | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices |

CC は判断に迷ったら公式ドキュメントを直接参照すること。
