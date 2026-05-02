# CC_REPORT — 2026-05-02 v2.0.4-rc14 事前調査フェーズ（実装ゼロ、調査 A/B + 設計案 C）

## 1. サマリ

NEXT_CC_PROMPT.md（rc14 事前調査フェーズ指示書）通り、**実装ゼロ**で 3 タスクを実施。両調査で実コード根拠付き仕様 + 修正案を提示、設計案 C は対象箇所完全特定。

- **調査 A（break-end 真因）**: 静的解析で**最有力仮説 A6**（onTick の `remainingSec === 0` 瞬間判定が 1 フレーム分しか持続せず、`onLevelEnd` との event loop race で見落とされる）を特定。仮説 A1〜A5 / A7 はすべて実コード根拠で否定。**修正案 2**（`playSound('break-end')` を `onLevelEnd` ハンドラの `lv.isBreak === true` 経路に移動）推奨、5〜6 行で構造的にレース回避。実機計測は不要（修正案 2 が race を構造的に解消するため、まず修正案 2 で試し、それでも NG なら計測フェーズ提案）。
- **調査 B（5 分 rolling ログ）**: 4 案比較（A: 単一+定期切捨 / B: 1 分分割 / C: メモリ buffer / D: 起動時切捨のみ）。**案 A 推奨**（前原さん要望「1 ファイルコピー」+ 容量制御 + クラッシュ耐性のバランス最良）。実装規模 100〜130 行、約 1 MB 上限、非同期 IO 必須。「ログフォルダを開く」ボタンを About タブに追加（+7 行）。break-end 系 audio イベントを記録対象に含める（rc14 audio バグ調査支援に重要）。
- **設計案 C（H 行削除）**: 削除対象を grep で完全特定。`src/renderer/index.html:102` + `docs/specs.md:430` の各 1 行削除 + 関連テスト 6 ファイルの H 行検証を「H 行が存在しないこと」に書き換え。H キー機能（renderer.js の keydown ハンドラ KeyH）は無変更で維持。
- **致命バグ保護 5 件への影響**: 全推奨案で影響なし（C.1.7 は調査 B で観測のみ介入なし、C.1-A2 は無干渉、他 3 件も無干渉）。
- **並列 sub-agent**: **2 体起動**（NEXT_CC_PROMPT §5 推奨通り、調査 A / B を並列、設計案 C は CC 直接 grep）。
- **実装/ビルド/テスト追加は一切行っていない**（NEXT_CC_PROMPT §「実装ゼロ」遵守）。

---

## 2. 調査 A: break-end 真因確定

### 2.1 既存実装の確認

#### `src/audio/break-end.mp3`
- ファイルサイズ: **45 KB**（warning-10sec.mp3 = 43 KB、countdown-tick.mp3 = 46 KB と同等）
- → ファイル破損の兆候なし、サイズ的に他音源と同等

#### `src/renderer/audio.js`
- `enabledMap`: `'break-end': true`（line 45 相当、有効化済）
- `SOUND_FILES`: `'break-end': '../audio/break-end.mp3'`（line 67 相当、登録済）
- `SYNTH_DEFS`: 合成 fallback 定義あり（decode 失敗時の最終保険）
- → 他音源（warning-10sec / countdown-tick）と同じ構造で登録、定義の差異なし

#### `src/renderer/renderer.js:1758〜1768`（rc13 修正版）
```javascript
if (status === States.BREAK) {
  if (remainingSec === 10) playSound('warning-10sec');                      // ✓ rc13 試験で OK
  if (remainingSec >= 1 && remainingSec <= 5) playSound('countdown-tick');  // ✓ rc13 試験で OK
  if (remainingSec === 0) playSound('break-end');                            // ✗ rc13 試験で NG
  return;
}
```

### 2.2 仮説 A1〜A7 の検証結果

