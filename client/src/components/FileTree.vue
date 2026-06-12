<template>
  <div class="file-tree">
    <div class="tree-header">
      <Icon icon="mdi:folder" :size="16" />
      <span>{{ projectName }}</span>
      <span v-if="indexing" class="index-badge"><span class="spin" /></span>
    </div>

    <!-- Search filter -->
    <div class="tree-search">
      <el-input
        v-model="filterText"
        size="small"
        placeholder="搜索文件名..."
        clearable
        :prefix-icon="Search"
      />
    </div>

    <div class="tree-body">
      <div v-if="!projectPath" class="empty-hint">
        <div class="empty-icon"><Icon icon="mdi:folder-open" :size="48" /></div>
        <p>打开项目目录以查看文件</p>
      </div>
      <div v-else-if="loading" class="tree-loading">
        <div class="tree-spinner" />
        <span>{{ loadingText }}</span>
      </div>
      <TransitionGroup v-else name="tree-enter" tag="div" class="tree-entries">
        <div
          v-for="entry in filteredEntries"
          :key="entry.path"
          class="tree-entry"
          :class="{ folder: entry.type === 'directory', file: entry.type !== 'directory', changed: changedFiles.has(entry.path) }"
          :style="{ paddingLeft: (entry.depth || 0) * 16 + 12 + 'px' }"
          @click="onEntryClick(entry)"
        >
          <span class="entry-icon"><Icon :icon="entryIcon(entry)" :size="16" /></span>
          <span class="entry-name" v-html="highlightMatch(entry.name)" />
          <span v-if="changedFiles.has(entry.path)" class="entry-changed">●</span>
          <span v-if="entry.type === 'directory'" class="entry-arrow" :class="{ open: expandedDirs.has(entry.path) }">›</span>
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { Icon } from '@iconify/vue'
import { fetchFileTree } from '../apis'

const props = defineProps<{
  projectPath: string
  refreshTrigger: number
}>()
const emit = defineEmits<{
  'select-file': [path: string]
}>()

const entries = ref<any[]>([])
const loading = ref(false)
const indexing = ref(false)
const loadingText = ref('扫描文件...')
const expandedDirs = ref<Set<string>>(new Set())
const filterText = ref('')
const changedFiles = ref<Set<string>>(new Set())

const projectName = computed(() => {
  if (!props.projectPath) return '文件资源管理器'
  const parts = props.projectPath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || '项目'
})

// Filter entries by search text
const filteredEntries = computed(() => {
  if (!filterText.value.trim()) return entries.value
  const q = filterText.value.toLowerCase()
  return entries.value.filter(e =>
    e.name.toLowerCase().includes(q) ||
    e.path.toLowerCase().includes(q)
  )
})

function highlightMatch(name: string): string {
  if (!filterText.value.trim()) return name
  const q = filterText.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return name.replace(new RegExp(`(${q})`, 'gi'), '<mark>$1</mark>')
}

function entryIcon(entry: any): string {
  if (entry.type === 'directory') {
    return expandedDirs.value.has(entry.path)
      ? 'mdi:folder-open'
      : 'mdi:folder'
  }
  return fileIcon(entry.name)
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    // TypeScript/JavaScript
    ts: 'vscode-icons:file-type-typescript',
    tsx: 'vscode-icons:file-type-reactts',
    js: 'vscode-icons:file-type-js',
    jsx: 'vscode-icons:file-type-reactjs',
    mjs: 'vscode-icons:file-type-js',
    cjs: 'vscode-icons:file-type-js',
    // Vue
    vue: 'vscode-icons:file-type-vue',
    // 样式
    css: 'vscode-icons:file-type-css',
    scss: 'vscode-icons:file-type-scss',
    less: 'vscode-icons:file-type-less',
    // 配置
    json: 'vscode-icons:file-type-json',
    json5: 'vscode-icons:file-type-json',
    yml: 'vscode-icons:file-type-yaml',
    yaml: 'vscode-icons:file-type-yaml',
    toml: 'vscode-icons:file-type-toml',
    ini: 'vscode-icons:file-type-ini',
    env: 'vscode-icons:file-type-env',
    // 文档
    md: 'vscode-icons:file-type-markdown',
    mdx: 'vscode-icons:file-type-markdown',
    txt: 'vscode-icons:file-type-text',
    // Web
    html: 'vscode-icons:file-type-html',
    htm: 'vscode-icons:file-type-html',
    svg: 'vscode-icons:file-type-svg',
    xml: 'vscode-icons:file-type-xml',
    // 图片
    png: 'vscode-icons:file-type-image',
    jpg: 'vscode-icons:file-type-image',
    jpeg: 'vscode-icons:file-type-image',
    gif: 'vscode-icons:file-type-image',
    webp: 'vscode-icons:file-type-image',
    ico: 'vscode-icons:file-type-image',
    // 编程语言
    py: 'vscode-icons:file-type-python',
    go: 'vscode-icons:file-type-go',
    rs: 'vscode-icons:file-type-rust',
    java: 'vscode-icons:file-type-java',
    kt: 'vscode-icons:file-type-kotlin',
    swift: 'vscode-icons:file-type-swift',
    c: 'vscode-icons:file-type-c',
    cpp: 'vscode-icons:file-type-cpp',
    h: 'vscode-icons:file-type-c',
    // Shell
    sh: 'vscode-icons:file-type-shell',
    bash: 'vscode-icons:file-type-shell',
    zsh: 'vscode-icons:file-type-shell',
    ps1: 'vscode-icons:file-type-powershell',
    bat: 'vscode-icons:file-type-bat',
    // 数据库
    sql: 'vscode-icons:file-type-sql',
    // Git
    gitignore: 'vscode-icons:file-type-git',
    gitattributes: 'vscode-icons:file-type-git',
    // 其他
    lock: 'vscode-icons:file-type-lock',
    pdf: 'vscode-icons:file-type-pdf2',
    doc: 'vscode-icons:file-type-word',
    docx: 'vscode-icons:file-type-word',
    xls: 'vscode-icons:file-type-excel',
    xlsx: 'vscode-icons:file-type-excel',
    ppt: 'vscode-icons:file-type-powerpoint',
    pptx: 'vscode-icons:file-type-powerpoint',
    zip: 'vscode-icons:file-type-zip',
    tar: 'vscode-icons:file-type-zip',
    gz: 'vscode-icons:file-type-zip',
  }
  return map[ext || ''] || 'mdi:file'
}

