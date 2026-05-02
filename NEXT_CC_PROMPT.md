# v2.0.4-rc15 実装フェーズ（break-end 修正 + 5 分 rolling ログ + H 行削除 + バージョンバンプ + ビルド）

## 【最重要】このプロンプト実行前のお願い

**Claude Code で `/clear` コマンドを必ず実行してから本プロンプトを読み込むこと**。rc14 事前調査フェーズからの context 引きずり防止。

`/clear` 後は以下を順に Read してから本プロンプトに従うこと:
1. `poker-clock/HANDOVER.md`
2. `poker-clock/CC_REPORT.md`（rc14 事前調査報告、本実装の根拠資料）
3. `poker-clock/CLAUDE.md`
4. `poker-clock/skills/cc-operation-pitfalls.md`（特に §1 / §6 / §7）
5. `poker-clock/skills/audio-system.md`（音響系の既存仕様、タスク 1 で必須）
6. `poker-clock/skills/timer-logic.md`（不変条件、タスク 1 の onLevelEnd 拡張で参照）

## 推奨モデル

**Sonnet 4.6**

---

## ■ 構築士の判断（rc14 事前調査の 4 質問への回答）

CC からの 4 質問はすべて **CC 推奨案を採用**:

1. **修正案 2 直行**（onLevelEnd へ移動、構造的に race 解消、5〜6 行）→ 採用
2. **rc15 で 3 件同時実装**（音修正 + rolling ログ + H 削除を一括）→ 採用
3. **テスト書き換えは「H 行が存在しないこと」検証に統一**（`assert.doesNotMatch` 等）→ 採用
4. **rc11 ログファイル `logs/rc11-display-event-2026-05-01T16-44-24-808.log` はそのまま残置**（歴史的証拠、容量小）→ 採用

---

## ■ 今回 やる範囲（ホワイトリスト）

本フェーズは **実装 + テスト追加 + ビルドあり**。rc14 事前調査の結果を rc15 として完成させ、前原さん試験へ繋ぐ。

- **タスク 1**: break-end 修正案 2（`playSound('break-end')` を `onLevelEnd` ハンドラの `lv.isBreak === true` 経路に移動、5〜6 行）
- **タスク 2**: 5 分 rolling ログ機構 案 A（単一ファイル + 30 秒定期切捨、約 100〜130 行）
- **タスク 3**: H ショートカット行削除（index.html + specs.md 各 1 行 + 関連テスト 6 ファイル追従）
- **タスク 4**: バージョン `2.0.4-rc15` バンプ + CHANGELOG 更新 + ビルド（`npm run build:win`）+ 全テスト PASS 確認

## ■ 今回 触ってはいけない範囲（ブラックリスト）

- **致命バグ保護 5 件**（cc-operation-pitfalls.md §1.5）には絶対触らない
  - C.2.7-A `resetBlindProgressOnly` / C.2.7-D `timerState` destructure 除外 / C.1-A2 `ensureEditorEditableState` 4 重防御 / C.1.7 AudioContext resume / C.1.8 runtime 永続化
- rc10 確定 Fix（specialStack / 二重送信 / app.focus / 単一インスタンス / H 文言短縮）/ rc12 確定 Fix（onRoleChanged setAttribute 最優先 + appRole try-catch）/ rc13 確定 Fix（複製 readonly + BREAK 中 10 秒前 / 5 秒カウント音）すべて維持
- **スコープ管理**: 4 タスク以外の修正・リファクタ・追加実装は禁止
- 「念のため」修正・hard-coded 値・特定入力 workaround は厳禁
- 発見した別問題は CC_REPORT「構築士への質問」に提案として記載のみ
- カード幅 54vw / 46vw / Barlow Condensed 700 / `<dialog>` flex 化禁止 等の不変ルールも維持

## 致命級バグ発見時の例外

実装中に致命級バグを発見した場合のみ、CC_REPORT 冒頭に **🚨警告** セクションを追加。実装はせず、構築士判断を仰ぐ。

---

## 1. タスク 1: break-end 修正案 2（onLevelEnd へ移動）

### 1.1 修正方針

`src/renderer/renderer.js` の以下 2 箇所を修正:

**(A) `handleAudioOnTick` の BREAK ブロック（CC_REPORT §2.4 修正案 2 のコード参照）**:
- `if (remainingSec === 0) playSound('break-end');` の **行を削除**（瞬間判定の race 排除）
- `warning-10sec` / `countdown-tick` の 2 行は維持

**(B) `onLevelEnd` ハンドラの拡張**:
- 現在: `if (lv && !lv.isBreak) playSound('level-end');`
- 修正後:
  ```javascript
  if (lv) {
    if (lv.isBreak) {
      playSound('break-end');   // BREAK レベル終了時に確実に発火（race 回避）
    } else {
      playSound('level-end');
    }
  }
  ```

### 1.2 制約

- 修正規模は **5〜6 行のみ**、それ以上の変更は禁止
- `playSound()` / `_play()` / AudioContext 周りには一切触らない（C.1.7 致命バグ保護維持）
- onLevelEnd の他処理（state 遷移 / display 更新等）は無変更

