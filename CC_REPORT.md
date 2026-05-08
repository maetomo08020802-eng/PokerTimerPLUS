# CC_REPORT — 2026-05-09 v2.1.11 hall 自前 60fps tick 再導入（v2.1.10 設計ミスの構造的根治）+ 配布完了

## §1 サマリ

NEXT_CC_PROMPT v2.1.11 通り、前原さん 2 画面実機 v2.1.10 試験中に発覚した「会場モニターのカウントダウン進まず + BREAK 中タイマーカクカク」を構造的根治し、GitHub Releases で v2.1.11 を Latest として公開済。前原さん v2.1.10 端末で自動更新が走る環境が整いました。

| 項目 | 内容 |
|---|---|
| 修正ファイル数 | 4（renderer.js / package.json / CHANGELOG.md / tests/v222-hall-rAF-reduction.test.js）+ tests/v223 新規 + 既存 33 テストの version assertion 更新 |
| 並列 sub-agent / Task 数 | **0 体**（直接実行、cc-operation-pitfalls §1.1 / §4.2 準拠） |
| 全テスト件数 | **893 件 PASS / 0 件 FAIL**（v2.1.10 882 - v222 T4 削除 1 + v223 新規 12） |
| 致命バグ保護 5 件 | **5 件すべて影響なし**（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8） |
| v2.1.6/2.1.7/2.1.8/2.1.9/2.1.10 機構 | **完全保持**（Fix 2 廃止のみ撤回、Fix 1 hall ガード + Fix 3 計測機構は完全保持） |
| ビルド成果物 | `dist/pokertimerplus-setup-2.1.11.exe`（82,995,500 bytes、約 82.99 MB）+ `dist/latest.yml`（version 2.1.11） |
| Release URL | <https://github.com/maetomo08020802-eng/PokerTimerPLUS/releases/tag/v2.1.11> |
| publishedAt | `2026-05-08T15:52:56Z` |

---

## §2 事前調査結果（NEXT_CC_PROMPT 必須 5 項目 + 構築士仮説の独立検証）

### A. v2.1.10 hall 経路の現状コード網羅

| ファイル / 関数 | 検証結果 |
|---|---|
| `renderer.js:1376-1460` `applyTimerStateToTimer` | hall 経路は setState 1 回呼出のみ、独立 rAF 起動なし。v2.1.10 で「broadcast 受信時のみ DOM 更新」設計に変更済 |
| `renderer.js:2569-2606` `applyHallPreStartState` | broadcast 受信時に `renderHallPreStartTick()` を 1 回呼出（再帰なし）|
| `renderer.js:2612-2637` `renderHallPreStartTick` | v2.1.10 で再帰 rAF 削除済（`hallPreStartState.rafId = requestAnimationFrame(...)` の行が消えており、コメントで「次の broadcast 受信時に再度この関数が呼ばれる経路に変更」と記載）|
| `renderer.js:470` `hallPreStartState` 定義 | rafId フィールド維持（v2.1.10 では never set だが defense-in-depth 残置）|

### B. operator 側 broadcast 経路（破綻の物理的根拠）

| 場所 | 内容 |
|---|---|
| `renderer.js:1962` `onPreStartTick` 内の throttle | `if (now - _preStartTickLastSentAt >= 1000)` で 1 秒粒度に間引き → PRE_START broadcast 頻度 = 1Hz |
| `renderer.js:1675-1709` subscribe コールバック | `schedulePersistTimerState()` は `state.status` / `currentLevelIndex` / PAUSED.remainingMs / IDLE.remainingMs/totalMs **変化時のみ** 発火 → RUNNING の毎フレーム remainingMs 変化では発火しない |
| `renderer.js` `startPeriodicTimerStatePersist` | 5 秒間隔の `periodicPersistAllRunning` で fallback persist → broadcast |
| `dual-sync.js:_bufferDiff` (v2.1.9 + v2.1.10) | rAF flush + 計測機構、buffer 機構は無変更維持 |

→ **構築士仮説と完全一致**: RUNNING/BREAK 中の broadcast は実質 5 秒粒度（periodic）→ hall 描画も 5 秒粒度になり「カクカク」「進まず」症状が物理的必然。

### C. timer.js の DOM 更新経路（hall でなぜ必要か）

