# PokerTimerPLUS+ リリース手順

このドキュメントは、新しいバージョンを GitHub に公開するための手順です。

GitHub リポジトリ: <https://github.com/maetomo08020802-eng/PokerTimerPLUS>

---

## v2.0.4 リリース（v1.3.0 → v2.0.4 アップグレード）

v2.0.4 は v1.3.0 を**置き換える形**で配布します。`appId` / `productName` を v1.3.0 と同じに揃えてあるため、ユーザーは新インストーラを実行するだけで自動的にアップグレードされます（既存設定・トーナメントデータは保持）。

ビルド済 `.exe` は `dist/PokerTimerPLUS+ Setup 2.0.4.exe`（CC が生成済）。本セクションの手順は前原さんが Git Bash で実行します。

### 手順 1: feature ブランチを main にマージ

「Git Bash」を起動して、以下のコマンドを 1 行ずつ実行してください:

```bash
cd C:/Users/user/Documents/Claude/Projects/個人アシスタント/poker-clock

# 念のため作業ツリーがクリーンか確認
git status

# main ブランチに切り替え
git checkout main

# main を最新化（リモートに変更がない場合はスキップされます）
git pull --ff-only origin main

# feature ブランチを main にマージ（fast-forward の代わりに merge コミット作成）
git merge --no-ff feature/v2.0.4-rc1-test-build -m "Merge v2.0.4 final into main"

# main を push
git push origin main
```

**注意**: `git push` は初回認証時に Personal Access Token (PAT) が必要です。発行手順は本文書下部「Personal Access Token (PAT) の発行」セクション参照。

### 手順 2: タグを打って push

```bash
# v2.0.4 タグを作成
git tag v2.0.4

# タグを push
git push origin v2.0.4
```

### 手順 3: GitHub Releases ページで .exe を公開

1. <https://github.com/maetomo08020802-eng/PokerTimerPLUS/releases> にアクセス
2. 「**Draft a new release**」をクリック
3. 入力:
   - **Choose a tag**: 既存の `v2.0.4` タグを選択（手順 2 で push 済）
   - **Release title**: `v2.0.4 - HDMI 2 画面対応 + 致命級バグ修正`
   - **Description**: 配布対象向けに、`CHANGELOG.md` の `## [2.0.4] - 2026-05-03` セクションをコピー&ペースト
   - **Attach binaries**: `dist/PokerTimerPLUS+ Setup 2.0.4.exe` をドラッグ&ドロップでアップロード
   - 同じく `dist/latest.yml`（自動更新マニフェスト）もアップロード推奨（既存ユーザーの自動更新通知に必要）
4. 「**Publish release**」ボタン

これで配布完了。誰でも Releases ページから `.exe` をダウンロード可能。v1.3.0 ユーザーは既存アプリを起動すると `electron-updater` が新バージョンを検知して通知します（`latest.yml` を Release に添付した場合）。

### 手順 4: 配布告知（任意・前原さん判断）

告知テンプレート例:

```
PokerTimerPLUS+ v2.0.4 を公開しました。
v1.3.0 → v2.0.4 へのアップグレードはインストーラを実行するだけで自動的に置き換わります（設定・トーナメントデータは保持されます）。

主な変更:
・HDMI 自動 2 画面対応（会場モニター + 手元 PC）
・HDMI 抜き差し時のレイアウト自動切替
・致命的バグ 2 件修正（タイマー画面消失問題、HDMI 抜き時の同期問題）

ダウンロード: https://github.com/maetomo08020802-eng/PokerTimerPLUS/releases/tag/v2.0.4
変更履歴: https://github.com/maetomo08020802-eng/PokerTimerPLUS/blob/main/CHANGELOG.md
```

---

## (履歴) 初回リリース（v1.3.0）

### 手順 1: コードを GitHub にアップロード（git push）

「Git Bash」を起動して、以下のコマンドを 1 行ずつ実行してください:

```bash
cd C:/Users/user/Documents/Claude/Projects/個人アシスタント/poker-clock
git push -u origin main
```

- 初回は GitHub のユーザー名 + パスワード（または Personal Access Token）の入力を求められます
- パスワード認証は 2021 年に廃止されているため、**Personal Access Token (PAT)** を使う必要があります
- PAT 発行手順は次セクション参照

### Personal Access Token (PAT) の発行（初回のみ）

1. GitHub にログイン → 右上のプロフィール → **Settings**
2. 左メニュー一番下「**Developer settings**」をクリック
3. 「**Personal access tokens**」→「**Tokens (classic)**」
4. 「**Generate new token**」→「**Generate new token (classic)**」
5. 入力:
   - **Note**: `PokerTimerPLUS push` など分かりやすい名前
   - **Expiration**: `90 days`（任意、長くしすぎない方が安全）
   - **Scope**: **`repo`** にだけチェック（他は不要）
6. 一番下の「**Generate token**」ボタン
7. 表示された token（`ghp_xxxxxxxxxxxx` 形式）を**コピー**

   ⚠️ **このページから離れると二度と表示されません**。必ずすぐコピー → 安全な場所（パスワードマネージャ等）に保管してください。

