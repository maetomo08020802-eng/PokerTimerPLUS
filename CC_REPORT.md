# CC_REPORT — 2026-05-08 v2.1.10 hall window rAF 競合解消（4 → 1）+ 計測機構同梱

## §1 サマリ

NEXT_CC_PROMPT v2.1.10 通り、前原さん 2 画面実機で v2.1.9 試験中に発見された「会場モニターが音より約 1 秒遅れる + アプリ全体が重く感じる」症状を根治。

真因は hall window で **3〜4 個の独立 rAF ループ**（timer.js tick / preStartTick / renderHallPreStartTick / dual-sync flush）が同時回転 → 1 フレーム予算（16.7ms）超過 → frame skip → 累積遅延 1 秒。

修正方針 = **案 3 細分化 + 案 6 + 計測機構同梱**:
1. **案 3 細分化**（Fix 1）: `applyTimerStateToTimer` 内の timer.js 関数呼出（reset / startAtLevel / advanceBy / pause）のみ hall ガードで skip。**DOM 描画 / setState 直接呼出は hall でも続行**（subscribe → renderTime / renderNextBreak 経路維持）。完全 skip すると hall タイマー表示が固まるため絶対禁止。
2. **案 6**（Fix 2）: hall 専用 `renderHallPreStartTick` の独立 rAF 駆動部分を削除。broadcast 受信時の即時 1 回 DOM 更新で代替（operator は 1 秒間引き broadcast、PRE_START 表示単位 = 分:秒なので秒粒度で十分）。
3. **計測機構**（Fix 3）: hall 限定で IPC 受信 / dual-sync flush 所要時間 / frame skip 検出 / DOM 更新タイミングを rolling-log に記録（保険、operator では計測しない）。

| 項目 | 内容 |
|---|---|
| 修正ファイル数 | 4（renderer.js / dual-sync.js / package.json / CHANGELOG.md）+ tests/v222 新規 + 既存 33 テストの version assertion 更新 |
| 並列 sub-agent / Task 数 | **0 体**（直接実行、cc-operation-pitfalls §1.1 / 4.2 準拠） |
| 全テスト件数 | **882 件 PASS / 0 件 FAIL**（v2.1.9 時点 875 + 新規 v222 = 7 件） |
| 致命バグ保護 5 件 | **5 件すべて影響なし**（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8） |
| v2.1.6 / 2.1.7 / 2.1.8 / 2.1.9 機構 | **全機構完全無傷**（v218 / v219 / v220 / v221 全 PASS で静的検証） |
| ビルド成果物 | `dist/pokertimerplus-setup-2.1.10.exe`（82.99 MB） + `dist/latest.yml`（version 2.1.10）|

期待効果（v2.1.10 試験用）: PRE_START 中の同時 rAF **4 → 1**（dual-sync flush のみ）、RUNNING 中 **2 → 1**。1 秒遅延 → 0.05〜0.1 秒、「アプリ重い」感覚消失。

---

## §2 事前調査結果（NEXT_CC_PROMPT 必須 6 項目）

### A. 真因の独立検証（CC が独立 Read で確認）

| # | 場所 | 構築士分析 | CC 独立検証結果 |
|---|---|---|---|
| 1 | `timer.js:297` `tick` rAF | RUNNING/BREAK 中 60fps で再起動 | ✅ 一致（`startLoop()` 内で `rafId = requestAnimationFrame(tick)`）|
| 2 | `timer.js:303` `preStartTick` rAF | PRE_START 中 60fps で再起動 | ✅ 一致（`startPreStartLoop()` 内、`preStartTick` 内でも自己再起動 L322）|
| 3 | `renderer.js:2586` `renderHallPreStartTick` rAF | hall 専用 PRE_START 描画 60fps | ✅ 一致（`hallPreStartState.rafId = requestAnimationFrame(renderHallPreStartTick)`）|
| 4 | `dual-sync.js:104` `_bufferDiff` flush rAF | IPC 受信ごと（v2.1.9 で setTimeout → rAF 切替）| ✅ 一致（`_flushTimer = requestAnimationFrame(...)`）|

