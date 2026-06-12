import fs from 'fs'
import path from 'path'
import { estimateTokens } from '../utils/tokenEstimator.js'
import { providerManager } from '../providers/index.js'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const COMPACTION_DIR = path.join(DATA_DIR, 'compaction')

interface Message {
  role: 'user' | 'assistant'
  content: string
  files?: { name: string; url: string; type: string }[]
}

function ensureDir() {
  if (!fs.existsSync(COMPACTION_DIR)) fs.mkdirSync(COMPACTION_DIR, { recursive: true })
}

function compactionFile(sessionId: string): string {
  return path.join(COMPACTION_DIR, `${sessionId}.md`)
}

/** 读取已有的压缩摘要 */
export function loadCompaction(sessionId: string): string {
  const file = compactionFile(sessionId)
  if (!fs.existsSync(file)) return ''
  return fs.readFileSync(file, 'utf-8').trim()
}

/** 保存压缩摘要 */
function saveCompaction(sessionId: string, summary: string): void {
  ensureDir()
  fs.writeFileSync(compactionFile(sessionId), summary, 'utf-8')
}

/** 计算消息总 token */
function totalTokens(messages: Message[]): number {
  let total = 0
  for (const m of messages) total += estimateTokens(m.content)
  return total
}

/**
 * 压缩对话历史
 *
 * 策略：
 * 1. 加载已有的压缩摘要
 * 2. 如果 token 未超阈值，直接返回（不压缩）
 * 3. 超阈值时：保留最近 recentRounds 轮，把更早的消息 + 旧摘要合并压缩
 * 4. 调 LLM 生成新摘要，写入 MD 文件
 * 5. 返回：[摘要消息] + [最近 N 轮]
 */
export async function compactHistory(
  messages: Message[],
  sessionId: string,
  tokenBudget: number = 90000,
  recentRounds: number = 10
): Promise<Message[]> {
  if (messages.length === 0) return messages

  const currentTokens = totalTokens(messages)
  if (currentTokens <= tokenBudget) return messages

  // 加载旧摘要
  const oldSummary = loadCompaction(sessionId)

  // 保留最近 N 轮（N*2 条消息，因为一轮=user+assistant）
  const keepCount = recentRounds * 2
  const recentMessages = messages.slice(-keepCount)
  const oldMessages = messages.slice(0, -keepCount)

  if (oldMessages.length === 0) return messages

  // 构建压缩素材
  const dialogText = oldMessages.map(m =>
    `${m.role === 'user' ? '用户' : '助手'}: ${m.content.slice(0, 500)}${m.content.length > 500 ? '...' : ''}`
  ).join('\n')

  const compressPrompt = oldSummary
    ? `以下是一段对话的已有摘要和新增对话，请合并生成一份完整的对话摘要（保留关键信息、决策、待办事项，去掉闲聊）。\n\n## 已有摘要\n${oldSummary}\n\n## 新增对话\n${dialogText}\n\n请输出合并后的摘要（中文，简洁，保留关键信息）：`
    : `请将以下对话压缩为一份摘要，保留关键信息、决策、用户偏好、待办事项，去掉闲聊和重复内容。\n\n${dialogText}\n\n请输出摘要（中文，简洁）：`

  try {
    const summary = await providerManager.chatCompletion([
      { role: 'user', content: compressPrompt }
    ], 500)

    if (summary && summary.trim()) {
      saveCompaction(sessionId, summary.trim())
      console.log(`[Compaction] 会话 ${sessionId} 已压缩: ${currentTokens} tokens → 摘要 + ${recentMessages.length} 条最近消息`)

      return [
        { role: 'user', content: `[以下为历史对话摘要]\n${summary.trim()}` },
        ...recentMessages,
      ]
    }
  } catch (e: any) {
    console.warn('[Compaction] 压缩失败:', e.message)
  }

  // 压缩失败时，直接截断保留最近消息
  return recentMessages
}

/** 删除会话的压缩摘要 */
export function deleteCompaction(sessionId: string): void {
  const file = compactionFile(sessionId)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}
