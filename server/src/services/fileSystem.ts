import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { diffLines, type Change } from 'diff'
import config from '../config/index.js'
import { getTextFilesForGrep, globFromIndex, rebuildIndex, indexSummary, getIndexRoot } from './projectIndex.js'
import { getWorkspaceRoot, initFromConfig } from './workspaceState.js'

// Initialize workspace from config on module load
initFromConfig(config.workspace.root)

const uploadsRoot = path.resolve(process.cwd(), 'uploads')

/** 校验路径在沙箱内，越界抛错 */
function resolveSafe(targetPath: string): string {
  const wsRoot = getWorkspaceRoot()
  const resolved = path.resolve(targetPath.startsWith(uploadsRoot) ? targetPath : path.join(wsRoot, targetPath))
  const allowed = [wsRoot, uploadsRoot].some(root => resolved === root || resolved.startsWith(root + path.sep))
  if (!allowed) {
    throw new Error(`路径越界：${targetPath} 不在工作区范围内`)
  }
  return resolved
}

// 确保 workspace 目录存在
const wsRoot = getWorkspaceRoot()
if (!fs.existsSync(wsRoot)) {
  fs.mkdirSync(wsRoot, { recursive: true })
}

/** Myers diff 算法：生成带行号的 diff，只保留变更行 + 上下文 */
function buildDiff(oldText: string, newText: string): string {
  const changes: Change[] = diffLines(oldText, newText)
  const lines: string[] = []
  let oldLine = 1
  let newLine = 1

  for (const change of changes) {
    const changeLines = change.value.split('\n')
    if (changeLines[changeLines.length - 1] === '') changeLines.pop()

    if (change.added) {
      for (const l of changeLines) {
        lines.push(`+${newLine}| ${l}`)
        newLine++
      }
    } else if (change.removed) {
      for (const l of changeLines) {
        lines.push(`-${oldLine}| ${l}`)
        oldLine++
      }
    } else {
      for (const l of changeLines) {
        lines.push(` ${oldLine}| ${l}`)
        oldLine++
        newLine++
      }
    }
  }

  // 简化：只保留变更行 + 前后各 3 行上下文
  const changedIndices = new Set<number>()
  lines.forEach((l, i) => {
    if (l.startsWith('+') || l.startsWith('-')) {
      for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 3); j++) {
        changedIndices.add(j)
      }
    }
  })

  const result: string[] = []
  let lastIncluded = -1
  for (let i = 0; i < lines.length; i++) {
    if (changedIndices.has(i)) {
      if (lastIncluded >= 0 && i - lastIncluded > 1) {
        result.push('···')
      }
      result.push(lines[i])
      lastIncluded = i
    }
  }

  return result.join('\n')
}

// ── fs_read 文件读取缓存 ──
const readCache = new Map<string, string>()
const READ_CACHE_MAX = 200

function cacheKey(absPath: string, mtime: number): string {
  return `${absPath}@${mtime}`
}

function getCached(absPath: string, mtime: number): string | undefined {
  return readCache.get(cacheKey(absPath, mtime))
}

