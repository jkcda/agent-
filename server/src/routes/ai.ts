import express from 'express'
import fs from 'fs'
import path from 'path'
import { chatWithAIStream } from '../services/ai.js'
import { ChatHistoryModel } from '../store/chatHistory.js'
import { ApiResponse } from '../utils/response.js'
import { providerManager } from '../providers/index.js'
import config from '../config/index.js'
import { extractMemory } from '../services/memory.js'

const router = express.Router()

// POST /api/ai/chat - AI对话（SSE 流式）
router.post('/chat', async (req, res) => {
  try {
    const { message, sessionId, files, webSearchEnabled, model, initImage, projectPath } = req.body

    if (!message && (!files || files.length === 0)) {
      return ApiResponse.badRequest(res, '请输入消息内容或上传文件')
    }
    if (!sessionId) {
      return ApiResponse.badRequest(res, '请提供会话ID')
    }

    const userId = 1 // 桌面端固定用户

    // SSE 流式
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.flushHeaders()

    try {
      const { stream, sessionId: returnedSessionId, agentMode } = await chatWithAIStream(
        message || '',
        sessionId,
        userId,
        files && files.length > 0 ? files : undefined,
        webSearchEnabled !== false,
        model || undefined,
        initImage || undefined,
      )

      let assistantContent = ''
      const toolLog: string[] = []
      let eventCount = 0

      if (agentMode) {
        for await (const event of stream) {
          eventCount++
          if (typeof event === 'string') {
            assistantContent += event
            res.write(`data: ${JSON.stringify({ content: event })}\n\n`)
            continue
          }
          switch (event.type) {
            case 'content':
              assistantContent += event.content || ''
              res.write(`data: ${JSON.stringify({ content: event.content })}\n\n`)
              break
            case 'tool_call':
              toolLog.push(`🔧 ${event.tool}`)
              console.log(`[AI] 工具调用: ${event.tool}`, JSON.stringify(event.args || {}).slice(0, 200))
              res.write(`data: ${JSON.stringify({ type: 'tool_call', tool: event.tool, args: event.args })}\n\n`)
              break
            case 'tool_result': {
              const result = (event as any).result || ''
              console.log(`[AI] 工具结果: ${event.tool} (${result.length}字符)`)
              // fs_edit / fs_write diff 追加到 assistantContent，存历史
              if ((event.tool === 'fs_edit' || event.tool === 'fs_write') && result) {
                const m = result.match(/已修改\s+(.+?)[\s:]/) || result.match(/文件已写入[：:]\s*(.+?)[\s(]/)
                const fp = m?.[1] || event.tool
                const lines = result.split('\n').filter((l: string) => {
                  const t = l.trim()
                  return t && !t.startsWith('已修改') && !t.startsWith('文件已写入')
                })
                if (lines.length > 0) {
                  assistantContent += `\n\n📝 **${fp}**\n\n\`\`\`diff\n${lines.join('\n')}\n\`\`\`\n`
                }
              }
              let summary = ''
              try {
                const j = JSON.parse(result)
                if (j.path) summary = `${j.path}${j.totalLines ? ` (${j.totalLines}行)` : ''}${j.type === 'directory' ? ` [${j.count}项]` : ''}`
                else if (j.files) summary = `${j.files.length}个文件`
                else if (j.text) summary = j.text.slice(0, 100)
                else summary = result.slice(0, 100)
              } catch {
                summary = result.slice(0, 100).replace(/\n/g, ' ')
              }
              toolLog.push(`  → ${summary}${result.length > 100 ? '...' : ''}`)
              res.write(`data: ${JSON.stringify({ type: 'tool_result', tool: event.tool, result, ...(event.imageUrl ? { imageUrl: event.imageUrl } : {}) })}\n\n`)
              break
            }
            case 'done':
              console.log(`[AI] 流结束: ${eventCount} events, ${assistantContent.length}字符内容, ${toolLog.length}个工具调用`)
              break
            case 'error':
              console.log(`[AI] 错误: ${event.error}`)
              res.write(`data: ${JSON.stringify({ error: event.error })}\n\n`)
              break
          }
        }
      } else {
        for await (const event of stream) {
          if (event.type === 'content_block_delta') {
            const content = (event.delta as any)?.text
            if (content) {
              assistantContent += content
              res.write(`data: ${JSON.stringify({ content })}\n\n`)
            }
          }
        }
      }

      // 保存助手消息（只存最终内容，不存工具调用日志）
      if (assistantContent) {
        await ChatHistoryModel.create(
          returnedSessionId,
          userId,
          'assistant',
          assistantContent,
        )

        // 异步提取持久记忆（不阻塞响应）
        if (message && assistantContent) {
          extractMemory(message, assistantContent).catch(() => {})
        }
      }

      res.write('data: [DONE]\n\n')
      res.end()
    } catch (error: any) {
      let errMsg: string = error.message || '未知错误'
      if (errMsg.includes('terminated') || errMsg.includes('abort')) {
        errMsg = '连接中断，请重试。如上传图片过大，请压缩后再试。'
      } else if (errMsg.includes('DataInspectionFailed') || errMsg.includes('inappropriate')) {
        errMsg = '内容审核拦截：回复因包含敏感内容被服务商拦截，请重新措辞后重试。'
      }
      res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`)
      res.end()
    }
  } catch (error: any) {
    ApiResponse.internalServerError(res, '服务器错误', error.message)
  }
})

// GET /api/ai/sessions - 获取会话列表
router.get('/sessions', async (_req, res) => {
  try {
    const sessions = await ChatHistoryModel.getSessionsByUserId(1)
    const formatted = (sessions as any[]).map(s => ({
      session_id: s.session_id,
      created_at: s.created_at,
      last_active_at: s.last_active_at,
      message_count: s.message_count,
      first_message: s.first_message,
      agent_id: s.agent_id || null,
      agent_name: s.agent_name || null,
      agent_avatar: s.agent_avatar || null
    }))
    ApiResponse.success(res, { sessions: formatted }, '获取会话列表成功')
  } catch (error: any) {
    ApiResponse.internalServerError(res, '服务器错误', error.message)
  }
})

// GET /api/ai/history - 获取对话历史
router.get('/history', async (req, res) => {
  try {
    const { sessionId } = req.query
    if (!sessionId) return ApiResponse.badRequest(res, '请提供会话ID')

    const history = await ChatHistoryModel.getBySessionIdAndUserId(sessionId as string, 1)
    const messages = history.map(item => ({
      role: item.role,
      content: item.content,
      files: item.files ? (typeof item.files === 'string' ? JSON.parse(item.files) : item.files) : undefined,
    }))

    ApiResponse.success(res, { messages }, '获取对话历史成功')
  } catch (error: any) {
    ApiResponse.internalServerError(res, '服务器错误', error.message)
  }
})

// DELETE /api/ai/history - 删除对话历史
router.delete('/history', async (req, res) => {
  try {
    const { sessionId } = req.query
    if (!sessionId) return ApiResponse.badRequest(res, '请提供会话ID')

    await ChatHistoryModel.deleteBySessionId(sessionId as string)
    ApiResponse.success(res, null, '对话历史已清空')
  } catch (error: any) {
    ApiResponse.internalServerError(res, '服务器错误', error.message)
  }
})

// GET /api/ai/models - 获取可用配置
router.get('/models', (_req, res) => {
  const llmCfg = providerManager.getLLMConfig()
  const imgCfg = providerManager.getImageConfig()
  ApiResponse.success(res, {
    llm: { name: llmCfg.name, model: llmCfg.model, format: llmCfg.format, baseURL: llmCfg.baseURL },
    image: { name: imgCfg.name, model: imgCfg.model, baseURL: imgCfg.baseURL, defaultSize: imgCfg.defaultSize },
    models: [{
      id: llmCfg.model,
      name: llmCfg.name ? `${llmCfg.name} - ${llmCfg.model}` : llmCfg.model,
      type: 'multimodal',
      desc: '当前配置的 LLM 模型',
    }],
    imageRatios: config.ai.imageRatios,
  }, '获取配置成功')
})

// POST /api/ai/image - 文生图 / 图生图
router.post('/image', async (req, res) => {
  try {
    const { prompt, sessionId, size, initImage } = req.body
    if (!prompt) return ApiResponse.badRequest(res, '请提供图片描述')

    const imgCfg = providerManager.getImageConfig()
    console.log(`[ImageGen] 供应商: ${imgCfg.name}, 模型: ${imgCfg.model}`)

    if (sessionId) {
      await ChatHistoryModel.create(sessionId, 1, 'user', prompt)
    }

    const imageUrl = await providerManager.generateImage(prompt, size || imgCfg.defaultSize, initImage)
    if (imageUrl) {
      if (sessionId) {
        await ChatHistoryModel.create(sessionId, 1, 'assistant', `[生成图片](${imageUrl})`)
      }
      return ApiResponse.success(res, { imageUrl }, '图片生成成功')
    }
    return ApiResponse.internalServerError(res, '图片生成返回为空')
  } catch (error: any) {
    ApiResponse.internalServerError(res, '图片生成失败', error.message)
  }
})

export default router
