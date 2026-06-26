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
const sourcesCard = document.getElementById('sources-card')
const sourcesContainer = document.getElementById('sources-container')

// ===========================
// State
// ===========================
let eventType = 'real' // 'real' | 'online'
const GEMINI_MODEL = 'gemini-3.5-flash'
const MAX_LINKS_PER_ITEM = 3
const MAX_GLOBAL_SOURCES = 10
const WEATHER_API_TIMEOUT_MS = 8000
const OPEN_METEO_GEOCODE_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search'
const OPEN_METEO_FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

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
    if (status === 'unknown') return '❔'
    return '❓'
}

function statusLabel(status) {
    if (status === 'ok') return '問題なし'
    if (status === 'warn') return '注意事項あり'
    if (status === 'danger') return '危険'
    if (status === 'unknown') return '情報なし'
    return '不明'
}

function renderLinks(links, className = 'item-links') {
    if (!links || links.length === 0) return ''

    return `<div class="${className}">${links
        .map(
            (l) =>
                `<a class="item-link" href="${escapeAttr(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.text)}</a>`
        )
        .join('')}</div>`
}

function renderSources(sources) {
    if (!sourcesCard || !sourcesContainer) return

    const sourceLinks = Array.isArray(sources) ? sources.slice(0, MAX_GLOBAL_SOURCES) : []
    sourcesContainer.innerHTML = ''

    if (sourceLinks.length === 0) {
        sourcesCard.classList.add('hidden')
        return
    }

    sourcesContainer.innerHTML = sourceLinks
        .map(
            (source) =>
                `<a class="item-link" href="${escapeAttr(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.text)}</a>`
        )
        .join('')
    sourcesCard.classList.remove('hidden')
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

        const linksHtml = renderLinks(item.links)

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

    renderSources(data.sources)
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

function normalizeText(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[「」『』【】\[\]（）(){}'"`.,、。:：]/g, '')
}

function createUrlKey(url) {
    try {
        const parsed = new URL(url)
        parsed.hash = ''
        if (parsed.pathname.length > 1) {
            parsed.pathname = parsed.pathname.replace(/\/+$/, '')
        }
        return parsed.toString()
    } catch {
        return String(url)
    }
}

function toValidHttpUrl(uri) {
    const url = String(uri || '').trim()
    if (!url) return ''

    try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
        return parsed.toString()
    } catch {
        return ''
    }
}

function linkTextFromSource(title, url) {
    const text = String(title || '').trim()
    if (text) return text

    try {
        return new URL(url).hostname
    } catch {
        return '参考リンク'
    }
}

function addUniqueLink(links, source) {
    if (!source?.url) return
    const key = createUrlKey(source.url)
    if (links.some((link) => createUrlKey(link.url) === key)) return
    links.push({ text: source.text, url: source.url })
}

function mergeUniqueLinks(...linkGroups) {
    const merged = []
    linkGroups.flat().forEach((link) => addUniqueLink(merged, link))
    return merged
}

function extractGroundingSources(response) {
    const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || []
    const sources = []
    const seenByUrl = new Map()
    const sourceByChunkIndex = new Map()

    chunks.forEach((chunk, index) => {
        const source = chunk.web || chunk.retrievedContext
        const url = toValidHttpUrl(source?.uri)
        if (!url) return

        const key = createUrlKey(url)
        let sourceData = seenByUrl.get(key)

        if (!sourceData) {
            sourceData = {
                text: linkTextFromSource(source?.title, url),
                url,
                searchText: normalizeText(`${source?.title || ''} ${url}`),
            }
            seenByUrl.set(key, sourceData)
            sources.push(sourceData)
        }

        sourceByChunkIndex.set(index, sourceData)
    })

    return { sources, sourceByChunkIndex }
}

function findItemIndexForSupport(segmentText, items) {
    const segment = normalizeText(segmentText)
    if (segment.length < 8) return -1

    return items.findIndex((item) => {
        const title = normalizeText(item.title)
        const detail = normalizeText(item.detail)
        return (
            (title && segment.includes(title)) ||
            (detail.length >= 8 && (detail.includes(segment) || segment.includes(detail)))
        )
    })
}