→ **構築士分析と完全一致**。PRE_START 中は 4 個同時、RUNNING 中は 2 個同時の rAF 回転を確認。

### B. `applyTimerStateToTimer` 内の timer.js 関数呼出全網羅

ファイル: `src/renderer/renderer.js`、修正前 L1376-1422。grep + balanced-brace 抽出で全件確認:

| 行 | 呼出 | 経路 | hall ガード対応 |
|---|---|---|---|
| L1382 | `timerReset()` | `!ts \|\| typeof ts !== 'object'` | `if (!isHallApply)` で囲み |
| L1387 | `timerReset()` | `ts.status === 'idle'` | `if (!isHallApply)` で囲み + hall 経路で setState 直接呼出 |
| L1394 | `timerReset()` | `ts.status === 'finished'` | `if (!isHallApply)` で囲み + hall 経路で `setState({ status: IDLE, remainingMs: 0 })` |
| L1405 | `timerReset()` | `levelCount === 0` | `if (!isHallApply)` で囲み |
| L1408 | `timerStartAtLevel(idx)` | running/paused/break 経路 | `if (!isHallApply)` ブロック内に集約 |
| L1411 | `timerAdvanceBy(-elapsedMs)` | 同上、経過秒反映 | `if (!isHallApply)` ブロック内に集約 |
| L1412 | `timerPause()` | `live.status === 'paused'` | `if (!isHallApply)` ブロック内に集約 |

合計 **7 箇所**すべて hall ガード適用済。hall 経路では `setState({ currentLevelIndex, remainingMs, totalMs, status })` を直接呼出して subscribe 経路を保持。

### C. `applyTimerStateToTimer` 内の DOM 更新コード網羅（hall でも続行が必須）

| 行 | コード | hall ガードの有無 |
|---|---|---|
| L1381 | `el.clock?.classList.remove('clock--timer-finished')` | **無し**（hall でも実行）|
| L1386 | `el.clock?.classList.remove('clock--timer-finished')` | **無し**（hall でも実行）|
| L1395 | `el.clock?.classList.add('clock--timer-finished')` | **無し**（hall でも実行）|
| L1399 | `el.clock?.classList.remove('clock--timer-finished')` | **無し**（hall でも実行）|
| L1419-1421 | `audioSuppressOnce = true` | hall でも実行（flag 値は意味を持たないが副作用なし）|

→ DOM 更新 4 箇所すべて hall でも続行することで、`<dialog>` / `clock--timer-finished` overlay 等の表示は完全保持。

### D. `renderHallPreStartTick` 廃止後の代替経路（broadcast 1 秒間引き + 即時 DOM 更新）

検証済:
- operator 側 `setHandlers.onPreStartTick` 内で `now - _preStartTickLastSentAt >= 1000` の throttle 経路で 1 秒に 1 回 broadcast（renderer.js L1962）
- hall 側 `applyHallPreStartState` で broadcast 受信時に `renderHallPreStartTick()` を 1 回呼出 → 内部で再帰 rAF を**しない**（v2.1.10 で削除）→ 1 秒粒度の DOM 更新
- PRE_START 表示は分:秒（formatPreStartTime）→ 1 秒粒度で十分滑らか
- edge イベント（onPreStartStart / Cancel / Adjust）は throttle なし即時 broadcast → 即応性維持

### E. 計測機構が hall でのみ動作する保証

検証済:
- `dual-sync.js` に `_isHall()` ヘルパ（`window.appRole === 'hall'` 判定）+ `_logHall(label, payload)` ヘルパ追加
- `_logHall` 冒頭で `if (!_isHall()) return;` → operator では log 書込みなし
- `_recordFlushFrameSkip` も冒頭で同ガード → operator では計測なし
- 計測呼出箇所: `_bufferDiff`（IPC 受信時）/ `_recordFlushFrameSkip`（rAF callback 内）/ `_flushDiffBuffer`（finally で所要時間記録）/ `applyTimerStateToTimer`（renderer.js 入口、`isHallApply` ガード）/ `applyHallPreStartState`（renderer.js 入口、関数全体が `appRole !== 'hall'` 早期 return ガード後に到達）
- `window.api?.log?.write?.()` 経路で fire-and-forget 非同期 IPC（v2.0.4-rc15 の rolling-log 機構を流用、計測自体が遅延を生まない）

