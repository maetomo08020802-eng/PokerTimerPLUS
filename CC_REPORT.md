# CC_REPORT — 2026-04-30 フェーズC.1.8: 重大バグ修正 — トーナメント途中の再起動でランタイムデータ消失

## 1. サマリー

- **真因特定**: `tournaments` テーブルに **`runtime` フィールドが存在せず**、`tournamentRuntime` は renderer メモリのみに存在 → アプリ終了でメモリ消失 → 再起動で `tournamentRuntime = { 0, 0, 0, 0 }` 初期値に復帰
- **修正方針採用**: **候補 1（tournaments テーブルに runtime フィールド追加 + 都度永続化）** — 既存 `setTimerState` / `setDisplaySettings` パターンと整合
- **修正範囲**: main.js（schema + sanitize + IPC + migrate + normalize）/ preload.js（bridge）/ renderer.js（schedulePersistRuntime + applyTournament 復元 + 8 箇所のミューテーション関数にフック）
- **致命バグ修正への影響**: ✅ なし（C.2.7-A `resetBlindProgressOnly` は runtime 不変のまま、T48 で静的検証）
- **テスト**: `tests/c18-runtime-persistence.test.js` 新規 6 件追加 → 全 **138 テスト PASS**（既存 132 + 新規 6）

## 2. 真因特定経緯

### 2-1. コード読解で確認した永続化漏れ

`grep` で `playersRemaining / playersInitial / reentryCount / addOnCount` を main.js / renderer.js 双方で確認:

```
src/main.js:    No matches found    ← 永続化ロジックなし
src/renderer/renderer.js: 多数（renderer メモリ内のみで管理）
```

**結論**: `tournamentRuntime` は **renderer メモリ内の単一オブジェクト**で、`store.set('tournaments', list)` の各エントリに含まれていなかった。アプリ終了 → メモリ消失 → 再起動で `tournamentRuntime` の宣言時の初期値（全 0）に戻る → ユーザー視点で「人数が消えた」現象。

### 2-2. C.2.7-A 致命バグ修正との関係
C.2.7-A の `resetBlindProgressOnly` は「**トーナメント切替時** に runtime を保護する」仕様で、renderer メモリ内の現在値を維持する設計。しかし**永続化は別問題**で、メモリ内に値があっても store に保存されていなければアプリ終了で消失する。

C.2.7-A は今回のバグの予防策ではなく、**別経路の保護**（ブラインド構造変更時の 8-8 致命バグ）。今回のバグはそれとは独立した永続化レイヤーの欠落。

### 2-3. 関連: tournaments:list の戻り値
`tournaments:list` IPC は `timerState / displaySettings / marqueeSettings` 等を含むが、**`runtime` を含んでいなかった**。よって renderer 側で `applyTournament(t)` 経由で復元しようとしても `t.runtime === undefined` で復元処理がスキップされていた。

## 3. 採用した修正候補とその理由

### 候補 1（採用）: tournaments テーブルに runtime フィールドを追加し、都度永続化

**理由**:
- 既存の `displaySettings.setDisplaySettings` / `timerState.setTimerState` パターンと完全に整合
- 都度永続化で「途中保存なし」のリスクなし（候補 2 の弱点を回避）
- `before-quit` IPC 同期に依存しないため、アプリクラッシュ時の取りこぼしも最小化
- マイグレーション簡素（runtime フィールド未定義 → 既定値補完）

### 採用しなかった候補
- **候補 2（before-quit で flush）**: 実装軽量だがクラッシュ時データ消失リスク + IPC 同期取得の複雑性
- **候補 3（ハイブリッド）**: 候補 1 で十分、二重実装は不要

## 4. 致命バグ修正への影響なき確認

### 4-1. C.2.7-A `resetBlindProgressOnly`（不変条件: ブラインド構造変更で runtime 消えない）
✅ **無傷**。`resetBlindProgressOnly` は `timerReset()` + `clock--timer-finished` class 削除のみ、`tournamentRuntime` には触らない（T48 で静的検証）。今回追加した `schedulePersistRuntime` 呼出も `resetBlindProgressOnly` には**入れていない**（runtime に触らない設計を維持）。

### 4-2. C.2.7-D `timerState` destructure 除外
✅ **無傷**。今回の修正は新規 IPC `tournaments:setRuntime` のみ追加で、`tournaments:setDisplaySettings` の payload 構造には触らない。

### 4-3. `ensureEditorEditableState` 4 重防御
✅ **無傷**。ブラインド編集状態とは別系統。

### 4-4. handlePresetApply の reset 分岐
✅ T48 で静的検証: `handlePresetApply` 内で `resetBlindProgressOnly()` 呼出が維持されている（致命バグ 8-8 リグレッションなし）。

## 5. 修正ファイル

