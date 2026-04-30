# v2.0.0 STEP 2: 2 画面間の状態同期【承認①対象】

## 状況
v2.0.0 STEP 1 完了済（`feature/v2.0.0` ブランチ作成、ウィンドウ生成 2 関数分離、`additionalArguments` で role 渡し、`data-role` 属性付与、CSS バッジ最小サンプル、build.files に `!scripts/**/*` 追加、138 テスト全 PASS、push 完了 / PR 未作成）。
本 STEP 2 から **2 画面間の状態同期（コア技術）** を実装する。完了時に承認①の PR を作成する。

参照ドキュメント:
- `docs/v2-design.md` §3（状態同期に必要な情報の最小セット 9 種類）
- `skills/v2-dual-screen.md` §2（状態同期の精度基準）+ §1.3（画面間通信の節度）+ §5（禁止事項）+ §7（実装上のヒント）
- **`skills/cc-operation-pitfalls.md`（公式ドキュメント準拠の絶対遵守事項、本フェーズ開始時に必ず Read）** ★追加

---

## ⚠️ スコープ制限（厳守）

**本 STEP 2 で実行するのは以下のみ:**
1. `src/main.js` に状態キャッシュ + broadcast 関数追加（main プロセスを単一の真実源とする）
2. `src/main.js` に新規 IPC ハンドラ群追加: `dual:state-sync` / `dual:operator-action`（双方向に必要な最小チャンネル）
3. `src/preload.js` に `window.api.dual.*` グループ追加（`subscribeStateSync` / `notifyOperatorAction` 等）
4. `src/renderer/dual-sync.js`（新規）作成、ホール側で main からの state を受信 → 既存 `state.js` の `setState` で適用
5. `src/renderer/renderer.js` の起動部に role 判定追加: `role === 'hall'` なら dual-sync 起動、`role === 'operator'` なら既存ロジックに加えて main への operator-action 通知、`role === 'operator-solo'` なら既存ロジックそのまま
6. 既存 138 テスト全 PASS 維持
7. v2 専用テスト最小追加（`tests/v2-dual-sync.test.js` 新規、IPC ハンドラ存在 / subscribe ロジック / 差分送信パターンの静的解析、5〜8 件程度）
8. STEP 2 完了でコミット & push、**承認①の PR を `feature/v2.0.0` → `main` で作成**

**禁止事項:**
- ホール側 / PC 側の UI 完全分離（STEP 3 で行う、本 STEP では同期の仕組みのみ）
- モニター選択ダイアログ（STEP 4）
- HDMI 抜き差し追従（STEP 5）
- AudioContext 関連の変更（STEP 5、`docs/v2-design.md` §7 警告事項）
- 単画面モード（`operator-solo`）の挙動変更（v1.3.0 と完全同等を維持）
- 既存テストの skip / コメントアウト / 無効化
- 致命バグ保護 5 件への影響変更
- 「ついでに既存リファクタ」一切禁止
- ポーリング（定期的な全状態取得）禁止、必ずイベント駆動
- ホール側からの操作リクエスト送信禁止（hall は purely consumer、ただし STEP 3 で確定）
- CSP `script-src 'self'` 不変
- **並列 sub-agent / Task は最大 3 体まで**（公式 Agent Teams 推奨、skills/cc-operation-pitfalls.md §1.1）
- **「念のため」コード追加禁止**（skills/cc-operation-pitfalls.md §1.2）
- **同じバグで 2 回修正試行する前に context 肥大化を疑う**（skills/cc-operation-pitfalls.md §1.4）

---

## Fix 1: main.js に状態キャッシュ + broadcast 関数追加

main プロセスを single source of truth とする最小実装。

```js
// 状態キャッシュ（v2 で hall に broadcast する用、operator-solo モードでは未使用）
const _dualStateCache = {
  timerState: null,        // { status, currentLevelIndex, ... }
  structure: null,         // { levels: [...] }
  displaySettings: null,
  marqueeSettings: null,
  tournamentRuntime: null,
  tournamentBasics: null,  // { name, subtitle, titleColor, venueName, blindPresetId }
  audioSettings: null,
  logoUrl: null,
};

function _broadcastDualState(channel, payload) {
  if (!_hallWindow || _hallWindow.isDestroyed()) return;
  _hallWindow.webContents.send(channel, payload);
}

// 既存の tournaments:setTimerState / setDisplaySettings 等のハンドラ末尾に
// _broadcastDualState('dual:state-sync', { kind: 'timerState', value: ... }) を追加
```

ポイント:
- `_hallWindow` が無い（単画面モード）場合は no-op、`operator-solo` の挙動に影響しない
- 既存 IPC ハンドラの payload 構造には**一切触らない**（致命バグ保護 C.2.7-D の `timerState` destructure 除外を踏襲）
- broadcast は差分のみ（kind フィールドで「何が変わったか」を伝える）、全状態を毎回送信しない

