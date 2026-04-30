# Changelog

All notable changes to PokerTimerPLUS+ will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.3.0] - 2026-04-30

### Added
- **自動更新（次回更新版から動作）**: electron-updater 統合済み。GitHub Releases から新版を自動取得 → ダウンロード完了で再起動確認ダイアログ。本リリース v1.3.0 が初回配布のため、次回更新版（v1.3.1 以降）から動作開始します。`package.json` の `build.publish` は GitHub リポジトリ（`maetomo08020802-eng/PokerTimerPLUS`）に紐づけ済み
- **DONE 状態（'finished'）**: 全レベル完走時に明示的な完了ステータス保持。再起動しても完了状態維持、メイン画面に「トーナメント終了」緑系オーバーレイ表示
- **Ctrl+Q 状態別メッセージ**: タイマー RUNNING / PAUSED / BREAK 中は「タイマーが進行中です。本当に終了しますか？」と警告。IDLE / FINISHED は従来メッセージ
- **About 画面に DevTools 注記**: ハウス情報タブ末尾に「F12 / Ctrl+Shift+I で開発者ツールが開きます（開発者向け機能、通常使用には不要）」を追加
- **背景にカスタム画像を設定可能**（C.1.3）: 設定タブ「背景・時計フォント」に 9 種類目「カスタム画像」を追加。PNG / JPEG / WebP（5MB 以下）を OS ダイアログで選択 → 背景に表示。数字視認性確保のため自動で暗くする overlay（弱 30% / 中 50% / 強 70% から選択、既定 50%）。トーナメント単位 + グローバル既定値で保存。base64 data URL 直保存方式
- **休憩中・開始前カウントダウン中のスライドショー機能**（C.1.4）: 設定タブに「休憩中の画像（スライドショー）」セクションを追加。複数画像（最大 20 枚、各 5 MB 以下）を登録 → 休憩時間に画面いっぱいで自動切替表示。**休憩開始から 30 秒経過後に開始** + 0.8 秒のじんわりフェードイン。**右下に縮小タイマー（PIP）** を金色枠で同時表示（小 / 中 / 大の 3 サイズ）。再開 1 分前で自動的に通常画面復帰。手動切替ボタン 2 種（タイマー画面に戻す / スライドショーに戻る）も画面左下に配置。残り 1 分以内は「スライドショーに戻る」が無効化
- **設定ダイアログの拡大とリサイズ強化**（C.1.3-fix2/fix3）: 初期サイズを 1000×700px、最大 95vw×95vh に拡大。右下のリサイズハンドルでドラッグ可能
- **メイン画面のフォント拡大**（C.1.4-fix3）: 「レベル○」表示を約 1.7 倍、アベレージスタック等の右カラム数字を約 1.3 倍、プレイヤー / リエントリー / アドオン人数を 1.5 倍に拡大。アベレージスタックは 8 桁時のみ自動 0.8 倍縮小で右カラム幅を超えない
- **画像データサイズ警告**（C.1.4-fix3）: 全トーナメント画像合計が 150 MB を超えるとアプリ起動時に警告ポップアップを 1 度表示。設定タブの該当セクション見出しに ⚠ アイコンも常時表示
- **設定ダイアログの中身追従リサイズ**（C.1.6）: ダイアログを縦に伸ばすと中身（タブ内のフォーム）も追従して見える範囲が増える。`<dialog>` 内側に wrapper を挟む方式で ✕ボタン / リサイズハンドルの挙動を完全維持
- **NEXT BREAK IN ↔ TOTAL GAME TIME 自動切替**（C.1.6）: 残りのブレイクがすべて消化されると自動的に「TOTAL GAME TIME（トーナメントスタートからの累積時間）」表示に切替
- **NEXT BREAK IN タイマーの拡大**（C.1.5-patch）: 右上カラムのタイマー表示を 1.4 倍に拡大（視認性向上）
- **TOTAL PRIZE POOL の 7 桁時自動縮小**（C.1.7-patch）: 7 桁以上（¥1,000,000 以上）になった時のみ font-size を 0.85 倍に縮小して見切れ防止

