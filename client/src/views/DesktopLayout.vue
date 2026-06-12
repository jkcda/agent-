<template>
  <div class="desktop-shell">
    <!-- Title bar -->
    <header class="title-bar">
      <span class="title">NEXUS Desktop</span>
      <div class="title-actions">
        <el-button size="small" @click="openProject">
          <el-icon><FolderOpened /></el-icon>
          {{ projectPath ? '切换项目' : '打开项目' }}
        </el-button>
        <el-button size="small" @click="settingsRef?.open()">
          <el-icon><Setting /></el-icon>
        </el-button>
        <span v-if="projectPath" class="project-label">{{ projectPath }}</span>
      </div>
    </header>

    <!-- Main panels -->
    <div class="main-panels">
      <!-- Left: file tree -->
      <div class="panel panel-left" :style="{ width: leftWidth + 'px' }">
        <FileTree
          ref="fileTreeRef"
          :project-path="projectPath"
          :refresh-trigger="treeRefreshKey"
          @select-file="onSelectFile"
        />
      </div>

      <div class="resize-handle resize-left" @mousedown="onResizeLeftStart" />

      <!-- Center: chat + exec output -->
      <div class="panel panel-center">
        <div class="center-split" :style="{ flexDirection: 'column' }">
          <div :style="{ flex: execOutput ? '1 1 60%' : '1 1 100%', minHeight: 0, overflow: 'hidden' }">
            <ChatPanel
              ref="chatRef"
              :project-path="projectPath"
              :selected-file="selectedFile"
              @file-changed="onFileChanged"
              @exec-run="onExecRun"
            />
          </div>
          <Transition name="exec-slide">
            <div v-if="execOutput" class="exec-panel">
              <div class="exec-header">
                <span class="exec-cmd">{{ execCommand }}</span>
                <div>
                  <el-button size="small" text @click="rerunExec" :icon="RefreshRight">重跑</el-button>
                  <el-button size="small" text :icon="Close" @click="execOutput = ''" />
                </div>
              </div>
              <pre class="exec-output">{{ execOutput }}</pre>
            </div>
          </Transition>
        </div>
      </div>

      <div v-if="selectedFile" class="resize-handle resize-right" @mousedown="onResizeRightStart" />

      <!-- Right: file preview -->
      <Transition name="preview-slide">
        <div v-if="selectedFile" class="panel panel-right" :style="{ width: rightWidth + 'px' }">
          <FilePreview
            ref="filePreviewRef"
            :file-path="selectedFile"
            @close="selectedFile = ''"
          />
        </div>
      </Transition>
    </div>

    <!-- Status bar -->
    <footer class="status-bar">
      <span>{{ projectPath || '未打开项目' }}</span>
      <span>Agent · NEXUS</span>
    </footer>

    <SettingsDialog ref="settingsRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { FolderOpened, Setting, Close, RefreshRight } from '@element-plus/icons-vue'
import FileTree from '../components/FileTree.vue'
import ChatPanel from '../components/ChatPanel.vue'
import FilePreview from '../components/FilePreview.vue'
import SettingsDialog from '../components/SettingsDialog.vue'
import { setWorkspace, initDesktopIdentity, API_HOST } from '../apis'

const settingsRef = ref<InstanceType<typeof SettingsDialog> | null>(null)
const fileTreeRef = ref<InstanceType<typeof FileTree> | null>(null)
const filePreviewRef = ref<InstanceType<typeof FilePreview> | null>(null)
const chatRef = ref<InstanceType<typeof ChatPanel> | null>(null)

initDesktopIdentity()

const projectPath = ref('') // Empty until workspace is confirmed
const selectedFile = ref('')
const leftWidth = ref(260)
const rightWidth = ref(400)
const treeRefreshKey = ref(0)

// Exec output panel
const execOutput = ref('')
const execCommand = ref('')

async function openProject() {
  const path = await window.electronAPI.openProject()
  if (path) {
    selectedFile.value = ''
    await setWorkspace(path)
    try { localStorage.setItem('nexus-desktop-project', path) } catch {}
    projectPath.value = path
  }
}

