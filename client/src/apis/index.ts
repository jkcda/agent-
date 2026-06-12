import axios from 'axios'

// 打包后是 file:// 协议，需要绝对路径；开发时 Vite proxy 转发
export const API_HOST = window.location.protocol === 'file:' ? 'http://127.0.0.1:3001' : ''
const api = axios.create({ baseURL: API_HOST + '/api' })

// ── Desktop identity ──
let desktopUserId = 1 // resolved on startup via handshake

export async function initDesktopIdentity() {
  try {
    const { userId } = await window.electronAPI.connect()
    desktopUserId = userId
  } catch { /* fallback to 1 */ }
}

function getUserId() {
  return desktopUserId
}

// ── AI Chat ──
export function chatWithAIStream(message: string, sessionId: string, opts?: { projectPath?: string }) {
  return fetch(API_HOST + '/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId, userId: getUserId(), ...opts }),
  })
}

// ── File System ──
export async function fetchFileTree(dirPath?: string) {
  const params = dirPath ? `?dir=${encodeURIComponent(dirPath)}` : ''
  const { data } = await api.get(`/fs/tree${params}`)
  return data.result?.entries || []
}

export async function readFileContent(filePath: string) {
  const { data } = await api.post('/fs/read', { filePath })
  return data.result?.content || ''
}

export async function setWorkspace(root: string) {
  await api.put('/fs/workspace', { root })
}

// ── Sessions ──
export async function getSessions() {
  const { data } = await api.get('/ai/sessions', { params: { userId: getUserId() } })
  return data.result?.sessions || []
}

export async function getHistory(sessionId: string) {
  const { data } = await api.get('/ai/history', { params: { sessionId, userId: getUserId() } })
  return data.result?.messages || []
}

export async function deleteSession(sessionId: string) {
  await api.delete(`/desktop/sessions/${encodeURIComponent(sessionId)}`, { params: { userId: getUserId() } })
}
