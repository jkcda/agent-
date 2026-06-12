import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { spawn, type ChildProcess } from 'child_process'
import os from 'os'
import fs from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const MACHINE_ID = createHash('sha256')
  .update(`${os.hostname()}-${os.userInfo().username}-${os.platform()}`)
  .digest('hex')
  .slice(0, 16)

let mainWindow: BrowserWindow | null = null
let serverProcess: ChildProcess | null = null
const SERVER_PORT = 3001
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`

function findServerDir(): string | null {
  // 1. electron-builder extraResources (server/dist + server/package.json)
  const eb = join(process.resourcesPath, 'server')
  if (fs.existsSync(join(eb, 'dist', 'app.js'))) return eb
  // 2. electron-packager extra-resource (dist + package.json 平铺在 resources)
  if (fs.existsSync(join(process.resourcesPath, 'dist', 'app.js'))) return process.resourcesPath
  // 3. 开发模式：项目根目录
  const dev = join(__dirname, '..', '..', 'server')
  if (fs.existsSync(join(dev, 'src', 'app.ts'))) return dev
  return null
}

async function ensureDeps(srvDir: string): Promise<boolean> {
  const nodeModules = join(srvDir, 'node_modules')
  if (fs.existsSync(nodeModules)) return true

  try {
    await spawnAndWait('npm', ['install', '--legacy-peer-deps'], srvDir, '[npm]')
    console.log('[Electron] 依赖安装完成')
    return true
  } catch {
    console.error('[Electron] 依赖安装失败，请确保已安装 Node.js')
    return false
  }
}

function spawnAndWait(cmd: string, args: string[], cwd: string, tag: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    proc.stderr?.on('data', (d) => console.log(`${tag} ${d.toString('utf8').trim()}`))
    proc.stdout?.on('data', (d) => console.log(`${tag} ${d.toString('utf8').trim()}`))
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)))
    proc.on('error', reject)
  })
}

function startServer(): Promise<boolean> {
  return new Promise(async (resolve) => {
    const srvDir = findServerDir()
    if (!srvDir) { resolve(false); return }
    console.log(`[Electron] srvDir: ${srvDir}, node_modules: ${fs.existsSync(join(srvDir, 'node_modules'))}, dist: ${fs.existsSync(join(srvDir, 'dist', 'app.js'))}`)

    // 生产模式：首次启动自动 npm install（node_modules 已存在则跳过）
    const isDev = fs.existsSync(join(srvDir, 'src', 'app.ts'))
    if (!isDev && !fs.existsSync(join(srvDir, 'node_modules'))) {
      console.log('[Electron] 首次启动，安装后端依赖...')
      const ok = await ensureDeps(srvDir)
      if (!ok) { resolve(false); return }
    }

    const hasDist = fs.existsSync(join(srvDir, 'dist', 'app.js'))
    console.log(`[Electron] 启动后端: ${hasDist ? `node ${join(srvDir, 'dist', 'app.js')}` : 'npx tsx'}`)

    if (hasDist) {
      // 用 spawn 替代 fork，打包后更可靠
      const serverScript = join(srvDir, 'dist', 'app.js')
      serverProcess = spawn('node', [serverScript], {
        cwd: srvDir,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } else {
      serverProcess = spawn('npx', ['tsx', 'src/app.ts'], {
        cwd: srvDir,
        shell: true,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }

    serverProcess.stdout?.setEncoding('utf8')
    serverProcess.stderr?.setEncoding('utf8')

    let serverOut = ''
    serverProcess.stdout?.on('data', (msg: string) => {
      serverOut += msg
      const trimmed = msg.trim()
      if (trimmed && /^[a-zA-Z\[]/.test(trimmed)) console.log('[server]', trimmed)
    })
    serverProcess.stderr?.on('data', (msg: string) => {
      serverOut += msg
      const trimmed = msg.trim()
      if (trimmed && !trimmed.includes('DeprecationWarning')) console.log('[server:err]', trimmed)
    })

    serverProcess.on('error', (err) => {
      console.error('[Electron] 后端启动失败:', err.message)
      serverOut += `\n${err.message}`
      serverProcess = null
    })

    serverProcess.on('exit', (code, signal) => {
      console.log(`[Electron] 后端进程退出: code=${code} signal=${signal}`)
      serverProcess = null
    })

    // 等待后端就绪（最多 30 秒）
    waitForServer(30, 1000).then(ok => {
      console.log(`[Electron] waitForServer: ${ok}, process alive: ${!!serverProcess}`)
      resolve(ok)
    })
  })
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }
}

async function waitForServer(retries = 30, interval = 1000): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    // 进程已退出则不再等待
    if (!serverProcess) return false
    try {
      const resp = await fetch(`${SERVER_URL}/api/ai/models`)
      if (resp.ok) return true
    } catch {}
    await new Promise(r => setTimeout(r, interval))
  }
  return false
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'NEXUS Desktop',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html'))
    mainWindow.webContents.openDevTools()  // 生产也开 DevTools，方便排查
  }
}

// ── IPC ──

ipcMain.handle('dialog:openProject', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: '选择项目目录',
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const projectPath = result.filePaths[0]

  try {
    await fetch(`${SERVER_URL}/api/fs/workspace`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: projectPath }),
    })
  } catch (e: any) {
    console.error('[Electron] workspace switch failed:', e.message)
    // Still return the path so the UI can show the file tree
  }
  return projectPath
})

ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    title: '选择文件',
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('shell:openPath', async (_e, path: string) => {
  shell.openPath(path)
})

ipcMain.handle('server:status', async () => {
  try {
    const resp = await fetch(`${SERVER_URL}/api/ai/models`)
    return resp.ok ? 'connected' : 'error'
  } catch {
    return 'offline'
  }
})

ipcMain.handle('app:machineId', () => MACHINE_ID)

ipcMain.handle('app:connect', async () => {
  return { userId: 1, username: 'desktop' }
})

// ── App lifecycle ──

app.whenReady().then(async () => {
  createWindow()
  const online = await startServer()
  if (online) {
    console.log(`[Electron] 后端已启动 ${SERVER_URL}`)
  } else {
    const errMsg = '后端启动失败。请确保:\n1. Node.js 已安装\n2. cd server && npm install && npm run build'
    console.error('[Electron]', errMsg)
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript(
        `document.querySelector('.server-banner')?.remove(); ` +
        `const b=document.createElement('div');b.className='server-banner';` +
        `b.innerHTML='<code>${errMsg.replace(/\n/g,'<br>')}</code>';` +
        `document.querySelector('.chat-panel')?.prepend(b)`
      )
    }
  }
})

app.on('before-quit', () => stopServer())
app.on('window-all-closed', () => app.quit())
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