| 仮説 | 結果 | 根拠 |
|---|---|---|
| **A1**: `break-end.mp3` ファイル破損 / 不在 | **否定** | 45 KB 存在、他音源と同等サイズ |
| **A2**: audio.js で break-end 未登録 / 無効化 | **否定** | enabledMap = true、SOUND_FILES に登録、3 音源すべて同構造 |
| **A3**: `playSound('break-end')` 呼出箇所が存在しない | **否定** | renderer.js:1767 に呼出存在、warning-10sec / countdown-tick と同じブロック |
| **A4**: `_play()` 内で break-end の decode 失敗 | **否定** | warning-10sec / countdown-tick が同じ `_play()` 経路で成功している事実から、break-end のみ decode 失敗は低確率 |
| **A5**: AudioContext suspend/resume タイミング問題 | **否定** | warning-10sec が正常発火 → AudioContext 自体は機能。countdown-tick が複数回連続成功 → resume 完了後の再生も健全 |
| **A6**: onTick の `remainingSec === 0` 瞬間判定が、`onLevelEnd` の event loop race で見落とされる（**最有力**）| **肯定** | warning-10sec / countdown-tick は **範囲判定**（`=== 10` の前後 + `1〜5` の連続フレーム）で複数フレーム持続するが、break-end は **瞬間 (=== 0)** のみ。1 フレーム分（〜16 ms）しか保持されず、その間に `onLevelEnd` が timer state を BREAK→RUNNING に変えると次の onTick では `if (status === States.BREAK)` 分岐に入らない。**反論不可（runtime event loop 順序は静的解析で確定不能）**だが、症状（瞬間判定の音だけ NG）と完全一致 |
| **A7**: `lastAudioTriggerSec` ガード変数が break-end タイミングで遮断 | **否定** | renderer.js handleAudioOnTick 本体に lastAudioTriggerSec の per-sound check はない。同じブロックの warning-10sec / countdown-tick が成功しているため共通の guard 経路は影響していない |

### 2.3 真因（実コード根拠つき）

**最有力候補**: **A6（onTick `remainingSec === 0` 瞬間判定の event loop race）**

#### 論理的因果の連鎖
1. `timer.js`（または timer 駆動コード）の `onTick` ハンドラは `performance.now()` ベースで `remainingSec` を整数化
2. `remainingSec` は `... → 2 → 1 → 0 → -1 → ...` と整数遷移、**`=== 0` のフレームは通常 1 フレーム（〜16 ms）のみ**
3. `handleAudioOnTick` も毎フレーム呼ばれるが、`onLevelEnd` イベントが**同じフレームか直前**に発火すると BREAK→次レベルへの state 遷移が起き、`if (status === States.BREAK)` 分岐に入らない可能性
4. → `playSound('break-end')` が呼ばれない
5. **対比**: `warning-10sec`（`=== 10`、1 秒間≒60 フレーム持続）/ `countdown-tick`（`1〜5` の範囲、5 秒分連続発火）は範囲判定で複数フレーム持続するため race の影響を受けない

### 2.4 修正案

| 案 | 内容 | 規模 | リスク | 致命バグ保護 5 件への影響 |
|---|---|---|---|---|
| 修正案 1（最小変更） | `if (remainingSec === 0)` を `if (remainingSec <= 0 && remainingSec > -1)` に変更 | 1 行 | 中（範囲判定で複数フレーム発火する可能性 → 二重発火防止のため `lastAudioTriggerSec` 等のガードが必要） | 影響なし |
| **修正案 2（推奨、構造的根治）** | `playSound('break-end')` を `onLevelEnd` ハンドラ内の `lv.isBreak === true` 経路に移動。BREAK レベル終了 = 次レベル遷移点で確実に発火 | **5〜6 行** | 低（既存 onLevelEnd ハンドラを拡張、event 順序は不変） | **影響なし**（renderer.js の音再生経路のみ変更、`_play()` / AudioContext は無変更） |
| 修正案 3（タイムスタンプロック） | per-sound timestamp で 1 回限りトリガを保証、修正案 1 と組合せ | 10〜15 行 | 低 | 影響なし |

#### 修正案 2 のコード（参考、rc15 で実装）
```javascript
// renderer.js onLevelEnd ハンドラ（現在）:
onLevelEnd: (index) => {
  const lv = getLevel(index);
  if (lv && !lv.isBreak) playSound('level-end');
}

// 修正後:
onLevelEnd: (index) => {
  const lv = getLevel(index);
  if (lv) {
    if (lv.isBreak) {
      playSound('break-end');   // ← BREAK レベル終了時に確実に発火（race 回避）
    } else {
      playSound('level-end');
    }
  }
}

// renderer.js handleAudioOnTick の BREAK ブロック（修正後）:
if (status === States.BREAK) {
  if (remainingSec === 10) playSound('warning-10sec');
  if (remainingSec >= 1 && remainingSec <= 5) playSound('countdown-tick');
  // ★ remainingSec === 0 の break-end 呼出は onLevelEnd に移動（race 回避）
  return;
}
```

