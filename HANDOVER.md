# HANDOVER.md — PokerTimerPLUS+ 作業引継ぎ書（〜v1.3.0 完了時点）

> 本書は、新しい CC（Claude Code）エージェントが現在の状況を即座に把握できるよう、これまでの作業履歴・確定事項・次のステップを集約したものです。
> 関連ファイル: `CLAUDE.md`（運用ルール）、`docs/specs.md`（機能仕様）、`skills/timer-logic.md`（不変条件）、`CHANGELOG.md`（リリース履歴）、`CC_REPORT.md`（直近完了タスクの報告）。

---

## 1. プロジェクト概要

- **製品名**: PokerTimerPLUS+
- **形態**: Electron 製 Windows/macOS デスクトップアプリ、完全ローカル動作
- **配布**: Yu Shitamachi（PLUS2 運営）制作の無料配布アプリ、全国のポーカールーム向け
- **配布方針**: GitHub Releases + electron-updater による自動更新（v1.3.0〜）
- **CSP**: `'self'` のみ（CDN 不使用、フォント・画像はすべて同梱）
- **ライセンス**: アプリは UNLICENSED（社内配布）、フォント類は SIL OFL 1.1、効果音は効果音ラボ商用無料
- **現在 version**: **1.3.0**（package.json）
- **総テスト数**: **75 件**（10 ファイル）すべて静的解析ベース、`npm test` で 1 コマンド実行

---

## 2. 現在の機能セット（v1.3.0）

### コア機能
- ブラインドタイマー（カウントダウン + レベル進行 + ブレイク）
- 14 ゲーム種（NLH / PLO / PLO5 / PLO8 / Big O Blind / Big O Limit / Omaha Hi-Lo / Limit Hold'em / Short Deck / Stud / Razz / Stud Hi-Lo / **MIX (10-Game)** / **その他（自由記入）**）
- 5 構造型（**BLIND / LIMIT_BLIND / SHORT_DECK / STUD / MIX**）
- 同梱プリセット 8 種（demo-fast / preset-turbo / preset-regular / preset-deep / limit-regular / shortdeck-regular / stud-regular / **mix-regular**）
- 通知音 5 種類 + 音量・個別 ON/OFF
- スタートカウントダウン
- プレイヤー / 賞金管理（バイイン / リエントリー / アドオン / 特別スタック）
- 設定永続化（electron-store）
- PC 間データ移行（JSON Export/Import）
- 複数トーナメントの並行進行
- ロゴ差替（同梱 PLUS2 / カスタム / プレースホルダー）
- 背景プリセット 8 種 + 数字フォント切替

### v1.2.0 で追加
- **MIX レベルごと自由編集**（複製して編集で各レベルのゲーム種を 10 種から自由選択）
- **MIX ゲーム数自動カウント**（ユニーク subGameType を `MIX (○-Game)` に動的反映）
- **「ブレイク終了後に一時停止」**（pauseAfterBreak）
- **PAUSED 3 択モーダル**（リセット / 経過保持 / 構造のみ適用）
- **テンプレート紐づけ表示**（`「○○」で使用中` をドロップダウン suffix）
- **powerSaveBlocker**（タイマー進行中ディスプレイスリープ防止）
- **JSON import の UTF-8 BOM 対応**
- **テロップ 200 文字上限**（HTML maxlength + JS sanitize）
- **アイコン**: 黒背景 + 白「20:40」7-segment LCD 風（`build/icon-source.svg`、フォント不使用）
- **数字フォント**: Oswald → **Barlow Condensed 700**
- **用語変更**（ブラインド構造文脈のみ）: 「プリセット」→「テンプレート」/「プリセット名」→「ブラインド構造名」
- **数字縮小**: data-max-digits でカード単位統一（`space-between`、4 桁以下は `space-around`）

