# CC_REPORT — v2.0.0 STEP 0: 設計調査（コード変更ゼロ、調査文書のみ）

## 1. サマリー

- ✅ **既存コード（v1.3.0）の影響範囲調査完了** — 変更必要 11 箇所 / 変更不要 8 領域に分類
- ✅ **Electron 2 ウィンドウ probe 作成 + 動作確認** — `scripts/_probes/v2-probe.js`、単画面環境で起動成功
- ✅ **`docs/v2-design.md` 作成** — §1〜§7 すべて埋め、致命バグ保護への影響評価まで網羅
- ✅ **`src/` 配下に変更ゼロ**（git status clean）
- ✅ **既存 138 テスト全 PASS 維持**
- スコープ厳守、本体コード一切無変更、`scripts/_probes/` のみ新規追加

## 2. 主要発見事項

### 2-1. 致命バグ保護への影響箇所（要注意 1 件、その他は影響なし）

| 致命バグ保護 | 影響 | 対策 |
| --- | --- | --- |
| **AudioContext resume（C.1.7）** | ⚠️ **要追加対策** | HDMI 抜き差しでホール側ウィンドウが close される際、AudioContext が destroy される。再接続時にホール側で再初期化必要。**STEP 5 で明示的にテスト追加推奨** |
| resetBlindProgressOnly（C.2.7-A）| なし | PC 側 renderer での呼出経路は不変、main 経由 hall に新構造 broadcast のみ追加 |
| timerState race 除外（C.2.7-D）| なし | 既存 IPC payload に触らず、新規 `dual:state-sync` も別チャンネル経由 |
| ensureEditorEditableState 4 重防御 | なし | PC 側のみで動作、`role === 'operator'` ガードで完全分離 |
| runtime 永続化 8 箇所（C.1.8）| なし | 操作は PC 側のみ → schedulePersistRuntime → main 経由 hall に broadcast |

### 2-2. 状態同期に必要な情報の規模感

同期項目は **約 9 種類**（timerState / structure / displaySettings / marqueeSettings / runtime / tournament 基本情報 / audio / logo / venueName）。すべて既存 `tournaments` / `display` / `marquee` / `audio` ストアの延長で対応可能、**新規スキーマ追加は不要**。

通信は IPC 集約、main → hall の単方向 broadcast、ホール側からの送信なし（hall は purely consumer）。

### 2-3. 上位リスク 3 件

1. **【高】renderer.js 6106 行の役割分離が機械的に困難** — 1 ファイルを 2 ロールに分離するのではなく、**役割フラグでイベントリスナの登録を skip**する方式（既存ファイル流用）が現実的。各 handler 関数の冒頭で `if (role === 'hall') return;` ガード追加方式を採用推奨
2. **【中】ホール側 ↔ PC 側の同期遅延** — v2-dual-screen.md §2.1 が「±100ms 以内」要求。対処: ホール側で performance.now ベースのローカル計算、main からは「基準時刻 + 状態フラグ」のみ送信、tick ごとに timer 値を送らない設計
3. **【中】HDMI 抜き差し時の AudioContext suspend / resume** — ホール側ウィンドウ close で AudioContext が destroy。再接続後に operator-solo モード or 新ホール側で initAudio 再呼出。既存 C.1.7 修正の `_play` 内 resume が走るため、最初の音発火で自動 resume

### 2-4. probe 動作確認結果（単画面環境）

```
[startup] displays: 1
  - id=2902177282 label="(no label)" primary=true
    bounds={x:0,y:0,width:1536,height:864} scaleFactor=1.25
[create] operator window ready in 236ms
[init] only one display detected, hall window NOT opened
```

確認:
- `screen.getAllDisplays()` で id / label / bounds / workArea / scaleFactor 取得可能
- ウィンドウ生成コスト ~236ms（許容範囲）
- Windows 環境では `display.label` が空の場合あり → モニター選択ダイアログでは解像度 + 位置で fallback ラベル生成が必要
- HDMI 抜き差し（`display-added` / `display-removed`）の発火は単画面環境では検証不可、**実機 HDMI 環境での確認は前原さん側で要検証**

### 2-5. STEP 順序の評価

CLAUDE.md「v2.0.0 STEP 順序」現状のままで問題なし。小提案:
- STEP 1 冒頭で **CSP 緩和なしで data-role 属性を付与する方式の検証**（`additionalArguments` or preload 経由）
- STEP 2 で **ホール側ローカル時刻計算方式**を確立
- STEP 5 で **AudioContext 再初期化フローの明示テスト**

## 3. 構築士への質問

### 3-1. probe スクリプトの配布物除外
`scripts/_probes/v2-probe.js` は調査用で配布不要。現状 `package.json` の `build.files` は `src/**/*` 等のパターンで `scripts/` 配下を含めない設計のはず（電子ビルド時に自動除外）。STEP 1 で `!scripts/**/*` を `build.files` に追加する形で明示するのが安全か、構築士判断をお願いします。

### 3-2. CSP の data-role 注入方式
リスク 5 で言及した「`<html>` 要素への `data-role` 属性付与」は CSP `script-src 'self'` を緩和すれば inline script で対処可能ですが、**CSP 緩和は禁止事項**。代替候補:
- (a) `BrowserWindow.webPreferences.additionalArguments: ['--role=hall']` で preload に渡し、preload で `document.documentElement.setAttribute('data-role', ...)` を `DOMContentLoaded` 前に実行
- (b) querystring を preload で読んで上記同等

(a) が CSP 不変で最もクリーン。STEP 1 でこの方式を採用するかご確認ください。

### 3-3. ホール側 / PC 側の物理的な分離レベル
現在の設計案では `index.html` を両画面で流用し、CSS `[data-role]` セレクタで表示要素を切替方式。これに対し「ホール側専用の `hall.html` を新規作成」する案もありますが、コード重複が増えるためスコープ非効率と判断。流用方式で進めて問題ないかご確認ください。

## 4. オーナー向け確認（軽量）

本 STEP はコード変更ゼロの調査フェーズです。前原さんに見ていただく内容は以下のみ:

1. **既存 v1.3.0 配布版に一切影響なし** — タイマー / スライドショー / ランタイム永続化すべて以前通り動作
2. **次フェーズ（STEP 1）で 2 画面対応の最小骨格を実装します** — その後で承認ポイント①（STEP 2 完了時、状態同期確認）に進みます

詳細な設計内容は `docs/v2-design.md` に記載、構築士で読んで承認・修正指示をお願いします。

---

## 5. 検証ログ

```
$ git status src/
On branch main
Your branch is up to date with 'origin/main'.
nothing to commit, working tree clean

$ npm test
[15 ファイル合計]  Summary: 138 passed / 0 failed

$ ls scripts/_probes/
v2-probe.js

$ ls docs/v2-design.md
docs/v2-design.md  (作成済)
```

**v2.0.0 STEP 0（設計調査）完了**。次は STEP 1（ホール側ウィンドウ追加、最小骨格）の NEXT_CC_PROMPT.md 待ち。