---

## Fix 2: main.js に新規 IPC ハンドラ追加

```js
// hall 起動時の初期同期: 全キャッシュを 1 回だけ送る
ipcMain.handle('dual:state-sync-init', async () => {
  return { ..._dualStateCache };  // hall 側は受信して setState で一括適用
});

// operator → main → hall の操作リクエスト中継
ipcMain.handle('dual:operator-action', async (event, { action, payload }) => {
  // 既存ハンドラに転送
  // 例: action === 'timer:start' なら既存の timer:start ハンドラを呼ぶ
  //     action === 'preset:apply' なら既存の preset:apply ハンドラを呼ぶ
  // 既存ロジックを変更せず、薄い wrapper として実装
  return await _routeOperatorAction(action, payload);
});
```

`_routeOperatorAction` は既存の IPC handler を呼ぶ薄い router。既存ハンドラ自体には触らない。

---

## Fix 3: preload.js に `window.api.dual.*` 追加

```js
// 既存 contextBridge.exposeInMainWorld('api', { ... }) の中に追加
contextBridge.exposeInMainWorld('api', {
  // ... 既存の api 群 ...
  dual: {
    subscribeStateSync: (callback) => {
      ipcRenderer.on('dual:state-sync', (_event, payload) => callback(payload));
    },
    fetchInitialState: () => ipcRenderer.invoke('dual:state-sync-init'),
    notifyOperatorAction: (action, payload) => ipcRenderer.invoke('dual:operator-action', { action, payload }),
  },
});
```

---

## Fix 4: src/renderer/dual-sync.js 新規作成

ホール側で main からの state を受信 → 既存 state.js の setState で適用。

```js
// dual-sync.js（新規、~100 行想定）
import { setState, getState } from './state.js';

export async function initDualSyncForHall() {
  if (window.appRole !== 'hall') return;  // 安全側ガード

  // 初期状態を 1 回だけ取得
  const initial = await window.api.dual.fetchInitialState();
  if (initial.timerState)  setState({ timerState: initial.timerState });
  if (initial.structure)    setState({ structure: initial.structure });
  // ... 9 種類すべて適用 ...

  // 以降の差分を購読
  window.api.dual.subscribeStateSync((diff) => {
    if (diff.kind === 'timerState')         setState({ timerState: diff.value });
    else if (diff.kind === 'structure')      setState({ structure: diff.value });
    // ... 9 種類すべて分岐 ...
  });
}
```

注意:
- ホール側はローカルでの timer.js による performance.now ベース計算で「±100ms 以内」を達成（v2-dual-screen.md §2.1）
- main からは「基準時刻 + 状態フラグ」のみ送る、毎秒の timer 値を送らない（リスク 2 対処）
- 既存の state.js / timer.js は無変更、上に薄い同期レイヤを乗せるだけ

---

## Fix 5: renderer.js の起動部に role 判定追加

renderer.js の最上部 or DOMContentLoaded ハンドラの中で:

```js
const role = window.appRole || 'operator-solo';

if (role === 'hall') {
  // ホール側: dual-sync 起動 + 既存の表示更新ロジックは動かす（state.js の subscribe 経由）
  // 操作系イベントリスナは登録しない（STEP 3 で role ガードを追加するが、本 STEP は最小実装）
  await initDualSyncForHall();
  initDisplayLogic();  // 既存の renderTimer / applyTournament 等を起動
} else if (role === 'operator') {
  // PC 側: 操作 UI 起動 + main への operator-action 通知経路を有効化
  // タイマー進行は main で実行されるので、PC 側の表示用ローカル timer は無効化（STEP 3 で完全分離）
  initOperatorLogic();
} else {
  // operator-solo（単画面モード）: v1.3.0 と完全同等
  initSoloLogic();  // 既存のロジックそのまま
}
```

実際の関数名・分岐実装は CC 判断、ただし「**operator-solo は v1.3.0 と完全同じ動作**」が絶対条件。

---

## Fix 6: 既存 138 テスト全 PASS 維持

```bash
npm test
# Summary: 138 passed / 0 failed を確認
```

1 件でも FAIL したら**即停止**、CC_REPORT に「何が壊れたか」「致命バグ保護への影響有無」明記。

---

## Fix 7: v2 専用テスト最小追加

`tests/v2-dual-sync.test.js` を新規作成、静的解析ベース（既存パターン踏襲）。

カバー対象（5〜8 件、STEP 6 でフル展開予定）:
- T1: main.js に `_dualStateCache` / `_broadcastDualState` が定義されている
- T2: main.js に `dual:state-sync-init` ハンドラが ipcMain.handle で登録されている
- T3: main.js に `dual:operator-action` ハンドラが登録されている
- T4: preload.js に `dual.subscribeStateSync` / `fetchInitialState` / `notifyOperatorAction` が含まれる
- T5: dual-sync.js に `initDualSyncForHall` がエクスポートされている
- T6: dual-sync.js が `window.appRole !== 'hall'` ガードを持つ
- T7: renderer.js が `role === 'hall' / 'operator' / 'operator-solo'` の 3 分岐を持つ
- T8: 既存 `timerState` destructure 除外（C.2.7-D Fix 3）の payload 構造に変更がない（既存テスト + 静的検査）

