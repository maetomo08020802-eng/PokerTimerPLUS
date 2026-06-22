export const meta = {
  name: 'cc-review',
  description: '完了レビュー: 構築士2(cc-kouchikushi2)がDoD/INVARIANTS/スコープを判定し completion_review.md を書き、独立した懐疑役がSQL/DBと認証/認可境界とスコープを反証チェックする。Phase2(Stop hook強制)を置き換えるワークフロー版。',
  phases: [
    { title: 'Locate', detail: '対象の完了レポートを特定' },
    { title: 'Review', detail: '構築士2が完了reviewを実施し completion_review を書く' },
    { title: 'Verify', detail: '独立した懐疑役がSQL/認証/スコープを反証チェック' },
  ],
}

// 判定基準(SSoT)の絶対パス。プロジェクト群の親フォルダにあるため絶対パス固定。
const SSOT = 'C:\\Users\\user\\Documents\\Claude\\Projects\\個人アシスタント\\docs\\review-rules.md'

// ---- Locate: 対象レポートを決める ----
phase('Locate')
let reportPath = (args && args.reportPath) ? args.reportPath : null
if (!reportPath) {
  log('reportPath 未指定 → .cc-reports/ から最新の完了レポートを探索します')
  const found = await agent(
    'カレントプロジェクトの `.cc-reports/` ディレクトリ内で最終更新が最も新しい *.md を Glob/Read で特定し、その絶対パスだけを返してください。' +
    '除外: README.md / _template*.md / *_review.md / *_completion_review.md。見つからなければ path に "NONE" を入れる。',
    {
      label: 'locate-report', phase: 'Locate',
      schema: {
        type: 'object',
        properties: { path: { type: 'string', description: '対象レポートの絶対パス。無ければ "NONE"' } },
        required: ['path'],
        additionalProperties: false,
      },
    }
  )
  reportPath = (found && found.path && found.path !== 'NONE') ? found.path : null
}
if (!reportPath) {
  log('完了レポートが見つかりませんでした。args:{reportPath:"<絶対パス>"} を渡して再実行してください。')
  return { error: 'report-not-found' }
}
log('対象レポート: ' + reportPath)

// ---- Review: 構築士2(cc-kouchikushi2)が従来どおり完了reviewを実施 ----
phase('Review')
const review = await agent(
  'あなたは cc-kouchikushi2(構築士2 サブエージェント版)です。あなたの v2 定義に厳密に従い、次の完了レポートのレビューを実施してください。\n' +
  '対象 report(絶対パス): ' + reportPath + '\n' +
  '判定基準(SSoT・絶対パス): ' + SSOT + '\n' +
  '必読は4点だけ: ①その SSoT(review-rules.md) ②対象 report ③対象 brief ④当プロジェクト CLAUDE.md の「レビュー必読 INVARIANTS」節(Grepで見出しを探し該当節のみ)。手順書全文や CLAUDE.md 全文は読まない。\n' +
  'DoD↔report 突合(根拠なき■は□扱いで差し戻し)、INVARIANTS 照合、スコープ照合(brief外の変更は理由を問う)、PROGRESS.md 更新確認を行ってください。\n' +
  '判定結果を `.cc-briefs/` に completion_review.md(承認時)または review.md(差し戻し時)として Write。6-B 表は Markdown 表形式で。\n' +
  'SQL/DDL/RLS/RPC/SECURITY DEFINER/DO $$/CREATE POLICY や認証/認可境界(auth/token/session/cookie/cors/jwt/service_role/redirect/CORS等)を含む場合は別格で精読し、確信が持てなければ escalate と明記。\n' +
  '最後に「書き出したファイルの絶対パス / 判定(承認 or 差し戻し or escalate) / 3行要約」をテキストで返してください。',
  { agentType: 'cc-kouchikushi2', label: 'kouchikushi2-review', phase: 'Review' }
)
if (!review) log('⚠ 構築士2レビューが返りませんでした(失敗または中断)。')

// ---- Verify: 独立した懐疑役が二次チェック(構築士2の盲点=SQL/認証を反証) ----
phase('Verify')
const verdict = await agent(
  'あなたは独立した懐疑的レビュアーです。先の構築士2レビューとは別人として、先入観なく、次の完了レポートの変更が ' +
  '①SQL/DB 意味論 ②認証/認可境界 ③スコープ(brief外の変更) の3点で安全かを「反証する気で」精読してください。\n' +
  '対象 report(絶対パス): ' + reportPath + '\n' +
  '必要なら report が参照する実ソースを Read/Grep で確認。少しでも穴・誤り・brief外変更の疑いがあれば flagged=true にする。\n' +
  '判定基準の参考(絶対パス): ' + SSOT + '\n' +
  '構築士2の結論(参考・鵜呑みにしない): ' + (review || '(取得できず)'),
  {
    label: 'adversarial-verify', phase: 'Verify',
    schema: {
      type: 'object',
      properties: {
        flagged: { type: 'boolean', description: '懸念があれば true' },
        escalate: { type: 'boolean', description: 'Cowork 構築士2 へ escalate すべきなら true' },
        concerns: { type: 'array', items: { type: 'string' }, description: '具体的な懸念(ファイル/行/理由)。無ければ空配列' },
        summary: { type: 'string', description: '二次チェックの3行以内の総括' },
      },
      required: ['flagged', 'escalate', 'concerns', 'summary'],
      additionalProperties: false,
    },
  }
)

log('二次チェック: ' + (verdict && verdict.flagged ? '⚠ 懸念あり' : 'OK') + (verdict && verdict.escalate ? ' / escalate推奨' : ''))

return {
  reportPath,
  review,
  verify: verdict,
}
