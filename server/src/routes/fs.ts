import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import { ApiResponse } from '../utils/response.js'
import config from '../config/index.js'
import { rebuildIndex } from '../services/projectIndex.js'
import { setWorkspaceRoot, getWorkspaceRoot } from '../services/workspaceState.js'

const router = Router()

function resolveSafe(targetPath: string): string {
  const root = getWorkspaceRoot() || getWorkspaceRoot()
  const resolved = path.resolve(root, targetPath)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`路径越界: ${targetPath}`)
  }
  return resolved
}

// GET /api/fs/tree - 列出目录结构
router.get('/tree', (_req: Request, res: Response) => {
  try {
    const dir = _req.query.dir as string || ''
    const target = dir ? resolveSafe(dir) : getWorkspaceRoot()
    if (!fs.existsSync(target)) {
      return ApiResponse.notFound(res, '目录不存在')
    }
    const stat = fs.statSync(target)
    if (!stat.isDirectory()) {
      return ApiResponse.badRequest(res, '不是目录')
    }
    const entries = fs.readdirSync(target).map(name => {
      const full = path.join(target, name)
      const s = fs.statSync(full)
      return {
        name,
        path: path.relative(getWorkspaceRoot(), full).replace(/\\/g, '/'),
        type: s.isDirectory() ? 'directory' : 'file',
        size: s.isFile() ? s.size : undefined,
        modifiedAt: s.mtime.toISOString(),
      }
    }).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    ApiResponse.success(res, { entries })
  } catch (err: any) {
    ApiResponse.internalServerError(res, '获取文件树失败', err.message)
  }
})

// POST /api/fs/read - 读取文件内容
router.post('/read', (req: Request, res: Response) => {
  try {
    const { filePath } = req.body
    if (!filePath) return ApiResponse.badRequest(res, '请提供文件路径')
    const abs = resolveSafe(filePath)
    if (!fs.existsSync(abs)) return ApiResponse.notFound(res, '文件不存在')
    const content = fs.readFileSync(abs, 'utf-8')
    const maxLen = 50000
    ApiResponse.success(res, {
      content: content.length > maxLen ? content.slice(0, maxLen) + '\n...(内容已截断)' : content,
      size: fs.statSync(abs).size,
    })
  } catch (err: any) {
    ApiResponse.internalServerError(res, '读取文件失败', err.message)
  }
})

// POST /api/fs/write - 写入文件内容（桌面端编辑器用）
router.post('/write', (req: Request, res: Response) => {
  try {
    const { filePath, content } = req.body
    if (!filePath || content === undefined) return ApiResponse.badRequest(res, '缺少 filePath 或 content')
    const abs = resolveSafe(filePath)
    const dir = path.dirname(abs)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(abs, content, 'utf-8')
    ApiResponse.success(res, { size: content.length }, '文件已保存')
  } catch (err: any) {
    ApiResponse.internalServerError(res, '写入失败', err.message)
  }
})

// POST /api/fs/exec - 直接执行命令（桌面端重跑用）
router.post('/exec', async (req: Request, res: Response) => {
  try {
    const { command } = req.body
    if (!command) return ApiResponse.badRequest(res, '缺少 command')
    const wsRoot = getWorkspaceRoot()
    const { execSync } = await import('node:child_process')
    const output = execSync(command, {
      cwd: wsRoot,
      timeout: 30000,
      maxBuffer: 500 * 1024,
      encoding: 'utf-8',
      shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
    })
    ApiResponse.success(res, { output: (output || '(无输出)').slice(0, 8000) })
  } catch (e: any) {
    ApiResponse.success(res, { output: (e.stderr || e.stdout || e.message || '执行失败').slice(0, 3000) })
  }
})

// PUT /api/fs/workspace - 切换工作区根目录
router.put('/workspace', (req: Request, res: Response) => {
  try {
    const { root } = req.body
    if (!root) return ApiResponse.badRequest(res, '请提供根目录路径')
    const resolved = path.resolve(root)
    if (!fs.existsSync(resolved)) return ApiResponse.notFound(res, '目录不存在')
    if (!fs.statSync(resolved).isDirectory()) return ApiResponse.badRequest(res, '不是目录')
    setWorkspaceRoot(resolved)
    rebuildIndex(resolved)
    ApiResponse.success(res, { root: resolved }, '工作区已切换')
  } catch (err: any) {
    ApiResponse.internalServerError(res, '切换工作区失败', err.message)
  }
})

export default router
