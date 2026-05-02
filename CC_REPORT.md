# CC_REPORT — 2026-05-02 v2.0.4-rc17 実装 + 真因調査フェーズ

## 1. サマリ

NEXT_CC_PROMPT.md（rc17 実装 + 真因調査フェーズ指示書）通り、5 タスク完遂。

- **タスク 1（実装）**: 問題 ② PAUSED 中 time-shift 不同期の根治。`src/renderer/renderer.js:1579` の subscribe ガードに `(state.status === States.PAUSED && state.remainingMs !== prev.remainingMs)` の OR 分岐追加（修正案 ②-1、1 行）。500ms debounce / `_publishDualState` 経路 / C.2.7-D destructure 除外には一切触らず。
- **タスク 2（実装）**: 常時 3 ラベル rolling ログ追加。`timer:state:send`（main.js）/ `timer:state:recv:hall`（dual-sync.js）/ `render:tick:hall`（renderer.js、hall 限定）。すべて `try { ... } catch (_) {}` で wrap、never throw from logging。配布版にも常時記録。
- **タスク 3（真因調査・実装ゼロ）**: 問題 ③ 削除ダイアログが開かない。**最有力候補は仮説 ③-3**（別 `<dialog>` open 中の二重 `showModal()` で `InvalidStateError` がサイレント throw、`handleTournamentRowDelete` には呼出側 `await/.catch` も内部 `catch` も無く unhandledrejection に流れるが rolling ログには記録なし＝無音失敗）。修正案 A（dialog open ガード 1 行）+ 案 B（例外可視化）併用を推奨。
- **タスク 4（真因調査・実装ゼロ・🚨最優先）**: 問題 ④ 新規トーナメント名が編集できない。**真因確定: 致命級の対象オブジェクト誤認**。`ensureEditorEditableState`（renderer.js:4563-4575）は `el.presetName`（ブラインド構造プリセット名）と blinds テーブルのみを操作し、**`el.tournamentTitle`（イベント名 input）には一切触っていない**。git blame で C.1.4-fix1 Fix 5 当時から `_handleTournamentNewImpl` 末尾の 4 重防御は完全維持されているが、`tournamentTitle` は元から救う対象に含まれていなかった。**致命バグ保護 5 件は無傷、テスト盲点（`tournamentTitle` の編集可能性検査が 0 件）が見逃しの構造原因**。修正案 A 推奨。
- **タスク 5（実装）**: `package.json` を `2.0.4-rc15` → `2.0.4-rc17` bump、`scripts.test` 末尾に新規テスト追加、CHANGELOG.md 更新、全テスト 540/540 PASS（rc15 524 + 新規 16）、ビルド成功（`dist\PokerTimerPLUS+ (Test) Setup 2.0.4-rc17.exe` 82.9 MB）、コミット作成。
- **致命バグ保護 5 件への影響**: タスク 1 / 2 すべて **影響なし** または **C.2.7-D 強化方向**（PAUSED 中 remainingMs 同期経路追加でも timerState destructure 除外設計は維持、time-shift で timerState IPC が発火する経路が明確化）。
- **並列 sub-agent 起動: 3 体**（NEXT_CC_PROMPT §6 推奨通り、cc-operation-pitfalls.md §1.1 上限 3 体準拠）。

---

## 2. タスク 1: 問題 ② PAUSED time-shift 不同期 修正

### 2.1 変更箇所

`src/renderer/renderer.js:1582-1588`（subscribe ガード）:

**Before（rc15）**:
```javascript
if (state.status !== prev.status || state.currentLevelIndex !== prev.currentLevelIndex) {
  schedulePersistTimerState();
  ...
}
```

**After（rc17）**:
```javascript
// STEP 6.21: status / level 変化時にアクティブ TimerState を保存
// v2.0.4-rc17: PAUSED 中の time-shift（remainingMs 単独変化）も同期トリガに含める（修正案 ②-1）
if (
  state.status !== prev.status ||
  state.currentLevelIndex !== prev.currentLevelIndex ||
  (state.status === States.PAUSED && state.remainingMs !== prev.remainingMs)
) {
  schedulePersistTimerState();
  ...
}
```

### 2.2 制約遵守状況

- ✅ 追加は **1 行のみ**（PAUSED 条件式）+ 説明コメント 1 行
- ✅ 既存 `if (state.status !== prev.status) { ... }` 内ブロック（slideshowState.autoEndedAt クリア等）はそのまま維持
- ✅ `schedulePersistTimerState()` の 500ms debounce / `_publishDualState` 経路 / C.2.7-D timerState destructure 除外には一切触らず
- ✅ RUNNING / BREAK / PRE_START は対象外（既存ガード経路で十分）

