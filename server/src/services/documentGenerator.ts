import pptxgen from 'pptxgenjs'
import * as docx from 'docx'
import * as fs from 'node:fs'
import * as path from 'node:path'
import config from '../config/index.js'

const PptxGenJS = (pptxgen as any).default || pptxgen

const workspaceRoot = path.resolve(config.workspace.root)
if (!fs.existsSync(workspaceRoot)) fs.mkdirSync(workspaceRoot, { recursive: true })

// ===== 配色主题 =====
const themes: Record<string, { bg: string; fg: string; accent: string; accent2: string; text: string; muted: string }> = {
  blue:    { bg: '1B2A4A', fg: 'FFFFFF', accent: '3B82F6', accent2: '60A5FA', text: '1E293B', muted: '94A3B8' },
  dark:    { bg: '0F172A', fg: 'F8FAFC', accent: '8B5CF6', accent2: 'A78BFA', text: 'F1F5F9', muted: '64748B' },
  warm:    { bg: '7C2D12', fg: 'FFFBEB', accent: 'F97316', accent2: 'FB923C', text: '292524', muted: 'A8A29E' },
  green:   { bg: '064E3B', fg: 'ECFDF5', accent: '10B981', accent2: '34D399', text: '111827', muted: '6B7280' },
  minimal: { bg: 'FFFFFF', fg: '111827', accent: '374151', accent2: '9CA3AF', text: '1F2937', muted: '9CA3AF' },
}

// ===== PPT 生成 =====
interface PptSlide {
  layout: 'cover' | 'bullets' | 'two_column' | 'table' | 'quote' | 'section' | 'ending'
  title?: string
  subtitle?: string
  items?: string[]
  leftItems?: string[]
  rightItems?: string[]
  tableData?: { headers: string[]; rows: string[][] }
  quote?: string
  author?: string
}

export async function createPPTX(opts: { theme: string; fileName: string; slides: PptSlide[] }): Promise<string> {
  const t = themes[opts.theme] || themes.blue
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'

  for (const slide of opts.slides) {
    switch (slide.layout) {
      case 'cover': {
        const s = pptx.addSlide()
        s.background = { color: t.bg }
        s.addText(slide.title || '', { x: 1, y: 1.8, w: 8, h: 1.2, fontSize: 40, bold: true, color: t.fg, align: 'center' })
        if (slide.subtitle) s.addText(slide.subtitle, { x: 1, y: 3.2, w: 8, h: 0.8, fontSize: 18, color: t.accent2, align: 'center' })
        s.addText(new Date().toLocaleDateString('zh-CN'), { x: 1, y: 4.5, w: 8, h: 0.4, fontSize: 12, color: t.muted, align: 'center' })
        break
      }
      case 'section': {
        const s = pptx.addSlide()
        s.background = { color: t.accent }
        s.addText(slide.title || '', { x: 0.8, y: 2.2, w: 8.4, h: 1.2, fontSize: 36, bold: true, color: 'FFFFFF', align: 'left' })
        if (slide.subtitle) s.addText(slide.subtitle, { x: 0.8, y: 3.4, w: 8.4, h: 0.6, fontSize: 16, color: 'FFFFFF', align: 'left', italic: true })
        break
      }
      case 'bullets': {
        const s = pptx.addSlide()
        s.background = { color: 'FFFFFF' }
        s.addText(slide.title || '', { x: 0.8, y: 0.4, w: 8.4, h: 0.8, fontSize: 26, bold: true, color: t.bg })
        s.addShape(pptx.ShapeType.rect, { x: 0.8, y: 1.1, w: 1.5, h: 0.06, fill: { color: t.accent } })
        const items = slide.items || []
        s.addText(items.map((it, i) => ({ text: `${it}\n`, options: { fontSize: 16, color: t.text, bullet: true, breakType: i > 0 ? 'none' : undefined } })), { x: 1.2, y: 1.5, w: 7.6, h: 3.5, valign: 'top' } as any)
        break
      }
      case 'two_column': {
        const s = pptx.addSlide()
        s.background = { color: 'FFFFFF' }
        s.addText(slide.title || '', { x: 0.8, y: 0.4, w: 8.4, h: 0.8, fontSize: 26, bold: true, color: t.bg })
        s.addShape(pptx.ShapeType.rect, { x: 0.8, y: 1.1, w: 1.5, h: 0.06, fill: { color: t.accent } })
        const left = slide.leftItems || []
        const right = slide.rightItems || []
        s.addText(left.map(it => ({ text: `${it}\n`, options: { fontSize: 14, color: t.text, bullet: true } })), { x: 0.8, y: 1.5, w: 4, h: 3.8, valign: 'top' } as any)
        s.addShape(pptx.ShapeType.rect, { x: 5, y: 1.5, w: 0.02, h: 3.5, fill: { color: t.muted } })
        s.addText(right.map(it => ({ text: `${it}\n`, options: { fontSize: 14, color: t.text, bullet: true } })), { x: 5.3, y: 1.5, w: 4, h: 3.8, valign: 'top' } as any)
        break
      }
      case 'table': {
        const s = pptx.addSlide()
        s.background = { color: 'FFFFFF' }
        s.addText(slide.title || '', { x: 0.8, y: 0.4, w: 8.4, h: 0.8, fontSize: 26, bold: true, color: t.bg })
        const data = slide.tableData
        if (data) {
          const rows: any[] = [
            data.headers.map((h: string) => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: t.accent }, fontSize: 13, align: 'center' } })),
            ...data.rows.map((row: string[]) => row.map((cell: string) => ({ text: cell, options: { fontSize: 12, color: t.text, align: 'center' } }))),
          ]
          s.addTable(rows, { x: 0.8, y: 1.5, w: 8.4, border: { type: 'solid', color: t.muted }, colW: data.headers.map(() => 8.4 / data.headers.length) })
        }
        break
      }
      case 'quote': {
        const s = pptx.addSlide()
        s.background = { color: t.bg }
        s.addText(`"${slide.quote || ''}"`, { x: 1, y: 1.8, w: 8, h: 1.8, fontSize: 24, italic: true, color: t.accent2, align: 'center' })
        if (slide.author) s.addText(`— ${slide.author}`, { x: 1, y: 3.8, w: 8, h: 0.6, fontSize: 14, color: t.muted, align: 'center' })
        break
      }
      case 'ending': {
        const s = pptx.addSlide()
        s.background = { color: t.bg }
        s.addText(slide.title || '谢谢', { x: 1, y: 2.2, w: 8, h: 1, fontSize: 40, bold: true, color: t.fg, align: 'center' })
        if (slide.subtitle) s.addText(slide.subtitle, { x: 1, y: 3.3, w: 8, h: 0.6, fontSize: 16, color: t.accent2, align: 'center' })
        break
      }
    }
  }

  const outPath = path.join(workspaceRoot, opts.fileName)
  await pptx.writeFile({ fileName: outPath })
  return outPath
}