| 関数 | 動作 | hall への影響 |
|---|---|---|
| `tick()` (timer.js:334) | `setState({ remainingMs })` を毎フレーム呼出 → subscribe で renderTime 発火 | hall は v2.1.10 で `if (!isHallApply) timerStartAtLevel(...)` ガードで startLoop 起動を skip → tick() は呼ばれず → `setState({ remainingMs })` も呼ばれず → renderTime も発火しない |
| `preStartTick()` (timer.js:306) | `setState({ remainingMs })` を毎フレーム呼出 + `handlers.onPreStartTick(remainingMs)` | 同上、hall では startPreStartLoop 起動なし → preStartTick も呼ばれず |

**v2.1.11 設計の中核**: hall 側で operator の timer.js を起動する代わりに、hall 専用の自前 60fps rAF（`renderHallTickFrame` / `renderHallPreStartTick`）が `Date.now()` から remainingMs を計算して `setState({ remainingMs })` を呼出 → subscribe → renderTime / renderNextBreak が DOM 更新する経路を構築。

### D. main.js timerState destructure 経路（C.2.7-D 致命バグ保護の再検証）

| 検証項目 | 結果 |
|---|---|
| `main.js` の `tournaments:setDisplaySettings` ハンドラ | 既存通り、payload から `timerState` を destructure 除外（C.2.7-D 維持）|
| `_dualStateCache` 構造 | v2.1.6 で追加された `preStartState: null` フィールド + 既存 timerState/structure/displaySettings 等、変更なし |
| v2.1.11 で broadcast payload に新フィールドを追加するか | **追加しない**（既存 timerState payload から hall 側で startedAtMs を `Date.now() + remainingMs` で算出可能、operator 側変更不要）|

→ main.js / preload.js / dual-sync.js / timer.js / audio.js すべて完全無変更。**hall 側 renderer.js のみで完結する設計**。

### E. 既存テストへの影響評価

| テストファイル | 影響 | 対応 |
|---|---|---|
| `v218-prestart-hall-sync.test.js` | T9 で `function renderHallPreStartTick(` を必須化 + `hallPreStartState` 必須 | **無影響**（v2.1.11 で renderHallPreStartTick を rAF 復活、hallPreStartState 維持）|
| `v219-hall-atomic-update.test.js` | dual-sync buffer 機構は v2.1.11 で無変更 | **無影響** |
| `v220-prestart-audio-hall-guard.test.js` | hall ガード（handleAudioOnTick / playSound）機構は v2.1.11 で無変更 | **無影響** |
| `v221-rAF-flush.test.js` | dual-sync flush は v2.1.11 で無変更 | **無影響** |
| `v222-hall-rAF-reduction.test.js` | T4 が「rAF 駆動部分削除」を検証 → v2.1.11 撤回で破壊 | **T4 削除**（履歴は CHANGELOG / git log で参照可、代替検証は v223 T5）。T1-T3 / T5-T7 は維持・version 更新で PASS |

### F. 構築士仮説への補完（CC 独立論証）

> 「broadcast 受信頻度の物理限界を考慮した設計か」を CC が自分の言葉で論証

**構築士仮説**: v2.1.10 の `broadcast 受信時に即時 DOM 更新` 設計が、broadcast 物理頻度（PRE_START 1Hz / RUNNING 5 秒粒度）の限界で破綻 → hall の表示更新が出来ない。

**CC の論証**:
1. operator → hall の IPC は throttle/debounce で意図的に間引かれている（v2.1.6 / v2.1.7 で IPC flood 防止のために設計済）。これは既存の不変条件であり、変更してはいけない（プロンプト「operator 側経路の修正禁止」も合致）。
2. hall 側で 60fps 描画を実現するには、broadcast から得られる seed（`startedAtMs = Date.now() + remainingMs` を IPC 受信時に算出）を保持し、自前 rAF で毎フレーム `Date.now()` から残り時間を計算する以外に方法がない。
3. 自前 rAF の `setState({ remainingMs })` 呼出は subscribe → renderTime / renderNextBreak の経路を発火 → 既存の DOM 更新パイプライン（v1.x からの機構）を再利用可能。
4. operator 側の timer.js 関数（startLoop 等）は v2.1.10 Fix 1 の hall ガードで skip 維持されるため、hall 側で operator の rAF を起動するのではなく、**hall 専用の rAF を新設する**のが正しい。
5. この設計は v2.1.6 の `renderHallPreStartTick`（PRE_START 限定）を **RUNNING / BREAK にも拡張する** 形であり、新規発明ではなく **既存パターンの汎化**。物理頻度の限界に対する正しい工学的解。

→ **構築士仮説に完全同意 + 補完なし**。設計は実コード根拠 + 物理的必然性で確定。

