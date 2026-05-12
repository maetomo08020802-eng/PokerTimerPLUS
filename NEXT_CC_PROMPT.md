# NEXT_CC_PROMPT — v2.1.20-rc10.1（リリース前監査の致命級 race 観測ラベル 3 個追加）

## 【最重要】このプロンプト実行前のお願い

**Claude Code で `/clear` コマンドを実行してから本プロンプトを読み込むこと**。

`/clear` 後は以下を順に Read:

1. `poker-clock/CC_REPORT.md`（v2.1.20-rc10-audit 完了報告）
2. `poker-clock/skills/cc-operation-pitfalls.md`（§1 / §6 / §7）

## 推奨モデル

**Sonnet 4.6**。構築士確定方針の機械的反映タスク、**Plan Mode 不要 + 並列 sub-agent 0 体**。

---

## 構築士の判断（v2.1.20-rc10.1 の目的）

### rc10-audit リリース前監査の結論

監査結果（91 シナリオ網羅、致命 1 / 重要 7 / 軽微多数）から、前原さん判断:
- リリース戦略: **選択肢 B**（観測ラベル高優先 3 個追加 → 試験 → 配信）
- 試験範囲: **標準セット**（試験 1〜6、所要 3〜4 時間）

→ 本フェーズ rc10.1 で高優先観測ラベル 3 個を追加し、致命級 race の配信後監視基盤を確立。

### 高優先観測ラベル 3 個（rc10-audit §4 より）

| # | ラベル | 用途 | 発火経路 |
|---|---|---|---|
| **#1** | `hdmi:display-removed:dual-sync-stale` | PRE_START 消失の早期発見 | main.js display-removed ハンドラで cache が 500ms 以上古い場合 |
| **#2** | `hdmi:dialog-blocked:switchOperatorToSolo` | 自動更新ダイアログ中の HDMI 抜き検出 | main.js switchOperatorToSolo の所要時間が 50ms 超 |
| **#10** | `timer:reset:race-window-entry` | 多層防御 race 検出 | renderer.js rc8/rc9/rc10 ガード経路で時間差計測 |

### v2.1.20-rc10.1 のリリース戦略（実機専用、配信なし）

- feature ブランチに commit + ローカルビルドのみ
- **main merge / tag / GitHub Release / git push: すべて禁止**
- `dist/pokertimerplus-setup-2.1.20-rc10.1.exe` を前原さん PC のみで実機テスト
- 計測機構（rc6-meas3）完全保持
- rc10.1 試験で標準セット（試験 1〜6）合格 → rc11 で計測撤去 + **v2.2.1 本番リリース**

---

## 実装範囲（diff 完全指定、これ以外は禁止）

### Fix 1: main.js `hdmi:display-removed:dual-sync-stale` ラベル追加（#1）

**修正対象**: `src/main.js` `screen.on('display-removed', ...)` ハンドラ内（rc6-meas3 で追加した `_flushLogsToFile('display-removed')` 呼出の直前か直後）

**設計**:
- `_dualStateCache.preStartState` の最終更新時刻を記録する変数を追加（`_preStartStateCacheUpdatedAt`）
- `_publishDualState('preStartState', ...)` の中で更新時刻を記録
- `display-removed` ハンドラ内で cache 更新からの経過時間を計測、500ms 以上古い場合にラベル発火

**追加コード**（既存箇所への 3 箇所追加）:

```js
// (1) 既存 _dualStateCache 宣言の直後に追加（line 1012 付近）
// v2.1.20-rc10.1: preStartState cache の最終更新時刻（rc10-audit #1 race 観測用）
let _preStartStateCacheUpdatedAt = 0;
```

```js
// (2) _publishDualState 内、kind === 'preStartState' 分岐に最終更新時刻記録を追加（line 1024 付近）
function _publishDualState(kind, value) {
  if (!Object.prototype.hasOwnProperty.call(_dualStateCache, kind)) return;
  _dualStateCache[kind] = value;
  // v2.1.20-rc10.1: preStartState cache 更新時刻記録
  if (kind === 'preStartState') {
    _preStartStateCacheUpdatedAt = Date.now();
  }
  // ... 既存処理（無変更）...
}
```