// ===== Word 生成 =====
interface DocSection {
  type: 'heading1' | 'heading2' | 'paragraph' | 'bullets' | 'table'
  text?: string
  items?: string[]
  tableData?: { headers: string[]; rows: string[][] }
}

export async function createDOCX(opts: { fileName: string; title: string; author?: string; sections: DocSection[] }): Promise<string> {
  const children: docx.Paragraph[] = []

  // 标题
  children.push(new docx.Paragraph({
    children: [new docx.TextRun({ text: opts.title, bold: true, size: 52, color: '1B2A4A' })],
    spacing: { after: 400 },
  }))
  if (opts.author) {
    children.push(new docx.Paragraph({
      children: [new docx.TextRun({ text: `作者：${opts.author}    ${new Date().toLocaleDateString('zh-CN')}`, size: 22, color: '94A3B8' })],
      spacing: { after: 300 },
    }))
  }
  // 分隔线
  children.push(new docx.Paragraph({
    children: [],
    border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: '3B82F6' } },
    spacing: { after: 300 },
  }))

  for (const sec of opts.sections) {
    switch (sec.type) {
      case 'heading1':
        children.push(new docx.Paragraph({
          children: [new docx.TextRun({ text: sec.text || '', bold: true, size: 36, color: '1B2A4A' })],
          spacing: { before: 360, after: 120 },
          border: { bottom: { style: docx.BorderStyle.SINGLE, size: 2, color: 'E2E8F0' } },
        }))
        break
      case 'heading2':
        children.push(new docx.Paragraph({
          children: [new docx.TextRun({ text: sec.text || '', bold: true, size: 28, color: '3B82F6' })],
          spacing: { before: 240, after: 80 },
        }))
        break
      case 'paragraph':
        children.push(new docx.Paragraph({
          children: [new docx.TextRun({ text: sec.text || '', size: 22, color: '1E293B' })],
          spacing: { after: 120 },
        }))
        break
      case 'bullets':
        for (const item of sec.items || []) {
          children.push(new docx.Paragraph({
            children: [new docx.TextRun({ text: item, size: 22, color: '1E293B' })],
            bullet: { level: 0 },
            spacing: { after: 60 },
          }))
        }
        break
      case 'table': {
        const td = sec.tableData
        if (td) {
          const rows = [
            new docx.TableRow({ children: td.headers.map(h => new docx.TableCell({
              children: [new docx.Paragraph({ children: [new docx.TextRun({ text: h, bold: true, size: 20, color: 'FFFFFF' })], alignment: docx.AlignmentType.CENTER })],
              shading: { fill: '3B82F6' }, width: { size: Math.floor(9000 / td.headers.length), type: docx.WidthType.DXA },
            })) }),
            ...td.rows.map(row => new docx.TableRow({ children: row.map(cell => new docx.TableCell({
              children: [new docx.Paragraph({ children: [new docx.TextRun({ text: cell, size: 20, color: '1E293B' })], alignment: docx.AlignmentType.CENTER })],
              width: { size: Math.floor(9000 / row.length), type: docx.WidthType.DXA },
            })) })),
          ]
          const table = new docx.Table({ rows, width: { size: 100, type: docx.WidthType.PERCENTAGE } })
          children.push(new docx.Paragraph({ children: [table as any], spacing: { before: 120, after: 200 } }))
        }
        break
      }
    }
  }

  const doc = new docx.Document({
    styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }],
  })

  const outPath = path.join(workspaceRoot, opts.fileName)
  const buffer = await docx.Packer.toBuffer(doc)
  fs.writeFileSync(outPath, buffer)
  return outPath
}