### Fixed
- **音欠落バグ（重大）**（C.1.7）: 長時間 PAUSED 後の resume / 別ウィンドウ復帰 / PC スリープ復帰等で AudioContext が suspend 状態に遷移し、警告音 / カウントダウン音 / ブレイク終了音が鳴らなくなる現象を修正。`audio.js _play()` 冒頭で suspend 検出 + resume を追加することで全音発火パスを 1 箇所修正で一括解決
- **トーナメント途中のアプリ再起動でランタイムデータ消失（重大）**（C.1.8）: プレイヤー人数 / リエントリー / アドオン人数等のランタイムデータが `tournaments` テーブルに永続化されていなかったため、アプリ終了で消失していた問題を修正。runtime フィールド追加 + 8 箇所のミューテーション関数で都度永続化（debounce 500ms）+ 起動時復元
- **README に Windows SmartScreen 警告対応手順追加**（C.1.5）: 配布版を初回起動するユーザーが戸惑わないよう、3 ステップの起動手順 + 「外部通信なし」明記

### Fixed
- **audit 残課題 3 件**（C.1.1）: switching ガード（タイマー #20）/ preset 削除警告（UX #38）/ ID 衝突防止（エッジ #19）
- **新規トーナメント作成 → 複製して編集の readonly 残存バグ**（C.1.2-bugfix）: ensureEditorEditableState の builtin 保護内蔵化 + 多点防御拡張

### Documentation
- `CHANGELOG.md`: v1.3.0 リリースノート
- `package.json`: build.publish 設定は **GitHub リポジトリ作成後に追加予定**（C.1.2-followup でいったん削除）

### Tests
- audit-residuals.test.js（8 件）/ new-tournament-edit.test.js（8 件）/ v130-features.test.js（12 件）/ c13-bg-image.test.js（19 件）/ c14-slideshow.test.js（24 件）/ c16-features.test.js（8 件）/ c17-audio-resume.test.js（6 件）/ c18-runtime-persistence.test.js（6 件）追加
- 合計 138 件全 PASS

---

## [1.2.0] - 2026-04-30

STEP 10 完了マイルストーン。ゲーム種拡張・MIX 編集・致命バグ修正・UI 全面刷新を含むメジャーアップデート。

### Added

- **新ゲーム種**: Limit Hold'em / MIX (10-Game) / その他（自由記入）
- **構造型 5 種**: BLIND / LIMIT_BLIND / SHORT_DECK / STUD / **MIX**（新規）
- **MIX レベルごと自由編集**: 「複製して編集」フローで各レベルのゲーム種を 10 種から自由選択（NLH/PLO/PLO8/Limit Hold'em/Omaha Hi-Lo/Razz/Stud/Stud Hi-Lo/Short Deck/Big O Limit）+ 動的フィールド切替 + 値継承
- **MIX ゲーム数自動カウント**: メイン画面の「MIX (○-Game) — 現在: NLH」の○がユニーク subGameType 数で動的算出
- **同梱プリセット 4 → 8 種**: Limit 標準 / Short Deck 標準 / Stud 標準 / MIX 標準（10-Game）追加
- **「ブレイク終了後に一時停止」**機能（pauseAfterBreak）
- **PAUSED 3 択モーダル**: リセット / 経過保持で適用 / 構造のみ適用（一時停止維持）
- **テンプレート紐づけ表示**: 「『金曜タワー』で使用中」「未使用」「『〇〇』他 N 件で使用中」を ドロップダウンに表示
- **powerSaveBlocker**: タイマー RUNNING / PRE_START / BREAK 中にディスプレイスリープを防止、PAUSED / IDLE で解除
- **JSON import の UTF-8 BOM 対応**: ファイル / クリップボード両方
- **テロップ 200 文字上限**: HTML maxlength + JS sanitize の二重防御
- **トーナメント削除の二重起動防止**: in-flight フラグ
- **数字縮小ロジック**: data-max-digits でカード単位統一縮小（不揃い問題解消）
- **4 桁以下の項目間隔均等**: data-max-digits ≤ 4 で `space-around`、5+ 桁は既存 `space-between`
- **ensureEditorEditableState ヘルパ**: 「複製して編集」直後の readonly 残存を 4 重保証で防止

### Changed