### 1.3 テスト追加

`tests/v204-rc15-break-end-and-rolling-log.test.js` を新規作成し、以下を検証:
- T1: BREAK レベル終了時に `playSound('break-end')` が呼ばれる（onLevelEnd 経由）
- T2: 通常レベル終了時に `playSound('level-end')` が呼ばれる（onLevelEnd 経由）
- T3: BREAK 中の `remainingSec === 0` で `playSound('break-end')` が **呼ばれない**（onTick から削除されたことを確認）
- T4: BREAK 中の `remainingSec === 10` で `playSound('warning-10sec')` が呼ばれる（rc13 維持）
- T5: BREAK 中の `remainingSec === 5` で `playSound('countdown-tick')` が呼ばれる（rc13 維持）

---

## 2. タスク 2: 5 分 rolling ログ機構 案 A（単一ファイル + 30 秒切捨）

### 2.1 仕様（CC_REPORT §3.3 / §3.4 準拠）

- **保存先**: `<userData>/logs/rolling-current.log`
- **形式**: JSON Lines（rc11 計測ビルド準拠、`{"ts": ISO8601, "label": string, "data": object}`）
- **保持期間**: 直近 5 分間のみ
- **切捨処理**: 30 秒定期タイマーで 5 分超の行を削除（**`fs.promises.readFile` / `fs.promises.writeFile` の非同期 IO 必須**、同期 IO はメイン処理ブロックリスクで禁止）
- **append**: `fs.promises.appendFile`（fire-and-forget）
- **renderer 側は直接 fs アクセス禁止**（IPC 経由のみ、main プロセスに集約してロックフリー化）

### 2.2 実装範囲（CC_REPORT §3.4 行数見積）

| ファイル | 変更点 | 概算行数 |
|---|---|---|
| `src/main.js` | `rollingLog(label, data)` 関数 + 30s 切捨タイマー + IPC `'rolling-log:write'` + `'logs:openFolder'` | +70〜90 行 |
| `src/preload.js` | `window.api.log = { write(label, data), openFolder() }` ブリッジ | +8 行 |
| `src/renderer/renderer.js` | 主要イベント箇所に `window.api.log.write(...)` 挿入（10〜15 callsite） | +20〜30 行 |
| `src/renderer/index.html` | About タブに「ログフォルダを開く」ボタン 1 つ | +3 行 |
| `src/renderer/style.css` | 既存ボタンスタイル流用、追加なし | 0 行 |
| **合計** | | **約 100〜130 行** |

### 2.3 ログ対象イベント（CC_REPORT §3.5 確定版）

#### 含む:
- `app:ready` / `app:before-quit`
- `display-added` / `display-removed`
- `switchOperatorToSolo:enter/exit` / `switchSoloToOperator:enter/exit`（フェーズ別）
- `requestSingleInstanceLock` 失敗パス
- IPC 失敗（main の try/catch で `error.message` 記録）
- `error` / `unhandledrejection`（main の `process.on('uncaughtException')` 含む）
- window state 変化（`show` / `hide` / `minimize` / `maximize` / `focus` / `blur` / `resize`、**debounce 200ms 推奨**）
- **音再生（タスク 1 検証に必須）**:
  - `audio:play:enter`（label, mode）
  - `audio:play:resumed`（AudioContext.state）
  - `audio:play:exit:ok` / `audio:play:exit:error`（errorMessage）

#### 含まない:
- ✗ タイマー 1 秒 tick
- ✗ 通常ボタン click
- ✗ requestAnimationFrame 内の描画ループ

### 2.4 「ログフォルダを開く」ボタン UI（CC_REPORT §3.6 準拠）

- **配置場所**: 設定ダイアログ「ハウス情報」タブ内の `.about-content` 領域、`<p class="about-devtools-note">` 直下
- **HTML**: `<button id="js-open-logs-folder" class="btn btn-secondary">ログフォルダを開く</button>`
- **main**: `ipcMain.handle('logs:openFolder', () => shell.openPath(path.join(app.getPath('userData'), 'logs')))`
- **preload**: `openLogsFolder: () => ipcRenderer.invoke('logs:openFolder')`
- **renderer**: click ハンドラで `window.api.log.openFolder()` 呼出

### 2.5 致命バグ保護 5 件への影響

すべて **影響なし**（CC_REPORT §3.7 で検証済）。特に C.1.7（AudioContext resume）は audio.js `_play()` 内で `window.api.log.write('audio:play:enter', ...)` の **観測のみ追加**、resume 経路には介入しない。

### 2.6 テスト追加

`tests/v204-rc15-break-end-and-rolling-log.test.js` に以下も追加:
- T6: rolling ログファイルに append される（mock fs で確認）
- T7: 30 秒切捨処理で 5 分超の行が削除される
- T8: IPC `logs:openFolder` ハンドラが登録されている
- T9: window state 変化が debounce 200ms で記録される
- T10: タイマー 1 秒 tick / 通常ボタン click は **記録されない**