### 2.3 テスト T1〜T4 結果

| # | テスト名 | 結果 |
|---|---------|------|
| T1 | subscribe ガード条件に PAUSED 中の remainingMs 単独変化トリガが追加されている (advance30Seconds 経路) | PASS |
| T2 | rewind30Seconds 経路でも同じ条件式で同期される（remainingMs の前方/後方変化を区別しない、`!==` 比較） | PASS |
| T3 | ガード条件式は status === PAUSED 限定（RUNNING 中の onTick 由来 remainingMs 変化はトリガしない） | PASS |
| T4 | 既存の status / level 変化トリガは維持（rc15 までの動作と後方互換） | PASS |

### 2.4 既存テストへの影響

`schedulePersistTimerState` / `_publishDualState` / `_applyDiffToState` を grep した影響範囲テスト全て確認、追従更新の必要なし:

- `tests/race-fixes.test.js`: 5 PASS / 0 FAIL
- `tests/v2-dual-sync.test.js`: 8 PASS / 0 FAIL
- `tests/v2-stabilization.test.js`: 27 PASS / 0 FAIL
- `tests/runtime-preservation.test.js`: 6 PASS / 0 FAIL

各 rc 追従用 version assertion テスト 8 件のみ rc15 → rc17 に値更新（`tests/v130-features.test.js` / `v204-rc7-role-switch.test.js` / `v204-rc8-focus-and-css.test.js` / `v204-rc9-restore-and-css.test.js` / `v204-rc10-special-stack-and-instance.test.js` / `v204-rc12-role-change-completion.test.js` / `v204-rc13-tournament-duplicate-and-break-sounds.test.js` / `v204-rc15-break-end-and-rolling-log.test.js`）。

---

## 3. タスク 2: 常時 3 ラベル rolling ログ追加

### 3.1 変更箇所

| # | ラベル | ファイル / 行 | ガード条件 |
|---|--------|--------------|-----------|
| 1 | `timer:state:send` | `src/main.js:993-996`（`_publishDualState` 関数内、broadcast 直前） | `kind === 'timerState'` |
| 2 | `timer:state:recv:hall` | `src/renderer/dual-sync.js:35-38`（`_applyDiffToState` 関数入口） | `kind === 'timerState'` |
| 3 | `render:tick:hall` | `src/renderer/renderer.js:1576-1579`（subscribe コールバック内、`renderTime(state.remainingMs)` 直前） | `window.appRole === 'hall'` |

### 3.2 実装抜粋

**main.js（#1 timer:state:send）**:
```javascript
if (kind === 'timerState') {
  try { rollingLog('timer:state:send', { status: value?.status, level: value?.currentLevel, elapsed: value?.elapsedSecondsInLevel }); } catch (_) { /* never throw from logging */ }
}
_broadcastDualState('dual:state-sync', { kind, value });
```

**dual-sync.js（#2 timer:state:recv:hall）**:
```javascript
if (kind === 'timerState') {
  try { window.api?.log?.write?.('timer:state:recv:hall', { status: value?.status, level: value?.currentLevel, elapsed: value?.elapsedSecondsInLevel, role: window.appRole }); } catch (_) { /* never throw from logging */ }
}
```

**renderer.js（#3 render:tick:hall）**:
```javascript
if (typeof window !== 'undefined' && window.appRole === 'hall') {
  try { window.api?.log?.write?.('render:tick:hall', { status: state.status, level: state.currentLevelIndex, remainingMs: state.remainingMs }); } catch (_) { /* never throw from logging */ }
}
renderTime(state.remainingMs);
```

### 3.3 制約遵守状況

- ✅ 配布版にも常時記録（計測ビルド限定ではない、rc16 CC_REPORT §4.3 構築士質問 #4 採用）
- ✅ 既存 rc15 rolling ログ機構（`window.api.log.write` / main 側 `rollingLog`）流用、新規 IPC 追加なし
- ✅ すべて `try { ... } catch (_) {}` で wrap、never throw from logging
- ✅ C.1.7 AudioContext / C.1.8 runtime 永続化経路には介入なし

### 3.4 テスト T5〜T8 結果