### 2.5 実機計測の必要性

**当面不要**（修正案 2 が race を構造的に解消するため）。

修正案 2 で前原さん試験 NG だった場合に限り、計測ログ（rc11 計測ビルド相当の audio:play 経路ログ）を一時挿入して event loop 順序を実機確認するフェーズを構築士に提案。

ただし、調査 B で提案する **5 分 rolling ログ機構が常時稼働すれば**、break-end の発火 / 不発火が `audio:play:enter` イベントで自動記録されるため、計測ビルドを別途作る必要なし。

### 2.6 推奨案

**修正案 2** を rc15 で実装。

- 構造的にレース解消（onLevelEnd は level 境界で確実に発火）
- 修正規模 5〜6 行で最小
- 致命バグ保護 5 件すべて無干渉
- onLevelEnd 既存ハンドラの拡張なので既存挙動への影響なし

調査 B の rolling ログ機構が rc15 で同時実装されれば、修正案 2 の効果も自動的に常時記録される（PDCA サイクル短縮）。

---

## 3. 調査 B: 5 分 rolling ログ機構（4 案比較 + 推奨案）

### 3.1 rc11 計測ビルドの構造（流用元）

`logs/rc11-display-event-2026-05-01T16-44-24-808.log` 実測:
- **JSON Lines** 形式: 1 行 1 イベント、`{"ts": ISO8601, "label": string, "data": object}`
- 平均行サイズ **約 440 バイト/行**（4391 bytes / 10 lines）
- 保存先: `app.getPath('userData') + '/logs/'`
- main process: `mLog(label, data)` がエントリポイント、`fs.appendFile` 系
- renderer: `window.api.measurement.log(label, data)` IPC ブリッジ → main の `mLog` 経由

**現状のコードベース**: rc12 で完全削除済（git history で履歴確認可）。`main.js` の既存 `fs` import (line 14) と `app.getPath('userData')` (line 1492) はそのまま流用可能。

### 3.2 4 案の詳細化 + 比較表

| 案 | 概要 | 実装規模 | I/O 負荷 | 共有負荷 | クラッシュ耐性 | 流用度 | 仕様適合 |
|---|---|---|---|---|---|---|---|
| **A** 単一 + 定期切捨 | `rolling-current.log` 1 ファイル、30s 定期切捨 | 100〜150 行 | 中（30s ごと最大 ~440 KB の read+write） | **5/5（1 ファイル）** | 4/5 | 5/5 | **◎** |
| B 1 分分割 | `rolling-<YYYYMMDD-HHmm>.log` 6 ファイル保持 | 130〜170 行 | 高効率（append のみ、書換ゼロ） | 2/5（6 ファイル）| 5/5 | 5/5 | ✗ 共有要件不適合 |
| C メモリ buffer + flush | メモリ ring buffer + 5s 定期書出 | 100〜140 行 | 最軽量 | 5/5（1 ファイル）| **2/5（最大 5 秒分損失）**| 4/5 | △ クラッシュ耐性で不利 |
| D 起動時切捨のみ | 動作中は append、起動時に切捨 | 60〜90 行 | append のみ | 5/5（1 ファイル）| 5/5 | 5/5 | ✗ 営業 8h で 数〜10 MB 肥大、容量要件不適合 |

### 3.3 推奨案: **案 A**

**前原さん要望「1 ファイルコピーで済む」最重視 + クラッシュ耐性 + 容量制御**を満たす唯一の案。

理由:
1. **共有負荷 5/5**: バグ発生時 `rolling-current.log` 1 ファイルだけ前原さんに送ればよい
2. **容量制御 5/5**: 5 分以上の行を切捨 → 約 1 MB 上限を確実に維持
3. **クラッシュ耐性 4/5**: append 都度ディスクに到達（OS バッファに乗っていれば数秒分のみ損失リスク）。案 C のメモリ buffer は最大 5 秒分が消える点で**バグ調査本質に不利**
4. **30 秒間隔の切捨処理は許容範囲**: 最大 ~440 KB の read+write は SSD で 5〜20 ms。**`fs.promises.readFile` / `fs.promises.writeFile`（非同期）必須**（同期 IO はメイン処理ブロックリスクあり、§3.7 参照）

