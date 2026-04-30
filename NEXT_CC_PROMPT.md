# フェーズC.3-A: 配布準備（GitHub リポジトリ初回プッシュ + ビルド検証）

## 状況
v1.3.0 配布準備フェーズ。GitHub リポジトリが作成された:
- URL: https://github.com/maetomo08020802-eng/PokerTimerPLUS
- owner: `maetomo08020802-eng`
- repo: `PokerTimerPLUS`
- 公開設定: Public（ユーザーが手動作成、初期ファイルなし）

構築士で以下を直接編集済:
- `package.json`: `build.publish` に owner/repo を追加（autoUpdate 有効化）
- `README.md`: GitHub URL + Releases ページリンクを追記
- `CHANGELOG.md`: 自動更新の文言を「v1.3.1 以降で動作」に修正
- `.gitignore`: OAuth トークン / credentials.json / Python キャッシュを除外

---

## ⚠️ スコープ制限（厳守）

**本フェーズで実装するのは以下のみ:**
1. 既存 138 テスト全 PASS 再確認
2. Windows ビルド検証（`npm run build:win`）→ `dist/` に `.exe` 生成確認
3. git 初期化（`git init`）+ 初回コミット
4. リモートリポジトリの設定（`git remote add origin ...`）
5. 前原さん向けの「最終 push 手順書」を `docs/RELEASE_GUIDE.md` として作成

**禁止事項:**
- コードの追加修正一切（致命バグ修正・既存機能・C.1.7 / C.1.8 系すべて維持）
- 既存 138 テストの動作改変
- `git push` の実行は禁止（push は前原さんが手動で行うため、最終ガイドとして手順書に記載のみ）
- OAuth トークン・credentials の git 追跡（.gitignore で除外済、念のため CC で確認）

---

## Fix 1: 既存テスト再確認 + ビルド前検証

```bash
# 全テスト実行（138 件 PASS が完了条件）
npm test

# 構文確認
node --check src/main.js
node --check src/preload.js
node --check src/renderer/renderer.js
```

すべて OK でなければ次に進まない。

---

## Fix 2: Windows ビルド検証

```bash
# 旧ビルド成果物クリーン
rm -rf dist
# Windows 用 .exe 生成
npm run build:win
```

確認項目:
- `dist/` 配下に `.exe` インストーラ（例: `PokerTimerPLUS+ Setup 1.3.0.exe`）が生成されている
- ビルドログに重大エラーなし（warning は許容）
- 配布版起動でクラッシュなし（実行確認は前原さん側）

---

## Fix 3: git 初期化 + 初回コミット

```bash
cd poker-clock
git init
git add .
git status   # 確認: token.json / credentials.json / node_modules / dist が含まれていないこと
git commit -m "Initial commit: PokerTimerPLUS+ v1.3.0"
git branch -M main
git remote add origin https://github.com/maetomo08020802-eng/PokerTimerPLUS.git
```

**重要**: `git status` で以下が **追跡されていない** ことを必ず確認:
- `node_modules/`
- `dist/`
- `*.token.json` / `*credentials.json`
- `__pycache__/`

含まれていたら `.gitignore` を再点検 + `git rm --cached <ファイル>` で除外する。

`git push` は実行しない（前原さんに任せる、後述）。

---

## Fix 4: 前原さん向けリリース手順書作成

`poker-clock/docs/RELEASE_GUIDE.md` を新規作成。内容:

### docs/RELEASE_GUIDE.md の中身（CC が書く）

```markdown
# PokerTimerPLUS+ リリース手順

このドキュメントは、新しいバージョンを GitHub に公開するための手順です。

## 初回リリース（v1.3.0）

### 手順 1: コードを GitHub にアップロード（git push）

「Git Bash」を起動して、以下のコマンドを 1 行ずつ実行してください:

\`\`\`bash
cd C:/Users/user/Documents/Claude/Projects/個人アシスタント/poker-clock
git push -u origin main
\`\`\`

- 初回は GitHub のユーザー名 + パスワード（または Personal Access Token）の入力を求められます
- パスワード認証は 2021 年に廃止されているため、**Personal Access Token (PAT)** を使う必要があります
- PAT 発行手順は次セクション参照

### Personal Access Token (PAT) の発行（初回のみ）

1. GitHub にログイン → 右上のプロフィール → Settings
2. 左メニュー一番下「Developer settings」をクリック
3. 「Personal access tokens」→「Tokens (classic)」
4. 「Generate new token」→「Generate new token (classic)」
5. 入力:
   - Note: `PokerTimerPLUS push` など
   - Expiration: 90 days（任意）
   - Scope: **`repo`** にだけチェック
6. 一番下の「Generate token」ボタン
7. 表示された token（`ghp_xxxxxxxxxxxx` 形式）をコピー

git push 時にパスワード入力欄でこの token を貼り付ければ OK。

### 手順 2: GitHub Releases ページで .exe を公開

1. https://github.com/maetomo08020802-eng/PokerTimerPLUS/releases にアクセス
2. 「Create a new release」または「Draft a new release」をクリック
3. 入力:
   - **Choose a tag**: `v1.3.0` を入力 → 「Create new tag: v1.3.0 on publish」を選択
   - **Release title**: `v1.3.0 - 初回リリース`
   - **Description**: 配布対象向けに、CHANGELOG.md からコピペ
   - **Attach binaries**: `dist/PokerTimerPLUS+ Setup 1.3.0.exe` をドラッグ&ドロップでアップロード
4. 「Publish release」ボタン

これで配布完了。誰でも Releases ページから `.exe` をダウンロードできます。

## 次回以降のリリース（v1.3.1 / v1.4.0 など）

### 手順 1: バージョン変更
- `package.json` の `version` を新値に変更
- `CHANGELOG.md` に新セクション追加

### 手順 2: ビルド + コミット + push

\`\`\`bash
npm run build:win
git add .
git commit -m "Release v1.3.1"
git tag v1.3.1
git push
git push --tags
\`\`\`

### 手順 3: GitHub Releases で公開
初回と同じ手順で、新しい `.exe` をアップロード → Publish release。

公開した瞬間から、既存ユーザーが次回起動時に自動更新通知を受け取ります（electron-updater 動作）。
```

---

## Fix 5: 最終確認

CC が以下を CC_REPORT に列挙:
1. `npm test` 結果（138/138 PASS）
2. `npm run build:win` 結果（dist/ に .exe 生成、サイズと正確なファイル名）
3. `git status` 結果（node_modules / dist / token / credentials が追跡対象外であること）
4. `git log` 結果（初回コミットが作成されたこと）
5. `git remote -v` 結果（origin が GitHub URL に紐づいていること）
6. `docs/RELEASE_GUIDE.md` が作成されたこと

---

## 完了報告フォーマット

CC_REPORT.md を C.3-A 用に書き直し:
1. サマリ（138 テスト PASS、ビルド成功、git 初期化完了）
2. 各 Fix の実行結果（ログ抜粋）
3. 構築士への質問
4. **オーナー向け最終操作手順**（RELEASE_GUIDE.md の場所 + 概要）

---

## 維持事項
- 既存 138 テスト全 PASS 維持
- 致命バグ修正（C.2.7-A / C.2.7-D / C.1.4-fix1 / C.1.7 / C.1.8）すべて完全維持
- C.1.3 / C.1.4 / C.1.6 / C.1.7 / C.1.8 系の挙動完全維持
- `<dialog>` flex 化禁止
- カード幅 / Barlow Condensed フォント不変
