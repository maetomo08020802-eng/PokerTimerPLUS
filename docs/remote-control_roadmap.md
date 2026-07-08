# remote-control（スマホ遠隔操作）ロードマップ — 正典

> 単一（通常）モードのクロックを、アプリ起動 PC 以外の端末（スマホ等）から遠隔操作する新機能の設計正典。
> 方式比較・問題点22項目・既存資産・出典行番号の一次情報は `.cc-reports/2026-07-08_remote-control-investigation.md`。
> 本ファイルは全体地図 + ゲート項目 + Phase 0 結果 + Phase 1 設計含意を集約する。

## 1. 目的 / 使う場面
- 会場で、PC の前を離れていても、手元のスマホで **リエントリー・アドオン・エントリー追加・脱落・タイマー操作等（全操作）** を行いたい。
- 対象は **単一（通常）モードのみ**。マルチ4分割は対象外。

## 2. 前原 確定事項（壁打ち 2026-07-08）
1. 方式 = **LAN シンクライアント**（PC の main プロセスに組込みローカル Web サーバ → スマホの普通のブラウザで操作UI）。Bluetooth 不採用。
2. 接続の発見 = **QR コード**（起動時に自 LAN IP を取得し `http://<IP>:<port>` の QR を画面表示。IP 手入力は不可）。2 台 PC 運用は各 PC 別 IP=別 QR=別 PIN で分離。
3. 認証 = **PIN**（PC ごとに別）。
4. 操作対象 = **全操作**。
5. 危険操作 = **(a) スマホ側にも確認ダイアログを挟んで全部できる**（PC 限定にはしない）。
6. 追加ライブラリ = **原則なし**（Node 標準 `http` のみ。コマンド=POST、状態表示=SSE）。
7. スコープ = **単一モードのみ**。

## 3. 全体フェーズ地図
```
Phase 0（完了 2026-07-08）技術検証スパイク＝「会場で本当に繋がるか」を先に潰す
   └ 隔離スパイク spike-remote-control/（本体 src 無改変・main 未 merge）
        │
        ▼
【前原ゲート判断（GO/NO-GO）】← §5
   ・完全ローカル動作の不変条件を「LAN内通信に限り許容」へ正式改訂するか（No なら不成立）
   ・会場 Wi-Fi/ファイアウォールのハードル受容（6-B 実機結果を見て）
        │
        ▼（GO のみ）
Phase 1 本実装（別 brief・認証境界=フルフロー/push前確認必須）
   ・組込みサーバの main 常設（起動/停止・ポート・LANバインド）
   ・renderer に operator-solo でも受信する remote:op リスナー（dispatchClockShortcut を呼ぶだけ）
   ・PIN 認証 + トークン + Origin 検証 + レート制限
   ・状態表示（SSE）/ 危険操作のスマホ側確認UX / 卓名表示
   ・QR 生成（IP は取得済・画像化のみ）/ ファイアウォール例外の案内
   ・単一モード後方互換（サーバ OFF で現行完全同一）/ node 単体テスト
        │
        ▼
配信（前原 GO 後・.exe ビルド・GitHub Release）
```

## 4. Phase 0 の結果（要約・詳細は report）
- **成立**: Node 標準 http のみ（追加ライブラリ0）で LAN サーバ + PIN 認証 + 全17操作の写像 + LAN IP 自動発見が動作（harness 10/10・別プロセス curl で onOp 発火確認）。
- **主要発見**: 遠隔入力の受信配線 `hall:forwarded-key`（renderer.js:7712）は `appRole === 'operator'`（2画面時）限定。**単一モード = operator-solo は受信しない** → Phase 1 は operator-solo でも受信する専用 `remote:op` リスナーの追加が必須（`dispatchClockShortcut` は呼ぶだけ・無改変）。
- **全操作の土台**: 全操作が `dispatchClockShortcut` の `event.code`+修飾キーで到達可能（写像表 = `spike-remote-control/op-map.js`）。「全操作リモート化」は写像を足すだけで届く。
- **会場リスク（6-B/運用）**: Windows ファイアウォール初回 inbound 許可・会場 Wi-Fi の AP アイソレーション（端末間遮断なら物理的に不可）・DHCP で IP 変動（→ QR で毎回案内）。これらは実機（クリーン PC / 会場想定 Wi-Fi）で確認が必要。

## 4.5 Phase 1 進捗（2026-07-08・前原 GO 後）

