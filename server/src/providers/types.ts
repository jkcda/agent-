// ── 能力配置（用户可自由配置，以能力为中心） ──

export interface CapabilityLLMConfig {
  name: string
  apiKey: string
  /** openai = /v1/chat/completions, anthropic = Anthropic SDK */
  format: 'openai' | 'anthropic'
  baseURL: string
  model: string
  requestTemplate: string
  /** 模型上下文窗口大小（token），用于动态计算历史压缩阈值 */
  contextWindow: number
}

export interface CapabilityEmbeddingConfig {
  name: string
  apiKey: string
  baseURL: string
  model: string
  /** 是否强制使用 API（跳过本地模型），低配服务器推荐开启 */
  forceAPI: boolean
}

export interface CapabilityRerankConfig {
  name: string
  apiKey: string
  baseURL: string
  model: string
  /** 强制使用 API 重排序（跳过本地模型），低配服务器推荐开启 */
  forceAPI: boolean
}

export interface CapabilityImageConfig {
  name: string
  apiKey: string
  baseURL: string
  model: string
  requestTemplate: string
  defaultSize: string
}

export interface ImageGenResult {
  imageUrl: string
  prompt: string
  size: string
}

export interface SearchSource {
  title: string
  url: string
  snippet: string
}

export interface SearchResult {
  text: string
  sources: SearchSource[]
}
