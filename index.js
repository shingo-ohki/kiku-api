require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { OpenAI } = require('openai')
const rateLimit = require('express-rate-limit')

const app = express()
const PORT = process.env.PORT || 3001

// Railway/Proxy 経由のクライアントIPを取得するため
// X-Forwarded-For を信頼（express-rate-limit の警告対策）
app.set('trust proxy', 1)

// OpenAI クライアント
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// レート制限設定
// 短期制限: bot 対策（1分間に5回まで）
const shortTermLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分
  max: parseInt(process.env.RATE_LIMIT_SHORT_MAX || '5'),
  message: { error: '短時間に多くのリクエストが送信されました。少し時間をおいてから再度お試しください。' },
  standardHeaders: true,
  legacyHeaders: false,
})

// 長期制限: コスト保護（1時間に50回まで）
const longTermLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1時間
  max: parseInt(process.env.RATE_LIMIT_LONG_MAX || '50'),
  message: { error: '1時間あたりの利用上限に達しました。しばらく時間をおいてから再度お試しください。' },
  standardHeaders: true,
  legacyHeaders: false,
})

// ミドルウェア
app.use(cors())
app.use(express.json())

// JST タイムスタンプ生成
function getJSTTimestamp() {
  const now = new Date()
  const jstOffset = 9 * 60 // JST は UTC+9
  const jstTime = new Date(now.getTime() + jstOffset * 60 * 1000)
  return jstTime.toISOString().replace('Z', '+09:00')
}

// システムプロンプト（共通）
const SYSTEM_PROMPT = `あなたは KIKU（きく）です。

KIKUは、
意見が生まれる前の段階で、
「どう聞けばいいか分からない人」と一緒に
問いの下書きを考えるためのアシスタントです。

【してはいけないこと】
- 意見を評価しない
- 回答を判断しない
- 正解・最適解・結論を示さない
- 政策・施策・改善案を提案しない
- 回答者に責任や義務を負わせない

【すること】
- 参加の心理的ハードルを下げる
- 日常の経験や感じ方を思い出してもらう
- 中立で安全な問いの「下書き」を提示する
- 「書かなくてもよい」「答えなくてもよい」余白を残す

出力する問いは、すべて「下書き」である。
完成形や権威あるものとして提示してはならない。

【特に注意する言葉】
以下の言葉は、問いの入口を不必要に上げてしまうため、
原則として使用しないこと。
- 関心がある／関心がない
- 参加／参加意欲
- 考えてください
- 意見を述べてください
- 評価してください
- 重要だと思いますか

【概念の言い換えルール】
「使わない」ではなく「こう言い換える」：
- 「関心」 → 「距離感」「生活の中での位置」
- 「参加」 → 「関わること」「思い出すこと」
- 「考える」 → 「思い出す」「ふと感じる」
- 「意見」 → 「感じ方」「印象」`

// default モードのプロンプト
const DEFAULT_PROMPT = `【前提】
ユーザーは、何かについて声を聞きたいと思っているが、
どこから、どう聞けばよいか分からない状態である。

【タスク】
参加しやすく、心理的に安全な
問いの下書きを作成する。

【問いの姿勢】
- 利用経験や接触経験から聞き始める
- 評価・判断・要望を求めない
- 回答者について何も仮定しない
- 中立で落ち着いた語調を保つ

【問いごとの役割（固定）】

問い①：
- 目的：回答者が「正しい／間違い」を考えずに、
  過去の経験や記憶を思い出せる状態を作る
- 禁止：評価・理由・関心・意見を問うこと

問い②：
- 目的：距離感や印象を、
  選択肢によって安全に表現できるようにする
- 禁止：態度・賛否・重要性を問うこと

問い③：
- 目的：書ける人だけが、
  条件やきっかけを自然に書ける余白を残す
- 必須条件：「書かなくてもよい」を必ず明示する

【構成】
1. 問いの構成についての短い説明
2. 問い①：経験や利用状況を思い出す問い（選択式）
3. 問い②：印象や感じ方を選びやすく聞く問い（選択式）
4. 問い③：書けたら書ける問い（自由記述・任意）

【言葉づかい】
- 命令形を使わない
- 「〜すべき」を使わない
- 評価語を使わない
- 自由記述は必ず任意と明示する

【出力形式】
以下のJSON形式で出力してください：
{
  "explanation": "問いの構成についての短い説明",
  "questions": [
    {
      "number": 1,
      "title": "問い①のタイトル",
      "text": "問い①の本文",
      "type": "choice",
      "options": ["選択肢1", "選択肢2", "選択肢3"]
    },
    {
      "number": 2,
      "title": "問い②のタイトル",
      "text": "問い②の本文",
      "type": "choice",
      "options": ["選択肢1", "選択肢2", "選択肢3"]
    },
    {
      "number": 3,
      "title": "問い③のタイトル（任意）",
      "text": "問い③の本文\\n（書かなくても大丈夫です）",
      "type": "text"
    }
  ],
  "note": "※ この問いは、意見を評価するためのものではありません。\\n日常の感じ方を知るための下書きです。"
}`