```js
// (3) screen.on('display-removed', ...) ハンドラ内、rollingLog('display-removed', ...) の直後に追加
rollingLog('display-removed', _safeDisplayRemovedSnapshot(removedDisplay));
// v2.1.20-rc10.1 観測: preStartState cache が古い場合（500ms 以上）に警告ラベル
if (_dualStateCache.preStartState && _dualStateCache.preStartState.isActive && _preStartStateCacheUpdatedAt > 0) {
  const cacheAgeMs = Date.now() - _preStartStateCacheUpdatedAt;
  if (cacheAgeMs >= 500) {
    try { rollingLog('hdmi:display-removed:dual-sync-stale', { cacheAgeMs, isActive: true }); } catch (_) {}
  }
}
try { _flushLogsToFile('display-removed'); } catch (_) {}
```

### Fix 2: main.js `hdmi:dialog-blocked:switchOperatorToSolo` ラベル追加（#2）

**修正対象**: `src/main.js` `async function switchOperatorToSolo()` 関数本体（rollingLog 'switchOperatorToSolo:enter' / 'switchOperatorToSolo:exit' の周辺）

**設計**:
- `switchOperatorToSolo` 関数の冒頭で開始時刻を記録
- 関数末尾で経過時間を計算、50ms 以上なら警告ラベル発火（autoUpdater ダイアログ等によるブロック検出）

**修正後コード**:

```js
async function switchOperatorToSolo() {
  const _switchStartTimeMs = Date.now();   // v2.1.20-rc10.1 観測用
  rollingLog('switchOperatorToSolo:enter', { isSwitchingMode: _isSwitchingMode });
  // ... 既存処理（無変更）...
  try {
    // ... 既存 try 内処理（無変更）...
  } finally {
    _isSwitchingMode = false;
    rollingLog('switchOperatorToSolo:exit', null);
    // v2.1.20-rc10.1 観測: 50ms 以上かかった場合、dialog ブロック等の race を検出
    const _switchDurationMs = Date.now() - _switchStartTimeMs;
    if (_switchDurationMs >= 50) {
      try { rollingLog('hdmi:dialog-blocked:switchOperatorToSolo', { durationMs: _switchDurationMs }); } catch (_) {}
    }
  }
}
```

### Fix 3: renderer.js `timer:reset:race-window-entry` ラベル追加（#10）

**修正対象**: `src/renderer/renderer.js` の以下 5 箇所（rc8/rc9 ガード + rc10 ガード経路の冒頭）

**設計**:
- 各経路の `if (typeof isPreStartActive === 'function' && isPreStartActive())` ガード冒頭で `performance.now()` を取得
- ガード通過時の最終 rolling-log 発火直後にも `performance.now()` を取得
- 両者の時間差（μs オーダー）を記録、**1ms 以上の場合のみ警告ラベル発火**（race window 観測）

**対象 5 箇所**: rc8/rc9 ガード 4 箇所（applyTimerStateToTimer 内）+ rc10 ガード 1 箇所（initialize 経路）

**修正パターン**（各箇所共通）:

```js
// 例: applyTimerStateToTimer idle 経路（rc8 既存ガード、line 1659 付近）
if (typeof isPreStartActive === 'function' && isPreStartActive()) {
  // v2.1.20-rc10.1 観測: race window 計測開始
  const _raceEntryMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  try { window.api?.log?.write?.('operator:applyTimerStateToTimer:skip-reset-during-prestart', { trigger: 'idle', status: ts.status, role: window.appRole }); } catch (_) {}
  // v2.1.20-rc10.1 観測: race window 計測終了（1ms 以上なら警告ラベル）
  const _raceExitMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  const _raceWindowMs = _raceExitMs - _raceEntryMs;
  if (_raceWindowMs >= 1) {
    try { window.api?.log?.write?.('timer:reset:race-window-entry', { trigger: 'idle', windowMs: _raceWindowMs }); } catch (_) {}
  }
  return;
}
```