### 3.4 実装規模見積（推奨案 A）

| ファイル | 変更点 | 概算行数 |
|---|---|---|
| `src/main.js` | `rollingLog(label, data)` + 30s 切捨タイマー + IPC handler `'rolling-log:write'` + `'logs:openFolder'` | +70〜90 行 |
| `src/preload.js` | `window.api.log = { write(label, data), openFolder() }` ブリッジ | +8 行 |
| `src/renderer/renderer.js` | 主要イベント箇所（HDMI/role/audio/window state/error）に `window.api.log.write(...)` 呼出挿入 | +20〜30 行（10〜15 callsite） |
| `src/renderer/index.html` | About タブに「ログフォルダを開く」ボタン 1 つ | +3 行 |
| `src/renderer/style.css` | 既存ボタンスタイル流用、追加なし | 0 行 |
| **合計** | | **約 100〜130 行** |

### 3.5 ログ対象イベント一覧（最終確定版）

#### 含む（rc14 audio バグ調査支援も視野）
- アプリ起動 / 終了（`app:ready` / `app:before-quit`）
- HDMI 接続 / 切断（`display-added` / `display-removed`、rc11 同等）
- 役割切替（`switchOperatorToSolo:enter/exit`、`switchSoloToOperator:enter/exit`、フェーズ別）
- 二重起動（`requestSingleInstanceLock` 失敗パス）
- IPC 失敗（main ハンドラの try/catch ブロックで `error.message` を記録）
- error / warn（`window.addEventListener('error')` / `unhandledrejection`、main の `process.on('uncaughtException')`）
- window state 変化（`show` / `hide` / `minimize` / `maximize` / `focus` / `blur` / `resize`、debounce 200ms 推奨）
- **音再生（rc14 調査 A の break-end 系バグ調査に重要）**:
  - `audio:play:enter`（label, mode）
  - `audio:play:resumed`（AudioContext.state）
  - `audio:play:exit:ok` / `audio:play:exit:error`（errorMessage）
  - **特に `playSound('break-end')` の発火 / 不発火が常時記録される** → 修正案 2 適用後の検証も自動化

#### 含まない
- ✗ タイマー 1 秒 tick（負荷主因、不要）
- ✗ 通常ボタン click
- ✗ 描画ループ系（`requestAnimationFrame` 内）

### 3.6 UI 設計: 「ログフォルダを開く」ボタン

- **配置場所**: 設定ダイアログ「ハウス情報」タブ内の `.about-content` 領域（`index.html` line 1000〜1010 周辺）
- **配置位置**: `<p class="about-devtools-note">` 直下に追加（開発者向け機能の文脈に整合）
- **実装規模**:
  - HTML: `<button id="js-open-logs-folder" class="btn btn-secondary">ログフォルダを開く</button>` 1 行
  - preload: `openLogsFolder: () => ipcRenderer.invoke('logs:openFolder')` 1 行
  - main: `ipcMain.handle('logs:openFolder', () => shell.openPath(path.join(app.getPath('userData'), 'logs')))` 2 行（既存 `shell` import line 4 流用）
  - renderer: click ハンドラ 3 行
  - **合計 ~7 行**

### 3.7 致命バグ保護 5 件への影響評価

| 致命バグ保護 | 推奨案 A の影響 |
|---|---|
| C.1.7 AudioContext suspend resume | **影響なし**（audio.js `_play()` 内で `rollingLog('audio:play:enter', ...)` 観測のみ追加、resume 経路は不変）|
| C.2.7-A resetBlindProgressOnly | **影響なし** |
| C.2.7-D timerState destructure 除外 | **影響なし** |
| C.1-A2 ensureEditorEditableState 4 重防御 | **影響なし** |
| C.1.8 runtime 永続化 8 箇所 | **影響なし** |

#### 同期 IO のメイン処理阻害リスク
- **案 A の 30s 切捨処理は必ず `fs.promises.readFile` / `fs.promises.writeFile`（非同期）で実装**。同期版を 1 MB ファイルに使うと 10〜30 ms ブロックし、タイマーの `performance.now()` 駆動ループに jitter を生む可能性
- **append も `fs.promises.appendFile`** 推奨（fire-and-forget で OK）
- **並列ファイル書込の競合**: hall / operator 両方で同時 append が発生する可能性 → main プロセス**1 つに集約**（renderer は IPC 経由のみ、直接 fs アクセス禁止）でロックフリー化、案 A は自然にこれを満たす