### G. 致命バグ保護 5 件 cross-check

| 保護 | 関連箇所 | 影響評価 |
|---|---|---|
| C.2.7-A `resetBlindProgressOnly` | renderer.js | 修正対象は `applyTimerStateToTimer` の hall 経路のみ。`resetBlindProgressOnly` 関数本体・呼出経路は完全無変更。v223 T10 で再検証 |
| C.2.7-D `timerState` destructure 除外 | main.js | main.js 完全無変更、broadcast payload 拡張なし |
| C.1-A2 `ensureEditorEditableState` | renderer.js | 編集モード経路は本修正範囲外 |
| C.1.7 AudioContext resume | audio.js | audio.js 完全無変更 |
| C.1.8 runtime 永続化 | main.js | main.js 完全無変更、`schedulePersistRuntime` 8 箇所維持（v223 T10 で確認） |

→ **5 件すべて完全無傷**。

---

## §3 各 Fix の実装内容（diff 要点）

### Fix A: `renderer.js` `applyTimerStateToTimer` hall 経路 → seed 更新 + renderHallTickFrame 起動

```diff
   if (!ts || typeof ts !== 'object') {
     el.clock?.classList.remove('clock--timer-finished');
     if (!isHallApply) timerReset();
+    else stopHallTickFrame();
     return;
   }
   if (ts.status === 'idle') {
     ...
     if (!isHallApply) timerReset();
     else {
+      stopHallTickFrame();
       try { ... setState({ status: States.IDLE, ... }); } catch (_) {}
     }
     return;
   }
   if (ts.status === 'finished') {
     if (!isHallApply) timerReset();
     else {
+      stopHallTickFrame();
       try { setState({ status: States.IDLE, remainingMs: 0 }); } catch (_) {}
     }
     ...
   }
   ...
   if (levelCount === 0) {
     if (!isHallApply) timerReset();
+    else stopHallTickFrame();
     return;
   }
   ...
   if (!isHallApply) {
     timerStartAtLevel(idx); ...
   } else {
-    // v2.1.10: setState 1 回のみ
-    setState({ currentLevelIndex: idx, remainingMs, totalMs, status });
+    // v2.1.11: seed 更新 + renderHallTickFrame 起動（PAUSED は rAF 停止）
+    setState({ currentLevelIndex: idx, remainingMs, totalMs, status });
+    hallTickState.status = status;
+    hallTickState.currentLevelIndex = idx;
+    hallTickState.totalMs = totalMs;
+    hallTickState.startedAtMs = Date.now() + remainingMs;
+    if (status === States.RUNNING || status === States.BREAK) {
+      if (hallTickState.rafId !== null) { cancelAnimationFrame(hallTickState.rafId); hallTickState.rafId = null; }
+      hallTickState.isActive = true;
+      renderHallTickFrame();
+    } else {
+      stopHallTickFrame();
+    }
   }
```

### Fix B: `renderer.js` `renderHallTickFrame()` 関数新規追加

```javascript
function renderHallTickFrame() {
  if (typeof window === 'undefined' || window.appRole !== 'hall') return;
  if (!hallTickState.isActive) return;
  if (hallTickState.status !== States.RUNNING && hallTickState.status !== States.BREAK) {
    hallTickState.isActive = false;
    hallTickState.rafId = null;
    return;
  }
  const now = Date.now();
  const remainingMs = Math.max(0, hallTickState.startedAtMs - now);
  try { setState({ remainingMs }); } catch (_) {}
  if (remainingMs <= 0) {
    hallTickState.isActive = false;
    hallTickState.rafId = null;
    return;
  }
  hallTickState.rafId = requestAnimationFrame(renderHallTickFrame);   // 自己再帰
}
```

### Fix C: `renderer.js` `hallTickState` + `stopHallTickFrame()` 新規追加

```javascript
const hallTickState = {
  isActive: false,
  status: 0,
  currentLevelIndex: 0,
  totalMs: 0,
  startedAtMs: 0,       // Date.now() 基準の終了予定時刻
  rafId: null
};
function stopHallTickFrame() {
  if (hallTickState.rafId !== null) {
    cancelAnimationFrame(hallTickState.rafId);
    hallTickState.rafId = null;
  }
  hallTickState.isActive = false;
}
```

### Fix D: `renderer.js` `renderHallPreStartTick` の rAF 自己再帰復活