- **Phase 1a（完了）**: 認証境界7層（PIN / Origin / Host 厳格アンカー / Content-Type / レート制限 / 未知op破棄 / ACAO 非返却）+ サーバ main 常設（設定トグル default OFF）+ 配線点①②（operator-solo でも受信）+ 完全ローカル文言の LAN 例外改訂 + 後方互換。cc-review2 承認・懸念ゼロ。
- **Phase 1b-core（完了）**: セッショントークン（`/api/auth` 発行・`/api/op` と `/api/events` はトークン必須・PIN 毎送信を撤去・256bit メモリ限定・OFF/PIN再生成/idle で失効・失効時は開いている SSE も即 close）+ 状態 SSE（人数/RE/AO/特殊/卓名・**案A=fetch streaming + Authorization ヘッダ**でトークンを URL に出さない・読み取り専用）+ 危険操作のスマホ側 confirm + 卓名表示。認証7層は弱めず上載せ。
- **Phase 1b-qr（実装予定）**: 接続 URL の QR 生成（PIN は含めない・vendored 単一 MIT ファイルで依存ゼロ・CSP 無改変）。1a のテキスト URL 表示は既に稼働のため、QR は接続の利便性向上（切り出しサブステップ）。
- **Phase 1c（未着手）**: ファイアウォール例外案内 / .exe ビルド / リリースノート / 前原 GO で配信（1c merge 前に spike 同梱可否を判断）。

## 5. 前原ゲート項目（GO/NO-GO の判断材料）
1. **★完全ローカル動作の不変条件の改訂可否**（下記文言案）。No なら本案件は不成立。
2. QR 画像生成に小さな依存（vendored 単一ファイル or npm `qrcode`）を許すか（IP 発見自体は依存ゼロで成立済）。
3. 会場の Wi-Fi/ファイアウォール/セキュリティソフトのハードルを運用で受容できるか（6-B 実機結果次第）。
4. Phase 1 の認証強度（PIN のみ / PIN+トークン+Origin 検証）。

## 6. 完全ローカル動作 不変条件の改訂"案"（Phase 1 前に前原承認 → 実改訂）
- 現行: CLAUDE.md:51,93 / docs/specs.md:675「npm install 以外の外部ネットワーク通信を実装しない / ユーザーデータをアプリ外に送信しない（完全ローカル動作）」。
- **改訂案（追記）**: 「ただし **同一 LAN 内に閉じた遠隔操作サーバ**（インターネットに接続しない・外部送信しない・LAN 内の端末とのみ通信）は例外として許容する。クラウド/インターネット経由の通信・外部サーバへのデータ送信は引き続き禁止。」
- Phase 0 では**実ファイルを改訂しない**（改訂案の提示のみ）。

## 7. 設計含意（Phase 1 の要点）
- サーバは **main プロセス側**（renderer は contextIsolation/sandbox でソケット不可）。
- runtime を変える操作は **既存 `setRuntime`→`sanitizeRuntime`→debounce 永続化 を必ず経由**（独自書込経路を作らない＝致命バグ保護⑤を割らない）。
- スマホ UI は **別オリジンで配信**し、本体 renderer の CSP（`script-src 'self'`）を緩めない。
- 危険操作（reset 等）はスマホ側 confirm（前原決定 (a)）。写像表の `DANGEROUS` 集合を起点に。

## 8. スコープ外（将来）
- マルチ4分割モードの遠隔操作 / 複数スマホの権限管理 / HTTPS 化 / mDNS 自動発見。

## 9. 配信手順（Phase 1c・**前原の最終 GO 後に一度だけ**実行）

> ⚠️ **前提**: 下記 6-B 実機の前原確認が OK であること。この前提が満たされるまで配信しない。
> - 6-B: 会場想定 Wi-Fi 疎通 / クリーン PC のファイアウォール初回許可 / AP アイソレーション影響 / QR スキャン / トークン接続 / 状態追従 / 失効。
> ⚠️ CC は 1c 実装フェーズで**この手順を実行しない**（準備物を揃えるところまで）。実行は前原 GO 後。

**前原確認事項（配信前に確定）**:
- **バージョン採番**: 構築士2 推奨 = **v2.8.0**（新機能追加・後方互換維持ゆえマイナー bump）。
- **`spike-remote-control/` 除去**: 構築士2 推奨 = **除去**（Phase 0 スパイク＝PIN 一段のみの未強化認証コード。`src/remote/` へ昇格済＝役目終了。配信リポジトリに未強化コードを載せない）。履歴には残るので後から参照可。

**手順（前原 GO 後・一度だけ）**:
0. **（前原承認済なら）`git rm -r spike-remote-control/`** をコミット（feature ブランチ内・履歴保持）。※ 除去しない判断なら README に「参照用・未強化・本番非使用」を明記し electron-builder の `files` から除外。
1. `feature/remote-control-phase1` → **main へ merge**。
2. **バージョン bump**: `package.json` の `version` を `2.8.0` に更新（About 画面は `app.getVersion()` 参照ゆえ自動追従・CHANGELOG 見出しの日付を配信日に確定）。
3. **tag 付与**: `git tag v2.8.0`。
4. **main push**（tag も push）。
5. **.exe ビルド（署名込み）**: `npm run build:win`（署名は前原環境）。
6. **GitHub Release 作成** + `.exe` / `latest.yml`（自動更新用）アップロード。
7. **Latest 指定**（自動更新が拾う）。

> ※ バージョン文字列を書き込む実体は `package.json` version と CHANGELOG 見出しのみ（About 画面・ウィンドウタイトルは実行時に `app.getVersion()` から取得＝手動書換不要）。GO 前は実 bump commit を打たない。