### F. 致命バグ保護 5 件 cross-check

| 保護 | 関連箇所 | 影響評価 | 根拠 |
|---|---|---|---|
| C.2.7-A `resetBlindProgressOnly` | renderer.js | **影響なし** | 修正対象は `applyTimerStateToTimer` / `applyHallPreStartState` / `renderHallPreStartTick`、`resetBlindProgressOnly` 関数本体 / 呼出経路は完全無変更。v218 T12 / 既存テストで再確認済 |
| C.2.7-D `timerState` destructure 除外 | main.js | **影響なし** | main.js 完全無変更。v218 T12 / 既存テストで再確認済 |
| C.1-A2 `ensureEditorEditableState` | renderer.js | **影響なし** | 編集モード経路は本修正範囲外 |
| C.1.7 AudioContext resume | audio.js | **影響なし** | audio.js 完全無変更 |
| C.1.8 runtime 永続化 | main.js | **影響なし** | main.js 完全無変更、`schedulePersistRuntime` 8 箇所維持 |

→ **5 件すべて完全無傷**（v218 T12 + v222 T1-T7 で静的再検証済）。

### G. 構築士仮説への補完（CC 独立反論）

構築士の指示文には「DOM 更新 / state 更新は hall でも続ける」とあるが、**現実装では `applyTimerStateToTimer` 内に直接的な DOM 更新は `el.clock?.classList` の 4 箇所のみ**。renderTime / renderNextBreak / renderCurrentLevel / renderControls などの主要 DOM 更新は state.js の subscribe コールバック経由で発火する設計。

つまり timer.js 関数呼出を skip すると、内部の `setState` も呼ばれず subscribe も発火せず → 主要 DOM 更新が止まる。これでは hall タイマー表示が固まる。

**補完設計**: hall 経路では timer.js を介さず、`setState({ currentLevelIndex, remainingMs, totalMs, status })` を直接呼出 → subscribe 経路を保持 → renderTime / renderNextBreak / renderCurrentLevel / renderControls がすべて発火 → DOM 更新は維持。

この設計を Fix 1 の hall 経路（renderer.js:1444-1458）に実装。構築士仮説の枠組みは維持しつつ、現実装の構造に合わせて補完した。

---

## §3 各 Fix の実装内容（diff 要点）

### Fix 1: `src/renderer/renderer.js` `applyTimerStateToTimer` 細分化 hall ガード

```diff
 function applyTimerStateToTimer(ts, levels, opts = {}) {
+  const isHallApply = (typeof window !== 'undefined' && window.appRole === 'hall');
+  if (isHallApply) { try { window.api?.log?.write?.('hall:applyTimerStateToTimer:enter', {...}); } catch (_) {} }
   if (!ts || typeof ts !== 'object') {
     el.clock?.classList.remove('clock--timer-finished');
-    timerReset();
+    if (!isHallApply) timerReset();
     return;
   }
   if (ts.status === 'idle') {
     el.clock?.classList.remove('clock--timer-finished');
-    timerReset();
+    if (!isHallApply) timerReset();
+    else { /* hall: getStructure() の Lv1 duration で setState 直接 */ }
     return;
   }
   if (ts.status === 'finished') {
-    timerReset();
+    if (!isHallApply) timerReset();
+    else { try { setState({ status: States.IDLE, remainingMs: 0 }); } catch (_) {} }
     el.clock?.classList.add('clock--timer-finished');
     return;
   }
   ...
-  if (levelCount === 0) { timerReset(); return; }
+  if (levelCount === 0) { if (!isHallApply) timerReset(); return; }
   ...
-  timerStartAtLevel(idx);
-  if (elapsedMs > 0) timerAdvanceBy(-elapsedMs);
-  if (live.status === 'paused') timerPause();
+  if (!isHallApply) {
+    timerStartAtLevel(idx);
+    if (elapsedMs > 0) timerAdvanceBy(-elapsedMs);
+    if (live.status === 'paused') timerPause();
+  } else {
+    /* hall: timer.js を介さず setState 直接呼出で subscribe → DOM 更新を維持 */
+    const lvl = getLevel(idx);
+    const totalMs = (lvl?.durationMinutes || 0) * 60 * 1000;
+    const remainingMs = Math.max(0, totalMs - elapsedMs);
+    let status; if (live.status === 'paused') status = States.PAUSED;
+    else if (typeof isBreakLevel === 'function' && isBreakLevel(idx)) status = States.BREAK;
+    else status = States.RUNNING;
+    setState({ currentLevelIndex: idx, remainingMs, totalMs, status });
+  }
```

