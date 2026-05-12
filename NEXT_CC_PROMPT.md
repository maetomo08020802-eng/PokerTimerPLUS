# NEXT_CC_PROMPT — v2.1.20-rc10（HDMI 抜き差し問題 構造的根本対策、並列調査 + Plan Mode + 実装）

## 【最重要】このプロンプト実行前のお願い

**Claude Code で `/clear` コマンドを実行してから本プロンプトを読み込むこと**。

`/clear` 後は以下を順に Read:

1. `poker-clock/CC_REPORT.md`（v2.1.20-rc9 完了報告）
2. `poker-clock/skills/cc-operation-pitfalls.md`（§1 公式 Agent Teams 上限 3 体 / §6 Plan Mode / §7）
3. `poker-clock/skills/root-cause-analysis.md`

## 推奨モデル

**Sonnet 4.6**。本タスクは **rc4〜rc9 で 5 連続失敗中の HDMI 抜き差し問題に対して構造的根本対策**を取る。**Plan Mode 必須**（実装前に構築士に方針確認）+ **並列 sub-agent 推奨**（最大 3 体まで、Agent Teams 公式上限遵守）。

---

## 構築士の判断と本フェーズの目的

### これまでの経緯（5 連続失敗）

| RC | 修正範囲 | 試験結果 | 真因経路 |
|---|---|---|---|
| rc4 | operator 側 PRE_START 復元 API 追加 | NG | 配信経路未接続（rc5 で判明）|
| rc5 | 配信経路追加（main 側 broadcast）| NG | totalMs cache 破壊（rc7 で判明）|
| rc7 | sanitization の cache merge | NG | applyTimerStateToTimer idle 経路の reset（rc8 で判明）|
| rc8 | idle 経路に PRE_START ガード | NG | applyTimerStateToTimer 他 3 経路の reset（rc9 で判明）|
| rc9 | 4 経路すべてに ガード網羅 | NG | **initialize 経路 line 7591 の reset（最新、まだ他経路の可能性あり）**|

毎回:
- 観測機構で真因を捉える ✅
- コード行レベルで特定 ✅
- 修正を入れる ✅
- **しかし別経路で再発**

→ ピンポイント修正アプローチは **「ガード抜け」の連鎖** を生んでいる。**構造的に reset 経路を一箇所で塞ぐ設計変更**が必要。

### 本フェーズ rc10 の目的

**PRE_START 復元成功後の自動キャンセル経路を構造的に完全遮断する**。具体的に:
1. **並列調査** で「PRE_START を消す可能性のある全経路」を網羅特定
2. **複数の修正方針案** を構築士に提示（最小 3 案、副作用評価付き）
3. **Plan Mode で構築士の方針承認を待つ**（実装前に必ず stop）
4. 承認された案で実装

ピンポイント修正の連鎖は禁止。「経路 N 個発見 → ガード N 個追加」ではなく、「**1 箇所で全経路を塞ぐ構造**」を目指す。

### v2.1.20-rc10 のリリース戦略（実機専用、配信なし）

- feature ブランチに commit + ローカルビルドのみ
- **main merge / tag / GitHub Release / git push: すべて禁止**
- `dist/pokertimerplus-setup-2.1.20-rc10.exe` を前原さん PC のみで実機テスト
- 計測機構（rc6-meas3）完全保持

---

## 実装フロー（Plan Mode 必須）

### Phase 1: 並列調査（sub-agent 最大 3 体、公式上限遵守）

CC は以下 3 領域を **並列 sub-agent 3 体** で同時調査する（cc-operation-pitfalls.md §1 公式 Agent Teams 上限）:

#### Sub-agent 1: timer.js 内の状態変更経路を完全網羅

調査対象:
- `timer.js` 全体（reset / cancelPreStart / pause / resume / startPreStart / restorePreStart / startAtLevel / advanceTimeBy / startBreak / start / その他全 export 関数）
- 各関数で `isPreStart = false` にする経路、`handlers.onPreStartCancel()` を発火する経路、`setState({status: IDLE})` を呼ぶ経路
- 内部状態（isPreStart / preStartTotalMs / targetTime / pausedRemainingMs / rafId）の変更タイミング

