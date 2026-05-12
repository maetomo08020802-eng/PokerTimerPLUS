# CC_REPORT — 2026-05-12 v2.1.20-rc10 timer.js reset に force フラグ追加で PRE_START を構造的保護（HDMI 抜き差し問題 真因根治 第 4 弾）

## §1 サマリ

| 項目 | 値 |
|---|---|
| バージョン | `2.1.20-rc9` → **`2.1.20-rc10`** |
| フェーズ | **Phase 1 並列調査 → Phase 2 修正方針 5 案提示 → Phase 3 構築士承認（案 A 単独採用） → 実装完了** |
| 並列 sub-agent 数 | **3 体（Phase 1 調査のみ、本実装は機械的反映で 0 体）** |
| 修正ファイル数 | **63 ファイル**（timer.js + renderer.js + package.json + CHANGELOG.md + 既存テスト 59 ファイル + v248 新規）|
| テスト件数 | **1106 PASS / 0 FAIL / 21 SKIP**（rc9 1096 + v248 新規 10 件）|
| ビルド成果物 | `dist/pokertimerplus-setup-2.1.20-rc10.exe` 83,018,701 B |
| feature ブランチ | `feature/v2.1.20-rc10-structural-prestart-protection` commit `8995a7b`（rc9 `63f8d5c` から分岐）|
| main マージ / tag / Release / push | **すべて未実施**（spec 禁止条項に準拠）|

### rc10 の目的（HDMI 抜き差し問題 構造的根本対策、5 連続失敗中のピンポイント連鎖を断つ）

rc4〜rc9 で 5 連続失敗中の HDMI 抜き差し race に対し、**timer.js `reset()` 関数本体に `force` フラグ引数を追加**して意図せぬ reset 経路を一箇所で網羅遮断する。並列 sub-agent 3 体で「PRE_START を消す全経路」を網羅特定後、構築士が 5 案の中から**案 A 単独採用**を確定 → Phase 3 spec に従い機械的に実装。

#### 多層防御アーキテクチャ

| 層 | 機構 | 経路数 |
|---|---|---|
| **第 1 層** | rc8/rc9 既存 `isPreStartActive()` ガード（renderer.js 内、経路識別 trigger 4 種別ログ）| 4 経路 |
| **第 2 層** | rc10 新規 `timer.js reset({ force: false })` 構造的ガード | **全 reset 呼出（11 経路中 5 経路）** |
| ガード抜け検知 | rc10 新規ラベル `timer:reset:skip-during-prestart`（5 ctx 値で発火経路識別）| 5 ctx |

---

## §2 並列調査結果（Phase 1 サマリ）

3 sub-agent（Explore Agent）で 3 領域を同時調査、各報告 300〜600 行。

### Sub-agent 1: timer.js（438 行）

| 検出経路 | 行 | クリア対象 | onPreStartCancel 発火 |
|---|---|---|---|
| `reset()` | L120-L141 | isPreStart/preStartTotalMs/pausedRemainingMs/targetTime | wasPreStart 経由 |
| `cancelPreStart()` | L216-L221 | reset 経由（冪等設計）| 明示発火 |
| `preStartTick()` 自然終了 | L380-L398 | RAF タイムアウト | 自然遷移 |
| `advancePreStartBy()` 時間 0 到達 | L323-L350 | 手動進行満了 | 自然遷移 |
| **state ↔ isPreStart 乖離リスク**（`advanceTimeBy` / `advanceToNextLevel` で state=IDLE だが isPreStart 未クリア）| L256 / L432 | ⚠️ 案 D 候補（rc10 範囲外）| ‐ |

### Sub-agent 2: renderer.js（7881 行）

`timerReset()` 呼出 **11 箇所** 完全特定:

| # | 行 | 経路 | 既存ガード | rc10 修正 |
|---|---|---|---|---|
| 1 | 1634 | applyTimerStateToTimer invalid-ts | rc9 | ✅ `{force: false}` |
| 2 | 1664 | applyTimerStateToTimer idle | rc8 | ✅ `{force: false}` |
| 3 | 1694 | applyTimerStateToTimer finished | rc9 | ✅ `{force: false}` |
| 4 | 1725 | applyTimerStateToTimer no-levels | rc9 | ✅ `{force: false}` |
| 5 | **7603** | **initialize 復元失敗 fallback** | **なし** | ✅ **`{force: false}`（rc10 真因経路）** |
| 6-10 | 7292/7301/4535/4725/4808 | handleReset / resetBlindProgressOnly / リスト「リセット」 / 新規 / 複製 | 意図的 | touch なし（force=true デフォルト維持）|
| 11 | 3186 | applyOperatorPreStartState isActive=false 経由 cancelPreStart | 意図的 | touch なし |

### Sub-agent 3: main.js（3180 行）+ preload.js

- preStartState cache 変更 3 経路（rc7 cache merge / rc5 did-finish-load resync）すべて完全保持
- display-removed/added の debounce guard（rc23 確定）完備、rc10 で touch なし
- 「rc10 主因経路 F（initialize L7603）」の race パターン特定: HDMI 挿し直し直後の mainWindow reload → initialize → preStartState resync が間に合わず `timerReset()` 経由で isPreStart クリア

### 統合: PRE_START を消す全経路マップ（前回 CC_REPORT §2 から継承、本実装で 5 経路に第 2 層追加）

---

## §3 修正方針 5 案の提示と構築士確定

| 案 | 修正規模 | 真因経路 F 対処 | 経路 D 対処 | 観測強化 | 確証度 | 構築士判断 |
|---|---|---|---|---|---|---|
| **A** timer.js reset 構造的ガード | 小（1+5）| ✅ 全網羅 | ❌ | なし | ⭐⭐⭐⭐⭐ | ✅ **採用** |
| B reset フラグ引数（全 11 経路）| 中（1+11）| ✅ | ❌ | なし | ⭐⭐⭐⭐ | 不採用（過剰）|
| C L7591 ピンポイント | 極小 | ✅ 単一 | ❌ | 1 | ⭐⭐ | 不採用（spec 違反）|
| D state↔isPreStart 乖離防御 | 小 | ❌ | ✅ | なし | ⭐⭐⭐ | 不採用（範囲外、別フェーズ）|
| E main.js 観測 + validation | 小 | ❌ | ❌ | ✅ | ⭐⭐ | 不採用（範囲外）|

---

## §4 構築士承認状況

✅ **2026-05-12 構築士確定**: 案 A 単独採用 + 以下パラメータ:

| 項目 | 構築士確定値 |
|---|---|
| 引数名 | `force` |
| デフォルト | `force: true`（後方互換）|
| 返り値 | `true` / `false`（呼出側で判定）|
| 観測ラベル | `timer:reset:skip-during-prestart`（renderer 側発火）|
| rc8/rc9 既存 4 経路ガード | **保持**（多層防御）|
| handleReset 内 cancelPreStart 明示化 | やらない（C.2.7-A 範囲最小変更）|

---

## §5 各 Fix の実装内容

### Fix 1: timer.js `reset()` に `force` 引数追加（src/renderer/timer.js L119-L147）

```js
// リセット（IDLE状態でレベル0に戻す）
// v2.1.20-rc10: opts.force === false かつ PRE_START 中なら no-op で false 返却（構造的 PRE_START 保護）
// 後方互換: opts 省略時は force=true デフォルト、既存呼出は無変更で動作
// 返り値: true = reset 実行 / false = PRE_START 中ガードで no-op
export function reset(opts = {}) {
  const { force = true } = opts;
  if (!force && isPreStart) {
    return false;
  }
  stopLoop();
  // ... 既存処理（無変更）...
  return true;
}
```

**重要設計判断**: timer.js 内では `window.api?.log?.write?.` を呼ばない（依存ゼロ維持、テスト性）。観測ラベル発火は呼出側 renderer.js が担当。

### Fix 2: renderer.js の 5 経路を `{ force: false }` 経由に変更 + ガード発火時ログ

