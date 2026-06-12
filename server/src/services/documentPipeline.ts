import { Document } from '@langchain/core/documents'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import config from '../config/index.js'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse')

// 解析文档为纯文本（从 ai.ts 提取）
export async function parseDocument(filePath: string, mimeType: string): Promise<string> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath)

  switch (mimeType) {
    case 'text/plain':
    case 'text/markdown':
    case 'application/json':
      return fs.readFileSync(absolutePath, 'utf-8')

    case 'application/pdf':
      try {
        const dataBuffer = fs.readFileSync(absolutePath)
        const data = await pdfParse(dataBuffer)
        return data.text
      } catch {
        return '[PDF 解析失败]'
      }

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      try {
        const mammoth = (await import('mammoth')).default
        const result = await mammoth.extractRawText({ path: absolutePath })
        return result.value
      } catch (e: any) {
        console.error(`[DOCX] 解析失败: ${absolutePath} — ${e.message || e}`)
        return '[DOCX 解析失败]'
      }

    case 'application/msword':
      return '[DOC 为旧版二进制格式，无法直接解析。请将文件另存为 DOCX 格式后重新上传]'

    default:
      return '[不支持预览的文档类型]'
  }
}

// HTML 富预览（DOCX → mammoth HTML，XLSX → HTML 表格，PPTX → 格式化 HTML）
export async function parseDocumentPreview(filePath: string, mimeType: string): Promise<{ content: string; format: 'html' | 'text' }> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath)

  switch (mimeType) {
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      try {
        const mammoth = (await import('mammoth')).default
        const result = await mammoth.convertToHtml({ path: absolutePath })
        return { content: result.value || '<p>（文档无内容）</p>', format: 'html' }
      } catch (e: any) {
        console.error('[DOCX] HTML 预览失败:', absolutePath, e.message || e)
        const text = await parseDocument(filePath, mimeType)
        return { content: text, format: 'text' }
      }

    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      try {
        const XLSX = (await import('xlsx')).default
        const workbook = XLSX.readFile(absolutePath)
        const parts: string[] = []
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName]
          const html = XLSX.utils.sheet_to_html(sheet)
          if (html.trim()) {
            parts.push(`<h3 style="margin:12px 0 6px;font-size:14px;color:#333">${sheetName}</h3>${html}`)
          }
        }
        return { content: parts.join('\n') || '<p>（表格无内容）</p>', format: 'html' }
      } catch (e: any) {
        console.error('[XLSX] HTML 预览失败:', absolutePath, e.message || e)
        const text = await parseDocument(filePath, mimeType)
        return { content: text, format: 'text' }
      }

    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      try {
        const JSZip = (await import('jszip')).default
        const pptxBuf = fs.readFileSync(absolutePath)
        const zip = await JSZip.loadAsync(pptxBuf)
        const slideFiles = Object.keys(zip.files)
          .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
          .sort()
        const parts: string[] = []
        for (let i = 0; i < slideFiles.length; i++) {
          const xml = await zip.files[slideFiles[i]].async('string')
          const texts = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g)
            ?.map(t => t.replace(/<\/?a:t[^>]*>/g, ''))
            .filter(t => t.trim())
            .join(' ') || ''
          if (texts.trim()) {
            parts.push(`<h3 style="margin:12px 0 6px;font-size:14px;color:#333">幻灯片 ${i + 1}</h3><p style="margin:0 0 12px;line-height:1.7;color:#555">${texts}</p>`)
          }
        }
        return { content: parts.join('\n') || '<p>（演示文稿无文本内容）</p>', format: 'html' }
      } catch (e: any) {
        console.error('[PPTX] HTML 预览失败:', absolutePath, e.message || e)
        const text = await parseDocument(filePath, mimeType)
        return { content: text, format: 'text' }
      }

    default:
      const text = await parseDocument(filePath, mimeType)
      return { content: text, format: 'text' }
  }
}

// 获取文本分割器
function getSplitter(): RecursiveCharacterTextSplitter {
  return new RecursiveCharacterTextSplitter({
    chunkSize: 300,
    chunkOverlap: 100,
    separators: ['\n\n', '\n', '。', '.', ' ', '']
  })
}

// 完整管道：解析 → 分块 → 返回 Document 数组（嵌入和存储由调用方处理）
export async function chunkDocument(
  filePath: string,
  mimeType: string,
  metadata: { docId: number; kbId: number; filename: string }
): Promise<{ docs: Document[]; fullText: string }> {
  const fullText = await parseDocument(filePath, mimeType)
  const splitter = getSplitter()

  const docs = await splitter.createDocuments(
    [fullText],
    [{ ...metadata, source: metadata.filename }]
  )

  // 为每个分块添加 chunk_index
  // 统一为蛇形命名，剔除多余字段，匹配 LanceDB 表 schema
  docs.forEach((doc, i) => {
    doc.metadata.doc_id = doc.metadata.docId
    doc.metadata.kb_id = doc.metadata.kbId
    delete doc.metadata.docId
    delete doc.metadata.kbId
    delete doc.metadata.source
    delete (doc.metadata as any).loc
    doc.metadata.chunk_index = i
  })

  return { docs, fullText }
}

// 轻量版本：处理聊天中的附件文件（不关联知识库，直接返回分块）
export async function chunkFileForChat(
  filePath: string,
  mimeType: string,
  filename: string
): Promise<Document[]> {
  const fullText = await parseDocument(filePath, mimeType)
  const splitter = getSplitter()

  const docs = await splitter.createDocuments(
    [fullText],
    [{ source: filename }]
  )

  return docs
}
