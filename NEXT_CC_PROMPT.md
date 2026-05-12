# NEXT_CC_PROMPT — v2.2.1 全国リリース版（最終コード監査 + 計測機構撤去 + main マージ + tag + Release + push 解禁）

## 【最重要】このプロンプト実行前のお願い

**Claude Code で `/clear` コマンドを実行してから本プロンプトを読み込むこと**。

`/clear` 後は以下を順に Read:

1. `poker-clock/CC_REPORT.md`（v2.1.20-rc10.1 完了報告、試験合格確認済）
2. `poker-clock/skills/cc-operation-pitfalls.md`（§1 / §6 / §7）
3. `poker-clock/skills/root-cause-analysis.md`

## 推奨モデル

**Sonnet 4.6**。本フェーズは **v2.2.1 全国配信版作成**。**Plan Mode 必須**（最終監査結果を構築士に提示 → 承認後に実装）+ **並列 sub-agent 3 体推奨**（公式上限遵守、Phase 1 最終監査）。

---

## 構築士の判断と本フェーズの目的

### 現状

- ✅ rc10 で HDMI 抜き差し問題根治
- ✅ rc10-audit リリース前監査完了（91 シナリオ網羅、致命級 race 2 件は実機影響度低と確認）
- ✅ rc10.1 で観測ラベル 3 個追加（標準セット試験 1〜6 全合格）
- ✅ ログ確証: 致命級 race は実機未発火、`hdmi:dialog-blocked` 1 件のみ 133ms 軽微遅延
- ✅ 前原さん判断: **v2.2.1 全国配信 GO**

### 本フェーズ rc11（= v2.2.1）の目的

前原さん指示「**最後の確認として、コード確認もしっかり目にお願いします**」に応えるため:

1. **Phase 1**: 並列 sub-agent 3 体で **最終コード監査**（計測機構撤去対象の網羅 + 撤去後リスク評価 + 配信完成度評価）
2. **Phase 2**: 構築士に監査結果 + 撤去対象一覧 + 残存ラベル一覧 を Plan Mode で提示、stop
3. **Phase 3**: 構築士承認後、計測機構撤去 + version `2.2.1` bump + CHANGELOG 確定 + commit
4. **Phase 4**: main マージ + tag v2.2.1 作成 + GitHub Release 公開 + git push 試行（最大 2 回）
5. **Phase 5**: push denied 時のフォールバック手順を CC_REPORT に明記（前原さん手動 push）

### v2.2.1 のリリース戦略

- **本番配信版**（main マージ + tag + Release + push を**初めて解禁**）
- 計測バッジ + 高頻度ログ + buffer 拡張 + 自動採取を撤去
- edge 発火低頻度ラベルは保持（本番ユーザー環境のサポート用）
- 自動更新で全国のポーカールームに配信開始

---

## CHANGELOG 確定版（前原さん承認済、CHANGELOG.md に追加）

```markdown
## v2.2.1 — 2026-05-12

PokerTimerPLUS+ v2.2.1 を全国リリースします。v2.1.19（重さ根治版）に加え、HDMI ケーブル抜き差し時の安定性を大幅に向上させました。

### 🛠 修正

- **HDMI ケーブル抜き差し時のタイマー消失問題を根治**
  会場モニターを途中で抜き差ししたとき、まれにタイマー（特に開始前カウントダウン）が消えてしまう問題を修正しました。HDMI を挿し直した後も、設定したトーナメントとカウントダウンがそのまま継続します。

- **会場モニターの切り替えが安定**
  USB-HDMI アダプタ使用時の多重検知や、PC スリープ復帰直後の HDMI 再接続でのモード切替が、より確実に動作するようになりました。

- **手元 PC のタイマー操作（スペースキー一時停止、リセットなど）の信頼性向上**
  HDMI 抜き差し直後でも、手元 PC からの操作（スペースキーでの一時停止、リセットボタンなど）が確実に効くようになりました。

### 📦 v2.1.19 からの継承（変更なしで維持）

- アプリ全体の動作軽量化（タイマー一覧の更新頻度を 90% 削減）
- BREAK 終了演出、PRE_START 一時停止表示など、v2.1.18 までの全機能

### 🔍 内部改善（一般運用には影響なし）

- 万が一の不具合発生時に原因解析できるよう、軽量な動作ログを内部で記録する仕組みを追加（個人情報や店舗情報は記録されません）
- 動作ログはアプリ内「ログフォルダを開く」ボタンから確認可能、トラブル時に開発者へ送付できます

### ⚠️ アップグレード時の注意

- 自動更新で適用される場合、インストール完了まで **30〜60 秒** かかります。アプリを閉じてからすぐ再起動せず、少し待ってから起動してください
- 既存のトーナメント設定・ブラインド構造・各種設定はすべて引き継がれます

### 📝 詳細（技術者向け）

- HDMI 抜き差し時の競合状態を構造的に根治（timer.js の reset 関数に「PRE_START 保護フラグ」を追加、多層防御アーキテクチャ）
- ログ保管容量を最適化（本番版は 5 分、開発者向け計測ビルドは 30 分）
- 致命級競合の早期検出ラベル 3 種を低頻度監視ラベルとして配置

配布: GitHub Releases から自動更新（または手動ダウンロード可）
配布元: Yu Shitamachi（PLUS2 運営）
```