### v1.3.0 で追加
- **自動更新**（electron-updater + GitHub Releases、**publish の owner/repo は暫定値、要確認**）
- **DONE 状態 'finished'**: 全レベル完走時に明示保持、緑系「トーナメント終了」オーバーレイ
- **Ctrl+Q 状態別メッセージ**: タイマー進行中なら警告
- **About 画面に DevTools 注記**（F12 / Ctrl+Shift+I は開発者向け）
- **ID 衝突防止**（`generateUniqueId(prefix)` ヘルパ、tournament/preset の ID 生成 5 箇所で使用）
- **トーナメント切替中の periodic skip**（`_tournamentSwitching` フラグ）
- **preset 削除前に参照中トーナメント警告**（孤児化防止）
- **「複製して編集」readonly 残存バグ**: `ensureEditorEditableState` の builtin 保護内蔵化 + 多点防御

---

## 3. フェーズ履歴（直近の流れ、上が新しい）

| フェーズ | 主成果 | 件数 | 結果 |
| --- | --- | --- | --- |
| **C.1.2**（v1.3.0 仕上げ）| Ctrl+Q 状態別 / DONE 'finished' / electron-updater / DevTools 注記 / version bump | 5 | 全実装、12 新規テスト |
| C.1.2-bugfix | 新規トーナメント→ひな形コピー編集の readonly 残存（追加防御）| - | ensureEditorEditableState の builtin 保護内蔵化 |
| C.1.1 | audit 残課題 8 件中 3 件実装（switching ガード / preset 削除警告 / ID 衝突防止）| 8 | 3 実装、5 防御済み判定 |
| C.1-B | v1.2.0 仕上げ（docs / skills / CLAUDE.md / CHANGELOG）| - | コード変更なし、ドキュメント全更新 |
| C.1-A3 + patch | アプリアイコン変更（黒背景 + 白「20:40」）| - | 7-segment LCD 手動構築、フォント不使用 |
| C.1-A2 | 「複製して編集」readonly 残存修正 | - | 4 重防御パターン確立 |
| C.1-A | 軽 TODO 4 件中 2 件実装（preset name sanitize + DocumentFragment）| 4 | 2 実装、2 不要判定 |
| C.2.7-D | 4 桁時 space-around / **timerState 上書き race 修正** | 5 | 2 実装、3 防御済み判定 |
| C.2.7-C | 6 件 race 候補の再現確認 | 6 | 全件再現せず、コード変更ゼロ |
| C.2.7-B | PAUSED 3 択モーダル（apply-only ボタン追加）| 4 | 全実装 |
| C.2.7-audit-fix | UI 全般監査 117 件 + ブレイクラベル削除 + powerSaveBlocker 等 | 5 | 全実装、9 新規テスト |
| C.2.7-A patch3〜10 | 数字縮小完成 / Barlow Condensed フォント / カード調整 | 8 patch | UI 安定化 |
| **C.2.7-A** | **致命バグ 8-8 修正（resetBlindProgressOnly 責任分離）** | 1 | 営業データ消失防止 |
| C.2.6 | 8 シナリオ網羅調査 | 110 件 | 修正なし、調査のみ |
| C.2.5 | MIX レベルごと自由編集 + ゲーム数自動カウント | - | MIX 編集 UI 完成 |
| C.2.4 | 自由記入欄バグ / 数字縮小マイルド化 / 用語変更 / テンプレ紐づけ | 4 | 全実装 |
| C.2.3 | MIX/その他ゲーム種追加 + 大数字レイアウト + ブレイク後一時停止 | 4 | 全実装 |
| C.2 / C.2.1〜2.2 | 中 9 件 + 軽 2 件、apply-only モード、ブレイクチェック新仕様 | 11 | 全実装 |
| B.fix1〜12 | 入力不能バグ（fix9 で `isUserTypingInInput` 統一ヘルパに集約）| 12 | 統一防御確立 |
| B / B.fix1〜5 | 構造型動的レンダリング、プリセット JSON フィールド名リネーム | - | 構造型基盤 |
| A | データモデル基盤（GAMES/STRUCTURE_TYPES、EXPORT_VERSION=2）| - | データモデル確立 |

