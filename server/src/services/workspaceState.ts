import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATE_FILE = path.join(__dirname, '..', '..', '.workspace-state.json')

let _workspaceRoot = ''

export function getWorkspaceRoot(): string {
  return _workspaceRoot
}

export function setWorkspaceRoot(root: string): string {
  _workspaceRoot = path.resolve(root)
  if (!fs.existsSync(_workspaceRoot)) {
    fs.mkdirSync(_workspaceRoot, { recursive: true })
  }
  // Persist to disk so nodemon restarts don't lose it
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ root: _workspaceRoot }), 'utf-8')
  } catch {}
  console.log(`[Workspace] 根目录已设置: ${_workspaceRoot}`)
  return _workspaceRoot
}

export function initFromConfig(defaultRoot: string) {
  if (_workspaceRoot) return

  // Restore from persisted state first (survives nodemon restarts)
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
      if (data.root && fs.existsSync(data.root)) {
        _workspaceRoot = path.resolve(data.root)
        console.log(`[Workspace] 从持久状态恢复: ${_workspaceRoot}`)
        return
      }
    }
  } catch {}

  // Fallback to config default
  _workspaceRoot = path.resolve(defaultRoot)
  console.log(`[Workspace] 使用默认路径: ${_workspaceRoot}`)
}
