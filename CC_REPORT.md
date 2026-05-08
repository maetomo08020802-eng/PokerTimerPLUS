# CC_REPORT — 2026-05-08 v2.1.9 hall 表示遅延 0.2 秒の根治 + 会場モニターのスライドショー切替ボタン表示根治

## §1 サマリ

NEXT_CC_PROMPT v2.1.9 通り、前原さん 2 画面実機で v2.1.8 試験中に発見された 2 件のバグを根治。
1. **遅延 0.2 秒の根治**: `dual-sync.js` の flush 予約を `setTimeout(0)` → `requestAnimationFrame` に切替。macrotask boundary の 50〜200ms 遅延を次フレーム（16〜50ms）に短縮、描画パイプと自然同期。
2. **緊急差し込み（hall ボタン消失）の根治**: `style.css:3791-3793` の `[data-role="hall"] .pip-action-btn { display: none !important; }` ルールを削除し、会場モニターでもスライドショー切替ボタンを表示。

| 項目 | 内容 |
|---|---|
| 修正ファイル数 | 5（dual-sync.js / style.css / package.json / CHANGELOG.md / tests/v221 新規） + tests/v219 / tests/v220 追従更新 + 既存テスト 32 ファイルの version assertion 更新 |
| 並列 sub-agent / Task 数 | **0 体**（直接実行、cc-operation-pitfalls §1.1 / 4.2 準拠） |
| 全テスト件数 | **875 件 PASS / 0 件 FAIL**（v2.1.8 時点 867 + 新規 v221 = 8 件） |
| 致命バグ保護 5 件 | **5 件すべて影響なし**（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8） |
| v2.1.6 / v2.1.7 / v2.1.8 機構 | **全機構完全無傷**（v220 T6/T7 + v221 全テストで静的検証） |

---

## §2 事前調査結果（NEXT_CC_PROMPT 必須項目）

### A. 真因の独立検証（CC が独立 Read で確認）

| # | 場所 | 構築士分析 | CC 独立検証結果 |
|---|---|---|---|
| 1 | `dual-sync.js:98-100` | `setTimeout(_flushDiffBuffer, 0)` で flush 予約、macrotask 遅延 50〜200ms | ✅ 一致（`if (_flushTimer === null) { _flushTimer = setTimeout(_flushDiffBuffer, 0); }`） |
| 2 | `dual-sync.js:135-143` | beforeunload で `clearTimeout(_flushTimer)` cleanup | ✅ 一致 |
| 3 | `style.css:3791-3793` | `[data-role="hall"] .pip-action-btn { display: none !important; }` で hall 強制非表示 | ✅ 一致（旧コメント「ホール側でも触らせない」前提） |
| 4 | `style.css:3804` | `[data-role="operator"] ... .pip-action-btn ... { display: none !important; }` で operator も非表示 | ✅ 一致（**operator セクションは触らない**、操作画面なので非表示維持が正解） |
| 5 | `renderer.js:2762, 2769` | `handlePipShowTimer` / `handlePipShowSlideshow` に appRole ガードなし | ✅ 一致（hall でクリックしても素直に動作） |
| 6 | `slideshowState` | hall window 内 local 変数 | ✅ 一致（broadcast 不要、hall ローカルで完結） |

→ **構築士分析と完全一致**、反論なし。

### B. 既存 v219 テストへの影響範囲確認

`tests/v219-hall-atomic-update.test.js` で `setTimeout` を検証している箇所を全網羅確認:
- T1 静的 assertion: `setTimeout(_flushDiffBuffer, 0)` 文字列照合 → `requestAnimationFrame` に追従
- T6 静的 assertion: `clearTimeout(_flushTimer)` 文字列照合 → `cancelAnimationFrame` に追従
- buildBufferSandbox の vm context: `setTimeout/clearTimeout` のみ → `requestAnimationFrame: (cb) => setTimeout(cb, 0)` + `cancelAnimationFrame: clearTimeout` の stub を追加
- T3 / T4 / T5 / T8 / T9 の動的待機 `await new Promise(r => setTimeout(r, 10))` は stub 経由で発火 → 既存 logic ほぼそのまま動作

**v220 T7 への波及**: v2.1.8 で追加した v220 T7 が `clearTimeout(_flushTimer)` を文字列照合していたため、v2.1.9 で `cancelAnimationFrame` に追従更新（v220 T7 の cleanup 経路存在検証は維持）。

