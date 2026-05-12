# CC_REPORT — 2026-05-12 v2.1.20-rc10.1 rc10-audit 高優先観測ラベル 3 個追加（致命級 race 配信後監視基盤）

## §1 サマリ

| 項目 | 値 |
|---|---|
| バージョン | `2.1.20-rc10` → **`2.1.20-rc10.1`** |
| フェーズ | rc10-audit 選択肢 B（観測ラベル追加 → 試験 → v2.2.1 配信）|
| 並列 sub-agent 数 | **0 体**（構築士確定方針の機械的反映、Plan Mode 不要）|
| 修正ファイル数 | **67 ファイル**（main.js / renderer.js / package.json / CHANGELOG.md + 既存テスト 62 ファイル regex 調整 + v249 新規）|
| テスト件数 | **1116 PASS / 0 FAIL / 21 SKIP**（rc10 1106 + v249 新規 10 件）|
| ビルド成果物 | `dist/pokertimerplus-setup-2.1.20-rc10.1.exe` 83,020,035 B |
| feature ブランチ | `feature/v2.1.20-rc10.1-audit-race-observation`（rc10 commit `5800622` から分岐）|
| main マージ / tag / Release / push | **すべて未実施**（spec 禁止条項に準拠）|

### rc10.1 の目的（rc10-audit 監査結果反映、致命級 race 配信後監視基盤）

rc10-audit リリース前監査で検出された致命級 race 2 件 + 多層防御論理的死角への対処として、構築士は **選択肢 B（観測ラベル追加 → 標準試験 → v2.2.1 配信）** を確定。本フェーズで高優先観測ラベル 3 個（#1 / #2 / #10）を機械的に追加。コード変更最小、機能不変、計測のみ追加。

#### 高優先観測ラベル 3 個（rc10-audit §4 より）

| # | ラベル | 用途 | 発火条件 |
|---|---|---|---|
| **#1** | `hdmi:display-removed:dual-sync-stale` | PRE_START 消失の早期発見 | display-removed 時、preStartState cache が 500ms 以上古い場合 |
| **#2** | `hdmi:dialog-blocked:switchOperatorToSolo` | 自動更新ダイアログ中 HDMI 抜き検出 | switchOperatorToSolo の所要時間が 50ms 超の場合 |
| **#10** | `timer:reset:race-window-entry` | 多層防御 race 検出 | rc8/rc9/rc10 ガード 5 経路の race window が 1ms 以上の場合 |

---

## §2 各 Fix の実装内容

### Fix 1: main.js `_preStartStateCacheUpdatedAt` 変数 + `_publishDualState` 記録 + display-removed stale ラベル

**追加箇所 3 箇所**:

1. **L1104**（`_dualStateCache` 宣言直後）:
   ```js
   // v2.1.20-rc10.1: preStartState cache の最終更新時刻（rc10-audit #1 race 観測用、ms epoch）
   let _preStartStateCacheUpdatedAt = 0;
   ```

2. **L1118 周辺**（`_publishDualState` 内、preStartState 経路で更新時刻記録）:
   ```js
   if (kind === 'preStartState') {
     _preStartStateCacheUpdatedAt = Date.now();
   }
   ```

3. **L1559 周辺**（`screen.on('display-removed', ...)` ハンドラ内、`_flushLogsToFile` 直前）:
   ```js
   // v2.1.20-rc10.1 観測: preStartState cache が 500ms 以上古い場合に警告ラベル
   if (_dualStateCache.preStartState && _dualStateCache.preStartState.isActive && _preStartStateCacheUpdatedAt > 0) {
     const cacheAgeMs = Date.now() - _preStartStateCacheUpdatedAt;
     if (cacheAgeMs >= 500) {
       try { rollingLog('hdmi:display-removed:dual-sync-stale', { cacheAgeMs, isActive: true }); } catch (_) {}
     }
   }
   ```

### Fix 2: main.js `switchOperatorToSolo` 50ms 超部 `hdmi:dialog-blocked:switchOperatorToSolo` ラベル

**修正箇所**: `async function switchOperatorToSolo()` 冒頭 + finally

- 冒頭で `const _switchStartTimeMs = Date.now();`
- finally 内で `const _switchDurationMs = Date.now() - _switchStartTimeMs;` + `if (_switchDurationMs >= 50) { rollingLog('hdmi:dialog-blocked:switchOperatorToSolo', { durationMs }); }`