// lowered_entry モードのプロンプト
const LOWERED_ENTRY_PROMPT = `【前提】
これまであまり声が届いていなかった人や、
テーマとの接点が薄い人も想定する。

参加していないこと、関心が薄いこと、
忙しくて関われていないことは、
すべて自然な状態として扱う。

【タスク】
問いの入口をさらに下げた、
より参加しやすい問いの下書きを作成する。

【問いの姿勢】
- 利用や参加を前提にしない
- 生活文脈や距離感から聞き始める
- 関わっていないことを否定しない
- 心理的負荷を最小限にする

【問いごとの役割（固定）】

問い①：
- 目的：回答者が「正しい／間違い」を考えずに、
  過去の経験や記憶を思い出せる状態を作る
- 禁止：評価・理由・関心・意見を問うこと

問い②：
- 目的：距離感や印象を、
  選択肢によって安全に表現できるようにする
- 禁止：態度・賛否・重要性を問うこと

問い③：
- 目的：書ける人だけが、
  条件やきっかけを自然に書ける余白を残す
- 必須条件：「書かなくてもよい」を必ず明示する

【lowered_entry 追加制約】

- 「利用していない」「関わっていない」状態を
  前提として含めること
- 「なぜ〜しないのか」を連想させる表現は禁止
- 忙しさ・無関心・距離があることは
  すべて自然な状態として扱う`
- 心理的負荷を最小限にする

【構成】
1. 問いの構成についての短い説明
2. 問い①：日常の気づきや認識を聞く問い（選択式）
3. 問い②：距離感を表現しやすい問い（選択式）
4. 問い③：きっかけや条件を聞く問い（自由記述・任意）

【言葉づかい】
- 義務・責任・理由追及を感じさせない
- 「なぜ参加しないのか」と聞かない
- 日常的でやわらかい表現を使う

【出力形式】
以下のJSON形式で出力してください：
{
  "explanation": "問いの構成についての短い説明",
  "questions": [
    {
      "number": 1,
      "title": "問い①のタイトル",
      "text": "問い①の本文",
      "type": "choice",
      "options": ["選択肢1", "選択肢2", "選択肢3"]
    },
    {
      "number": 2,
      "title": "問い②のタイトル",
      "text": "問い②の本文",
      "type": "choice",
      "options": ["選択肢1", "選択肢2", "選択肢3"]
    },
    {
      "number": 3,
      "title": "問い③のタイトル（任意）",
      "text": "問い③の本文\\n（書かなくても大丈夫です）",
      "type": "text"
    }
  ],
  "note": "※ この問いは、意見を評価するためのものではありません。\\n日常の感じ方を知るための下書きです。"
}`

// ユーザープロンプトの作成
function buildUserPrompt(req, mode) {
  const modePrompt = mode === "default" ? DEFAULT_PROMPT : LOWERED_ENTRY_PROMPT

  const contextInfo = req.unheard_contexts && req.unheard_contexts.length > 0
    ? `\n\n声が届いていないと感じられる人たち：\n${req.unheard_contexts.map(c => `- ${c}`).join("\n")}`
    : ""

  return `${modePrompt}