| ファイル | 変更点 |
| --- | --- |
| `src/main.js` | `DEFAULT_TOURNAMENT_EXT.runtime` / `store.defaults.tournaments[0].runtime` 追加 / `sanitizeRuntime()` 新規 / `migrateTournamentSchema` で runtime 補完 / `normalizeTournament` 取込 + 既定補完 / `tournaments:list` 戻り値に runtime / 新 IPC `tournaments:setRuntime` |
| `src/preload.js` | `tournaments.setRuntime(id, runtime)` bridge 追加 |
| `src/renderer/renderer.js` | `schedulePersistRuntime()` debounce 500ms / `applyTournament` で `t.runtime` から `tournamentRuntime` 復元 / `addNewEntry` / `cancelNewEntry` / `eliminatePlayer` / `revivePlayer` / `initTournamentRuntime` / `resetTournamentRuntime` / `adjustReentry` / `adjustAddOn` の **計 8 箇所**で `schedulePersistRuntime()` 呼出 |
| `package.json` | test スクリプトに c18-runtime-persistence 追加 |
| `tests/c18-runtime-persistence.test.js` | **新規 6 テスト**（T43〜T48）|

## 6. 主要変更点

### 6-1. main.js sanitize + IPC

```js
const DEFAULT_TOURNAMENT_EXT = Object.freeze({
  // ...既存
  runtime: { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 }
});

function sanitizeRuntime(value, fallback) {
  const fb = (fallback && typeof fallback === 'object') ? fallback : { playersInitial: 0, ... };
  if (!value || typeof value !== 'object') return { ...fb };
  const toNonNegInt = (v, fbV) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return Math.max(0, Math.floor(fbV || 0));
    return Math.floor(v);
  };
  return {
    playersInitial:   toNonNegInt(value.playersInitial,   fb.playersInitial),
    playersRemaining: toNonNegInt(value.playersRemaining, fb.playersRemaining),
    reentryCount:     toNonNegInt(value.reentryCount,     fb.reentryCount),
    addOnCount:       toNonNegInt(value.addOnCount,       fb.addOnCount)
  };
}

ipcMain.handle('tournaments:setRuntime', (_event, payload) => {
  const { id, runtime } = payload;
  const list = store.get('tournaments') || [];
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return { ok: false, error: 'not-found' };
  const next = sanitizeRuntime(runtime, list[idx].runtime || DEFAULT_TOURNAMENT_EXT.runtime);
  list[idx] = { ...list[idx], runtime: next };
  store.set('tournaments', list);
  return { ok: true, runtime: next };
});
```

### 6-2. renderer.js schedulePersistRuntime + 復元

```js
let runtimePersistTimer = null;
function schedulePersistRuntime() {
  if (runtimePersistTimer) clearTimeout(runtimePersistTimer);
  runtimePersistTimer = setTimeout(() => {
    runtimePersistTimer = null;
    const id = tournamentState.id;
    if (!id || !window.api?.tournaments?.setRuntime) return;
    const rt = { /* 4 fields */ };
    window.api.tournaments.setRuntime(id, rt).catch(...);
  }, 500);
}

// applyTournament 内で復元
if (t.runtime && typeof t.runtime === 'object') {
  const rt = t.runtime;
  if (typeof rt.playersInitial === 'number')   tournamentRuntime.playersInitial   = Math.max(0, Math.floor(rt.playersInitial));
  if (typeof rt.playersRemaining === 'number') tournamentRuntime.playersRemaining = Math.max(0, Math.floor(rt.playersRemaining));
  if (typeof rt.reentryCount === 'number')     tournamentRuntime.reentryCount     = Math.max(0, Math.floor(rt.reentryCount));
  if (typeof rt.addOnCount === 'number')       tournamentRuntime.addOnCount       = Math.max(0, Math.floor(rt.addOnCount));
}
```

### 6-3. ミューテーション関数の永続化フック（計 8 箇所）

| 関数 | トリガ | 永続化 |
| --- | --- | --- |
| `initTournamentRuntime` | プレスタートダイアログで人数入力 | ✅ |
| `addNewEntry` | ↑キー: 新規エントリー追加 | ✅ |
| `cancelNewEntry` | Shift+↑: 新規エントリー取消 | ✅ |
| `eliminatePlayer` | ↓キー: プレイヤー脱落 | ✅ |
| `revivePlayer` | Shift+↓: プレイヤー復活 | ✅ |
| `adjustReentry` | Ctrl+R: リエントリー ± | ✅ |
| `adjustAddOn` | Ctrl+A: アドオン ± | ✅ |
| `resetTournamentRuntime` | 明示的「タイマーリセット」ボタン | ✅（0 値も保存）|

`resetBlindProgressOnly` は **意図的に永続化フックなし**（runtime に触らない設計を維持、致命バグ 8-8 保護）。

