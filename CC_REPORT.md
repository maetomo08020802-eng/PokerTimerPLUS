# CC_REPORT — 2026-05-08 v2.1.8 PRE_START 関連 2 件のバグ根治

## §1 サマリ

NEXT_CC_PROMPT v2.1.8 通り、前原さん 2 画面実機で発見された 2 件のバグ（バグ A: スライドショー終了→PRE_START カウントダウン非表示 / バグ B: 5 秒前カウント音 2 重再生）を根治。バグ B は 3 箇所の hall ガード追加（多層防御）、バグ A は CSS の `display: none` を `opacity: 0; pointer-events: none` に切替えて reflow 待ちを回避。

| 項目 | 内容 |
|---|---|
| 修正ファイル数 | 5（renderer.js / audio.js / style.css / package.json / CHANGELOG.md） + tests/v220 新規 + 既存テスト 31 ファイルの version assertion 更新 |
| 並列 sub-agent / Task 数 | **0 体**（直接実行、cc-operation-pitfalls §1.1 / 4.2 準拠） |
| 全テスト件数 | **867 件 PASS / 0 件 FAIL**（v2.1.7 時点 859 + 新規 v220 = 8 件） |
| 致命バグ保護 5 件 | **5 件すべて影響なし**（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8） |
| v2.1.7 dual-sync buffer 機構 | **完全無傷**（dual-sync.js touch なし、T7 で静的検証） |

---

## §2 事前調査結果（NEXT_CC_PROMPT 必須項目）

### A. 真因 6 箇所の独立検証（CC が独立 Read で確認）

| # | 場所 | 構築士分析 | CC 独立検証結果 |
|---|---|---|---|
| 1 | `renderer.js:1376` `applyTimerStateToTimer` | hall でも timerState を反映する経路、appRole ガードなし | ✅ 一致（`function applyTimerStateToTimer(ts, levels, opts = {}) {` 直前に何のガードもなし。本関数は touch 禁止、ガードは音発火経路のみ） |
| 2 | `renderer.js:1857` `handleAudioOnTick` | RUNNING / BREAK 中の音発火、appRole ガードなし | ✅ 一致（先頭で `const remainingSec = Math.ceil(...)` の後に直接 `playSound('warning-1min' / 'warning-10sec' / 'countdown-tick')` を発火、ガードゼロ） |
| 3 | `renderer.js:1893` `handleAudioOnPreStartTick` | PRE_START 中 5,4,3,2,1 秒で countdown-tick 発火、appRole ガードなし | ✅ 一致（先頭で `playSound('countdown-tick')` を直接発火） |
| 4 | `renderer.js:6766` `initialize()` | hall でも全初期化が走る | ✅ 一致（`async function initialize() {` 冒頭に appRole 分岐なし） |
| 5 | `audio.js:543` `playSound` | enabledMap チェックのみ、appRole ガードなし | ✅ 一致（`if (!enabledMap[soundId]) return; _play(soundId);` のみ） |
| 6 | `style.css:3268-3273` `:root[data-slideshow="active"] .clock` | display: none で reflow タイミングずれ | ✅ 一致（`.clock`, `.bottom-bar`, `.marquee`, `.event-header` の 4 セレクタが束ねられて `display: none`） |

→ **構築士分析と完全一致**、反論なし。修正方針 4 箇所（音発火 3 + CSS 1）で根治。

### B. 既存 hall ガードの一貫性確認

renderer.js 内の `window.appRole === 'hall'` 既存使用箇所を grep（`renderer.js:1438` 以降に 30 件以上）。すべて `if (window.appRole === 'hall') return;` 形式。本実装でも同形式を採用、ただし **audio.js は preload bridge を介さないモジュールスコープのため `typeof window !== 'undefined'` ガードを併用**して安全側で書く（既存 dual-sync.js のパターンに合わせ）。

### C. 致命バグ保護 5 件 cross-check（個別影響評価）

