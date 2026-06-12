import { createAgent } from 'langchain'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import config, { getSetting } from '../config/index.js'
import { searchWeb, type WebSearchResult } from './webSearch.js'
import { getMcpTools } from './mcp.js'
import { fsTools } from './fileSystem.js'
import { createPPTX, createDOCX } from './documentGenerator.js'
import { codeToPDF, documentToMarkdown, generateResume } from './pdfGenerator.js'
import { providerManager } from '../providers/index.js'
import { loadMemory } from './memory.js'

function createTools(opts: { permissions: AgentPermissions; initImage?: string }) {
  const tools: any[] = []

  // search_web
  if (opts.permissions.webSearch ?? true) {
    const hasKey = config.webSearch.enabled && !!getSetting('TAVILY_API_KEY')
    if (hasKey) {
      tools.push(
        tool(async ({ query }: { query: string }) => {
          const result: WebSearchResult = await searchWeb(query)
          const sources = result.sources.map((s, i) => ({ index: i + 1, title: s.title, url: s.url, snippet: s.snippet }))
          return JSON.stringify({ text: result.text, sources, _note: '请在回复中标注来源编号并在末尾列出情报来源' })
        }, {
          name: 'search_web',
          description: '搜索互联网获取实时信息。当用户询问：事实性问题、最新新闻、价格查询、版本信息、技术文档、教程、推荐等需要实时数据的问题时，必须使用此工具。返回 JSON：{ text, sources: [{ title, url }] }。使用时必须在回复中标注来源编号。',
          schema: z.object({
            query: z.string().describe('搜索关键词或问题，简洁明确，如"Vue3 最新版本"、"React vs Vue 对比"'),
          }),
        })
      )
    }
  }

  // generate_image
  if (opts.permissions.imageGeneration !== false) {
    tools.push(
      tool(async ({ prompt, ratio }: { prompt: string; ratio?: string }) => {
        const sizeMap: Record<string, string> = {
          '1:1': '2048x2048', '4:3': '2304x1728', '3:4': '1728x2304',
          '16:9': '2560x1440', '9:16': '1440x2560', '3:2': '2496x1664',
          '2:3': '1664x2496', '21:9': '3024x1296',
        }
        const size = sizeMap[ratio || ''] || config.ai.defaultImageRatio
        try {
          const imageUrl = await providerManager.generateImage(prompt, size, opts.initImage)
          if (!imageUrl) return '图片生成失败：API 返回为空'
          return JSON.stringify({ imageUrl, prompt, ratio: ratio || '16:9', mode: opts.initImage ? '图生图' : '文生图' })
        } catch (e: any) {
          return `图片生成失败: ${e.message}`
        }
      }, {
        name: 'generate_image',
        description: '生成图片。当用户要求：画图、生成图片、制作海报、插图、封面、图标、示意图时，必须使用此工具。支持文生图和图生图。',
        schema: z.object({
          prompt: z.string().describe('图片描述（英文效果更好），详细描述画面内容、风格、色调'),
          ratio: z.enum(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9']).optional().describe('宽高比，默认16:9'),
        }),
      })
    )
  }

  // create_pptx
  tools.push(
    tool(async (opts: any) => {
      const filePath = await createPPTX(opts)
      const pptName = opts.fileName || 'presentation.pptx'
      return `PPT 已生成：[📥 下载 ${pptName}](/api/fs/download?file=${encodeURIComponent(pptName)})`
    }, {
      name: 'create_pptx',
      description: `创建 PPT 演示文稿。layout 可选值：cover / section / bullets / two_column / table / quote / ending。theme 可选值：blue / dark / warm / green / minimal。fileName 以 .pptx 结尾。`,
      schema: z.object({
        theme: z.enum(['blue', 'dark', 'warm', 'green', 'minimal']).describe('配色主题'),
        fileName: z.string().describe('文件名，以 .pptx 结尾'),
        slides: z.array(z.object({
          layout: z.enum(['cover', 'section', 'bullets', 'two_column', 'table', 'quote', 'ending']).describe('页面布局'),
          title: z.string().optional(),
          subtitle: z.string().optional(),
          items: z.array(z.string()).optional(),
          leftItems: z.array(z.string()).optional(),
          rightItems: z.array(z.string()).optional(),
          tableData: z.object({ headers: z.array(z.string()), rows: z.array(z.array(z.string())) }).optional(),
          quote: z.string().optional(),
          author: z.string().optional(),
        })).describe('幻灯片数组'),
      }),
    })
  )

  // create_docx
  tools.push(
    tool(async (opts: any) => {
      const filePath = await createDOCX(opts)
      const docName = opts.fileName || 'document.docx'
      return `Word 文档已生成：[📥 下载 ${docName}](/api/fs/download?file=${encodeURIComponent(docName)})`
    }, {
      name: 'create_docx',
      description: `创建 Word 文档。section.type 可选值：heading1 / heading2 / paragraph / bullets / table。fileName 以 .docx 结尾。`,
      schema: z.object({
        fileName: z.string().describe('文件名，以 .docx 结尾'),
        title: z.string().describe('文档标题'),
        author: z.string().optional(),
        sections: z.array(z.object({
          type: z.enum(['heading1', 'heading2', 'paragraph', 'bullets', 'table']).describe('内容类型'),
          text: z.string().optional(),
          items: z.array(z.string()).optional(),
          tableData: z.object({ headers: z.array(z.string()), rows: z.array(z.array(z.string())) }).optional(),
        })).describe('文档内容'),
      }),
    })
  )

  // convert_to_markdown
  tools.push(
    tool(async ({ filePath, fileType }: { filePath: string; fileType: string }) => {
      const text = await documentToMarkdown(filePath, fileType)
      if (!text || text.trim().length === 0) return '文档解析失败或内容为空'
      return `文档已转换为文本（共 ${text.length} 字符）。以下是内容：\n\n${text.slice(0, 8000)}${text.length > 8000 ? '\n\n...（内容过长，已截断前8000字符）' : ''}`
    }, {
      name: 'convert_to_markdown',
      description: '将已上传的文档（PDF/Word/Markdown/文本）解析为可读文本。需要提供文件路径和 MIME 类型。',
      schema: z.object({
        filePath: z.string().describe('文件路径'),
        fileType: z.string().describe('文件 MIME 类型'),
      }),
    })
  )

  // generate_code_pdf
  tools.push(
    tool(async ({ code, language, title, description }: { code: string; language?: string; title?: string; description?: string }) => {
      const link = await codeToPDF({ code, language, title, description })
      return `代码文档已生成：[📥 下载 HTML](${link})（用浏览器打开后可打印为 PDF）`
    }, {
      name: 'generate_code_pdf',
      description: '将代码生成带语法高亮的 HTML 文档，用户可用浏览器打开后打印为 PDF。',
      schema: z.object({
        code: z.string().describe('要转换的代码内容'),
        language: z.string().optional().describe('编程语言'),
        title: z.string().optional(),
        description: z.string().optional(),
      }),
    })
  )

  // generate_resume
  tools.push(
    tool(async (opts: any) => {
      const link = await generateResume(opts)
      return `简历已生成：[📥 下载 HTML](${link})（用浏览器打开后可打印为 PDF）`
    }, {
      name: 'generate_resume',
      description: '生成一份精美的简历 HTML 文档。theme 可选值：gold / blue / dark。',
      schema: z.object({
        name: z.string().describe('姓名'),
        title: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        summary: z.string().optional(),
        skills: z.array(z.string()).optional(),
        theme: z.enum(['blue', 'dark', 'gold']).optional(),
        experience: z.array(z.object({
          company: z.string(),
          role: z.string(),
          period: z.string(),
          bullets: z.array(z.string()),
        })).optional(),
        education: z.array(z.object({
          school: z.string(),
          degree: z.string(),
          period: z.string(),
        })).optional(),
      }),
    })
  )

  // respond — 占位工具，闲聊时直接回复
  tools.push(
    tool(async ({ reply }: { reply: string }) => reply, {
      name: 'respond',
      description: '回复简单对话。当用户只是打招呼、闲聊、道谢等不需要工具操作的场景时，用此工具直接回复。',
      schema: z.object({ reply: z.string().describe('回复内容') }),
    })
  )

  return tools
}

export interface AgentPermissions {
  imageGeneration?: boolean
  webSearch?: boolean
}

export interface AgentConfig {
  userId?: number | null
  model?: string
  permissions?: AgentPermissions
  initImage?: string
}

export async function createChatAgent(cfg: AgentConfig, opts?: { toolHint?: string }) {
  const basePrompt = `你是奈克瑟 NEXUS，称呼用户为"指挥官"。

## 工具使用规则

### 必须调用工具的场景（不要用文字回答，直接调工具）
- 用户提到文件、代码、项目、组件、函数、bug、报错 → 用 fs_read/fs_grep/fs_edit
- 用户问"什么是XX"、"XX最新消息"、"XX价格"等事实性问题 → 用 search_web
- 用户要求生成图片、海报、插图 → 用 generate_image
- 用户要求创建PPT、Word文档 → 用 create_pptx/create_docx
- 用户要求执行命令、运行测试 → 用 exec

### 不要调用工具的场景（直接用文字回答）
- 打招呼、闲聊、道谢、告别
- 解释概念、讨论想法、提供建议
- 不涉及文件/代码/搜索的纯文字问题

## 工具调用流程
1. 分析用户意图，判断是否需要工具
2. 需要工具 → 直接调用，不要在回复中写"让我来查看..."之类的废话
3. 工具返回结果后 → 基于结果给出分析和建议
4. 不需要工具 → 直接用文字回答

## 铁律
- 一次可调多个互不依赖的工具（并行），拿到结果后判断是否还需更多
- fs_edit 返回 ERROR → 重新 fs_read 确认内容再改
- exec 失败 → 分析错误，修复后重试
- 拿到工具结果后，必须基于结果回答用户，不要沉默
- 来源标注：[N]联网

## exec 限制
- 禁止执行 npm run dev、npm start、node server.js 等会持续运行的服务启动命令
- 只能执行瞬时会结束的命令：npm test、npm run build、git status、npx tsc --noEmit、npm run lint 等
- 用户需要自己手动启动服务，你只需要修改代码 + 编译检查

## 禁止
- 禁止在回复中模拟工具调用！不要写 🔧、→、fs_read、fs_grep 等假装调用工具的文本

## 回复
Markdown | 引用路径/行号 | 修改后验证`

  const hint = opts?.toolHint
    ? `[最高优先] 当前请求需要 ${opts.toolHint}，必须调用。\n`
    : ''

  const memoryContext = loadMemory()
  const systemPrompt = hint + basePrompt + (memoryContext ? '\n\n' + memoryContext : '')
  const mcpTools = await getMcpTools()
  const allTools = [
    ...createTools({ permissions: cfg.permissions || {}, initImage: cfg.initImage }),
    ...fsTools,
    ...mcpTools
  ]

  const chatModel = providerManager.createLangChainModel()
  const now = new Date()
  const finalPrompt = `当前时间：${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日\n${systemPrompt}`

  console.log('[Agent] systemPrompt: ' + (opts?.toolHint ? `force_${opts.toolHint}` : 'default'))
  return createAgent({
    model: chatModel,
    tools: allTools as any,
    systemPrompt: finalPrompt,
  })
}

export interface AgentSSEEvent {
  type: 'content' | 'tool_call' | 'tool_result' | 'done' | 'error'
  content?: string
  tool?: string
  args?: Record<string, any>
  result?: string
  imageUrl?: string
  error?: string
}

const CHAT_PATTERNS = /^(你好|hi|hello|谢谢|再见|哈哈|嗯|哦|好的|ok|okay|知道了|明白了|1|2|3|测试|在吗|在不在|帮个忙|帮帮我|你好啊|早上好|晚安|辛苦了|收到|可以|行|好|是的|对|没问题|谢了|感谢)$/

function detectIntent(input: string): string | undefined {
  const t = input.trim()
  if (t.length < 5 || CHAT_PATTERNS.test(t)) return undefined

  if (/(代码|项目|路由|组件|接口|函数|bug|报错|重构|编译|npm|git|vue|react|node|ts\b|js\b|css|安装依赖)/.test(t)
    || /(修改|改成|添加|删除|优化|运行|测试).*(文件|代码|函数|接口|组件|页面)/.test(t))
    return 'fs_read/fs_grep/fs_edit'

  if (/(搜索|搜一下|查一下|查查|新闻|最新|今天|最近|什么是|怎么[做用配]|为什么|如何|多少[钱]?|哪些|哪个|介绍一[下个]|解释一[下个])/.test(t))
    return 'search_web'

  if (/(生成|画).*(图|插图|海报|封面)/.test(t) || /图片生成/.test(t))
    return 'generate_image'

  return undefined
}

export async function* agentStream(
  cfg: AgentConfig,
  messages: { role: 'user' | 'assistant'; content: string }[],
  userInput: string
): AsyncGenerator<AgentSSEEvent> {
  const intent = detectIntent(userInput)
  const agent = await createChatAgent(cfg, { toolHint: intent })
  const langchainMessages = [
    ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: userInput },
  ]

  try {
    console.log(`[Agent] 启动: ${messages.length}条历史, userInput=${userInput.length}字符`)
    const stream = await agent.streamEvents(
      { messages: langchainMessages },
      { version: 'v2', recursionLimit: 200 }
    )
    let contentEmitted = false
    let toolCalled = false
    let streamEventCount = 0

    for await (const event of stream) {
      streamEventCount++
      switch (event.event) {
        case 'on_tool_start':
          toolCalled = true
          console.log(`[Agent] tool_start: ${event.name}`)
          yield { type: 'tool_call', tool: event.name || 'unknown', args: typeof (event.data as any)?.input === 'object' ? (event.data as any).input : { input: (event.data as any)?.input } }
          break
        case 'on_tool_end': {
          const raw = (event.data as any)?.output
          let result = typeof raw === 'string' ? raw
            : raw?.kwargs?.content ? String(raw.kwargs.content)
            : raw?.content && typeof raw.content === 'string' ? raw.content
            : String(raw || '')
          console.log(`[Agent] tool_end: ${event.name} (${result.length}字符)`)
          yield { type: 'tool_result', tool: event.name || 'unknown', result }
          break
        }
        case 'on_chat_model_stream': {
          const content = (event.data as any)?.chunk?.content
          if (content && typeof content === 'string') {
            contentEmitted = true
            yield { type: 'content', content }
          }
          break
        }
        case 'on_chat_model_end': {
          if (!contentEmitted && toolCalled) {
            const output = (event.data as any)?.output
            const msgContent = output?.content || output?.kwargs?.content
            if (msgContent && typeof msgContent === 'string' && msgContent.trim()) {
              contentEmitted = true
              yield { type: 'content', content: msgContent }
            }
          }
          break
        }
      }
    }

    console.log(`[Agent] 流结束: ${streamEventCount} events, toolCalled=${toolCalled}, contentEmitted=${contentEmitted}`)

    if (toolCalled && !contentEmitted) {
      console.log('[Agent] 兜底: 工具调用后无内容输出')
      yield { type: 'content', content: '(工具已执行完毕)' }
    }

    yield { type: 'done' }
  } catch (error: any) {
    console.log(`[Agent] 异常: ${error.message}`)
    yield { type: 'error', error: error.message || 'Agent 执行失败' }
  }
}
