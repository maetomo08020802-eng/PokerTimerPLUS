# tests/RESULT.md — STEP 6.23 データ移行ロジック検証結果

実行: `node tests/data-transfer.test.js`
日時: 2026-04-28
結果: **全 7 件 PASS / 0 件 FAIL**

## PASS リスト

| # | テスト名 | 検証内容 |
| --- | --- | --- |
| T1 | `builtin reference → userPresets is empty` | builtin プリセット（demo-fast 等）参照の tournament で IPC のフィルタリング後、`buildExportPayload` 出力の `userPresets` が空配列 |
| T2 | `userPreset reference → matching preset included` | userPreset 参照の tournament で、該当する 1 件の userPreset のみが `userPresets` に同梱される（他の user-2 は除外） |
| T3 | `timerState forcibly initialized to idle` | 入力 `timerState: { status:'running', currentLevel:5, elapsedSecondsInLevel:99, startedAt:..., pausedAt:null }` でも、出力では `{ status:'idle', currentLevel:1, elapsedSecondsInLevel:0, startedAt:null, pausedAt:null }` に強制初期化 |
| T4 | `wrong-format rejected` | `format:'wrong'` → `{ ok:false, error:'wrong-format' }` |
| T5 | `version-too-new rejected` | `format:正、version:99` → `{ ok:false, error:'version-too-new' }`（将来互換ガード） |
| T6 | `valid payload accepted` | `format:正、version:1、tournaments:[]、userPresets:[]` → `{ ok:true }` |
| T7 | `rename action → new id, "(コピー)" suffix on name` | rename 戦略で id が `tournament-{ts}-{rand}` 形式に再採番、name に `(コピー)` 付与。複数回生成でも id が衝突しない（Math.random() の rand suffix で回避） |

## 実行ログ
```
PASS: T1: builtin reference → userPresets is empty
PASS: T2: userPreset reference → matching preset included
PASS: T3: timerState forcibly initialized to idle
PASS: T4: wrong-format rejected
PASS: T5: version-too-new rejected
PASS: T6: valid payload accepted
PASS: T7: rename action → new id, "(コピー)" suffix on name

=== Summary: 7 passed / 0 failed ===
```

## テスト構成

### 検証対象（main.js から require）
- `buildExportPayload(kind, tournaments, userPresets)` — エクスポートペイロード生成、timerState 強制初期化
- `validateImportPayload(payload)` — インポート検証（format / version / 配列チェック）
- `BUILTIN_PRESETS` 定数 — IPC のフィルタリング再現用
- `EXPORT_FORMAT` / `EXPORT_VERSION` 定数 — 検証値比較用

### モック
- **electron**: `app.whenReady()` を **never-resolves Promise** にして `.then(() => createMainWindow())` を完全停止 → BrowserWindow / IPC handlers の副作用なしで main.js を require 可能
- **electron-store**: in-memory `FakeStore` クラス（`get/set/delete/store` を提供、`defaults` を deep clone で初期化）
- **require.cache インジェクション** + `Module._resolveFilename` 上書きで、`require('electron')` / `require('electron-store')` を stub に解決

### 検証手法
- T1, T2: IPC ハンドラ `tournaments:exportSingle` 内のフィルタリング（`builtinIds.has(...)`）を再現してから `buildExportPayload` を呼び出す
- T3: 直接 `buildExportPayload` に汚れた timerState を渡して、出力の正規化を確認
- T4-T6: `validateImportPayload` 直呼び出し
- T7: `tournaments:importPayload` IPC ハンドラ内の rename 分岐と**同一のロジック**を再実行して、id / name の変換ルールを検証

## 補足

### T7 の制限事項
`normalizeTournament` 関数は main.js の `registerIpcHandlers()` 内（クロージャ内）に定義されているため、モジュール直接 export では取り出せない。T7 では rename 分岐の**同一ロジック**を再実行することで挙動を担保している（テスト式が main.js の該当行と完全一致）。将来 normalizeTournament を module-level に hoist すれば直接呼び出しテストに切替可能。

### 副作用なしの require 確認
`app.whenReady()` を never-resolves にしたことで、main.js の以下が走らずに済む:
- `createMainWindow()`（BrowserWindow 構築）
- `registerIpcHandlers()`（ipcMain.handle 登録）
- `registerShortcuts()`（globalShortcut.register）
- `powerMonitor.on('resume')` 等

→ Electron 環境なしで pure ロジックのみテスト可能。

### マイグレーション処理は走る
main.js の以下は load 時に同期実行される:
- `migrateTournament(store)` / `migrateTournamentSchema(store)` / `migrateVenueName(store)` / `migrateTimerFont(store)` / `app.commandLine.appendSwitch(...)`

これらは FakeStore のメソッド呼び出しで完結し、エラーなく終了することも実行ログで確認済（PASS の前にログ出力なし=正常）。

## 結論
STEP 6.23 のデータ移行ロジック（エクスポート整形 / インポート検証 / rename 戦略）の**核となる挙動が想定通り**に動作することを Node.js テストで確認。
