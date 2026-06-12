<template>
  <div class="file-preview">
    <div class="preview-header">
      <span class="preview-name">{{ fileName }}</span>
      <div class="preview-actions">
        <span v-if="isDirty" class="dirty-badge">未保存</span>
        <el-button v-if="isDirty" size="small" type="primary" text @click="save">保存</el-button>
        <el-button size="small" text :icon="RefreshRight" @click="reload" />
        <el-button size="small" text :icon="Close" @click="$emit('close')" />
      </div>
    </div>

    <!-- Tab bar -->
    <div class="preview-tabs">
      <button :class="{ active: tab === 'source' }" @click="tab = 'source'">源码</button>
      <button :class="{ active: tab === 'diff' }" @click="tab = 'diff'" :disabled="!lastDiff">
        修改记录
        <span v-if="diffStats" class="diff-stats-badge">+{{ diffStats.added }} -{{ diffStats.removed }}</span>
      </button>
    </div>

    <div class="preview-body">
      <!-- Source editor -->
      <div v-show="tab === 'source'" class="editor-wrap">
        <div v-if="content === null" class="loading">
          <div class="spinner" /><span>加载中...</span>
        </div>
        <div v-else class="editor-container">
          <div class="line-nums" ref="lineNumsRef">
            <span v-for="n in lineCount" :key="n">{{ n }}</span>
          </div>
          <textarea ref="editorRef" class="editor-textarea" v-model="editedContent"
            @scroll="syncScroll" @input="onEdit" spellcheck="false" />
        </div>
      </div>

      <!-- Diff view -->
      <div v-show="tab === 'diff'" class="diff-view">
        <div v-if="!lastDiff" class="no-diff">暂无修改记录</div>
        <div v-else class="diff-body">
          <!-- Summary bar -->
          <div class="diff-summary" v-if="diffStats">
            <span class="diff-file">{{ fileName }}</span>
            <span class="diff-stat">
              <span class="add">+{{ diffStats.added }}</span>
              <span class="sep">/</span>
              <span class="del">-{{ diffStats.removed }}</span>
            </span>
          </div>
          <!-- Diff lines -->
          <div class="diff-lines">
            <template v-for="(group, gi) in diffGroups" :key="gi">
              <div v-if="group.text === '...'" class="diff-separator">···</div>
              <div v-else-if="group.type === 'same'" class="diff-row ctx">
                <span class="ln ln-old">{{ group.oldLine }}</span>
                <span class="ln ln-new">{{ group.newLine }}</span>
                <span class="sig"> </span>
                <span class="txt">{{ group.text }}</span>
              </div>
              <div v-else-if="group.type === 'del'" class="diff-row del">
                <span class="ln ln-old">{{ group.oldLine }}</span>
                <span class="ln ln-new"></span>
                <span class="sig">-</span>
                <span class="txt">{{ group.text }}</span>
              </div>
              <div v-else-if="group.type === 'add'" class="diff-row add">
                <span class="ln ln-old"></span>
                <span class="ln ln-new">{{ group.newLine }}</span>
                <span class="sig">+</span>
                <span class="txt">{{ group.text }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Close, RefreshRight } from '@element-plus/icons-vue'
import { readFileContent, API_HOST } from '../apis'

const props = defineProps<{ filePath: string }>()
defineEmits(['close'])

const content = ref<string | null>(null)
const editedContent = ref('')
const isDirty = ref(false)
const tab = ref<'source' | 'diff'>('source')
const editorRef = ref<HTMLTextAreaElement>()
const lineNumsRef = ref<HTMLDivElement>()

// Diff
interface DiffLine { type: 'add' | 'del' | 'same'; text: string; line?: number }
const lastDiff = ref<DiffLine[] | null>(null)

const diffStats = computed(() => {
  if (!lastDiff.value) return null
  let added = 0, removed = 0
  for (const l of lastDiff.value) {
    if (l.type === 'add') added++
    if (l.type === 'del') removed++
  }
  return { added, removed }
})

interface DiffGroup { type: 'add' | 'del' | 'same'; text: string; oldLine?: number; newLine?: number }