**5 経路の trigger 値**: 'invalid-ts' / 'idle' / 'finished' / 'no-levels' / 'initialize:restoredFromTimerState-false'（rc9/rc10 既存と統一）

**重要**: rc8/rc9/rc10 既存ラベル `operator:applyTimerStateToTimer:skip-reset-during-prestart` と `timer:reset:skip-during-prestart` は**完全保持**、本 Fix は前後に挟む形で追加のみ。

### Fix 4: PRIORITY_LOG_LABELS Set に新規 3 ラベル追加

**修正対象**: `src/main.js` の `PRIORITY_LOG_LABELS` Set 定義箇所（rc6-meas3 で追加）

**修正後**: 既存ラベルに新規 3 個を追加。

```js
const PRIORITY_LOG_LABELS = new Set([
  'display-removed',
  'display-added',
  'switchOperatorToSolo:enter',
  'switchOperatorToSolo:exit',
  'switchSoloToOperator:enter',
  'switchSoloToOperator:exit',
  'preStart:operator:send',
  'operator:preStartResync:sent',
  'operator:applyPreStartState:apply',
  'meas3:hdmi-snapshot:written',
  // v2.1.20-rc10.1 追加（rc10-audit 高優先 #1 / #2 / #10）
  'hdmi:display-removed:dual-sync-stale',
  'hdmi:dialog-blocked:switchOperatorToSolo',
  'timer:reset:race-window-entry'
]);
```

### Fix 5: package.json version bump + テスト追記

- `package.json.version`: `2.1.20-rc10` → `2.1.20-rc10.1`
- `package.json.scripts.test` 末尾に `node tests/v249-audit-race-observation.test.js` を追記
- 既存 55 テストの `'2.1.20-rc10'` リテラル → `'2.1.20-rc10.1'` を Node ワンライナーで機械置換（残存 0 件）

### Fix 6: 新規テスト `tests/v249-audit-race-observation.test.js`（10 件）

| # | 検証項目 |
|---|---|
| T1 | `package.json.version === '2.1.20-rc10.1'` |
| T2 | **Fix 1**: main.js に `_preStartStateCacheUpdatedAt` 変数 + `_publishDualState` 内 preStartState 経路で更新時刻記録 + display-removed ハンドラ内で `hdmi:display-removed:dual-sync-stale` 発火（500ms ガード）|
| T3 | **Fix 2**: main.js `switchOperatorToSolo` 冒頭で `_switchStartTimeMs` 取得 + finally で経過時間計測 + `hdmi:dialog-blocked:switchOperatorToSolo` 発火（50ms ガード）|
| T4 | **Fix 3**: renderer.js applyTimerStateToTimer 4 経路 + initialize 経路の 5 箇所すべてに `_raceEntryMs` / `_raceExitMs` + `timer:reset:race-window-entry` 発火経路（1ms ガード、trigger 5 種別） |
| T5 | **Fix 3**: 既存 `operator:applyTimerStateToTimer:skip-reset-during-prestart` 5 trigger + `timer:reset:skip-during-prestart` 5 ctx 値はすべて**完全保持**（撤去されていない）|
| T6 | **Fix 4**: PRIORITY_LOG_LABELS Set に新規 3 ラベル追加 + 既存 10 ラベル完全保持 |
| T7 | rc10 機構（`reset({force: false})` + 5 経路）完全保持 |
| T8 | rc1〜rc9 機構保持 + 致命バグ保護 5 件 |
| T9 | 計測機構保持（meas1+meas2+症状確証 4+rc2/rc4/rc5/meas3/rc7/rc8/rc9/rc10 ラベル + 新規 rc10.1 3 ラベル）|
| T10 | timer.js touch なし（rc10.1 は main.js + renderer.js のみ変更、timer.js は完全保持）|