function sourceMatchesItem(source, item) {
    const title = normalizeText(item.title)
    const sourceText = source.searchText
    const isPublicInfo = title.includes('公的') || title.includes('発表')
    const isMediaInfo = title.includes('民間') || title.includes('メディア') || title.includes('報道')
    const isWeatherInfo = title.includes('天気') || title.includes('気象') || title.includes('警戒')
    const isEarthquakeInfo = title.includes('地震') || title.includes('津波') || title.includes('震度')
    const isWeatherSource = /(weathernews|ウェザーニュース|tenki|天気|気象|予報|forecast|台風|大雨|暴風|警報|注意報)/i.test(sourceText)

    if (isWeatherInfo && isPublicInfo) {
        return /(気象庁|jma|jmagojp)/i.test(sourceText)
    }
    if (isWeatherInfo && isMediaInfo) {
        return /(tenki|yahoo|weathernews|ウェザーニュース|天気|予報|weather|forecast)/i.test(sourceText)
    }
    if (isWeatherInfo) {
        return /(天気|予報|気象|tenki|weather|forecast|jma)/i.test(sourceText)
    }
    if (isEarthquakeInfo && isPublicInfo) {
        return /(気象庁|jma|go\.jp|lg\.jp|自治体|防災|地震|震度|津波|nied|防災科研)/i.test(sourceText)
    }
    if (isEarthquakeInfo && isMediaInfo) {
        return /(tenki|yahoo|weathernews|ウェザーニュース|ニュース|news|地震|震度|津波)/i.test(sourceText)
    }
    if (isEarthquakeInfo) {
        return /(地震|震度|気象庁|jma|earthquake)/i.test(sourceText)
    }
    if (title.includes('安全') || title.includes('事件') || title.includes('事故')) {
        if (isWeatherSource) return false
        return /(事件|事故|警察|警視庁|消防|火災|救急|犯罪|不審|デモ|抗議|集会|雑踏|群衆|混乱|規制|通行止|ニュース|自治体|city|tokyolgjp|lgjp)/i.test(sourceText)
    }
    if (title.includes('交通') || title.includes('運休')) {
        return /(交通|鉄道|運行|運休|遅延|jr|metro|railway|train)/i.test(sourceText)
    }
    if (title.includes('通信')) {
        return /(通信|障害|メンテナンス|ntt|docomo|kddi|au)/i.test(sourceText)
    }
    if (title.includes('zoom')) {
        return /(zoom|status)/i.test(sourceText)
    }

    return false
}

function isPublicWeatherItem(item) {
    const title = normalizeText(item.title)
    const isPublicInfo = title.includes('公的') || title.includes('発表')
    const isWeatherInfo = title.includes('天気') || title.includes('気象') || title.includes('警戒')
    return isPublicInfo && isWeatherInfo
}

function hasJmaSource(links) {
    return (links || []).some((link) => /(気象庁|jma|jmagojp)/i.test(normalizeText(`${link.text || ''} ${link.url || ''}`)))
}

function hasPublicWeatherJmaSource(data) {
    return data.items.some((item) => isPublicWeatherItem(item) && hasJmaSource(item.links))
}

function applyGroundingLinks(data, response) {
    const metadata = response?.candidates?.[0]?.groundingMetadata
    const { sources, sourceByChunkIndex } = extractGroundingSources(response)
    const linksByItem = data.items.map(() => [])

    for (const support of metadata?.groundingSupports || []) {
        const itemIndex = findItemIndexForSupport(support.segment?.text, data.items)
        if (itemIndex === -1) continue

        for (const chunkIndex of support.groundingChunkIndices || []) {
            const source = sourceByChunkIndex.get(chunkIndex)
            if (source && sourceMatchesItem(source, data.items[itemIndex])) {
                addUniqueLink(linksByItem[itemIndex], source)
            }
        }
    }

    return {
        ...data,
        items: data.items.map((item, index) => {
            const links = mergeUniqueLinks(item.links || [], linksByItem[index])

            if (links.length === 0) {
                for (const source of sources.filter((source) => sourceMatchesItem(source, item))) {
                    addUniqueLink(links, source)
                    if (links.length >= MAX_LINKS_PER_ITEM) break
                }
            }

            return {
                ...item,
                links: links.slice(0, MAX_LINKS_PER_ITEM),
            }
        }),
        sources: mergeUniqueLinks(data.sources || [], sources).slice(0, MAX_GLOBAL_SOURCES),
    }
}

// ===========================
// Weather API Supplement
// ===========================
function buildWeatherLocationQueries(location) {
    const raw = String(location || '').trim()
    if (!raw) return []

    const withoutVicinity = raw.replace(/(周辺|近辺|付近)$/g, '').trim()
    const withoutStation = withoutVicinity.replace(/駅$/g, '').trim()

    return [...new Set([raw, withoutVicinity, withoutStation].filter(Boolean))]
}

function pickJapaneseGeocodeResult(results) {
    if (!Array.isArray(results)) return null
    return (
        results.find((result) => result.country_code === 'JP' && result.latitude && result.longitude) ||
        results.find((result) => result.latitude && result.longitude) ||
        null
    )
}