---

## 実装フロー（Plan Mode 必須）

### Phase 1: 最終コード監査（並列 sub-agent 3 体、公式上限遵守）

CC は以下 3 領域を **並列 sub-agent 3 体** で同時調査:

#### Sub-agent 1: 計測機構撤去対象の網羅特定

調査範囲:
- `src/renderer/renderer.js` の高頻度ラベル発火経路（perf:render:duration / perf:state:notify / hall:updatePipTimer:set / perf:highfreq:summary / perf:raf:summary / perf:ipc:roundtrip / perf:dom:rebuild / perf:long-task / perf:memory:rss / perf:interval:fire / perf:raf:fire）
- `src/main.js` の rc6-meas3 機構（buffer 拡張 = `_isMeasBuildForBuffer` / ROLLING_LOG_RETENTION_MS / ROLLING_LOG_BUFFER_MAX 三項演算 / `_flushLogsToFile` 関数 / `meas3:hdmi-snapshot:written` ラベル / `_appendPriorityLog` lazy init / `_priorityLogBuffer` 機構の去就判定）
- `src/renderer/index.html` の計測バッジ要素
- `src/renderer/styles.css` の計測バッジ CSS
- `_recordHighFreq` / `_highFreqCounter` 機構（renderer.js）+ `window._highFreqCounter` 共有（state.js）
- 1 秒集計 setInterval（renderer.js）の `perf:raf:summary` / `perf:highfreq:summary` 出力部
- 30 秒集計 setInterval（renderer.js）の `perf:ipc:summary` / `perf:dom:summary` / `perf:subscribe:summary` 出力部

報告形式（300〜400 行）:
1. 撤去対象の完全リスト（ファイル:行付き、構築士が確認できる粒度）
2. 撤去後の挙動影響評価（パフォーマンス改善見込み、機能影響なし確認）
3. **保持対象との混在経路**（撤去するラベルと保持するラベルが同じ関数内にある場合の境界整理）

#### Sub-agent 2: 撤去後リスクの評価（保持対象との整合性）

調査範囲:
- 撤去対象を取り除いた後のコード一貫性（dead code 残存 / 不要 import / 未使用変数）
- 保持対象の edge 発火ラベル（rc4 / rc5 / rc7 / rc8 / rc9 / rc10 / rc10.1）が撤去対象の機構に依存していないか確認
- `priority-events.log` 機構の去就（rc6-meas3 で追加だが、edge 発火ラベルの永続化に必要 → **保持判定**を確認）
- 5 分 rolling buffer は保持（基本ログ機構として残す）
- 致命バグ保護 5 件への影響（reset 経路 / IPC 経路 / audio.js / ensureEditorEditableState）
- rc1〜rc10.1 機構の完全保持確認
- 既存テスト（v2.2.1 では rc 系テストの去就判定が必要、rc 系テストは保持 or 整理）

報告形式（300〜400 行）:
1. 撤去候補で「これは残すべき」と判定したものの根拠
2. dead code / 不要 import / 未使用変数の検出（撤去実行時のクリーンアップリスト）
3. 既存テスト 95 ファイルの去就判定（保持 / regex 緩和 / 撤去）
4. リスク評価（撤去で本番ユーザー環境に悪影響が出る可能性）

#### Sub-agent 3: v2.2.1 配信パッケージとしての完成度評価

