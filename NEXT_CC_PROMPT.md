# v2.0.0 STEP 4: 起動時のモニター選択ダイアログ

## 状況
v2.0.0 STEP 0+1+2+3 完了。承認①の PR #1 は main マージ済み（2026-05-01）。
本 STEP 4 は **起動時のモニター選択ダイアログ**（小規模）。2 画面モード時に「どちらをホール側にするか」を毎回選ぶ UI を実装。

参照ドキュメント:
- `skills/v2-dual-screen.md` §4（起動時のモニター選択）
- `skills/cc-operation-pitfalls.md`（公式準拠の絶対遵守事項、本フェーズ開始時に必ず Read）
- `docs/v2-design.md` §2.2（Windows 環境で `display.label` 空の場合のフォールバック）

---

## ⚠️ スコープ制限（厳守）

**本 STEP 4 で実行するのは以下のみ:**
1. `src/renderer/display-picker.html` 新規作成（モニター選択 UI）
2. `src/main.js` の起動シーケンスにダイアログ表示ロジック追加
3. 新規 IPC: `dual:select-hall-monitor`（ダイアログ → main で選択結果を返す）
4. 前回選択を electron-store に保存（次回ダイアログのデフォルト選択用、参考情報）
5. 単画面モード（モニター 1 枚）: ダイアログ出ない、既存挙動維持（`operator-solo`）
6. 2 画面モード（モニター 2 枚以上）: ダイアログ表示 → 選択 → ホール側決定 → 2 ウィンドウ生成
7. キャンセル時: 単画面モード（`operator-solo`）で起動
8. `tests/v2-display-picker.test.js`（新規、5〜8 件）
9. 既存 154 テスト全 PASS 維持
10. PR は作らない（承認②で STEP 3+4+5 まとめる方針）

**禁止事項:**
- HDMI 抜き差し追従（STEP 5）
- AudioContext 関連変更（STEP 5）
- 単画面モード（`operator-solo`）の挙動変更
- 既存 154 テストの skip / 無効化
- 致命バグ保護 5 件への影響変更
- **並列 sub-agent / Task は最大 3 体まで**（`skills/cc-operation-pitfalls.md` §1.1）
- **「念のため」コード追加禁止**（`skills/cc-operation-pitfalls.md` §1.2）
- ダイアログ表示中にタイマーを動かす（タイマーは main プロセス側で whenReady 後に初期化済み、ただしダイアログ表示中は操作不可で良い）
- 起動結果の永続化（モニター選択は毎回手動、前原さん要望）— 「前回選択の参考情報」のみ保存
- CSP `script-src 'self'` 不変
- `<dialog>` 要素自体に `display: flex` 禁止（feedback_dialog_no_flex）

---

## Fix 1: `src/renderer/display-picker.html` 新規作成

シンプルなモニター選択 UI。スタイルは既存 `style.css` のトーンに合わせる（ただし独立した最小 CSS でも OK）。

要件:
- 検出されたモニター一覧をカード形式で表示
- 各モニター情報: ラベル（空なら「モニター 1」「モニター 2」の連番）+ 解像度（例: `1920×1080`）+ 位置（プライマリかどうか）
- 各モニターに「このモニターをホール側にする」ボタン
- 下部に「キャンセル（単画面モードで起動）」ボタン
- 前回選択された hall display id があれば、該当モニターのカードに「前回選択」バッジ表示

実装イメージ（具体的な HTML 構造は CC 判断）:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'" />
  <title>モニターを選択</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body data-role="picker">
  <main class="display-picker">
    <h1>ホール側のモニターを選択</h1>
    <p>お客様に見せる側のモニターを選んでください。</p>
    <div class="display-list" id="displayList">
      <!-- preload 経由で main から displays + lastSelected を受け取って動的生成 -->
    </div>
    <button id="cancelBtn" class="btn-cancel">キャンセル（単画面モード）</button>
  </main>
  <script src="display-picker.js"></script>
