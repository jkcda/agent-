import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import path from 'path'
import { fileURLToPath } from 'url'
import aiRouter from './routes/ai.js'
import uploadRouter from './routes/upload.js'
import fsRouter from './routes/fs.js'
import desktopRouter from './routes/desktop.js'
import { initFromConfig } from './services/workspaceState.js'
import config from './config/index.js'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '50mb' }))

// 静态文件服务 — 上传文件访问
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')))

// 初始化工作区
initFromConfig(config.workspace.root)

// 路由
app.use('/api/ai', aiRouter)
app.use('/api', uploadRouter)
app.use('/api/fs', fsRouter)
app.use('/api/desktop', desktopRouter)

// 工作区文件下载
app.get('/api/fs/download', (req, res) => {
  const file = req.query.file as string
  if (!file) return res.status(400).json({ error: '缺少 file 参数' })
  const workspaceRoot = path.resolve(config.workspace.root)
  const abs = path.resolve(workspaceRoot, file)
  if (!abs.startsWith(workspaceRoot + path.sep) && abs !== workspaceRoot) {
    return res.status(403).json({ error: '路径越界' })
  }
  if (!fs.existsSync(abs)) return res.status(404).json({ error: '文件不存在' })
  res.download(abs)
})

// Multer 错误处理
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: '文件大小超出限制' })
  }
  if (err.message?.startsWith('不支持的文件类型')) {
    return res.status(400).json({ success: false, message: err.message })
  }
  if (err.name === 'MulterError') {
    return res.status(400).json({ success: false, message: `文件上传错误: ${err.message}` })
  }
  console.error('未捕获的错误:', err)
  res.status(500).json({ success: false, message: '服务器内部错误' })
})

// 初始化 MCP
import('./services/mcp.js').then(m => {
  m.initMCP()
}).catch(() => {})

// 启动
const PORT = config.server.port
app.listen(PORT, () => {
  console.log(`🚀 NEXUS Desktop Server 运行在 http://localhost:${PORT}`)
})