### Fix 3: renderer.js applyTimerStateToTimer 4 経路 + initialize 1 経路に race window 計測（計 5 箇所）

各経路の rc8/rc9/rc10 ガード内に `performance.now()` 計測 + 1ms 超部 `timer:reset:race-window-entry` ラベル発火経路を追加:

| # | 経路 | 行 | trigger 値 |
|---|---|---|---|
| 1 | applyTimerStateToTimer invalid-ts | renderer.js:1630-1644 | `'invalid-ts'` |
| 2 | applyTimerStateToTimer idle | renderer.js:1662-1676 | `'idle'` |
| 3 | applyTimerStateToTimer finished | renderer.js:1695-1710 | `'finished'` |
| 4 | applyTimerStateToTimer no-levels | renderer.js:1730-1744 | `'no-levels'` |
| 5 | initialize 復元失敗 fallback | renderer.js:7635-7654 | `'initialize:restoredFromTimerState-false'` |

各経路共通パターン:
```js
const _raceEntryMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
try { window.api?.log?.write?.('operator:applyTimerStateToTimer:skip-reset-during-prestart', {...}); } catch (_) {}
const _raceExitMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
const _raceWindowMs = _raceExitMs - _raceEntryMs;
if (_raceWindowMs >= 1) {
  try { window.api?.log?.write?.('timer:reset:race-window-entry', { trigger: '...', windowMs: _raceWindowMs }); } catch (_) {}
}
```

**重要**: rc8/rc9/rc10 既存ガード本体 / 既存ラベルは**完全保持**、観測ラベルは前後に挟む形で追加のみ。

### Fix 4: PRIORITY_LOG_LABELS Set に新規 3 ラベル追加

```js
const PRIORITY_LOG_LABELS = new Set([
  // ... 既存 10 ラベル（完全保持）...
  // v2.1.20-rc10.1 追加（rc10-audit 高優先 #1 / #2 / #10）
  'hdmi:display-removed:dual-sync-stale',
  'hdmi:dialog-blocked:switchOperatorToSolo',
  'timer:reset:race-window-entry'
]);
```

### Fix 5: package.json bump + scripts.test 追記 + テストリテラル一括置換

- `version`: `2.1.20-rc10` → `2.1.20-rc10.1`
- `scripts.test` 末尾に `&& node tests/v249-audit-race-observation.test.js`
- 既存 60 テストの `'2.1.20-rc10'` リテラル → `'2.1.20-rc10.1'` を Node ワンライナーで機械置換（**104 件置換、残存 0**）

### Fix 6: 新規テスト `tests/v249-audit-race-observation.test.js`（10 件、全 PASS）

| # | 検証項目 | 結果 |
|---|---|---|
| T1 | `package.json.version === '2.1.20-rc10.1'` | PASS |
| T2 | Fix 1: `_preStartStateCacheUpdatedAt` 変数 + `_publishDualState` 内記録 + `hdmi:display-removed:dual-sync-stale` 発火経路 + 500ms ガード | PASS |
| T3 | Fix 2: switchOperatorToSolo の `_switchStartTimeMs` + `_switchDurationMs >= 50` + `hdmi:dialog-blocked:switchOperatorToSolo` 発火 | PASS |
| T4 | Fix 3: applyTimerStateToTimer 4 経路 + initialize 1 経路すべてに `_raceEntryMs` / `_raceExitMs` + `timer:reset:race-window-entry` 発火（trigger 5 種別） | PASS |
| T5 | 既存 `operator:applyTimerStateToTimer:skip-reset-during-prestart` 4 trigger + `timer:reset:skip-during-prestart` 5 ctx 値完全保持 | PASS |
| T6 | PRIORITY_LOG_LABELS Set 新規 3 ラベル追加 + 既存 10 ラベル完全保持 | PASS |
| T7 | rc10 機構（`reset({force: false})` + 5 経路）完全保持 | PASS |
| T8 | rc1〜rc9 機構 + 致命バグ保護 5 件 完全保持 | PASS |
| T9 | 計測機構保持 + rc10.1 新規 3 ラベル発火経路 | PASS |
| T10 | timer.js touch なし（rc10.1 新規ラベル / 計測変数すべて main.js + renderer.js のみ） | PASS |