```diff
   if (remainingMs <= 0) {
     hallPreStartState.isActive = false;
+    hallPreStartState.rafId = null;
     return;
   }
-  // v2.1.10: 旧 rAF 廃止、次の broadcast 受信時に再度この関数が呼ばれる経路に変更。
+  // v2.1.11: 自己再帰 rAF で次フレームへ（v2.1.6 同等）
+  hallPreStartState.rafId = requestAnimationFrame(renderHallPreStartTick);
 }
```

### Fix E: 停止条件の網羅（Fix A 内に統合）

- `!ts || typeof ts !== 'object'` → `stopHallTickFrame()`
- `ts.status === 'idle'` → `stopHallTickFrame()` + setState IDLE
- `ts.status === 'finished'` → `stopHallTickFrame()` + setState IDLE 0
- `levelCount === 0` → `stopHallTickFrame()`
- `live.status === 'paused'` → status PAUSED で `stopHallTickFrame()` 経由（rAF 停止 + 静止表示）
- v223 T7 で 4 件以上の停止経路網羅を静的検証済

### Fix F: operator 側 broadcast の throttle 保持（変更なし）

`renderer.js:1962` の `_preStartTickLastSentAt >= 1000` 1 秒間引き → 完全保持（v223 T9 で再検証）。

### Fix G: package.json + CHANGELOG + 新規テスト

- `package.json`: `"version": "2.1.10"` → `"version": "2.1.11"`、`scripts.test` に `v223-hall-60fps-restore.test.js` 追加
- `CHANGELOG.md`: `[2.1.11]` セクションを `[2.1.10]` の上に挿入（Fixed / Internal / Tests / Compatibility / Known Limitations）
- `tests/v223-hall-60fps-restore.test.js`: 新規 12 件
- `tests/v222-hall-rAF-reduction.test.js`: T4 削除（v2.1.10 「rAF 廃止」検証は v2.1.11 で撤回）

---

## §4 設計判断: 案 B（分離維持）採用根拠

NEXT_CC_PROMPT は案 A（統合: hallTickState 一本化、PRE_START を `renderHallTickFrame` に統合）を推奨。CC が事前調査で**案 B（分離維持: hallPreStartState + renderHallPreStartTick を保持、hallTickState + renderHallTickFrame を別途追加）を採用**した根拠:

1. **既存テスト互換性**: `tests/v218-prestart-hall-sync.test.js` T9 が `const hallPreStartState =` と `function renderHallPreStartTick(` の両方を必須としている。案 A で hallPreStartState を廃止するとこれらが破壊され、T9 を更新する作業が追加発生。一方、案 B では既存テストを完全保持しつつ新規追加のみで完結 → 修正範囲最小化 + リグレッションリスク低下。
2. **状態オブジェクトの責務分離**: PRE_START は `getState().status === IDLE` のまま `el.clockTime.textContent` 直書き / RUNNING/BREAK は `setState({ remainingMs })` で subscribe → renderTime 経路 という DOM 更新方法の本質的な違いがある。1 つの関数に分岐を詰め込むと条件分岐が増えて読みにくくなる。
3. **rAF handle 管理**: PRE_START と RUNNING/BREAK は同時に発生しない（PRE_START → RUNNING の自動遷移）ため、別の handle を持っても同時に 2 個動くことはなく、handle 管理オーバーヘッドは無視可能。

→ 案 B 採用、CC_REPORT §3 で diff 要点を提示済。

---

## §5 テスト結果

```
全テスト件数: 893 PASS / 0 FAIL
  - 既存 882 件（v2.1.10 時点）
  - v222 T4 削除（-1）= 881
  - v223 新規 12 件（+12）= 893
  - 既存 33 ファイルの version assertion 更新（実体は同一テストの version 値変更のみ、件数増減なし）

実行コマンド: npm test
所要時間: 約 25 秒
```

主要関連ファイル個別確認:
- v218 (PRE_START hall sync): 13 PASS（T9 で `renderHallPreStartTick` 関数 + `hallPreStartState` 保持確認）
- v219 (hall atomic update): 9 PASS（dual-sync buffer 完全保持）
- v220 (PRE_START / audio hall guard): 8 PASS（hall ガード機構保持）
- v221 (rAF flush): 8 PASS（v2.1.9 機構保持）
- v222 (hall rAF reduction): 6 PASS（T4 削除済、T1-T3/T5-T7 で v2.1.10 Fix 1 + Fix 3 保持確認）
- v223 (hall 60fps restore): **12 PASS**（v2.1.11 専用、12 件全件 GREEN）

---

## §6 main マージ + タグ + push 結果 + ビルド成果物