async function fetchJsonWithTimeout(url) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), WEATHER_API_TIMEOUT_MS)

    try {
        const response = await fetch(url, { signal: controller.signal })
        const data = await response.json()

        if (!response.ok) {
            throw new Error(`Weather API status ${response.status}: ${JSON.stringify(data)}`)
        }

        return data
    } finally {
        clearTimeout(timeoutId)
    }
}

async function geocodeWeatherLocation(location) {
    for (const query of buildWeatherLocationQueries(location)) {
        const url = new URL(OPEN_METEO_GEOCODE_ENDPOINT)
        url.search = new URLSearchParams({
            name: query,
            count: '5',
            language: 'ja',
            countryCode: 'JP',
        }).toString()

        const data = await fetchJsonWithTimeout(url.toString())
        const result = pickJapaneseGeocodeResult(data.results)

        if (result) {
            return {
                query,
                name: result.name,
                admin1: result.admin1,
                admin2: result.admin2,
                latitude: result.latitude,
                longitude: result.longitude,
                timezone: result.timezone || 'Asia/Tokyo',
            }
        }
    }

    return null
}

function buildOpenMeteoForecastUrl(geo, date) {
    const url = new URL(OPEN_METEO_FORECAST_ENDPOINT)
    url.search = new URLSearchParams({
        latitude: String(geo.latitude),
        longitude: String(geo.longitude),
        hourly: 'precipitation,rain,precipitation_probability,wind_speed_10m,wind_gusts_10m,weather_code',
        daily: 'precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max',
        timezone: 'Asia/Tokyo',
        wind_speed_unit: 'ms',
        precipitation_unit: 'mm',
        start_date: date,
        end_date: date,
    }).toString()
    return url.toString()
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value)
}

function formatNumber(value, digits = 1) {
    if (!isFiniteNumber(value)) return '未取得'
    return value.toFixed(digits).replace(/\.0$/, '')
}

function formatForecastTime(time) {
    const matched = String(time || '').match(/T(\d{2}):(\d{2})/)
    if (!matched) return String(time || '時刻不明')
    return matched[2] === '00' ? `${matched[1]}時` : `${matched[1]}時${matched[2]}分`
}

function findHourlyMax(times, values) {
    if (!Array.isArray(times) || !Array.isArray(values)) return null

    return values.reduce((max, value, index) => {
        if (!isFiniteNumber(value)) return max
        if (!max || value > max.value) {
            return { value, time: times[index], index }
        }
        return max
    }, null)
}

function listThresholdHours(times, values, threshold, limit = 6) {
    if (!Array.isArray(times) || !Array.isArray(values)) return []

    return values
        .map((value, index) => ({ value, time: times[index] }))
        .filter((entry) => isFiniteNumber(entry.value) && entry.value >= threshold)
        .slice(0, limit)
}

function formatHourlyEntries(entries, unit) {
    if (!entries.length) return '該当時間帯なし'
    return entries.map((entry) => `${formatForecastTime(entry.time)} ${formatNumber(entry.value)}${unit}`).join('、')
}

function rainRiskMessage(maxPrecipitation) {
    if (!isFiniteNumber(maxPrecipitation)) return '降水量の数値は取得できていません。'
    if (maxPrecipitation >= 50) return '50mm/h以上の非常に激しい雨で、短時間でも冠水・避難困難につながる恐れがあります。'
    if (maxPrecipitation >= 30) return '30mm/h以上の激しい雨で、道路冠水・視界不良・子供の移動困難を強く警戒すべき水準です。'
    if (maxPrecipitation >= 20) return '20mm/h以上の強い雨で、側溝あふれ・足元悪化・屋外活動の中断を警戒すべき水準です。'
    if (maxPrecipitation >= 10) return '10mm/h以上のやや強い雨があり、屋外イベントでは雨具・動線・滑りやすさへの注意が必要です。'
    if (maxPrecipitation > 0) return '弱い雨の時間帯があります。屋外イベントでは足元や待機場所の確認が必要です。'
    return 'まとまった降水は目立ちません。'
}

function windRiskMessage(maxWind, maxGust) {
    const wind = isFiniteNumber(maxWind) ? maxWind : 0
    const gust = isFiniteNumber(maxGust) ? maxGust : 0
    const strongest = Math.max(wind, gust)

    if (!strongest) return '風速・突風の数値は取得できていません。'
    if (gust >= 20 || wind >= 15) return '強風・突風により、看板やテント、傘、飛来物への警戒が必要な水準です。'
    if (gust >= 15 || wind >= 10) return '突風や強めの風により、屋外設営物や子供の移動には注意が必要です。'
    return '風は相対的に強い水準ではありません。'
}

