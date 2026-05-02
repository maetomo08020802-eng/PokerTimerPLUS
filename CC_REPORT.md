# CC_REPORT — 2026-05-02 v2.0.4-rc20 実装フェーズ（問題 ⑥ 真因根治、案 A 単独採用、ビルド込み）

## §1 サマリ

NEXT_CC_PROMPT.md（rc20 第 2 弾実装フェーズ指示書）通り、前原さん判断 ① β / ② B / ③ c に基づく**案 A 単独**で問題 ⑥ を根治実装 + テスト + ビルド完了。

- **タスク 1（案 A 実装）**: `src/main.js:1764-1786` `presets:saveUser` ハンドラ末尾で、当該 preset を使うアクティブトーナメントが存在する場合のみ `_publishDualState('structure', sanitized)` を強制発火。`src/renderer/renderer.js:6695-6712` の hall dual-sync handler に `kind === 'structure'` case 追加（`setStructure(value)` + `renderCurrentLevel` / `renderNextLevel` で即時再描画）。**`timer.js` の `targetTime` には触れない**（前原さん判断 ③ c 厳守）。
- **タスク 2（rc19 死コードコメント追記、(c) 並存方針）**: `src/main.js:2092-2099` の `tournamentBasics` payload `structure: validated.structure` 同梱箇所と `src/renderer/renderer.js:6667-6671` の `value.structure` 分岐に「現在常に undefined となる dead code、案 A 経路に置換、履歴保護のため残置」コメント追記。**コードロジック変更ゼロ**。
- **タスク 3（配布版常時記録ラベル）**: `structure:state:send`（`src/main.js:1772-1777`）と `structure:state:recv:hall`（`src/renderer/renderer.js:6708-6711`）を rc18 第 1 弾の 4 ラベルと同パターンで追加。すべて `try { ... } catch (_) { }` で wrap、never throw from logging。
- **タスク 4（バージョン / CHANGELOG / テスト / ビルド）**: `package.json` `2.0.4-rc19` → `2.0.4-rc20`、CHANGELOG.md `[2.0.4-rc20] - 2026-05-02` セクション追加、既存 11 ファイル version assertion 追従更新、新規 1 テストファイル追加（17 件）+ `package.json scripts.test` に追加。**`npm test` 全 610 件 PASS / 0 FAIL**（rc19 593 件 + rc20 新規 17 件）、**`npm run build:win` 成功**（`dist/PokerTimerPLUS+ (Test) Setup 2.0.4-rc20.exe` 80MB 生成）。
- **致命バグ保護 5 件**: 全件無傷（`presets:saveUser` に `schedulePersistRuntime` 追加禁止、preset と runtime の境界保護を assertion 化）。

---

## §2 タスク 1（案 A 実装）変更箇所 + テスト結果

### 2.1 変更箇所 1: `src/main.js:1764-1786`（`presets:saveUser` ハンドラ末尾）

```javascript
store.set('userPresets', presets);
// v2.0.4-rc20 タスク 1（案 A、問題 ⑥ 根治）:
// アクティブトーナメントが当該 preset を使っている場合のみ structure を hall に強制 publish。
// _dualStateCache.structure は v2.0.0 STEP 2 で予約済みの kind 枠（line 963）を活性化する。
// 既存 tournamentBasics 経路（rc18 第 1 弾の loadPresetById フォールバック）と非干渉。
// 前原さん判断 ③ c により、進行中レベルの残り時間には影響しない（hall 側 setStructure のみ、timer.js 不変）。
try {
  const activeId = store.get('activeTournamentId');
  const tournaments = store.get('tournaments') || [];
  const activeT = tournaments.find((x) => x && x.id === activeId);
  if (activeT && activeT.blindPresetId === id) {
    _publishDualState('structure', sanitized);
    // タスク 3 の rolling ログ（後述）
  }
} catch (_) { /* never throw from publish */ }
return { ok: true, id };
```

### 2.2 変更箇所 2: `src/renderer/renderer.js:6695-6712`（hall dual-sync handler）