調査範囲:
- `CHANGELOG.md` の全履歴と v2.2.1 セクションの一貫性
- `package.json` のメタデータ（version / description / author / build 設定）
- `electron-builder` 設定（`appId` / `publish` / `nsis` オプション）
- `latest.yml` 生成設定（autoUpdater の動作確認）
- GitHub Release の本文として CHANGELOG が正しく表示されるか（markdown 互換性）
- 致命バグ保護 5 件 + rc1〜rc10.1 機構の grep verify（最終チェック）
- README / docs / アイコン / インストーラ署名（Code Signing）の状態確認

報告形式（300〜400 行）:
1. 配信パッケージ完成度チェックリスト
2. README / docs の v2.2.1 対応必要性判定（更新不要なら明記）
3. autoUpdater 設定の最終確認（既存設定で問題なし or 修正必要）
4. GitHub Release 公開時のチェックリスト

### Phase 2: 統合報告書の提示（Plan Mode で stop）

3 sub-agent の調査結果を統合し、CC_REPORT.md に以下を記載 → 構築士判断待ち:

1. **撤去対象の完全リスト**（構築士が承認する単位）
2. **保持対象の完全リスト**（変更なし、edge 発火ラベル一覧）
3. **dead code / 不要 import / 未使用変数のクリーンアップリスト**
4. **既存テストの去就判定**（保持 / 緩和 / 撤去）
5. **配信パッケージ完成度評価**（GO / 修正必要）
6. **構築士への質問・懸念事項**

### Phase 3: 構築士承認後の実装

構築士が承認したら、CC は以下を順次実装:

1. **計測機構撤去**（Phase 1 で確定した対象）
2. **dead code / 不要 import / 未使用変数のクリーンアップ**
3. **既存テストの調整**（去就判定通り）
4. **新規テスト v250-v221-production-release.test.js**（10 件、配信版確認）
5. **package.json version bump**: `2.1.20-rc10.1` → **`2.2.1`**
6. **CHANGELOG.md に v2.2.1 セクション追加**（本ファイルの確定版を一字一句反映）
7. **既存テスト内の `'2.1.20-rc10.1'` リテラル**を必要に応じて更新（あるいは履歴として保持）
8. **feature ブランチ commit + ローカルビルド** (`dist/pokertimerplus-setup-2.2.1.exe`)

### Phase 4: main マージ + tag + Release + push（push 解禁、最大 2 回試行）

CC は以下を順次試行:

1. **main ブランチへマージ** (`git checkout main && git merge --no-ff feature/v2.2.1-production-release -m "..."`)
2. **tag v2.2.1 作成** (`git tag -a v2.2.1 -m "v2.2.1 全国リリース"`)
3. **GitHub Release 公開**（CHANGELOG セクションを本文として、`dist/pokertimerplus-setup-2.2.1.exe` + `dist/latest.yml` を assets として）
4. **git push origin main + git push origin v2.2.1**（最大 2 回試行）

各段階で claude-code ハーネスから denied される可能性あり（feedback_cc_harness_meta_safety.md）。

### Phase 5: push denied 時のフォールバック（CC_REPORT 明記）

CC が main マージや push を 2 回試行しても denied された場合:

1. CC_REPORT.md §14 に「push 待ち commit hash」「push 待ち tag」「push 待ち Release」を明記
2. 前原さん手動操作の手順を **平易な日本語で** 案内（PowerShell の場合 / GitHub Desktop の場合）
3. CC は停止、構築士から前原さんに手動 push を依頼

---

## 並列 sub-agent 起動の必須要件（公式準拠）

- **Phase 1 同時起動 3 体まで**（cc-operation-pitfalls.md §1.1 Agent Teams 上限）
- 各 sub-agent は **自己完結プロンプト**
- 各 sub-agent の報告は 300〜400 行で構造化
- **修正コードは sub-agent に書かせない**（調査・報告のみ）
- Phase 3〜5 の実装フェーズは sub-agent 0 体（機械的反映）

---

## 計測機構の撤去対象（構築士確定、Sub-agent 1 の調査根拠）

### 撤去対象（本番版から削除）

