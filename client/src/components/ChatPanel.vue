<template>
  <div class="chat-panel">
    <!-- Session bar -->
    <div class="session-bar">
      <el-select
        v-model="sessionId"
        placeholder="选择会话"
        size="small"
        class="session-select"
        @change="onSessionSwitch"
      >
        <el-option
          v-for="s in sessions"
          :key="s.session_id"
          :label="s.first_message?.slice(0, 50) || s.session_id"
          :value="s.session_id"
        />
      </el-select>
      <el-button size="small" :icon="Plus" @click="newSession" :disabled="streaming">新建</el-button>
      <el-popconfirm
        title="删除当前会话？"
        @confirm="onDeleteSession"
        v-if="sessions.length > 0"
      >
        <template #reference>
          <el-button size="small" type="danger" :icon="Delete" :disabled="streaming" />
        </template>
      </el-popconfirm>
    </div>

    <!-- Messages -->
    <div class="messages" ref="msgContainer">
      <div v-if="loading" class="loading-overlay">
        <div class="spinner" />
        <span>加载中...</span>
      </div>

      <div v-if="serverOffline" class="server-banner">
        后端服务未启动 — 请在 server 目录运行: <code>npm run dev</code>
        <el-button size="small" text @click="checkServer">重试</el-button>
      </div>

      <TransitionGroup name="msg-fade">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="msg"
          :class="msg.role"
        >
          <div class="msg-role">{{ msg.role === 'user' ? '你' : 'NEXUS' }}</div>
          <div class="msg-content" v-html="renderMarkdown(msg.role === 'assistant' ? stripToolLog(msg.content) : msg.content)" />
          <span v-if="msg.role === 'assistant'" class="msg-tokens">{{ estimateTokens(msg.content) }} tokens</span>
        </div>
      </TransitionGroup>

      <div v-if="streaming" class="msg assistant msg-streaming">
        <div class="msg-role">
          NEXUS
          <span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>
          <span class="stream-timer">{{ streamElapsed }}s</span>
        </div>
        <!-- 工具调用列表（最多显示最近 8 条，更早的折叠） -->
        <div v-if="toolCalls.length > 0" class="tool-calls">
          <div v-if="toolCalls.length > 8" class="tool-collapsed">
            ✓ {{ toolCalls.length - 8 }} earlier tools
          </div>
          <div v-for="(tc, i) in toolCalls.slice(-8)" :key="tc.label + i" class="tool-call" :class="tc.status">
            <span class="tool-icon">{{ tc.status === 'running' ? '●' : '✓' }}</span>
            <span class="tool-name">{{ tc.label }}</span>
            <span v-if="tc.summary" class="tool-summary">{{ tc.summary }}</span>
            <span v-if="tc.status === 'running'" class="tool-pulse"></span>
          </div>
        </div>
        <!-- 最终内容 -->
        <div v-if="streamContent" class="msg-content" v-html="renderMarkdown(streamContent)" />
        <span v-if="streamContent && !toolCalls.some(t => t.status === 'running')" class="cursor">▌</span>
      </div>

      <div v-if="messages.length === 0 && !serverOffline && !loading" class="welcome">
        <div class="welcome-icon">✦</div>
        <h2>NEXUS Desktop</h2>
        <p>打开项目目录，让我帮你分析代码、搜索文件、编写修改。</p>
      </div>
    </div>

    <!-- Input -->
    <div class="input-area">
      <div class="input-info">
        <span class="token-badge" :class="{ warn: totalTokens > 50000, danger: totalTokens > 100000 }">
          {{ totalTokens >= 1000 ? (totalTokens / 1000).toFixed(0) + 'k' : totalTokens }} / 128k
        </span>
      </div>
      <div class="input-row">
        <el-input
          v-model="input"
          type="textarea"
          :rows="2"
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
          :disabled="streaming || serverOffline"
          @keydown="onKeydown"
          resize="none"
        />
        <el-button
          type="primary"
          :icon="Promotion"
          :disabled="!input.trim() || streaming"
          @click="send"
          :loading="streaming"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onUnmounted, computed } from 'vue'