function summarizeWeatherApiData(forecast, geo, date) {
    const hourly = forecast?.hourly || {}
    const daily = forecast?.daily || {}
    const times = hourly.time || []
    const maxPrecipitation = findHourlyMax(times, hourly.precipitation)
    const maxProbability = findHourlyMax(times, hourly.precipitation_probability)
    const maxWind = findHourlyMax(times, hourly.wind_speed_10m)
    const maxGust = findHourlyMax(times, hourly.wind_gusts_10m)
    const heavyRainHours = listThresholdHours(times, hourly.precipitation, 20)
    const notableRainHours = listThresholdHours(times, hourly.precipitation, 10)
    const placeParts = [geo.admin1, geo.admin2, geo.name].filter(Boolean)
    const placeLabel = placeParts.join(' ')
    const dailyPrecipitation = daily.precipitation_sum?.[0]
    const dailyProbability = daily.precipitation_probability_max?.[0]

    return `【無料天気API（Open-Meteo）補助データ】
- 取得地点: ${placeLabel || geo.name}（検索語: ${geo.query}、緯度 ${formatNumber(geo.latitude, 4)}、経度 ${formatNumber(geo.longitude, 4)}）
- 対象日: ${date}
- 最大1時間降水量: ${maxPrecipitation ? `${formatNumber(maxPrecipitation.value)}mm/h（${formatForecastTime(maxPrecipitation.time)}）` : '未取得'}
- 20mm/h以上の強雨時間帯: ${formatHourlyEntries(heavyRainHours, 'mm/h')}
- 10mm/h以上の雨時間帯: ${formatHourlyEntries(notableRainHours, 'mm/h')}
- 日降水量: ${isFiniteNumber(dailyPrecipitation) ? `${formatNumber(dailyPrecipitation)}mm` : '未取得'}
- 最大降水確率: ${maxProbability ? `${formatNumber(maxProbability.value, 0)}%（${formatForecastTime(maxProbability.time)}）` : isFiniteNumber(dailyProbability) ? `${formatNumber(dailyProbability, 0)}%` : '未取得'}
- 最大平均風速: ${maxWind ? `${formatNumber(maxWind.value)}m/s（${formatForecastTime(maxWind.time)}）` : '未取得'}
- 最大瞬間風速: ${maxGust ? `${formatNumber(maxGust.value)}m/s（${formatForecastTime(maxGust.time)}）` : '未取得'}
- 解釈メモ: ${rainRiskMessage(maxPrecipitation?.value)} ${windRiskMessage(maxWind?.value, maxGust?.value)}`
}

async function buildWeatherApiContext(date, location) {
    try {
        const geo = await geocodeWeatherLocation(location)
        if (!geo) return null

        const forecastUrl = buildOpenMeteoForecastUrl(geo, date)
        const forecast = await fetchJsonWithTimeout(forecastUrl)

        return {
            summary: summarizeWeatherApiData(forecast, geo, date),
            source: {
                text: 'Open-Meteo Forecast API（数値予報）',
                url: forecastUrl,
            },
        }
    } catch (err) {
        console.warn('Weather API supplement failed:', err)
        return null
    }
}

function isWeatherMediaItem(item) {
    const title = normalizeText(item.title)
    return (
        (title.includes('天気') || title.includes('気象') || title.includes('災害')) &&
        (title.includes('民間') || title.includes('メディア') || title.includes('報道') || title.includes('見通し'))
    )
}

function applyWeatherApiSource(data, weatherApiContext) {
    const source = weatherApiContext?.source
    if (!source?.url) return data

    return {
        ...data,
        items: data.items.map((item) => {
            if (!isWeatherMediaItem(item)) return item
            return {
                ...item,
                links: mergeUniqueLinks([source], item.links || []).slice(0, MAX_LINKS_PER_ITEM),
            }
        }),
        sources: mergeUniqueLinks([source], data.sources || []).slice(0, MAX_GLOBAL_SOURCES),
    }
}

