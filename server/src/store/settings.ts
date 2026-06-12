import fs from 'fs'
import path from 'path'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

const settings = new Map<string, string>()

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function loadSettings(): void {
  ensureDir()
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, '{}', 'utf-8')
    return
  }
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string') settings.set(k, v)
    }
    console.log(`[Settings] 已从 JSON 加载 ${settings.size} 项配置`)
  } catch (e: any) {
    console.warn('[Settings] 读取失败:', e.message)
  }
}

export function getSetting(key: string): string {
  return settings.get(key) || ''
}

export function updateSetting(key: string, value: string): void {
  settings.set(key, value)
  saveToDisk()
  console.log(`[Settings] 已更新: ${key}`)
}

function saveToDisk() {
  ensureDir()
  const obj: Record<string, string> = {}
  for (const [k, v] of settings) obj[k] = v
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2), 'utf-8')
}