// Restore last workspace — retry until server is ready
;(async () => {
  const last = localStorage.getItem('nexus-desktop-project')
  if (!last) return
  for (let i = 0; i < 10; i++) {
    try {
      await setWorkspace(last)
      projectPath.value = last
      return
    } catch {
      await new Promise(r => setTimeout(r, 1000))
    }
  }
})()

function onSelectFile(path: string) {
  selectedFile.value = path
}

// Agent modified a file → refresh tree + preview
function onFileChanged(filePath: string, diffText: string) {
  treeRefreshKey.value++
  fileTreeRef.value?.markChanged(filePath)
  if (selectedFile.value !== filePath) {
    selectedFile.value = filePath
    nextTick(() => {
      filePreviewRef.value?.notifyExternalChange(diffText)
    })
  } else {
    filePreviewRef.value?.notifyExternalChange(diffText)
  }
}

// Agent ran a command → show exec output panel
function onExecRun(command: string, output: string) {
  execCommand.value = command
  execOutput.value = output
}

async function rerunExec() {
  if (!execCommand.value) return
  try {
    const resp = await fetch(API_HOST + '/api/fs/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: execCommand.value }),
    })
    const data = await resp.json()
    execOutput.value = data.result?.output || '执行完成'
  } catch {
    execOutput.value = '执行失败：无法连接后端'
  }
}

// Resize handles
let resizingLeft = false
let resizingRight = false
function onResizeLeftStart() { resizingLeft = true }
function onResizeRightStart() { resizingRight = true }
document.addEventListener('mousemove', (e) => {
  if (resizingLeft) {
    leftWidth.value = Math.max(180, Math.min(500, e.clientX))
  }
  if (resizingRight) {
    const rightEdge = window.innerWidth
    rightWidth.value = Math.max(280, Math.min(800, rightEdge - e.clientX - 8))
  }
})
document.addEventListener('mouseup', () => { resizingLeft = false; resizingRight = false })
</script>

<style scoped>
.desktop-shell { display: flex; flex-direction: column; height: 100%; background: #1e1e1e; color: #ccc; }

.title-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px; background: #2d2d2d; border-bottom: 1px solid #404040;
  -webkit-app-region: drag;
}
.title-bar .el-button { -webkit-app-region: no-drag; }
.title { font-size: 13px; font-weight: 600; color: #e0e0e0; }
.title-actions { display: flex; align-items: center; gap: 12px; }
.project-label { font-size: 12px; color: #888; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.main-panels { display: flex; flex: 1; overflow: hidden; }
.panel { overflow: hidden; }
.panel-left { background: #252525; border-right: 1px solid #404040; flex-shrink: 0; }
.panel-center { flex: 1; min-width: 0; }
.center-split { display: flex; height: 100%; }
.panel-right { background: #1b1b1b; border-left: 1px solid #404040; flex-shrink: 0; }

.resize-handle { width: 4px; cursor: col-resize; background: transparent; flex-shrink: 0; }
.resize-handle:hover { background: #007acc; }

/* ── Exec output panel ── */
.exec-panel {
  border-top: 1px solid #404040; background: #1a1a1a; flex-shrink: 0;
  display: flex; flex-direction: column; max-height: 40%;
}
.exec-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 12px; background: #252525; border-bottom: 1px solid #333; flex-shrink: 0;
}
.exec-cmd { font-family: 'Cascadia Code', monospace; font-size: 12px; color: #e8ab53; }
.exec-output {
  flex: 1; overflow: auto; margin: 0; padding: 12px;
  font-family: 'Cascadia Code', monospace; font-size: 12px; line-height: 1.5;
  color: #d4d4d4; white-space: pre-wrap; word-break: break-all;
}

.exec-slide-enter-active { transition: all 0.3s ease; }
.exec-slide-leave-active { transition: all 0.2s ease; }
.exec-slide-enter-from { opacity: 0; transform: translateY(20px); }
.exec-slide-leave-to { opacity: 0; transform: translateY(10px); }

.preview-slide-enter-active { transition: all 0.25s ease; }
.preview-slide-leave-active { transition: all 0.2s ease; }
.preview-slide-enter-from { opacity: 0; transform: translateX(20px); }
.preview-slide-leave-to { opacity: 0; transform: translateX(10px); }

.status-bar {
  display: flex; justify-content: space-between;
  padding: 4px 16px; background: #007acc; color: #fff; font-size: 12px;
}
</style>