---

## 4. 重要な不変条件（破ってはいけない）

### A. tournamentRuntime 保護（C.2.7-A 致命バグ 8-8 修正）
- 「ブラインド構造を変えても tournamentRuntime（プレイヤー人数 / リエントリー / アドオン / バイイン）は**絶対に消えない**」
- 関数の責任分離:
  - `handleReset()`: 明示「タイマーリセット」ボタン経由のみ。`resetTournamentRuntime() + timerReset()`
  - `resetBlindProgressOnly()`: ブラインド構造リセット専用。`timerReset()` のみ、runtime 保護
- 「保存して適用→リセット」「適用」の reset 分岐は **必ず `resetBlindProgressOnly()`** を呼ぶ
- 回帰テスト: `tests/runtime-preservation.test.js`（6 件）

### B. timerState 上書き race の防御（C.2.7-D Fix 3）
- `persistActiveTournamentBlindPresetId` で `getActive` → `save` 間に `setTimerState` の race
- 解決: payload から timerState を destructure 除外
```js
const { timerState, ...rest } = active;
const updated = { ...rest, blindPresetId: newPresetId };
await window.api.tournaments.save(updated);
```

### C. 入力中保護（fix9 確立）
- DOM 再構築時は必ず `isUserTypingInInput()` 統一ヘルパでガード
- ガード対象: text/number/textarea/contentEditable（checkbox/radio/button は除外）
- ガード適用箇所: `renderBlindsTable` / `applyTournament` / `renderTournamentList` / `renderPayoutsEditor` / `populateTournamentBlindPresets` / `syncMarqueeTabFormFromCurrent` 等
- 違反すると入力中の文字消失バグ（重大）

### D. 編集モード readonly 解除（C.1-A2 + C.1.2-bugfix）
- 「複製して編集」「新規作成」ハンドラで `ensureEditorEditableState()` を**同期 + RAF 内**で 2 回呼出（C.1-A2 4 重防御）
- C.1.2-bugfix で **builtin 保護を内蔵化**: `meta.builtin === true` 時は no-op → 呼出側は meta 状態を気にせず多用可能
- 追加呼出: `_handleTournamentNewImpl` 末尾、`ensureBlindsEditorLoaded` の else 分岐

### E. powerSaveBlocker（C.2.7-audit-fix）
- RUNNING / PRE_START / BREAK 中はディスプレイスリープを抑止（営業中事故防止）
- PAUSED / IDLE / FINISHED で解除（電気代節約）
- IPC: `power:preventDisplaySleep` / `power:allowDisplaySleep`

### F. PAUSED 3 択モーダル（C.2.7-B）
- PAUSED 中の「適用」「保存して適用」で表示:
  - **タイマーをリセットして適用**: 構造保存 + `resetBlindProgressOnly()`
  - **経過時間を保持して適用**: 構造保存 + `applyBlindsKeepProgress()` で pausedRemainingMs 整合性チェック
  - **構造のみ適用（一時停止維持）**: 構造保存のみ、status / pausedRemainingMs / currentLevelIndex すべて維持
- showApplyOnly: status === States.PAUSED でのみ第 3 ボタン表示

### G. レイアウトシフト 5 原則（既存）
- 詳細は `skills/ui-layout.md`、`__autoCheck()` で drift 0 維持
- transform: scale 禁止、bottom-bar / marquee は flex column、カード幅 42vw / 32vw 固定

---

## 5. ファイル構成

### コード
```
src/
├── main.js              # Electron main process
├── preload.js           # contextBridge で window.api 公開
├── presets/             # 同梱プリセット 8 種 (.json)
├── audio/               # 通知音 5 種 (.mp3) + CREDITS.md
├── assets/
│   ├── fonts/           # 同梱フォント 7 種 + licenses/
│   └── logo-*.svg       # ロゴ画像
└── renderer/
    ├── index.html
    ├── style.css        # ~3000 行
    ├── renderer.js      # ~5200 行（最大ファイル）
    ├── timer.js         # タイマーコア（performance.now ベース）
    ├── state.js         # 状態管理（subscribe / setState）
    ├── blinds.js        # validateStructure / cloneStructure
    ├── audio.js         # 通知音再生
    └── marquee.js       # テロップアニメーション
```