### Fix 7: CHANGELOG.md `[2.1.20-rc10.1] - 2026-05-12` セクション追加

`[2.1.20-rc10]` セクション上に新規セクション挿入。Added (観測強化) / Infrastructure / Maintained / Notes の 4 区分（spec 通り）。

### 副次修正: 既存 6 テストの regex 拡張（rc10.1 の文字数増加 + バージョン形式追従）

| ファイル | 変更箇所 | 理由 |
|---|---|---|
| `tests/v233-meas-removal.test.js` T3/T5 | skip regex `/-(meas\|rc)\d+$/` → `/-(meas\|rc)\d+(\.\d+)?$/` | rc10.1 形式 `-rc\d+\.\d+` の skip 対応 |
| `tests/v234-meas1-labels-and-badge.test.js` | 同上 | 同上 |
| `tests/v235-tournaments-list-storm-fix.test.js` T6 | 同上 | 同上 |
| `tests/v236-meas-removal.test.js` skip + T0 version regex | skip + version pattern に `(\.\d+)?` 追加 | 同上 |
| `tests/v237-production-release.test.js` | skip regex 拡張 | 同上 |
| `tests/v244-meas3-observation-strengthen.test.js` T6 | `[\s\S]{0,800}` → `{0,1200}` | display-removed ハンドラに stale 観測ブロック追加で文字数拡大 |
| `tests/v245-prestart-cache-merge.test.js` T7 | 同上 | 同上 |
| `tests/v246-prestart-skip-reset.test.js` T4 | `[\s\S]{0,400}?return` → `{0,1200}?return` | race window 観測コードがガード内に約 600 chars 追加 |
| `tests/v247-skip-reset-all-routes.test.js` T2/T4/T5 | `{0,300}?return` → `{0,1200}?return` + `{0,400}?classList.add` → `{0,1200}?` | 同上 |

詳細は §10 構築士への質問にて報告。

---

## §3 事前調査結果

### main.js 現状確認

| 関数 | 行 | rc10.1 影響 |
|---|---|---|
| `_dualStateCache` 宣言 | 1084-1103 | L1104 に `_preStartStateCacheUpdatedAt` 追加 |
| `_publishDualState` | 1113-1141 | preStartState 経路に `Date.now()` 記録 1 行追加 |
| `screen.on('display-removed', ...)` | 1552-1581 | rollingLog 直後に stale 検出ブロック追加 |
| `switchOperatorToSolo` | 1448-1492 | 冒頭 + finally に時刻計測追加 |
| `PRIORITY_LOG_LABELS` Set | 137-151 | 末尾に 3 ラベル追加 |

### renderer.js 現状確認

| 経路 | 行 | rc10.1 影響 |
|---|---|---|
| applyTimerStateToTimer invalid-ts | 1626-1648 | rc8/rc9 既存ガード内に race window 観測追加 |
| applyTimerStateToTimer idle | 1657-1681 | 同上 |
| applyTimerStateToTimer finished | 1696-1721 | 同上 |
| applyTimerStateToTimer no-levels | 1729-1748 | 同上 |
| initialize 復元失敗 fallback | 7635-7654 | rc10 既存ガード内に race window 観測追加 |

### timer.js 現状確認: **touch なし**（v249 T10 で自動 verify、spec 通り）

---

## §4 rc1〜rc10 機構保持確認（grep 証跡）

| 機構 | 検証結果 |
|---|---|
| rc1〜rc3 すべて | 完全保持 ✅ |
| rc4 timer.js `restorePreStart` / `applyOperatorPreStartState` | 完全保持 ✅ |
| rc5 `preStart:operator:send` / `operator:preStartResync:sent` / `subscribeStateSync` | 完全保持 ✅ |
| rc6-meas3 観測強化 8 項目（Fix A〜H）| すべて完全保持 ✅ |
| rc7 cache merge + `preStart:cache:merge` | 完全保持 ✅ |
| rc8/rc9 applyTimerStateToTimer 4 経路 `isPreStartActive()` ガード + trigger 4 種別 | 完全保持（race window 観測前後に挟む形）✅ |
| rc10 timer.js `reset({force: false})` + 5 経路 `timerReset({ force: false })` + `timer:reset:skip-during-prestart` 5 ctx 値 | 完全保持 ✅ |
| timer.js `reset()` 関数本体 | touch なし（v249 T10 で自動 verify）✅ |

