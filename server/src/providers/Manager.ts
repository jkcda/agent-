import Anthropic from '@anthropic-ai/sdk'
import { OpenAI } from 'openai'
import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import config, { getSetting, updateSetting, defaultLLMConfig, defaultEmbeddingConfig, defaultRerankConfig, defaultImageConfig, getMaskedSettings } from '../config/index.js'
import type { CapabilityLLMConfig, CapabilityEmbeddingConfig, CapabilityRerankConfig, CapabilityImageConfig } from './types.js'

function maskKey(key: string): string {
  if (!key || key.length <= 8) return key ? '****' : ''
  return key.slice(0, 4) + '***' + key.slice(-4)
}

function isMaskedKey(incoming: string, stored: string): boolean {
  if (!incoming || incoming === stored) return true
  // 检测前端发回来的是否为脱敏值（无改动则保留原 key）
  if (incoming.includes('***') && stored.length > 8) {
    const prefix = incoming.slice(0, incoming.indexOf('***'))
    const suffix = incoming.slice(incoming.indexOf('***') + 3)
    return stored.startsWith(prefix) && stored.endsWith(suffix)
  }
  return false
}

class ProviderManager {
  // ═══════════════════════════════════════════════
  //  能力配置读取（以能力为中心）
  // ═══════════════════════════════════════════════

  /** 读取 LLM 能力配置 */
  getLLMConfig(): CapabilityLLMConfig {
    const raw = getSetting('CAPABILITY_LLM')
    if (raw) {
      try {
        return { ...defaultLLMConfig, ...JSON.parse(raw) }
      } catch {}
    }
    return { ...defaultLLMConfig }
  }

  /** 读取图片生成能力配置 */
  getImageConfig(): CapabilityImageConfig {
    const raw = getSetting('CAPABILITY_IMAGE')
    if (raw) {
      try {
        return { ...defaultImageConfig, ...JSON.parse(raw) }
      } catch {}
    }
    return { ...defaultImageConfig }
  }

  /** 保存 LLM 配置 */
  async saveLLMConfig(cfg: Partial<CapabilityLLMConfig>): Promise<void> {
    const current = this.getLLMConfig()
    // 如果 key 是脱敏值，保留旧 key
    if (cfg.apiKey && isMaskedKey(cfg.apiKey, current.apiKey)) {
      delete cfg.apiKey
    }
    const merged = { ...current, ...cfg } satisfies CapabilityLLMConfig
    await updateSetting('CAPABILITY_LLM', JSON.stringify(merged))
  }

  /** 保存图片生成配置 */
  async saveImageConfig(cfg: Partial<CapabilityImageConfig>): Promise<void> {
    const current = this.getImageConfig()
    if (cfg.apiKey && isMaskedKey(cfg.apiKey, current.apiKey)) {
      delete cfg.apiKey
    }
    const merged = { ...current, ...cfg } satisfies CapabilityImageConfig
    await updateSetting('CAPABILITY_IMAGE', JSON.stringify(merged))
  }

  /** 读取向量化能力配置 */
  getEmbeddingConfig(): CapabilityEmbeddingConfig {
    const raw = getSetting('CAPABILITY_EMBEDDING')
    if (raw) {
      try { return { ...defaultEmbeddingConfig, ...JSON.parse(raw) } } catch {}
    }
    return { ...defaultEmbeddingConfig }
  }

  /** 保存向量化配置 */
  async saveEmbeddingConfig(cfg: Partial<CapabilityEmbeddingConfig>): Promise<void> {
    const current = this.getEmbeddingConfig()
    if (cfg.apiKey && isMaskedKey(cfg.apiKey, current.apiKey)) {
      delete cfg.apiKey
    }
    const merged = { ...current, ...cfg } satisfies CapabilityEmbeddingConfig
    await updateSetting('CAPABILITY_EMBEDDING', JSON.stringify(merged))
  }

  /** 读取重排序能力配置 */
  getRerankConfig(): CapabilityRerankConfig {
    const raw = getSetting('CAPABILITY_RERANK')
    if (raw) {
      try { return { ...defaultRerankConfig, ...JSON.parse(raw) } } catch {}
    }
    return { ...defaultRerankConfig }
  }

  /** 保存重排序配置 */
  async saveRerankConfig(cfg: Partial<CapabilityRerankConfig>): Promise<void> {
    const current = this.getRerankConfig()
    if (cfg.apiKey && isMaskedKey(cfg.apiKey, current.apiKey)) {
      delete cfg.apiKey
    }
    const merged = { ...current, ...cfg } satisfies CapabilityRerankConfig
    await updateSetting('CAPABILITY_RERANK', JSON.stringify(merged))
  }