ユーザーの状況：
テーマ：${req.theme}
背景：${req.background}${contextInfo}

上記の状況に基づいて、問いの下書きを生成してください。`
}

// JSON の検証と型変換
function parseGeneratedStructure(content) {
  // JSON ブロックを抽出
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error("JSON が見つかりません")
  }

  const parsed = JSON.parse(jsonMatch[0])

  // 型の検証と変換
  if (!parsed.explanation || !Array.isArray(parsed.questions) || !parsed.note) {
    throw new Error("必須フィールドが不足しています")
  }

  // questions の型チェック
  const questions = parsed.questions.map((q) => {
    if (!q.number || !q.title || !q.text || !q.type) {
      throw new Error("問いの必須フィールドが不足しています")
    }

    if (q.type === "choice") {
      if (!Array.isArray(q.options) || q.options.length === 0) {
        throw new Error("choice 型には options が必要です")
      }
    }

    return {
      number: q.number,
      title: q.title,
      text: q.text,
      type: q.type,
      options: q.options,
    }
  })

  return {
    explanation: parsed.explanation,
    questions,
    note: parsed.note,
  }
}

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

// 問い生成 API（レート制限適用）
app.post('/api/generate', shortTermLimiter, longTermLimiter, async (req, res) => {
  const startTime = Date.now()
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  
  try {
    const body = req.body
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.ip
    const maskedIp = clientIp.replace(/\.\d+$/, '.xxx') // 最後のオクテットをマスク

    // 入力検証
    if (!body.theme?.trim() || !body.background?.trim()) {
      console.log(JSON.stringify({
        timestamp: getJSTTimestamp(),
        requestId,
        type: 'validation_error',
        ip: maskedIp,
        error: 'theme または background が未入力'
      }))
      return res.status(400).json({ error: "theme と background は必須です" })
    }

    // mode 判定
    const mode = (body.unheard_contexts && body.unheard_contexts.length > 0)
      ? "lowered_entry"
      : "default"

    // リクエストログ
    console.log(JSON.stringify({
      timestamp: getJSTTimestamp(),
      requestId,
      type: 'request',
      ip: maskedIp,
      input: {
        theme: body.theme,
        background: body.background,
        unheard_contexts: body.unheard_contexts || [],
      },
      mode,
    }))

    // ユーザープロンプト作成
    const userPrompt = buildUserPrompt(body, mode)

    // OpenAI API 呼び出し
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 2000,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    })

    // 応答の抽出
    const content = response.choices[0].message.content || ""

    // JSON の解析
    const structure = parseGeneratedStructure(content)

    const result = {
      mode,
      structure,
    }

    // 成功ログ
    const duration = Date.now() - startTime
    console.log(JSON.stringify({
      timestamp: getJSTTimestamp(),
      requestId,
      type: 'success',
      ip: maskedIp,
      mode,
      output: {
        explanation: structure.explanation,
        questionCount: structure.questions.length,
      },
      duration,
      openai: {
        model: 'gpt-4o-mini',
        tokens: response.usage?.total_tokens || 0,
      }
    }))

    res.json(result)
  } catch (error) {
    const duration = Date.now() - startTime
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.ip
    const maskedIp = clientIp.replace(/\.\d+$/, '.xxx')
    
    // エラーログ
    console.error(JSON.stringify({
      timestamp: getJSTTimestamp(),
      requestId,
      type: 'error',
      ip: maskedIp,
      error: error.message,
      stack: error.stack,
      duration,
    }))

    if (error instanceof SyntaxError) {
      return res.status(500).json({ error: "生成結果の解析に失敗しました" })
    }

    res.status(500).json({ error: "問いの生成に失敗しました" })
  }
})

app.listen(PORT, () => {
  console.log(`KIKU API server running on port ${PORT}`)
})