```javascript
} else if (kind === 'structure' && value && Array.isArray(value.levels)) {
  // v2.0.4-rc20 タスク 1（案 A、問題 ⑥ 根治）:
  // ブラインド構造の即時 hall 同期。前原さん判断 ③ c により、進行中レベルの残り時間には影響しない設計。
  // setStructure で blinds.js の currentStructure を更新 → 次レベル切替時に新 duration が効く。
  // timer.js の targetTime は意図的に再計算しない（現レベル末端まで古い duration で継続、③ c 厳守）。
  try {
    setStructure(value);
    const { currentLevelIndex } = getState();
    renderCurrentLevel(currentLevelIndex);
    renderNextLevel(currentLevelIndex);
    // タスク 3 の rolling ログ（後述）
  } catch (err) { console.warn('[dual-sync] structure 適用失敗:', err); }
}
```

### 2.3 テスト結果（タスク 1 関連）

新規 `tests/v204-rc20-structure-publish.test.js`：
- T1: `_publishDualState("structure", sanitized)` 呼出存在 ✓
- T2: `activeT.blindPresetId === id` ガード内 ✓
- T3: try/catch wrap ✓
- T4: hall 受信 `kind === 'structure'` 分岐存在 ✓
- T5: `setStructure(value)` 呼出存在 ✓
- T6: `renderCurrentLevel` / `renderNextLevel` 呼出存在 ✓
- **T7: `targetTime` / `startAtLevel` / `applyTimerStateToTimer` 機能呼出が無い（③ c 厳守）** ✓

---

## §3 タスク 2（rc19 死コードコメント追記、(c) 並存方針）変更箇所

### 3.1 変更箇所 1: `src/main.js:2092-2099`

既存の `_publishDualState('tournamentBasics', ...)` payload `structure: validated.structure` 同梱箇所に、コメント追記:

```javascript
// v2.0.4-rc19 タスク 2（問題 ⑥ 残部、案 ⑥-A）:
// hall 側の loadPresetById IPC 2 段化を回避するため、structure を payload に直接同梱。
// hall 受信側で value.structure があれば setStructure を直接呼び、無ければ既存フォールバック。
// v2.0.4-rc20 (c) 並存方針: 本 structure フィールドは normalizeTournament が t.structure を
// out に伝播しないため現在常に undefined となる dead code。rc20 タスク 1 で案 A の
// `_publishDualState('structure', sanitized)`（presets:saveUser ハンドラ末尾）に置換済。
// 履歴保護 + 将来 normalizeTournament 修正時の自動有効化保険のため残置。
_publishDualState('tournamentBasics', {
  // ... 既存実装
  structure: validated.structure
});
```

### 3.2 変更箇所 2: `src/renderer/renderer.js:6667-6671`

既存の `if (value.structure && typeof value.structure === 'object')` 分岐にコメント追記:

```javascript
// v2.0.4-rc19 タスク 2（問題 ⑥ 残部、案 ⑥-A）:
// payload に structure 同梱されていれば直接適用、無ければ rc18 第 1 弾の loadPresetById フォールバック
// v2.0.4-rc20 (c) 並存方針: main.js 側 normalizeTournament 仕様により value.structure は
// 現在常に undefined となり本分岐は事実上 dead code。rc20 で案 A の kind === 'structure' 経路に
// 置換、本分岐は履歴保護 + 将来 normalizeTournament 修正時の二重保証として残置。
if (value.structure && typeof value.structure === 'object') {
  // ... 既存実装
}
```

### 3.3 注意

**コードロジックは一切変更していません**。コメント追記のみ（指示通り）。テスト assertion (`rc19 (c) 並存方針: tournamentBasics の structure 同梱 dead code は履歴保護のため残置`) で残置を担保。

---

## §4 タスク 3（新規ログラベル）変更箇所 + テスト結果

### 4.1 変更箇所 1: `src/main.js:1772-1777`

```javascript
if (activeT && activeT.blindPresetId === id) {
  _publishDualState('structure', sanitized);
  // v2.0.4-rc20 タスク 3: 配布版常時記録ラベル（rc18 第 1 弾の 4 ラベルと同パターン）
  try {
    rollingLog('structure:state:send', {
      presetId: id,
      structureLength: sanitized?.levels?.length || 0
    });
  } catch (_) { /* never throw from logging */ }
}
```

### 4.2 変更箇所 2: `src/renderer/renderer.js:6708-6711`