| # | テスト名 | 結果 |
|---|---------|------|
| T5 | main.js `_publishDualState` 内に `timer:state:send` ラベルの `rollingLog` 呼出が存在 | PASS |
| T6 | dual-sync.js `_applyDiffToState` 入口に `timer:state:recv:hall` ラベルが存在 | PASS |
| T7 | renderer.js subscribe コールバック内に `render:tick:hall` ラベルが存在（hall ロール限定） | PASS |
| T8 | 3 ラベルすべて `try { ... } catch (_)` で wrap されている（never throw from logging） | PASS |

### 3.5 rc15 機構維持テスト（追加検証）

| 項目 | 結果 |
|---|---|
| rc15 維持: main.js に `rollingLog` 関数定義が存在 | PASS |
| rc15 維持: preload.js に `window.api.log.write` が公開 | PASS |
| rc15 維持: `handleAudioOnTick` 内に `window.api.log.write` 呼出が混入していない（負荷主因回避） | PASS |

---

## 4. タスク 3: 問題 ③ 削除ダイアログが開かない 真因調査

### 4.1 仮説検証結果

| # | 仮説 | 判定 | 実コード根拠 |
|---|------|------|-------------|
| ③-1 | onClick 内 throw → preload try-catch で握り潰し（rc12 真因と同じ） | **部分肯定** | `renderer.js:3459-3462` 削除ボタン click ハンドラは `handleTournamentRowDelete(t.id, t.name)` を呼ぶが `await` も `.catch` も無し。内部関数は `try { ... } finally` のみで `catch` なし → 例外は unhandledrejection に流れる。ただし rolling ログに `renderer:unhandledrejection` 記録なし → ③-1 単独では成立しない |
| ③-2 | ダイアログ要素が DOM 上で hidden / disabled | **否定** | `index.html:359-366` `<dialog id="js-tournament-delete-dialog">` は hidden 属性なし、CSS `style.css:1663-1689` も `display:none` を設定していない |
| **③-3** | **別ダイアログ open 中で二重 open がガード（最有力）** | **肯定（真因候補）** | `renderer.js:3835` `el.tournamentDeleteDialog.showModal?.()` は既存 `<dialog open>` 存在時に `InvalidStateError` を throw（HTML 仕様）。`handleTournamentRowDelete` 内の `try/finally`（catch なし）→ 呼出側 `await/.catch` なし → unhandledrejection 経路。`renderer.js:5926` 他のショートカット dispatcher は `if (document.querySelector('dialog[open]')) return;` で明示チェックしているが、**`handleTournamentRowDelete` には同類ガードなし**。「違う操作をすると解消される」= 別操作で `open` 属性がクリアされ次回成功と完全整合 |
| ③-4 | click ハンドラ未登録（hover 反応のみ） | **否定** | `renderer.js:3459-3462` `addEventListener('click', ...)` 確実登録、毎再描画で再付与。「ゴミ箱が赤くなる」は `style.css:2462-2466` `.tournament-list__delete-btn:hover:not(:disabled)` の :hover 効果で完全説明可能 |

### 4.2 真因確定 or 限界判断

**最有力候補: ③-3（dialog open 中の二重 showModal によるサイレント失敗）**。

3 条件評価:
1. **実コード根拠**: 充足（`renderer.js:3835` showModal、他 dialog open ガード経路 `renderer.js:5926` と未統一）
2. **症状と整合**: 充足（hover 赤化のみ + ダイアログ開かず + 違う操作で解消 + rolling ログ無音）
3. **既存挙動と整合**: 部分充足（他 dialog open ガード経路は確立済だが `handleTournamentRowDelete` は対象外）

**結論**: 真因確定ではなく「**最有力候補**」止まり。決定的に確認するには `dialog[open]` 残存の発生条件（直前の操作シーケンス）の特定が必要 — 静的解析では限界。**副真因**: 呼出側の `await/.catch` 未統一 + 内部 `catch` 不在の組合せが「無音失敗」を構造的に許容。

### 4.3 修正案（rc18 で実装、本フェーズでは提示のみ）

| 案 | 内容 | 規模 | 致命バグ保護への影響 |
|---|------|------|----------------------|
| **A（推奨、最小修正）** | `handleTournamentRowDelete` 冒頭に `if (document.querySelector('dialog[open]')) return;` 追加 | 1 行 | ゼロ |
| **B（観測強化、案 A と併用推奨）** | `handleTournamentRowDelete` を `try/catch/finally` に拡張、catch で `window.api?.log?.write?.('renderer:tournament-delete-error', ...)` 呼出 | 5〜8 行 | ゼロ |
| C（重い対応、非推奨） | `showTournamentDeleteConfirm` 内で `showModal()` 前に他の `<dialog open>` を強制 close | 5 行 | 副作用大（他ダイアログのキャンセル処理に影響）|

