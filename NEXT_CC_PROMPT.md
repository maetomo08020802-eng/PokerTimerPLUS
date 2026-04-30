# v2.0.0 STEP 5: HDMI 抜き差し追従【承認②対象】

## 状況
v2.0.0 STEP 0+1+2+3+4 完了。承認①の PR #1 は main マージ済み。STEP 3+4 は feature/v2.0.0 にコミット蓄積中。
本 STEP 5 は **HDMI 抜き差し追従（v2.0.0 最後のコア技術）+ AudioContext 再初期化対応**（CC が STEP 0 で警告した懸念事項、`docs/v2-design.md` §5 リスク 3 / §7）。
完了時に **承認②の PR を作成**（feature/v2.0.0 → main、STEP 3+4+5 まとめて）。

参照ドキュメント:
- `skills/v2-dual-screen.md` §3（HDMI 抜き差し追従）
- `skills/cc-operation-pitfalls.md`（公式準拠の絶対遵守事項、本フェーズ開始時に必ず Read）
- `docs/v2-design.md` §5 リスク 3 + §7（AudioContext 再初期化警告）

---

## ⚠️ スコープ制限（厳守）

**本 STEP 5 で実行するのは以下のみ:**
1. `src/main.js` に `screen.on('display-added')` / `screen.on('display-removed')` ハンドラ追加
2. **display-removed**: hallWindow が抜けた display にあれば close、operator を operator-solo モードに切替
3. **display-added**: 2 画面以上検出 → `chooseHallDisplayInteractive` 再呼出 → ホール側決定 → createHallWindow + state 再同期、operator を operator モードに切替
4. ウィンドウ役割切替（operator ↔ operator-solo）は **ウィンドウ再生成方式**（`additionalArguments` は process.argv に乗るため reload では role 変更不可、再生成が必須）
5. **AudioContext 再初期化対応**: operator-solo 切替時、新しい renderer で audio.js が初期化される。C.1.7 の `_play()` 内 resume を踏襲、明示的な静的解析テストで担保
6. **state 同期維持**: タイマー進行は main プロセスで持続、新しいウィンドウ起動時に既存の subscribe 経路で state 復元（ユーザーから見て中断ゼロ）
7. `tests/v2-display-change.test.js`（新規、5〜8 件）
8. 既存 162 テスト全 PASS 維持
9. **承認②の PR 作成**（feature/v2.0.0 → main、STEP 3+4+5 をまとめる）

**禁止事項:**
- 単画面モード（HDMI なし環境）の挙動変更
- 既存 162 テストの skip / 無効化
- 致命バグ保護 5 件への影響変更
- **並列 sub-agent / Task は最大 3 体まで**（`skills/cc-operation-pitfalls.md` §1.1）
- **「念のため」コード追加禁止**（`skills/cc-operation-pitfalls.md` §1.2）
- ポーリング禁止、必ず `display-added` / `display-removed` のイベント駆動のみ
- ホール側ウィンドウから main への送信（hall は purely consumer 維持）
- `<dialog>` flex 禁止
- CSP `script-src 'self'` 不変

---

## Fix 1: main.js の display イベント購読

```js
function setupDisplayChangeListeners() {
  screen.on('display-removed', async (event, removedDisplay) => {
    if (!hallWindow || hallWindow.isDestroyed()) return;
    const hallBounds = hallWindow.getBounds();
    // hallWindow が抜けた display 上にあったか判定
    if (isWindowOnDisplay(hallBounds, removedDisplay)) {
      hallWindow.close();
      hallWindow = null;
      _dualStateCache = clearHallSubscription();   // hall 側 broadcast 停止
      await switchOperatorToSolo();
    }
  });

  screen.on('display-added', async () => {
    const displays = screen.getAllDisplays();
    if (displays.length < 2) return;
    if (hallWindow && !hallWindow.isDestroyed()) return;   // 既に 2 画面
    const hallId = await chooseHallDisplayInteractive(displays);
    if (hallId == null) return;   // キャンセル時は単画面のまま
    const hallDisplay = displays.find((d) => d.id === hallId);
    await switchSoloToOperator(hallDisplay);
  });
}
```

`isWindowOnDisplay(bounds, display)` ヘルパで「window がこの display 上に位置するか」判定。`bounds.x / y` と `display.bounds` で重なり判定。

---

## Fix 2: switchOperatorToSolo / switchSoloToOperator（ウィンドウ再生成）

