# v2.0.0 STEP 1: ホール側ウィンドウ追加（最小骨格、ブランチ運用導入）

## 状況
v2.0.0 STEP 0 完了済（`docs/v2-design.md` 作成、`scripts/_probes/v2-probe.js` 配置、影響範囲 11/8 分類、致命バグ保護への影響 1 件 = AudioContext を STEP 5 警告事項として記録）。
本 STEP 1 から **`feature/v2.0.0` ブランチで作業** に切り替え、`main` は v1.3.0 配布版として常に動作する状態を維持する。

CC からの STEP 0 質問 3 件への構築士判断は本プロンプトに反映済:
1. probe スクリプトの配布物除外 → Fix 5 で対応
2. CSP の data-role 注入方式 → (a) `additionalArguments` 採用（Fix 2-3）
3. ホール側 / PC 側の物理的分離レベル → 流用方式（CSS `[data-role]` セレクタ）採用（Fix 4）

---

## ⚠️ スコープ制限（厳守）

**本 STEP 1 で実行するのは以下のみ:**
1. `feature/v2.0.0` ブランチを切って以降の全作業をこのブランチで実施
2. `src/main.js` の既存ウィンドウ生成を `createOperatorWindow()` / `createHallWindow()` の 2 関数に分離
3. アプリ起動時に `screen.getAllDisplays()` でモニター数を判定（最小限の分岐、ダイアログ生成は STEP 4）
4. `BrowserWindow.webPreferences.additionalArguments` で `--role=operator` / `--role=hall` / `--role=operator-solo` を渡す
5. `src/preload.js` で `process.argv` から role を抽出 → `document.documentElement.setAttribute('data-role', role)` を DOMContentLoaded 前に実行
6. `src/renderer/style.css` に `[data-role]` セレクタの最小サンプル追加（役割が機能しているか視認用、本格的分離は STEP 3）
7. `package.json` の `build.files` に `!scripts/**/*` を追加（probe を配布物から除外）
8. STEP 1 完了でコミット & push、ただし **PR はまだ作らない**（承認①は STEP 2 完了時）
9. CC_REPORT.md に STEP 1 完了報告

**禁止事項:**
- 状態同期の実装（STEP 2 で行う）
- モニター選択ダイアログの実装（STEP 4 で行う）
- HDMI 抜き差し追従（STEP 5 で行う）
- ホール側 / PC 側の UI 完全分離（STEP 3 で行う）
- 単画面モード時の挙動変更（v1.3.0 と完全同等を維持）
- 既存 138 テストへの影響変更
- AudioContext 関連の変更（STEP 5 で扱う、v2-design.md §7 警告事項）
- 致命バグ保護 5 件への影響変更
- 「ついでに既存リファクタ」一切禁止
- skills/v2-dual-screen.md「§5 禁止事項」を本 STEP でも遵守
- CSP `script-src 'self'` 不変

---

## Fix 1: ブランチ作成と切替

```bash
cd poker-clock
git checkout -b feature/v2.0.0
git branch     # * feature/v2.0.0 を確認
```

以降の全作業はこのブランチ上で実施。`main` には触らない。

---

## Fix 2: `src/main.js` のウィンドウ生成関数分離

既存のウィンドウ生成処理を以下の 2 関数に分離。

```js
function createOperatorWindow(targetDisplay, isSolo = false) {
  const role = isSolo ? 'operator-solo' : 'operator';
  const win = new BrowserWindow({
    width: ...,
    height: ...,
    x: targetDisplay.bounds.x + 40,
    y: targetDisplay.bounds.y + 40,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--role=${role}`],   // ★ 追加
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.loadFile('src/renderer/index.html');
  return win;
}

function createHallWindow(targetDisplay) {
  // 同様の構造、additionalArguments: ['--role=hall']
  // ホール側は frame: false / fullscreen: true 等の差分は STEP 3 で扱う、本 STEP は最小限
}
```

起動時の分岐（`app.whenReady()` 内）:

```js
const displays = screen.getAllDisplays();
if (displays.length < 2) {
  // 単画面モード: v1.3.0 と完全同等
  createOperatorWindow(displays[0], true);  // isSolo=true → role=operator-solo
} else {
  // 2 画面モード: 暫定で primary を operator、それ以外の最初を hall
  // モニター選択ダイアログは STEP 4 で実装
  const primary = displays.find(d => d.isPrimary) || displays[0];
  const secondary = displays.find(d => d.id !== primary.id);
  createOperatorWindow(primary, false);
  createHallWindow(secondary);
}
```

注意:
- 既存ウィンドウ生成の細部（`webPreferences` その他のオプション）は両関数に**忠実に踏襲**、追加するのは `additionalArguments` のみ
- 既存の IPC ハンドラ・store 連携は無変更
- 致命バグ保護 5 件すべて不変

---

## Fix 3: `src/preload.js` での role 抽出と `data-role` 付与

preload.js は CSP 適用外なので inline 相当の DOM 操作が可能。

```js
// preload.js の冒頭で実行
const roleArg = process.argv.find(a => a.startsWith('--role='));
const role = roleArg ? roleArg.split('=')[1] : 'operator-solo';

// DOM 構築前に attribute 付与
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.setAttribute('data-role', role);
});