報告形式:
- 関数別の「PRE_START 状態を消す副作用」マップ（行番号付き）
- onPreStartCancel ハンドラの発火元一覧
- 「PRE_START 中に呼ばれると不整合を起こす経路」のリスク評価

#### Sub-agent 2: renderer.js 内の reset / handleReset / 初期化経路を完全網羅

調査対象:
- `renderer.js` 内の `timerReset()` / `cancelPreStart()` / `handleReset()` / `timerCancelPreStart()` 呼出全箇所
- `applyTimerStateToTimer` の 4 経路（rc8/rc9 でガード済、確認のみ）
- `initialize()` 関数の全体構造、`restoreActiveTimerStateFromStore`、`applyTournament`、その他初期化系関数
- HDMI 抜き差し時に発火する経路（`onRoleChanged` / `dual:state-sync` 受信時の各種ハンドラ）

報告形式:
- reset 系呼出全箇所一覧（applyTimerStateToTimer 内 4 経路 + 直接呼出 + handleReset 経由 + その他）
- それぞれの「PRE_START 中に呼ばれた時の挙動」評価
- 既存ガード（rc8/rc9）の有無

#### Sub-agent 3: main.js の publish / cache / IPC 経路を完全網羅

調査対象:
- `main.js` の `_dualStateCache.preStartState` を変更する全経路（`_publishDualState('preStartState', ...)` 呼出全箇所、IPC `dual:publish-pre-start-state` ハンドラ、その他）
- `mainWindow.webContents.send('dual:state-sync', ...)` の発火条件と timing
- `switchSoloToOperator` / `switchOperatorToSolo` 内の状態同期経路
- preload.js の dual API ラッパー全体

報告形式:
- preStartState cache を {isActive: false} に変更する経路一覧
- main → operator broadcast の race パターン
- rc5 / rc7 機構の動作確認

### Phase 2: 修正方針案の提示（構築士確認待ち、Plan Mode で stop）

3 sub-agent の調査結果を統合し、**最低 3 案** の修正方針を構築士に提示:

#### 案 A: timer.js の reset() 関数本体に PRE_START 中ガード追加（全網羅・最小侵襲）

- `reset()` 関数の冒頭に `if (isPreStart && _suppressResetDuringPreStart) return;` のような構造的ガード追加
- 全 reset 呼出経路を一箇所で塞ぐ
- 副作用: handleReset 経由のリセットボタン等、PRE_START 中の意図的リセットがブロックされる
- 対処: handleReset は `cancelPreStart()` を先に呼ぶ既存設計のため影響なし、または「明示的キャンセルフラグ」を渡す

#### 案 B: reset() に「フラグ引数」追加で呼出側から意図を明示

- `reset({allowDuringPreStart: false})` のような API 拡張
- handleReset / cancelPreStart は明示的に「PRE_START を消す」フラグで呼ぶ
- initialize / applyTimerStateToTimer は「PRE_START 残す」フラグで呼ぶ
- 副作用: API 変更だが既存呼出側はデフォルト引数で互換性確保可能
- 修正規模: 全 reset 呼出箇所の引数追加（約 10-15 箇所）

#### 案 C: PRE_START 復元直後の N 秒間 onPreStartCancel 抑制フラグ

- `applyOperatorPreStartState` 経由で復元成功した直後の N 秒（例: 5 秒）は onPreStartCancel 発火を抑制
- ハック的だが副作用最小（時間制限あり）
- 副作用: PRE_START 復元直後の N 秒間、本当に PRE_START をキャンセルしたい操作も無視される

#### 案 D 以降: sub-agent 調査結果から構築士判断で追加候補があれば提示

### Phase 3: 構築士の Plan 承認

CC は Plan Mode で**実装に進む前に必ず stop**し、構築士の方針承認を待つ。

承認後、CC は承認された案を実装する。

---

## 並列 sub-agent 起動の必須要件（公式準拠）

- **同時起動 3 体まで**（cc-operation-pitfalls.md §1 Agent Teams 上限）
- 各 sub-agent は **自己完結プロンプト**（このファイルの引用ではなく、明確な調査範囲指定）
- 各 sub-agent の報告は 300〜500 行で構造化（コード行根拠 + 全網羅証跡）
- **修正コードは sub-agent に書かせない**（調査・報告のみ）
- 並列 sub-agent 起動状況を CC_REPORT.md §9 で必ず報告