function setCached(absPath: string, mtime: number, content: string): void {
  if (readCache.size >= READ_CACHE_MAX) {
    const keys = [...readCache.keys()]
    for (let i = 0; i < 50 && i < keys.length; i++) readCache.delete(keys[i])
  }
  readCache.set(cacheKey(absPath, mtime), content)
}export const fsTools = [
  tool(async ({ filePath, offset, limit }: { filePath: string; offset?: number; limit?: number }) => {
    const wsRoot = getWorkspaceRoot()
    const abs = resolveSafe(filePath)
    if (!fs.existsSync(abs)) return `文件不存在：${filePath}（工作区：${wsRoot}）`
    const stat = fs.statSync(abs)
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(abs)
      const limited = entries.length > 200 ? entries.slice(0, 200) : entries
      return JSON.stringify({ type: 'directory', path: filePath, entries: limited, count: entries.length, truncated: entries.length > 200, workspace: wsRoot })
    }

    // 检查缓存（基于 mtime）
    const mtime = stat.mtimeMs
    const cached = getCached(abs, mtime)
    let content = cached || ''
    if (!cached) {
      content = fs.readFileSync(abs, 'utf-8')
      setCached(abs, mtime, content)
    }

    const lines = content.split('\n')
    const totalLines = lines.length

    if (offset !== undefined || limit !== undefined) {
      const start = Math.max(0, (offset || 1) - 1) // 1-indexed
      const end = limit ? Math.min(start + limit, totalLines) : totalLines
      const slice = lines.slice(start, end).join('\n')
      return JSON.stringify({ type: 'file', path: filePath, content: slice, lineRange: `${start + 1}-${end}`, totalLines, size: stat.size, workspace: wsRoot })
    }

    const maxChars = 20000
    if (content.length > maxChars) {
      const truncated = content.slice(0, maxChars)
      return JSON.stringify({ type: 'file', path: filePath, content: truncated + '\n...(内容过长，已截断)', truncated: true, totalLines, size: stat.size, workspace: wsRoot })
    }
    return JSON.stringify({ type: 'file', path: filePath, content, totalLines, size: stat.size, modifiedAt: stat.mtime.toISOString(), workspace: wsRoot })
  }, {
    name: 'fs_read',
    description: '读取文件内容或列出目录。当用户提到文件、代码、组件、配置时，用此工具读取。支持 offset/limit 分段读取大文件。',
    schema: z.object({
      filePath: z.string().describe('相对于工作区的文件或目录路径，如 "src/App.vue"、"package.json"'),
      offset: z.number().optional().describe('起始行号（从1开始），用于分段读取大文件'),
      limit: z.number().optional().describe('读取行数，配合 offset 使用'),
    }),
  }),

  tool(async ({ filePath, content }: { filePath: string; content: string }) => {
    const abs = resolveSafe(filePath)
    const dir = path.dirname(abs)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(abs, content, 'utf-8')
    return `文件已写入：${filePath}（${content.length} 字符）`
  }, {
    name: 'fs_write',
    description: '创建或覆盖文件。会自动创建不存在的父目录。',
    schema: z.object({
      filePath: z.string().describe('相对于工作区的文件路径'),
      content: z.string().describe('要写入的内容'),
    }),
  }),

  tool(async ({ filePath }: { filePath: string }) => {
    const abs = resolveSafe(filePath)
    if (!fs.existsSync(abs)) return `文件不存在：${filePath}`
    fs.rmSync(abs, { recursive: true, force: true })
    return `已删除：${filePath}`
  }, {
    name: 'fs_delete',
    description: '删除文件或空目录。不可恢复，请谨慎使用。',
    schema: z.object({
      filePath: z.string().describe('要删除的文件或目录路径'),
    }),
  }),

  // fs_list 已移除 — 概览用 fs_index，读目录用 fs_read

  tool(async ({ pattern, dirPath }: { pattern: string; dirPath?: string }) => {
    const wsRoot = getWorkspaceRoot()
    const searchDir = dirPath ? resolveSafe(dirPath) : wsRoot

    // Build regex once, fallback to literal substring search on invalid pattern
    let regex: RegExp | null = null
    try { regex = new RegExp(pattern, 'i') } catch { /* invalid regex, use literal */ }

    const candidates = getTextFilesForGrep(null, dirPath)
    const results: { file: string; line: number; content: string }[] = []

    for (const relPath of candidates) {
      if (results.length >= 50) break
      const full = path.join(wsRoot, relPath)
      try {
        const content = fs.readFileSync(full, 'utf-8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length && results.length < 50; i++) {
          const hit = regex
            ? regex.test(lines[i])
            : lines[i].toLowerCase().includes(pattern.toLowerCase())
          if (hit) {
            results.push({ file: relPath, line: i + 1, content: lines[i].trim().slice(0, 200) })
          }
        }
      } catch { /* permission denied, skip */ }
    }

    if (results.length >= 50) {
      return JSON.stringify({ matches: results, total: results.length, truncated: true, _note: '匹配过多，仅显示前50条，请缩小搜索范围' })
    }
    return JSON.stringify({ matches: results, total: results.length })
  }, {
    name: 'fs_grep',
    description: '搜索代码内容。当用户要查找函数、变量、组件、import、样式等代码片段时，用此工具搜索。支持正则表达式。',
    schema: z.object({
      pattern: z.string().describe('搜索模式，支持正则表达式，如 "export.*function"、"useState"、"import.*vue"'),
      dirPath: z.string().optional().describe('搜索目录，默认整个工作区'),
    }),
  }),

  tool(async ({ glob, dirPath }: { glob: string; dirPath?: string }) => {
    const wsRoot = getWorkspaceRoot()
    const files = globFromIndex(glob, dirPath)
    if (files.length > 500) {
      return JSON.stringify({ files: files.slice(0, 500), total: files.length, truncated: true })
    }
    return JSON.stringify({ files, total: files.length })
  }, {
    name: 'fs_glob',
    description: '按文件名模式查找文件（类似 glob）。使用预建索引，毫秒级返回。** 匹配任意路径，* 匹配任意文件名。示例: "**/*.ts" 查找所有 TypeScript 文件， "src/**/*.vue" 查找 src 下所有 Vue 文件。',
    schema: z.object({
      glob: z.string().describe('Glob 模式，如 "**/*.ts", "src/components/**/*.vue", "*.json"'),
      dirPath: z.string().optional().describe('搜索目录，默认整个工作区'),
    }),
  }),

  tool(async ({ filePath, oldText, newText }: { filePath: string; oldText: string; newText: string }) => {
    const abs = resolveSafe(filePath)
    if (!fs.existsSync(abs)) return `ERROR: 文件不存在：${filePath}`

    const content = fs.readFileSync(abs, 'utf-8')

    // Count occurrences
    let count = 0
    let pos = 0
    while ((pos = content.indexOf(oldText, pos)) !== -1) { count++; pos++ }

    if (count === 0) {
      // Try fuzzy match: trim whitespace and compare
      const normalizedContent = content.replace(/\r\n/g, '\n')
      const normalizedOld = oldText.replace(/\r\n/g, '\n')
      let fuzzyCount = 0
      let fuzzyPos = 0
      while ((fuzzyPos = normalizedContent.indexOf(normalizedOld, fuzzyPos)) !== -1) { fuzzyCount++; fuzzyPos++ }
      if (fuzzyCount === 0) {
        // Find closest match location for debugging
        const firstLine = oldText.split('\n')[0].trim()
        const lineIdx = content.split('\n').findIndex(l => l.includes(firstLine))
        const hint = lineIdx >= 0 ? `\n提示：第 ${lineIdx + 1} 行附近找到类似内容，请用 fs_read 确认准确文本。` : ''
        return `ERROR: 文件中未找到要替换的内容。请先用 fs_read 读取文件确认准确文本后重试。${hint}`
      }
      // Fuzzy match found — use normalized version
      const newContent = normalizedContent.replace(normalizedOld, newText.replace(/\r\n/g, '\n'))
      fs.writeFileSync(abs, newContent, 'utf-8')
      const diff = buildDiff(normalizedContent, newContent)
      return `已修改 ${filePath}（已自动修正换行符）:\n${diff}`
    }

    if (count > 1) {
      return `ERROR: 找到 ${count} 处匹配，请提供更多上下文使匹配唯一（包含前后各 2-3 行代码）。`
    }

    const newContent = content.replace(oldText, newText)
    fs.writeFileSync(abs, newContent, 'utf-8')

    // Verify the write actually happened
    const verifyContent = fs.readFileSync(abs, 'utf-8')
    if (verifyContent === content) {
      return `ERROR: 文件写入后内容未变化，可能写入失败。`
    }

    const diff = buildDiff(content, newContent)
    const lineDelta = newText.split('\n').length - oldText.split('\n').length
    const lineInfo = lineDelta > 0 ? ` (+${lineDelta} 行)` : lineDelta < 0 ? ` (${lineDelta} 行)` : ''
    return `已修改 ${filePath}${lineInfo}:\n${diff}`
  }, {
    name: 'fs_edit',
    description: `修改文件代码。当用户要求修改、添加、删除、优化代码时，用此工具。必须先用 fs_read 读取文件确认准确内容，oldText 必须与文件中完全一致。`,
    schema: z.object({
      filePath: z.string().describe('要编辑的文件路径'),
      oldText: z.string().describe('要替换的原文（必须与文件中内容完全一致，包括缩进和换行）'),
      newText: z.string().describe('替换后的新文本'),
    }),
  }),

  tool(async () => {
    const summary = indexSummary()
    const root = getWorkspaceRoot()
    // Rebuild if stale
    if (getIndexRoot() !== root) {
      rebuildIndex(root)
    }
    return `工作区: ${root}\n${indexSummary()}`
  }, {
    name: 'fs_index',
    description: '获取项目概览。当用户问"这个项目是什么"、"项目结构"、"有哪些文件"时，用此工具快速了解项目。',
    schema: z.object({}),
  }),

  tool(async ({ command }: { command: string }) => {
    const wsRoot = getWorkspaceRoot()
    const blocked = [/\brm\s+-rf\s+\//i, /\bdd\s+if=/i, /\b:(){ :|:& };:/, /\b>\/dev\/sda/i, /\bmkfs\./i, /\bformat\s+[A-Z]:/i]
    for (const p of blocked) {
      if (p.test(command)) return `命令被阻止（安全策略）: ${command}`
    }
    try {
      const stdout = execSync(command, {
        cwd: wsRoot,
        timeout: 15000,  // 15s 超时：适配编译/测试，服务启动类超时就返回部分输出
        maxBuffer: 500 * 1024,
        encoding: 'utf-8',
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
        env: process.env,
        windowsHide: true,
      })
      return stdout.slice(0, 8000) || '(命令执行完成，无输出)'
    } catch (e: any) {
      const msg = e.stderr || e.stdout || e.message || ''
      if (e.message?.includes('ETIMEDOUT')) {
        const partial = (e.stdout || '').slice(0, 2000)
        return `命令在 15 秒内未结束（可能是服务已启动或耗时较长）。${partial ? '\n部分输出:\n' + partial : ''}`
      }
      return `命令执行失败 (退出码 ${e.status || '?'}): ${msg}`.slice(0, 3000)
    }
  }, {
    name: 'exec',
    description: `执行命令。当用户要求运行测试、编译、安装依赖、git操作、启动服务时，用此工具。超时120秒。`,
    schema: z.object({
      command: z.string().describe('要执行的 shell 命令，如 "npm test"、"git status"、"npm run build"'),
    }),
  }),
]