`setState` を `state.js` の既存 export から import 追加（`import { States, getState, setState, subscribe } from './state.js'`）。

### Fix 2: `src/renderer/renderer.js` `renderHallPreStartTick` の rAF 駆動部分削除

```diff
 function renderHallPreStartTick() {
   if (!hallPreStartState.isActive) return;
   const now = Date.now();
   ...
   if (remainingMs <= 0) {
     hallPreStartState.isActive = false;
-    hallPreStartState.rafId = null;
     return;
   }
-  // 次フレームへ
-  hallPreStartState.rafId = requestAnimationFrame(renderHallPreStartTick);
+  // v2.1.10: 旧再帰 rAF を廃止。次の broadcast 受信時に再度この関数が呼ばれる経路に変更
+  //   （applyHallPreStartState 経由）。
 }
```

`applyHallPreStartState` 内では旧 cleanup（`if (hallPreStartState.rafId !== null) cancelAnimationFrame(...)`）を defense-in-depth として残置（v2.1.10 では rafId は never set だが、将来コード経路追加時の安全網）。

### Fix 3: `src/renderer/dual-sync.js` 計測機構同梱（hall 限定）

```javascript
const FRAME_SKIP_THRESHOLD_MS = 25;   // 16.7ms × 1.5 = 25ms 超で frame skip 判定
let _lastFlushFrameAtMs = 0;
function _isHall() { return typeof window !== 'undefined' && window.appRole === 'hall'; }
function _logHall(label, payload) {
  if (!_isHall()) return;
  try { window.api?.log?.write?.(label, payload); } catch (_) {}
}
function _recordFlushFrameSkip() {
  if (!_isHall()) return;
  const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (_lastFlushFrameAtMs > 0) {
    const deltaMs = nowMs - _lastFlushFrameAtMs;
    if (deltaMs > FRAME_SKIP_THRESHOLD_MS) {
      const skipPayload = { deltaMs: Math.round(deltaMs), threshold: FRAME_SKIP_THRESHOLD_MS };
      _logHall('hall:dualSync:frameSkip', skipPayload);
    }
  }
  _lastFlushFrameAtMs = nowMs;
}
```

呼出箇所:
- `_bufferDiff` 冒頭で `_logHall('hall:dualSync:recv', { kind, ts: Date.now() })`
- rAF callback 内で `_recordFlushFrameSkip()` 呼出（`_flushDiffBuffer()` の前）
- `_flushDiffBuffer` finally で `_logHall('hall:dualSync:flush', { durationMs, appliedCount })`
- renderer.js の `applyTimerStateToTimer` / `applyHallPreStartState` 入口に hall 限定の log 呼出

`_recordFlushFrameSkip` は v221 T4 互換性（rAF callback body 抽出 regex の非貪欲一致で `})` パターンを避ける）のため独立関数化。

### Fix 4: `src/renderer/dual-sync.js` の rAF はそのまま維持

v2.1.9 で導入した `requestAnimationFrame` flush 機構は変更なし。Fix 1 / Fix 2 で hall の他の rAF ループを停止することで、dual-sync rAF が単独で動く環境になり frame skip 解消想定。v219 全 9 件 / v221 全 8 件 PASS で機構維持を再確認。