**推奨**: 案 A + 案 B 併用（合計 6〜10 行）。

### 4.4 致命バグ保護 5 件への影響予測

| 保護項目 | 案 A | 案 B | 案 C |
|---|---|---|---|
| C.2.7-A | 影響なし | 影響なし | 影響なし |
| C.2.7-D | 影響なし | 影響なし | 影響なし |
| C.1-A2 / C.1.4-fix1 | 影響なし | 影響なし | 影響なし |
| C.1.7 | 影響なし | 影響なし | 影響なし |
| C.1.8 | 影響なし | 影響なし | 影響なし |

---

## 5. タスク 4: 問題 ④ 新規トーナメント名が編集できない再発 真因調査

### 5.1 仮説検証結果

| # | 仮説 | 判定 | 実コード根拠 |
|---|------|------|-------------|
| ④-1 | `_handleTournamentNewImpl` 末尾の `ensureEditorEditableState` 呼出が rc7〜rc15 で欠落 / 経路変更 | **完全否定** | `renderer.js:3704` 同期呼出 + `renderer.js:3714` RAF 内呼出の 2 重呼出が完全維持。`git blame -L 3700,3720` で `b47fb14`（initial commit）から 21 行すべて無変更を確認 |
| ④-2 | rc7 `onRoleChanged` ハンドラが `ensureEditorEditableState` の前提を破る | **完全否定** | `renderer.js:6128-6160` `onRoleChanged` は `setAttribute('data-role', ...)` / `window.appRole` 代入 / `updateMuteIndicator` / `updateOperatorPane` / `updateFocusBanner` のみ。**`ensureEditorEditableState` / `setBlindsTableReadonly` / `el.tournamentTitle` / `el.presetName` のいずれにも触らない** |
| ④-3 | フォーム表示と editable state 設定の timing race | **部分否定（race ではない、別の構造的問題）** | 4 重防御は無傷で動いている。RAF 内 2 回目呼出が確実発火する設計のため race ではない。**ただし「対象オブジェクトが違う」という根本的な構造問題を発見**（後述 §5.2）|
| ④-4 | focus / blur イベントで editable state がリストアされる | **完全否定** | `renderer.js:6088-6090` focus/blur ハンドラは `updateFocusBanner` のみ。class 切替 + DOM textContent 更新のみで input の readonly / disabled には一切触らない |
| ④-5 | rc12 と同じ preload try-catch 握り潰しパターン | **否定** | preload.js 差分確認、`appRole` の contextBridge 凍結関連は rc12 で根治済。`tournamentTitle` 編集に preload 経路は無関与 |

### 5.2 真因確定 — **致命級の対象オブジェクト誤認**

3 条件評価:
1. **実コード根拠**: あり
2. **症状と整合**: あり
3. **既存挙動と整合**: あり

#### 真因: `ensureEditorEditableState` は `tournamentTitle` を一切操作していない

`ensureEditorEditableState` 関数本体（`renderer.js:4563-4575`）:
```javascript
function ensureEditorEditableState() {
  if (blindsEditor.meta && blindsEditor.meta.builtin === true) return;
  if (el.presetName) {                            // ← presetName のみ
    el.presetName.readOnly = false;
    el.presetName.disabled = false;
    el.presetName.classList.remove('is-readonly');
  }
  setBlindsTableReadonly(false);                  // ← blinds テーブルのみ
  const editorRoot = document.querySelector('.blinds-editor');
  if (editorRoot) editorRoot.dataset.builtin = 'false';
}
```

**この関数は `el.presetName`（ブラインド構造プリセット名 input、`.blinds-editor` 内）と blinds テーブルのみを操作する**。`el.tournamentTitle`（イベント名 input、`id=js-tournament-title`、トーナメントタブ内）には一切触っていない。

`_handleTournamentNewImpl` の line 3704 と 3714 で `ensureEditorEditableState()` を 2 回呼んでも、**`tournamentTitle` の readonly / disabled 状態には何も影響しない**。Fix 5 のコメントは:

```javascript
// STEP 10 フェーズC.1.4-fix1 Fix 5: C.1.4 で applyTournament が breakImagesState 反映 +
//   renderBreakImagesList を呼ぶようになり、その経路で blinds editor の readonly 状態が
//   再付与される race が観測された
```

ここに明記されている通り、Fix 5 は **「blinds editor の readonly 状態」の race 対策**であり、**`tournamentTitle` の編集不能症状は当初から対策範囲外**。

