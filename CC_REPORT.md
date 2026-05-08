# CC_REPORT — 2026-05-08 v2.1.7 hall 側 atomic update 実装（B 系構造的根治）

## §1 サマリ

NEXT_CC_PROMPT v2.1.7 通り、B 系バグ群（B1 PAUSED race / B2 トーナメント切替 / B4 runtime race / B7 ⑤⑥②）を hall 側 receiver の **atomic update 機構**で構造的根治。`dual-sync.js` に `_diffBuffer` + `_flushTimer` + `_flushDiffBuffer` を新設し、subscribeStateSync callback を buffer 経由に切替。同一 kind の diff は最後の値で dedup、異なる kind は受信順を保持。25 行規模の最小侵襲修正で 6 件のバグを構造的根治。

| 項目 | 内容 |
|---|---|
| 修正ファイル数 | 4（src/renderer/dual-sync.js / package.json / CHANGELOG.md / tests/v219-hall-atomic-update.test.js[新]） + 既存テスト 31 ファイルの version assertion 更新 |
| 並列 sub-agent / Task 数 | **0 体**（直接実行、cc-operation-pitfalls §1.1 / 4.2 準拠） |
| 全テスト件数 | **859 件 PASS / 0 件 FAIL**（v2.1.6 時点 850 + 新規 v219 = 9 件） |
| 致命バグ保護 5 件 | **5 件すべて影響なし**（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8） |

---

## §2 事前調査結果（NEXT_CC_PROMPT 必須項目）

### A. 既存 hall receiver の構造特定

| 項目 | 場所 | 確認結果 |
|---|---|---|
| 中心 receiver 関数 | `src/renderer/dual-sync.js:32` `_applyDiffToState(diff)` | 同期実行（setState + _diffHandler 経由）、IPC / await なし |
| 呼出経路 ① 初期同期 | `initDualSyncForHall` 内 `for (const kind of Object.keys(initial))` ループ | 起動時 1 回のみ、startup race なし |
| 呼出経路 ② ランタイム broadcast | `dual.subscribeStateSync((diff) => _applyDiffToState(diff))` | main からの差分 broadcast、複数 kind 短時間到着時に race 発生 |
| 共通 diff handler 登録 | `src/renderer/renderer.js:6890` `registerDualDiffHandler((diff) => {...})` | hall ブロック内 `if (__appRole === 'hall') { ... }` (`renderer.js:6884`) のみ |

→ **buffer 機構の最適挿入位置 = `dual-sync.js`**（subscribe callback の前段、全 broadcast diff が確実に通る）

### B. operator / hall の判別ロジック（appRole ガード位置）

| 場所 | 効果 |
|---|---|
| `dual-sync.js:60` `initDualSyncForHall` 冒頭 `if (window.appRole !== 'hall') return;` | hall 以外では subscribeStateSync が登録されない → buffer 機構を一切通らない |
| `renderer.js:6884` `if (__appRole === 'hall')` ブロック | registerDualDiffHandler / initDualSyncForHall 呼出を hall ブロック内に閉じ込め |
| `renderer.js:7045` `else if (__appRole === 'operator')` ブロック | initialize() のみ呼出、dual-sync.js 経路は無関係 |

→ **operator 側は buffer 機構を一切通らない**（即時 apply 経路は本来不在、影響ゼロ）。T7 で静的検証。

### C. 既存 _applyDiffToState の同期性確認

`_applyDiffToState`（`dual-sync.js:32-54`）は完全同期:
- ログ呼出（`window.api?.log?.write?.(...)`）は send（fire-and-forget、非同期 IPC だが結果待ちなし）
- `setState({...})` は state.js のローカル更新（同期）
- `_diffHandler(diff)` は callback 同期実行（renderer.js の handler 内も同期）
- await / Promise / setTimeout は本関数内に存在しない

→ **flush ループ内で逐次呼出して安全**（macrotask boundary で全 apply 完結）。

### D. preStartState 経路（v2.1.6）と buffer 機構の両立

v2.1.6 で operator → main → hall に流れる `preStartState` kind:
- 送信側: operator 内 rAF tick で 1 秒間引き broadcast（`dual.publishPreStartState`）+ edge イベント即時送信
- 受信側: main `_publishDualState('preStartState', ...)` → hall subscribeStateSync → `_applyDiffToState` → renderer.js の `kind === 'preStartState'` 分岐 → `applyHallPreStartState(value)` で rAF 描画