| # | 行 | ctx 値 |
|---|---|---|
| 1 | 1634 | `applyTimerStateToTimer:invalid-ts` |
| 2 | 1664 | `applyTimerStateToTimer:idle` |
| 3 | 1694 | `applyTimerStateToTimer:finished` |
| 4 | 1725 | `applyTimerStateToTimer:no-levels` |
| 5 | 7603 | `initialize:restoredFromTimerState-false` |

各経路で:
```js
// v2.1.20-rc10: 多層防御第 2 層 — timer.js 内 force=false ガード（rc8/rc9 ガード抜け race 防止）
if (!timerReset({ force: false })) {
  try { window.api?.log?.write?.('timer:reset:skip-during-prestart', { ctx: '...', role: window.appRole }); } catch (_) {}
}
```

rc8/rc9 既存ガードは**保持**（撤去せず）、多層防御として併存。

### Fix 3: 意図的リセット経路 6 箇所は touch なし

handleReset / resetBlindProgressOnly / handleTournamentListReset / 新規 / 複製 / applyOperatorPreStartState (timerCancelPreStart 経由) すべて `timerReset()` 引数なしのまま、`force: true` デフォルトで従来動作。

### Fix 4: package.json bump + scripts.test 追記

- `version`: `2.1.20-rc9` → `2.1.20-rc10`
- `scripts.test` 末尾に `&& node tests/v248-reset-structural-guard.test.js`
- 既存 59 テストの `'2.1.20-rc9'` リテラル → `'2.1.20-rc10'` を Node ワンライナーで機械置換（**97 件置換、残存 0**）

### Fix 5: 新規テスト `tests/v248-reset-structural-guard.test.js`（10 件、全 PASS）

| # | 検証項目 | 結果 |
|---|---|---|
| T1 | package.json.version === '2.1.20-rc10' | PASS |
| T2 | timer.js `reset(opts = {})` + `const { force = true }` + `if (!force && isPreStart) return false;` | PASS |
| T3 | reset() force=true デフォルトで wasPreStart 経由 onPreStartCancel 発火が保持 | PASS |
| T4 | applyTimerStateToTimer 4 経路すべてで `timerReset({ force: false })` + 5 ctx 値中 4 つ発火経路 | PASS |
| T5 | initialize 経路 L7603 で `timerReset({ force: false })` + ctx:'initialize:restoredFromTimerState-false' | PASS |
| T6 | 意図的リセット経路 6 箇所は引数なし `timerReset()` 維持（touch なし）| PASS |
| T7 | rc8/rc9 既存 4 経路 `isPreStartActive()` ガード保持（多層防御、撤去されていない）| PASS |
| T8 | rc1〜rc9 機構 + 致命バグ保護 5 件 完全保持 | PASS |
| T9 | meas1+meas2+症状確証 4+rc2/rc4/rc5/meas3/rc7/rc8/rc9 ラベル + rc10 5 ctx 値 | PASS |
| T10 | timer.js `reset()` 関数本体は window.api?.log?.write?. を呼ばない（rc10 設計判断）| PASS |

### Fix 6: CHANGELOG.md `[2.1.20-rc10] - 2026-05-12` セクション追加

`[2.1.20-rc9]` セクション上に新規セクション挿入。Fixed / Maintained / Notes の 3 区分（spec 通り）。

### 副次修正: 既存 4 テストを rc10 のシグネチャ変更に対応

| ファイル | 変更箇所 | 理由 |
|---|---|---|
| `tests/v218-prestart-hall-sync.test.js` T6 | `TIMER_JS.indexOf('export function reset()')` → 正規表現 `/export\s+function\s+reset\s*\([^)]*\)/` | rc10 で `reset()` シグネチャ → `reset(opts = {})` 拡張に追従 |
| `tests/v222-hall-rAF-reduction.test.js` T2 | `timerReset\s*\(\s*\)` → `timerReset\s*\(\s*(?:\{\s*force\s*:\s*false\s*\}\s*)?\)` | rc10 で 4 経路が `timerReset({ force: false })` に切替えられたため両形式許容 |
| `tests/v223-hall-60fps-restore.test.js` T2 | 同上 | 同上 |
| `tests/v246-prestart-skip-reset.test.js` T4/T6 | 同上 | 同上 |
| `tests/v247-skip-reset-all-routes.test.js` T2/T5 | 同上（replace_all で 3 箇所一括）| 同上 |