import { Promotion, Plus, Delete } from '@element-plus/icons-vue'
import { marked } from 'marked'
import { chatWithAIStream, getHistory, getSessions, deleteSession, API_HOST } from '../apis'

const props = defineProps<{ projectPath: string; selectedFile: string }>()
const emit = defineEmits<{
  'file-changed': [filePath: string, diffText: string]
  'exec-run': [command: string, output: string]
}>()

const messages = ref<Array<{ role: string; content: string }>>([])
const input = ref('')
const streaming = ref(false)
const streamContent = ref('')
const toolStatus = ref('')
const streamElapsed = ref(0)
let streamTimer: ReturnType<typeof setInterval> | null = null
interface ToolCall { label: string; summary: string; status: 'running' | 'done' }
const toolCalls = ref<ToolCall[]>([])
let pendingExecCommand: string | null = null
let pendingEditFile: string | null = null
let toolCallCount = 0
const msgContainer = ref<HTMLElement>()
const serverOffline = ref(false)
const loading = ref(false)

// ── Tool display names ──
const toolLabels: Record<string, string> = {
  fs_read: '读取文件',
  fs_write: '写入文件',
  fs_edit: '编辑文件',
  fs_grep: '搜索代码',
  fs_glob: '查找文件',
  exec: '执行命令',
  fs_index: '分析项目',
}
function toolDisplay(tool: string): string {
  return toolLabels[tool] || tool
}

// ── Token estimation ──
function estimateTokens(text: string): number {
  return Math.ceil(text.length * 0.45) // rough: ~2.2 chars per token
}

// 去除旧消息中的工具调用日志
function stripToolLog(text: string): string {
  return text.replace(/\[本轮工具调用\][\s\S]*?(?=\n\n|$)/g, '').trim()
}
const totalTokens = computed(() => {
  let t = 0
  for (const m of messages.value) t += estimateTokens(m.content)
  if (streamContent.value) t += estimateTokens(streamContent.value)
  return t
})

// ── Session management ──
interface Session { session_id: string; first_message?: string; message_count?: number }
const sessions = ref<Session[]>([])
const sessionId = ref('')

function loadLastSession(): string {
  try {
    return localStorage.getItem('nexus-desktop-sid') || ''
  } catch {
    return ''
  }
}

function saveLastSession(sid: string) {
  try { localStorage.setItem('nexus-desktop-sid', sid) } catch {}
}

async function loadSessions() {
  try {
    const list = await getSessions()
    sessions.value = list
  } catch { /* server offline, will retry */ }
}

async function onSessionSwitch(sid: string) {
  saveLastSession(sid)
  messages.value = []
  loading.value = true
  try {
    const history = await getHistory(sid)
    messages.value = history.map((m: any) => ({ role: m.role, content: m.content }))
    await nextTick()
    scrollBottom()
  } catch {} finally {
    loading.value = false
  }
}

function newSession() {
  const sid = 'desktop-' + Date.now()
  sessionId.value = sid
  saveLastSession(sid)
  messages.value = []
  sessions.value.unshift({ session_id: sid, first_message: '(新会话)', message_count: 0 })
}

async function onDeleteSession() {
  const sid = sessionId.value
  await deleteSession(sid)
  sessions.value = sessions.value.filter(s => s.session_id !== sid)
  if (sessions.value.length > 0) {
    sessionId.value = sessions.value[0].session_id
    await onSessionSwitch(sessionId.value)
  } else {
    newSession()
  }
}

// ── Markdown ──
function renderMarkdown(text: string) {
  if (!text) return ''
  return marked.parse(text, { breaks: true }) as string
}