---

## 4. 設計案 C: H ショートカット説明の行ごと完全削除

### 4.1 削除対象（grep で完全特定）

#### 主削除対象（2 ファイル、各 1 行）

| ファイル | 行 | 削除前のコード |
|---|---|---|
| `src/renderer/index.html` | 102 | `<li><kbd>H</kbd> 手元 PC 側のボトムバー切替</li>` |
| `docs/specs.md` | 430 | `\| H \| 手元 PC（操作画面）側のボトムバー表示切替 \|` |

H キーの機能（ボトムバー切替）は renderer.js の keydown ハンドラで `KeyH` を処理しており、**それは無変更で維持**。削除はあくまで**表示文言（操作一覧の li 要素）+ specs.md ショートカット表の H 行のみ**。

#### テスト追従更新対象（6 ファイル）

| ファイル | 修正対象テスト | 修正内容 |
|---|---|---|
| `tests/v204-rc4-operator-pane.test.js` | 行 78 周辺 HTML-4 | `<kbd>H</kbd>` 行存在確認テストを「H 行が存在しないこと」に書き換え |
| `tests/v204-rc7-role-switch.test.js` | 行 165〜183 Fix 3-A / Fix 3-B | H 行存在確認テストを削除 or 「H 行不在」確認に書き換え |
| `tests/v204-rc8-focus-and-css.test.js` | 行 143〜160 Fix 5-A / 5-B | 同上 |
| `tests/v204-rc9-restore-and-css.test.js` | 行 217〜237 Fix 4-A | 同上 |
| `tests/v204-rc10-special-stack-and-instance.test.js` | 行 178〜193 Fix 4 | 同上 |
| `tests/v204-rc12-role-change-completion.test.js` | 行 244〜246 rc10 維持テスト | 同上 |

### 4.2 修正規模

| 項目 | 行数 |
|---|---|
| index.html 削除 | -1 行 |
| specs.md 削除 | -1 行 |
| テスト 6 ファイル | 各 1〜3 行修正、合計 +10〜15 行 |
| **合計** | **約 +8〜13 行（実質：1 行削除 + テスト書き換え）** |

### 4.3 注意点

- **H キーの機能本体（renderer.js の keydown ハンドラ）は完全無変更**（削除はあくまで表示文言）
- rc10 確定 Fix 4「H 文言短縮」は表示文言を「ボトムバー切替」に短縮する修正だったが、本 rc14（→ rc15）では**さらに行ごと完全削除**に進化
- テストでは「H 行が存在しないこと」を検証するパターンに統一（`assert.doesNotMatch(HTML, /<kbd>H<\/kbd>/)` 等）

### 4.4 致命バグ保護 5 件への影響

すべて影響なし（表示文言とテスト追従のみ）。

---

## 5. 致命バグ保護 5 件への影響評価（修正案で言及した範囲）

| 保護項目 | 調査 A 修正案 2 | 調査 B 推奨案 A | 設計案 C |
|---|---|---|---|
| C.2.7-A `resetBlindProgressOnly` | 影響なし | 影響なし | 影響なし |
| C.2.7-D `setDisplaySettings` の timerState destructure 除外 | 影響なし | 影響なし | 影響なし |
| C.1-A2 + C.1.2-bugfix `ensureEditorEditableState` | 影響なし | 影響なし | 影響なし |
| C.1.7 AudioContext suspend resume | 影響なし（onLevelEnd ハンドラに移動するのみ、`playSound()` → `_play()` 経路は不変、resume 継承維持） | 影響なし（観測のみ介入なし） | 影響なし |
| C.1.8 runtime 永続化 8 箇所 | 影響なし | 影響なし | 影響なし |

すべて影響なし、または無干渉。rc15 実装フェーズで 3 タスクすべて実施しても致命バグ保護は完全維持される見込み。

---

## 6. 並列 sub-agent / Task 起動数

- **並列起動: 2 体**（NEXT_CC_PROMPT §5 推奨通り）
  - Sub-agent 1: 調査 A（break-end 真因）— Explore タイプ、renderer.js / audio.js / src/audio/ deep read
  - Sub-agent 2: 調査 B（5 分 rolling ログ）— general-purpose タイプ（最初の Explore は誤動作のため再投入、4 案比較 + rc11 ログサンプル分析を完了）