すべて v249 / 既存テスト群で自動 verify、全 PASS。

---

## §5 計測機構保持確認（grep 証跡）

- meas1 計測バッジ HTML + CSS: **保持** ✅
- バージョン文字列 `/-meas\d*$/` + `/-rc\d+/` 分岐: **保持**（rc10.1 でもバッジ表示）
- meas1 既存 15 ラベル: **保持** ✅
- meas2 6 カテゴリ ラベル: **保持** ✅
- 症状確証 4 ラベル: **保持** ✅
- rc2/rc4/rc5/meas3/rc7/rc8/rc9/rc10 ラベル: **すべて完全保持** ✅
- **rc10.1 新規 3 ラベル**:
  - `hdmi:display-removed:dual-sync-stale` ✅
  - `hdmi:dialog-blocked:switchOperatorToSolo` ✅
  - `timer:reset:race-window-entry` ✅

PRIORITY_LOG_LABELS Set にも追加済（priority-events.log に記録、配信後監視で活用）。v249 T6 / T9 で自動 verify、PASS。

---

## §6 テスト結果

```
$ npm test
Total PASS: 1116
Total FAIL: 0
Total SKIP: 21
（rc10 1106 + v249 新規 10 件、SKIP 件数は ±0）
```

- 全 96 テストファイル（v249 新規含む）実行、想定通り 1116 PASS / 0 FAIL / 21 SKIP
- v249 audit-race-observation: 10 PASS / 0 FAIL
- 副次修正で更新した v233 / v234 / v235 / v236 / v237 / v244 / v245 / v246 / v247 すべて PASS

---

## §7 ビルド成果物

| 項目 | 値 |
|---|---|
| 絶対パス | `C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock\dist\pokertimerplus-setup-2.1.20-rc10.1.exe` |
| サイズ | 83,020,035 B（約 79.2 MB）|
| sha512 | `ErLvwOIvt1EkQnAtEETU6a8Pik2urHzmhw4PjEhP5hTe/SK7jQEIiYFjYGaOeUq/O/CFop1ef+gJmwkkABvAGA==` |
| latest.yml | `dist/latest.yml` 出力済（version: 2.1.20-rc10.1、releaseDate: 2026-05-12T08:45:53.124Z）|
| 配布判断 | **配布禁止**（前原さん PC 実機専用、上書きインストール）|

---

## §8 副作用評価結果

### 致命バグ保護 5 件すべて完全無傷

| 保護 | 検証結果 |
|---|---|
| C.2.7-A `resetBlindProgressOnly` / `handleReset` 責任分離 | reset 経路 touch なし、v249 T8 PASS |
| C.2.7-D `tournaments:setDisplaySettings` の timerState destructure 除外 | main.js は `_publishDualState` 内 1 ブロック + `screen.on` ハンドラ内 1 ブロック + `switchOperatorToSolo` 計測のみ追加、他 IPC ハンドラ touch なし |
| C.1-A2 / C.1.4-fix1 `ensureEditorEditableState` 4 重防御 | 編集経路 touch なし |
| C.1.7 AudioContext suspend 防御 | audio.js 完全無変更 |
| C.1.8 runtime 永続化 | schedulePersistRuntime + 5 秒 setInterval touch なし |

### v2.1.6〜v2.1.20-rc10 機構完全保持

すべて touch なし、main.js + renderer.js のみ観測ラベル前後に挟む形で追加。v249 T7 / T8 で自動 verify、全 PASS。

### Race / 副作用評価

- **Fix 1**: `_preStartStateCacheUpdatedAt` 変数追加 + `_publishDualState` 内 1 ブロック + display-removed ハンドラ内 cache 経過時間チェック追加のみ。**機能不変**、計測のみ
- **Fix 2**: `switchOperatorToSolo` 関数の冒頭・末尾に時刻記録のみ追加、**機能不変**
- **Fix 3**: 5 経路の rc8/rc9/rc10 ガード内に `performance.now()` 計測 + 警告ラベル発火経路追加のみ、**既存ガード本体 touch なし**
- **Fix 4**: PRIORITY_LOG_LABELS Set 拡張、機能不変
- **新ラベル発火頻度**: HDMI 抜き差し時のみ（低頻度）、本番影響なし
- **race window 観測 1ms ガード**: 1ms 以上の遅延は通常発生しないため、本番運用ではほぼ発火しないと予想。発火時のみ priority-events.log に記録、配信後監視で事実ベース計測