1. **計測バッジ**（`index.html` の `#measBuildBadge` 要素 + `styles.css` の `.meas-build-badge` クラス + renderer.js の `loadAppVersion` 内バッジ表示分岐）
2. **高頻度ラベル発火経路**:
   - `perf:render:duration`（4 箇所、renderer.js 内 `_recordHighFreq` 呼出）
   - `perf:state:notify`（state.js 内 `window._highFreqCounter` 経由）
   - `hall:updatePipTimer:set`（renderer.js 内 `_recordHighFreq` 呼出）
   - `perf:highfreq:summary`（renderer.js 1 秒集計 setInterval）
   - `perf:raf:fire`（renderer.js / timer.js / main.js から発火される全箇所）
   - `perf:raf:summary`（renderer.js 1 秒集計）
   - `perf:ipc:roundtrip`（preload.js `_measuredInvoke` 内）
   - `perf:dom:rebuild`（renderer.js renderTournamentList 等）
   - `perf:long-task`（renderer.js）
   - `perf:memory:rss`（renderer.js 30 秒集計）
   - `perf:interval:fire`（main.js / renderer.js 内 setInterval から発火）
   - `perf:ipc:summary` / `perf:dom:summary` / `perf:subscribe:summary`（renderer.js 30 秒集計）
3. **rc6-meas3 機構**:
   - buffer 拡張 `_isMeasBuildForBuffer` 三項演算（main.js）→ **本番値固定** `ROLLING_LOG_RETENTION_MS = 5 * 60 * 1000` / `ROLLING_LOG_BUFFER_MAX = 5000`
   - `_flushLogsToFile` 関数（main.js）→ **撤去**
   - `meas3:hdmi-snapshot:written` ラベル → **撤去**
   - display-removed/added ハンドラ内の `_flushLogsToFile` 呼出 → **撤去**
4. **`_recordHighFreq` / `_highFreqCounter` 機構**（renderer.js + state.js の `window._highFreqCounter` 共有）→ **撤去**
5. **計測ビルドサフィックス判定**（renderer.js の `/-meas\d*$/` + `/-rc\d+/` バッジ表示分岐）→ **撤去**

### 保持対象（v2.2.1 本番版でも残す、edge 発火低頻度ラベル）

1. **基本ログ機構**:
   - `rolling-current.log`（5 分 buffer、上記の本番値固定）
   - `priority-events.log`（rc6-meas3 で追加、edge 発火ラベルの永続記録）
   - `_initRollingLog` / `_flushRollingLog` / 30 秒 flush タイマー / `_initPriorityLogFile` / `_appendPriorityLog` / `_flushPriorityLog`
   - `Ctrl+Shift+L` ログ採取（op-NN-{ts}.log）
2. **PRIORITY_LOG_LABELS Set**（rc6-meas3 + rc10.1 で拡張、計 13 ラベル全保持）
3. **edge 発火低頻度ラベル**:
   - `display-removed` / `display-added` / `switchOperatorToSolo:enter` / `switchOperatorToSolo:exit` / `switchSoloToOperator:enter` / `switchSoloToOperator:exit`（HDMI 検出系）
   - `preStart:operator:send` / `operator:preStartResync:sent` / `operator:applyPreStartState:apply`（rc5 / rc4 機構）
   - `preStart:cache:merge`（rc7 機構）
   - `operator:applyTimerStateToTimer:skip-reset-during-prestart`（rc8/rc9 ガード）
   - `timer:reset:skip-during-prestart`（rc10 ガード）
   - `hdmi:display-removed:dual-sync-stale` / `hdmi:dialog-blocked:switchOperatorToSolo` / `timer:reset:race-window-entry`（rc10.1 race 観測）
   - `state:transition`（state.js、低頻度）
   - `error:caught:*` 系（全エラーキャッチ経路）
   - `app:ready` / `meas:session:start`（起動情報）
   - `ui:keypress` / `ui:click:major`（ユーザー操作、低頻度）
4. **rc1〜rc10.1 の機能コード全保持**:
   - rc4 `restorePreStart` / `applyOperatorPreStartState` / `handleStartPauseToggle` PRE_START 分岐
   - rc5 main 側 broadcast / `switchSoloToOperator` did-finish-load resync / subscribeStateSync
   - rc7 cache merge / `_appendPriorityLog` lazy init
   - rc8/rc9 applyTimerStateToTimer 4 経路ガード
   - rc10 `reset({force: false})` + 5 経路 multi-layer 防御
   - rc10.1 cache 更新時刻記録 + switchOperatorToSolo 計測 + race window 計測

---

## 【Phase 3 構築士承認】（2026-05-12 確定、前原さん最終 YES）

CC_REPORT.md §4 で提示された 6 項目すべて構築士承認、前原さんの最終 YES も取得済。Phase 3〜5 を順次実行すること。