```js
async function switchOperatorToSolo() {
  if (!operatorWindow || operatorWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  operatorWindow.close();
  operatorWindow = null;
  // タイマー進行は main で持続、新しいウィンドウは subscribe で state 復元
  createOperatorWindow(display, true);   // isSolo=true、role=operator-solo
}

async function switchSoloToOperator(hallDisplay) {
  if (!operatorWindow || operatorWindow.isDestroyed()) return;
  const operatorDisplay = screen.getPrimaryDisplay();
  operatorWindow.close();
  operatorWindow = null;
  createOperatorWindow(operatorDisplay, false);   // isSolo=false、role=operator
  createHallWindow(hallDisplay);   // role=hall
}
```

注意:
- `additionalArguments` は process.argv に乗るため、`webContents.reload()` では role 変更不可
- `BrowserWindow` の再生成が必須
- 再生成中の数百ミリ秒間、ユーザーから見て一瞬黒画面 or 既存ウィンドウ消失 → 許容範囲
- タイマー進行は main プロセスで持続、新しいウィンドウは `dual-sync.js` の `initDualSyncForHall` or 既存 subscribe 経路で state 復元
- 切替閾値: skills/v2-dual-screen.md §3.1 の **2 秒以内**（ウィンドウ再生成 ~250ms × 2 = ~500ms、余裕で達成）

---

## Fix 3: AudioContext 再初期化対応

C.1.7 修正により `audio.js` の `_play()` 内で AudioContext が suspend なら自動 resume する設計。
operator-solo 切替時、新しい renderer で `audio.js` が initAudio を実行 → 最初の音発火時に自動 resume。

**追加の対策**: 切替直後に `ensureAudioReady()` を明示呼出する経路を確保（renderer.js の DOMContentLoaded ハンドラに追加 or 既存 initialize() 内）。

```js
// renderer.js の起動部
if (window.appRole === 'operator-solo') {
  initialize();
  ensureAudioReady();   // ★ 切替後の音欠落防止
}
```

これで HDMI 抜き差し直後に音が鳴らない期間を最小化。テスト T6 で静的担保。

---

## Fix 4: state 同期の維持

main プロセスの `_dualStateCache` は hall 抜き差しでも維持。
operator 再生成時、既存の `state.js` subscribe + 既存 IPC ハンドラで state を main から取得 → 描画。

operator-solo モードでは `dual-sync` を使わず、既存の v1.3.0 経路で state を扱う（`store.get('activeTournamentId')` 等）。

注意:
- hall 切替時の `_dualStateCache` クリア / 維持の判断: 残しても害なし（次の hall 起動時に再利用可能）
- ただし stale な timerState を hall に送らないよう、hall window が destroyed なら `_broadcastDualState` 内で no-op（既存実装）

---

## Fix 5: `tests/v2-display-change.test.js` 新規作成（5〜8 件）

静的解析ベース:
- T1: `setupDisplayChangeListeners` 関数が定義され、`screen.on('display-removed')` と `screen.on('display-added')` の両方に購読
- T2: `display-removed` ハンドラで `hallWindow` の close + `switchOperatorToSolo` 呼出
- T3: `display-added` ハンドラで `displays.length < 2` 早期 return + `chooseHallDisplayInteractive` 再呼出
- T4: `switchOperatorToSolo` / `switchSoloToOperator` がウィンドウ close → 再生成パターン（`webContents.reload` を使わない）
- T5: `isWindowOnDisplay` ヘルパが `bounds.x / y` と `display.bounds` を比較
- T6: renderer.js の `operator-solo` 起動時に `ensureAudioReady` が呼ばれる（HDMI 抜き差し後の音欠落対策）
- T7: ポーリング不使用（`setInterval` で displays を監視するコードがない、イベント駆動のみ）
- T8: `_broadcastDualState` の hall 不在 no-op ガードが維持されている（既存 STEP 2 実装、再確認）

---

## Fix 6: 既存 162 テスト全 PASS 維持

```bash
npm test
# Summary: 162 + N (>=5) = >=167 passed / 0 failed
```

1 件でも FAIL したら**即停止**、CC_REPORT に「何が壊れたか」「致命バグ保護への影響有無」明記。

---

## Fix 7: コミット & push & 承認②の PR 作成