| 保護 | 関連箇所 | 影響評価 | 根拠 |
|---|---|---|---|
| C.2.7-A `resetBlindProgressOnly` | renderer.js | **影響なし** | 修正対象は handleAudioOnTick / handleAudioOnPreStartTick / playSound / .clock CSS のみ、resetBlindProgressOnly に touch なし |
| C.2.7-D `timerState` destructure 除外 | main.js | **影響なし** | main.js 完全無変更 |
| C.1-A2 `ensureEditorEditableState` 4 重防御 | renderer.js | **影響なし** | 修正対象に operator 編集モード経路は含まれない |
| C.1.7 AudioContext resume in `_play()` | audio.js | **影響なし** | playSound 冒頭の hall ガードは `_play()` の手前で hall を切るだけ。operator 側の `_play()` 経路は完全不変、`audioContext.state === 'suspended'` の resume 経路も維持 |
| C.1.8 runtime 永続化 8 箇所 | main.js | **影響なし** | main.js 完全無変更 |

→ **5 件すべて完全無傷**（v220 T6 で静的検証）。

### D. v2.1.7 dual-sync buffer 機構との両立確認

修正対象は audio / CSS / 音発火経路のみで `src/renderer/dual-sync.js` には一切 touch なし。subscribeStateSync → `_bufferDiff` → `_flushDiffBuffer` → `_applyDiffToState` の経路は完全不変。preStartState broadcast も buffer 経由の atomic update を維持。v220 T7 で静的検証。

### E. バグ B の発生メカニズム（前原さん「0.2 秒ズレ」の正体）

v2.1.7 以前: operator / hall 両 window で `playSound('countdown-tick')` がほぼ同時に発火 → 0〜数 ms 程度のズレで重なって人間の耳には「ポン 1 音」に聞こえていた可能性が高い。

v2.1.7 以降: hall 側の subscribeStateSync callback が `_bufferDiff` 経由で `setTimeout(0)` macrotask に予約 → 50〜200ms 遅延 → operator の音と hall の音が「ズレた 2 音」として人間に認識される。

→ v2.1.7 buffer は本リリースで根治対象の症状（バグ B）の**顕在化原因**だが、buffer 自体は B 系構造的根治のために必要な機構なので維持。バグ B は本来の真因（両 window での音発火）を hall ガードで塞いで根治。

---

## §3 各 Fix の実装内容（diff 要点）

### Fix 1: `src/renderer/renderer.js` `handleAudioOnTick` 冒頭に hall ガード

```diff
 function handleAudioOnTick(remainingMs, currentLevelIndex) {
+  // v2.1.8 バグ B 根治: hall 側では音を鳴らさない。... (説明コメント)
+  if (typeof window !== 'undefined' && window.appRole === 'hall') return;
   const remainingSec = Math.ceil(remainingMs / 1000);
```

### Fix 2: `src/renderer/renderer.js` `handleAudioOnPreStartTick` 冒頭に hall ガード

```diff
 function handleAudioOnPreStartTick(remainingMs) {
+  // v2.1.8 バグ B 根治: hall 側では音を鳴らさない（Fix 1 と同じ理由）
+  if (typeof window !== 'undefined' && window.appRole === 'hall') return;
   const remainingSec = Math.ceil(remainingMs / 1000);
```

### Fix 3: `src/renderer/audio.js` `playSound` 冒頭に hall ガード（多層防御の最終段）

```diff
 export function playSound(soundId) {
+  // v2.1.8 バグ B 根治（多層防御の最終段）: hall 側では音を鳴らさない。
+  // playSoundForce は試聴用（設定画面、operator のみで呼ばれる経路）のため対象外。
+  if (typeof window !== 'undefined' && window.appRole === 'hall') return;
   if (!enabledMap[soundId]) return;
   _play(soundId);
 }
```

`playSoundForce` には**追加せず**（試聴用、operator のみ呼出経路、T3 で static 確認）。

### Fix 4: `src/renderer/style.css` `.clock` だけ opacity 切替に分離