```javascript
try {
  setStructure(value);
  const { currentLevelIndex } = getState();
  renderCurrentLevel(currentLevelIndex);
  renderNextLevel(currentLevelIndex);
  // v2.0.4-rc20 タスク 3: 配布版常時記録ラベル
  try {
    window.api?.log?.write?.('structure:state:recv:hall', {
      structureLength: value?.levels?.length || 0,
      role: window.appRole
    });
  } catch (_) { /* never throw from logging */ }
} catch (err) { console.warn('[dual-sync] structure 適用失敗:', err); }
```

### 4.3 テスト結果（タスク 3 関連）

- T8: `rollingLog("structure:state:send", ...)` 呼出存在 + try/catch wrap ✓
- T9: `structure:state:recv:hall` ラベル送信 + try/catch wrap ✓
- 既存 7 ラベル（rc17 + rc18 第 1 弾）維持 cross-check ✓

---

## §5 タスク 4（バージョン / CHANGELOG / ビルド / コミット）結果

### 5.1 バージョン更新
- `package.json`: `2.0.4-rc19` → `2.0.4-rc20`
- 既存 version assertion 11 ファイル（v130-features / rc7 / rc8 / rc9 / rc10 / rc12 / rc13 / rc15 / rc19 系列 3 ファイル）を `2.0.4-rc19` → `2.0.4-rc20` 一括追従更新
- rc19 系列 3 ファイル（dialog-overlay / structure-payload / special-stack-and-name）はヘッダーコメント `* v2.0.4-rc19` を歴史的識別子として**維持**、version assertion のみ更新

### 5.2 CHANGELOG.md
先頭に `## [2.0.4-rc20] - 2026-05-02` セクション追加（Fixed / Added / Investigated / Tests / Compatibility）。問題 ⑥ 根治、`structure:state:*` 2 ラベル追加、(c) 並存方針による rc19 死コード履歴保護記載。

### 5.3 テストファイル
新規 `tests/v204-rc20-structure-publish.test.js`（**17 件**: T1〜T9 + 致命バグ保護 5 件 + 既存 7 ラベル維持 + rc19 (c) 並存 + version assertion）+ `package.json scripts.test` 末尾に追加。

### 5.4 致命バグ保護 5 件 cross-check（assertion 化済）
- C.2.7-A: `resetBlindProgressOnly` 関数定義存在 ✓
- C.2.7-D: `setDisplaySettings` IPC ハンドラ内 `timerState` destructure 不在 ✓
- C.1-A2: `ensureEditorEditableState` 関数定義存在 ✓
- C.1.7: AudioContext suspend resume 経路維持 ✓
- C.1.8: `tournaments:setRuntime` IPC 存在 + **`presets:saveUser` ハンドラに `schedulePersistRuntime` 不在**（preset / runtime 境界保護）✓

### 5.5 ビルド
```
> pokertimerplus@2.0.4-rc20 build:win
> electron-builder --win
  • building target=nsis file=dist\PokerTimerPLUS+ (Test) Setup 2.0.4-rc20.exe archs=x64
```
**成功**。生成物: `dist/PokerTimerPLUS+ (Test) Setup 2.0.4-rc20.exe` 80MB。

### 5.6 コミット
本 CC_REPORT.md 完成後、`feature/v2.0.4-rc1-test-build` ブランチに rc20 コミット作成（push なし）予定。

---

## §6 致命バグ保護 5 件への影響評価

| 保護項目 | rc20 タスク 1（案 A 実装）| タスク 2（コメント追記）| タスク 3（ログラベル）|
|---|---|---|---|
| C.2.7-A: `resetBlindProgressOnly` / runtime 永続化責任分離 | 影響なし（preset 経路のみ、runtime 不干渉）| 影響なし（コメントのみ）| 影響なし |
| C.2.7-D: `timerState` destructure 除外 | 影響なし | 影響なし | 影響なし |
| **C.1-A2: `ensureEditorEditableState` 4 重防御** | **完全無傷**（外側経路、関数本体無介入）| 影響なし | 影響なし |
| C.1.7: AudioContext resume | 影響なし（音響経路不干渉）| 影響なし | 影響なし |
| **C.1.8: runtime 永続化 8 箇所**（厳格評価）| **完全無傷**。`presets:saveUser` に `schedulePersistRuntime` 追加禁止を遵守、preset と runtime は別 kind で隔離。`tournaments:setRuntime` IPC 無干渉。テスト assertion で担保 | 影響なし | 影響なし |