### Fix 5: `package.json` バージョン bump

```diff
-  "version": "2.1.9",
+  "version": "2.1.10",
   ...
-  "test": "... && node tests/v221-rAF-flush.test.js"
+  "test": "... && node tests/v221-rAF-flush.test.js && node tests/v222-hall-rAF-reduction.test.js"
```

### Fix 6: `CHANGELOG.md` v2.1.10 セクション追加

`[2.1.9]` の上に v2.1.10 セクション追加（Fixed / Internal / Tests / Compatibility / Known Limitations）。NEXT_CC_PROMPT 指定通り。

### Fix 7: 既存テストの version assertion 更新

Node script で 33 ファイルの `'2.1.9'` → `'2.1.10'`、`期待 2.1.9` → `期待 2.1.10`、`version は 2.1.9` → `version は 2.1.10`、`version が 2.1.9` → `version が 2.1.10`、`version 2.1.9 + scripts.test` → `version 2.1.10 + scripts.test` を一括置換。v219-hall-atomic-update.test.js は version assertion を持たないため対象外（コメント内の v2.1.9 言及は履歴注記として残置）。

### Fix 8: `tests/v222-hall-rAF-reduction.test.js` 新規作成（7 件）

| # | テスト名 | 検証ポイント |
|---|---|---|
| T1 | `applyTimerStateToTimer` 内で `timerStartAtLevel` に hall ガード | `isHallApply` 変数 + `if (!isHallApply) {...timerStartAtLevel(...)}` |
| T2 | `timerReset / timerAdvanceBy / timerPause` すべてに hall ガード | `timerReset` 4 件すべて `!isHallApply ガード` 済、advanceBy/pause も同ブロック |
| T3 | hall 経路で setState 直接呼出 + DOM 更新は無条件 | `setState({ currentLevelIndex, remainingMs, totalMs, status })` 存在、classList.remove は hall ガードなし |
| T4 | `renderHallPreStartTick` の rAF 駆動部分削除 | コメント剥がし後、`requestAnimationFrame(renderHallPreStartTick)` / `hallPreStartState.rafId = requestAnimationFrame(...)` がない |
| T5 | `applyHallPreStartState` で broadcast 受信時の即時 DOM 更新呼出 | `renderHallPreStartTick()` 呼出 + hall ガード（早期 return）|
| T6 | 計測機構の `_isHall` ガード + 主要記録ラベル | `_isHall` / `_logHall` ヘルパ + `hall:dualSync:recv` / `flush` / `frameSkip` / `applyTimerStateToTimer:enter` / `applyHallPreStartState:enter` ラベル + `FRAME_SKIP_THRESHOLD_MS = 25` |
| T7 | package.json version 2.1.10 + scripts.test に v222 登録 | `PKG.version === '2.1.10'` + `v222-hall-rAF-reduction.test.js` |

---

## §4 テスト結果

```
全テスト件数: 882 PASS / 0 FAIL
  - 既存 875 件（v2.1.9 時点）
  - 新規 v222 7 件
  - 既存 33 ファイルの version assertion 更新（実体は同一テストの version 値変更のみ）

実行コマンド: npm test
所要時間: 約 25 秒
```

主要関連ファイル個別確認:
- v218 (PRE_START hall sync): 13 PASS（T9 で renderHallPreStartTick 関数名互換性確認、T12 致命バグ保護 5 件確認）
- v219 (hall atomic update): 9 PASS（T6 cancelAnimationFrame 経路 + 動的シミュレーション全件）
- v220 (PRE_START / audio hall guard): 8 PASS（致命バグ保護 5 件確認、cancelAnimationFrame 追従）
- v221 (rAF flush): 8 PASS（v2.1.9 機構の static + 動的検証）
- v222 (hall rAF reduction): 7 PASS（v2.1.10 専用テスト全件）

回帰なし、すべての旧機構（v2.1.6 / v2.1.7 / v2.1.8 / v2.1.9）が完全動作することを静的解析で再確認。

---

## §5 main マージ + タグ + push 結果