// renderer 側からも参照できるように expose（optional）
contextBridge.exposeInMainWorld('appRole', role);
```

DOMContentLoaded を待つので、`<head>` 内の CSS が role 反映前にロードされる可能性あり → ホール側で一瞬「OPERATOR バッジ」が見える等の flicker が起きるなら、DOMContentLoaded ではなく `<html>` 要素直接操作で先取りする（DOM 構築は head から進むため `documentElement` は早期から存在する）。具体実装は CC 判断、ただし CSP 不変 + flicker 防止が条件。

---

## Fix 4: `src/renderer/style.css` に最小 `[data-role]` セレクタ追加

役割が機能しているかの**視認用バッジ**を追加。STEP 3 で本格的な分離（ホール側で操作 UI hidden / PC 側でタイマー表示 hidden）に発展させる。

```css
/* v2.0.0 STEP 1: 役割確認用バッジ（STEP 3 で本格分離に置換予定） */
[data-role="hall"] body::before {
  content: "🖥 HALL";
  position: fixed;
  top: 4px; right: 4px;
  background: rgba(0, 0, 0, 0.5);
  color: white;
  padding: 2px 8px;
  font-size: 10px;
  font-family: monospace;
  z-index: 9999;
  pointer-events: none;
  border-radius: 2px;
}
[data-role="operator"] body::before {
  content: "💻 OPERATOR";
  /* 同上スタイル */
}
[data-role="operator-solo"] body::before {
  content: "";  /* 単画面モードはバッジ非表示、v1.3.0 と完全同じ見た目 */
}
```

注意:
- カード幅 / Barlow Condensed / `<dialog>` flex 禁止 等の不変ルールには一切触れない
- バッジは右上 4px、z-index 9999 で他 UI と干渉しないよう配置
- `pointer-events: none` でクリック干渉も防ぐ

---

## Fix 5: `package.json` の `build.files` 修正

`scripts/_probes/v2-probe.js` を配布物から除外。

```json
"build": {
  ...
  "files": [
    "src/**/*",
    "node_modules/**/*",
    "!**/*.test.js",
    "!scripts/**/*",   // ★ 追加（probe 配布物除外）
    ...
  ]
}
```

実際の `files` 配列は既存値を確認の上、`!scripts/**/*` のみ追加。他のパターンには手を入れない。

---

## Fix 6: 既存テスト全 PASS 維持

```bash
npm test
# Summary: 138 passed / 0 failed を確認
```

1 件でも FAIL したら**即停止**、CC_REPORT に「何が壊れたか」と「致命バグ保護への影響有無」を明記。

---

## Fix 7: コミット & push（PR はまだ作らない）

```bash
git add -A
git status   # 変更ファイル確認
git -c user.name="Yu Shitamachi" -c user.email="ymng2@icloud.com" commit -m "v2.0.0 STEP 1: ホール側ウィンドウ追加（最小骨格）"
git push -u origin feature/v2.0.0
```

PR は **承認①（STEP 2 完了時）でまとめて作成**。本 STEP 1 単独では PR 不要。

---

## Fix 8: CC_REPORT.md（簡潔版）

CC_REPORT.md を STEP 1 完了報告に書き換え:

1. **サマリ**: ブランチ作成、ウィンドウ分離、role 機能、build 除外、138 テスト維持
2. **主要変更点**: コード抜粋 5 行以内/件、role 抽出ロジック / additionalArguments 渡し方を明示
3. **構築士への質問**（あれば、なければ省略）
4. **オーナー向け確認**:
   - 単画面 PC で起動 → 見た目が v1.3.0 と完全同じか（バッジが出ないこと）
   - HDMI 接続環境があれば → 2 ウィンドウ起動して片方に「🖥 HALL」、もう片方に「💻 OPERATOR」バッジが見えるか

---

## 維持事項

- 既存 138 テスト全 PASS 維持
- 単画面モード時の挙動を v1.3.0 と**完全同一**に保つ（バッジ非表示、レイアウト・フォント・カード幅すべて同じ）
- 致命バグ保護 5 件すべて完全維持:
  - `resetBlindProgressOnly`（C.2.7-A）
  - `timerState` destructure 除外（C.2.7-D）
  - `ensureEditorEditableState` 4 重防御（C.1-A2 + C.1.2-bugfix + C.1.4-fix1）
  - AudioContext resume in `_play()`（C.1.7、本 STEP では触らない）
  - runtime 永続化 8 箇所（C.1.8）
- カード幅 54vw / 46vw、Barlow Condensed 700、`<dialog>` flex 禁止
- skills/v2-dual-screen.md「§5 禁止事項」全項目
- CSP `script-src 'self'` 不変

---

## 完了条件

- [ ] `feature/v2.0.0` ブランチ作成 + checkout 済
- [ ] `src/main.js` のウィンドウ分離完了、両関数で v1.3.0 と同等の挙動
- [ ] `src/preload.js` で role 抽出 + `data-role` 属性付与確認
- [ ] `src/renderer/style.css` に `[data-role]` セレクタ最小サンプル追加
- [ ] `package.json` の `build.files` に `!scripts/**/*` 追加
- [ ] 単画面で起動 → バッジ非表示、v1.3.0 と完全同じ見た目
- [ ] `npm test` で **138 件全 PASS**
- [ ] コミット & `feature/v2.0.0` ブランチへ push 完了
- [ ] CC_REPORT.md 完了報告（オーナー向け確認 2 項目記載）