const diffGroups = computed((): DiffGroup[] => {
  if (!lastDiff.value) return []
  const groups: DiffGroup[] = []
  let oldLine = 1, newLine = 1
  for (const line of lastDiff.value) {
    if (line.type === 'same') {
      groups.push({ type: 'same', text: line.text, oldLine: line.line ?? oldLine, newLine: line.line ?? newLine })
      oldLine++; newLine++
    } else if (line.type === 'del') {
      groups.push({ type: 'del', text: line.text, oldLine: line.line ?? oldLine })
      oldLine++
    } else if (line.type === 'add') {
      groups.push({ type: 'add', text: line.text, newLine: line.line ?? newLine })
      newLine++
    }
  }
  return groups
})

const fileName = computed(() => {
  return props.filePath.replace(/\\/g, '/').split('/').pop() || 'unknown'
})

const lineCount = computed(() => editedContent.value.split('\n').length)

async function loadFile() {
  content.value = null; isDirty.value = false
  try { const c = await readFileContent(props.filePath); content.value = c; editedContent.value = c } catch { content.value = '// 无法读取文件'; editedContent.value = content.value }
}
function reload() { loadFile() }
function onEdit() { isDirty.value = editedContent.value !== (content.value || '') }
function syncScroll() { if (editorRef.value && lineNumsRef.value) lineNumsRef.value.scrollTop = editorRef.value.scrollTop }