詳細は §10 構築士への質問にて報告。

---

## §6 rc1〜rc9 機構保持確認（grep 証跡）

| 機構 | 検証結果 |
|---|---|
| rc1〜rc3 すべて | 完全保持 ✅（v248 T8 PASS）|
| rc4 timer.js `restorePreStart` / `applyOperatorPreStartState` / `handleStartPauseToggle` PRE_START 分岐 | 完全保持 ✅ |
| rc5 `preStart:operator:send` + `operator:preStartResync:sent` + `subscribeStateSync` | 完全保持 ✅ |
| rc6-meas3 観測強化 8 項目（Fix A〜H）| すべて完全保持 ✅ |
| rc7 cache merge + `preStart:cache:merge` + `_appendPriorityLog` lazy init | 完全保持 ✅ |
| rc8 `applyTimerStateToTimer` idle 経路 `isPreStartActive()` ガード | 完全保持（撤去せず多層防御）✅ |
| rc9 残り 3 経路（invalid-ts / finished / no-levels）ガード + trigger 4 種別 | 完全保持（撤去せず多層防御）✅ |
| timer.js `reset()` 既存 wasPreStart 経由 onPreStartCancel 発火 | 完全保持（v248 T3 PASS）✅ |
| timer.js `publishPreStartIfOperator` | touch なし ✅ |
| `applyTimerStateToTimer` hall 側 else 4 経路 | touch なし、v247 T6 で確認 ✅ |
| `handleTournamentListReset` / 新規 / 複製 / handleReset / resetBlindProgressOnly | touch なし、v248 T6 で確認 ✅ |

すべて v247/v248 で自動 verify、全 PASS。

---

## §7 計測機構保持確認（grep 証跡）

- meas1 計測バッジ HTML + CSS: **保持** ✅
- バージョン文字列 `/-meas\d*$/` + `/-rc\d+/` 分岐: **保持**（rc10 でもバッジ表示）
- meas1 既存 15 ラベル: **保持** ✅
- meas2 6 カテゴリ ラベル: **保持** ✅
- 症状確証 4 ラベル: **保持** ✅
- rc2 `hall:hallTickState:reset` 3 trigger: **保持** ✅
- rc4 `operator:applyPreStartState:apply`: **保持** ✅
- rc5 `preStart:operator:send` / `operator:preStartResync:sent`: **保持** ✅
- meas3 `perf:highfreq:summary` / `meas3:hdmi-snapshot:written`: **保持** ✅
- rc7 `preStart:cache:merge`: **保持** ✅
- rc8/rc9 `operator:applyTimerStateToTimer:skip-reset-during-prestart` + 4 trigger 値: **保持** ✅
- **rc10 新規ラベル** `timer:reset:skip-during-prestart` + 5 ctx 値:
  - `applyTimerStateToTimer:invalid-ts` ✅
  - `applyTimerStateToTimer:idle` ✅
  - `applyTimerStateToTimer:finished` ✅
  - `applyTimerStateToTimer:no-levels` ✅
  - `initialize:restoredFromTimerState-false` ✅

v248 T9 で全項目自動 verify、PASS。

---

## §8 テスト結果

```
$ npm test
Total PASS: 1106
Total FAIL: 0
Total SKIP: 21
（rc9 1096 + v248 新規 10 件、SKIP 件数は ±0）
```

- 全 95 テストファイル（v248 新規含む）実行、想定通り 1106 PASS / 0 FAIL / 21 SKIP
- v248 reset-structural-guard: 10 PASS / 0 FAIL
- 致命バグ保護 5 件 grep 確認: v248 T8 で全 PASS
- 副次修正で更新した v218 / v222 / v223 / v246 / v247 すべて PASS

