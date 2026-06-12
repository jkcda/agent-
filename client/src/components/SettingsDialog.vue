<template>
  <el-dialog v-model="visible" title="能力配置" width="520px" :close-on-click-modal="false">
    <el-tabs v-model="tab" @tab-change="onTabChange">
      <!-- LLM -->
      <el-tab-pane label="对话模型" name="llm">
        <el-form label-position="top">
          <el-form-item label="供应商名称">
            <el-input v-model="llmForm.name" placeholder="如 魔搭社区" />
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="llmForm.apiKey" type="password" show-password placeholder="sk-..." />
          </el-form-item>
          <el-form-item label="Base URL">
            <el-input v-model="llmForm.baseURL" placeholder="https://api-inference.modelscope.cn" />
          </el-form-item>
          <el-form-item label="模型">
            <el-input v-model="llmForm.model" placeholder="Qwen/Qwen3.5-397B-A17B" />
          </el-form-item>
          <el-form-item label="格式">
            <el-select v-model="llmForm.format">
              <el-option label="OpenAI" value="openai" />
              <el-option label="Anthropic" value="anthropic" />
            </el-select>
          </el-form-item>
          <el-form-item label="请求模板（JSON，可选）">
            <el-input v-model="llmForm.requestTemplate" type="textarea" :rows="3"
              placeholder='{"model":"{{model}}","messages":[...]} 留空使用默认格式' />
          </el-form-item>
          <el-form-item label="上下文窗口（tokens）">
            <el-input-number v-model="llmForm.contextWindow" :min="4096" :max="2000000" :step="1024" />
            <span style="margin-left: 8px; color: #888; font-size: 12px;">模型的上下文窗口大小，用于自动压缩历史</span>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- Embedding -->
      <el-tab-pane label="向量化" name="embedding">
        <el-form label-position="top">
          <el-form-item label="供应商名称">
            <el-input v-model="embForm.name" placeholder="如 魔搭社区" />
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="embForm.apiKey" type="password" show-password placeholder="sk-..." />
          </el-form-item>
          <el-form-item label="Base URL">
            <el-input v-model="embForm.baseURL" placeholder="https://api-inference.modelscope.cn" />
          </el-form-item>
          <el-form-item label="模型">
            <el-input v-model="embForm.model" placeholder="BAAI/bge-small-zh-v1.5" />
          </el-form-item>
          <el-form-item label="强制使用 API（低配服务器建议开启）">
            <el-switch v-model="embForm.forceAPI" />
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- Rerank -->
      <el-tab-pane label="重排序" name="rerank">
        <el-form label-position="top">
          <el-form-item label="供应商名称">
            <el-input v-model="rerankForm.name" placeholder="如 魔搭社区" />
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="rerankForm.apiKey" type="password" show-password placeholder="sk-..." />
          </el-form-item>
          <el-form-item label="Base URL">
            <el-input v-model="rerankForm.baseURL" placeholder="https://api-inference.modelscope.cn" />
          </el-form-item>
          <el-form-item label="模型">
            <el-input v-model="rerankForm.model" placeholder="BAAI/bge-reranker-v2-m3" />
          </el-form-item>
          <el-form-item label="强制使用 API（低配服务器建议开启）">
            <el-switch v-model="rerankForm.forceAPI" />
          </el-form-item>
        </el-form>
      </el-tab-pane>
      <!-- 图片生成 -->
      <el-tab-pane label="图片生成" name="image">
        <el-form label-position="top">
          <el-form-item label="供应商名称">
            <el-input v-model="imgForm.name" placeholder="如 火山引擎 ARK" />
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="imgForm.apiKey" type="password" show-password placeholder="..." />
          </el-form-item>
          <el-form-item label="Base URL">
            <el-input v-model="imgForm.baseURL" placeholder="https://ark.cn-beijing.volces.com" />
          </el-form-item>
          <el-form-item label="模型">
            <el-input v-model="imgForm.model" placeholder="doubao-seedream-4-5-251128" />
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 联网搜索 -->
      <el-tab-pane label="联网搜索" name="search">
        <el-form label-position="top">
          <el-form-item label="Tavily API Key">
            <el-input v-model="searchForm.apiKey" type="password" show-password placeholder="tvly-..." />
            <span style="color: #888; font-size: 12px;">注册: https://tavily.com，留空则禁用搜索</span>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <div class="dialog-footer">
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="save" :loading="saving">保存</el-button>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { API_HOST } from '../apis'

const visible = ref(false)
const saving = ref(false)
const tab = ref('llm')

const llmForm = reactive({
  name: '',
  apiKey: '',
  baseURL: '',
  model: '',
  format: 'openai' as string,
  requestTemplate: '',
  contextWindow: 131072,
})

const embForm = reactive({
  name: '',
  apiKey: '',
  baseURL: '',
  model: '',
  forceAPI: false,
})

const rerankForm = reactive({
  name: '',
  apiKey: '',
  baseURL: '',
  model: '',
  forceAPI: false,
})

const imgForm = reactive({
  name: '',
  apiKey: '',
  baseURL: '',
  model: '',
})

const searchForm = reactive({
  apiKey: '',
})

let _caps: any = {}

async function load() {
  try {
    const resp = await fetch(API_HOST + '/api/desktop/settings')
    const data = await resp.json()
    if (data.success && data.result?.capabilities) {
      _caps = data.result.capabilities
      const { llm, embedding, rerank, img, search } = _caps
      if (llm) Object.assign(llmForm, { ...llmForm, ...llm })
      if (embedding) Object.assign(embForm, { ...embForm, ...embedding })
      if (rerank) Object.assign(rerankForm, { ...rerankForm, ...rerank })
      if (img) Object.assign(imgForm, { ...imgForm, ...img })
      if (search) Object.assign(searchForm, { ...searchForm, ...search })
    }
  } catch { /* server offline */ }
}

function onTabChange() { /* no-op */ }

async function save() {
  saving.value = true
  try {
    const endpoints: [string, any][] = [
      [API_HOST + '/api/desktop/settings', llmForm],
      [API_HOST + '/api/desktop/settings/embedding', embForm],
      [API_HOST + '/api/desktop/settings/rerank', rerankForm],
      [API_HOST + '/api/desktop/settings/image', imgForm],
      [API_HOST + '/api/desktop/settings/search', searchForm],
    ]
    for (const [url, body] of endpoints) {
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }
    ElMessage.success('配置已保存')
    visible.value = false
  } catch {
    ElMessage.error('无法连接到后端')
  } finally {
    saving.value = false
  }
}

defineExpose({ open: () => { visible.value = true; load() } })
</script>

<style scoped>
.dialog-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