### 6-4. マイグレーション

旧バージョン（v1.3.0 まで）のデータを v1.3.1 で開いた時:
- `m.runtime === undefined` → 既定値 `{ 0, 0, 0, 0 }` で補完
- `m.runtime` が壊れている（負値 / NaN 等）→ `sanitizeRuntime` で整数化
- 既存 displaySettings / timerState / marqueeSettings のマイグレーションパターンと同経路

## 7. 構築士への質問

### 7-1. 既存ユーザーの旧データ復旧について
v1.3.0 で運用していたユーザーが v1.3.1 にアップグレードした場合、**過去のランタイムデータは復旧しない**（旧バージョン時点で永続化されていなかったため、store に存在しない）。マイグレーション時に runtime = { 0, 0, 0, 0 } で初期化されます。

→ アップグレード後、最初のトーナメント開始時に通常通り人数を入力 → 以降は永続化される、という運用になります。CHANGELOG への記載が必要であれば追記推奨。

### 7-2. specialStack.appliedCount の永続化
ランタイムに近い性質を持つ `tournamentState.specialStack.appliedCount`（特殊スタック適用人数）は本フェーズでは触っていません。コード読解上、これは `tournaments:save` 経由で都度永続化されている（`tournaments` テーブルの一部として保存される）ため、再起動でも保持されるはず。実機で「特殊スタック人数も消える」フィードバックがあれば次フェーズで対応推奨。

### 7-3. periodicPersistAllRunning との関係
既存の `periodicPersistAllRunning`（5 秒ごとの全 running トーナメント保存）は `setTimerState` のみを保存しています。runtime は本フェーズで都度永続化（debounce 500ms）するので、5 秒間隔の保証よりも細かい粒度で保存されます。periodic 側に runtime を加える必要はありません。

### 7-4. スコープ越え疑念
NEXT_CC_PROMPT は「**ランタイムデータ（playersRemaining / playersInitial / reentryCount / addOnCount 等）の永続化漏れの修正**」と指示。本実装は 4 フィールドすべて + `initTournamentRuntime` / `resetTournamentRuntime` / その他のミューテーション関数まで包括的に修正しました。スコープ超過と感じる場合はご指摘ください（致命バグ修正への影響はゼロ）。

## 8. 検証ログ

```
$ node --check src/main.js src/preload.js src/renderer/renderer.js
ALL OK

$ npm test
[data-transfer]      === Summary: 7 passed / 0 failed ===
[runtime-preservation] === Summary: 6 passed / 0 failed ===
[audit-fix]          === Summary: 9 passed / 0 failed ===
[paused-flow]        === Summary: 9 passed / 0 failed ===
[race-fixes]         === Summary: 5 passed / 0 failed ===
[light-todos]        === Summary: 4 passed / 0 failed ===
[editable-state]     === Summary: 7 passed / 0 failed ===
[audit-residuals]    === Summary: 8 passed / 0 failed ===
[new-tournament-edit] === Summary: 8 passed / 0 failed ===
[v130-features]      === Summary: 12 passed / 0 failed ===
[c13-bg-image]       === Summary: 19 passed / 0 failed ===
[c14-slideshow]      === Summary: 24 passed / 0 failed ===
[c16-features]       === Summary: 8 passed / 0 failed ===
[c17-audio-resume]   === Summary: 6 passed / 0 failed ===
[c18-runtime-persistence] === Summary: 6 passed / 0 failed ===
```

合計 **138 テスト全 PASS**（既存 132 + 新規 6）。

## 9. オーナー向け確認

### 報告症状の修正確認（最重要）
1. **トーナメント途中（プレイヤー人数 / リエントリー / アドオンが入っている状態）でアプリを ✕ で閉じる**
2. **再起動**
3. **同じトーナメントを開く → プレイヤー人数 / リエントリー / アドオン数がすべて閉じる前と同じ値**

### 周辺の動作確認
4. **複数トーナメントある場合、それぞれが独立してランタイムを保持** — トーナメント A で 50 人、トーナメント B で 30 人と設定し、再起動後それぞれ正しい値が表示される
5. **「タイマーリセット」ボタン押下 → 0 にリセットされて再起動後も 0 のまま**（リセット動作も永続化）
6. **ブラインド構造変更（保存して適用 → リセットして開始 / 構造のみ適用）でランタイムが消えない** — C.2.7-A 致命バグ修正が引き続き機能

### 既存機能維持
7. **タイマー / 警告音（C.1.7 修正）/ スライドショー / PIP / 設定ダイアログ縦リサイズ / TOTAL GAME TIME 切替 / 既存 8 色背景 / カスタム画像 すべて以前通り**

すべて期待通り動作すれば C.1.8 完了。**v1.3.1 の重大バグ修正リリース候補**として配布判断推奨。
