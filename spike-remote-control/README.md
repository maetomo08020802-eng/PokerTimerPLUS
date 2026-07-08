# spike-remote-control — remote-control Phase 0 技術検証スパイク

> ⚠️ これは **検証用スパイク**（捨てコード）です。`spike/remote-control-phase0` ブランチ限定・**main へ merge しない**。
> 本体（`src/`）は一切改変していません。恒久実装は Phase 1（前原ゲート後）。

## 目的
「スマホ等から単一モードを LAN 経由で遠隔操作」の**最大リスク（会場で本当に繋がるか / ファイアウォール）**を、本実装前に潰す。詳細は `docs/remote-control_roadmap.md` と `.cc-reports/2026-07-08_remote-control_phase0-spike.md`。

## 構成（Node 標準 http のみ・追加ライブラリゼロ）
| ファイル | 役割 |
|---|---|
| `op-map.js` | 操作名 → `dispatchClockShortcut` が受ける eventLike 写像（真実源1本・Phase 1 で流用） |
| `server.js` | LAN サーバ本体。GET `/`=操作ページ、POST `/api/op`=PIN検証→写像→onOp |
| `discover.js` | 自 LAN IPv4 取得（`os.networkInterfaces`・依存ゼロ） |
| `phone.html` | スマホ操作 UI（PIN + 全操作ボタン。Phase 0 最小） |
| `harness.js` | 自走検証（LAN IP 経由で叩き PIN/写像/到達性を assert）。**本体 npm test には非組込** |
| `run-server.js` | 常駐起動（URL print。6-B 実機/live curl 用） |

## 実行
```bash
# 自走検証（LAN IP 経由で疎通・PIN・写像を確認）
node spike-remote-control/harness.js

# スマホ実機テスト用（同じ Wi-Fi のスマホで表示 URL を開く）
node spike-remote-control/run-server.js 4831 8080
#   → "http://<PCのLAN IP>:8080" を print。スマホのブラウザで開く。
```

## Phase 0 で実証したこと
- Node 標準 http のみで LAN サーバが立ち、**実 LAN IP 経由**（別端末相当）で到達できる。
- PIN 認証が効く（不一致は 401・操作は届かない）。
- 全17操作が eventLike に写像される（`reentryPlus`→`{code:KeyR,control:true}` 等、PC のキーと一致）。
- LAN IPv4 の自動取得が依存ゼロで成立。

## Phase 1 の配線点（このスパイクで特定）
実アプリの renderer へ操作を届けるには、以下2点が必要（Phase 0 では未実装＝本体無改変）:
1. **main**: サーバの onOp → `mainWindow.webContents.send('remote:op', payload)`。
2. **renderer**: `remote:op` を **operator-solo（単一モード）でも受信する**リスナーを追加し `dispatchClockShortcut(payload)` を呼ぶ。
   - 既存 `hall:forwarded-key`（renderer.js:7712）は `appRole==='operator'`（2画面時）限定で **単一モードでは発火しない**ため、そのままは使えない。
