import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadSettings, getSetting as storeGetSetting, updateSetting as storeUpdateSetting } from '../store/settings.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

// 启动时从 JSON 加载配置
loadSettings()

// 包装 getSetting，先查 JSON store，再 fallback 环境变量
export function getSetting(key: string): string {
  const val = storeGetSetting(key)
  if (val) return val
  return process.env[key] || ''
}

export async function updateSetting(key: string, value: string): Promise<void> {
  storeUpdateSetting(key, value)
}

export function getMaskedSettings(): { key_name: string; description: string; masked: string }[] {
  return []
}

/** LLM 默认配置 */
export const defaultLLMConfig = {
  name: '魔搭社区',
  apiKey: process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || '',
  format: 'openai' as const,
  baseURL: 'https://api-inference.modelscope.cn',
  model: 'Qwen/Qwen3.5-397B-A17B',
  requestTemplate: '',
  contextWindow: 131072,  // 128K tokens
}

/** 向量化默认配置（桌面端不使用，保留接口兼容） */
export const defaultEmbeddingConfig = {
  name: '本地模型',
  apiKey: '',
  baseURL: '',
  model: '',
  forceAPI: false,
}

/** 重排序默认配置（桌面端不使用，保留接口兼容） */
export const defaultRerankConfig = {
  name: '本地模型',
  apiKey: '',
  baseURL: '',
  model: '',
  forceAPI: false,
}

/** 图片生成默认配置 */
export const defaultImageConfig = {
  name: '火山引擎 ARK',
  apiKey: process.env.ARK_API_KEY || '',
  baseURL: 'https://ark.cn-beijing.volces.com',
  model: 'doubao-seedream-4-5-251128',
  requestTemplate: '',
  defaultSize: '2560x1440',
}

const config = {
  server: {
    port: process.env.PORT || 3001
  },

  ai: {
    defaultModel: 'Qwen/Qwen3.5-397B-A17B',
    maxTokens: 32768,
    imageRatios: [
      { label: '1:1 正方形',   value: '2048x2048' },
      { label: '4:3 横版',     value: '2304x1728' },
      { label: '3:4 竖版',     value: '1728x2304' },
      { label: '16:9 宽屏',    value: '2560x1440' },
      { label: '9:16 手机',    value: '1440x2560' },
      { label: '3:2 经典摄影', value: '2496x1664' },
      { label: '2:3 竖版摄影', value: '1664x2496' },
      { label: '21:9 超宽屏',  value: '3024x1296' },
    ] as { label: string; value: string }[],
    defaultImageRatio: '2560x1440',
  },

  context: {
    maxChars: 30000,
    recentRounds: 5,
  },

  upload: {
    maxImageSize: 10 * 1024 * 1024,
    maxDocSize: 20 * 1024 * 1024,
    allowedImages: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    allowedDocs: [
      'text/plain', 'text/markdown', 'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  },

  audio: {
    maxDurationSec: 120,
    maxFileSize: 10 * 1024 * 1024,
  },

  webSearch: {
    enabled: true,
    provider: 'tavily' as const,
    maxResults: 8,
  },

  workspace: {
    root: process.env.WORKSPACE_ROOT || './workspace',
  },
}

export default config
