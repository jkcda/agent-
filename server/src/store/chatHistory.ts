import fs from 'fs'
import path from 'path'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const HISTORY_DIR = path.join(DATA_DIR, 'history')

interface ChatMessage {
  session_id: string
  user_id: number
  role: 'user' | 'assistant'
  content: string
  files?: string | null
  created_at: string
}

function ensureDir() {
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true })
}

function sessionFile(sessionId: string): string {
  return path.join(HISTORY_DIR, `${sessionId}.jsonl`)
}

export const ChatHistoryModel = {
  async create(
    sessionId: string,
    userId: number | null,
    role: 'user' | 'assistant',
    content: string,
    files?: string
  ): Promise<void> {
    ensureDir()
    const msg: ChatMessage = {
      session_id: sessionId,
      user_id: userId ?? 1,
      role,
      content,
      files: files || null,
      created_at: new Date().toISOString(),
    }
    fs.appendFileSync(sessionFile(sessionId), JSON.stringify(msg) + '\n', 'utf-8')
  },

  async getBySessionIdAndUserId(sessionId: string, _userId: number | null): Promise<ChatMessage[]> {
    const file = sessionFile(sessionId)
    if (!fs.existsSync(file)) return []
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
    return lines.map(line => {
      try { return JSON.parse(line) as ChatMessage } catch { return null }
    }).filter(Boolean) as ChatMessage[]
  },

  async deleteBySessionId(sessionId: string): Promise<number> {
    const file = sessionFile(sessionId)
    if (!fs.existsSync(file)) return 0
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
    fs.unlinkSync(file)
    return lines.length
  },

  async deleteBySessionIdAndUserId(sessionId: string, _userId: number): Promise<number> {
    return this.deleteBySessionId(sessionId)
  },

  async getSessionsByUserId(_userId: number | null): Promise<any[]> {
    ensureDir()
    const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.jsonl'))
    const sessions: any[] = []

    for (const file of files) {
      const sessionId = file.replace('.jsonl', '')
      const filePath = path.join(HISTORY_DIR, file)
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)
      if (lines.length === 0) continue

      const messages = lines.map(line => {
        try { return JSON.parse(line) as ChatMessage } catch { return null }
      }).filter(Boolean) as ChatMessage[]

      const firstUserMsg = messages.find(m => m.role === 'user')
      sessions.push({
        session_id: sessionId,
        created_at: messages[0]?.created_at || '',
        last_active_at: messages[messages.length - 1]?.created_at || '',
        message_count: messages.length,
        first_message: firstUserMsg?.content || '',
        agent_id: null,
        agent_name: null,
        agent_avatar: null,
      })
    }

    sessions.sort((a, b) => new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime())
    return sessions
  },
}