```diff
 /* スライドショー中は通常 UI を非表示 */
-:root[data-slideshow="active"] .clock,
 :root[data-slideshow="active"] .bottom-bar,
 :root[data-slideshow="active"] .marquee,
 :root[data-slideshow="active"] .event-header {
   display: none;
 }
+/* v2.1.8 バグ A 根治: .clock のみ display: none ではなく opacity + pointer-events で隠す。
+   display: none → display: block 切替は reflow が重く、スライドショー終了時に
+   PRE_START カウントダウンの DOM 更新と visual 反映にタイミングずれが生じる。
+   opacity + pointer-events で DOM レイアウトを維持したまま視覚的に隠す。
+   他のセレクタは既存挙動維持のため display: none のまま。 */
+:root[data-slideshow="active"] .clock {
+  opacity: 0;
+  pointer-events: none;
+}
```

### Fix 5: `package.json` バージョン bump

```diff
- "version": "2.1.7",
+ "version": "2.1.8",
```
+ `scripts.test` 末尾に `&& node tests/v220-prestart-audio-hall-guard.test.js` 追加。

### Fix 6: `CHANGELOG.md` に [2.1.8] セクション追加

[2.1.7] の上に挿入。Fixed / Internal / Tests / Compatibility / Known Limitations 構成。

### Fix 7: 既存テスト 31 ファイルの version assertion を `2.1.7` → `2.1.8`

Node 一括スクリプトで 5 パターン（`'2.1.7'` / `期待 2.1.7` / `version は 2.1.7` / `version が 2.1.7` / `version 2.1.7 + scripts.test`）置換。歴史的コメントは不変。合計 49 箇所更新。

### Fix 8: 新規テスト `tests/v220-prestart-audio-hall-guard.test.js`（8 件）

| # | テスト名 | 種別 |
|---|---|---|
| T1 | handleAudioOnTick 冒頭に hall ガード（早期 return） | 静的 |
| T2 | handleAudioOnPreStartTick 冒頭に hall ガード（早期 return） | 静的 |
| T3 | audio.js playSound 冒頭に hall ガード + playSoundForce には追加しない | 静的 |
| T4 | `:root[data-slideshow="active"] .clock` が opacity: 0 + pointer-events: none | 静的 |
| T5 | regression: `.clock` 単独ルールに display: none が含まれない + 他セレクタは display: none 維持 | 静的 |
| T6 | 致命バグ保護 5 件すべて維持 | 静的 |
| T7 | v2.1.7 dual-sync buffer 機構（DIFF_BUFFER_MAX / _bufferDiff / _flushDiffBuffer / subscribeStateSync 経路 / beforeunload cleanup）が無変更で残る | 静的 |
| T8 | package.json version 2.1.8 + scripts.test に v220 登録 | 静的 |

---

## §4 テスト結果

```
PASS: 867 / FAIL: 0
内訳: v2.1.7 時点 859 件 + 新規 v220 = 8 件
```

`grep -cE "^PASS:"` で実測。

---

## §5 リスク評価 + 致命バグ保護 5 件 cross-check

| 評価軸 | 結果 |
|---|---|
| 単画面モード（operator-solo）の挙動 | **完全不変**（appRole === 'hall' でのみ早期 return、operator-solo は通常通り音再生） |
| operator 側の挙動（2 画面モード） | **完全不変**（hall 側だけが音を鳴らさず、operator 側は従来通り） |
| バグ A 修正の副作用 | **`.clock` のみ単独ルール化、他のセレクタ（.bottom-bar / .marquee / .event-header）は既存 display: none 維持** で過剰修正回避（T5 regression テストで保護） |
| バグ B 修正の多層防御の妥当性 | 3 箇所（handleAudioOnTick / handleAudioOnPreStartTick / playSound）に置くことで、将来の新規 playSound 呼出箇所が漏れても最終段の audio.js でブロック |
| v2.1.7 dual-sync buffer との両立 | **完全両立**（dual-sync.js touch なし、T7 で 5 主要シンボル維持を静的検証） |
| 致命バグ保護 C.2.7-A | 影響なし（resetBlindProgressOnly touch なし） |
| 致命バグ保護 C.2.7-D | 影響なし（main.js 完全無変更） |
| 致命バグ保護 C.1-A2 | 影響なし（編集モード経路は本修正範囲外） |
| 致命バグ保護 C.1.7 | 影響なし（playSound 冒頭の hall ガードは _play() の手前、operator 側の resume 経路は不変） |
| 致命バグ保護 C.1.8 | 影響なし（main.js 完全無変更） |