---

## §9 並列 sub-agent / Task 数報告

- **並列 sub-agent: 0 体**（cc-operation-pitfalls.md §1.1 公式 Agent Teams 上限遵守 ✅）
- 構築士確定方針（rc10-audit 選択肢 B 採用、高優先 3 ラベル追加）の機械的反映フェーズ、Plan Mode 不要
- 事前調査は Read / Grep ツールで直接実施
- TodoWrite 進捗管理: 使用（11 タスク → 11 完了）

---

## §10 構築士への質問・懸念事項

### 1. 副次修正 9 テストの regex 拡張の妥当性

Fix 1〜3 で main.js / renderer.js の関連箇所の文字数が拡大（display-removed ハンドラ +200 chars / applyTimerStateToTimer 4 経路ガード内 +600 chars × 4 経路）。既存 9 テストの brittle regex が引っかかったが、すべて「rc10.1 追加コード分の文字数増加に追従する regex 拡張」のみで対応、テスト意図は変更せず。

具体的には:
- v233/v234/v235/v236/v237: バージョン skip regex `/-(meas|rc)\d+$/` → `/-(meas|rc)\d+(\.\d+)?$/`（rc10.1 形式追従）
- v236 T0: version pattern も `(\.\d+)?` 追加
- v244 T6 + v245 T7: `[\s\S]{0,800}` → `{0,1200}`（display ハンドラ拡張）
- v246 T4 + v247 T2/T4/T5: ガード内 regex limit を `300-400` → `1200`（race window 観測コード拡大）

**懸念**: rc5〜rc10 と同様に「spec の意図（rc10.1 機構を破壊せず動作させる）の範囲内」と判断したが、構築士の判断と合致するか確認したい。特に v236 T0 の version pattern 拡張は config-level 変更のため、構築士最終確認。

### 2. race window 観測の閾値 1ms の妥当性

spec で「1ms 以上の場合のみ警告ラベル発火」と指定。`performance.now()` の精度は通常 5〜100μs オーダー、JS イベントループの実行コスト（rolling-log 出力 1 回）は数百μs 〜数 ms 程度。本番運用で:

- 1ms 超部発火の予想頻度: 極低（高負荷 GC pause / メインスレッド遅延時のみ）
- 0 件発火が「race window なし」を示すか、「観測精度不足」を示すかの解釈に注意が必要

構築士が解釈ガイドを別途明記するか検討。

### 3. priority-events.log への追加と本番影響

新規 3 ラベルすべて PRIORITY_LOG_LABELS Set に追加 → priority-events.log（独立 buffer 10000 行 / 5 分 flush）に記録。本番影響は皆無（HDMI イベント or race 発生時のみ低頻度発火）。

### 4. 試験範囲確認

NEXT_CC_PROMPT spec §「試験項目別の前原さん確認手順」記載の標準セット 1〜6 で動作確認後、rc11 で計測機構撤去 → v2.2.1 リリース予定。構築士判断で試験項目調整が必要なら CC へ追加指示。

---

## §11 オーナー向け確認手順（v2.1.20-rc10.1 試験ビルド、標準セット 1〜6）

`dist/pokertimerplus-setup-2.1.20-rc10.1.exe` を前原さん PC に上書きインストール → 起動後 30〜60 秒待って下記を確認:

| # | 操作 | 期待結果 |
|---|---|---|
| 1 | 起動直後の画面表示確認 | バージョン表示 `2.1.20-rc10.1`、画面右下に「計測ビルド」黄色バッジ |
| 2 | **【試験 1】PRE_START カウントダウン中に HDMI 抜き差し**（rc10 根治確認）| Space で一時停止、トーナメント維持、PRE_START 継続 |
| 3 | **【試験 2】通常リセットボタン**（PRE_START 中 + 通常進行中の両方）| 正常動作（rc10 構造変更の副作用なし確認）|
| 4 | **【試験 3】PC スリープ復帰 + HDMI 再接続**（Win+X → U → U で 5 秒スリープ → 抜き差し → 復帰）| 3 秒以内にダイアログ表示、タイマー継続 |
| 5 | **【試験 4】自動更新ダイアログ中の HDMI 抜き差し**（起動直後 30 秒に「更新あります」表示中に抜き差し）| operator PC タイマー継続、ハングなし。新規 `hdmi:dialog-blocked:switchOperatorToSolo` ラベル発火（あれば致命級 #2 再現確証）|
| 6 | **【試験 5】BREAK ↔ RUNNING 境界 advanceTimeBy 連打**（残り 30 秒の BREAK で右矢印 5 連打）| 計画通り 3〜5 レベル進行、レベル飛びなし |
| 7 | **【試験 6】USB-HDMI 多重バウンス**（USB-HDMI アダプタで 0.5 秒間隔 5 回抜き差し）| `display-removed` 1 回のみ記録（debounce 効果）|
| 8 | 各試験後 Ctrl+Shift+L でログ採取 + ログフォルダ全体（rolling-current / priority-events / hdmi-snapshot-*）送付 | 新規 3 ラベル発火状況確認 |

### 確認の優先順位

- **最重要**: 試験 1（HDMI 抜き差し）+ 試験 2（リセット）が rc10 同様に動作（root cause 根治維持）
- **重要**: 試験 4（autoUpdater 競合）→ 新規ラベル `hdmi:dialog-blocked:switchOperatorToSolo` 発火状況
- **重要**: ログ内 `timer:reset:race-window-entry` の `windowMs` 値（多層防御 race 観測）
- 通常: 試験 3 / 5 / 6 で各種シナリオ動作確認

### 次フェーズ予告

期待値達成（試験 1〜6 すべて合格）→ **rc11 で計測機構撤去 + バージョン文字列 rc10.1 → v2.2.1 + main マージ + tag v2.2.1 + GitHub Release 公開**

期待値未達成 → 新規ラベル発火状況で追加対処判断

### Known Issues（rc10.1 範囲外、v2.2.2 以降または v2.3.0 で対処予定）

- rc10-audit 中・低優先観測ラベル 8 個（v2.3.0 候補）
- 案 D（state ↔ isPreStart 乖離防御）（v2.3.0 候補）
- 案 E（main.js 観測強化のうち payload validation 拡張）（v2.3.0 候補）
- 多層防御の論理的死角の構造的対処（事実ベース計測後判断）

---

## §12 git 状態

- **作業ブランチ**: `feature/v2.1.20-rc10.1-audit-race-observation`（rc10 commit `5800622` から分岐）
- **rc10.1 commit**: 後続で作成（commit message: `v2.1.20-rc10.1: rc10-audit 高優先観測ラベル 3 個追加（致命級 race 配信後監視基盤）`）
- **main マージ**: ❌ 未実施（spec 禁止条項に準拠）
- **tag 作成**: ❌ 未実施
- **GitHub Release**: ❌ 未実施
- **git push origin**: ❌ 未実施

### 次フェーズで構築士が指示書を出すまで待機

- 期待値達成: rc11 計測撤去 → v2.2.1 本番リリース（main / tag / Release / push 解禁）
- 期待値未達成: ログ ctx 値で発火経路を特定 → 案 D / E / 別経路調査

---

## §13 オーナー向け確認（簡潔版、3〜5 項目）

1. **CC 動作報告**: 構築士確定方針 rc10-audit 選択肢 B（観測ラベル追加 → 試験 → 配信）に従い、高優先 3 ラベルを機械的に追加完了。新規テスト 10 件 + 副次修正 9 テスト調整、合計 **1116 PASS / 0 FAIL**
2. **追加内容**: ① preStartState cache 古さ検出（500ms ガード）② switchOperatorToSolo 所要時間検出（50ms ガード）③ rc8/rc9/rc10 ガード 5 経路の race window 観測（1ms ガード）
3. **rc10.1 実機テストの最重要確認**: 試験 1（HDMI 抜き差し）+ 試験 2（リセット）が rc10 同様に動作。試験 4（autoUpdater 競合）で新規ラベル発火状況確認
4. **次のアクション**: 前原さん実機試験 1〜6（標準セット、所要 3〜4 時間）合格 → rc11 計測撤去 → v2.2.1 本番リリースへ
5. **配布判断**: 配布なし。前原さん PC のみで上書きインストールテスト