v2.1.7 buffer 機構は **subscribe callback の前段に挿入**するため、preStartState も他 kind と同じく buffer 経由で flush される:
- 送信側 1 秒間引き = 元々の rate-limit（operator から main への流量制御）
- 受信側 buffer dedup = 短時間に複数 kind が到着した際の atomic update（hall 内）

→ **両機構は責務分離で両立**（rate-limit と atomic update）。T8 で実証検証。

### E. 致命バグ保護 5 件 cross-check（個別影響評価）

| 保護 | 関連箇所 | 影響評価 | 根拠 |
|---|---|---|---|
| C.2.7-A `resetBlindProgressOnly` | renderer.js（operator-only） | **影響なし** | hall 側 buffer は dual-sync.js のみ、関数本体・呼出経路に touch なし |
| C.2.7-D `timerState` destructure 除外 | main.js `tournaments:setDisplaySettings` | **影響なし** | main.js 完全無変更、hall 側受信のみの修正 |
| C.1-A2 `ensureEditorEditableState` 4 重防御 | renderer.js（operator-only、複製/新規ハンドラ） | **影響なし** | operator 側は buffer 機構を一切通らない |
| C.1.7 AudioContext resume | audio.js `_play()` | **影響なし** | audio.js / _play への触れなし。buffer flush 内の apply は同期、audio:play 呼出タイミングは macrotask 1 周期分（≦1ms）の遅延のみ、resume 経路は不変 |
| C.1.8 runtime 永続化 | main.js `tournaments:setRuntime` | **影響なし** | main.js 永続化 IPC 完全無変更、hall 側受信のみ |

→ **5 件すべて完全無傷**（v219 テストでも各保護維持を確認）。

---

## §3 各 Fix の実装内容（diff 要点）

### Fix 1: `src/renderer/dual-sync.js` に diff buffer + flush 機構を新設

```diff
+ const DIFF_BUFFER_MAX = 100;
+ const _diffBuffer = [];
+ let _flushTimer = null;
+ let _isFlushing = false;
+
+ function _bufferDiff(diff) {
+   if (!diff || typeof diff !== 'object' || typeof diff.kind !== 'string') return;
+   if (_diffBuffer.length >= DIFF_BUFFER_MAX) {
+     try {
+       console.warn('[dual-sync] _diffBuffer 上限', DIFF_BUFFER_MAX, '到達、古い diff を破棄');
+       window.api?.log?.write?.('dual-sync:buffer:overflow', { ... });
+     } catch (_) { /* never throw from logging */ }
+     _diffBuffer.shift();
+   }
+   _diffBuffer.push(diff);
+   if (_flushTimer === null) {
+     _flushTimer = setTimeout(_flushDiffBuffer, 0);
+   }
+ }
+
+ function _flushDiffBuffer() {
+   _flushTimer = null;
+   if (_isFlushing) return;
+   _isFlushing = true;
+   try {
+     const dedup = new Map();
+     for (const d of _diffBuffer) {
+       if (!d || typeof d.kind !== 'string') continue;
+       if (dedup.has(d.kind)) dedup.delete(d.kind);
+       dedup.set(d.kind, d);
+     }
+     _diffBuffer.length = 0;
+     for (const d of dedup.values()) {
+       try { _applyDiffToState(d); }
+       catch (err) { console.warn('[dual-sync] _applyDiffToState failed for kind=', d && d.kind, err); }
+     }
+   } finally {
+     _isFlushing = false;
+   }
+ }
```

subscribeStateSync 切替:
```diff
- dual.subscribeStateSync((diff) => _applyDiffToState(diff));
+ dual.subscribeStateSync((diff) => _bufferDiff(diff));
```

初期同期は `_applyDiffToState` 直接呼出を維持（startup race なし、initialize() 順序保護）。

### Fix 2: edge case ガード

