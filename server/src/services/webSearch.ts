import config, { getSetting } from '../config/index.js'

interface SearchResult {
  title: string
  url: string
  snippet: string
}

// ---------- Tavily (主搜索) ----------

async function searchTavily(query: string): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: getSetting('TAVILY_API_KEY'),
      query,
      max_results: config.webSearch.maxResults,
      search_depth: 'basic'
    })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).detail || `Tavily 搜索失败 (${res.status})`)
  }
  const data = await res.json()

  const results: SearchResult[] = []

  for (const r of data.results || []) {
    results.push({
      title: r.title,
      url: r.url,
      snippet: r.content || r.snippet || ''
    })
  }

  return results.slice(0, config.webSearch.maxResults + 1)
}

// ---------- 查询优化 ----------

/**
 * 提取中文关键词 + 补充英文搜索词，提高搜索命中率。
 * 不调用 LLM，零延迟。
 */
function optimizeQuery(query: string): string {
  // 去除奈克瑟角色语气词
  let q = query
    .replace(/[✦◆]/g, '')
    .replace(/指挥官[，。！]?/g, '')
    .replace(/请[帮]?我/g, '')
    .trim()

  // 检测是否需要时效性限定
  const now = new Date()
  const timeWords = ['今天', '今天', '最新', '最近', '现在', '当前', '今年',
    '今日', '近日', '近期', '刚刚', '刚发布']
  const hasTimeWord = timeWords.some(w => q.includes(w))

  if (hasTimeWord) {
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    if (!q.includes(String(year))) {
      q = `${year}年${month}月 ${q}`
    }
  }

  // 中文问题词去除，保留核心查询
  q = q
    .replace(/^什么是/, '')
    .replace(/^是谁/, '')
    .replace(/^如何/, '')
    .replace(/^怎么/, '')
    .replace(/[？?！!。，,]$/, '')

  return q.trim() || query
}

// ---------- DuckDuckGo 兜底 ----------

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  // 尝试 HTML 搜索页 (非官方 API，结果更丰富)
  try {
    const htmlRes = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
    )
    const html = await htmlRes.text()

    const results: SearchResult[] = []
    // 简单解析搜索结果片段
    const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g
    const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

    const links: { url: string; title: string }[] = []
    let m
    while ((m = linkRe.exec(html)) !== null) {
      const url = new URL(m[1], 'https://duckduckgo.com').searchParams.get('uddg') || m[1]
      links.push({ url, title: m[2].replace(/<[^>]+>/g, '').trim() })
    }

    const snippets: string[] = []
    while ((m = snippetRe.exec(html)) !== null) {
      snippets.push(m[1].replace(/<[^>]+>/g, '').trim())
    }

    for (let i = 0; i < Math.min(links.length, config.webSearch.maxResults); i++) {
      results.push({
        title: links[i]!.title,
        url: links[i]!.url,
        snippet: snippets[i] || ''
      })
    }
    if (results.length > 0) return results
  } catch { /* fall through */ }

  // 兜底：即时答案 API
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'ai-chat-app/1.0' } }
    )
    const data = await res.json()
    const results: SearchResult[] = []

    if (data.AbstractText) {
      results.push({
        title: data.AbstractSource || 'DuckDuckGo',
        url: data.AbstractURL || '',
        snippet: data.AbstractText
      })
    }
    for (const topic of data.RelatedTopics || []) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.split(' - ')[0] || topic.Text,
          url: topic.FirstURL,
          snippet: topic.Text
        })
      }
    }
    return results.slice(0, config.webSearch.maxResults)
  } catch {
    return []
  }
}

// ---------- 格式化 ----------

function formatResults(results: SearchResult[]): string {
  return results
    .map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`)
    .join('\n\n')
}

export interface WebSearchResult {
  text: string
  sources: SearchResult[]
}

export async function searchWeb(query: string): Promise<WebSearchResult> {
  const empty = { text: '', sources: [] }
  if (!config.webSearch.enabled) return empty

  const optimizedQuery = optimizeQuery(query)

  try {
    const useTavily = !!getSetting('TAVILY_API_KEY')
    console.log(`[WebSearch] 查询: "${query}" → "${optimizedQuery}" 提供者: ${useTavily ? 'Tavily' : 'DDG'}`)

    const results = useTavily
      ? await searchTavily(optimizedQuery)
      : await searchDuckDuckGo(optimizedQuery)

    console.log(`[WebSearch] 结果: ${results.length} 条`)
    if (!results.length) return empty

    return {
      text: `\n--- 以下是联网搜索结果 ---\n${formatResults(results)}\n--- 搜索结果结束 ---\n`,
      sources: results
    }
  } catch (e: any) {
    console.error('[WebSearch] 搜索失败:', e.message || e)
    return empty
  }
}