// ===========================
// Prompt Builder
// ===========================
function buildPrompt(date, type, location, weatherApiContext = null) {
    const dateStr = date // yyyy-mm-dd
    const today = new Date().toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    })
    const weatherApiPromptBlock = weatherApiContext?.summary
        ? `
追加の数値予報（無料天気API）:
${weatherApiContext.summary}

この数値予報は、民間天気サイトの表やページが読み取りづらい場合の補助データです。
「天気見通し（民間メディア）」では、このAPIの最大1時間降水量、ピーク時刻、日降水量、降水確率、平均風速、最大瞬間風速も必ず判断材料に含めてください。
民間サイトの読み取り結果よりAPIの数値が厳しい場合は、その差を明記し、安全側に評価してください。
`
        : ''

    const responseFormat = `
以下のJSON形式のみで回答してください。マークダウンや説明文は不要です。JSONブロックだけを出力してください。

{
  "overall": {
    "status": "ok|warn|danger|unknown",
    "summary": "全体的なまとめ（2〜3文程度）"
  },
  "items": [
    {
      "title": "項目名",
      "status": "ok|warn|danger|unknown",
      "detail": "根拠と判断を2〜4文で記載。問題なしの場合は「現時点で問題となる情報は確認されていません。」を基本に、確認した範囲を補足。問題がある場合は具体的な数値、時間帯、発表主体、子供や参加者への影響を記載。情報が存在しない場合はその旨を記載。",
      "links": []
    }
  ]
}

statusの基準:
- ok: 問題なし
- warn: 注意が必要な情報あり
- danger: 重大な問題あり
- unknown: 情報なし（例: 該当日の天気予報がまだ発表されていない等）

全体のステータス (overall.status) は各 items の中で最も深刻なステータスに合わせること（優先度: danger > warn > unknown > ok）。
重要な指示:
1. \`links\` 配列は必ず空配列 \`[]\` にしてください。参考URLはアプリ側でGoogle Search Groundingのメタデータから付与します。
2. URLやドメイン名をdetailやsummary本文に書かないでください。
3. 天気・交通の項目では、「可能性がある」という表現だけで終わらせず、現時点で確認できた数値・公式発表・未確認事項を明確に分けてください。
`

    if (type === 'real') {
        return `
あなたはイベント開催の可否を判断するアシスタントです。
今日は ${today} です。
対象イベントの開催予定日: ${dateStr}
開催場所: ${location}

Google検索を使って以下の6点を調査し、結果をまとめてください。
なお、調査対象の市区町村を開催場所から特定して調べてください（例: 「渋谷駅」→「渋谷区」）。
また、開催予定日が今日より前の日付の場合でも、その開催予定日の情報を調査してください。
公的発表と民間メディアの情報は混ぜず、必ず別の項目として評価してください。
${weatherApiPromptBlock}

調査項目:
1. 気象警戒（気象庁発表） (title: "気象警戒（気象庁発表）")
   - 必ず気象庁（jma.go.jp）のサイトのみを根拠に確認する
   - Yahoo!天気、tenki.jp、ウェザーニュース、自治体サイト、その他ニュースサイトの情報をこの項目の根拠にしない
   - 開催場所の市区町村における ${dateStr} の警報・注意報、台風、大雨、洪水、暴風、暴風雪などを気象庁情報から調べる
   - 気象庁発表で屋外イベントや移動に影響する情報があれば warn/danger とする
   - 問題なければ ok

2. 天気見通し（民間メディア） (title: "天気見通し（民間メディア）")
   - tenki.jp、Yahoo!天気、ウェザーニュースなど複数の民間天気サイトを横断的に確認する
   - 追加の数値予報（Open-Meteo）が提示されている場合は、民間サイトの確認結果と照合して必ずdetailに反映する
   - 開催場所の市区町村における ${dateStr} の天気、1時間降水量（mm/h）、降水のピーク時間帯、平均風速・最大風速・最大瞬間風速（m/s）、気温、台風接近などを調べる
   - tenki.jpを参照する場合は市区町村トップではなく、対象日の3時間天気・1時間天気など詳細な予報ページを優先して確認する
   - detailでは「Aサイトでは○時に○mm/h、Bサイトでは○時に○mm/h、Open-Meteoでは○時に○mm/h」のように、サイト別・API別の数値差が分かるように書く
   - Open-Meteoで20mm/h以上、特に30mm/h以上の1時間降水量がある場合は、民間サイトで小さい数値しか読めなくても安全側に評価する
   - 降水量は冠水・視界不良・滑りやすさ、風速は転倒・飛来物・傘の使用困難など、子供に危険が及ぶ可能性と結びつけて判断する
   - 数値が確認できないサイトがある場合は、そのサイトでは数値未確認であることを明記する
   - 民間予報で開催に影響する悪天候が示されていれば warn/danger とする
   - 問題なければ ok

3. 地震・津波（公的発表） (title: "地震・津波（公的発表）")
   - 気象庁、自治体、国の防災・災害情報を中心に確認する
   - 開催場所の市区町村や近隣における ${dateStr} と現在の地震・津波情報を調べる
   - 震度5以上、津波注意報・警報、避難情報などがあれば warn/danger とする
   - 問題なければ ok

4. 地震関連ニュース（民間メディア） (title: "地震関連ニュース（民間メディア）")
   - tenki.jp、Yahoo!ニュース・天気、ウェザーニュースなどの民間メディアで地震関連情報を確認する
   - 開催場所や近隣、または移動に影響する広域の地震被害・余震・交通影響の報道を調べる
   - 開催に影響する報道があれば warn/danger とする
   - 問題なければ ok

5. 現地周辺の安全情報 (title: "現地周辺の安全情報")
   - 開催場所近辺で大きな混乱が予想されるような事件・事故・デモ・大規模集会等がないか調べる
   - 警察、自治体、施設公式情報、地域の事件事故ニュースを優先する
   - 天気、台風、気象、交通運行情報をこの項目の根拠にしない
   - 大きな混乱が予想されない場合は ok とする

6. 交通・計画運休 (title: "交通・計画運休")
   - 開催場所近辺の主要な鉄道路線の ${dateStr} における計画運休・運転見合わせ・大幅遅延・特別ダイヤ情報を調べる
   - 鉄道会社公式サイト、公式運行情報、国土交通省などの公式発表を優先する
   - メディア記事や天候からの推測だけで「発表されています」と書かない
   - detailの冒頭で、公式発表として「現時点で計画運休あり」「現時点で計画運休なし」「公式発表を確認できず」のいずれかを明確に書く
   - 公式発表がある場合は、発表主体、対象路線、対象日時、内容（計画運休・遅延見込み・運転見合わせなど）を具体的に書く
   - 公式発表がないが可能性がある場合は、「決定済みの計画運休」と「今後発生する可能性・注意喚起」を明確に分けて書く
   - 計画運休や大規模遅延が公式発表されていれば warn/danger とする
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

Google検索を使って以下の6点を調査し、結果をまとめてください。
公的発表と民間メディアの情報は混ぜず、必ず別の項目として評価してください。

調査項目:
1. 広域気象リスク（気象庁発表） (title: "広域気象リスク（気象庁発表）")
   - 必ず気象庁（jma.go.jp）のサイトのみを根拠に確認する
   - Yahoo!天気、tenki.jp、ウェザーニュース、自治体サイト、その他ニュースサイトの情報をこの項目の根拠にしない
   - ${dateStr} 前後に日本国内でオンライン配信・参加に影響しうる警報級の大雨、台風、大雪、暴風、停電・避難につながる気象災害がないか気象庁情報から調べる
   - 広域的な災害や配信拠点・参加者に影響しうる気象庁発表があれば warn/danger とする
   - 問題なければ ok

2. 天気・災害報道（民間メディア） (title: "天気・災害報道（民間メディア）")
   - tenki.jp、Yahoo!天気、ウェザーニュースなど複数の民間天気サイト・災害報道を横断的に確認する
   - ${dateStr} 前後に日本国内でオンラインイベントの配信・参加に影響しうる荒天、台風、停電、交通混乱などの報道や予報を調べる
   - 可能な場合は、サイト別に1時間降水量（mm/h）、降水ピーク、平均風速・最大風速・最大瞬間風速（m/s）を比較して書く
   - 降水量は冠水・停電・移動困難、風速は停電・飛来物・交通乱れなど、配信者や参加者への影響と結びつけて判断する
   - 民間メディア上で広域的な影響が示されていれば warn/danger とする
   - 問題なければ ok

3. 地震・津波（公的発表） (title: "地震・津波（公的発表）")
   - 気象庁、自治体、国の防災・災害情報を中心に確認する
   - ${dateStr} 前後に日本国内で発生した、または現在確認できる震度5以上の地震・津波情報を調べる
   - 震度5以上、津波注意報・警報、避難情報などがあれば warn/danger とする
   - 問題なければ ok

4. 地震関連ニュース（民間メディア） (title: "地震関連ニュース（民間メディア）")
   - tenki.jp、Yahoo!ニュース・天気、ウェザーニュースなどの民間メディアで地震関連情報を確認する
   - ${dateStr} 前後の地震被害、余震、停電、通信・交通への影響の報道を調べる
   - オンラインイベントの開催に影響する報道があれば warn/danger とする
   - 問題なければ ok

5. 通信インフラ障害 (title: "通信インフラ障害")
   - NTT（NTT東日本、NTT西日本、NTTドコモ）およびKDDI（au）において ${dateStr} 前後に発生している、または予定されている通信障害・メンテナンス情報を調べる
   - 通信障害・大規模メンテナンスがあれば warn/danger とする
   - 問題なければ ok

6. Zoomサービス状況 (title: "Zoomサービス状況")
   - Zoom Video Communications のサービス障害・障害情報を調べる（status.zoom.us なども参照）
   - 障害情報があれば warn/danger とする
   - 問題なければ ok

${responseFormat}
`
    }
}