async function save() {
  try {
    const resp = await fetch(API_HOST + '/api/fs/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: props.filePath, content: editedContent.value }) })
    const data = await resp.json()
    if (data.success) {
      buildDiff((content.value || '').split('\n'), editedContent.value.split('\n'))
      content.value = editedContent.value; isDirty.value = false
    }
  } catch {}
}

function buildDiff(oldLines: string[], newLines: string[]) {
  const diff: DiffLine[] = []
  const CTX = 4
  const maxLen = Math.max(oldLines.length, newLines.length)
  const changed = new Set<number>()
  for (let i = 0; i < maxLen; i++) { if (i >= oldLines.length || i >= newLines.length || oldLines[i] !== newLines[i]) changed.add(i) }

  let lastAdded = -999
  for (let i = 0; i < maxLen; i++) {
    const inCtx = [i - CTX, i - 3, i - 2, i - 1, i, i + 1, i + 2, i + 3, i + CTX].some(j => changed.has(j))
    if (!inCtx) {
      if (i - lastAdded > CTX * 2 && lastAdded >= 0) diff.push({ type: 'same', text: '...' })
      lastAdded = i
      continue
    }
    if (i >= oldLines.length) diff.push({ type: 'add', text: newLines[i] })
    else if (i >= newLines.length) diff.push({ type: 'del', text: oldLines[i] })
    else if (oldLines[i] !== newLines[i]) { diff.push({ type: 'del', text: oldLines[i] }); diff.push({ type: 'add', text: newLines[i] }) }
    else diff.push({ type: 'same', text: oldLines[i] })
    lastAdded = i
  }
  lastDiff.value = diff; tab.value = 'diff'
}

function notifyExternalChange(diffSummary?: string) {
  if (diffSummary) {
    const parsed: DiffLine[] = []
    for (const line of diffSummary.split('\n')) {
      const t = line.trim()
      if (t === '···') {
        parsed.push({ type: 'same', text: '...' })
      } else if (t.startsWith('+')) {
        const match = t.match(/^\+(\d+)\| (.*)$/)
        parsed.push({ type: 'add', text: match ? match[2] : t.slice(1), line: match ? parseInt(match[1]) : undefined })
      } else if (t.startsWith('-')) {
        const match = t.match(/^-(\d+)\| (.*)$/)
        parsed.push({ type: 'del', text: match ? match[2] : t.slice(1), line: match ? parseInt(match[1]) : undefined })
      } else if (t.startsWith(' ')) {
        const match = t.match(/^ (\d+)\| (.*)$/)
        parsed.push({ type: 'same', text: match ? match[2] : t, line: match ? parseInt(match[1]) : undefined })
      }
    }
    if (parsed.length > 0) { lastDiff.value = parsed; tab.value = 'diff'; _pendingDiff = parsed }
  }
  loadFile()
}

let _pendingDiff: DiffLine[] | null = null

watch(() => props.filePath, () => {
  if (_pendingDiff) { tab.value = 'diff'; lastDiff.value = _pendingDiff; _pendingDiff = null }
  else { lastDiff.value = null; tab.value = 'source' }
  loadFile()
}, { immediate: true })
</script>

<style scoped>
.file-preview { height: 100%; display: flex; flex-direction: column; }
.preview-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; border-bottom: 1px solid #404040; font-size: 13px; flex-shrink: 0; }
.preview-name { color: #e0e0e0; font-weight: 600; }
.preview-actions { display: flex; align-items: center; gap: 4px; }
.dirty-badge { font-size: 11px; color: #e8ab53; background: #3a3000; padding: 2px 6px; border-radius: 8px; }

.preview-tabs { display: flex; border-bottom: 1px solid #333; flex-shrink: 0; }
.preview-tabs button { padding: 6px 16px; font-size: 12px; background: none; border: none; color: #888; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s; }
.preview-tabs button.active { color: #007acc; border-bottom-color: #007acc; }
.preview-tabs button:disabled { opacity: 0.3; cursor: default; }
.diff-stats-badge { margin-left: 6px; font-size: 11px; color: #7ee787; }
.preview-body { flex: 1; overflow: hidden; }

/* Editor */
.editor-wrap { height: 100%; position: relative; }
.loading { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; height: 100%; color: #888; }
.spinner { width: 28px; height: 28px; border: 3px solid #333; border-top-color: #007acc; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.editor-container { display: flex; height: 100%; }
.line-nums { width: 48px; overflow: hidden; background: #1a1a1a; border-right: 1px solid #333; font-family: 'Cascadia Code', monospace; font-size: 13px; line-height: 1.6; padding: 12px 8px; text-align: right; color: #555; user-select: none; flex-shrink: 0; }
.line-nums span { display: block; }
.editor-textarea { flex: 1; background: #1b1b1b; color: #d4d4d4; border: none; outline: none; resize: none; font-family: 'Cascadia Code', monospace; font-size: 13px; line-height: 1.6; padding: 12px; white-space: pre; overflow: auto; tab-size: 2; }

/* Diff */
.diff-view { height: 100%; overflow-y: auto; }
.no-diff { color: #888; text-align: center; padding: 40px; }
.diff-body { font-family: 'Cascadia Code', monospace; font-size: 13px; line-height: 1.6; }

.diff-summary { display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; background: #1a2332; border-bottom: 1px solid #2a3a4a; position: sticky; top: 0; z-index: 1; }
.diff-file { color: #e0e0e0; font-weight: 600; }
.diff-stat { font-size: 12px; }
.diff-stat .add { color: #7ee787; font-weight: 600; }
.diff-stat .del { color: #f14c4c; font-weight: 600; }
.diff-stat .sep { color: #555; margin: 0 2px; }

.diff-lines { padding: 4px 0; }
.diff-row { display: flex; align-items: baseline; padding: 0 12px; min-height: 22px; }
.diff-row:hover { filter: brightness(1.15); }
.diff-row.del { background: rgba(248,81,73,0.1); }
.diff-row.add { background: rgba(35,134,54,0.1); }
.diff-row.ctx { color: #8b949e; }

.ln { width: 48px; flex-shrink: 0; text-align: right; padding-right: 12px; font-size: 12px; color: #484f58; user-select: none; }
.sig { width: 16px; flex-shrink: 0; text-align: center; font-weight: 600; user-select: none; }
.diff-row.del .sig { color: #f14c4c; }
.diff-row.add .sig { color: #7ee787; }
.txt { flex: 1; white-space: pre-wrap; word-break: break-all; overflow-wrap: anywhere; }

.diff-separator { padding: 2px 16px; font-size: 12px; color: #555; text-align: center; border-top: 1px dashed #333; border-bottom: 1px dashed #333; margin: 4px 0; }
</style>