### ビルド・配布
```
build/
├── generate-icon.js     # SVG → PNG/ICO 生成（npm run build:icon）
├── icon-source.svg      # 黒背景 + 白「20:40」7-segment
├── icon.png             # 512x512
└── icon.ico             # マルチサイズ（16/24/32/48/64/128/256）
package.json             # build セクションで electron-builder 設定
                         # build.publish に GitHub provider（owner/repo は暫定値、要確認）
```

### テスト（10 ファイル、合計 75 件）
| ファイル | 件数 | 用途 |
| --- | --- | --- |
| `tests/data-transfer.test.js` | 7 | PC 間データ移行（buildExportPayload / validateImportPayload）|
| `tests/runtime-preservation.test.js` | 6 | **致命バグ 8-8 リグレッション防止**（C.2.7-A）|
| `tests/audit-fix.test.js` | 9 | UI 監査修正（ブレイクラベル / powerSaveBlocker / BOM / marquee 上限 / 削除二重防止）|
| `tests/paused-flow.test.js` | 9 | PAUSED 3 択モーダル（C.2.7-B）|
| `tests/race-fixes.test.js` | 5 | 4 桁時 space-around + timerState race 修正（C.2.7-D）|
| `tests/light-todos.test.js` | 4 | preset name sanitize + DocumentFragment（C.1-A）|
| `tests/editable-state.test.js` | 7 | ensureEditorEditableState（C.1-A2）|
| `tests/audit-residuals.test.js` | 8 | switching ガード / preset 削除警告 / ID 衝突防止（C.1.1）|
| `tests/new-tournament-edit.test.js` | 8 | 新規 readonly 残存対策（C.1.2-bugfix、builtin 保護内蔵化）|
| `tests/v130-features.test.js` | 12 | Ctrl+Q / 'finished' / electron-updater / DevTools 注記 / version（C.1.2）|

実行: `npm test`（順次実行、すべて静的解析ベース、Electron 起動なし）

### ドキュメント
- `CLAUDE.md`: CC 構築士向け運用ルール（標準制約 / 入力中保護 / readonly 解除 / runtime 不変条件）
- `docs/specs.md`: 機能仕様書、末尾に「STEP 10 機能追加（v1.2.0）」セクション
- `skills/timer-logic.md`: タイマー実装品質基準 + 6 つの不変条件（A〜F）明文化
- `skills/ui-tokens.md` / `ui-layout.md` / `ui-components.md` / `ui-states.md`: UI デザインシステム（`ui-design.md` は廃止）
- `skills/branding.md`: ブランディング保護（§15.5 静的表記等）
- `skills/audio-system.md`: 音響仕様
- `CHANGELOG.md`: Keep a Changelog 形式、v1.3.0 / v1.2.0 / v1.1.0 / v1.0.0
- `CREDITS.md`: フォント・音声ライセンス + App Icon オリジナル制作明記
- `CC_REPORT.md`: 直近完了タスクの報告（毎フェーズ上書き）
- `NEXT_CC_PROMPT.md`: 次フェーズの指示書（構築士が用意、CC が読んで実装）
- `PIPELINE.md`: 開発パイプライン（参照用）

---

## 6. CC 開発フロー（運用ルール、CLAUDE.md より）

### 役割
- **オーナー**: Yu Shitamachi、PLUS2 運営、PCM 想定
- **CC 構築士**: NEXT_CC_PROMPT.md を書き、CC_REPORT.md を読んで判断
- **CC（このエージェント）**: NEXT_CC_PROMPT.md を読んで実装、CC_REPORT.md を書く

