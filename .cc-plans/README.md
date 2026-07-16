# .cc-plans/

CC (Claude Code) が Plan Mode で立てた計画を書き出すフォルダ。

## 運用ルール
- ファイル名: `YYYY-MM-DD_案件ID_短い作業名.md`
- 書き手: CC (ExitPlanMode と同時に書き出し)
- 読み手: CC構築士2 (前原から「Plan できた」と一言聞いたら最新を Read)
- このフォルダの中身は `.gitignore` 対象。`README.md` と `.gitkeep` のみコミット対象。

## 例
- `2026-05-25_v201-hotfix-audio_plan.md`
- `2026-06-01_v210-dual-screen-improvement_plan.md`

## Plan 書き出しフォーマット(2026-07-16 CLAUDE.md から移設)

Plan 書き出し時のフォーマット:
```
# Plan — YYYY-MM-DD 案件ID タイトル

## 状況（必要なら1〜2行）

## やること
1. 〜
2. 〜

## 触るファイル一覧（衝突回避のため必須）
- src/...
- tests/...

## 致命バグ保護 5 件への影響評価
- (影響あり/なし、ありの場合は具体的に)

## 並列起動予定の sub-agent / Task 数
- (0 or 数値)

## 追加制約（標準制約以外で必要なもののみ）

## 期待結果
```