### 構築士承認結果

| # | CC からの判定依頼 | 構築士判定 | 補足 |
|---|---|---|---|
| 1 | 撤去対象の網羅性（Sub-agent 1 マップ） | ✅ **承認** | 計測バッジ + 高頻度ラベル 14 種 + rc6-meas3 機構 + `_recordHighFreq` + サフィックス判定 + timer.js `_emitRafFire`、追加撤去なし |
| 2 | 保持対象の境界（rolling-log / priority-events / wrapper / edge 発火ラベル）| ✅ **承認** | priority-events.log 機構は完全保持（PRIORITY_LOG_LABELS Set から `meas3:hdmi-snapshot:written` のみ削除して 12 ラベルに、その他 13 ラベル維持）|
| 3 | 既存テスト 96 ファイル去就（保持 85+ / 緩和 5 / 撤去 2）| ✅ **承認** | 保持 / 緩和 / 撤去判定は CC 案通り |
| 4 | 新規テスト `v250-v221-production-release.test.js` 10 件設計 | ✅ **承認** | T1〜T10 妥当、配信版確認の網羅性 OK |
| 5 | CHANGELOG.md v2.2.1 セクション本文 | ✅ **承認** | NEXT_CC_PROMPT.md §「CHANGELOG 確定版」を一字一句反映、絵文字（🛠 / 📦 / 🔍 / ⚠️ / 📝）含む、末尾「配布元: Yu Shitamachi（PLUS2 運営）」を含む |
| 6 | 未使用変数 `_appVersionForBuffer` 追加撤去 | ✅ **承認** | `_isMeasBuildForBuffer` 撤去後は完全に未使用、dead code として撤去 |

### Phase 3〜5 実行の最終承認

- **前原さんの最終 YES 取得済**（2026-05-12）
- **v2.2.1 として全国配信を進めること**を構築士確定
- main マージ + tag v2.2.1 + GitHub Release 公開 + git push を**初めて解禁**

### Phase 3 実装の詳細指示

CC は以下を順次実装:

#### Step 3-1: 計測機構撤去（Sub-agent 1 マップ通り）

- 計測バッジ（HTML L13 + style.css L4141-4161 + renderer.js L7574-7576）撤去
- 高頻度ラベル 14 種の発火経路撤去（renderer.js / state.js / main.js / preload.js / timer.js / dual-sync.js）
- rc6-meas3 機構撤去:
  - `_isMeasBuildForBuffer` / `_appVersionForBuffer` 三項演算撤去 → `ROLLING_LOG_RETENTION_MS = 5 * 60 * 1000` / `ROLLING_LOG_BUFFER_MAX = 5000` 本番値固定
  - `_flushLogsToFile` 関数本体撤去
  - `meas3:hdmi-snapshot:written` ラベル + PRIORITY_LOG_LABELS Set から削除
  - display-removed / display-added ハンドラ内の `_flushLogsToFile` 呼出撤去
- `_recordHighFreq` / `_highFreqCounter` 機構撤去（renderer.js + state.js）
- 1 秒集計 setInterval / 30 秒集計 setInterval 撤去（renderer.js）
- timer.js `_emitRafFire` 関数 + 4 呼出撤去

#### Step 3-2: 保持対象の確認（変更なし）

- rolling-current.log 基本機構（`_initRollingLog` / `_flushRollingLog` / 30 秒 flush タイマー / Ctrl+Shift+L 採取）保持
- priority-events.log 機構保持（PRIORITY_LOG_LABELS 12 ラベル、`_appendPriorityLog` lazy init 含む）
- edge 発火低頻度ラベル全保持（HDMI 検出系 / rc4 / rc5 / rc7 / rc8 / rc9 / rc10 / rc10.1）
- rc1〜rc10.1 機能コード全保持（ガード本体 + 機能機構）
- `_wrappedSetInterval` / `_wrappedRAF` / `_RafLabel` enum 保持（計測ラベル発火行のみ撤去、wrapper 自体は機能実装に必須）

#### Step 3-3: 既存テスト 7 ファイルの調整

- 緩和 5 ファイル: `v233-meas-removal.test.js` / `v234-meas1-labels-and-badge.test.js` / `v235-tournaments-list-storm-fix.test.js` / `v237-production-release.test.js` / `v244-meas3-observation-strengthen.test.js` を CC 案の方針通り書き換え
- 撤去 2 ファイル: `v236-meas-removal.test.js` / `v238-meas2-labels-and-build.test.js` を完全撤去