function buildSourcePrompt(date, type, location) {
    if (type === 'real') {
        return `
Google検索を使って、イベント開催判断に必要な最新情報を確認してください。
対象イベントの開催予定日: ${date}
開催場所: ${location}

以下の見出しを必ずこの順番で使い、各項目を1〜2文で自然文としてまとめてください。
各項目は検索で確認した情報に基づいて書いてください。

気象警戒（気象庁発表）:
- 必ず気象庁（jma.go.jp）のサイトのみを確認
- Yahoo!天気、tenki.jp、ウェザーニュース、自治体サイト、その他ニュースサイトはこの項目の根拠にしない
- 検索では site:jma.go.jp を優先し、開催場所の市区町村における対象日の警報・注意報、台風、大雨、洪水、暴風、暴風雪などを確認

天気見通し（民間メディア）:
- tenki.jp、Yahoo!天気、ウェザーニュースなど複数の民間天気サイトを横断的に確認
- 開催場所の市区町村における対象日の天気、1時間降水量（mm/h）、降水ピーク、平均風速・最大風速・最大瞬間風速（m/s）、気温、台風接近など
- 可能な場合は「Aサイトでは○時に○mm/h、Bサイトでは○時に○mm/h」のようにサイト別の数値差を確認
- 降水量は冠水・視界不良・滑りやすさ、風速は転倒・飛来物・傘の使用困難など、子供への危険と結びつけて確認
- tenki.jpを参照する場合は市区町村トップではなく、3時間天気・1時間天気など詳細な予報ページを優先

地震・津波（公的発表）:
- 気象庁、自治体、国の防災・災害情報を中心に確認
- 開催場所や近隣における地震・津波情報、震度5以上、避難情報など

地震関連ニュース（民間メディア）:
- tenki.jp、Yahoo!ニュース・天気、ウェザーニュースなどの民間メディアを確認
- 開催場所や近隣、または移動に影響する広域の地震被害・余震・交通影響の報道

現地周辺の安全情報:
- 警察、自治体、施設公式情報、地域の事件事故ニュースを優先して確認
- 開催場所近辺の事件・事故・火災・デモ・大規模集会・雑踏混乱など、現地の安全に関わる混乱要因
- 天気、台風、気象、交通運行情報はこの項目の根拠にしない

交通・計画運休:
- 開催場所近辺の主要鉄道路線の計画運休・大規模遅延・運転見合わせ情報
- 鉄道会社公式サイト、公式運行情報、国土交通省などの公式発表を優先
- 現時点で公式発表として計画運休が「ある」「ない」「確認できない」のどれかを明確に確認
- 公式発表がある場合は発表主体、対象路線、対象日時、内容を確認
- 決定済みの計画運休と、今後発生する可能性・注意喚起を分けて確認
`
    }

    return `
Google検索を使って、オンラインイベント開催判断に必要な最新情報を確認してください。
対象イベントの開催予定日: ${date}
開催形式: オンライン

以下の見出しを必ずこの順番で使い、各項目を1〜2文で自然文としてまとめてください。
各項目は検索で確認した情報に基づいて書いてください。

広域気象リスク（気象庁発表）:
- 必ず気象庁（jma.go.jp）のサイトのみを確認
- Yahoo!天気、tenki.jp、ウェザーニュース、自治体サイト、その他ニュースサイトはこの項目の根拠にしない
- 検索では site:jma.go.jp を優先し、対象日前後に日本国内でオンライン配信・参加に影響しうる警報級の大雨、台風、大雪、暴風、停電・避難につながる気象災害を確認

天気・災害報道（民間メディア）:
- tenki.jp、Yahoo!天気、ウェザーニュースなど複数の民間天気サイト・災害報道を横断的に確認
- 対象日前後に日本国内でオンラインイベントの配信・参加に影響しうる荒天、台風、停電、交通混乱などの報道や予報
- 可能な場合はサイト別に1時間降水量（mm/h）、降水ピーク、平均風速・最大風速・最大瞬間風速（m/s）を比較
- 降水量は冠水・停電・移動困難、風速は停電・飛来物・交通乱れなど、配信者や参加者への影響と結びつけて確認

地震・津波（公的発表）:
- 気象庁、自治体、国の防災・災害情報を中心に確認
- 対象日前後に日本国内で発生した、または現在確認できる震度5以上の地震・津波情報、避難情報など

地震関連ニュース（民間メディア）:
- tenki.jp、Yahoo!ニュース・天気、ウェザーニュースなどの民間メディアを確認
- 対象日前後の地震被害、余震、停電、通信・交通への影響の報道

通信インフラ障害:
- NTT東日本、NTT西日本、NTTドコモ、KDDI、auの通信障害・メンテナンス情報

Zoomサービス状況:
- Zoom Video Communications のサービス障害・障害情報
`
}