---

## Fix 8: コミット & push & 承認①の PR 作成

```bash
git add -A
git status
git -c user.name="Yu Shitamachi" -c user.email="ymng2@icloud.com" commit -m "v2.0.0 STEP 2: 2 画面間の状態同期"
git push origin feature/v2.0.0
```

PR 作成（**承認①対象**）:

```bash
gh pr create \
  --base main \
  --head feature/v2.0.0 \
  --title "v2.0.0 STEP 0+1+2: 2 画面対応（設計調査 + ホール側ウィンドウ + 状態同期）" \
  --body "$(cat <<'EOF'
## サマリ
v2.0.0 大改修の最初の PR。STEP 0（設計調査）+ STEP 1（ホール側ウィンドウ最小骨格）+ STEP 2（2 画面間の状態同期）をまとめてマージ。

## 完了 STEP
- STEP 0: docs/v2-design.md / scripts/_probes/v2-probe.js
- STEP 1: src/main.js のウィンドウ分離 / data-role バッジ / build.files 修正
- STEP 2: 2 画面間の状態同期（main を真実源、hall は purely consumer、operator-solo は v1.3.0 と完全同等）

## 動作確認
- 単画面 PC: v1.3.0 と完全同じ動作（operator-solo モード）
- 2 画面環境: PC 側で操作 → ホール側に ±100ms 以内で同期反映

## 致命バグ保護
- 5 件すべて完全維持（resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState / AudioContext resume / runtime 永続化）

## 残作業
- STEP 3: PC 側 UI の完全分離
- STEP 4: モニター選択ダイアログ
- STEP 5: HDMI 抜き差し追従【承認②】
- STEP 6: テスト拡充
- STEP 7: 最終検証 + version bump【承認③】
EOF
)"
```

PR URL を CC_REPORT に記載すること。

---

## Fix 9: CC_REPORT.md（簡潔版）

CC_REPORT.md を STEP 2 完了報告に書き換え:

1. **サマリ**: 状態キャッシュ / IPC ハンドラ / preload API / dual-sync 起動 / role 分岐 / 138+α テスト全 PASS / PR 作成完了 + URL
2. **主要変更点**: コード抜粋 5 行以内/件
3. **致命バグ保護への影響評価**: 5 件すべて影響なしの確認（必須セクション）
4. **並列起動した sub-agent / Task 数の報告**（0〜3 体は OK、4 体以上は警告 + 設計見直し提案）
5. **構築士への質問**（あれば、なければ省略）
6. **オーナー向け確認**:
   - 単画面 PC で起動 → v1.3.0 と完全同じ動作（変化なし）
   - 2 画面環境（あれば）→ PC 側で操作したら、ホール側に同期反映されるか
   - PR の URL（前原さんがブラウザで開いてマージ操作）

---

## 維持事項

- 既存 138 テスト全 PASS 維持（+ v2 専用テスト最小 5〜8 件追加）
- **`operator-solo` モード（単画面）は v1.3.0 と完全同等**
- 致命バグ保護 5 件すべて完全維持
- カード幅 / Barlow Condensed / `<dialog>` flex 禁止
- skills/v2-dual-screen.md「§5 禁止事項」全項目
- CSP `script-src 'self'` 不変
- ポーリング禁止、イベント駆動

---

## 完了条件

- [ ] `feature/v2.0.0` ブランチで STEP 2 のコミット作成
- [ ] main.js に `_dualStateCache` + `_broadcastDualState` + `dual:state-sync-init` + `dual:operator-action`
- [ ] preload.js に `window.api.dual.*` グループ
- [ ] src/renderer/dual-sync.js（新規）作成
- [ ] renderer.js に role 3 分岐（hall / operator / operator-solo）
- [ ] tests/v2-dual-sync.test.js（新規）5〜8 件
- [ ] `npm test` で **既存 138 + 新規 5〜8 件すべて PASS**
- [ ] push 完了 + **承認①の PR 作成完了**（PR URL 取得）
- [ ] CC_REPORT.md に PR URL 記載
- [ ] 致命バグ保護 5 件すべて影響なし確認

---

## 承認①について

CC が PR 作成完了したら、構築士が CC_REPORT を採点 → 前原さんに以下を案内:
1. 単画面 PC での動作確認（v1.3.0 と同じか）
2. 2 画面環境での同期動作確認（HDMI モニターあれば）
3. PR の URL を開いて中身を確認 → マージ操作

前原さんがマージ判断するまで STEP 3 には進まない。