### 標準サイクル
```
構築士 → NEXT_CC_PROMPT.md 作成
       ↓
CC → 読む → 実装 → テスト → CC_REPORT.md 作成
       ↓
構築士 → 採点 + 次フェーズ判断 → 次の NEXT_CC_PROMPT.md
```

### 標準制約（毎回適用、明記不要）
- skills/ui-design.md は廃止、参照禁止
- レイアウトシフト撲滅 5 原則維持
- 既存実装を破壊しない
- transform: scale 禁止
- branding.md §15 ブランディング保護

### スコープ管理（最重要、2026-04-30 確定）
- **NEXT_CC_PROMPT.md に明示された Fix 項目以外は実装しない**
- 調査中に発見した別問題は **CC_REPORT.md「構築士への質問」に提案として記載のみ**
- 「ユーザー要望に最善を尽くして対処」と読んでも勝手に実装範囲を広げない
- 致命級バグ発見時は CC_REPORT 冒頭に明示し構築士判断を仰ぐ（自動修正禁止）
- スコープ越えは指示忠実性 30 点項目で減点

### 再現性確認の必須化（C.2.7-C 以降の教訓）
- audit 項目の中には実コードで再現できないものがある（C.2.7-C で 6 件中 6 件再現せず判定）
- 各 Fix について実装前に「実コードで本当に再現するか」を確認
- 再現する → 実装、新規テスト追加
- 再現しない / 防御済み → 実装せず CC_REPORT で「再現できなかった理由」を明記

### 報告フォーマット（CC_REPORT.md 簡潔版）
```
# CC_REPORT — YYYY-MM-DD タイトル

## 1. サマリー
（1〜2 行で何をしたか）

## 2. 修正ファイル
| ファイル | 変更点（短く） |

## 3. 主要変更点（コード抜粋 5 行以内/件）

## 4. 構築士への質問（あれば、なければ省略）

## 5. オーナー向け確認（3〜5 項目、平易な日本語）
```

---

## 7. 既知の TODO / 構築士判断待ち事項

### 7-1. ⚠️ 最重要: GitHub repo 名の確定（v1.3.0 のリリース前必須）
`package.json` の `build.publish` を**暫定値**で記載:
```json
"publish": {
  "provider": "github",
  "owner": "yu-shitamachi",
  "repo": "PokerTimerPLUS"
}
```
実際の GitHub repo 名と一致するか確認・修正必要。修正しないと `autoUpdater.checkForUpdatesAndNotify()` が 404 で警告のみ（クラッシュなし）。

### 7-2. リリース運用フロー
electron-updater が機能するためには:
1. `npm run build:win` で dist/ に installer + latest.yml 生成
2. GitHub Releases に draft release 作成
3. `*.exe` (or `*.dmg`) と `latest.yml` (or `latest-mac.yml`) をアップロード
4. release を publish
5. ユーザーの次回起動時に自動チェック → 通知

`electron-builder publish` コマンド（GH_TOKEN 環境変数）で 1〜4 自動化可能。

### 7-3. 残 audit 項目（C.1.1 で実装せず）
C.2.6 audit の高優先度 8 件のうち 5 件は再現せず or 防御済み判定で実装せず:
- Fix 1（DONE 状態保存）→ **C.1.2 で実装済み**
- Fix 3 / 4（Space ダイアログ中 / IME Space）→ keydown handler の早期 return で防御済み
- Fix 5（Ctrl+Q 終了確認）→ **C.1.2 で状態別メッセージとして実装済み**
- Fix 8（avgStack 負値）→ `playersRemaining <= 0` 早期 return で防御済み

### 7-4. 中・低優先度の audit 残課題
C.2.6 audit で報告された ~110 件のうち高優先度 39 件は対応済み。中・低優先度 70+ 件は構築士判断後に部分対応推奨。詳細は audit 当時の CC_REPORT 履歴参照。