function buildJmaWeatherSourcePrompt(date, type, location) {
    if (type === 'real') {
        return `
Google検索を使い、気象庁（jma.go.jp）の情報だけを確認してください。
検索クエリでは site:jma.go.jp を必ず優先してください。
対象イベントの開催予定日: ${date}
開催場所: ${location}

確認したい内容:
- 開催場所の市区町村に関係する警報・注意報
- 台風、大雨、洪水、暴風、暴風雪など、開催や移動に影響しうる気象庁発表

Yahoo!天気、tenki.jp、ウェザーニュース、自治体サイト、ニュースサイトは参照しないでください。
1〜2文で、気象庁情報に基づく確認結果だけを書いてください。
`
    }

    return `
Google検索を使い、気象庁（jma.go.jp）の情報だけを確認してください。
検索クエリでは site:jma.go.jp を必ず優先してください。
対象イベントの開催予定日: ${date}
開催形式: オンライン

確認したい内容:
- 日本国内でオンライン配信・参加に影響しうる警報級の大雨、台風、大雪、暴風など
- 気象庁が発表する台風情報、警報・注意報、気象災害情報

Yahoo!天気、tenki.jp、ウェザーニュース、自治体サイト、ニュースサイトは参照しないでください。
1〜2文で、気象庁情報に基づく確認結果だけを書いてください。
`
}