// 把 diff 输出渲染为带颜色的代码块
function renderDiffBlock(resultText: string, filePath: string): string {
  const lines = resultText.split('\n').filter(l => {
    const t = l.trim()
    return t && !t.startsWith('已修改') && !t.startsWith('文件已写入') && !t.startsWith('文件写入后')
  })
  if (lines.length === 0) return ''
  let html = ''
  for (const l of lines) {
    const safe = l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    if (l.startsWith('+'))      html += `<div class="dl dl-add">${safe}</div>`
    else if (l.startsWith('-')) html += `<div class="dl dl-del">${safe}</div>`
    else if (l === '···')      html += `<div class="dl dl-sep">···</div>`
    else                        html += `<div class="dl">${safe}</div>`
  }
  return `<details open class="diff-block"><summary>📝 ${filePath || '修改'}</summary><div class="diff-body">${html}</div></details>`
}

// ── Chat ──
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

async function send() {
  const text = input.value.trim()
  if (!text || streaming.value) return
  input.value = ''
  messages.value.push({ role: 'user', content: text })
  streaming.value = true
  streamContent.value = ''
  toolCalls.value = []
  toolCallCount = 0
  streamElapsed.value = 0
  streamTimer = setInterval(() => streamElapsed.value++, 1000)
  await nextTick()
  scrollBottom()

  try {
    const resp = await chatWithAIStream(text, sessionId.value)
    if (!resp.ok || !resp.body) throw new Error('stream failed')

    const reader = resp.body.getReader()
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
        if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue
        try {
          const json = JSON.parse(trimmed.slice(6))
          if (json.content) streamContent.value += json.content

          // Tool call: add to list
          if (json.type === 'tool_call' && json.tool) {
            toolCallCount++
            let args: Record<string, any> = json.args || {}
            if (args.input) {
              if (typeof args.input === 'string') {
                try { args = JSON.parse(args.input) } catch { /* not JSON */ }
              } else if (typeof args.input === 'object') {
                args = args.input
              }
            }
            // 构建摘要
            let summary = ''
            if (args.filePath) summary = args.filePath
            else if (args.query) summary = args.query.slice(0, 40)
            else if (args.pattern) summary = args.pattern
            else if (args.command) summary = args.command.slice(0, 50)
            else if (args.glob) summary = args.glob
            else if (args.prompt) summary = args.prompt.slice(0, 40)
            else if (args.code) summary = `(${args.code.length}字符)`
            toolCalls.value.push({ label: toolDisplay(json.tool), summary, status: 'running' })

            if (json.tool === 'fs_edit' && args.filePath) pendingEditFile = args.filePath
            if (json.tool === 'exec' && args.command) pendingExecCommand = args.command
          }

          // Tool result: mark last running tool as done & render diff inline
          if (json.type === 'tool_result' && json.tool) {
            const last = toolCalls.value.findLast(t => t.status === 'running')
            if (last) last.status = 'done'
            toolStatus.value = ''
            let resultText = json.result || ''
            if (resultText) {
              try {
                const parsed = JSON.parse(resultText)
                if (parsed.kwargs?.content) resultText = parsed.kwargs.content
                else if (parsed.content) resultText = parsed.content
              } catch { /* not JSON, use as-is */ }
            }

            if (json.tool === 'exec' && pendingExecCommand) {
              emit('exec-run', pendingExecCommand, resultText)
              pendingExecCommand = null
            }
            // fs_edit / fs_write: diff 直接展示在对话中
            if ((json.tool === 'fs_edit' || json.tool === 'fs_write') && resultText) {
              // 从结果文本提取文件名（不依赖 pendingEditFile，防止顺序问题）
              const m = resultText.match(/已修改\s+(.+?)[\s:]/) || resultText.match(/文件已写入[：:]\s*(.+?)[\s(]/)
              const filePath = pendingEditFile || m?.[1] || ''
              const block = renderDiffBlock(resultText, filePath)
              if (block) streamContent.value += '\n' + block + '\n'
              pendingEditFile = null
            }
          }
        } catch {}
      }
    }
  } catch (e: any) {
    if (e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError')) {
      streamContent.value += '\n\n> ❌ 无法连接到后端服务，请先在 server 目录运行 `npm run dev`\n'
    } else {
      streamContent.value += `\n\n> ❌ 错误: ${e.message}\n`
    }
  }

  if (streamContent.value) {
    messages.value.push({ role: 'assistant', content: streamContent.value })
  }
  streamContent.value = ''
  toolStatus.value = ''
  streaming.value = false
  if (streamTimer) { clearInterval(streamTimer); streamTimer = null }
  await nextTick()
  scrollBottom()
  loadSessions()
}

