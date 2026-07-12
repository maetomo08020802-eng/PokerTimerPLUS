---
paths:
  - "src/renderer/**"
---

<!-- CLAUDE.md から逐語移設(2026-07-12 GO#7)。本文は移設時点の逐語 -->

### 標準制約（毎回適用、明記不要）
- skills/ui-design.md は廃止、参照禁止（ui-tokens.md / ui-layout.md / ui-components.md / ui-states.md を参照）
- レイアウトシフト撲滅 5原則維持（ui-layout.md）
- 既存実装を破壊しない
- 自動測定 `__autoCheck()` で drift 0 維持
- transform: scale 禁止（layout計算外で overlap の元）
- branding.md §15 ブランディング保護を遵守
- bottom-bar / marquee は flex column 配置（position: fixed 禁止）
- カード幅 v1.x は 42vw / 32vw、v2.x は 54vw / 46vw 固定維持

### 入力中保護（2026-04-29 確定、v1.2.0）
- DOM 再構築（`renderBlindsTable` / `applyTournament` / `renderTournamentList` / `renderPayoutsEditor` 等）時は必ず `isUserTypingInInput()` 統一ヘルパでガード
- ガード対象: text / number / textarea / contentEditable 等の typing 系入力フィールド（checkbox / radio / button は除外）
- ガード適用箇所: 1 秒ごと再描画されるリスト系、フォーム同期系、テーブル再構築系
- 違反すると入力中のフォーカス喪失・打鍵中の値消失の重大 UX バグになる（fix9 で確立、再発禁止）

### 編集モード readonly 解除（2026-04-30 追加、v1.2.0）
- 「複製して編集」「新規作成」ハンドラでは `ensureEditorEditableState()` を**同期 + RAF 内で 2 回**呼ぶ
- 防御的多重化により readonly 残存バグの再発防止（C.1-A2 で確立）
- `setBlindsTableReadonly(false)` 経路で `readonly` 属性も明示クリア（CSS との整合）

### tournamentRuntime 不変条件（2026-04-30 確定、v1.2.0）
- 「ブラインド構造を変えても tournamentRuntime（プレイヤー人数・リエントリー・アドオン）は絶対に消えない」
- `handleReset()` は明示的「タイマーリセット」ボタン経由のみ（runtime 含む完全リセット）
- ブラインド適用系（保存して適用→リセット / handlePresetApply の reset）は `resetBlindProgressOnly()` を使う
- `tests/runtime-preservation.test.js` で静的解析により担保（C.2.7-A 致命バグ 8-8 修正）