// ===========================
// Call Gemini API
// ===========================
async function generateContentWithRest(apiKey, contents) {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: contents }] }],
                tools: [{ google_search: {} }],
                generationConfig: {
                    temperature: 0.2,
                },
            }),
        }
    )
    const data = await response.json()

    if (!response.ok) {
        throw new Error(`got status: ${response.status} . ${JSON.stringify(data)}`)
    }

    return data
}

async function callGemini(prompt, sourcePrompt, jmaWeatherSourcePrompt) {
    const apiKey = apiKeyInput.value.trim()
    if (!apiKey) {
        throw new Error('APIキーが入力されていません。')
    }

    const ai = new GoogleGenAI({ apiKey: apiKey })

    const generateWithSearch = (contents) => ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
            tools: [{ googleSearch: {} }],
            temperature: 0.2,
        },
    })

    const response = await generateWithSearch(prompt)

    const text = response.text
    if (!text) throw new Error('AIからの応答が空でした。')

    // JSON部分を抽出
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
        console.error('Raw response:', text)
        throw new Error('AIの応答からJSONを抽出できませんでした。')
    }

    try {
        const data = JSON.parse(jsonMatch[0])
        let groundedData = applyGroundingLinks(data, response)

        if (groundedData.sources.length === 0 && sourcePrompt) {
            try {
                const sourceResponse = await generateContentWithRest(apiKey, sourcePrompt)
                groundedData = applyGroundingLinks(groundedData, sourceResponse)
            } catch (sourceErr) {
                console.warn('Source grounding failed:', sourceErr)
            }
        }

        if (hasPublicWeatherJmaSource(groundedData) || !jmaWeatherSourcePrompt) {
            return groundedData
        }

        try {
            const jmaWeatherResponse = await generateContentWithRest(apiKey, jmaWeatherSourcePrompt)
            groundedData = applyGroundingLinks(groundedData, jmaWeatherResponse)
        } catch (jmaErr) {
            console.warn('JMA weather grounding failed:', jmaErr)
        }

        return groundedData
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

    checkBtn.disabled = true
    showSection(loadingSection)

    try {
        const weatherApiContext = eventType === 'real' ? await buildWeatherApiContext(date, location) : null
        const prompt = buildPrompt(date, eventType, location, weatherApiContext)
        const sourcePrompt = buildSourcePrompt(date, eventType, location)
        const jmaWeatherSourcePrompt = buildJmaWeatherSourcePrompt(date, eventType, location)
        const data = applyWeatherApiSource(await callGemini(prompt, sourcePrompt, jmaWeatherSourcePrompt), weatherApiContext)
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