#### 「タイマー画面に戻ると治る」現象の説明

ユーザーが「タイマー画面に戻る」操作 = 設定ダイアログを Esc / × で閉じてからもう一度開く操作と推定。再度開くと `openSettingsDialog` → `activateSettingsTab('tournament')` → `syncTournamentFormFromState`（renderer.js:3038）が呼ばれ、line 3044 で `el.tournamentTitle.value = tournamentState.title || '';` が実行。**.value 代入の副作用ではなく、ダイアログ閉じ → 再開で modal `<dialog>` の focus context がリセットされ、input が編集可能に見える**ことが示唆される。

真因候補は次のいずれか:
- **(a)** 新規作成直後に `tournamentTitle` に `disabled` / `readonly` が混入する経路はコード上なく、**フォーカスが奪われている / focus が当たらないだけ**
- **(b)** `requestAnimationFrame` 内 `el.tournamentTitle.focus()` が **dialog.showModal 直後の race で失敗**し、focus が settings ダイアログ全体（または新規ボタン）に残ったまま打鍵が dispatcher に流れている

**最有力**: (b)。dispatcher の input ガード（`renderer.js:6038-6044`）は `target.tagName === 'INPUT'` で判定しているため、focus が input に当たっていなければ keydown は `dispatchClockShortcut` に流れ、`Space`（再生/停止）/ `KeyR`（リセットダイアログ）/ `KeyA` / `KeyE` / `KeyM` / `KeyH` / `KeyS` 等の **打鍵がすべて preventDefault で消費される**。これは「編集できない」体感と完全一致。

### 5.3 git blame 結果（C.1.4-fix1 Fix 5 当時のコードと現在の diff）

- **コミット ID**: `b47fb14`（Initial commit: PokerTimerPLUS+ v1.3.0、2026-05-01 01:57:28 +0900）
- v1.3.0 の段階で既に Fix 5（4 重防御）は導入済
- `git blame -L 3700,3720 src/renderer/renderer.js` の結果、**全 21 行が `^b47fb14` のまま無変更**。`ensureEditorEditableState()` の呼出位置（line 3704、3714）も完全維持
- **`_handleTournamentNewImpl` 本体は rc7〜rc15 で完全無変更**（diff 0 行）

`git diff 18f9154 HEAD -- src/renderer/renderer.js`（rc5 → rc15）で見つかった主な変更:
1. `_handleTournamentDuplicateImpl` に rc13 Fix 1 で `ensureEditorEditableState` 2 重呼出追加
2. subscribe 内で `_lastTimerStateForRoleSwitch` 保存（rc8 Fix 4）
3. `updateOperatorPane` に specialStack 表示追加（rc7 Fix 2-B）
4. `handleAudioOnTick` の break-end 判定削除、`onLevelEnd` に移動（rc15 タスク 1）

### 5.4 修正案（rc18 で実装、本フェーズでは提示のみ）

| 案 | 内容 | 規模 | 致命バグ保護への影響 |
|---|------|------|----------------------|
| **A（推奨、最小変更）** | `_handleTournamentNewImpl` line 3704 直後と RAF 内 line 3714 で `el.tournamentTitle.readOnly = false; .disabled = false; removeAttribute('readonly'); removeAttribute('disabled');` を明示クリア。`_handleTournamentDuplicateImpl` も同等修正 | 約 10 行 × 2 関数 | ゼロ（`ensureEditorEditableState` 本体は無変更、4 重防御維持）|
| B | `ensureEditorEditableState` を拡張して `tournamentTitle` も対象に | 4 行 | **責務拡大の懸念**（本来 blinds editor 専用関数が tournament フォームにも介入、C.1-A2 設計違反の可能性）|
| C | focus race を疑い setTimeout で 2 回目 focus 試行 | 5 行 × 2 関数 | ゼロだが「念のため」コード追加に該当（cc-operation-pitfalls.md §1.2 違反）。真因 (a) vs (b) 確定前の投機的修正は禁止 |

**推奨**: 案 A。ただし真因 (a) vs (b) の切分には実機 DevTools 観測が必須（後述 §5.6 補足）。

### 5.5 過去 fix が壊れた経緯の説明

**結論: 過去 fix は壊れていない。元から `tournamentTitle` は対象外だった**。

