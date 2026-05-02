# skills/electron-multi-monitor-pitfalls.md - Electron 2 モニター / HDMI 抜き差しの既知の罠

## 適用範囲

HDMI 抜き差しを伴うマルチモニター対応の Electron アプリ実装で CC と構築士が必読。

**確度ラベル**:
- ★★★ = Electron 公式 docs に明記、または挙動が広く知られている
- ★★☆ = 業界で広く観察されている挙動、ただし出典は分散
- ★☆☆ = 報告例があるが信頼性中、実機検証推奨
- ☆☆☆ = 不確かな情報、必ず実機で確認

---

## 1. ディスプレイイベント検知の罠

### 1.1 `display-removed` の発火タイミング ★★☆

HDMI 抜き → `display-removed` イベントは発火するが、**Windows では発火までに遅延がある**ことが業界で広く観察されている。具体的な遅延時間（数十 ms 〜数百 ms）はドライバ依存で変動。

**対策**: イベント発火直後ではなく、debounce で 100〜200ms 待ってから window 操作する。

```javascript
let displayChangeTimeout = null;
const handleDisplayChange = () => {
  if (displayChangeTimeout) clearTimeout(displayChangeTimeout);
  displayChangeTimeout = setTimeout(() => {
    // ここで window 操作
  }, 150);
};
app.on('display-removed', handleDisplayChange);
app.on('display-metrics-changed', handleDisplayChange);
```

### 1.2 イベントが発火しない / 遅延する典型ケース ★★☆

- USB-HDMI アダプタ経由: USB enumeration の遅延
- 古いディスプレイドライバ: EDID 検知遅延
- Miracast / 無線接続: イベント発火が不安定

---

## 2. BrowserWindow の bounds がオフスクリーンに残る罠（最重要）★★★

### 2.1 「サブモニターに置かれた window が HDMI 抜きで消える」典型症状

**症状**:
- HDMI 接続中: window をサブモニター上に置いていた（例: `bounds = {x: 1920, y: 0, w: 800, h: 600}`）
- HDMI 抜き → OS がサブモニターの座標空間（x: 1920〜）を削除
- window の bounds はそのまま（x: 1920 のまま）→ **物理的にどの画面にも映らない**
- `show()` / `focus()` を呼んでも見えない（bounds が無効座標を指しているため）

**真因**: HDMI 抜きで bounds が **オフスクリーン残存** する。

### 2.2 PokerTimerPLUS+ への適用判断 ★★☆

PokerTimerPLUS+ の構成:
- mainWindow（手元 PC = AC）= primary display 上
- hallWindow（会場モニター = HDMI）= サブモニター上
- HDMI 抜き → hallWindow を close → mainWindow は primary display に残る

理屈の上では mainWindow は primary display にあり、HDMI 抜きで bounds が変わらないはず。**ただし以下のケースでは bounds 異常が起こりうる**:
- mainWindow を一度サブモニターに移動した履歴がある（ユーザー操作）
- サブモニター側で hall を作った後、設定変更で mainWindow がサブモニターに飛んだ
- DPI スケーリング差がある環境で bounds が論理座標と物理座標で乖離した

### 2.3 安全な bounds 検証ヘルパ ★★★

```javascript
function isWindowOffScreen(window) {
  const bounds = window.getBounds();
  const displays = screen.getAllDisplays();
  const unionRect = displays.reduce(
    (acc, d) => ({
      minX: Math.min(acc.minX, d.bounds.x),
      maxX: Math.max(acc.maxX, d.bounds.x + d.bounds.width),
      minY: Math.min(acc.minY, d.bounds.y),
      maxY: Math.max(acc.maxY, d.bounds.y + d.bounds.height),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  return (
    bounds.x + bounds.width < unionRect.minX ||
    bounds.x > unionRect.maxX ||
    bounds.y + bounds.height < unionRect.minY ||
    bounds.y > unionRect.maxY
  );
}

function getValidBounds(width = 800, height = 600) {
  const displays = screen.getAllDisplays();
  if (!displays.length) return { x: 0, y: 0, width, height };
  const primary = screen.getPrimaryDisplay();
  return {
    x: primary.bounds.x + 100,
    y: primary.bounds.y + 100,
    width,
    height,
  };
}
```