</body>
</html>
```

`src/renderer/display-picker.js`（新規）でレンダリング + ボタン click → `window.api.dual.selectHallMonitor(displayId)` 呼出。

注意:
- CSP `script-src 'self'` 不変、inline script 禁止
- `display-picker.js` は新規ファイルとして用意

---

## Fix 2: `src/main.js` の起動シーケンス修正

```js
async function chooseHallDisplayInteractive(displays) {
  if (!displays || displays.length < 2) return null;  // 単画面モード

  const lastSelected = store.get('preferredHallDisplayId') || null;

  return new Promise((resolve) => {
    const pickerWin = new BrowserWindow({
      width: 480, height: 360,
      modal: false,
      resizable: false,
      title: 'PokerTimerPLUS+ — モニター選択',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        additionalArguments: ['--role=picker'],   // 新規 role
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    pickerWin.loadFile(path.join(__dirname, 'renderer', 'display-picker.html'));

    // dialog からの選択結果受信
    const handler = (_event, displayId) => {
      ipcMain.removeListener('dual:select-hall-monitor', handler);
      pickerWin.close();
      if (displayId) store.set('preferredHallDisplayId', displayId);
      resolve(displayId || null);
    };
    ipcMain.on('dual:select-hall-monitor', handler);

    pickerWin.on('closed', () => {
      ipcMain.removeListener('dual:select-hall-monitor', handler);
      resolve(null);  // キャンセル
    });
  });
}

// app.whenReady 内
const displays = screen.getAllDisplays();
const hallId = await chooseHallDisplayInteractive(displays);

if (!hallId) {
  // 単画面 or キャンセル
  createOperatorWindow(displays[0] || screen.getPrimaryDisplay(), true);
} else {
  const hallDisplay = displays.find(d => d.id === hallId);
  const operatorDisplay = displays.find(d => d.id !== hallId) || screen.getPrimaryDisplay();
  createOperatorWindow(operatorDisplay, false);
  createHallWindow(hallDisplay);
}
```

注意:
- `picker` role は STEP 1 の `data-role` セレクタには含まれない（独自 UI）→ display-picker.html は独自スタイル
- `additionalArguments: ['--role=picker']` は preload.js で抽出（既存ロジック踏襲）
- preload.js の `data-role` 付与処理が `picker` でも動くこと（既存ロジック流用、特別な変更不要）

---

## Fix 3: `preload.js` に display-picker 用 API 追加

```js
// 既存 dual グループに追加
dual: {
  // ... 既存の subscribeStateSync / fetchInitialState / notifyOperatorAction ...
  fetchDisplays: () => ipcRenderer.invoke('display-picker:fetch'),
  selectHallMonitor: (displayId) => ipcRenderer.send('dual:select-hall-monitor', displayId),
},
```

`display-picker:fetch` IPC ハンドラを main.js に追加し、displays + lastSelected を返す。

---

## Fix 4: `display-picker.js` の最小ロジック

```js
async function init() {
  const data = await window.api.dual.fetchDisplays();   // { displays: [...], lastSelected: id|null }
  const list = document.getElementById('displayList');
  data.displays.forEach((d, i) => {
    const card = document.createElement('div');
    card.className = 'display-card';
    if (d.id === data.lastSelected) card.classList.add('is-last-selected');
    card.innerHTML = `
      <div class="display-name">${d.label || `モニター ${i + 1}`}</div>
      <div class="display-info">${d.bounds.width}×${d.bounds.height}${d.isPrimary ? '（プライマリ）' : ''}</div>
      <button class="btn-select" data-display-id="${d.id}">このモニターをホール側にする</button>
    `;
    card.querySelector('.btn-select').addEventListener('click', () => {
      window.api.dual.selectHallMonitor(d.id);
    });
    list.appendChild(card);
  });
  document.getElementById('cancelBtn').addEventListener('click', () => {
    window.close();   // BrowserWindow が閉じる → main 側で resolve(null)
  });
}
init();
```

---

## Fix 5: `tests/v2-display-picker.test.js` 新規作成（5〜8 件）

静的解析ベース:
- T1: `src/renderer/display-picker.html` ファイルが存在し、CSP `script-src 'self'` を持つ
- T2: `src/renderer/display-picker.js` ファイルが存在
- T3: main.js に `chooseHallDisplayInteractive` 関数が定義され、`displays.length < 2` の場合に `null` を返す early return
- T4: main.js に `display-picker:fetch` IPC ハンドラ + `dual:select-hall-monitor` リスナ
- T5: preload.js に `dual.fetchDisplays` / `dual.selectHallMonitor` 追加
- T6: 起動シーケンスで `hallId` が `null` の場合 `createOperatorWindow(_, true)` のみ呼ばれる（単画面）
- T7: store.set('preferredHallDisplayId', ...) が選択時のみ呼ばれる（キャンセル時は保存しない）
- T8: display-picker.html に inline script がない（CSP 不変担保）

---

## Fix 6: 既存 154 テスト全 PASS 維持

```bash
npm test
# Summary: 138 + 8 + 8 + N (>=5) = >=159 passed / 0 failed
```

1 件でも FAIL したら**即停止**、CC_REPORT に「何が壊れたか」「致命バグ保護への影響有無」明記。

---

## Fix 7: コミット & push（PR は STEP 5 完了時）

```bash
git add -A
git status
git -c user.name="Yu Shitamachi" -c user.email="ymng2@icloud.com" commit -m "v2.0.0 STEP 4: 起動時のモニター選択ダイアログ"
git push origin feature/v2.0.0
```

**PR は作らない**。承認②（STEP 5 完了時）で STEP 3+4+5 を 1 つの PR にまとめる方針。

---

## Fix 8: CC_REPORT.md（公式準拠フォーマット）

CC_REPORT.md を STEP 4 完了報告に書き換え:
1. **サマリ**: display-picker 新規 / main.js 起動シーケンス修正 / 前回選択保存 / テスト件数
2. **修正ファイル**: 表形式
3. **主要変更点**: コード抜粋 5 行以内/件
4. **致命バグ保護への影響評価**: 5 件すべて「影響なし / 要注意 / 影響あり」明記（必須）
5. **並列起動した sub-agent / Task 数**（0〜3 体は OK、4 体以上は警告）
6. **構築士への質問**（あれば、なければ省略）
7. **オーナー向け確認**:
   - 単画面 PC で起動 → ダイアログが出ない、v1.3.0 と完全同等
   - 2 画面環境（あれば）→ 起動時にダイアログ表示、モニター選択 → 選択した側がホール側に
   - キャンセルボタン → 単画面モードで起動

---

## 維持事項

- 既存 154 テスト全 PASS 維持（+ STEP 4 新規 5〜8 件追加）
- **`operator-solo` モード（単画面）は v1.3.0 と完全同等**
- 致命バグ保護 5 件すべて完全維持:
  - `resetBlindProgressOnly`（C.2.7-A）
  - `timerState` destructure 除外（C.2.7-D Fix 3）
  - `ensureEditorEditableState` 4 重防御
  - AudioContext resume in `_play()`（C.1.7、本 STEP では触らない）
  - runtime 永続化 8 箇所（C.1.8）
- カード幅 / Barlow Condensed / `<dialog>` flex 禁止
- `skills/v2-dual-screen.md`「§5 禁止事項」全項目
- `skills/cc-operation-pitfalls.md`「§1 絶対禁止事項」全項目
- CSP `script-src 'self'` 不変
- ポーリング禁止、イベント駆動

---

## 完了条件

- [ ] `feature/v2.0.0` ブランチで STEP 4 のコミット作成 + push
- [ ] `src/renderer/display-picker.html` + `display-picker.js` 新規作成
- [ ] `src/main.js` に `chooseHallDisplayInteractive` + `display-picker:fetch` ハンドラ
- [ ] `src/preload.js` に `dual.fetchDisplays` / `dual.selectHallMonitor`
- [ ] `tests/v2-display-picker.test.js`（新規）5〜8 件
- [ ] `npm test` で **既存 154 + 新規 5〜8 = >=159 件すべて PASS**
- [ ] 致命バグ保護 5 件すべて影響なし確認
- [ ] 並列 sub-agent / Task 数を CC_REPORT で報告（4 体以上禁止）
- [ ] CC_REPORT.md 完了報告（オーナー向け確認 3 項目記載）