### 7-5. 次フェーズの設計判断候補（CC_REPORT で提案済み、未実装）
- **「破棄」ボタン**: 編集中の draft を捨てる専用ボタン（C.1-A で「新機能要望」と判定）
- **データ移行統一**: tournament name の HTML/JS limit 不一致解消（HTML 40 / JS 60）
- **autoDownload オプション**: `autoUpdater.autoDownload = false` 化検討（通信量を気にするユーザー向け）
- **DONE 状態の UX**: 「次のトーナメント開始」「リセットして再エントリー」誘導ボタン追加検討
- **state machine for compound PAUSED operations**: C.2.7-B Fix 3 で state diagram 文書化済、追加対応は構築士判断
- **コード署名**: Windows publisher 証明書取得（SmartScreen 警告抑止）

---

## 8. 重要な実装パターン（CC 必読）

### 8-1. ID 生成（C.1.1 確立）
```js
function generateUniqueId(prefix) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${prefix}-${ts}-${rand}`;
}
// 使用: generateUniqueId('tournament') / generateUniqueId('user')
```
旧 `${prefix}-${Date.now()}` パターンは **完全廃止**（衝突回避のため）。

### 8-2. ensureEditorEditableState（C.1-A2 + C.1.2-bugfix）
```js
function ensureEditorEditableState() {
  // builtin プリセット選択中はガード（誤って編集可能化しない）
  if (blindsEditor.meta && blindsEditor.meta.builtin === true) return;
  if (el.presetName) {
    el.presetName.readOnly = false;
    el.presetName.disabled = false;
    el.presetName.classList.remove('is-readonly');
  }
  setBlindsTableReadonly(false);
  const editorRoot = document.querySelector('.blinds-editor');
  if (editorRoot) editorRoot.dataset.builtin = 'false';
}
```
**呼出パターン**: 同期で 1 回 + RAF 内で 1 回（合計 2 回、4 重防御の一部）。
呼出箇所: handlePresetDuplicate / handlePresetNew / `_handleTournamentNewImpl` 末尾 / `ensureBlindsEditorLoaded` の else 分岐。

### 8-3. _tournamentSwitching ガード（C.1.1）
```js
let _tournamentSwitching = false;

async function periodicPersistAllRunning() {
  if (!window.api?.tournaments?.setTimerState) return;
  if (_tournamentSwitching) return;   // skip during transition
  ...
}

