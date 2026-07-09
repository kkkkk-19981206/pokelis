# ポケリス

写真からメルカリ・楽天ラクマ向けの出品下書きを作る、iPhone向けWebアプリです。

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

- `api/`
- `assets/`
- `.gitignore`
- `app.js`
- `index.html`
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

## APIモデル

`api/generate.js`の`MODEL`で`claude-sonnet-5`を使用しています。