### 2.4 復元の正しい順序 ★★★

```javascript
if (isWindowOffScreen(mainWindow)) {
  mainWindow.setBounds(getValidBounds());
}
mainWindow.show();
mainWindow.focus();
```

`setBounds()` → `show()` → `focus()` の順を厳守。`show()` が先だと無効座標で表示しようとして失敗。

---

## 3. show / focus / restore / moveTop の Windows 特有の挙動

### 3.1 各メソッドの責任範囲 ★★★

| メソッド | 動作 | 罠 |
|---|---|---|
| `show()` | window を表示状態に | bounds が無効ならまだ見えない |
| `focus()` | フォーカス取得 | window が見えていなければ無効 |
| `restore()` | 最小化解除 | bounds は変更しない |
| `moveTop()` | Z-order 最前面 | bounds は変更しない |
| `app.focus({ steal: true })` | アプリ全体を最前面 | bounds が無効なら見えない |

### 3.2 まとめ ★★★

- **見えない問題が起きたら、まず bounds を疑う**（show/focus は bounds が正しい前提でのみ機能する）
- bounds 修正 → show → focus の順

---

## 4. focusable / paintWhenInitiallyHidden / backgroundThrottling

### 4.1 デフォルト値 ★★★

公式 docs より:
- `focusable`: true（デフォルト）
- `paintWhenInitiallyHidden`: **true**（デフォルト、show: false で生成された window でも paint する）
- `backgroundThrottling`: true（デフォルト、バックグラウンド時に timer 遅延）

### 4.2 重要な誤解 ★★★

「`paintWhenInitiallyHidden` を明示しないと paint されない」は誤り。デフォルト true なので明示不要。**`show: true` で生成された window には適用対象外**（そもそも初期から表示されているため）。

PokerTimerPLUS+ rc9 で `paintWhenInitiallyHidden: true` を追加したが、これは効果がない（既にデフォルト true、対象外）。

### 4.3 backgroundThrottling の罠 ★★☆

window が一度オフスクリーンに置かれると、OS から「非表示」と判定されて renderer の paint が遅延する事例が報告されている。bounds を修正して show しても paint が即時開始されない可能性。

**保険策**: 一時的に `backgroundThrottling: false` を切ってから show、paint 後に元に戻す。

```javascript
mainWindow.webContents.setBackgroundThrottling(false);
mainWindow.setBounds(getValidBounds());
mainWindow.show();
mainWindow.webContents.once('paint', () => {
  mainWindow.webContents.setBackgroundThrottling(true);
});
```

---

## 5. マルチモニターでのフォーカス制御 Windows OS 罠

### 5.1 アプリ全体のフォーカス喪失 ★★☆

サブモニターが消える → app 全体のフォーカスが他アプリに移動する事例あり。`BrowserWindow.focus()` だけでは前面化しない。

**対策**: `app.focus({ steal: true })` を併用。それでもダメなら setBounds 先行で見える座標に置く。

### 5.2 DPI スケーリング差 ★★☆

100% DPI と 150% DPI のモニターが混在すると、bounds の論理座標と物理座標が乖離する。`screen.getDisplayNearestPoint()` で `scaleFactor` を確認できる。

---

## 6. 既知の症状 × 真因 × 解決パターン

| 症状 | 真因（最有力） | 解決パターン |
|---|---|---|
| HDMI 抜き後 window が見えない（最小化ではない） | bounds がオフスクリーン残存 | `isWindowOffScreen()` チェック → `setBounds(getValidBounds())` → show → focus |
| ちらつき / 黒い画面（一瞬） | paint と visibility の乖離 | backgroundThrottling 一時 false |
| `display-removed` イベントが届かない | ドライバ遅延 / Electron 旧版 | debounce 150ms + display-metrics-changed も併用 |
| show / focus しても見えない | bounds 未修正 | setBounds 先行 |
| サブウィンドウだけ消える | サブウィンドウも同じ bounds 罠 | 全 window に bounds チェック適用 |

---

## 7. 真因確定のための実機計測手順 ★★★

