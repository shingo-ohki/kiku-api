# KIKU API

問いの下書きを生成する API サーバー（Express + OpenAI）

## 環境変数

`.env` に以下を設定します。

```
OPENAI_API_KEY=sk-proj-...
PORT=3001

# レート制限設定
RATE_LIMIT_SHORT_MAX=5    # 1分間の最大リクエスト数（bot対策）
RATE_LIMIT_LONG_MAX=50    # 1時間の最大リクエスト数（コスト保護）
```

## レート制限

**短期制限（bot 対策）**
- デフォルト: 1分間に 5回まで
- 目的: 自動スクリプトによる連続アクセスをブロック

**長期制限（コスト保護）**
- デフォルト: 1時間に 50回まで
- 目的: 過度な利用によるコスト増を防ぐ

制限超過時は `429 Too Many Requests` を返します。

## 開発（ローカル）

```bash
npm install
npm start
```

## エンドポイント

**ヘルスチェック**
```bash
GET /health
```

**問い生成**
```bash
POST /api/generate
Content-Type: application/json

{
  "theme": "公共施設の使い方",
  "background": "若い人の声が届いていない",
  "unheard_contexts": ["忙しくて参加できていない人"]
}
```

## デプロイ（Railway）

1. GitHub リポジトリを Railway に接続
2. 環境変数を設定:
   - `OPENAI_API_KEY`
   - `RATE_LIMIT_SHORT_MAX`（任意）
   - `RATE_LIMIT_LONG_MAX`（任意）
3. Public Networking を有効化
4. 生成されたドメインをフロントエンドの `NEXT_PUBLIC_API_BASE_URL` に設定

## ログ確認（Railway）

Railway のダッシュボードで「View Logs」からログを確認できます。

**ログの種類**

```json
// リクエストログ
{
  "timestamp": "2025-12-19T12:00:00.000Z",
  "requestId": "req_1234567890_abc123",
  "type": "request",
  "ip": "203.0.113.xxx",
  "input": {
    "theme": "公共施設の使い方",
    "background": "若い人の声が届いていない",
    "unheard_contexts": ["忙しくて参加できていない人"]
  },
  "mode": "lowered_entry"
}

// 成功ログ
{
  "timestamp": "2025-12-19T12:00:03.000Z",
  "requestId": "req_1234567890_abc123",
  "type": "success",
  "ip": "203.0.113.xxx",
  "mode": "lowered_entry",
  "output": {
    "explanation": "この問いは...",
    "questionCount": 3
  },
  "duration": 3250,
  "openai": {
    "model": "gpt-4o-mini",
    "tokens": 850
  }
}

// エラーログ
{
  "timestamp": "2025-12-19T12:00:00.000Z",
  "requestId": "req_1234567890_abc123",
  "type": "error",
  "ip": "203.0.113.xxx",
  "error": "JSON が見つかりません",
  "duration": 2100
}
```

**プライバシー配慮**
- IP アドレスは最後のオクテットをマスク（`xxx`）
- 入力内容はそのまま記録（改善に活用）
- ログは Railway 側で一定期間後に自動削除
