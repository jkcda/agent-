import fs from 'fs'
import path from 'path'
import { providerManager } from '../providers/index.js'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const MEMORY_DIR = path.join(DATA_DIR, 'memory')

function ensureDir() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true })
}

/** 加载所有记忆文件，拼接为上下文 */
export function loadMemory(): string {
  ensureDir()
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md'))
  if (files.length === 0) return ''

  const parts: string[] = []
  for (const file of files) {
    const content = fs.readFileSync(path.join(MEMORY_DIR, file), 'utf-8').trim()
    if (content) {
      const label = file.replace('.md', '')
      parts.push(`[${label}]\n${content}`)
    }
  }

  if (parts.length === 0) return ''
  return `--- 持久记忆 ---\n${parts.join('\n\n')}\n--- 记忆结束 ---\n`
}

/** 写入/更新记忆文件 */
function saveMemory(filename: string, content: string): void {
  ensureDir()
  fs.writeFileSync(path.join(MEMORY_DIR, `${filename}.md`), content, 'utf-8')
}

/**
 * 异步提取记忆 — 对话后检测是否有值得记住的信息
 * 不阻塞响应，在后台运行
 */
export async function extractMemory(
  userMessage: string,
  assistantReply: string
): Promise<void> {
  try {
    const existingMemory = loadMemory()

    const prompt = `你是一个记忆管理器。分析以下对话，判断是否有值得长期记住的信息（用户偏好、习惯、重要决策、个人信息等）。

${existingMemory ? `## 已有记忆\n${existingMemory}\n\n` : ''}## 最新对话
用户: ${userMessage}
助手: ${assistantReply}

判断规则：
- 只记住长期有价值的信息（偏好、习惯、身份、决策）
- 不记住临时性内容（当前问题、一次性查询）
- 不重复已有记忆

如果有值得记住的新信息，请输出更新后的完整记忆内容（Markdown 格式）。
如果没有新信息需要记住，输出 "NO_UPDATE"。

只输出记忆内容或 NO_UPDATE，不要输出其他内容：`

    const result = await providerManager.chatCompletion([
      { role: 'user', content: prompt }
    ], 300)

    if (!result || result.trim() === 'NO_UPDATE' || result.trim().length < 10) return

    // 解析输出，按文件名分段
    const text = result.trim()
    if (text.startsWith('[') && text.includes(']')) {
      // 多文件格式: [filename]\ncontent\n\n[filename2]\ncontent2
      const sections = text.split(/\n\[(?=[^\]]+\])/)
      for (const section of sections) {
        const match = section.match(/^([^\]]+)\]\n([\s\S]*)$/)
        if (match) {
          saveMemory(match[1].trim(), match[2].trim())
        }
      }
    } else {
      // 单文件：更新 user.md
      saveMemory('user', text)
    }

    console.log('[Memory] 已更新持久记忆')
  } catch (e: any) {
    console.warn('[Memory] 提取失败:', e.message)
  }
}

/** 清空所有记忆 */
export function clearMemory(): void {
  ensureDir()
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md'))
  for (const file of files) {
    fs.unlinkSync(path.join(MEMORY_DIR, file))
  }
}
