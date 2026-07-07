# cc-review 懐疑役(Verify)の観点 — poker-clock 専用(2026-07-07 新設)

cc-review2(ユーザーレベル共通版ワークフロー)の懐疑役はこの観点で反証チェックする:

1. **INVARIANTS 抵触**: 当プロジェクト CLAUDE.md の「レビュー必読 INVARIANTS」節を Grep で探して該当節を読み、report の変更が致命ルール(致命バグ保護5件を含む)に触れていないか。
2. **スコープ**: brief 外のファイル変更・ついで実装が無いか。
3. **リリース整合**: version・git tag・CHANGELOG・配布物(dist/build)の記述と実態が一致しているか(report の主張と git log/tag の突合)。
4. **SQL/DB・認証**: 本アプリでは基本なし。report/plan に SQL・認証境界が含まれていたら、それ自体を flagged にして理由を問う。