---

## §9 ビルド成果物

| 項目 | 値 |
|---|---|
| 絶対パス | `C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock\dist\pokertimerplus-setup-2.1.20-rc10.exe` |
| サイズ | 83,018,701 B（約 79.2 MB）|
| sha512 | `Vvqxm7AZDG2jkAk+ws5KBl+Acy3yHpREN7TfD9jbp3izQngw8UjC2q6PWaSEH4eCLEROyFYPCT2+H1U8z6JcMA==` |
| latest.yml | `dist/latest.yml` 出力済（version: 2.1.20-rc10、releaseDate: 2026-05-12T07:49:13.072Z）|
| 配布判断 | **配布禁止**（前原さん PC 実機専用、上書きインストール）|

---

## §10 副作用評価結果

### 致命バグ保護 5 件すべて完全無傷

| 保護 | 検証結果 |
|---|---|
| C.2.7-A `resetBlindProgressOnly` / `handleReset` 責任分離 | touch なし、`timerReset()` 引数なし呼出維持、v248 T6 / T8 PASS |
| C.2.7-D `tournaments:setDisplaySettings` の timerState destructure 除外 | main.js touch なし、v248 T8 PASS |
| C.1-A2 / C.1.4-fix1 `ensureEditorEditableState` 4 重防御 | 編集経路 touch なし、v248 T8 PASS |
| C.1.7 AudioContext suspend 防御 | audio.js 完全無変更、v248 T8 PASS（`audioContext.resume` 検証）|
| C.1.8 runtime 永続化 | schedulePersistRuntime + 主犯 2 5 秒 setInterval touch なし、v248 T8 PASS |

### v2.1.6〜v2.1.20-rc9 機構完全保持

すべて touch なし、`timer.js reset()` に opts.force 引数追加 + renderer.js 5 経路で `{ force: false }` 経由に変更 + 観測ラベル発火のみ。v248 T6 / T7 / T8 で自動 verify、全 PASS。

### Race / 副作用評価

- **Fix 1（timer.js reset force 引数）**: 後方互換完全（デフォルト force=true、既存呼出は無変更で動作）。`force: false` 経由でのみガード発火、PRE_START 中以外は即時 reset 実行（v248 T2/T3 検証）
- **Fix 2（5 経路）**: 各経路で `!isHallApply` ブロック内に閉じ込め、hall 側 else は touch なし（v247 T6 で 4 経路 + v248 T8 で initialize 経路を一括検証済）
- **rc8/rc9 既存ガードとの関係**: 多層防御として併存。第 1 層（`isPreStartActive()`）と第 2 層（`force: false` ガード）の両方を通過した場合のみ reset 実行
- **新ラベル `timer:reset:skip-during-prestart`**: priority log labels には**含めない**（HDMI 挿し直し時のみ発火想定の低頻度ラベル）。rolling log に出力、5 ctx 値で発火経路識別
- **handleReset 経由のリセット**: 意図的、`timerReset()` 引数なし呼出 → デフォルト `force: true` でガード非適用、従来通り動作
- **operator-solo モード**: `window.appRole === 'operator-solo'` でも `!isHallApply` で同じ経路、5 経路すべて第 2 層ガード機能
- **timer.js 依存ゼロ維持**: `reset()` 関数本体に `window.api` 参照なし（v248 T10 で自動 verify、rc6-meas3 で追加された `perf:raf:fire` は別関数 `_emitRafFire` 内）

---

## §11 並列 sub-agent / Task 数報告

- **Phase 1 並列 sub-agent: 3 体**（cc-operation-pitfalls.md §1.1 公式 Agent Teams 上限遵守 ✅）
  - Sub-agent 1: timer.js 状態変更経路調査（Explore Agent、~550 行報告）
  - Sub-agent 2: renderer.js reset / initialize 経路調査（Explore Agent、~600 行報告）
  - Sub-agent 3: main.js / preload.js IPC / cache 経路調査（Explore Agent、~450 行報告）
