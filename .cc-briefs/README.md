# .cc-briefs/

CC構築士2 が CC (Claude Code) に渡す作業指示書を置くフォルダ。

## 役割
- 各 STEP / 各タスクの「**案件固有の指示**」を簡潔に記載
- 共通ルール(運用フロー・標準制約・禁止事項・致命バグ保護・完了報告フォーマット)は **CLAUDE.md** に書く。本フォルダには書かない(重複させない)

## 運用ルール
- ファイル名: `YYYY-MM-DD_案件ID_短い作業名_brief.md`
  - STEP 形式の案件は `..._stepN_brief.md`
- 書き手: CC構築士2
- 読み手: CC
- このフォルダの中身は `.gitignore` 対象。`README.md` / `.gitkeep` / `_template.md` のみコミット対象

## CC への口頭指示パターン
前原(オーナー)が CC に渡す指示は超短くなる:

```
.cc-briefs/2026-05-23_v210-prize-pool-refactor_step5_brief.md を読んで Plan Mode で進めて
```

または

```
.cc-briefs/...step5_brief.md の通り、実装フェーズに進んで
```

## CC が brief を読んだら必ずやること
1. brief 冒頭の「直近状態」を確認(ブランチ・直前 commit・直前 STEP の報告 md)
2. CLAUDE.md の「CC 作業フロー(運用ルール)」セクションを必ず先に読む(共通ルール参照)
3. 該当案件の `.cc-plans/...plan.md`(過去 STEP)を必要に応じて読む
4. brief の指示に従って Plan Mode → .cc-plans/ に書き出し → 承認待ち → 実装 → .cc-reports/ に書き出し

## 例: STEP 5 用の brief(参考)
`2026-05-23_v210-prize-pool-refactor_step5_brief.md` を参照