function scrollBottom() {
  requestAnimationFrame(() => {
    if (msgContainer.value) {
      msgContainer.value.scrollTop = msgContainer.value.scrollHeight
    }
  })
}

// ── Server status ──
async function checkServer() {
  try {
    const resp = await fetch(API_HOST + '/api/ai/models')
    serverOffline.value = !resp.ok
  } catch {
    serverOffline.value = true
  }
}
checkServer()
const pollInterval = setInterval(async () => {
  if (!serverOffline.value) { clearInterval(pollInterval); return }
  checkServer()
}, 3000)
onUnmounted(() => clearInterval(pollInterval))

// ── Init ──
;(async () => {
  const { initDesktopIdentity } = await import('../apis')
  await initDesktopIdentity()

  // 等服务器就绪再加载会话（最多重试 10 次，每次 2 秒）
  for (let i = 0; i < 10; i++) {
    await loadSessions()
    if (sessions.value.length > 0) break
    await new Promise(r => setTimeout(r, 2000))
  }

  // 优先恢复 localStorage 记录的会话
  const saved = loadLastSession()
  const exists = saved && sessions.value.some(s => s.session_id === saved)

  if (exists) {
    sessionId.value = saved
    await onSessionSwitch(saved)
  } else if (sessions.value.length > 0) {
    // 有历史会话 → 选最近的
    sessionId.value = sessions.value[0].session_id
    saveLastSession(sessions.value[0].session_id)
    await onSessionSwitch(sessions.value[0].session_id)
  } else {
    // 无历史会话 → 新建
    const sid = 'desktop-' + Date.now()
    sessionId.value = sid
    saveLastSession(sid)
  }
})()
</script>

<style scoped>
.chat-panel { display: flex; flex-direction: column; height: 100%; }

.session-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; background: #2d2d2d; border-bottom: 1px solid #404040;
}
.session-select { flex: 1; min-width: 0; }

/* ── Messages ── */
.messages { flex: 1; overflow-y: auto; padding: 16px; position: relative; }