```
git checkout -b feature/v2.1.11-hall-60fps-restore → 実装 → コミット a97f23d
git checkout main && git merge --no-ff feature/v2.1.11-hall-60fps-restore → bcf658d
git tag -a v2.1.11
npm run build → dist/pokertimerplus-setup-2.1.11.exe + dist/latest.yml
git push origin main → bcf658d push 完了
git push origin v2.1.11 → タグ push 完了
```

最新 main 履歴:
- `bcf658d` Merge v2.1.11 hall 60fps tick restore (v2.1.10 設計ミスの構造的根治)
- `a97f23d` v2.1.11: hall 自前 60fps tick 再導入（v2.1.10 設計ミスの構造的根治）
- `c03bdc8` v2.1.10: CC_REPORT 執筆
- `9288fe4` Merge v2.1.10 hall rAF reduction + measurement instrumentation
- `f2de1ae` v2.1.10: hall window rAF 競合解消（4 → 1）+ 計測機構同梱

ビルド成果物:
```
dist/pokertimerplus-setup-2.1.11.exe   82,995,500 bytes (約 82.99 MB)
dist/latest.yml                        version: 2.1.11
                                       sha512: RrEn4KgAVTw6w0rQTKiJIUFlEfynqOCNJ96sml3qXuCH9IhMePX+TwbePA4yZSTLa/G9dSHlnomt2kOxYSb5Kw==
                                       releaseDate: 2026-05-08T15:52:16.224Z
```

---

## §7 GitHub Releases 公開結果

```
$ gh release create v2.1.11 --title "v2.1.11 - hall 自前 60fps tick 再導入（v2.1.10 設計ミスの構造的根治）" \
    --notes-file .release-notes-v2.1.11.md --latest \
    dist/pokertimerplus-setup-2.1.11.exe dist/latest.yml
https://github.com/maetomo08020802-eng/PokerTimerPLUS/releases/tag/v2.1.11
```

検証結果:

| 確認ポイント | 結果 | 値 |
|---|---|---|
| `tagName == "v2.1.11"` | ✅ | `v2.1.11` |
| `name == "v2.1.11 - hall 自前 60fps tick 再導入（v2.1.10 設計ミスの構造的根治）"` | ✅ | 一致 |
| `isLatest == true` | ✅（代替確認）| `gh api repos/.../releases/latest --jq .tag_name` → `v2.1.11` |
| `assets` 2 件 | ✅ | `pokertimerplus-setup-2.1.11.exe`（82,995,500 bytes）+ `latest.yml`（359 bytes）|
| `publishedAt` 時刻入り | ✅ | `2026-05-08T15:52:56Z` |
| `curl latest.yml` 冒頭 `version: 2.1.11` | ✅ | 取得成功 + sha512 一致（v2.0.11 真因 1 / 2 の再発なし） |

一時ファイル `.release-notes-v2.1.11.md` 削除済。

---

## §8 試験項目別の前原さん確認手順（v2.1.11 実機）

| # | 操作 | 期待結果 |
|---|---|---|
| 1 | 2 画面 PRE_START 中、会場モニターのカウントダウン表示 | **滑らかに減る**（60fps、v2.1.6 同等） |
| 2 | 2 画面 BREAK 中、会場モニターのタイマー表示 | **滑らかに減る**（60fps、カクカク消失） |
| 3 | 2 画面 RUNNING 中、5 秒前カウントダウン音と表示 | **音と表示がほぼ同時**（v2.1.9 課題も解消、自前計算で broadcast 待たない） |
| 4 | アプリ全体の動作の重さ感覚 | **「アプリ重い」感覚消失**（rAF 同時 2 個に削減: renderHallTickFrame + dual-sync flush） |
| 5 | PAUSED 中の time-shift 操作 | hall 側も即時反映（seed 受信時に startedAtMs 補正、停止表示）|
| 6 | 2 画面トーナメント切替 | v2.1.7 同様、チラつかず一発切替 |
| 7 | 2 画面 PRE_START + スライドショー終了 | v2.1.8 同様、即時カウントダウン表示 |
| 8 | 2 画面 5 秒前カウント音 | v2.1.8 同様、「ポン」1 音だけ（hall ガード維持）|
| 9 | 単画面モード | 完全に従来挙動（hallTickState は appRole !== 'hall' で no-op）|
| 10 | HDMI 抜き差し | 致命バグ保護 5 件すべて維持 |
| 11 | 会場モニターのスライドショー切替ボタン | v2.1.9 同様、表示 + 動作 |
| 12 | （試験で問題発生時）`Ctrl+Shift+L` でログ採取 | 計測機構が rAF 状況を記録 |