  /** 智谱等 API 已含版本号（/v4），OpenAI/DeepSeek 需补 /v1 */
  private normalizeBaseURL(baseURL: string): string {
    const url = baseURL.replace(/\/+$/, '')
    if (/\/v\d+$/.test(url)) return url
    return url + '/v1'
  }

  // ═══════════════════════════════════════════════
  //  SDK 客户端工厂（基于能力配置）
  // ═══════════════════════════════════════════════

  /** 创建 Anthropic SDK 客户端（基于 LLM 配置） */
  createAnthropicClient(): Anthropic {
    const cfg = this.getLLMConfig()
    return new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })
  }

  /** 创建 LangChain 模型（基于 LLM 配置，自动选择 OpenAI 或 Anthropic 格式） */
  createLangChainModel(opts?: { tool_choice?: string }): ChatOpenAI | ChatAnthropic {
    const cfg = this.getLLMConfig()

    if (cfg.format === 'anthropic') {
      return new ChatAnthropic({
        model: cfg.model,
        apiKey: cfg.apiKey,
        anthropicApiUrl: cfg.baseURL,
        maxTokens: config.ai.maxTokens,
        temperature: 0.7,
      })
    }

    return new ChatOpenAI({
      model: cfg.model,
      apiKey: cfg.apiKey,
      configuration: { baseURL: this.normalizeBaseURL(cfg.baseURL) },
      maxTokens: config.ai.maxTokens,
      temperature: 0.7,
      modelKwargs: {
        tool_choice: opts?.tool_choice || 'auto',
        parallel_tool_calls: true,  // 允许并行工具调用，减少串行延迟
      },
    })
  }

  /** 创建 OpenAI SDK 客户端（用于 embedding，基于向量化配置） */
  createOpenAIClient(): OpenAI {
    const cfg = this.getEmbeddingConfig()
    return new OpenAI({ apiKey: cfg.apiKey, baseURL: this.normalizeBaseURL(cfg.baseURL) })
  }

  // ═══════════════════════════════════════════════
  //  请求模板 & body 构建
  // ═══════════════════════════════════════════════

  buildRequestTemplate(cfg: CapabilityLLMConfig): string {
    return cfg.requestTemplate || ''
  }

  /**
   * 构建请求 body
   * 有模板则用模板合并 messages/stream，否则用默认格式
   */
  buildRequestBody(cfg: CapabilityLLMConfig, messages: any[], stream: boolean, extra?: Record<string, any>): any {
    if (cfg.requestTemplate) {
      try {
        const base = JSON.parse(cfg.requestTemplate)
        return { ...base, messages, stream, ...extra }
      } catch {}
    }
    return {
      model: cfg.model,
      messages,
      stream,
      max_tokens: config.ai.maxTokens,
      temperature: 0.7,
      ...extra,
    }
  }

  // ═══════════════════════════════════════════════
  //  LLM 流式调用（OpenAI 格式）
  // ═══════════════════════════════════════════════

  /**
   * 直接调用 /v1/chat/completions（SSE 流式）
   * 适用于 OpenAI 兼容格式的 LLM
   */
  async *chatStreamRaw(
    messages: Array<{ role: string; content: any }>,
    opts: { system?: string } = {}
  ): AsyncGenerator<string> {
    const cfg = this.getLLMConfig()
    const apiMessages = opts.system
      ? [{ role: 'system', content: opts.system }, ...messages]
      : messages
    const body = this.buildRequestBody(cfg, apiMessages, true, { model: cfg.model })

    const resp = await fetch(`${this.normalizeBaseURL(cfg.baseURL)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const err = await resp.text().catch(() => '')
      throw new Error(`API 错误 (${resp.status}): ${err.slice(0, 200)}`)
    }

    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        if (trimmed === 'data: [DONE]') continue
        try {
          const json = JSON.parse(trimmed.slice(6))
          const content = json.choices?.[0]?.delta?.content
          if (content) yield content
        } catch { /* skip malformed chunk */ }
      }
    }
  }

  /** Anthropic 流式（纯文本，无 tools） */
  async *chatStreamAnthropic(
    messages: Array<{ role: string; content: string }>,
    opts: { system?: string } = {}
  ): AsyncGenerator<string> {
    const client = new Anthropic({ apiKey: this.getLLMConfig().apiKey, baseURL: this.getLLMConfig().baseURL })
    const stream = await client.messages.stream({
      model: this.getLLMConfig().model,
      max_tokens: config.ai.maxTokens,
      temperature: 0.7,
      ...(opts.system ? { system: opts.system } : {}),
      messages: messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content as string })),
    })
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const text = (event.delta as any)?.text
        if (text) yield text
      }
    }
  }

  /**
   * 单次文本补全（非流式），自动适配 OpenAI / Anthropic 格式
   * 用于 RAG 重写、重排、摘要等内部调用
   */
  async chatCompletion(messages: Array<{ role: string; content: string }>, maxTokens: number = 150): Promise<string> {
    const cfg = this.getLLMConfig()

    if (cfg.format === 'openai' || cfg.requestTemplate) {
      const body = this.buildRequestBody(cfg, messages, false, { model: cfg.model, max_tokens: maxTokens })
      const resp = await fetch(`${this.normalizeBaseURL(cfg.baseURL)}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        throw new Error(`chatCompletion 错误 (${resp.status}): ${err.slice(0, 200)}`)
      }
      const data = await resp.json() as any
      return data.choices?.[0]?.message?.content || ''
    }

    // Anthropic 格式
    const client = this.createAnthropicClient()
    const systemMsg = messages.find(m => m.role === 'system')
    const userMsgs = messages.filter(m => m.role !== 'system')
    const response = await client.messages.create({
      model: cfg.model,
      max_tokens: maxTokens,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: userMsgs.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    })
    const textBlock = response.content.find(b => b.type === 'text')
    return (textBlock as any)?.text || ''
  }

  // ═══════════════════════════════════════════════
  //  图片生成
  // ═══════════════════════════════════════════════

  async generateImage(prompt: string, size?: string, initImage?: string): Promise<string> {
    const cfg = this.getImageConfig()

    const buildBody = (base?: Record<string, any>) => {
      const body: Record<string, any> = { ...base, prompt, stream: false }
      if (initImage) body.image = initImage
      return body
    }

    // 有请求模板时用自定义 body
    if (cfg.requestTemplate) {
      try {
        const base = JSON.parse(cfg.requestTemplate)
        const body = buildBody(base)
        const resp = await fetch(`${cfg.baseURL}/api/v3/images/generations`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cfg.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
        if (!resp.ok) {
          const err = await resp.text().catch(() => '')
          throw new Error(`图片生成失败 (${resp.status}): ${err.slice(0, 200)}`)
        }
        const data = await resp.json() as any
        return data?.data?.[0]?.url || ''
      } catch (e: any) {
        if (e.message?.startsWith('图片生成失败')) throw e
        // 模板解析失败，回退默认
      }
    }

    // 默认格式（火山引擎 Seedream）
    const body = buildBody({
      model: cfg.model,
      size: size || cfg.defaultSize,
      sequential_image_generation: 'disabled',
      response_format: 'url',
      watermark: true,
    })
    const resp = await fetch(`${cfg.baseURL}/api/v3/images/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const err = await resp.text().catch(() => '')
      throw new Error(`图片生成失败 (${resp.status}): ${err.slice(0, 200)}`)
    }
    const data = await resp.json() as any
    return data?.data?.[0]?.url || ''
  }

  // ═══════════════════════════════════════════════
  //  Embedding
  // ═══════════════════════════════════════════════

  async createEmbedding(texts: string[]): Promise<number[][]> {
    const client = this.createOpenAIClient()
    const cfg = this.getEmbeddingConfig()
    const response = await client.embeddings.create({
      model: cfg.model,
      input: texts,
    })
    return response.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
  }

  // ═══════════════════════════════════════════════
  //  语音转写
  // ═══════════════════════════════════════════════

  async transcribeAudio(audio: Blob | Buffer): Promise<string> {
    const cfg = this.getLLMConfig()
    const form = new FormData()
    form.append('file', audio instanceof Blob ? audio : new Blob([audio as BlobPart], { type: 'audio/wav' }), 'audio.wav')
    form.append('model', 'iic/SenseVoiceSmall')

    const res = await fetch(`${cfg.baseURL}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
      body: form,
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      throw new Error(`语音转写失败 (${res.status}): ${err.slice(0, 200)}`)
    }
    const data = await res.json() as { text?: string }
    return data.text?.trim() || ''
  }

  // ═══════════════════════════════════════════════
  //  运行时信息（供管理后台展示）
  // ═══════════════════════════════════════════════

  getCapabilities() {
    const llm = this.getLLMConfig()
    const emb = this.getEmbeddingConfig()
    const rerank = this.getRerankConfig()
    const img = this.getImageConfig()
    const tavilyKey = getSetting('TAVILY_API_KEY')
    // 脱敏返回，防止 API Key 通过浏览器 Network 面板泄露
    return {
      llm: { ...llm, apiKey: maskKey(llm.apiKey) },
      embedding: { ...emb, apiKey: maskKey(emb.apiKey) },
      rerank: { ...rerank, apiKey: maskKey(rerank.apiKey) },
      img: { ...img, apiKey: maskKey(img.apiKey) },
      search: { apiKey: maskKey(tavilyKey) },
    }
  }
}

export const providerManager = new ProviderManager()