### Fix 7: CHANGELOG.md `[2.1.20-rc10.1] - 2026-05-12` セクション追加

`[2.1.20-rc10]` セクション**上**に新規セクション挿入:

```markdown
## [2.1.20-rc10.1] - 2026-05-12

PokerTimerPLUS+ v2.1.20-rc10.1 試験ビルド（前原さん実機専用、配布なし）。rc10-audit リリース前監査で検出された致命級 race 2 件 + 多層防御論理的死角の観測ラベル 3 個を追加（rc10-audit §4 §5 高優先 #1 / #2 / #10）。配信後の本番運用で race 発生頻度を事実ベース計測する基盤を確立。

### Added (観測強化)
- **`hdmi:display-removed:dual-sync-stale`**: display-removed 検出時、preStartState cache が 500ms 以上古い場合に警告ラベル発火。PRE_START 消失の早期発見用
- **`hdmi:dialog-blocked:switchOperatorToSolo`**: switchOperatorToSolo の所要時間が 50ms 超の場合に警告ラベル発火。autoUpdater ダイアログ等による Win32 メッセージループ遮断の race 検出用
- **`timer:reset:race-window-entry`**: rc8/rc9/rc10 ガード 5 経路の race window が 1ms 以上の場合に警告ラベル発火。多層防御 race の論理的死角を観測

### Infrastructure
- `_preStartStateCacheUpdatedAt` 変数追加（main.js）+ `_publishDualState` 内で preStartState cache 更新時刻記録
- `_switchStartTimeMs` 計測（main.js switchOperatorToSolo 関数内）
- `_raceEntryMs` / `_raceExitMs` 計測（renderer.js 5 経路、`performance.now()` ベース）
- PRIORITY_LOG_LABELS Set に新規 3 ラベル追加（priority-events.log に記録、配信後監視で活用）

### Maintained
- v2.1.20-rc10 (timer.js reset force フラグ + 5 経路 + 多層防御) 完全保持
- v2.1.20-rc9 (4 経路 ガード + trigger 4 種別) 完全保持
- v2.1.20-rc8 / rc7 / rc6-meas3 / rc5 / rc4 / rc3 / rc2 / rc1 機構 完全保持
- v2.1.19 重さ根治機構 + 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構 完全保持

### Notes
- 致命級 race 2 件は実機影響度低（rc10-audit §7 評価）、本 rc10.1 では**観測のみ**追加。構造的対処は v2.2.2 以降で事実ベース計測後に判断
- 試験範囲は標準セット（rc10-audit §5 試験 1〜6、所要 3〜4 時間）
- 試験合格後、rc11 で計測機構撤去 → v2.2.1 として全国配信予定
```

---

## 禁止事項（厳守）

- ❌ Fix 1〜7 の diff 改変（**機能範囲・変数名・ラベル名・閾値**はすべて構築士指定通り）
- ❌ **timer.js の touch**（rc10.1 は main.js + renderer.js のみ、timer.js は完全保持、v249 T10 で自動 verify）
- ❌ **rc8/rc9/rc10 既存ガード経路**の機能改変（観測ラベル前後に挟む追加のみ可）
- ❌ **既存ラベル**（`operator:applyTimerStateToTimer:skip-reset-during-prestart` / `timer:reset:skip-during-prestart` 含む）の撤去
- ❌ **v2.1.20-rc10 / rc9 / rc8 / rc7 / rc6-meas3 / rc5 / rc4 / rc3 / rc2 / rc1 機構**の touch
- ❌ **v2.1.19 重さ根治機構**の touch
- ❌ 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構の touch
- ❌ **計測機構**の撤去
- ❌ **dual-sync.js への変更**
- ❌ HANDOVER.md / project memory / `docs/CLAUDE_DESIGN_PROMPT.md` の編集
- ❌ 並列 sub-agent ≥ 1 体（構築士確定方針の機械的反映、Plan Mode 不要）
- ❌ スコープ外の追加実装（高優先 3 ラベルのみ、中・低優先 8 ラベルは v2.3.0 以降）
- ❌ **main マージ / tag 作成 / GitHub Release 公開 / git push origin**（すべて禁止）