#### Step 3-4: 新規テスト `tests/v250-v221-production-release.test.js`（10 件、CC 案 T1〜T10 通り）

#### Step 3-5: package.json version bump

- `version`: `2.1.20-rc10.1` → **`2.2.1`**
- `scripts.test` 末尾に `&& node tests/v250-v221-production-release.test.js` 追記
- 既存 80+ テストの `'2.1.20-rc10.1'` リテラル更新（履歴コメント・CHANGELOG 履歴は意図的保持）

#### Step 3-6: CHANGELOG.md v2.2.1 セクション追加

NEXT_CC_PROMPT.md §「CHANGELOG 確定版」を**一字一句反映**して `CHANGELOG.md` の最上位（`[2.1.20-rc10.1]` セクション**上**）に挿入。絵文字含む、末尾「配布元: Yu Shitamachi（PLUS2 運営）」含む。

#### Step 3-7: feature ブランチ作成 + commit + ローカルビルド

- 作業ブランチ: `feature/v2.2.1-production-release`（rc10.1 `26a3767` から分岐）
- commit message: `v2.2.1: 計測機構撤去 + 全国リリース版（rc4〜rc10.1 機能機構完全保持、致命バグ保護 5 件無傷）`
- ローカルビルド: `dist/pokertimerplus-setup-2.2.1.exe` + `dist/latest.yml` 生成

### Phase 4 配信プロセス（main マージ + tag + Release + push 解禁）

#### Step 4-1: main ブランチへマージ

```bash
git checkout main
git pull origin main
git merge --no-ff feature/v2.2.1-production-release -m "Merge v2.2.1 production release (HDMI 抜き差し問題根治 + 重さ根治継承)"
```

#### Step 4-2: tag v2.2.1 作成

```bash
git tag -a v2.2.1 -m "v2.2.1 全国リリース版"
```

#### Step 4-3: GitHub Release 公開

CHANGELOG.md の v2.2.1 セクション全文を Release 本文として、以下を assets として公開:
- `pokertimerplus-setup-2.2.1.exe`
- `latest.yml`

リリースタイトル: `v2.2.1 全国リリース版`

#### Step 4-4: git push origin main + git push origin v2.2.1（最大 2 回試行）

claude-code ハーネスから denied される可能性あり。最大 2 回試行 → 失敗なら Phase 5 へ。

### Phase 5 フォールバック手順（push denied 時）

CC_REPORT.md §7 に NEXT_CC_PROMPT.md §「push denied 時の前原さんへの平易な案内文」を**一字一句**転記。前原さんの手動 push 用 PowerShell コマンド明記。

### 並列 sub-agent / Task 数（Phase 3〜5）

- **Phase 3〜5: 並列 sub-agent 0 体**（構築士確定方針の機械的反映）
- Plan Mode 不要（Phase 3 承認は本セクションで完了）
- TodoWrite 進捗管理は使用推奨

---

## 禁止事項（厳守）

- ❌ Phase 1〜5 のフロー逸脱（Plan Mode 必須、機械的実装に直接進まない）
- ❌ **timer.js / dual-sync.js / preload.js の機能改変**（撤去対象は計測ラベル発火のみ、機能は touch なし）
- ❌ **rc1〜rc10.1 機能機構の touch**（観測ラベル発火コードのみ撤去、ガード本体は保持）
- ❌ 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構の touch
- ❌ **保持対象（edge 発火低頻度ラベル）の撤去**
- ❌ **rolling-current.log / priority-events.log 基本機構**の撤去
- ❌ 並列 sub-agent ≥ 4 体（Phase 1 のみ 3 体、それ以外 0 体）
- ❌ HANDOVER.md / project memory / `docs/CLAUDE_DESIGN_PROMPT.md` の編集
- ❌ スコープ外の追加実装（v2.2.1 リリースに必要なものだけ）

---

## CC_REPORT.md 必須記載項目