---

## 禁止事項（厳守）

- ❌ **Plan Mode をスキップして実装に直接進む**（必ず構築士の方針承認を待つ）
- ❌ **並列 sub-agent ≥ 4 体**（公式上限 3 体）
- ❌ **sub-agent に修正コードを書かせる**（調査のみ）
- ❌ **v2.1.20-rc9 / rc8 / rc7 / rc6-meas3 / rc5 / rc4 / rc3 / rc2 / rc1 機構**の touch（PRE_START 状態を消さない方向の修正のみ許可、既存ガードは保持）
- ❌ **v2.1.19 重さ根治機構**の touch
- ❌ 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構の touch
- ❌ **計測機構**の撤去
- ❌ **timer.js `restorePreStart` / `applyOperatorPreStartState` / `publishPreStartIfOperator` の機能改変**（観測ラベル追加のみ可）
- ❌ HANDOVER.md / project memory / `docs/CLAUDE_DESIGN_PROMPT.md` の編集
- ❌ スコープ外の追加実装（HDMI 抜き差し問題の構造的根本対策のみ、観測機構の追加最適化等は禁止）
- ❌ **main マージ / tag 作成 / GitHub Release 公開 / git push origin**（すべて禁止）

---

## 【Phase 3: 構築士承認】案 A 採用（2026-05-12 構築士確定）

CC_REPORT §3 で提示された 5 案のうち、**案 A（timer.js `reset()` に構造的 PRE_START 保護ガード追加）を単独で採用**。以下の詳細パラメータで実装すること:

### 採用パラメータ

| 項目 | 構築士確定値 |
|---|---|
| 引数名 | **`force`**（`force: true` = 強制リセット / `force: false` = PRE_START 中 no-op）|
| デフォルト値 | `force: true`（後方互換、既存 `timerReset()` 呼出は無変更で動作）|
| 返り値 | `true`（reset 実行）/ `false`（ガードで no-op）|
| 観測ラベル | `timer:reset:skip-during-prestart`（timer.js 内ガード発火時、データに `{ wasPreStart: true }` 含む）|
| 既存 rc8/rc9 4 経路ガード | **保持**（撤去しない、多層防御 + 経路識別ログ維持）|
| handleReset 内 `cancelPreStart()` 明示化 | **やらない**（現状の wasPreStart 経由維持、C.2.7-A 範囲最小変更）|

### Fix 1: timer.js `reset()` に `force` 引数追加

```js
// src/renderer/timer.js L120 修正後
export function reset(opts = {}) {
  const { force = true } = opts;
  // v2.1.20-rc10: PRE_START 中で force=false なら no-op（意図せぬ reset 経路から PRE_START を保護）
  if (!force && isPreStart) {
    // 観測ラベルは renderer 側で発火（timer.js は依存ゼロ維持）
    return false;
  }
  // ... 既存処理（無変更）...
  return true;
}
```

**重要設計判断**:
- timer.js から `window.api?.log?.write?.(...)` を直接呼ばない（timer.js は renderer-side だが window 依存を最小化、テスト性維持）
- 観測ラベルは**呼出側 renderer.js から発火**: `if (!timerReset({ force: false })) { window.api?.log?.write?.('timer:reset:skip-during-prestart', { ctx: '...' }); }`

### Fix 2: renderer.js の 5 経路で `{ force: false }` を渡す + ガード発火時ログ

以下 5 経路の `timerReset()` 呼出を `timerReset({ force: false })` に変更し、戻り値 false なら観測ラベル発火:

| # | 行 | コンテキスト | ctx 値 |
|---|---|---|---|
| 1 | 1634（既存 rc9 ガード内側）| applyTimerStateToTimer invalid-ts | 'applyTimerStateToTimer:invalid-ts' |
| 2 | 1664（既存 rc8 ガード内側）| applyTimerStateToTimer idle | 'applyTimerStateToTimer:idle' |
| 3 | 1694（既存 rc9 ガード内側）| applyTimerStateToTimer finished | 'applyTimerStateToTimer:finished' |
| 4 | 1725（既存 rc9 ガード内側）| applyTimerStateToTimer no-levels | 'applyTimerStateToTimer:no-levels' |
| 5 | **7591** | **initialize 復元失敗 fallback** | **'initialize:restoredFromTimerState-false'** |