---

## 副作用評価（CC は実装前に CC_REPORT.md に明記）

### 致命バグ保護 5 件すべて完全無傷

| 保護 | 検証 |
|---|---|
| C.2.7-A `resetBlindProgressOnly` / `handleReset` 責任分離 | reset 経路 touch なし |
| C.2.7-D `tournaments:setDisplaySettings` の timerState destructure 除外 | main.js touch は `_publishDualState` 内 1 行追加 + `screen.on` ハンドラ内 1 ブロック追加 + `switchOperatorToSolo` 関数内 計測追加のみ、他 IPC ハンドラ touch なし |
| C.1-A2 / C.1.4-fix1 `ensureEditorEditableState` 4 重防御 | 編集経路 touch なし |
| C.1.7 AudioContext suspend 防御 | audio.js 完全無変更 |
| C.1.8 runtime 永続化 | schedulePersistRuntime + 5 秒 setInterval touch なし |

### v2.1.6〜v2.1.20-rc10 機構完全保持

すべて touch なし、main.js + renderer.js のみ観測ラベル追加。

### Race / 副作用評価

- **Fix 1**: `_preStartStateCacheUpdatedAt` 変数追加 + `_publishDualState` 内 1 行 + display-removed ハンドラ内 cache 経過時間チェック追加のみ。**機能不変**、計測のみ
- **Fix 2**: `switchOperatorToSolo` 関数の冒頭・末尾に時刻記録のみ追加、**機能不変**
- **Fix 3**: 5 経路の rc8/rc9/rc10 ガード内に `performance.now()` 計測 + 警告ラベル発火経路追加のみ、**既存ガード本体 touch なし**
- **Fix 4**: PRIORITY_LOG_LABELS Set 拡張、機能不変
- **新ラベル発火頻度**: HDMI 抜き差し時のみ（低頻度）、本番影響なし
- **計測機構との関係**: 新ラベル 3 個は priority-events.log に append、5 分 buffer overflow しても保持

---

## CC_REPORT.md 必須記載項目

1. **§1 サマリ**
2. **§2 各 Fix の実装内容**: Fix 1〜7 の diff（特に main.js の 3 箇所追加 + renderer.js 5 経路追加を明示）
3. **§3 事前調査結果**: main.js `_dualStateCache` / `_publishDualState` / `switchOperatorToSolo` / `screen.on('display-removed', ...)` の現状確認 + renderer.js rc8/rc9/rc10 ガード 5 経路の確認 + PRIORITY_LOG_LABELS Set 確認
4. **§4 rc1〜rc10 機構保持確認**: grep 証跡
5. **§5 計測機構保持確認**: grep 証跡 + 新規 3 ラベル存在確認
6. **§6 テスト結果**: 全テスト件数（rc10 1106 + v249 新規 10 件 = 1116 件想定、PASS / FAIL / SKIP）
7. **§7 ビルド成果物**: `dist/pokertimerplus-setup-2.1.20-rc10.1.exe` + `dist/latest.yml`
8. **§8 副作用評価結果**
9. **§9 並列 sub-agent / Task 数報告**（0 体想定）
10. **§10 構築士への質問・懸念事項**
11. **§11 オーナー向け確認手順**: 下記表（rc10-audit §5 試験 1〜6 標準セット転記）
12. **§12 git 状態**: feature ブランチ commit hash、main / tag / Release / push は**未実施であることを明記**

### 試験項目別の前原さん確認手順（v2.1.20-rc10.1 試験ビルド、標準セット 1〜6）