- **同時起動**: 1 メッセージ内 3 並列ツールコールで同時起動
- **Plan Mode 使用**: ✅（前回 CC セッション末尾で stop し構築士の方針承認を待った後、本セッションで Phase 3 spec に従い機械的実装）
- **Phase 3 実装フェーズ並列 sub-agent: 0 体**（構築士確定方針の機械的反映、Plan Mode 不要）
- **TodoWrite 進捗管理**: 使用（11 タスク → 11 完了）

---

## §12 構築士への質問・懸念事項

### 1. initialize L7591 → L7603 の行ズレ

NEXT_CC_PROMPT Phase 3 spec で `L7591` と記載されているが、実際の行は **L7603**（initialize 関数本体内の `if (!restoredFromTimerState) timerReset();`）。本 CC_REPORT および v248 T5 では実行行 **L7603** を verified。spec 記載との差分は cosmetic（行数のみ）、修正対象経路は同一。

### 2. 副次修正の妥当性確認

Fix 1/2 で `reset()` シグネチャ拡張 + 4 経路の呼出形式変更により、既存 5 テスト（v218 T6 / v222 T2 / v223 T2 / v246 T4・T6 / v247 T2・T5）の brittle regex が引っかかった。すべて「rc10 のシグネチャ変更（`reset()` → `reset(opts = {})`）」「呼出形式変更（`timerReset()` → `timerReset({ force: false })`）」に追従する regex 拡張のみで対応、テスト意図は変更せず。

**懸念**: rc5〜rc9 と同様に「spec の意図（rc10 機構を破壊せず動作させる）の範囲内」と判断したが、構築士の判断と合致するか確認したい。

### 3. v248 T10 の解釈

NEXT_CC_PROMPT Fix 5 spec で「timer.js 内に `window.api?.log?.write?` 呼出が**含まれていない**こと」と記載されているが、timer.js の `_emitRafFire`（rc6-meas3 で追加された `perf:raf:fire` ラベル）には既に `window.api` 呼出が存在する。本 CC_REPORT では「**reset() 関数本体内**に限定して `window.api` を含めない」と解釈し v248 T10 を実装（rc6-meas3 既存機構を破壊しない）。spec の意図は「rc10 で新たに reset() 内に追加しない」と理解、構築士判断確認したい。

### 4. 多層防御の確実性評価

- 第 1 層（rc8/rc9 `isPreStartActive()` チェック）と第 2 層（rc10 `force: false` ガード）は両方とも timer.js 内の `isPreStart` 内部フラグを参照するため、**同一の race window で同一のフラグ値を見る**。理論上は race window 内のフラグ変化があれば両方とも誤判定する可能性があるが、関数呼出間隔（μs オーダー）で発生する race は実際には極めて稀
- 真因経路 F（initialize L7603）は rc8/rc9 ガードがなかったため、rc10 で初めてガード対象に加わる → 単層でも効果ありの可能性が高い

### 5. 次フェーズ予告（spec §「次フェーズ予告」転記）

- 期待値達成 → **rc11 で計測機構撤去 + バージョン文字列 rc10 → v2.2.1 + main マージ + tag v2.2.1 + GitHub Release 公開**
- 期待値未達成 → 構造的設計の見直し（案 D 案 E 採用検討）、もしくは v2.1.19 維持で v2.3.0 以降に延期

---

## §13 オーナー向け確認手順（試験項目別、最重要）

`dist/pokertimerplus-setup-2.1.20-rc10.exe` を前原さん PC に上書きインストール → 起動後 30〜60 秒待って下記を確認:

| # | 操作 | 期待結果 |
|---|---|---|
| 1 | `dist/pokertimerplus-setup-2.1.20-rc10.exe` を実機 PC で上書きインストール → 起動 | バージョン表示 `2.1.20-rc10`、画面右下に「計測ビルド」黄色バッジ |
| 2 | **【最重要】PRE_START カウントダウン中に HDMI ケーブル抜く → 30 秒 → 挿し直す**（rc3〜rc9 で操作不可になった同じシナリオ）| hall 復帰後、**手元 PC で Space キーを押すと一時停止が正常に効く** + **トーナメントが消えない** + **PRE_START カウントダウンが継続している** |
| 3 | もう一度 Space キーを押す | 一時停止解除（カウントダウン再開）|
| 4 | **【重要】通常のリセットボタン**（PRE_START 中・通常進行中の両方で）| リセットが正常動作（rc10 で構造変更による副作用がないことの確認）|
| 5 | rc3〜rc9 試験項目（スライドショー始動 / 2 倍表示なし / 軽量化 / 症状 1/2 修正）| すべて維持 |
| 6 | 各操作後 Ctrl+Shift+L でログ採取 + ログフォルダ全体（rolling-current / priority-events / hdmi-snapshot-*）を Claude に送付 | rc10 新規ラベル `timer:reset:skip-during-prestart` の発火経路特定（**どの `ctx` 値が発火したか**で真因経路を完全特定可能） + `state:transition` PRE_START → IDLE が HDMI 挿し直し時に**発火していない**こと |

### 確認の優先順位

- **最重要**: HDMI 抜き差し後の Space キー一時停止 + トーナメント維持 + PRE_START 継続
- **重要**: リセットボタンの正常動作（構造変更による副作用なし確認）
- **重要**: ログ内 rc10 新規ラベル発火 + PRE_START→IDLE 遷移がないこと
- 通常: rc9 までの全機能維持

### Known Issues（rc10 範囲外、v2.2.1 リリース後に対処予定）

- 案 D（timer.js state ↔ isPreStart 乖離防御）は本フェーズ範囲外（HDMI 問題と独立した潜在欠陥、別フェーズで対処）
- 案 E（main.js 観測強化）は本フェーズ範囲外（案 A 単独で根治見込み）
- Op 8 で 1952ms long-task（rc1 試験時、再現性低）
- `state:transition` ログが operator + hall の両方で記録される二重出力（無害）
- subscribe 残り 23 Hz（rc1 目標 5 Hz 未達）

---

## §14 git 状態

- **作業ブランチ**: `feature/v2.1.20-rc10-structural-prestart-protection`（rc9 commit `63f8d5c` から分岐）
- **rc10 commit**: ✅ `8995a7b v2.1.20-rc10: timer.js reset に force フラグ追加で PRE_START を構造的保護（HDMI 抜き差し問題 真因根治 第 4 弾）`
- **commit 規模**: 66 files changed, 984 insertions(+), 484 deletions(-)
- **main マージ**: ❌ 未実施（spec 禁止条項に準拠）
- **tag 作成**: ❌ 未実施
- **GitHub Release**: ❌ 未実施
- **git push origin**: ❌ 未実施

### 次フェーズで構築士が指示書を出すまで待機

- 期待値達成: rc11 計測撤去 → v2.2.1 本番リリース（main / tag / Release / push 解禁）
- 期待値未達成: ログ ctx 値で発火経路を特定 → 案 D / E / 別経路調査

---

## §15 オーナー向け確認（簡潔版、3〜5 項目）

1. **CC 動作報告**: 並列 sub-agent 3 体で PRE_START を消す全経路を網羅特定 → 構築士確定の案 A（timer.js reset に force フラグ追加で構造的ガード）を実装完了。新規テスト 10 件 + 副次修正 5 テスト調整、合計 1106 PASS / 0 FAIL
2. **真因対処**: 5 経路（applyTimerStateToTimer 4 経路 + initialize L7603）に `force: false` を適用、rc8/rc9 既存ガードと併せた多層防御
3. **rc10 実機テストの最重要確認**: PRE_START 中の HDMI 抜き差し → 復帰後 Space キーが効く + トーナメント維持 + PRE_START 継続
4. **ログで真因経路特定可能**: 新ラベル `timer:reset:skip-during-prestart` の `ctx` 値（5 種別）で発火経路を完全識別。期待値達成なら rc11 で計測撤去 + v2.2.1 本番リリースへ
5. **配布判断**: 配布なし。前原さん PC のみで上書きインストールテスト