```bash
git add -A
git status
git -c user.name="Yu Shitamachi" -c user.email="ymng2@icloud.com" commit -m "v2.0.0 STEP 5: HDMI 抜き差し追従 + AudioContext 再初期化対応"
git push origin feature/v2.0.0

# 承認②の PR 作成（STEP 3+4+5 まとめて）
gh pr create \
  --base main \
  --head feature/v2.0.0 \
  --title "v2.0.0 STEP 3+4+5: PC 側 UI 分離 + モニター選択 + HDMI 抜き差し追従" \
  --body "$(cat <<'EOF'
## サマリ
v2.0.0 大改修の 2 つ目の PR。STEP 3（PC 側 UI 分離）+ STEP 4（起動時モニター選択）+ STEP 5（HDMI 抜き差し追従 + AudioContext 再初期化）をまとめてマージ。

## 完了 STEP
- STEP 3: CSS [data-role] 本格分離 + renderer.js 主要 handler 14 箇所に hall ガード + バッジ削除 + operator-action 通知有効化
- STEP 4: src/renderer/display-picker.html / .js + main.js 起動シーケンス + 前回選択保存（参考情報）
- STEP 5: screen.on('display-added' / 'display-removed') イベント駆動追従 + ウィンドウ再生成方式で role 切替 + AudioContext 再初期化対応

## 動作確認
- 単画面 PC: v1.3.0 と完全同等（operator-solo モード）
- 2 画面環境: 起動時ダイアログ → 選択 → 2 画面同期動作
- 営業中 HDMI 抜き → 単画面復帰、タイマー進行中断なし、音継続
- HDMI 再接続 → ダイアログ → 2 画面復帰、状態自動復元

## 致命バグ保護
- 5 件すべて完全維持（resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState / AudioContext resume / runtime 永続化）
- T7（v2-role-guard）で「致命バグ関連関数に hall ガードがない」を静的担保
- T6（v2-display-change）で「HDMI 抜き差し後の AudioContext 再初期化」を静的担保

## 残作業
- STEP 6: テスト拡充
- STEP 7: 最終検証 + version bump【承認③】
EOF
)"
```

PR URL を CC_REPORT に記載すること。

---

## Fix 8: CC_REPORT.md（公式準拠フォーマット）

CC_REPORT.md を STEP 5 完了報告に書き換え:
1. **サマリ**: display イベント購読 / ウィンドウ再生成切替 / AudioContext 対応 / テスト件数 / PR URL
2. **修正ファイル**: 表形式
3. **主要変更点**: コード抜粋 5 行以内/件
4. **致命バグ保護への影響評価**: 5 件すべて「影響なし / 要注意 / 影響あり」明記（必須）
5. **並列起動した sub-agent / Task 数**（0〜3 体は OK、4 体以上は警告）
6. **構築士への質問**（あれば、なければ省略）
7. **オーナー向け確認**:
   - 単画面 PC で起動 → v1.3.0 と完全同等
   - 2 画面環境（あれば）→ 起動時ダイアログ → 選択 → 2 画面表示
   - **営業中 HDMI 抜き → 単画面復帰、タイマー継続、音継続**（**承認②の判定軸**）
   - **HDMI 再接続 → ダイアログ → 2 画面復帰**（**承認②の判定軸**）
   - PR の URL（前原さんがブラウザで開いてマージ操作）

---

## 維持事項

- 既存 162 テスト全 PASS 維持（+ STEP 5 新規 5〜8 件追加）
- **`operator-solo` モード（単画面）は v1.3.0 と完全同等**
- 致命バグ保護 5 件すべて完全維持:
  - `resetBlindProgressOnly`（C.2.7-A）
  - `timerState` destructure 除外（C.2.7-D Fix 3）
  - `ensureEditorEditableState` 4 重防御
  - **AudioContext resume in `_play()`（C.1.7、本 STEP で再初期化対応強化）**
  - runtime 永続化 8 箇所（C.1.8）
- カード幅 / Barlow Condensed / `<dialog>` flex 禁止
- `skills/v2-dual-screen.md`「§5 禁止事項」全項目
- `skills/cc-operation-pitfalls.md`「§1 絶対禁止事項」全項目
- CSP `script-src 'self'` 不変
- ポーリング禁止、イベント駆動

---

## 完了条件

- [ ] `feature/v2.0.0` ブランチで STEP 5 のコミット作成 + push
- [ ] main.js に `setupDisplayChangeListeners` + `switchOperatorToSolo` + `switchSoloToOperator`
- [ ] renderer.js の `operator-solo` 起動時に `ensureAudioReady` 明示呼出
- [ ] `tests/v2-display-change.test.js`（新規）5〜8 件
- [ ] `npm test` で **既存 162 + 新規 5〜8 = >=167 件すべて PASS**
- [ ] 致命バグ保護 5 件すべて影響なし確認
- [ ] 並列 sub-agent / Task 数を CC_REPORT で報告（4 体以上禁止）
- [ ] **承認②の PR 作成完了**（feature/v2.0.0 → main、STEP 3+4+5 まとめ）
- [ ] CC_REPORT.md に PR URL 記載