---

## 3. タスク 3: H ショートカット行削除（CC_REPORT §4 準拠）

### 3.1 主削除対象（2 ファイル、各 1 行）

| ファイル | 行 | 削除前のコード |
|---|---|---|
| `src/renderer/index.html` | 102 | `<li><kbd>H</kbd> 手元 PC 側のボトムバー切替</li>` |
| `docs/specs.md` | 430 | `\| H \| 手元 PC（操作画面）側のボトムバー表示切替 \|` |

**H キー機能本体（renderer.js の keydown ハンドラ KeyH）は完全無変更**。

### 3.2 テスト追従更新（6 ファイル）

| ファイル | 修正対象 | 修正内容 |
|---|---|---|
| `tests/v204-rc4-operator-pane.test.js` | 行 78 周辺 HTML-4 | `assert.doesNotMatch(HTML, /<kbd>H<\/kbd>/)` で H 行不在検証に書き換え |
| `tests/v204-rc7-role-switch.test.js` | 行 165〜183 Fix 3-A / Fix 3-B | 同上 |
| `tests/v204-rc8-focus-and-css.test.js` | 行 143〜160 Fix 5-A / 5-B | 同上 |
| `tests/v204-rc9-restore-and-css.test.js` | 行 217〜237 Fix 4-A | 同上 |
| `tests/v204-rc10-special-stack-and-instance.test.js` | 行 178〜193 Fix 4 | 同上 |
| `tests/v204-rc12-role-change-completion.test.js` | 行 244〜246 rc10 維持テスト | 同上 |

### 3.3 修正規模

- index.html: -1 行 / specs.md: -1 行 / テスト 6 ファイル: 各 1〜3 行修正
- **合計: -2 行 + テスト書換 10〜15 行**

---

## 4. タスク 4: バージョンバンプ + CHANGELOG + ビルド

### 4.1 バージョン更新

- `package.json` の version を `2.0.4-rc14`（または現在値）→ `2.0.4-rc15` に更新
- `CHANGELOG.md` に rc15 セクション追加:
  - break-end 修正（onLevelEnd へ移動、race 解消）
  - 5 分 rolling ログ機構（バグ調査支援、約 1 MB 上限）
  - H ショートカット説明削除
  - 関連テスト追加

### 4.2 ビルド検証

- `npm test` で全テスト PASS 確認（rc13 時点 491 件 + 本フェーズで T1〜T10 追加 → 約 501 件）
- `npm run build:win` で `dist/PokerTimerPLUS+ (Test) Setup 2.0.4-rc15.exe` 生成
- ビルド成功確認 + ファイルサイズ報告（CC_REPORT §1 サマリに記載）

### 4.3 git コミット

- `feature/v2.0.4-rc1-test-build` ブランチに rc15 コミットを作成（push なし）
- コミットメッセージ例: `chore(v2.0.4): rc15 - break-end fix + rolling log + H line removal`

---

## 5. 並列 sub-agent

- **2 体並列推奨**（公式 Agent Teams 上限 3 体準拠）
  - Sub-agent 1: タスク 1（break-end 修正 + テスト T1〜T5）
  - Sub-agent 2: タスク 2（rolling ログ機構実装 + テスト T6〜T10）
- タスク 3（H 行削除）+ タスク 4（バージョン / ビルド）: CC 直接対応
- cc-operation-pitfalls.md §1.1（最大 3 体）/ §2.2（context isolation 目的のみ）準拠

---

## 6. CC_REPORT.md 必須セクション

- §1 サマリ（実装結果 + テスト数 + ビルド成功可否 + .exe サイズ + コミットハッシュ）
- §2 タスク 1（break-end 修正）変更箇所 + 差分要約 + テスト T1〜T5 結果
- §3 タスク 2（rolling ログ）変更箇所 + 差分要約 + テスト T6〜T10 結果 + 実装規模実測
- §4 タスク 3（H 行削除）変更箇所一覧 + テスト追従結果
- §5 タスク 4（バージョン / CHANGELOG / ビルド）成果物
- §6 致命バグ保護 5 件への影響評価（個別検証）
- §7 並列 sub-agent / Task 起動数の報告
- §8 構築士への質問（必要に応じて）
- §9 一時計測ログ挿入の確認（本フェーズで挿入なしなら「該当なし」）
- §10 スコープ管理: NEXT_CC_PROMPT 指示外の修正を一切行っていないことの自己申告

---

## 7. 完了報告

CC は実装 + テスト + ビルド完了後、構築士に「**rc15 実装完了**」と返す。
構築士は CC_REPORT を採点 → 前原さんに翻訳説明 → 前原さん rc15 試験（実機確認）→ OK なら **v2.0.4 final 本配布**（main マージ + GitHub Release タグ + .exe 公開）へ。

**v2.0.4 final 配布の最終実装フェーズ**。rc15 実装 → 試験 OK で本配布、の流れで進む。
