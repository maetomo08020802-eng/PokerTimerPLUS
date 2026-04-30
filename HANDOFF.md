# 引継ぎメモ — 2026-04-29 時点

新セッション開始時、CC（次回担当）はこのファイル → `CLAUDE.md` → `NEXT_CC_PROMPT.md` → `CC_REPORT.md`（直近完了の報告）の順に読めば現在地が掴めます。

## 直近完了：STEP 10 フェーズC.2.3

**4 件の機能追加 / 修正をすべて実装**:
1. **MIX (10-Game) ゲーム種**追加 — WSOP 公式ローテーション、`mix-regular.json` 同梱、メイン画面で各レベルの subStructureType に応じて表示項目が動的切替
2. **「その他（自由記入）」ゲーム種**追加 — `customGameName` を tournamentState / DB に永続化
3. **大数字レイアウト崩れ**修正 — clamp 縮小 + `data-digits` 属性ベースの 6 桁/7-8 桁での 0.85em / 0.75em 動的縮小
4. **「ブレイク終了後に一時停止」**チェックボックス + タイマーロジック（subscribe で `prevLv.isBreak && !curLv.isBreak && status===RUNNING && pauseAfterBreak===true` 検知 → `timerPause()`）

ゲーム種は **11 → 14 種類**、構造型は **4 → 5 種類**（MIX 追加）、同梱プリセットは **7 → 8 件**（mix-regular 追加）。

## 運用ループ（CLAUDE.md 規約）

```
構築士 → NEXT_CC_PROMPT.md 更新
         ↓
CC（私） → 読んで実装 → CC_REPORT.md 上書き保存
         ↓
オーナー（前原さん） → 動作確認 → フィードバック
         ↓
構築士 → 次の NEXT_CC_PROMPT.md 用意（ループ）
```

ユーザーから「NEXT_CC_PROMPT.md 読んで実行、CC_REPORT.md に書いて」と呼ばれる。

## 重要な技術ルール（fix9 / 再発防止策）

### `isUserTypingInInput()` 統一ヘルパ

`src/renderer/renderer.js` 冒頭に定義。**新たに DOM 操作 / フォーム書込関数を追加する場合、必ずこのヘルパでガード**:

```js
function isUserTypingInInput() {
  // text/number/textarea/contentEditable のみ true
  // checkbox/radio/button/select は除外
}
```

**ガード適用済関数の一覧**（新関数追加時の参考）:
- `renderTournamentList` / `renderBlindsTable`
- `syncTournamentFormFromState` / `loadTournamentIntoForm`
- `populateTournamentBlindPresets` / `syncMarqueeTabFormFromCurrent`
- `renderPayoutsEditor` / `applyTournament`（フォーム書込部のみ）

`.value =` または `innerHTML =` を書く新関数を追加するときは grep で網羅性確認後、ガードを必ず入れる。

### 標準制約（CLAUDE.md より、毎回適用）

- skills/ui-design.md 廃止 → ui-tokens / ui-layout / ui-components / ui-states に分割
- レイアウトシフト撲滅 5 原則
- `transform: scale` 禁止
- 自動測定 `__autoCheck()` で drift 0
- `branding.md §15` 遵守（アプリ名 / クレジット 等変更不可）
- bottom-bar / marquee は flex column（`position: fixed` 禁止）
- カード幅 42vw / 32vw（C.2 fix3 で 54vw / 46vw に変更済）

### ブレイクチェックの新仕様（C.2.2）

- 通常レベルで ON → 直下に新規ブレイク挿入（**数値維持**）
- ブレイク行で OFF → そのブレイク行を削除
- 旧変換ロジック（数値全消去）は廃止

### 「保存」「保存して適用」の正しい挙動（C.2 + C.2.1）

| 状態 | 保存 | 保存して適用 |
| --- | --- | --- |
| idle | 表示更新 + blindPresetId 変更時は自動 setStructure | **ダイアログなし**、`'apply-only'` モードで構造反映のみ（タイマー暴発防止）|
| running / paused | 表示更新 + blindPresetId 変更時は警告ヒント | 3 択ダイアログ（経過保持 / リセット / キャンセル）|

## 現在のスキーマ要点

```js
// tournament 構造（C.2.3 時点）
{
  gameType,         // 14 種類（nlh/plo/plo5/plo8/big-o-blind/big-o-limit/omaha-hilo/limit-holdem/short-deck/stud/razz/stud-hilo/mix/other）
  customGameName,   // gameType==='other' のみ使用、最大 30 文字
  pauseAfterBreak,  // boolean、ブレイク終了後に自動一時停止
  // ... 他フィールドは memory/project_state.md 参照
}

// 構造型（5 種類）
BLIND       : ['sb', 'bb', 'bbAnte']
LIMIT_BLIND : ['sb', 'bb', 'smallBet', 'bigBet']
SHORT_DECK  : ['ante', 'buttonBlind']
STUD        : ['ante', 'bringIn', 'smallBet', 'bigBet']
MIX         : []   // 動的、各レベルの subStructureType を参照
```

EXPORT_VERSION = 2（v1 ペイロードは validateImportPayload で自動互換変換）。

## フェーズC.1 で対応すべき項目（次回タスク候補）

優先度順（中レベル 5 件 + 軽レベル 4 件）:

### 中
1. **MIX 編集 UI** — 同梱 mix-regular は read-only で運用可能だが、複製して編集する場合の subStructureType ごとの可変カラム表示 UI が未実装。各行の subStructureType に応じて表示する fields を動的に変える編集テーブルが必要
2. `package.json` version **1.1.0 → 1.2.0** にバンプ（STEP 10 完了マイルストーン、フェーズC.1 ゴール）
3. `tests/data-transfer.test.js` の v2 専用テスト拡張（v1 互換変換テストケース、structureType 検証、levels 空配列 reject 等）
4. `skills/timer-logic.md` / `docs/specs.md` 更新（MIX / その他 / pauseAfterBreak / 8 同梱プリセット 反映）
5. `isUserTypingInInput()` 運用ルールを `CLAUDE.md` または `skills/` 配下に明文化（再発防止）

### 軽
6. ゲーム種高速切替の **debounce**（200〜300ms）
7. 「変更を破棄」専用ボタン（ブラインド編集中の dirty 状態を保存値に戻すボタン）
8. 名前 maxLength 属性の追加確認（tournamentTitle / presetName / venueName）
9. levels 50+ 件のパフォーマンス（現状 30 件想定で実用上問題なし、将来）

## バージョン

- 配布版: **1.1.0**（STEP 9 で配布リリース、STEP 9.fix2 NSIS 修正含む）
- 開発内部: フェーズC.1 で **1.2.0** にバンプ予定

## 主要ファイル構成

```
poker-clock/
├── CLAUDE.md                          ← プロジェクト司令塔、必読
├── HANDOFF.md                         ← 本ファイル
├── NEXT_CC_PROMPT.md                  ← 構築士からの次タスク
├── CC_REPORT.md                       ← 直近完了の報告
├── BUILD_INSTRUCTIONS.md              ← ビルド手順（前原さん向け）
├── package.json                       ← version 1.1.0
├── src/
│   ├── main.js                        ← Electron メインプロセス
│   ├── preload.js                     ← IPC ブリッジ
│   ├── presets/
│   │   ├── demo-fast.json (BLIND)
│   │   ├── turbo.json (BLIND)
│   │   ├── regular.json (BLIND)
│   │   ├── deep.json (BLIND)
│   │   ├── limit-regular.json (LIMIT_BLIND)
│   │   ├── shortdeck-regular.json (SHORT_DECK)
│   │   ├── stud-regular.json (STUD)
│   │   └── mix-regular.json (MIX)     ← C.2.3 新規
│   ├── assets/
│   │   ├── logo-plus2-default.png
│   │   └── logo-yushitamachi.svg      ← 差替不可（branding 保護）
│   └── renderer/
│       ├── index.html
│       ├── renderer.js                ← isUserTypingInInput() ヘルパあり
│       ├── style.css
│       ├── blinds.js                  ← validateStructure / checkStructureSoftWarnings
│       ├── timer.js / state.js / marquee.js / audio.js
├── build/
│   ├── icon.png / icon.ico            ← STEP 9 で更新（タイマー＋P）
│   ├── icon-source.svg                ← STEP 9 で生成元
│   └── generate-icon.js               ← png-to-ico v3 で .default 経由
├── tests/
│   └── data-transfer.test.js          ← 7/7 PASS
├── docs/specs.md
└── skills/
    ├── branding.md (§15.5 メイン画面左上ロゴ含む)
    ├── timer-logic.md
    ├── ui-tokens.md / ui-layout.md / ui-components.md / ui-states.md
    └── audio-system.md
```

## 検証コマンド（毎回必須）

```bash
cd "C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock"
node --check src/main.js                                                    # exit 0
node --check src/renderer/renderer.js                                       # exit 0 (CommonJS)
cp src/renderer/renderer.js /tmp/r.mjs && node --check /tmp/r.mjs           # exit 0 (ESM)
node --check src/renderer/blinds.js                                         # exit 0
node tests/data-transfer.test.js                                            # 7/7 PASS
```

ESM チェックは fix9 の escapeHtml 重複バグ（`SyntaxError: Identifier 'escapeHtml' has already been declared`）防止のため必須。CommonJS の `node --check` だけでは ES Module の重複宣言を検出できない。

## 過去の地雷集

- HTML 編集時に Launch preview panel hook が走る → ユーザーに「is now visible in the preview panel」を伝える
- `style.css` の overflow 軸別指定（`overflow-x: hidden + overflow-y: visible`）はスクロール格上げの罠 → wrapper 構造で責務分離（STEP 6.16）
- grid item の blowout は親に `min-width: 0` 必須（STEP 6.12）
- レンダリング系の文字列は textContent or `escapeHtml()` 経由で XSS 安全に
- `setBlindsTableReadonly(false)` は break 行の意図的 disabled を維持する（C.2 fix7）
- `<input type="checkbox">` も `tagName === 'INPUT'` だが、`isUserTypingInInput()` ヘルパで除外済み（fix8）

## オーナー（前原さん）動作確認待ち

直近の **C.2.3 動作確認 18 項目**は CC_REPORT.md §9 を参照。実機 `npm start` で:
1. MIX (10-Game) ドロップダウン追加 + 自動フォーマット
2. メイン画面 BLINDS カードのレベル進行で表示項目切替
3. 「その他」自由記入 → カスタム名表示
4. 100,000 など大数字でも重なり/はみ出しなし
5. ブレイク後一時停止 ON → ブレイク終了で自動 PAUSED

問題なければ **フェーズC.1（基本仕上げ）** へ進む。

---

**Good luck for the next session!** 🎲