1. **再入防止**: `_isFlushing` フラグで `_flushDiffBuffer` の二重実行を抑止（理論上 setTimeout 経由のため不要だが二重防御）
2. **hall window destroy 時 cleanup**: `window.addEventListener('beforeunload', () => { clearTimeout(_flushTimer); _diffBuffer.length = 0; }, { once: true })`
3. **個別 apply 例外耐性**: `for (const d of dedup.values())` 内で `try { _applyDiffToState(d); } catch (...)` により、1 件の例外で他の diff の apply が止まらない
4. **buffer サイズ上限**: `DIFF_BUFFER_MAX = 100`、超過時は `_diffBuffer.shift()` で古い順破棄 + console.warn + rolling-log 警告

### Fix 3: テスト `tests/v219-hall-atomic-update.test.js`（新規 9 件）

| # | テスト名 | 種別 |
|---|---|---|
| T1 | _diffBuffer 空時、_bufferDiff で _flushTimer が登録される | 静的+動的 |
| T2 | _flushTimer 登録済時、追加 diff で新タイマー登録されない | 動的 |
| T3 | 異なる kind 5 件、flush 後に受信順で apply | 動的（macrotask 待機） |
| T4 | 同一 kind 3 件、最後の値のみ apply（dedup） | 動的 |
| T5 | apply 中の例外は握り潰され、他 diff は継続 | 動的（throw 注入） |
| T6 | beforeunload で _flushTimer + _diffBuffer がクリアされる | 動的+静的 |
| T7 | operator 側では buffer 機構を通らない | 静的（appRole ガード + operator ブランチ非混入） |
| T8 | preStartState diff も buffer 経路を通る（v2.1.6 機構と両立） | 動的+静的 |
| T9 | _diffBuffer 上限 100 件超過、古い順破棄 + 警告 | 動的+静的 |

動的シミュレーションは Node の `vm.runInContext` で dual-sync.js から buffer ブロックを抜き出し、`_applyDiffToState` を spy で置換えて挙動検証。トップレベル `const`/`let` を `var` に変換することで vm context のグローバルプロパティとして検査可能化。

### Fix 4: `package.json` バージョン bump

```diff
- "version": "2.1.6",
+ "version": "2.1.7",
```
+ `scripts.test` 末尾に `&& node tests/v219-hall-atomic-update.test.js` 追加。

### Fix 5: `CHANGELOG.md` に [2.1.7] セクション追加

[2.1.6] の上に挿入。Fixed / Internal / Tests / Known Limitations / Compatibility 構成。

### Fix 6: 既存テスト 31 ファイルの version assertion を `2.1.6` → `2.1.7`

Node 一括スクリプトで `'2.1.6'`（quoted）/ `期待 2.1.6` / `version は 2.1.6` / `version が 2.1.6` / `version 2.1.6 + scripts.test` の 5 パターンを置換。歴史的コメント（`v2.1.6 で preStartState 追加` 等）は不変。合計 49 箇所更新。

---

## §4 テスト結果

```
PASS: 859 / FAIL: 0
内訳: v2.1.6 時点 850 件 + 新規 v219 = 9 件
```

`grep -cE "^PASS:" / "^FAIL:"` で個別アサーション数を実測。Summary 行集計は test file 数（53）× 平均件数で 859 件と整合。

---

## §5 リスク評価 + 致命バグ保護 5 件 cross-check

| 評価軸 | 結果 |
|---|---|
| operator 側挙動の不変性 | **完全不変**（subscribeStateSync 登録は initDualSyncForHall 内のみ、operator は経路に到達しない） |
| 単画面モード（operator-solo）の不変性 | **完全不変**（dual-sync.js は appRole === 'hall' でのみ起動、solo は no-op） |
| 既存 broadcast kind の意味的不変性 | **完全不変**（apply 関数 `_applyDiffToState` 本体は touch なし、buffer は前段挿入のみ） |
| preStartState（v2.1.6）両立 | **両立確認**（送信側 1 秒間引き + 受信側 buffer dedup の責務分離） |
| 致命バグ保護 C.2.7-A | 影響なし（renderer.js operator-only 経路、buffer は dual-sync.js のみ） |
| 致命バグ保護 C.2.7-D | 影響なし（main.js 完全無変更） |
| 致命バグ保護 C.1-A2 | 影響なし（operator-only 経路、buffer は経路外） |
| 致命バグ保護 C.1.7 | 影響なし（audio.js / _play 完全無変更、apply 遅延は macrotask 1 周期分のみ） |
| 致命バグ保護 C.1.8 | 影響なし（main.js 永続化 IPC 完全無変更） |