```
git checkout -b feature/v2.1.10-hall-rAF-reduction → 実装 → コミット f2de1ae
git checkout main && git merge --no-ff feature/v2.1.10-hall-rAF-reduction → マージコミット 9288fe4
git tag -a v2.1.10 -m "..."
git push origin main → main 9288fe4 push 完了
git push origin v2.1.10 → タグ push 完了
```

最新 main 履歴:
- `9288fe4` Merge v2.1.10 hall rAF reduction + measurement instrumentation
- `f2de1ae` v2.1.10: hall window rAF 競合解消（4 → 1）+ 計測機構同梱
- `a4fdb1c` v2.1.9: CC_REPORT 末尾にリリース完了状態を追記
- `a7dbe40` Merge v2.1.9: ...

---

## §6 ビルド成果物確認

```
dist/pokertimerplus-setup-2.1.10.exe  82,995,850 bytes (82.99 MB)
dist/latest.yml                       version: 2.1.10
                                      sha512: l04VdVpldJCgE+Y+0eP+K8mwoxNKuQ90rr2lx6/2O9XlQ4CZHHZD1oMhigrNPn+EGk/f7Oqo9jLuOREBpslpzg==
                                      releaseDate: 2026-05-08T14:36:26.400Z
```

NSIS インストーラビルド完了。GitHub Releases 公開は前原さん次第（タグ push 済なので自動更新は v2.1.9 端末から検知可能）。

---

## §7 試験項目別の前原さん確認手順（v2.1.10 実機）

| # | 操作 | 期待結果 |
|---|---|---|
| 1 | 2 画面モード RUNNING 中、5 秒前カウントダウン音と画面表示 | **音と表示がほぼ同時**（1 秒遅延が消える、目標 0.1 秒以内）|
| 2 | 2 画面モード PRE_START 中、カウントダウン表示 | 1 秒粒度で滑らかに更新（分:秒表示なので秒以下の更新は不要）|
| 3 | アプリ全体の動作の重さ感覚 | **「アプリ重い」感覚が消える**（hall window の rAF 削減効果）|
| 4 | 2 画面モードでトーナメント切替 | v2.1.7 同様、チラつかず一発で切替（atomic update 機構維持）|
| 5 | 2 画面モード PRE_START + スライドショー終了 | v2.1.8 同様、即時カウントダウン表示 |
| 6 | 2 画面モード 5 秒前カウントダウン音 | v2.1.8 同様、「ポン」1 音だけ（hall ガード維持）|
| 7 | 単画面モード（hall なし）の通常運用 | 完全に従来挙動（hall ガードは appRole === 'hall' 判定なので影響なし）|
| 8 | HDMI 抜き差し | 致命バグ保護 5 件すべて維持 |
| 9 | 会場モニターのスライドショー切替ボタン | v2.1.9 同様、表示 + 動作（CSS 削除維持）|
| 10 | （試験で問題発生時）`Ctrl+Shift+L` でログ採取 | 計測機構が rAF 状況を記録 → 構築士提供 |

特に **試験 1 / 3** で「音と表示がほぼ同時」+「アプリの重さ消える」が確認できれば根治確定。

---

## §8 計測機構の使い方（前原さん向け）

会場モニター（hall window）に以下のラベルでログが記録される:

| ラベル | 内容 |
|---|---|
| `hall:dualSync:recv` | IPC 受信のたびに kind と時刻 |
| `hall:dualSync:flush` | dual-sync flush の所要時間（ms）+ 適用件数 |
| `hall:dualSync:frameSkip` | rAF callback 間隔が 25ms を超えたとき（frame skip 検出）|
| `hall:applyTimerStateToTimer:enter` | タイマー状態反映の入口時刻 |
| `hall:applyHallPreStartState:enter` | PRE_START 状態反映の入口時刻 |

### ログ採取手順

1. アプリ起動後、症状を再現（2 画面モードで RUNNING や PRE_START を試す）
2. 会場モニター画面で `Ctrl+Shift+L`（ログをテキストファイルに保存）
3. 保存されたファイルを構築士に提供（メールや LINE で送付）