1. **§1 サマリ**（バージョン / Phase 状態 / 並列 sub-agent 数 / 修正ファイル数 / テスト件数 / ビルド成果物 / commit hash / main マージ・tag・Release・push 状態）
2. **§2 Phase 1 並列調査結果**: Sub-agent 1 / 2 / 3 報告サマリ + 撤去対象完全リスト + 保持対象完全リスト
3. **§3 Phase 2 統合報告書**: 構築士判定用、Plan Mode stop 状態
4. **§4 構築士承認状況**（このフィールドは構築士の Phase 3 承認後に CC が更新、または構築士の追補で更新）
5. **§5 Phase 3 実装内容**: 撤去 + クリーンアップ + テスト調整 + version bump + CHANGELOG 反映 + commit
6. **§6 Phase 4 配信プロセス**: main マージ / tag / Release / push の各段階の結果
7. **§7 Phase 5 フォールバック手順**（push denied 時、前原さん手動操作の平易な日本語案内）
8. **§8 rc1〜rc10.1 機能機構の完全保持確認**: grep 証跡
9. **§9 致命バグ保護 5 件の完全保持確認**
10. **§10 テスト結果**: 全テスト件数（rc10.1 1116 + 撤去対象テスト調整 + v250 新規 10 件 = 想定件数、PASS / FAIL / SKIP）
11. **§11 ビルド成果物**: `dist/pokertimerplus-setup-2.2.1.exe` + `dist/latest.yml`
12. **§12 副作用評価結果**
13. **§13 並列 sub-agent / Task 数報告**（Phase 1 = 3 体、Phase 3〜5 = 0 体）
14. **§14 構築士への質問・懸念事項**
15. **§15 git 状態**（feature ブランチ commit / main マージ / tag / Release / push の全状態を明記）

### push denied 時の前原さんへの平易な案内文（§7 用）

```
## 全国配信を完了するための最後の手順

CC が自動で push を試行しましたが、安全機構で止められました。前原さんに手動で 1 回 push をお願いします。

### 手順

1. PowerShell を起動（スタートメニューで「PowerShell」と入力）
2. 以下のコマンドを 1 行ずつコピペして Enter:

```powershell
cd "C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock"
git push origin main
git push origin v2.2.1
```

3. 認証画面が出たら GitHub アカウントでログイン（ブラウザが開きます）
4. push 成功すると GitHub の Releases ページに v2.2.1 が表示されます

### push 完了後の確認

- GitHub: <https://github.com/maetomo08020802-eng/PokerTimerPLUS/releases/tag/v2.2.1>
- 数分以内に全国のユーザー PC の自動更新で配信開始
- 既存ユーザーがアプリを再起動すると更新ダイアログが表示されます
```

---

## CC 実行フロー要約（重要）

1. `/clear` → 本プロンプト + CC_REPORT.md + cc-operation-pitfalls.md + root-cause-analysis.md を Read
2. **Phase 1 並列 sub-agent 3 体起動**で最終コード監査
3. CC_REPORT.md §2 / §3 に統合報告書を完全記載
4. **Plan Mode で stop** → 構築士の Phase 3 承認を待つ
5. （構築士承認後）Phase 3 実装（撤去 + クリーンアップ + テスト + commit）
6. Phase 4 main マージ + tag + Release + push 試行（最大 2 回）
7. Phase 5 push denied 時のフォールバック手順を CC_REPORT に明記
8. CC_REPORT.md 完全更新

### 期待される CC アウトプット

構築士が CC_REPORT.md を読むだけで以下が判断可能:

1. **撤去対象が網羅されているか**（dead code 残存なし、保持対象が誤って撤去されていない）
2. **rc1〜rc10.1 機能機構が完全保持されているか**（grep 証跡）
3. **致命バグ保護 5 件が完全保持されているか**
4. **テスト 全件 PASS** + 新規 v250 で配信完成度を verify
5. **main マージ + tag + Release + push 状態**（CC が完遂したか / 手動が必要か）
6. **前原さん手動操作の必要性**（あれば手順 §7 を平易な日本語で）

---

## 補足：本フェーズの位置付け

これは memory `feedback_install_timing.md`「NSIS installer は 30〜60 秒、リリース手順」+ `feedback_cc_harness_meta_safety.md`「main 直 push 二重ロック」+ `feedback_meas_build_workflow.md`「計測機構は本番リリース時に必ず撤去」の集大成。

前原さん指示「最後の確認として、コード確認もしっかり目にお願いします」に応えて、**並列 sub-agent で最終監査 → Plan Mode で stop → 構築士承認 → 実装 + 配信**の慎重なフローを取る。

rc4 から始まった HDMI 抜き差し問題対処の長い旅路の集大成、v2.2.1 として全国のポーカールームに届けます。