**全件無傷**。テスト T9 + C.1.8 cross-check で `presets:saveUser` への `schedulePersistRuntime / tournaments:setRuntime` 不在を assertion 化（preset / runtime 境界保護）。

---

## §7 並列 sub-agent / Task 起動数

- **並列起動: 0 体**（CC 直接実装、cc-operation-pitfalls.md §1.1 上限 3 体準拠、§2.2「小さな修正に sub-agent を使わない」遵守）
- 修正規模: 約 18 行 / 2 ファイル + テスト 1 ファイル + version 追従 11 ファイル + CHANGELOG + package.json と中規模だが、各タスクが独立かつ短く、ファイル間競合（main.js / renderer.js）回避のため逐次実装が安全と判断
- NEXT_CC_PROMPT §5 推奨「0〜1 体推奨」と整合

---

## §8 構築士への質問

なし。NEXT_CC_PROMPT §1〜4 すべての指示を満たし、ブラックリスト遵守:
- `_savePresetCore` への `setStructure` 追加なし（① β）
- `handlePresetApply` の clean 時 IPC 追加なし（② B）
- `timer.js` の `targetTime` 再計算経路追加なし（③ c、テスト T7 で assertion 化）
- `normalizeTournament` 修正なし（rc19 (c) 並存方針、コメント追記のみ、テストで履歴保護担保）

発見した別問題なし。

---

## §9 一時計測ログ挿入の確認

**該当なし**。本フェーズで一時計測ログをコードに挿入していません。

タスク 3 で追加した `structure:state:send` / `structure:state:recv:hall` 2 ラベルは**配布版常時記録ラベル**（rc18 第 1 弾の 4 ラベルと同パターン）であり、削除予定なし。すべて `try { ... } catch (_) { }` で wrap、never throw from logging。

---

## §10 スコープ管理の自己申告

NEXT_CC_PROMPT.md の指示外の実装を一切行っていません:

- **タスク 1**: 指示通り `presets:saveUser` ハンドラ末尾の `_publishDualState('structure', sanitized)` 強制発火 + hall 受信側 `kind === 'structure'` case 追加のみ。`_savePresetCore` / `handlePresetApply` / `timer.js` には**触らず**（① β / ② B / ③ c 遵守）。
- **タスク 2**: 指示通りコメント追記のみ、コードロジック変更ゼロ（(c) 並存方針）。
- **タスク 3**: 指示通り 2 ラベル追加のみ。
- **タスク 4**: 指示通りバージョン / CHANGELOG / テスト追従 / ビルド / コミット準備。
- **発見した別問題なし**。
- **致命級バグ新発見なし**。
- **「念のため」修正・hard-coded 値・特定入力 workaround は一切混入させていません**。
- **案 B / 案 C は採用していません**（NEXT_CC_PROMPT §0「案 A 単独確定」遵守）。

---

**rc20 実装完了**。

- タスク 1（案 A 実装、`_publishDualState('structure', sanitized)` 強制発火 + hall 受信 `kind === 'structure'` case）: 完了 + テスト T1〜T7 PASS
- タスク 2（rc19 死コードコメント追記、(c) 並存方針）: 完了、コードロジック変更ゼロ、(c) 並存 assertion で履歴保護担保
- タスク 3（`structure:state:send` / `structure:state:recv:hall` 2 ラベル追加）: 完了 + テスト T8〜T9 PASS
- タスク 4（version / CHANGELOG / テスト追従 / ビルド / コミット）: 全 610 件 PASS / 0 FAIL、`PokerTimerPLUS+ (Test) Setup 2.0.4-rc20.exe` 80MB 生成、コミット準備完了
- 並列 sub-agent: 0 体（直接実装、修正規模小のため overhead 回避、§5 推奨と整合）
- 致命バグ保護 5 件: 全件完全無傷（特に C.1.8 / C.1-A2）

構築士は本 CC_REPORT を採点 → 前原さんに翻訳説明 → **前原さん rc20 試験**へ。試験項目は NEXT_CC_PROMPT §7（**問題 ⑥ 根治確認**: ブラインドタブで構造変更 → 「保存」 → 「適用」（時間あけて押す） → 会場モニター即時新ブラインド切替確認、③ c により進行中レベルは古いまま / 次レベル切替時に新 duration、既存機能維持）。試験 OK → **v2.0.4 final 本配布**（main マージ + GitHub Release タグ + .exe 公開）。