`git push` 時にパスワード入力欄でこの token を貼り付ければ OK。

### 手順 2: GitHub Releases ページで .exe を公開

1. <https://github.com/maetomo08020802-eng/PokerTimerPLUS/releases> にアクセス
2. 「**Create a new release**」または「**Draft a new release**」をクリック
3. 入力:
   - **Choose a tag**: `v1.3.0` を入力 → 「Create new tag: v1.3.0 on publish」を選択
   - **Release title**: `v1.3.0 - 初回リリース`
   - **Description**: 配布対象向けに、`CHANGELOG.md` の v1.3.0 セクションをコピー&ペースト
   - **Attach binaries**: `dist/PokerTimerPLUS+ Setup 1.3.0.exe` をドラッグ&ドロップでアップロード
     - ※ ファイルサイズが 100MB 超の場合は GitHub のアップロード制限に注意（通常は問題なし）
4. 「**Publish release**」ボタン

これで配布完了。誰でも Releases ページから `.exe` をダウンロードできます。

### 手順 3: 配布開始の周知

- 全国のポーカールームに Releases ページの URL を案内
- README.md にも Releases ページのリンクを記載済（GitHub 側でも自動表示）

---

## 次回以降のリリース（v2.0.5 / v2.1.0 など）

### 手順 1: バージョン変更
- `package.json` の `version` を新値に変更（例: `"version": "2.0.5"`）
- `CHANGELOG.md` に新セクション追加（先頭に追加）

### 手順 2: ビルド + コミット + push

```bash
cd C:/Users/user/Documents/Claude/Projects/個人アシスタント/poker-clock

# 古いビルド成果物をクリーン
rm -rf dist

# Windows 用 .exe を生成
npm run build:win

# 変更をコミット
git add .
git commit -m "Release v2.0.5"

# タグを打つ（バージョン番号を v 付きで）
git tag v2.0.5

# push（main ブランチ + タグ）
git push
git push --tags
```

### 手順 3: GitHub Releases で公開

v2.0.4 と同じ手順で:
1. Releases ページで「Draft a new release」
2. **Choose a tag**: 既存の `v2.0.5` タグを選択（push --tags で公開済）
3. Release title / Description / Attach binaries（`.exe` + `latest.yml`）を入力
4. **Publish release**

公開した瞬間から、既存ユーザーが次回起動時に**自動更新通知**を受け取ります（electron-updater が動作、`latest.yml` 添付必須）。

---

## トラブルシューティング

### `git push` が「Authentication failed」になる
- パスワードを直接入力していませんか？ パスワード認証は廃止されています
- Personal Access Token (PAT) を使ってください（前述の手順）
- それでもダメな場合: Windows の認証情報マネージャに古い認証情報が残っている可能性 → コントロールパネル → 資格情報マネージャー → Windows 資格情報 → `git:https://github.com` を削除 → 再度 push 試行

### ビルドが失敗する（`npm run build:win`）
- まず `npm install` を実行して依存関係を最新化
- それでも失敗する場合は、`dist/` を削除してから再実行
- ネットワーク経由でダウンロードされるバイナリ（electron 本体）が取得できないと失敗します。インターネット接続を確認

### `dist/` に `.exe` ができない
- `package.json` の `build` セクション（特に `build.appId` / `build.productName` / `build.win`）が壊れていないか確認
- electron-builder のログで赤字エラーを確認

### Windows SmartScreen が「不明な発行元」と警告する
- これは**コード署名がない場合の正常な動作**で、不具合ではありません
- ユーザーには「詳細情報」→「実行」をクリックするよう案内
- 将来的に EV コード署名証明書を取得すれば警告抑止可能（年間数万円）

### 自動更新が動かない
- `package.json` の `build.publish` が GitHub provider + 正しい owner/repo になっているか確認
- 公開した Release に `latest.yml` が含まれているか確認（`electron-builder` が自動生成）
  - 含まれていない場合、Release Assets に手動で `latest.yml`（dist/ 内）をアップロード
- 配布バージョンと Release タグの version が一致しているか確認（例: `v2.0.5` タグと `package.json` の `2.0.5`）

---

## チェックリスト（毎回リリース前に確認）

リリースのたびに以下を確認してください:

- [ ] `package.json` の `version` を新値に更新した
- [ ] `CHANGELOG.md` に新セクションを追加した
- [ ] `npm test` がすべて PASS
- [ ] `npm run build:win` が成功し、`dist/` に `.exe` と `latest.yml` がある
- [ ] `git push` + `git push --tags` 完了
- [ ] GitHub Releases に新リリースを Publish
- [ ] `.exe` をローカルでインストールしてみて起動確認
- [ ] 既存ユーザーの実機で自動更新通知が出るか確認（次回バージョンで）

---

## 重要な注意

- **OAuth トークン / credentials.json は絶対に git に追跡させない**（`.gitignore` で除外済）
- **`dist/` フォルダは push しない**（ビルド成果物、リポジトリを肥大化させる）
- **`node_modules/` は push しない**（`package.json` から再構築可能）

困ったら CC（構築士）に相談してください。
