import { GoogleGenAI } from '@google/genai'

// ===========================
// DOM References
// ===========================
const apiKeyInput = document.getElementById('api-key')
const eventDateInput = document.getElementById('event-date')
const btnReal = document.getElementById('btn-real')
const btnOnline = document.getElementById('btn-online')
const locationGroup = document.getElementById('location-group')
const eventLocationInput = document.getElementById('event-location')
const checkBtn = document.getElementById('check-btn')
const retryBtn = document.getElementById('retry-btn')

const loadingSection = document.getElementById('loading-section')
const errorSection = document.getElementById('error-section')
const errorMessage = document.getElementById('error-message')
const resultSection = document.getElementById('result-section')
const overallCard = document.getElementById('overall-card')
const overallBadge = document.getElementById('overall-badge')
const overallSummaryEl = document.getElementById('overall-summary')
const itemsContainer = document.getElementById('items-container')

// ===========================
// State
// ===========================
let eventType = 'real' // 'real' | 'online'

// ===========================
// Toggle Event Type
// ===========================
function setEventType(type) {
    eventType = type
    if (type === 'real') {
        btnReal.classList.add('active')
        btnOnline.classList.remove('active')
        locationGroup.classList.remove('hidden')
    } else {
        btnOnline.classList.add('active')
        btnReal.classList.remove('active')
        locationGroup.classList.add('hidden')
        eventLocationInput.value = ''
    }
}

btnReal.addEventListener('click', () => setEventType('real'))
btnOnline.addEventListener('click', () => setEventType('online'))

// ===========================
// UI Helpers
// ===========================
function showSection(section) {
    loadingSection.classList.add('hidden')
    errorSection.classList.add('hidden')
    resultSection.classList.add('hidden')
    if (section) section.classList.remove('hidden')
}

function statusEmoji(status) {
    if (status === 'ok') return '✅'
    if (status === 'warn') return '⚠️'
    if (status === 'danger') return '🛑'
    return '❓'
}

function statusLabel(status) {
    if (status === 'ok') return '問題なし'
    if (status === 'warn') return '注意事項あり'
    if (status === 'danger') return '危険'
    return '不明'
}

function renderResults(data) {
    // Overall Card
    const overall = data.overall
    overallCard.className = `card overall-card status-${overall.status}`
    overallBadge.textContent = statusEmoji(overall.status)
    overallSummaryEl.textContent = overall.summary

    // Items
    itemsContainer.innerHTML = ''
    data.items.forEach((item, i) => {
        const card = document.createElement('div')
        card.className = `item-card status-${item.status}`
        card.style.animationDelay = `${i * 0.08}s`

        const isOk = item.status === 'ok'

        const linksHtml =
            item.links && item.links.length > 0
                ? `<div class="item-links">${item.links
                    .map(
                        (l) =>
                            `<a class="item-link" href="${escapeAttr(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.text)}</a>`
                    )
                    .join('')}</div>`
                : ''

        card.innerHTML = `
      <div class="item-header">
        <span class="item-title">${escapeHtml(item.title)}</span>
        <span class="status-badge-inline ${item.status}">
          ${statusEmoji(item.status)} ${statusLabel(item.status)}
        </span>
      </div>
      <p class="item-detail${isOk ? ' ok-msg' : ''}">${escapeHtml(item.detail)}</p>
      ${linksHtml}
    `
        itemsContainer.appendChild(card)
    })

    showSection(resultSection)
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;')
}

// ===========================
// Prompt Builder
// ===========================
function buildPrompt(date, type, location) {
    const dateStr = date // yyyy-mm-dd
    const today = new Date().toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    })

    const responseFormat = `
以下のJSON形式のみで回答してください。マークダウンや説明文は不要です。JSONブロックだけを出力してください。

{
  "overall": {
    "status": "ok|warn|danger",
    "summary": "全体的なまとめ（2〜3文程度）"
  },
  "items": [
    {
      "title": "項目名",
      "status": "ok|warn|danger",
      "detail": "問題なしの場合は「現時点で問題となる情報は確認されていません。」と記載。問題がある場合は具体的な内容を記載。",
      "links": [
        { "text": "リンクテキスト", "url": "https://..." }
      ]
    }
  ]
}

statusの基準:
- ok: 問題なし
- warn: 注意が必要な情報あり
- danger: 重大な問題あり

全体のステータス (overall.status) は各 items の中で最も深刻なステータスに合わせること。
重要な指示: 全ての項目において、結果の如何に関わらず（「問題なし」の場合でも）、調査で実際に参考にしたWebサイトのリンクを「必ず」1つ以上 \`links\` 配列に含めて出力してください。
`

    if (type === 'real') {
        return `
あなたはイベント開催の可否を判断するアシスタントです。
今日は ${today} です。
対象イベントの開催予定日: ${dateStr}
開催場所: ${location}

Google検索を使って以下の4点を調査し、結果をまとめてください。
なお、調査対象の市区町村を開催場所から特定して調べてください（例: 「渋谷駅」→「渋谷区」）。

調査項目:
1. 天気予報 (title: "天気予報")
   - 開催場所の市区町村における ${dateStr} の天気予報を調べる
   - 大雨・台風・暴風雪など屋外イベントに影響するものがあれば warn/danger とする
   - 問題なければ ok

2. 地震情報 (title: "地震情報")
   - 開催場所の市区町村や近隣で ${dateStr} 前後に発生が予測される地震、または最近発生した地震情報を調べる
   - 震度5以上の地震情報があれば warn/danger とする
   - 問題なければ ok

3. 事件・事故情報 (title: "事件・事故情報")
   - 開催場所近辺で大きな混乱が予想されるような事件・事故・デモ・大規模集会等がないか調べる
   - 大きな混乱が予想されない場合は ok とする

4. 交通情報（計画運休） (title: "交通情報（計画運休）")
   - 開催場所近辺の主要な鉄道路線の ${dateStr} における計画運休・大規模遅延情報を調べる
   - 計画運休や大規模遅延があれば warn/danger とする
   - 問題なければ ok

${responseFormat}
`
    } else {
        // online
        return `
あなたはオンラインイベント開催の可否を判断するアシスタントです。
今日は ${today} です。
対象イベントの開催予定日: ${dateStr}
開催形式: オンライン

Google検索を使って以下の3点を調査し、結果をまとめてください。

調査項目:
1. 大規模地震 (title: "大規模地震情報")
   - ${dateStr} 前後に日本国内で発生した、または発生が予想される震度5以上の地震情報を調べる
   - 震度5以上の情報があれば warn/danger とする
   - 問題なければ ok

2. 通信障害 (title: "通信障害（NTT・KDDI）")
   - NTT（NTT東日本、NTT西日本、NTTドコモ）およびKDDI（au）において ${dateStr} 前後に発生している、または予定されている通信障害・メンテナンス情報を調べる
   - 通信障害・大規模メンテナンスがあれば warn/danger とする
   - 問題なければ ok

3. Zoomサービス障害 (title: "Zoomサービス障害")
   - Zoom Video Communications のサービス障害・障害情報を調べる（status.zoom.us なども参照）
   - 障害情報があれば warn/danger とする
   - 問題なければ ok

${responseFormat}
`
    }
}