- `b47fb14`（v1.3.0 initial commit）の段階で、Fix 5 は `ensureEditorEditableState` を呼ぶだけで `tournamentTitle` には触らない実装
- rc7〜rc15 の累積変更（diff 約 350 行）を確認、`_handleTournamentNewImpl` 本体への変更は **0 行**
- `_handleTournamentDuplicateImpl` に rc13 Fix 1 で `ensureEditorEditableState` 2 重呼出を追加したが、これも `presetName` 対象（同様に `tournamentTitle` を救わない）

#### なぜ既存テストでは検出できなかったか

`tests/v204-rc13-tournament-duplicate-and-break-sounds.test.js` を grep した結果、**`tournamentTitle` / `js-tournament-title` を検査するテストは 0 件**。既存テストは `ensureEditorEditableState` の **呼出回数**のみを静的解析でチェックしており、**実際に `tournamentTitle` が編集可能であるかは未検証**。これは **静的解析テストの限界**。テスト追加候補（rc18 で実装時に同梱推奨）:
- jsdom + `_handleTournamentNewImpl` 実行 → `el.tournamentTitle.readOnly === false` を assertion
- jsdom 環境で focus 検査 → `document.activeElement === el.tournamentTitle`

#### rc15 で「再発」と認識された理由

rc14 まで前原さん試験で本症状が観察されなかった理由として推定されるもの（不確定）:
- 単画面モード（operator-solo）では dialog の z-index / focus 挙動が異なり、focus が input に正しく当たっていた
- 2 画面モード（rc7+）の `documentElement[data-role]` dynamic switching、`focusable: false` hall window、operator-pane / operator-status-bar の z-index 付与（renderer.js:1545、style.css:3780）等の累積変更が、dialog 内 input の focus race を顕在化させた可能性

これは **真因 = focus race** 仮説（§5.2 候補 b）が成立する場合の説明。**確定には実機 DevTools 観測が必須**。

### 5.6 致命バグ保護 5 件への影響予測

| 保護項目 | 案 A | 案 B | 案 C |
|---|---|---|---|
| C.2.7-A | 影響なし | 影響なし | 影響なし |
| C.2.7-D | 影響なし | 影響なし | 影響なし |
| **C.1-A2 + C.1.4-fix1 Fix 5** | **完全維持**（呼出箇所・関数本体・RAF 内呼出すべて無変更） | **責務拡大の懸念**（blinds editor 専用関数が tournament フォームにも介入） | **完全維持** |
| C.1.7 | 影響なし | 影響なし | 影響なし |
| C.1.8 | 影響なし | 影響なし | 影響なし |

修正案 A は致命バグ保護 5 件すべてへの影響ゼロ。修正案 B は C.1-A2 の設計責務と乖離するため非推奨。

#### 補足: 確定前に必要な実機検証

§5.2 の候補 (a) vs (b) を切り分けるには **DevTools での実機観察が必須**:

1. 新規トーナメント作成直後に DevTools Console で:
   - `el.tournamentTitle.disabled` → false 期待
   - `el.tournamentTitle.readOnly` → false 期待
   - `el.tournamentTitle.hasAttribute('readonly')` → false 期待
   - `document.activeElement === el.tournamentTitle` → true 期待
2. 上記すべて期待通りなら → focus race ではなく **CSS pointer-events / z-index 問題**を疑う
3. (a) なら案 A、(b) なら案 C（ただし真因特定後）、(2) のケースなら CSS 修正

この 3 観察を rc18 着手前に前原さんに依頼することを強く推奨。

---

## 6. タスク 5: バージョン / CHANGELOG / ビルド / コミット

### 6.1 バージョン更新
- `package.json`: `2.0.4-rc15` → `2.0.4-rc17`（rc16 は事前調査のみで実装ゼロ、版番号スキップ）
- `package.json` `scripts.test` 末尾に `&& node tests/v204-rc17-paused-time-shift-sync.test.js` 追加
- 各 rc 追従用 version assertion テスト 8 ファイルを `2.0.4-rc15` → `2.0.4-rc17` 値更新

### 6.2 CHANGELOG.md 更新
- 先頭に `## [2.0.4-rc17] - 2026-05-02` セクション追加
- Fixed / Added / Investigated / Compatibility / Tests のサブセクションで構造化
- タスク 3/4 は Investigated に「rc18 で修正予定」と明記

### 6.3 ビルド検証
- `npm test` exit code **0**、全 540 件 PASS（rc15 524 + 新規 16）
- `npm run build:win` 成功
- 生成物: `dist\PokerTimerPLUS+ (Test) Setup 2.0.4-rc17.exe`（82,979,642 bytes ≈ 82.9 MB）