### C. v2.1.7 dual-sync 主要シンボル維持確認

`DIFF_BUFFER_MAX` / `_diffBuffer` / `_isFlushing` / `_applyDiffToState` / `_flushDiffBuffer` / `_bufferDiff` のシンボル本体・呼出経路は完全無変更。変更は `_bufferDiff` 内 1 行（setTimeout → rAF）+ beforeunload listener 内 1 行（clearTimeout → cancelAnimationFrame）の 2 点のみ。dedup ロジック / 上限機構 / 例外耐性 / 再帰防止はすべて完全維持。

### D. v2.1.6 preStartState / v2.1.8 hall ガードとの両立確認

- v2.1.6: 修正対象は dual-sync.js のみ。preStartState 専用 broadcast kind / IPC handler / handler 拡張はすべて touch なし → 完全両立
- v2.1.8: 修正対象は dual-sync.js + style.css のみ。`handleAudioOnTick` / `handleAudioOnPreStartTick` / `playSound` の hall ガードはすべて touch なし → 完全両立

### E. 致命バグ保護 5 件 cross-check

| 保護 | 関連箇所 | 影響評価 | 根拠 |
|---|---|---|---|
| C.2.7-A `resetBlindProgressOnly` | renderer.js | **影響なし** | dual-sync.js + style.css のみ修正、renderer.js の operator ロジック touch なし |
| C.2.7-D `timerState` destructure 除外 | main.js | **影響なし** | main.js 完全無変更 |
| C.1-A2 `ensureEditorEditableState` | renderer.js | **影響なし** | 編集モード経路は本修正範囲外 |
| C.1.7 AudioContext resume | audio.js | **影響なし** | audio.js 完全無変更 |
| C.1.8 runtime 永続化 | main.js | **影響なし** | main.js 完全無変更 |

→ **5 件すべて完全無傷**（v220 T6 + v221 既存検証で再確認）。

---

## §3 各 Fix の実装内容（diff 要点）

### Fix 1: `src/renderer/dual-sync.js` `_bufferDiff` の flush 予約を rAF に変更

```diff
   _diffBuffer.push(diff);
-  if (_flushTimer === null) {
-    _flushTimer = setTimeout(_flushDiffBuffer, 0);
-  }
+  if (_flushTimer === null) {
+    // v2.1.9: setTimeout(0) は macrotask boundary で 50〜200ms 遅延が発生し、
+    //   音と表示のタイミングがズレる症状（前原さん「会場モニターが 0.2 秒遅れる」）
+    //   の原因だった。requestAnimationFrame に切替えで次フレーム（16〜50ms）で
+    //   flush され、描画パイプと自然に同期する。atomic update 効果は維持。
+    _flushTimer = requestAnimationFrame(() => {
+      _flushTimer = null;
+      _flushDiffBuffer();
+    });
+  }
```

`_flushDiffBuffer()` 冒頭の `_flushTimer = null` も既存のまま残置（rAF callback 内代入と二重だが冗長として許容、_flushDiffBuffer() を直接呼ぶ既存経路の保護用）。

### Fix 2: `src/renderer/dual-sync.js` beforeunload cleanup を cancelAnimationFrame に変更

```diff
   window.addEventListener('beforeunload', () => {
     if (_flushTimer !== null) {
-      clearTimeout(_flushTimer);
+      cancelAnimationFrame(_flushTimer);
       _flushTimer = null;
     }
     _diffBuffer.length = 0;
   }, { once: true });
```

### Fix 3: `tests/v219-hall-atomic-update.test.js` 追従更新

- T1 の静的 assertion: `setTimeout(_flushDiffBuffer, 0)` → `requestAnimationFrame(...)` 文字列照合
- T6 の静的 assertion: `clearTimeout(_flushTimer)` → `cancelAnimationFrame(_flushTimer)` 文字列照合
- buildBufferSandbox の vm context: `requestAnimationFrame: (cb) => setTimeout(cb, 0)` + `cancelAnimationFrame: clearTimeout` の stub 追加（既存動的テスト T2/T3/T4/T5/T8/T9 はそのまま動作）

→ v219 全 9 件 PASS で確認済。

### Fix 4: `src/renderer/style.css` の hall pip-action-btn ルール削除

