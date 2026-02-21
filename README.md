# 開催判断くん

> イベントの開催日時と開催場所を入力するだけで、Gemini AI がインターネット情報を収集し、開催の可否を判定するWebアプリ

🔗 **[アプリを開く](https://[your-username].github.io/kaisai-handan/)**

## 機能

- **リアル開催** の場合: 天気予報・地震情報・事件事故情報・計画運休を調査
- **オンライン開催** の場合: 大規模地震・通信障害（NTT/KDDI）・Zoom障害を調査
- 各項目を **問題なし✅ / 注意事項あり⚠️ / 危険🛑** の3段階で表示
- 参考リンク付きで根拠情報を提示

## 技術スタック

| 項目 | 技術 |
|------|------|
| フロントエンド | HTML / CSS / JavaScript |
| AI | Gemini 2.0 Flash + Google Search Grounding |
| SDK | `@google/genai` |
| ビルド | Vite |
| ホスティング | GitHub Pages |
| CI/CD | GitHub Actions |

## セットアップ（ローカル開発）

```bash
# 1. クローン
git clone https://github.com/[your-username]/kaisai-handan.git
cd kaisai-handan

# 2. 依存関係のインストール
npm install

# 3. 開発サーバー起動
npm run dev
# → http://localhost:5173 でアクセス
```

## デプロイ設定（GitHub Pages）

1. GitHub リポジトリの **Settings > Secrets and variables > Actions** を開く
2. `GEMINI_API_KEY` という名前で Gemini API キーを登録する
3. **Settings > Pages** で `Source` を `GitHub Actions` に設定する
4. `main` ブランチに push すると自動デプロイされます

## アプリの仕組みとGeminiモデルの更新

このアプリは、ユーザーのブラウザ上で `@google/genai` SDK を介して直接 Gemini API にリクエストを送信しています。
使用している AI モデル（例: `gemini-3-flash-preview`）が提供終了（非推奨化）になった場合、以下のファイルの該当箇所を最新のモデル名に書き換えるだけで対応できます。

**修正するファイル:** `src/main.js`

```javascript
    const response = await ai.models.generateContent({
        // 👇 ここのモデル名を変更するだけです
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
            tools: [{ googleSearch: {} }],
        }
    })
```

## APIキーについて

> [!NOTE]
> 静的ホスティング（GitHub Pages）に対応するため、APIキーはユーザーがブラウザの画面上から直接入力する方式に変更しています。入力されたAPIキーは画面のJSメモリ上にのみ保持され、サーバーやログには保存されません。