**重要**: rc8/rc9 ガードは**保持**（撤去しない）。既存ガードを通過した後の `timerReset()` 呼出を `timerReset({ force: false })` に変更するだけ。**多層防御**:
- 第 1 層: rc8/rc9 の `isPreStartActive()` ガード（既存）→ ログラベル `skip-reset-during-prestart`
- 第 2 層: 案 A の `force: false` 引数（新規）→ ログラベル `timer:reset:skip-during-prestart`
- ガード抜けが起きても第 2 層で確実に塞ぐ + どの経路で発火したか観測可能

### Fix 3: renderer.js の 6 経路は touch なし（意図的リセット経路、既存挙動維持）

| # | 行 | コンテキスト |
|---|---|---|
| 1 | 7292 | handleReset（リセットボタン）|
| 2 | 7301 | resetBlindProgressOnly（ブラインド構造変更時）|
| 3 | 4535 | handleTournamentListReset（リスト「リセット」ボタン）|
| 4 | 4725 | _handleTournamentNewImpl（新規作成）|
| 5 | 4808 | _handleTournamentDuplicateImpl（複製）|
| 6 | 3186 | applyOperatorPreStartState payload.isActive=false（timerCancelPreStart 使用、別関数）|

これら 6 経路は意図的キャンセル経路、**`force: true` デフォルト**で従来通り動作。

### Fix 4: package.json version bump + テスト追記

- `package.json.version`: `2.1.20-rc9` → `2.1.20-rc10`
- `package.json.scripts.test` 末尾に `node tests/v248-reset-structural-guard.test.js` を追記
- 既存 54 テストの `'2.1.20-rc9'` リテラル → `'2.1.20-rc10'` を Node ワンライナーで機械置換（残存 0 件）

### Fix 5: 新規テスト `tests/v248-reset-structural-guard.test.js`（10 件）

| # | 検証項目 |
|---|---|
| T1 | `package.json.version === '2.1.20-rc10'` |
| T2 | timer.js `reset(opts = {})` シグネチャ + `const { force = true }` + `if (!force && isPreStart) return false;` ガード存在 |
| T3 | timer.js `reset()` のデフォルト動作（force=true）で従来挙動（wasPreStart 経由 onPreStartCancel 発火）が保持されている |
| T4 | renderer.js applyTimerStateToTimer 4 経路すべてで `timerReset({ force: false })` 呼出 + 戻り値判定 + `timer:reset:skip-during-prestart` ラベル発火経路 |
| T5 | renderer.js L7591 initialize 経路で `timerReset({ force: false })` 呼出 + 同ラベル発火経路 |
| T6 | renderer.js handleReset / resetBlindProgressOnly / handleTournamentListReset / _handleTournamentNewImpl / _handleTournamentDuplicateImpl の 5 経路は `timerReset()` 引数なし呼出を維持（touch なし）|
| T7 | rc8/rc9 既存 4 経路 `isPreStartActive()` ガードは**保持**（多層防御、撤去されていない）|
| T8 | rc1〜rc9 機構保持 + 致命バグ保護 5 件 |
| T9 | 計測機構保持（meas1+meas2+症状確証 4+rc2/rc4/rc5/meas3/rc7/rc8/rc9 ラベル + 新規 rc10 `timer:reset:skip-during-prestart` 5 ctx 値）|
| T10 | timer.js 内に `window.api?.log?.write?` 呼出が**含まれていない**こと（依存ゼロ維持）|

### Fix 6: CHANGELOG.md `[2.1.20-rc10] - 2026-05-12` セクション追加

`[2.1.20-rc9]` セクション**上**に新規セクション挿入:

```markdown
## [2.1.20-rc10] - 2026-05-12

PokerTimerPLUS+ v2.1.20-rc10 試験ビルド（前原さん実機専用、配布なし）。rc4〜rc9 で 5 連続失敗中の HDMI 抜き差し問題に対し、**構造的根本対策**を実施。並列 sub-agent 3 体で「PRE_START を消す全経路」を網羅特定 → timer.js `reset()` 関数本体に `force` フラグ引数を追加し、意図せぬ reset 経路 5 箇所を一括ガード。

### Fixed
- **timer.js `reset()` に `force` フラグ引数追加**（デフォルト `true`、後方互換完全）: `force: false` 指定 + `isPreStart === true` の場合は no-op で `false` 返却、PRE_START 状態を保護
- **意図せぬ reset 経路 5 箇所に `{ force: false }` を適用**: applyTimerStateToTimer 4 経路（invalid-ts / idle / finished / no-levels）+ initialize 復元失敗 fallback（L7591）
- **多層防御**: rc8/rc9 既存ガード（`isPreStartActive()` チェック）は保持、ガード抜けが起きても timer.js 内 `force` 引数で確実に塞ぐ
- 新規確証ラベル `timer:reset:skip-during-prestart`（5 ctx 値: 'applyTimerStateToTimer:invalid-ts' / ':idle' / ':finished' / ':no-levels' / 'initialize:restoredFromTimerState-false'）

### Maintained
- v2.1.20-rc9 (applyTimerStateToTimer 4 経路 PRE_START ガード) 完全保持、撤去せず多層防御として維持
- v2.1.20-rc8 (idle 経路ガード) 完全保持
- v2.1.20-rc7 / rc6-meas3 / rc5 / rc4 / rc3 / rc2 / rc1 機構 完全保持
- v2.1.19 重さ根治機構 + 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構 完全保持
- 意図的リセット経路 6 箇所（handleReset / resetBlindProgressOnly / handleTournamentListReset / 新規 / 複製 / applyOperatorPreStartState）は `force: true` デフォルトで従来動作維持

### Notes
- 案 D（timer.js state ↔ isPreStart 乖離防御）は本フェーズ範囲外（HDMI 問題と独立した潜在欠陥、別フェーズで対処）
- 案 E（main.js 観測強化）は本フェーズ範囲外（案 A 単独で根治見込み）
- timer.js は `window.api?.log?.write?` を呼ばない設計を維持（依存ゼロ、テスト性維持）。観測ラベルは呼出側 renderer.js から発火
```

### CC への追加指示

- Phase 3 セクションを Read 後、上記 Fix 1〜6 を順次実装
- 並列 sub-agent は本実装フェーズでは不要（修正方針確定済の機械的反映、Plan Mode も不要）
- feature ブランチ: `feature/v2.1.20-rc10-structural-prestart-protection` を**新規切る**（rc9 commit `63f8d5c` から分岐）
- commit message: `v2.1.20-rc10: timer.js reset に force フラグ追加で PRE_START を構造的保護（HDMI 抜き差し問題 真因根治 第 4 弾）`
- 副次修正（既存テスト regex 調整等）が必要なら spec 範囲内として実施可、CC_REPORT §10 で報告

---

## CC_REPORT.md 必須記載項目

1. **§1 サマリ**（バージョン / 修正ファイル数 / 並列 sub-agent 数 / テスト件数 / ビルド成果物）
2. **§2 並列調査結果**: Sub-agent 1 / 2 / 3 の報告サマリ（各 50〜80 行）+ 統合した「PRE_START を消す全経路マップ」
3. **§3 修正方針 3 案以上の提示と評価**: 案 A / B / C / その他、各案の修正規模・副作用評価・確証度を比較表で
4. **§4 構築士承認状況**: Plan Mode で stop し構築士が承認した案を明記（承認後の実装内容）
5. **§5 各 Fix の実装内容**（承認案の diff、行数、新規ラベル）
6. **§6 rc1〜rc9 機構保持確認**: grep 証跡
7. **§7 計測機構保持確認**: grep 証跡 + 新規ラベル（あれば）
8. **§8 テスト結果**: 全テスト件数（rc9 1096 + 新規テスト N 件、PASS / FAIL / SKIP）
9. **§9 ビルド成果物**: `dist/pokertimerplus-setup-2.1.20-rc10.exe` + `dist/latest.yml`
10. **§10 副作用評価結果**
11. **§11 並列 sub-agent / Task 数報告**（最大 3 体明記、Plan Mode 使用明記）
12. **§12 構築士への質問・懸念事項**
13. **§13 オーナー向け確認手順**: 下記表
14. **§14 git 状態**: feature ブランチ commit hash、main / tag / Release / push は**未実施であることを明記**