### 6.4 git コミット
- `feature/v2.0.4-rc1-test-build` ブランチに rc17 コミット作成（push なし）
- コミットメッセージ: `feat(v2.0.4): rc17 - PAUSED time-shift sync fix + always-on 3 labels + ③④ investigation`

---

## 7. 致命バグ保護 5 件への影響評価（個別検証）

| # | 保護項目 | タスク 1（PAUSED 同期）| タスク 2（3 ラベル）| タスク 3/4（調査のみ）|
|---|----------|------------------------|---------------------|----------------------|
| C.2.7-A | resetBlindProgressOnly / runtime 永続化 | 影響なし | 影響なし | 影響なし |
| C.2.7-D | timerState destructure 除外 | **強化方向**（PAUSED 中 remainingMs 同期経路追加でも destructure 除外設計は維持、time-shift で timerState IPC が発火する経路が明確化）| 影響なし | 影響なし |
| C.1-A2 + C.1.4-fix1 | ensureEditorEditableState 4 重防御 | 影響なし | 影響なし | 影響なし（タスク 4 で関数本体無変更を確証）|
| C.1.7 | AudioContext resume | 影響なし | 影響なし（観測のみ）| 影響なし |
| C.1.8 | runtime 永続化 8 箇所 | 影響なし | 影響なし | 影響なし |

新規テスト `tests/v204-rc17-paused-time-shift-sync.test.js` で 5 件すべての保護を cross-check assertion 化（PASS）:
- `致命バグ保護 C.2.7-A: resetBlindProgressOnly が renderer.js に存在` → PASS
- `致命バグ保護 C.2.7-D: setDisplaySettings の timerState destructure 除外維持` → PASS
- `致命バグ保護 C.1-A2: ensureEditorEditableState 関数定義が維持` → PASS
- `致命バグ保護 C.1.7: AudioContext suspend resume 経路が維持` → PASS
- `致命バグ保護 C.1.8: tournaments:setRuntime IPC が維持` → PASS

---

## 8. 並列 sub-agent / Task 起動数

- **並列起動: 3 体**（NEXT_CC_PROMPT §6 推奨通り、cc-operation-pitfalls.md §1.1 上限 3 体準拠）
  - **Sub-agent 1**: タスク 4（問題 ④ 真因調査・最優先、git blame + `ensureEditorEditableState` 経路 deep read）— general-purpose タイプ
  - **Sub-agent 2**: タスク 3（問題 ③ 真因調査、削除ボタン経路 + preload try-catch deep read）— general-purpose タイプ
  - **Sub-agent 3**: タスク 1+2 実装（renderer.js + main.js + dual-sync.js + 新規テストファイル）— general-purpose タイプ
- タスク 5（バージョン / ビルド / コミット）: CC 直接対応（軽量、順次）
- 各 sub-agent への prompt にファイルパス / 関数名 / 既存 Fix 確定事項を明示的 include（親 context は子に見えないため）
- ファイル競合の注意点（タスク 1 と 2 がどちらも renderer.js を触る）→ Sub-agent 3 に統合することで競合回避

公式 Agent Teams 推奨数（3〜5 teammates）の安全側 3 体を採用、`cc-operation-pitfalls.md §1.1` 準拠。

---

## 9. 構築士への質問

1. **問題 ④ の修正案 A 採用判断**: §5.4 案 A（`_handleTournamentNewImpl` / `_handleTournamentDuplicateImpl` 末尾で `tournamentTitle.readOnly/.disabled/.removeAttribute` を明示クリア）を rc18 で実装する方針で構築士の合意を求めます。**ただし真因 (a) vs (b) の切り分けに DevTools 実機観測が必須**（§5.6 補足）。前原さんに rc17 試験時に 4 つの DevTools Console コマンド実行を依頼するか、または rc18 直行（案 A 実装）か、判断を仰ぎます。**CC 推奨: rc17 試験時に観測依頼 → rc18 で案 A 実装**（観測結果次第で CSS / focus race の追加対応も検討可能）。

2. **問題 ③ の案 A + B 併用判断**: §4.3 案 A（dialog open ガード 1 行）+ 案 B（例外可視化 5〜8 行）併用を rc18 で実装する方針で構築士の合意を求めます。**致命バグ保護 5 件への影響ゼロ**。**CC 推奨: 案 A + B 併用**（案 B の `'renderer:tournament-delete-error'` ラベルは rolling ログで自動観測ツールとして将来も有効）。

