import { Router, Request, Response } from 'express'
import { ApiResponse } from '../utils/response.js'
import { ChatHistoryModel } from '../store/chatHistory.js'
import { providerManager } from '../providers/index.js'
import { updateSetting } from '../config/index.js'
import { deleteCompaction } from '../services/compaction.js'
import { loadMemory, clearMemory } from '../services/memory.js'

const router = Router()

// DELETE /api/desktop/sessions/:sessionId - 删除会话
router.delete('/sessions/:sessionId', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string
    if (!sessionId) return ApiResponse.badRequest(res, '参数不完整')

    const deleted = await ChatHistoryModel.deleteBySessionIdAndUserId(sessionId, 1)
    deleteCompaction(sessionId)
    ApiResponse.success(res, { deleted }, '会话已删除')
  } catch (err: any) {
    ApiResponse.internalServerError(res, '删除失败', err.message)
  }
})

// GET /api/desktop/settings - 获取当前配置
router.get('/settings', async (_req: Request, res: Response) => {
  try {
    const caps = providerManager.getCapabilities()
    ApiResponse.success(res, { capabilities: caps })
  } catch (err: any) {
    ApiResponse.internalServerError(res, '获取配置失败', err.message)
  }
})

// PUT /api/desktop/settings - 更新 LLM 配置
router.put('/settings', async (req: Request, res: Response) => {
  try {
    const { name, model, baseURL, apiKey, format, requestTemplate } = req.body
    await providerManager.saveLLMConfig({
      ...(name !== undefined ? { name } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(baseURL !== undefined ? { baseURL } : {}),
      ...(apiKey !== undefined && apiKey && !apiKey.includes('***') ? { apiKey } : {}),
      ...(format !== undefined ? { format } : {}),
      ...(requestTemplate !== undefined ? { requestTemplate } : {}),
    })
    ApiResponse.success(res, null, '配置已更新')
  } catch (err: any) {
    ApiResponse.internalServerError(res, '更新配置失败', err.message)
  }
})

// PUT /api/desktop/settings/embedding - 更新向量化配置
router.put('/settings/embedding', async (req: Request, res: Response) => {
  try {
    const { name, model, baseURL, apiKey, forceAPI } = req.body
    await providerManager.saveEmbeddingConfig({
      ...(name !== undefined ? { name } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(baseURL !== undefined ? { baseURL } : {}),
      ...(apiKey !== undefined && apiKey && !apiKey.includes('***') ? { apiKey } : {}),
      ...(forceAPI !== undefined ? { forceAPI } : {}),
    })
    ApiResponse.success(res, null, '向量化配置已更新')
  } catch (err: any) {
    ApiResponse.internalServerError(res, '更新配置失败', err.message)
  }
})

// PUT /api/desktop/settings/rerank - 更新重排序配置
router.put('/settings/rerank', async (req: Request, res: Response) => {
  try {
    const { name, model, baseURL, apiKey, forceAPI } = req.body
    await providerManager.saveRerankConfig({
      ...(name !== undefined ? { name } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(baseURL !== undefined ? { baseURL } : {}),
      ...(apiKey !== undefined && apiKey && !apiKey.includes('***') ? { apiKey } : {}),
      ...(forceAPI !== undefined ? { forceAPI } : {}),
    })
    ApiResponse.success(res, null, '重排序配置已更新')
  } catch (err: any) {
    ApiResponse.internalServerError(res, '更新配置失败', err.message)
  }
})

// PUT /api/desktop/settings/image - 保存图片生成配置
router.put('/settings/image', async (req: Request, res: Response) => {
  try {
    const { name, model, baseURL, apiKey } = req.body
    await providerManager.saveImageConfig({
      ...(name !== undefined ? { name } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(baseURL !== undefined ? { baseURL } : {}),
      ...(apiKey !== undefined && apiKey && !apiKey.includes('***') ? { apiKey } : {}),
    })
    ApiResponse.success(res, null, '图片生成配置已更新')
  } catch (err: any) {
    ApiResponse.internalServerError(res, '保存失败', err.message)
  }
})

// PUT /api/desktop/settings/search - 保存联网搜索 Key
router.put('/settings/search', async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body
    if (apiKey && !apiKey.includes('***')) {
      await updateSetting('TAVILY_API_KEY', apiKey)
    }
    ApiResponse.success(res, null, '搜索配置已更新')
  } catch (err: any) {
    ApiResponse.internalServerError(res, '保存失败', err.message)
  }
})

// GET /api/desktop/memory - 查看持久记忆
router.get('/memory', (_req: Request, res: Response) => {
  try {
    const memory = loadMemory()
    ApiResponse.success(res, { memory: memory || '（暂无记忆）' })
  } catch (err: any) {
    ApiResponse.internalServerError(res, '获取记忆失败', err.message)
  }
})

// DELETE /api/desktop/memory - 清空持久记忆
router.delete('/memory', (_req: Request, res: Response) => {
  try {
    clearMemory()
    ApiResponse.success(res, null, '记忆已清空')
  } catch (err: any) {
    ApiResponse.internalServerError(res, '清空记忆失败', err.message)
  }
})

export default router