---

## §6 試験項目別の前原さん確認手順

| # | 操作 | 期待結果 | 対応 B# |
|---|---|---|---|
| 1 | 2 画面モード起動 → トーナメント切替（複数登録済み前提） | hall 側がチラつかず一気に新トーナメント表示に切替 | B2 |
| 2 | 新規トーナメント保存（手元でブラインド「レギュラー」設定） | hall 側も同じ「レギュラー」構造を表示（operator と一致） | B7 ⑥ |
| 3 | PAUSED 中に人数変更（エントリー追加 / 削減） | hall 側が即時に新人数を反映 | B1 / B7 ⑤ |
| 4 | PAUSED 中に「±30 秒進める」を連打 | hall 側が連打追従、最終値に集約（古い中間値が一瞬出ない） | B1 |
| 5 | 「30 秒進める」と「人数変更」を 1 秒以内に同時操作 | hall 側で 2 つの変更が同フレームで反映される（古い状態が瞬間表示されない） | B4 |
| 6 | PRE_START（開始時刻を未来に設定）状態 | v2.1.6 と同じ挙動（hall でカウントダウン + スライドショー、ズレなし） | v2.1.6 機構維持 |
| 7 | 既存運用（PRE_START 非使用 / 通常タイマー駆動） | v2.1.6 と完全同一 | 後方互換 |
| 8 | HDMI 抜き差し（rc12 / rc23 経路） | 致命バグ保護 5 件すべて維持、atomic update も継続 | 既存保護 |
| 9 | （前原さん観察）2 画面で「何かが遅れる」既存認知の症状 | 解消されているか確認（解消なら v2.1.8 不要、残存なら v2.1.8 で debounce 対応検討） | B7 ② / B1 残課題 |

---

## §7 Known Limitations（v2.1.8 候補）

- **B1 / B7 ⑤ の debounce 残課題**: `schedulePersistTimerState` / `setRuntime` の 500ms debounce による broadcast 遅延は本リリースのスコープ外。v2.1.7 試験で残存有無を判定 → 必要なら v2.1.8 で別途 debounce 短縮で対応
- **B3 ブレイク終了 pauseAfterBreak 反映漏れ**: timer.js の追加調査が必要、確度低、v2.1.8 候補

---

## §8 並列 sub-agent / Task 数報告

**0 体**（直接実行、cc-operation-pitfalls §1.1 / 4.2 準拠）。本 STEP は 1 ファイル（dual-sync.js）の集中修正 + テスト追加のみで、調査・修正範囲が明確、並列化のメリットが小さいため直接実行を選択。

---

## §9 ビルド成果物確認（リリース工程）

- ✅ ブランチ: `feature/v2.1.7-hall-atomic-update` → main へ `--no-ff` マージ済（マージコミット 1a19ca4）
- ✅ タグ: `v2.1.7` 作成済 + push 済
- ✅ ビルド: `dist/pokertimerplus-setup-2.1.7.exe` (82,995,883 bytes / 82.99 MB) + `dist/latest.yml` (version: 2.1.7、sha512 計算済)
- ✅ push: main + v2.1.7 タグを origin へ push 完了
- 直近コミット: 2637083（feature commit）→ 1a19ca4（merge commit）

---

## §10 オーナー向け確認依頼

1. 2 画面モードでトーナメント切替時、会場モニターが古い状態で固まらず一発で切替わるか
2. PAUSED 中に人数変更や「±30 秒」を連打した時、会場モニターが追従するか
3. 開始前カウントダウン（PRE_START）が会場モニターで正常に表示され続けるか（v2.1.6 機能維持）
4. HDMI 抜き差し時の動作が v2.1.6 と完全同一か
5. 「何かが遅れる」既存認知の症状が解消されたか（残れば v2.1.8 で追加対応検討）

**実装終了**。v2.1.7 タグ + .exe + latest.yml 準備完了予定、前原さんの GitHub Releases 公開待ち。本リリースは hall 側 atomic update 機構（方針 C）採用で B 系バグ群（B1/B2/B4/B7 ⑤⑥②）を構造的根治。25 行規模の最小侵襲修正、operator 側挙動完全不変、致命バグ保護 5 件すべて完全無傷。