- **数字フォント**: Oswald 700 → **Barlow Condensed 700**（細身、視認性向上、SIL OFL 1.1）
- **アプリアイコン**: 「P」ロゴ → **黒背景 + 白「20:40」7-segment LCD 風**（デジタル時計風、フォント不使用）
- **用語変更**（ブラインド構造文脈のみ）:
  - 「プリセット」→「テンプレート」
  - 「プリセット名」→「ブラインド構造名」
  - 「ユーザープリセット: M/100 件」→「保存済みテンプレート: M/100 件」
  - 背景プリセット / 賞金プリセット / 色プリセットは無変更
- **テンプレ名 maxlength**: 40 → 50 文字（HTML + JS 二重防御）

### Fixed

- **【致命】8-8 — PAUSED で「保存して適用」で tournamentRuntime（プレイヤー人数・リエントリー・アドオン・バイイン）が消失するバグ**: `handleReset()` を 2 関数に責任分離（`resetBlindProgressOnly()` / `handleReset()`）、不変条件「ブラインド構造を変えても runtime は消えない」を確立
- **timerState 上書き race**: タイマー RUNNING 中のプリセット保存でタイマーが巻き戻る race を `persistActiveTournamentBlindPresetId` の payload から timerState を destructure 除外することで解決
- **「複製して編集」後の readonly 残存**: 名前・BigBet 等の数値が編集できない問題を `ensureEditorEditableState()` ヘルパ + 4 重保証で根本解決
- **自由記入欄が常時表示されるバグ**: CSS `.form-row { display: flex }` が `[hidden]` 属性を上書きする問題に対し `.form-row[hidden] { display: none }` で根本解決
- **ブレイクラベル「ブレイク中」（薄い青カタカナ）を削除**: 明色背景でコントラスト低下する問題を `display: none` で安全に非表示化（HTML 残置で復元容易）
- **大きい数値（7 桁以上）の重なり**: Barlow Condensed フォント置換 + カード単位 data-max-digits 縮小で解決
- **preset name の JS sanitize ギャップ**: 50 文字 slice を main.js `presets:saveUser` に追加

### Performance

- ブラインド構造編集テーブルの描画を **DocumentFragment で一括挿入**（O(N²) reflow → O(N)）。50+ levels で体感改善

### Security

- powerSaveBlocker IPC（`power:preventDisplaySleep` / `power:allowDisplaySleep`）の単一 blocker ID 管理 + アプリ終了時の確実な解放
- `preset name` / marquee text の IPC 経由攻撃防御（巨大文字列の slice 防御）

### Documentation

- `docs/specs.md`: STEP 10 機能追加を網羅記載
- `skills/timer-logic.md`: 6 つの不変条件（A〜F）を明文化
- `CLAUDE.md`: isUserTypingInInput / ensureEditorEditableState / tournamentRuntime 不変条件の運用ルール追加
- `CREDITS.md`: Barlow Condensed フォント追加、App Icon オリジナル制作の記載

### Tests

合計 **47 テスト**（既存 7 + 新規 40）が静的解析・回帰防止を担保:
- `data-transfer.test.js`（7）
- `runtime-preservation.test.js`（6）— 致命バグ 8-8 リグレッション防止
- `audit-fix.test.js`（9）
- `paused-flow.test.js`（9）
- `race-fixes.test.js`（5）
- `light-todos.test.js`（4）
- `editable-state.test.js`（7）

---

## [1.1.0] - 2026-04 (Previous Release)

STEP 9 完了。左上ロゴ差替機能 + アプリアイコン（P ロゴ）。配布リリース。

### Added
- 左上ロゴ表示（任意の店舗ロゴをアップロード可能）
- アプリアイコン（タイマー＋P）

---

## [1.0.0] - 2026-04 (Initial Release)

STEP 1〜8 完了。基本機能リリース。

### Added
- ブラインドタイマー（カウントダウン + レベル進行）
- ブラインド構造管理（同梱プリセット 4 種 + ユーザーカスタム）
- 通知音（5 種類、商用無料・効果音ラボ提供）
- スタートカウントダウン
- プレイヤー / 賞金管理（プール / アベスタック / PAYOUTS）
- 設定永続化（electron-store 経由）
- 配布ビルド（Windows NSIS インストーラ + macOS DMG）

---

製作: Yu Shitamachi（PLUS2 運営）
配布: 全国のポーカールームへの無料配布