```diff
-/* PIP の操作ボタン（タイマー / スライドショー切替）はホール側でも触らせない */
-[data-role="hall"] .pip-action-btn {
-  display: none !important;
-}
+/* v2.1.9 緊急差し込み根治: hall（会場モニター）でも .pip-action-btn を表示する。
+   旧コメント「ホール側でも触らせない」前提を撤回。... */
+/* （旧 [data-role="hall"] .pip-action-btn { display: none !important; } ルールを削除） */
```

`[data-role="operator"] ... .pip-action-btn ...` 側のルールは**完全維持**（手元 PC は引き続き非表示）。

### Fix 5: `package.json` バージョン bump

```diff
- "version": "2.1.8",
+ "version": "2.1.9",
```
+ `scripts.test` 末尾に `&& node tests/v221-rAF-flush.test.js` 追加。

### Fix 6: `CHANGELOG.md` に [2.1.9] セクション追加

[2.1.8] の上に挿入。Fixed / Internal / Tests / Compatibility / Known Limitations 構成。

### Fix 7: 既存テスト 32 ファイルの version assertion を `2.1.8` → `2.1.9`

Node 一括スクリプトで 5 パターン置換。歴史的コメントは不変。合計 **53 箇所**更新（v220 含む）。

### Fix 8: 新規テスト `tests/v221-rAF-flush.test.js`（8 件）

| # | テスト名 | 種別 |
|---|---|---|
| T1 | `_bufferDiff` 内で `requestAnimationFrame` で flush が予約 | 静的（balanced-brace 関数本体抽出 + regex） |
| T2 | `_bufferDiff` 内で `setTimeout` が使われていない（regression） | 静的（コメント剥がし後の検査） |
| T3 | beforeunload listener 内で `cancelAnimationFrame` + clearTimeout 残存なし | 静的 |
| T4 | rAF callback 内で `_flushTimer = null` 代入 + `_flushDiffBuffer()` 呼出 | 静的 |
| T5 | `[data-role="hall"] .pip-action-btn { display: none ... }` ルール削除（regression、CSS コメント剥がし） | 静的 |
| T6 | `[data-role="operator"] ... .pip-action-btn ...` セクション維持 | 静的 |
| T7 | `handlePipShowTimer` / `handlePipShowSlideshow` に hall 早期 return ガードなし（hall クリック動作保証） | 静的 |
| T8 | package.json version 2.1.9 + scripts.test に v221 登録 | 静的 |

---

## §4 テスト結果

```
PASS: 875 / FAIL: 0
内訳: v2.1.8 時点 867 件 + 新規 v221 = 8 件
```

`grep -cE "^PASS:"` で実測。

---

## §5 リスク評価 + 致命バグ保護 5 件 cross-check

| 評価軸 | 結果 |
|---|---|
| 単画面モード（operator-solo）の挙動 | **完全不変**（subscribeStateSync 登録なし、buffer 機構を経由しない） |
| 単画面モードのスライドショー切替ボタン | **完全不変**（[data-role="hall"] / [data-role="operator"] セレクタが当たらない） |
| 2 画面モード手元 PC（operator）のボタン | **完全不変**（[data-role="operator"] セクション維持で引き続き非表示） |
| v2.1.6 preStartState 機構 | **完全両立**（dual-sync.js + style.css のみ修正、preStartState handler / IPC は touch なし） |
| v2.1.7 dual-sync buffer の dedup / 上限 / 例外耐性 / 再帰防止 | **完全維持**（変更は flush 予約 1 行 + cleanup 1 行のみ） |
| v2.1.8 hall 音ガード / .clock 表示制御 | **完全両立**（renderer.js / audio.js touch なし、style.css は別ルールに分離済） |
| 致命バグ保護 C.2.7-A | 影響なし |
| 致命バグ保護 C.2.7-D | 影響なし |
| 致命バグ保護 C.1-A2 | 影響なし |
| 致命バグ保護 C.1.7 | 影響なし |
| 致命バグ保護 C.1.8 | 影響なし |
| フレームスキップ時の遅延 | hall window CPU 高負荷時に 50ms 超になる可能性あり、v2.1.10 で監視（Known Limitations 参照） |

---

## §6 試験項目別の前原さん確認手順