3. **問題 ① 計測ビルド rc18-A の必要性判断**: 修正案 ②-1（rc17）は静的解析で真因確定済の問題 ② のみを修正したため、問題 ①（hall/AC タイムラグ「すごく重い」）は依然残存の可能性。rc17 の常時 3 ラベル（`timer:state:send` / `timer:state:recv:hall` / `render:tick:hall`）で本配布版でも観測可能になったため、**rc17 試験で前原さんが「重い」体感を再評価し、ログ提出 → CC 解析でレイテンシ実測**するアプローチが軽量と判断します。**CC 推奨: rc17 試験で rolling ログ採取 → 解析 → 残存なら rc18 で問題 ①③④ 統合修正**。

4. **問題 ④ テスト盲点の補強**: §5.5 で示した通り、`tournamentTitle` の編集可能性検査が 0 件であったことが見逃しの構造原因。rc18 案 A 実装時に jsdom ベース動的テスト追加（`_handleTournamentNewImpl` 実行後の `el.tournamentTitle.readOnly === false` assertion 等）を構築士に提案します。**CC 推奨: rc18 タスクに「jsdom テスト追加」を含める**。

---

## 10. 一時計測ログ挿入の確認

**本フェーズで挿入したログは「一時的計測」ではなく「常時記録 3 ラベル」**（NEXT_CC_PROMPT §2.1 タスク 2 仕様）。

- `timer:state:send` / `timer:state:recv:hall` / `render:tick:hall` の 3 ラベルは **配布版にも常時記録**として組込み済（rc16 CC_REPORT §4.3 構築士質問 #4 で構築士が採用した方針）
- **削除予定なし**（本配布後の障害発生時の自動観測ツールとして恒久的に維持）
- 計測ビルド限定 12 ラベル階層（rc16 CC_REPORT §4.3 案 P）は **rc17 では実装せず**（問題 ① で必要となった場合に rc18-A 計測ビルドで投入予定）

タスク 1 / 2 で本フェーズ内に挿入した一時的計測ログは**ゼロ件**（すべて常時記録設計）。

---

## 11. スコープ管理の自己申告

NEXT_CC_PROMPT.md の指示外の調査・実装を一切行っていません:

- **タスク 1（実装）**: §1.1 修正案 ②-1 の 1 行追加 + 説明コメント 1 行のみ。それ以上のリファクタなし
- **タスク 2（実装）**: §2.1 ラベル 3 個（`timer:state:send` / `timer:state:recv:hall` / `render:tick:hall`）の挿入のみ。新規 IPC 追加なし、既存 rolling ログ機構流用
- **タスク 3 / 4（実装ゼロ厳守）**: 真因仮説検証 + 修正案提示のみ、修正コード書かず（cc-operation-pitfalls.md §1.3 準拠）
- **タスク 5（実装）**: package.json bump + CHANGELOG + 既存テスト追従（version 期待値 8 ファイル更新、これは各 rc 標準パターン）+ ビルド + コミットのみ
- **「念のため」修正・hard-coded 値・特定入力 workaround は一切提示していません**
- 発見した別問題（問題 ④ の **テスト盲点** = `tournamentTitle` 検査未存在）は §5.5 と §9 質問 4 に「rc18 タスクへの提案」として記載のみ、本フェーズでの実装は無し

---

**rc17 実装 + 真因調査完了**。

- タスク 1（PAUSED time-shift 同期）: 修正案 ②-1 実装、テスト T1〜T4 PASS
- タスク 2（常時 3 ラベル rolling ログ）: 3 ラベル実装、テスト T5〜T8 PASS
- タスク 3（問題 ③ 真因調査）: 最有力候補 ③-3（dialog open 中の二重 showModal）特定、修正案 A+B 併用推奨
- タスク 4（問題 ④ 真因調査・最優先）: **真因確定**（致命級の対象オブジェクト誤認、`ensureEditorEditableState` は元から `tournamentTitle` を救わない設計）、修正案 A 推奨
- タスク 5（バージョン / CHANGELOG / ビルド / コミット）: 全 540 件 PASS、ビルド成功（82.9 MB）、コミット作成
- 致命バグ保護 5 件: 全件影響なし or C.2.7-D 強化方向
- 並列 sub-agent: 3 体（公式上限）

構築士は本 CC_REPORT を採点 → 前原さんに翻訳説明 → rc17 試験（問題 ② 解決確認 + 問題 ① 体感再評価 + 問題 ③④ DevTools 観測依頼） → 結果次第で **rc18 で問題 ③④ 修正 → v2.0.4 final 本配布判断**。