特に **試験 1 / 2 / 3 / 4** が今回の根治確認の本丸。

---

## §9 致命バグ保護 5 件 cross-check（再掲、v2.1.11 でも完全無傷）

| 保護 | 検証 | 静的検証 |
|---|---|---|
| C.2.7-A `resetBlindProgressOnly` | renderer.js 関数定義維持、操作経路 touch なし | v223 T10 / v218 T12 |
| C.2.7-D `timerState` destructure 除外 | main.js 完全無変更 | v223 T10 |
| C.1-A2 `ensureEditorEditableState` | renderer.js 編集経路 touch なし | v218 T12 |
| C.1.7 AudioContext resume | audio.js 完全無変更 | v223 T10 |
| C.1.8 runtime 永続化 | main.js 完全無変更、`schedulePersistRuntime` 8 箇所維持 | v223 T10 |

---

## §10 リスク評価 + Known Limitations

### リスク評価

| リスク | 評価 | 対策 |
|---|---|---|
| hall 側 rAF が止まらない | 低 | 4 件以上の停止経路（!ts/idle/finished/levelCount===0/PAUSED）すべてで `stopHallTickFrame()` 呼出、v223 T7 で網羅 |
| operator との時刻ドリフト | 低 | 5 秒粒度の `periodicPersistAllRunning` で fresh seed 受信 → startedAtMs 再 base、ドリフト幅は IPC レイテンシ（数十 ms）以下 |
| 同時 rAF 数増加 | 低 | hall window で同時 2 個（renderHallTickFrame + dual-sync flush）= v2.1.10 設計目標達成、v2.1.10 以前の 4 個より良好 |
| 単画面モードへの影響 | 低 | hallTickState は `appRole !== 'hall'` で `renderHallTickFrame` 早期 return → 単画面モードでは初期化以外何もしない |
| PAUSED 中 time-shift の hall 反映 | 低 | operator setState({status:PAUSED, remainingMs}) → broadcast → hall applyTimerStateToTimer で setState 即時反映、停止表示更新 OK |

### Known Limitations（CHANGELOG にも記載）

- B3 ブレイク終了 pauseAfterBreak 反映漏れ → v2.1.12 候補
- 計測機構（v2.1.10 で同梱した `hall:dualSync:*` ログ）は本リリースでも保険として保持、試験で問題なければ削除判断（v2.1.12 で構築士判断仰ぐ）
- hall 側 startedAtMs は IPC 受信時の Date.now() ベース → operator との時刻ドリフトは IPC レイテンシ（数十 ms）+ periodicPersistAllRunning の 5 秒粒度補正で許容範囲

---

## §11 並列 sub-agent / Task 数報告（cc-operation-pitfalls §4.2 準拠）

- **0 体**（直接実行）
- 公式 Agent Teams 推奨上限 3 体に対し未起動、§1.1 違反なし
- 事前調査で renderer.js / dual-sync.js / timer.js / main.js / 全テストファイルを Read tool 直列で確認、context 統合不要

---

## §12 オーナー向け確認

1. **会場モニターのカウントダウン表示は滑らかになりましたか？**: 試験 1 / 2、特に PRE_START と BREAK 中の表示。「進まない」「カクカク」が消えていれば根治確定。
2. **音と表示のタイミングはどうですか？**: 試験 3、5 秒前カウントダウンで音と画面の数字がほぼ同時に変化していますか？
3. **アプリ全体の動作の重さは？**: 試験 4、v2.1.10 で出ていた「重い」感覚は消えていますか？
4. **既存機能は壊れていない？**: 試験 6-11、トーナメント切替・スライドショー・ボタン表示・音などすべて従来通りに動きますか？
5. **自動更新で v2.1.10 → v2.1.11 が降ってきますか？**: <https://github.com/maetomo08020802-eng/PokerTimerPLUS/releases/tag/v2.1.11> にアセットが揃っているので、v2.1.10 端末を起動すると自動検出されます。
6. **問題が出たら**: 会場モニター画面で `Ctrl + Shift + L` を押すと、`hall:dualSync:*` ラベル含むログが採取されます。構築士に送付してください。

**v2.1.11 配布完了**。前原さんの実機試験で BREAK カクカク + PRE_START 進まずが解消できれば v2.1.10 設計ミスは構造的根治、計測機構の削除可否は v2.1.12 で構築士判断。
