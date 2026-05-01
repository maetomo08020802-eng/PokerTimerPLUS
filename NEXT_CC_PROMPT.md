# v2.0.4-rc2: ホール側ウィンドウ自動全画面化バグ修正 + 再ビルド

## 背景

v2.0.4-rc1 試験版を前原さんが実機検証 → 2 画面の基本動作は OK（HDMI 抜き差し含む 4 項目クリア）。
ただし以下の問題発覚:

| 症状 | 詳細 |
|---|---|
| 自動全画面化されない | ホール側ウィンドウが「普通のウィンドウサイズ」で開く |
| レイアウトはみ出し | カード・帯を含むレイアウト全体がモニター画面からはみ出る（ドアップ状態） |
| F11 無反応 | F11 を押しても fullscreen 化されない |
| 結果 | ホール側で設定タブも開けない状態（ただし設定タブはホール側に表示されるべきではないので別問題） |

**前原さん回答（2026-05-01）**: ドアップは B（レイアウト全体はみ出し）/ 全画面化操作は F11 押下したが無反応

## 目的

ホール側ウィンドウを起動時に自動全画面化し、レイアウトが正常表示される状態にして、試験版 v2.0.4-rc2 を再ビルドする。

## スコープ厳守

修正範囲は以下 3 点に限定:

1. **ホール側 BrowserWindow の起動時 `fullscreen: true` 化**（または起動後 `setFullScreen(true)` 呼出）
2. **F11 ショートカットでホール側 fullscreen toggle 対応**（保険として）
3. **レイアウトはみ出しの追加修正**（仮説: 上記 1 で解消する。解消しない場合は STEP B-4 で停止し構築士判断）

### 禁止事項

- 致命バグ保護 5 件への変更（cross-check 必須）
- 操作画面（PC 側ウィンドウ）の動作変更
- v1.3.0 互換モード（`operator-solo` 役割）の挙動変更
- ホール側 UI 構成の追加変更（設定タブ非表示化等は別フェーズで対応、今回は触らない）
- スコープ外の追加実装

---

## 手順

### STEP A: 現状調査（コード変更なし）

- `src/main.js` の `createHallWindow` 関連コードを Read
- 現在の BrowserWindow 起動オプション確認（特に `fullscreen` / `width` / `height` / `kiosk` など）
- F11 ショートカット登録状況確認（`globalShortcut.register` または BrowserWindow の menu 設定）
- ホール側 CSS scope（`[data-role="hall"]` のセレクタ）確認

### STEP B: 修正実装

1. **ホール側 BrowserWindow に fullscreen 化追加**:
   - `fullscreen: true` を BrowserWindow オプションに追加、または `win.setFullScreen(true)` を `ready-to-show` イベントで呼出
   - PC 側ウィンドウは現状維持（fullscreen 化しない）
   - `operator-solo` モード（HDMI なし PC、role が `operator-solo`）は現状維持

2. **F11 ショートカット対応**（ホール側のみ）:
   - ホール側ウィンドウのメニューに F11 = fullscreen toggle を割り当てる
   - または globalShortcut でホール側 BrowserWindow に対し F11 で `setFullScreen(!isFullScreen())` toggle
   - PC 側で F11 押しても何もしない（既存挙動維持）

3. **レイアウトはみ出し検証**:
   - 上記 1 が効けば自動的に画面いっぱいに収まる仮説で進める
   - CSS は vw/vh 基準なので、ウィンドウが画面いっぱいに広がれば正常表示になるはず

4. **追加修正の判断**:
   - 上記 1+2 で解消する可能性が高いと CC が判断 → そのまま STEP C へ
   - 解消しない可能性が高い・追加 CSS 修正が必要 → CC_REPORT.md に「追加修正案」として記載 + STEP C 以降は実施せず停止して構築士判断を仰ぐ

### STEP C: テスト全 PASS 確認

- `npm test` 実行
- 既存 238 件全 PASS 維持
- ホール側 fullscreen オプション設定の静的検証テストを追加（例: `tests/v204-hall-fullscreen.test.js` 新規 1〜3 件、main.js から `fullscreen: true` 設定をパースできるか等の最小検証）
- 1 件でも FAIL → STEP D に進まず CC_REPORT に詳細記載

### STEP D: バージョン rc1 → rc2 にバンプ

- `package.json` の `version`: `2.0.4-rc1` → `2.0.4-rc2`
- `tests/v130-features.test.js` の T11 version 比較も `2.0.4-rc2` に同期更新（前回 rc1 で追認済の範囲を継続適用、追加スコープ承認は不要）

### STEP E: ビルド実行

- `npm run build:win`
- 生成された `.exe` の絶対パス、サイズ、ファイル名を記録

### STEP F: 静的検証

- `dist/latest.yml` に `version: 2.0.4-rc2` 記載確認
- `dist/win-unpacked/PokerTimerPLUS+ (Test).exe` 生成確認

### STEP G: CC_REPORT.md を完成版で上書き

- 修正対象ファイルと変更箇所一覧
- 修正コード抜粋（fullscreen 化部分、F11 ハンドラ部分）
- テスト結果（238 + 新規 N 件）
- ビルド成果物の絶対パス / サイズ / version
- 致命バグ保護 5 件への影響評価
- v1.3.0 互換モード (operator-solo) への影響評価
- 並列 sub-agent 数報告

---

## 報告必須項目（CC_REPORT.md）

- 並列 sub-agent 数（0 体予定）
- 致命バグ保護 5 件への影響評価
- 修正対象ファイルと変更箇所
- 修正コード抜粋
- ビルド成果物の path / size / version
- v1.3.0 互換モード (operator-solo) への影響評価
- レイアウトはみ出し真因の特定結果（仮説 fullscreen 化で解消の妥当性）

## ブランチ

- 現在ブランチ: `feature/v2.0.4-rc1-test-build` 継続使用（rc1→rc2 連続なので新ブランチ不要）
- main マージなし、リモート push なし
- ローカルコミット可（rc1 と rc2 の差分を git log で追えるように）

## 並列 sub-agent

- 0 体（並列不要、修正範囲が小さい）

---

## 完了後の流れ（CC は関与しない）

1. 構築士: CC_REPORT 採点 → 前原さんに rc2 の `.exe` 場所と再試験依頼
2. 前原さん: rc1 をアンインストール（または rc1 と並列共存させたまま rc2 を別フォルダにインストール）→ 再試験
3. 全画面化 + レイアウト OK → 次の問題へ進む or 配布判断
4. NG → 追加修正
