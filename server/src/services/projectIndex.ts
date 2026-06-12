import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

interface IndexEntry {
  relPath: string
  type: 'file' | 'directory'
  size: number
  mtime: number
  ext: string // '' or '.ts'
}

let _index: IndexEntry[] = []
let _indexRoot = ''
let _indexHash = ''

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', 'target', 'coverage', '.turbo', 'build', '.cache'])

function isTextExtension(ext: string): boolean {
  const set = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.json', '.md', '.mdx', '.txt', '.css', '.scss', '.less', '.html', '.htm', '.xml', '.svg', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.env', '.gitignore', '.dockerignore', '.editorconfig', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp', '.sh', '.bash', '.zsh', '.bat', '.ps1', '.sql', '.prisma', '.graphql', '.proto', '.php', '.lua', '.r', '.dart', '.ex', '.exs', '.erl', '.hrl', '.hs', '.scala', '.clj', '.edn'])
  return set.has(ext.toLowerCase())
}

export function getIndexRoot(): string {
  return _indexRoot
}

export function getIndex(): ReadonlyArray<IndexEntry> {
  return _index
}

/** Rebuild index from workspace root. Returns count of indexed files. */
export function rebuildIndex(workspaceRoot: string): number {
  _index = []
  _indexRoot = path.resolve(workspaceRoot)
  const root = _indexRoot

  if (!fs.existsSync(root)) return 0

  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) }
    catch { return }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name)
      const rel = path.relative(root, full).replace(/\\/g, '/')

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        _index.push({ relPath: rel, type: 'directory', size: 0, mtime: 0, ext: '' })
        walk(full)
      } else if (entry.isFile()) {
        let stat: fs.Stats
        try { stat = fs.statSync(full) } catch { continue }
        const ext = path.extname(entry.name).toLowerCase()
        _index.push({
          relPath: rel,
          type: 'file',
          size: stat.size,
          mtime: stat.mtimeMs,
          ext,
        })
      }
    }
  }
  walk(root)

  _indexHash = crypto.createHash('md5').update(_index.map(e => e.relPath + e.mtime).join(',')).digest('hex')
  console.log(`[Index] 已索引 ${_index.filter(e => e.type === 'file').length} 个文件（${_indexRoot}）`)
  return _index.filter(e => e.type === 'file').length
}

/** Find files matching a glob pattern using the index (fast, no FS walk) */
export function globFromIndex(pattern: string, dirPath?: string): string[] {
  // Convert glob to regex
  const regexStr = '^' + pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '\x00')
    .replace(/\*/g, '[^/]*')
    .replace(/\x00/g, '.*')
    + '$'

  let regex: RegExp
  try { regex = new RegExp(regexStr, 'i') } catch { return [] }

  const prefix = dirPath ? dirPath.replace(/\\/g, '/').replace(/\/$/, '') + '/' : ''

  return _index
    .filter(e => e.type === 'file' && (!prefix || e.relPath.startsWith(prefix)) && regex.test(e.relPath))
    .map(e => e.relPath)
}

/** Get text files matching a glob, for grep to scan. Excludes binary/large files. */
export function getTextFilesForGrep(pattern: string | null, dirPath?: string): string[] {
  const prefix = dirPath ? dirPath.replace(/\\/g, '/').replace(/\/$/, '') + '/' : ''

  let candidates = _index.filter(e =>
    e.type === 'file' &&
    isTextExtension(e.ext) &&
    e.size < 500_000 &&
    (!prefix || e.relPath.startsWith(prefix))
  )

  if (pattern) {
    const regexStr = '^' + pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '\x00')
      .replace(/\*/g, '[^/]*')
      .replace(/\x00/g, '.*')
      + '$'
    let regex: RegExp
    try { regex = new RegExp(regexStr, 'i') } catch { return [] }
    candidates = candidates.filter(e => regex.test(e.relPath))
  }

  return candidates.map(e => e.relPath)
}

/** Quick summary for the agent */
export function indexSummary(): string {
  const files = _index.filter(e => e.type === 'file')
  const byExt = new Map<string, number>()
  for (const f of files) {
    const ext = f.ext || '(none)'
    byExt.set(ext, (byExt.get(ext) || 0) + 1)
  }
  const topExts = [...byExt.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ext, count]) => `${ext}: ${count}`)
    .join(', ')

  const totalSize = files.reduce((s, f) => s + f.size, 0)
  const sizeStr = totalSize > 1024 * 1024
    ? `${(totalSize / 1024 / 1024).toFixed(1)}MB`
    : `${(totalSize / 1024).toFixed(0)}KB`

  return `项目索引: ${files.length} 个文件, ${sizeStr} | ${topExts}`
}