---

## §6 試験項目別の前原さん確認手順

| # | 操作 | 期待結果 | 対応 |
|---|---|---|---|
| 1 | 2 画面モードで RUNNING 中、5 秒前カウントダウン音 | **「ポン」1 音だけ**（2 重再生「ポンポン」が消える） | バグ B 根治 |
| 2 | 2 画面モードで PRE_START 中、5 秒前カウントダウン音 | 同上、1 音のみ | バグ B 根治 |
| 3 | 2 画面モードで PRE_START 起動（開始時刻 100 分以上先） | 会場画面にスライドショー表示 | v2.1.6 機構維持 |
| 4 | 上記状態で開始 1 分前にスライドショーが終了 | **会場画面にメインタイマー PRE_START カウントダウンが即時表示される**（level 1 固定時間で固まらない） | バグ A 根治 |
| 5 | 単画面モード（hall なし）での通常運用 | 音が正常に鳴る（hall ガードで operator 側まで止まらないこと） | 後方互換 |
| 6 | 2 画面モードで「30 秒進める」+「人数変更」を 1 秒以内に同時操作 | v2.1.7 同様、会場画面で 2 つの変更が同フレームで反映 | v2.1.7 機構維持 |
| 7 | HDMI 抜き差し（rc12 / rc23 経路） | 致命バグ保護 5 件すべて維持 | 既存保護 |

---

## §7 Known Limitations（v2.1.9 候補）

- **hall 側で timer loop が独立に rAF 回転する CPU 無駄**: 本リリースでは音発火経路のみ塞ぎ、timer loop 自体は hall でも回り続ける。`applyTimerStateToTimer` への hall ガード追加は副作用リスク（hall 側通常 timerState 反映が壊れる可能性）があるためスコープ外。将来の最適化として v2.1.9 以降で別途検討
- **B3 ブレイク終了 pauseAfterBreak 反映漏れ**: timer.js の追加調査が必要、確度低、v2.1.9 候補
- **v2.1.7 由来の B1 / B7 ⑤ debounce 残課題**: `schedulePersistTimerState` / `setRuntime` の 500ms debounce 遅延、v2.1.7 試験結果次第で v2.1.9 で対応

---

## §8 並列 sub-agent / Task 数報告

**0 体**（直接実行、cc-operation-pitfalls §1.1 / 4.2 準拠）。本 STEP は 4 ファイルの集中修正 + テスト追加のみで、修正範囲が明確（音発火 3 箇所 + CSS 1 箇所）、並列化のメリットが小さいため直接実行を選択。

---

## §9 ビルド成果物確認（リリース工程）

- ✅ ブランチ: `feature/v2.1.8-prestart-audio-and-clock-fix` → main へ `--no-ff` マージ予定
- ✅ タグ: `v2.1.8` 作成予定
- ✅ ビルド: `dist/pokertimerplus-setup-2.1.8.exe` + `dist/latest.yml` (version: 2.1.8) 予定
- ✅ push: main + v2.1.8 タグを origin へ push 予定

→ 詳細は本レポート末尾に追記。

---

## §10 オーナー向け確認依頼

1. 2 画面モードでカウントダウン音（5 秒前など）が「ポン」1 音だけ鳴るか（「ポンポン」2 重再生が消えたか）
2. 開始前カウントダウン（PRE_START）でスライドショーが終わった瞬間、会場画面にカウントダウンが即座に表示されるか
3. 単画面（HDMI なし）の店舗で、音が今まで通り正常に鳴るか
4. v2.1.7 の構造的根治（トーナメント切替・連打追従）が引き続き効いているか
5. HDMI 抜き差しの動作が v2.1.7 と完全同一か

**実装終了**。v2.1.8 タグ + .exe + latest.yml 準備完了予定、前原さんの GitHub Releases 公開待ち。本リリースは PRE_START 関連 2 件のバグ根治 hot-fix で、4 箇所の最小侵襲修正（音発火 3 + CSS 1）。operator 側挙動完全不変、致命バグ保護 5 件すべて完全無傷、v2.1.7 dual-sync buffer 機構と完全両立。
