# ポケリス

写真からメルカリ・楽天ラクマ向けの出品下書きを作る、iPhone向けWebアプリです。

このリポジトリには、姉妹ツール **「ストーリー主」**（`/insta.html`）も含まれます。Instagramストーリーのスクリーンショットから、画面に表示された情報をもとに投稿主のアカウントを特定します（詳細は下記「ストーリー主」を参照）。

## 旧版との違い

- Anthropic APIキーをブラウザへ保存しません
- 写真を端末内で圧縮して、通信量とAPI料金を抑えます
- Claude Sonnet 5のStructured Outputsで、壊れにくい出品データを生成します
- 商品名は40文字を監視し、生成後も編集・コピーできます
- 下書きをiPhone内へ保存できます
- ホーム画面に追加できるPWAです
- 写真から分からない型番やブランドを断定しない設計です

## 公開先

この版はAPIキーを安全に隠すため、GitHub Pagesではなく **Vercel** に公開します。Vercelの無料枠で始められます。

## 公開手順

### 1. GitHubへファイルを置く

新しいリポジトリ（例：`pokelis`）を作り、このフォルダの中身をすべてアップロードします。

`index.html`だけではなく、次も必要です。

- `api/`（`generate.js` と `identify.js`）
- `assets/`
- `.gitignore`
- `app.js`
- `insta.js`
- `index.html`
- `insta.html`
- `manifest.webmanifest`
- `package.json`
- `service-worker.js`
- `styles.css`
- `vercel.json`

### 2. Vercelに登録する

1. [Vercel](https://vercel.com/)でGitHubアカウントを使って登録
2. **Add New → Project**
3. GitHubの`pokelis`リポジトリを選択して**Import**
4. Framework Presetは`Other`のままでOK

### 3. 秘密情報を設定する

Vercelのプロジェクト画面で **Settings → Environment Variables** を開き、次の2つを追加します。

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...`で始まるAPIキー |
| `APP_PIN` | 自分だけが知っている8文字以上のPIN（英数字推奨） |

APIキーやPINをGitHubのファイルへ直接書かないでください。

### 4. 公開する

**Deploy**を押します。発行された`https://xxxxx.vercel.app`をiPhoneのSafariで開きます。

最初に「設定」から、Vercelへ設定したものと同じ`APP_PIN`を入力してください。

### 5. iPhoneのホーム画面へ追加

Safari下部の共有ボタン → **ホーム画面に追加** → **追加**。

## 注意

- 個人向けメルカリ・楽天ラクマへの自動投稿は行いません。生成内容を確認し、公式アプリへ手動で貼り付けてください。
- 価格はリアルタイムの成約相場ではなく、写真と入力情報をもとにした参考値です。
- URLやPINを第三者へ共有すると、その人があなたのAPI残高を利用できる可能性があります。
- Vercelへ環境変数を追加・変更した後は再デプロイしてください。

## ストーリー主（スクショからアカウント特定）

`/insta.html` で開ける姉妹ツールです。Instagramストーリーのスクリーンショットを1枚選ぶと、AIが画面に表示された文字（ユーザー名・表示名・認証バッジ・メンション・キャプションなど）を読み取り、投稿主のアカウントを推定して「Instagramで開く」リンクを表示します。

### しくみ・使い方

- スクショを選ぶ → 「アカウントを特定する」を押すだけ。
- 認証にはポケリスと同じ `APP_PIN` を使います。追加の環境変数は不要です。
- 判定はサーバーの `api/identify.js` が Anthropic API（Structured Outputs）で行います。
- ポケリスの「設定 → 関連ツール」からも開けます。

### 設計上の約束

- **画面に文字として写っている情報だけ**を根拠にします。読み取れないユーザー名を推測で創作しません。
- 顔や容姿から個人を推定することはしません。
- ユーザー名として妥当な文字（英数字・`.`・`_`、30文字以内）のみを採用し、`https://www.instagram.com/<username>/` のリンクを生成します。
- 画像やアカウント情報を端末外・サーバーに保存しません。
- 特定結果は画面表示に基づく推定です。嫌がらせやプライバシーを侵害する目的で使わないでください。

## APIモデル

`api/generate.js`（出品文生成）と `api/identify.js`（アカウント特定）の`MODEL`で`claude-sonnet-5`を使用しています。
