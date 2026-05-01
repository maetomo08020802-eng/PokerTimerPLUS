# CC_REPORT — 2026-05-01 v2.0.1 Stabilization（CC 自走フェーズ完了）

## 1. サマリー

v2.0.1 配布前バグ取り（7 時間自走フェーズ）を完了。並列 3 体 sub-agent による網羅調査で致命 2 件・高 1 件・中 5 件のバグを発見し、全 Fix + テスト拡充を実施。194 本 → 221 本（全 PASS）。

## 2. 修正ファイル

| ファイル | 変更点 |
| --- | --- |
| `src/renderer/dual-sync.js` | Fix A1: `registerDualDiffHandler` 追加 |
| `src/renderer/renderer.js` | Fix A1 hall ハンドラ / A2 persist 系 hall ガード / B1 runtime 5 ハンドラ / B3 switching ガード / B5 list 系 6 ハンドラ / B6 marquee・preset 5 ハンドラ |
| `src/main.js` | Fix B2 delete・importPayload broadcast / B4 logoUrl publish |
| `tests/v2-window-race.test.js` | 新規 4 件（window race 防止） |
| `tests/v2-stabilization.test.js` | 新規 27 件（A2/B1〜B6 全修正） |
| `tests/v2-integration.test.js` | T4 regex 緩和（複数 import 対応） |
| `tests/v2-dual-sync.test.js` | `registerDualDiffHandler` export テスト追加 |
| `package.json` | test スクリプトに 2 テスト追加 |
| `docs/v2-stabilization-audit.md` | 新規: 網羅調査結果全文 |

## 3. 主要変更点

### Fix A1（致命）: hall 差分購読が消費されない

`dual-sync.js` にコールバック登録 API `registerDualDiffHandler` を追加し、`renderer.js` hall 分岐で kind 別ディスパッチを登録（`marqueeSettings→applyMarquee` 等 8 種）。2 画面モードで operator 側設定変更が hall にリアルタイム反映されなかった根本原因を修正。

### Fix A2（致命）: hall が main store に逆書込

`schedulePersistTimerState` / `schedulePersistRuntime` / `startPeriodicTimerStatePersist` 冒頭に `if (window.appRole === 'hall') return;` を追加。

### Fix B1（高）: ランタイム操作 5 ハンドラ

`cancelNewEntry` / `revivePlayer` / `adjustReentry` / `adjustAddOn` / `adjustSpecialStack` に hall ガード追加。

### Fix B2（中）: delete / importPayload 後の broadcast 漏れ

`tournaments:delete` 後と `tournaments:importPayload` 後に新 active の 5 種の状態を hall に broadcast。

### Fix B3（中）: runtime 切替中 race

`schedulePersistRuntime` の setTimeout callback 冒頭に `if (_tournamentSwitching) return;` 追加。

### Fix B4（中）: logoUrl broadcast 漏れ

`logo:selectFile` / `logo:setMode` 末尾に `_publishDualState('logoUrl', logoState)` 追加。

### Fix B5・B6（中）: list / marquee / preset ハンドラ hall ガード漏れ

計 11 ハンドラに `if (window.appRole === 'hall') return;` を追加。

## 4. 致命バグ保護 5 件への影響評価

全 Fix を通じて**影響なし**。`schedulePersistRuntime` は hall ガードを先頭に追加のみで、operator 側の `setRuntime` 呼出・8 箇所の呼出数（C.1.8 不変条件）を完全維持。

## 5. テスト結果

| 対象 | 件数 | 結果 |
| --- | --- | --- |
| 既存 138 件（v1.x〜v2.0.0）| 138 | 全 PASS |
| v2 専用 7 ファイル | 52 | 全 PASS |
| v2-window-race（新規）| 4 | 全 PASS |
| v2-stabilization（新規）| 27 | 全 PASS |
| **合計** | **221** | **0 失敗** |

## 6. 並列 sub-agent 数

Phase 1（調査）: 3 体並列（公式 Agent Teams 推奨 ≤ 3 体準拠）

## 7. 構築士への質問

1. **#P1**: `dual:operator-action` ハンドラが validate して `{ok:true}` を返すだけのデッドコード → 削除または本実装、どちらが望ましいか
2. **#P2〜P4**: 提案項目（preset フィルタ不整合 / sanitize else 分岐 / will-quit 二重登録）→ 次フェーズで対応するか、現状維持か

## 8. オーナー向け確認

1. **2 画面動作**: operator 側でテロップ・ロゴ・背景を変更 → hall 側にリアルタイム反映されるか確認をお願いします（Fix A1 の核心）
2. **HDMI 抜き差し**: 抜いて繋ぎ直し → タイマーが継続して正常動作するか確認をお願いします
3. **トーナメント削除**: 複数作成して 1 つ削除 → hall 側の表示が新 active に切り替わるか確認をお願いします
4. **ロゴ切替**: 設定でロゴ変更 → hall 側にリアルタイム反映されるか確認をお願いします
5. **単画面モード**: HDMI なしで起動 → v1.3.0 と同じ挙動か確認をお願いします