async function handleTournamentNew() {
  ...
  _tournamentSwitching = true;
  try { return await _handleTournamentNewImpl(); }
  finally {
    handleTournamentNew._inFlight = false;
    _tournamentSwitching = false;
  }
}
```
複製ハンドラも同パターン。`finally` で確実に false に戻す。

### 8-4. handlePresetApply の reset 分岐（致命バグ 8-8 修正、絶対変更禁止）
```js
} else {
  // 既定: リセット適用
  setStructure(cloneStructure(blindsEditor.draft));
  resetBlindProgressOnly();   // ★ handleReset() 禁止、runtime 保護
  setBlindsHint(...);
}
```

`tests/runtime-preservation.test.js` T4/T5 で静的解析担保。

### 8-5. 既存テストパターン
全テストは静的解析ベース（ソース文字列を grep）。Electron 起動なし。
```js
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}
function extractFunctionBody(source, name) { /* ブレース深度カウント */ }
test('T1: ...', () => { assert.match(...); });
```

新規テスト追加時はこのパターンを踏襲。

---

## 9. 既知の脆弱領域（コード変更時の注意点）

### 9-1. renderBlindsTable とフォーカス
`isUserTypingInInput()` ガードがある。設定ダイアログ内の入力中は早期 return。新規 DOM 操作で副作用がある場合、必ずこのガードを通す。

### 9-2. tournament.save IPC の payload
`normalizeTournament` は `'X' in t` で判定して既存値を維持する設計。
- timerState を payload に含めると上書き → race（C.2.7-D 修正済）
- payload に含めないフィールドは fallback から維持
- `readTournamentForm()` は timerState を含まない（既存設計、変更厳禁）

### 9-3. blindsEditor.meta の状態
- `{ id, name, builtin }` の 3 フィールド
- `builtin: true` → builtin プリセット（編集不可、削除不可、保存不可）
- `builtin: false` → user preset（編集可、削除可、上書き保存可）
- 状態遷移は `loadPresetIntoDraft` / `handlePresetNew` / `handlePresetDuplicate` / `_savePresetCore` のみ

### 9-4. 状態遷移（States enum）
`src/renderer/state.js` で IDLE / PRE_START / RUNNING / PAUSED / BREAK の 5 種。`'finished'` は store 側のみで、renderer の States enum には**ない**（applyTimerStateToTimer で 'finished' → idle に変換 + class 付与）。

---

## 10. 次のステップ候補

構築士判断後、以下のような次フェーズが考えられます:

### A. v1.3.0 リリース準備（最優先候補）
1. GitHub repo 名確定（§7-1）
2. リリース運用フロー整備（§7-2、`electron-builder publish` 等）
3. コード署名（Windows publisher 証明書、SmartScreen 抑止）
4. 配布ビルドの実機検証（インストール → 起動 → 自動更新チェック確認）

### B. 残 audit 項目の段階対応
中・低優先度の項目を構築士優先度判定後にバンドル対応。

### C. 新機能（未承認、構築士提案後判断）
- 「破棄」ボタン
- DONE 状態の UX 強化（次トーナメント開始誘導等）
- 営業時間自動カウントダウン（specs.md 優先度高）
- バウンティトーナメント管理（specs.md 優先度高）

### D. 配布後の前原さん（オーナー）報告対応
v1.2.0 でも前原さんから複数の bugfix 要望が来ている履歴あり。実機で観察された問題は CC_REPORT 経由で構築士に伝達 → 次フェーズで対応。

---

## 11. CC へのアドバイス（次のエージェント向け）

1. **NEXT_CC_PROMPT.md が来たらまず一気に読む**。スコープ制限を厳格に守ること。「ついでに直す」は禁止
2. **再現性確認を必ず行う**。コード読解で「再現しない / 防御済み」と判定したら、実装せず CC_REPORT で根拠記載
3. **既存テストが壊れていないか確認**を習慣化。`npm test` で 75 件全 PASS が維持されること
4. **致命バグ 8-8 リグレッション**: `handlePresetApply` の reset 分岐で `handleReset()` を呼んだら即 NG。`tests/runtime-preservation.test.js` で検出される
5. **入力中保護**: 新規 DOM 操作 / フォーム書込関数を追加するときは必ず `isUserTypingInInput()` でガード
6. **構築士への質問は「実装禁止、提案のみ」**で書く。発見した別問題はここに集約
7. **CC_REPORT.md は構築士採点用、技術詳細 OK、末尾にオーナー向け平易確認 3〜5 項目**
8. CC は「実行する存在」、設計判断は構築士の役割。判断に迷うことは構築士に聞く

---

## 12. 連絡・参照ポイント

- 仕様書: `docs/specs.md`
- 不変条件: `skills/timer-logic.md` の「STEP 10 で確定した不変条件 (v1.2.0)」セクション
- 直近完了タスク: `CC_REPORT.md`（毎フェーズ上書き）
- 次タスク指示: `NEXT_CC_PROMPT.md`（構築士が更新）
- リリース履歴: `CHANGELOG.md`
- ライセンス情報: `CREDITS.md` + `src/audio/CREDITS.md` + `src/assets/fonts/licenses/`
- ブランディング: `skills/branding.md`（保護必須）

---

**作成日**: 2026-04-30  
**作成時 version**: 1.3.0  
**作成時テスト数**: 75 件（10 ファイル、すべて PASS）  
**最終フェーズ**: C.1.2（v1.3.0 仕上げバンドル 5 件、すべて実装完了）