const loadingTexts = ['扫描文件中...', '建立索引...', '分析结构...', '即将完成...']
let loadTimer = 0

async function loadTree() {
  loading.value = true
  indexing.value = true
  let i = 0
  loadTimer = window.setInterval(() => {
    loadingText.value = loadingTexts[i % loadingTexts.length]
    i++
  }, 800)
  try {
    const result = await fetchFileTree()
    entries.value = result.map((e: any) => ({ ...e, depth: 0 }))
  } finally {
    clearInterval(loadTimer)
    loading.value = false
    indexing.value = false
  }
}

// Auto-refresh when projectPath or refreshTrigger changes
watch(() => [props.projectPath, props.refreshTrigger], async ([p]) => {
  if (!p) { entries.value = []; expandedDirs.value = new Set(); return }
  expandedDirs.value = new Set()
  await loadTree()
}, { immediate: true })

// Mark changed files from external edit events
function markChanged(filePath: string) {
  changedFiles.value.add(filePath)
  changedFiles.value = new Set(changedFiles.value)
  setTimeout(() => {
    changedFiles.value.delete(filePath)
    changedFiles.value = new Set(changedFiles.value)
  }, 3000)
}

async function onEntryClick(entry: any) {
  if (entry.type === 'directory') {
    if (expandedDirs.value.has(entry.path)) {
      expandedDirs.value.delete(entry.path)
      entries.value = entries.value.filter((e: any) => !e.parent || e.parent !== entry.path)
      expandedDirs.value = new Set(expandedDirs.value)
    } else {
      expandedDirs.value.add(entry.path)
      expandedDirs.value = new Set(expandedDirs.value)
      const children = await fetchFileTree(entry.path)
      const idx = entries.value.indexOf(entry)
      entries.value.splice(idx + 1, 0, ...children.map((c: any) => ({
        ...c, depth: entry.depth + 1, parent: entry.path,
      })))
    }
  } else {
    emit('select-file', entry.path)
  }
}

defineExpose({ markChanged })
</script>

<style scoped>
.file-tree { height: 100%; display: flex; flex-direction: column; }
.tree-header {
  padding: 10px 14px; font-size: 13px; font-weight: 600;
  display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #404040; flex-shrink: 0;
}
.index-badge { margin-left: auto; color: #888; font-size: 11px; }
.spin { display: inline-block; width: 12px; height: 12px; border: 2px solid #404040; border-top-color: #007acc; border-radius: 50%; animation: spin 0.8s linear infinite; }

.tree-search { padding: 8px 12px; border-bottom: 1px solid #333; flex-shrink: 0; }
.tree-search :deep(.el-input__inner) { background: #1e1e1e; border-color: #404040; color: #ccc; }
.tree-search :deep(mark) { background: #3a3d00; color: #e8e8a0; padding: 0 2px; border-radius: 2px; }

.tree-body { flex: 1; overflow-y: auto; padding: 4px 0; }

.empty-hint { padding: 40px 20px; text-align: center; color: #888; font-size: 13px; animation: fadeIn 0.5s ease; }
.empty-icon { margin-bottom: 8px; display: flex; justify-content: center; }

.tree-loading { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 32px; color: #888; font-size: 13px; }
.tree-spinner { width: 28px; height: 28px; border: 3px solid #333; border-top-color: #007acc; border-radius: 50%; animation: spin 0.8s linear infinite; }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

.tree-entries { padding: 2px 0; }
.tree-enter-enter-active { transition: all 0.2s ease; }
.tree-enter-enter-from { opacity: 0; transform: translateX(-8px); }

.tree-entry {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 12px; font-size: 13px; cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: background 0.15s;
}
.tree-entry:hover { background: #2a2d2e; }
.tree-entry.file:hover { color: #4fc1ff; }
.tree-entry.changed { background: rgba(0,122,204,0.1); }
.entry-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 18px; height: 18px; }
.entry-name { overflow: hidden; text-overflow: ellipsis; }
.entry-name :deep(mark) { background: #3a3d00; color: #e8e8a0; padding: 0 1px; border-radius: 2px; }
.entry-changed { color: #007acc; font-size: 8px; margin-left: 4px; animation: pulse 1.5s ease infinite; }
.entry-arrow { margin-left: auto; font-size: 16px; transition: transform 0.2s; color: #666; flex-shrink: 0; }
.entry-arrow.open { transform: rotate(90deg); }

@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