PokerTimerPLUS+ rc11 計測フェーズで使うことを想定。

### 7.1 計測用ログ関数

```javascript
function logDisplayState(label) {
  const displays = screen.getAllDisplays();
  const bounds = mainWindow.getBounds();
  const offscreen = isWindowOffScreen(mainWindow);
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${label}: bounds=${JSON.stringify(bounds)} offscreen=${offscreen} displayCount=${displays.length}`);
}

app.on('display-removed', () => {
  logDisplayState('display-removed [事前]');
  setTimeout(() => logDisplayState('display-removed [+100ms]'), 100);
  setTimeout(() => logDisplayState('display-removed [+500ms]'), 500);
});
mainWindow.on('show', () => logDisplayState('window.show()'));
mainWindow.on('focus', () => logDisplayState('window.focus()'));
```

### 7.2 ログ解読チェック

- `offscreen: true` のまま → bounds 未リセット（真因確定）
- `displayCount` が 1 なのに `offscreen: true` → 座標計算バグ
- `display-removed` イベントが出ない → ドライバ / Electron バージョン

### 7.3 計測ログの扱い

- 一時挿入、計測後は削除する前提
- CC_REPORT に挿入箇所と削除予定を必ず明記（cc-operation-pitfalls §1.4 / root-cause-analysis §5）

---

## 8. ベストプラクティス チェックリスト

### 初期化（app 起動時）
- [ ] BrowserWindow の webPreferences を明示的に設定（誤解防止）
- [ ] `app.requestSingleInstanceLock()` で多重起動防止

### HDMI 抜き / 接続時
- [ ] `display-removed` + `display-metrics-changed` の両方を購読、debounce 150ms
- [ ] debounce 内で `isWindowOffScreen()` チェック → 必要なら `setBounds(getValidBounds())`
- [ ] `setBounds()` → `show()` → `focus()` の順を厳守
- [ ] 複数 window がある場合、全 window に同じ手順を適用

### マルチウィンドウ対応
- [ ] サブウィンドウも bounds 罠の対象、各 window に `isWindowOffScreen()` 適用
- [ ] サブウィンドウを close する経路では、close 前後で main window の bounds をログ

### テスト・検証
- [ ] HDMI 物理抜きで複数回テスト（OS の display change シミュレートでは再現しにくい場合あり）
- [ ] 計測ログで bounds の遷移を必ず確認

---

## 9. 出典・参考リンク

### 公式ドキュメント（★★★）
- Electron API screen: https://www.electronjs.org/docs/latest/api/screen
- Electron API BrowserWindow: https://www.electronjs.org/docs/latest/api/browser-window
- BrowserWindow.webContents.setBackgroundThrottling: https://www.electronjs.org/docs/latest/api/web-contents

### 確度限定 / 出典分散の情報（★☆☆〜★★☆）
- 「Window が消える」系の症状は GitHub Issue / Stack Overflow に多数の類似事例あるが、解決パターンは個別 issue ごとに異なる
- 数値（遅延時間、debounce 推奨値）は環境依存、実機計測で確定するのが原則
- Windows 11 のフォーカス制御変更は要検証（CC は Electron 公式の breaking changes ページで個別バージョンの仕様を確認すること）

---

## 10. CC への運用指示

### 10.1 PokerTimerPLUS+ rc11 計測フェーズで使う場合
1. §7 の計測スクリプトを `src/main.js` に一時挿入
2. 前原さんに 1 回だけ実機試験してもらう（HDMI 接続→抜き→ログ取得）
3. ログから真因確定（offscreen 状態か、display イベント未発火か等）
4. 真因に応じた修正案を CC_REPORT に提示
5. 計測ログは rc11 実装フェーズに進む前に削除

### 10.2 思い込み判断禁止（root-cause-analysis.md 準拠）
- 本 skill の「最有力候補」「典型症状」をそのまま PokerTimerPLUS+ の真因と決めつけない
- 必ず実コード根拠（src/main.js の該当箇所）で検証してから修正案を立てる
- 本 skill の確度ラベル（★の数）を確認、★☆☆ の情報は実機検証必須