// ===========================
// Call Gemini API
// ===========================
async function callGemini(prompt) {
    const apiKey = apiKeyInput.value.trim()
    if (!apiKey) {
        throw new Error('APIキーが入力されていません。')
    }

    const ai = new GoogleGenAI({ apiKey: apiKey })

    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
            tools: [{ googleSearch: {} }],
            temperature: 0.2,
        },
    })

    const text = response.text
    if (!text) throw new Error('AIからの応答が空でした。')

    // JSON部分を抽出
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
        console.error('Raw response:', text)
        throw new Error('AIの応答からJSONを抽出できませんでした。')
    }

    try {
        return JSON.parse(jsonMatch[0])
    } catch (e) {
        console.error('JSON parse error:', jsonMatch[0])
        throw new Error('AIの応答のJSON解析に失敗しました。')
    }
}

// ===========================
// Validate Inputs
// ===========================
function validateInputs() {
    if (!apiKeyInput.value.trim()) {
        alert('Gemini APIキーを入力してください。')
        return false
    }
    const date = eventDateInput.value
    if (!date) {
        alert('開催日付を入力してください。')
        return false
    }
    if (eventType === 'real' && !eventLocationInput.value.trim()) {
        alert('開催場所を入力してください。')
        return false
    }
    return true
}

// ===========================
// Main Handler
// ===========================
async function handleCheck() {
    if (!validateInputs()) return

    const date = eventDateInput.value
    const location = eventType === 'real' ? eventLocationInput.value.trim() : ''
    const prompt = buildPrompt(date, eventType, location)

    checkBtn.disabled = true
    showSection(loadingSection)

    try {
        const data = await callGemini(prompt)
        renderResults(data)
    } catch (err) {
        console.error(err)
        let errorMsg = err.message || '不明なエラーが発生しました。'

        // 503エラーなどのAPI高負荷時の対応
        if (errorMsg.includes('503') || errorMsg.includes('UNAVAILABLE') || errorMsg.includes('high demand')) {
            errorMsg = '現在AIが非常に混み合っており、一時的に処理できません。恐れ入りますが、少し時間を置いてから再度「判定する」ボタンをお試しください。'
        }

        errorMessage.textContent = errorMsg
        showSection(errorSection)
    } finally {
        checkBtn.disabled = false
    }
}

checkBtn.addEventListener('click', handleCheck)
retryBtn.addEventListener('click', () => showSection(null))

// ===========================
// Init: default date = today
// ===========================
const today = new Date()
const yyyy = today.getFullYear()
const mm = String(today.getMonth() + 1).padStart(2, '0')
const dd = String(today.getDate()).padStart(2, '0')
eventDateInput.value = `${yyyy}-${mm}-${dd}`

// 完了