| # | 操作 | 期待結果 |
|---|---|---|
| 1 | `dist/pokertimerplus-setup-2.1.20-rc10.1.exe` を実機 PC で上書きインストール → 起動（30〜60 秒待つ）| バージョン表示 `2.1.20-rc10.1`、計測バッジ |
| 2 | **【試験 1】PRE_START カウントダウン中に HDMI 抜き差し**（rc10 根治確認）| Space で一時停止、トーナメント維持、PRE_START 継続 |
| 3 | **【試験 2】通常リセットボタン**（PRE_START 中 + 通常進行中の両方）| 正常動作（rc10 構造変更の副作用なし確認）|
| 4 | **【試験 3】PC スリープ復帰 + HDMI 再接続**（Win+X → U → U で 5 秒スリープ → 抜き差し → 復帰）| 3 秒以内にダイアログ表示、タイマー継続。新規 `hdmi:display-added:picker-timeout` ラベル発火なし |
| 5 | **【試験 4】自動更新ダイアログ中の HDMI 抜き差し**（起動直後 30 秒に「更新あります」表示中に抜き差し）| operator PC タイマー継続、ハングなし。新規 `hdmi:dialog-blocked:switchOperatorToSolo` ラベル発火（あれば致命級 #2 再現確証）|
| 6 | **【試験 5】BREAK ↔ RUNNING 境界 advanceTimeBy 連打**（残り 30 秒の BREAK で右矢印 5 連打）| 計画通り 3〜5 レベル進行、レベル飛びなし。新規ラベル未発火 |
| 7 | **【試験 6】USB-HDMI 多重バウンス**（USB-HDMI アダプタで 0.5 秒間隔 5 回抜き差し）| `display-removed` 1 回のみ記録（debounce 効果） |
| 8 | 各試験後 Ctrl+Shift+L でログ採取 + ログフォルダ全体送付 | 新規 3 ラベル発火状況確認 |

### 確認の優先順位

- **最重要**: 試験 1（HDMI 抜き差し）+ 試験 2（リセット）が rc10 同様に動作（root cause 根治維持）
- **重要**: 試験 4（autoUpdater 競合）→ 新規ラベル `hdmi:dialog-blocked:switchOperatorToSolo` 発火状況
- **重要**: ログ内 `timer:reset:race-window-entry` の `windowMs` 値（多層防御 race 観測）
- 通常: 試験 3 / 5 / 6 で各種シナリオ動作確認

### 次フェーズ予告

期待値達成（試験 1〜6 すべて合格） → **rc11 で計測機構撤去 + バージョン文字列 rc10.1 → v2.2.1 + main マージ + tag v2.2.1 + GitHub Release 公開**（前原さん指定、v2.1.20 ジャンプで v2.2.1）

期待値未達成 → 新規ラベル発火状況で追加対処判断

### Known Issues（rc10.1 範囲外、v2.2.2 以降または v2.3.0 で対処予定）

- rc10-audit 中・低優先観測ラベル 8 個（v2.3.0 候補）
- 案 D（state ↔ isPreStart 乖離防御）（v2.3.0 候補）
- 案 E（main.js 観測強化のうち payload validation 拡張）（v2.3.0 候補）
- 多層防御の論理的死角の構造的対処（事実ベース計測後判断）

---

## feature ブランチ commit + ローカルビルド（main / tag / Release / push は禁止）

CC は以下を実施:

- 作業ブランチ: `feature/v2.1.20-rc10.1-audit-race-observation`（rc10 commit `5800622` から分岐）
- commit message: `v2.1.20-rc10.1: rc10-audit 高優先観測ラベル 3 個追加（致命級 race 配信後監視基盤）`
- ローカルビルド: `dist/pokertimerplus-setup-2.1.20-rc10.1.exe` 生成
- **main マージ・tag・Release・git push: すべて禁止**

CC_REPORT §12 に「main / tag / Release / git push すべて未実施」を明記。