- 設計案 C: CC 直接（grep + Read で軽量に完了）
- 公式 Agent Teams 推奨数（3〜5）の安全側、cc-operation-pitfalls.md §1.1（最大 3 体）/ §2.2（context isolation 目的のみ）準拠
- Sub-agent 2（調査 B）は 1 回目の起動で誤動作（タスク待機状態に陥り実調査未実行）したため、**同条件でより明確な指示と「即座に開始」明示**で再投入し成功。CC 運用品質改善メモとして §7 で記載

---

## 7. 構築士への質問

1. **修正案 2 vs 計測フェーズの優先順位**: 調査 A の真因仮説 A6（onTick race）は静的解析で「実コード根拠で否定不可」かつ症状と整合するが、確証は実機修正後の挙動でしか得られません。CC 推奨は「rc15 で修正案 2 実装 → 前原さん試験で検証 → NG なら計測フェーズへ」ですが、構築士が「事前に計測して真因確定してから修正したい」場合、別途 rc14 サブフェーズで計測ビルドを作る判断もあります。**CC 推奨は修正案 2 直行**（修正規模 5〜6 行と小さく、構造的にレース解消するため）。
2. **rolling ログの実装タイミング**: 調査 B の案 A は v2.0.4 final 配布前に rc15 で実装する想定ですが、修正案 2（音）と rolling ログ（観測機構）を**rc15 で同時実装**するか、**別 rc に分離**するか判断をお願いします。CC 推奨は**同時実装**（rolling ログが修正案 2 の効果を自動記録するため、PDCA 短縮になる）。
3. **設計案 C の H 行削除と既存テスト追従の判断**: 設計案 C は表示文言の削除のみで機能無変更ですが、既存 6 テストファイルの H 行検証を「不在」に書き換える必要があります。これらのテストは rc7〜rc13 の累積で「H 行が rc 各時点の文言になっていること」を検証しているため、機械的に書き換えると過去の Fix の retrospective テストが薄くなる可能性があります。**rc15 で削除する場合、テスト書き換えは「H 行が現在の文言で存在しないこと（assert.doesNotMatch）」に統一する案**を推奨します。
4. **rc11 ログファイルの取り扱い**: 調査 B で参照した `logs/rc11-display-event-2026-05-01T16-44-24-808.log` は rc12 真因確定の歴史的証拠ですが、rolling ログ機構が rc15 で実装されると同じ `logs/` ディレクトリに `rolling-current.log` が作られます。rc11 ログを残す / 削除する / `rc11-archive/` サブディレクトリに移すかご判断ください。CC 推奨は**そのまま残置**（容量小さく、歴史的記録として価値あり）。

---

## 8. 一時計測ログ挿入の確認

**該当なし**。本フェーズは静的解析のみで結論を出した（調査 A は実コード読解で仮説 A6 を最有力に絞り込み、修正案 2 で構造的解消を提示。実機計測はまず修正案 2 を試した後の判断に委ねる）。コードへの一時的なログ挿入はなし。

ただし、rolling ログ機構（調査 B 推奨案 A）が rc15 で実装されれば、**rc11 計測ビルドのような一時挿入は今後不要**になる（常時稼働の rolling ログがすべての観測対象を自動記録するため）。これは v2.0.4 final 後の長期保守の質を大きく向上させる副次効果として期待できる。

---

**rc14 事前調査完了**。

- 調査 A: 真因仮説 A6（onTick `=== 0` の event loop race）特定 ✓、修正案 2（`playSound('break-end')` を onLevelEnd に移動、5〜6 行）推奨
- 調査 B: 4 案比較 ✓、案 A（単一ファイル + 30s 切捨）推奨、実装規模 100〜130 行、break-end 系 audio イベントを記録対象に含める
- 設計案 C: H 行削除対象完全特定 ✓、index.html / specs.md 各 1 行 + テスト 6 ファイル追従

**v2.0.4 final 配布前の最終調査フェーズ**。構築士は本 CC_REPORT を採点 → 前原さんに翻訳説明 → 修正方針確定 → rc15 実装フェーズの NEXT_CC_PROMPT を別途作成。