### 試験項目別の前原さん確認手順（v2.1.20-rc10 試験ビルド、実機専用、最重要）

| # | 操作 | 期待結果 |
|---|---|---|
| 1 | `dist/pokertimerplus-setup-2.1.20-rc10.exe` を実機 PC で上書きインストール → 起動（30〜60 秒待つ）| バージョン表示 `2.1.20-rc10`、画面右下に「計測ビルド」黄色バッジ |
| 2 | **【最重要】PRE_START カウントダウン中に HDMI ケーブル抜く → 30 秒 → 挿し直す**（rc3〜rc9 で操作不可になった同じシナリオ）| hall 復帰後、**手元 PC で Space キーを押すと一時停止が正常に効く** + **トーナメントが消えない** + **PRE_START カウントダウンが継続している** |
| 3 | もう一度 Space キーを押す | 一時停止解除（カウントダウン再開）|
| 4 | **【重要】通常のリセットボタン**（PRE_START 中・通常進行中の両方で）| リセットが正常動作（rc10 で構造変更による副作用がないことの確認）|
| 5 | rc3〜rc9 試験項目（スライドショー始動 / 2 倍表示なし / 軽量化 / 症状 1/2 修正）| すべて維持 |
| 6 | 各操作後 Ctrl+Shift+L でログ採取 + ログフォルダ全体（rolling-current / priority-events / hdmi-snapshot-*）を Claude に送付 | rc10 修正の新規ラベル発火確認 + `state:transition` PRE_START → IDLE が HDMI 挿し直し時に**発火していない**こと |

### 確認の優先順位

- **最重要**: HDMI 抜き差し後の Space キー一時停止 + トーナメント維持 + PRE_START 継続
- **重要**: リセットボタンの正常動作（構造変更による副作用がないことの確認）
- **重要**: ログ内 rc10 修正の新規ラベル発火 + PRE_START→IDLE 遷移がないこと
- 通常: rc9 までの全機能維持

### 次フェーズ予告

期待値達成 → **rc11 で計測機構撤去 + バージョン文字列 rc10 → v2.2.1 + main マージ + tag v2.2.1 + GitHub Release 公開**

期待値未達成 → 構造的設計の見直し、もしくは v2.1.19 維持で v2.3.0 以降に延期

### Known Issues（rc10 範囲外、v2.2.1 リリース後に対処予定）

- Op 8 で 1952ms long-task（rc1 試験時、再現性低）
- `state:transition` ログが operator + hall の両方で記録される二重出力（無害）
- subscribe 残り 23 Hz（rc1 目標 5 Hz 未達）

---

## feature ブランチ commit + ローカルビルド（main / tag / Release / push は禁止）

CC は以下を実施:

- 作業ブランチ: `feature/v2.1.20-rc10-structural-prestart-protection`
- commit message: `v2.1.20-rc10: HDMI 抜き差し問題 構造的根本対策（並列調査 + Plan Mode 経由で構築士承認案を実装）`
- ローカルビルド: `dist/pokertimerplus-setup-2.1.20-rc10.exe` 生成
- **main マージ・tag・Release・git push: すべて禁止**

CC_REPORT §14 に「main / tag / Release / git push すべて未実施」を明記。

---

## CC 実行フロー要約（重要）

1. `/clear` → このプロンプト + CC_REPORT.md + cc-operation-pitfalls.md + root-cause-analysis.md を Read
2. **並列 sub-agent 3 体起動**（Sub-agent 1 / 2 / 3）で網羅調査
3. 3 sub-agent の報告を統合 → 「PRE_START を消す全経路マップ」作成
4. **修正方針 3 案以上を提示**（CC_REPORT.md §3 に記載）
5. **Plan Mode で stop** → 構築士の方針承認を待つ
6. 構築士承認後、承認案を実装
7. ビルド + テスト + CC_REPORT.md 完成 + commit（push は禁止）

各 sub-agent の調査範囲は本ファイル「Phase 1」セクションに明記済。修正方針案の候補は「Phase 2」セクションに明記済（A / B / C は構築士の例示、CC は sub-agent 調査結果から追加案を提示してよい）。