問題なく動いていれば `hall:dualSync:frameSkip` ラベルが出ない or 件数が極めて少ないはず。逆にこのラベルが多発していれば「まだ rAF が競合している」証拠 → 構築士が解析 → v2.1.11 で追加対策。

**注意**: 計測機構は本リリースで保険として同梱、試験で問題なければ次バージョンで削除判断。

---

## §9 リスク評価 + 致命バグ保護 5 件 cross-check

### リスク評価

| リスク | 評価 | 対策 |
|---|---|---|
| hall 表示がフリーズ | 低 | setState 直接呼出で subscribe 経路を保持、renderTime / renderNextBreak / renderCurrentLevel すべて発火する設計を確認 |
| operator 側の挙動変化 | 極めて低 | hall ガードはすべて `appRole === 'hall'` 限定、operator は既存経路完全維持 |
| 単画面モードの挙動変化 | 極めて低 | 単画面は `appRole === 'operator-solo'` で hall ガードに引っかからない、計測機構も `_isHall()` で skip |
| 計測ログのオーバーヘッド | 極めて低 | hall 限定 + fire-and-forget IPC、`_lastFlushFrameAtMs` のみメモリ消費（数 byte）|
| 旧 `hallPreStartState.rafId` 残存 | 無視可 | v2.1.10 では never set だが defense-in-depth として cleanup ロジックは残置 |
| v2.1.6 PRE_START 同期機能の劣化 | 低 | 1 秒間引き broadcast + 即時 DOM 更新で秒粒度確保、PRE_START 表示単位 = 分:秒なので体感影響なし |

### 致命バグ保護 5 件 cross-check（再掲、v2.1.10 でも完全無傷）

| 保護 | 検証 |
|---|---|
| C.2.7-A `resetBlindProgressOnly` | `function resetBlindProgressOnly\s*\(` 関数定義維持。renderer.js 内の operator ロジック全範囲 touch なし |
| C.2.7-D `timerState` destructure 除外 | `tournaments:setDisplaySettings` ハンドラ維持、main.js 完全無変更 |
| C.1-A2 `ensureEditorEditableState` | 編集モード経路は本修正範囲外、ensureEditorEditableState 4 重防御維持 |
| C.1.7 AudioContext resume | audio.js 完全無変更、suspended 検出 + resume() fire-and-forget 維持 |
| C.1.8 runtime 永続化 | main.js 完全無変更、`schedulePersistRuntime` 8 箇所維持、`tournaments:setRuntime` IPC 維持 |

---

## §10 Known Limitations（v2.1.11 候補）

- B3 ブレイク終了 pauseAfterBreak 反映漏れ → v2.1.11 候補
- 計測機構は本リリースで保険として同梱、試験で問題なければ v2.1.11 で削除判断（CC_REPORT で構築士に判断仰ぐ）

---

## §11 並列 sub-agent 数報告（cc-operation-pitfalls 準拠）

- **並列起動した sub-agent / Task 数: 0 体**
- 全 Fix を直接実行（cc-operation-pitfalls §1.1 上限 3 体に対し 0 体、§4.2 報告義務遵守）
- 事前調査で 6 項目すべて Read tool 直列で確認、context 統合不要

---

## §12 オーナー向け確認

1. **音と表示のズレが消えた？**: 5 秒前カウントダウンで会場モニターと音がほぼ同時になりましたか？（試験項目 1）
2. **会場モニターの動作の重さは消えた？**: アプリ全体が軽快に動くようになりましたか？（試験項目 3）
3. **PRE_START 中の表示は滑らか？**: 「開始まで 0:30」「0:29」「0:28」と 1 秒ごとに自然に減っていますか？（試験項目 2）
4. **既存機能は壊れていない？**: トーナメント切替・スライドショー・ボタン表示・音などすべて従来通り動きますか？（試験項目 4-9）
5. **ログを取りたいときは？**: 問題が出たら `Ctrl + Shift + L` でログを保存して構築士へ送ってください（試験項目 10）。