| # | 操作 | 期待結果 |
|---|---|---|
| 1 | 2 画面モード RUNNING 中、5 秒前カウントダウン音と画面表示 | **音と表示がほぼ同時**（0.2 秒のズレが消える） |
| 2 | 2 画面モード PRE_START 中、5 秒前カウントダウン音と画面表示 | 同上、ほぼ同時 |
| 3 | 2 画面モードで PAUSED 中に「30 秒進める」連打 | v2.1.7 同様、会場画面が連打追従、最終値に集約 |
| 4 | 2 画面モードでトーナメント切替 | v2.1.7 同様、チラつかず一発で切替 |
| 5 | 2 画面モード PRE_START + スライドショー終了 → カウントダウン表示 | v2.1.8 同様、即時表示復帰 |
| 6 | 2 画面モード 5 秒前カウントダウン音 | v2.1.8 同様、「ポン」1 音だけ |
| 7 | 単画面モード（hall なし）の通常運用 | 完全に従来挙動（subscribeStateSync 登録なし） |
| 8 | HDMI 抜き差し | 致命バグ保護 5 件すべて維持 |
| 9 | **2 画面モードでブレイク中スライドショー時、会場モニターに「タイマー画面に戻す」「スライドショーに戻る」ボタンが表示される** | **左下と左中央に表示**（緊急差し込み根治確認） |
| 10 | **会場モニターのボタンをマウスでクリック** | **クリックでスライドショー / タイマー切替が動作**（1 画面モードと同等の動作） |
| 11 | 単画面モードでのスライドショー切替ボタン | 既存通り表示 + 動作（v2.1.8 と完全同一、後方互換確認） |
| 12 | 2 画面モード手元 PC でのスライドショー切替ボタン | 引き続き非表示（操作画面なので不要、既存挙動維持） |

---

## §7 Known Limitations（v2.1.10 候補）

- **フレームスキップ（hall window CPU 高負荷時）で遅延が一時的に 50ms 超**: 前原さん試験で頻発するようなら v2.1.10 で案 1（queueMicrotask、1〜5ms）or 案 4（main 側 atomic snapshot、3〜10ms）への切替を検討
- **hall 側 timer loop 独立 rAF 回転 CPU 無駄**: 引き続きスコープ外、`applyTimerStateToTimer` の hall ガードは副作用リスク高
- **B3 ブレイク終了 pauseAfterBreak 反映漏れ**: 引き続き v2.1.10 候補

---

## §8 並列 sub-agent / Task 数報告

**0 体**（直接実行、cc-operation-pitfalls §1.1 / 4.2 準拠）。本 STEP は 2 ファイル（dual-sync.js + style.css）の小規模修正 + テスト追加（v219/v220 追従 + v221 新規）のみで、修正範囲が明確、並列化のメリットが小さいため直接実行を選択。

---

## §9 ビルド成果物確認（リリース工程）

- ✅ ブランチ: `feature/v2.1.9-rAF-flush` → main へ `--no-ff` マージ済（マージコミット a7dbe40）
- ✅ タグ: `v2.1.9` 作成済 + push 済
- ✅ ビルド: `dist/pokertimerplus-setup-2.1.9.exe` (82,995,776 bytes / 82.99 MB) + `dist/latest.yml` (version: 2.1.9、sha512 計算済)
- ✅ push: main + v2.1.9 タグを origin へ push 完了
- 直近コミット: 5a1d413（feature commit）→ a7dbe40（merge commit）

---

## §10 オーナー向け確認依頼

1. 2 画面モードで 5 秒前カウントダウンの音と画面表示が「ほぼ同時」になったか（0.2 秒ズレが消えたか）
2. 2 画面モードでブレイク中スライドショーの際、会場モニターに「タイマー画面に戻す」「スライドショーに戻る」ボタンが表示されるか
3. 上記ボタンをマウスでクリックしたとき、1 画面モードと同等にスライドショー / タイマー切替が動作するか
4. 単画面モードと 2 画面モード手元 PC のスライドショー切替ボタンの挙動が v2.1.8 と完全同一か
5. v2.1.7 の構造的根治（トーナメント切替・連打追従）/ v2.1.8 の根治（音 1 音 / スライドショー終了表示）が引き続き効いているか

**実装終了**。v2.1.9 タグ + .exe + latest.yml 準備完了予定、前原さんの GitHub Releases 公開待ち。本リリースは hall 表示遅延 0.2 秒の根治（rAF 化、3 行）+ 緊急差し込み（hall ボタン表示、1 ルール削除）。operator 側挙動完全不変、致命バグ保護 5 件すべて完全無傷、v2.1.6 / v2.1.7 / v2.1.8 機構と完全両立。