.loading-overlay {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
  background: rgba(30,30,30,0.85); z-index: 10; color: #888;
}
.spinner {
  width: 32px; height: 32px; border: 3px solid #404040;
  border-top-color: #007acc; border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.welcome { text-align: center; margin-top: 80px; color: #888; animation: fadeIn 0.6s ease; }
.welcome-icon { font-size: 48px; margin-bottom: 12px; animation: pulse 2s ease infinite; }
.welcome h2 { color: #e0e0e0; margin-bottom: 8px; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
@keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }

/* ── Message transitions ── */
.msg-fade-enter-active { transition: all 0.3s ease; }
.msg-fade-enter-from { opacity: 0; transform: translateY(8px); }

.msg { margin-bottom: 16px; animation: fadeIn 0.3s ease; }
.msg-role {
  font-size: 12px; font-weight: 600; margin-bottom: 4px;
  display: flex; align-items: center; gap: 6px;
}
.msg-role { color: #569cd6; }
.msg.user .msg-role { color: #ce9178; }
.msg-content { font-size: 14px; line-height: 1.7; }
.msg-content :deep(p) { margin: 4px 0; }
.msg-content :deep(pre) { background: #1e1e1e; padding: 12px; border-radius: 6px; overflow-x: auto; }
.msg-content :deep(code) { font-family: 'Cascadia Code', monospace; font-size: 13px; }
.msg-content :deep(blockquote) { border-left: 3px solid #007acc; margin: 8px 0; padding: 4px 12px; color: #8dc; }
.msg-tokens { font-size: 10px; color: #666; margin-top: 4px; display: block; }

/* ── Streaming ── */
.msg-streaming { opacity: 0.95; }
.cursor { animation: blink 1s infinite; color: #007acc; }
@keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }

/* ── Tool status bar ── */
.tool-status {
  display: flex; align-items: center; gap: 8px;
  margin-top: 8px; padding: 6px 12px;
  background: #1a2332; border: 1px solid #2a4a6a; border-radius: 6px;
  font-size: 12px; color: #8dc; animation: toolIn 0.2s ease;
}
@keyframes toolIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
.tool-spinner {
  width: 12px; height: 12px; border: 2px solid #2a4a6a;
  border-top-color: #569cd6; border-radius: 50%; animation: spin 0.7s linear infinite; flex-shrink: 0;
}
.tool-label { font-family: 'Cascadia Code', monospace; }

/* ── Stream timer ── */
.stream-timer {
  font-size: 11px; color: #666; font-family: 'Cascadia Code', monospace;
  margin-left: 8px; font-weight: 400;
}

/* ── Tool calls list (Claude Code style) ── */
.tool-calls { margin: 8px 0; }
.tool-collapsed {
  font-size: 11px; color: #555; padding: 2px 0;
  font-family: 'Cascadia Code', monospace;
}
.tool-call {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 0; font-size: 12px; color: #8dc;
  font-family: 'Cascadia Code', monospace;
  animation: toolSlide 0.2s ease;
}
@keyframes toolSlide { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
.tool-call .tool-icon { width: 14px; text-align: center; flex-shrink: 0; }
.tool-call.running .tool-icon { color: #569cd6; animation: pulse 1s ease infinite; }
.tool-call.done .tool-icon { color: #6a6; }
.tool-call .tool-name { color: #569cd6; font-weight: 600; }
.tool-call .tool-summary { color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px; }
.tool-pulse {
  width: 6px; height: 6px; background: #569cd6; border-radius: 50%;
  animation: pulse 1s ease infinite; flex-shrink: 0;
}
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

.typing-dots { display: inline-flex; gap: 2px; }
.typing-dots span { animation: typingBounce 1.4s ease infinite; }
.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.typing-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes typingBounce { 0%,80%,100% { opacity: 0; } 40% { opacity: 1; } }

.server-banner {
  padding: 12px 16px; background: #5c1a1a; border: 1px solid #8b3333;
  border-radius: 6px; margin: 8px 16px; font-size: 13px;
}
.server-banner code { background: #333; padding: 2px 6px; border-radius: 3px; color: #e8ab53; }

/* ── Input ── */
.input-area { border-top: 1px solid #404040; background: #252525; }
.input-info { padding: 4px 12px; display: flex; justify-content: flex-end; }
.token-badge {
  font-size: 11px; color: #888; background: #333; padding: 2px 8px; border-radius: 10px;
  transition: all 0.3s;
}
.token-badge.warn { color: #e8ab53; }
.token-badge.danger { color: #f14c4c; }
.input-row { display: flex; gap: 8px; padding: 0 12px 12px; }

/* ── Inline diff (Claude Code style) — 用 :deep() 穿透 v-html scoped 隔离 ── */
:deep(.diff-block) {
  margin: 8px 0; border: 1px solid #30363d; border-radius: 6px;
  background: #0d1117; overflow: hidden; display: block;
}
:deep(.diff-block summary) {
  padding: 6px 12px; cursor: pointer; font-size: 12px;
  background: #161b22; border-bottom: 1px solid #30363d; user-select: none; color: #7ee787;
}
:deep(.diff-body) { max-height: 400px; overflow-y: auto; }
:deep(.dl) {
  font-family: 'Cascadia Code', monospace; font-size: 12px; line-height: 20px;
  padding: 0 12px; white-space: pre-wrap; word-break: break-all; color: #c9d1d9;
}
:deep(.dl-add) { background: rgba(46,160,67,0.3); color: #7ee787; }
:deep(.dl-del) { background: rgba(248,81,73,0.3); color: #f85149; }
:deep(.dl-sep) { color: #484f58; text-align: center; font-size: 11px; padding: 2px 0; }
</style>
