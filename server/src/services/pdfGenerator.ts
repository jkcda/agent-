// 文档生成：代码转HTML（可打印为PDF）、Markdown 文档、简历
import fs from 'fs'
import path from 'path'
import hljs from 'highlight.js'
import config from '../config/index.js'
import { parseDocument } from './documentPipeline.js'

const workspaceRoot = path.resolve(config.workspace.root)

function ensureDir() {
  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true })
  }
}

/** HTML 基础样式（打印友好，深色科技风） */
function baseStyle(): string {
  return `
  body {
    font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
    line-height: 1.8;
    max-width: 900px;
    margin: 40px auto;
    padding: 0 20px;
    color: #f5f5ff;
    background: #0d1b2a;
  }
  h1 { color: #D4AF37; border-bottom: 2px solid #D4AF37; padding-bottom: 8px; }
  h2 { color: #4A90E2; margin-top: 32px; }
  h3 { color: #a0b4cc; }
  pre { background: #1a1a2e; border-radius: 6px; padding: 16px; overflow-x: auto; border: 1px solid #2a2a4a; }
  code { font-family: 'Consolas', 'Courier New', monospace; font-size: 13px; }
  p code { background: #1a1a2e; padding: 2px 6px; border-radius: 3px; }
  blockquote { border-left: 3px solid #D4AF37; margin: 16px 0; padding: 8px 16px; background: rgba(212,175,55,0.05); }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #2a2a4a; padding: 8px 12px; text-align: left; }
  th { background: #1b3a5c; color: #D4AF37; }
  .section { margin-bottom: 32px; }
  .meta { color: #6b7d95; font-size: 13px; margin-bottom: 16px; }
  .tag { display: inline-block; background: rgba(74,144,226,0.2); color: #4A90E2; border-radius: 3px; padding: 2px 8px; margin: 2px; font-size: 12px; }
  @media print { body { background: #fff; color: #000; } h1 { color: #333; border-color: #333; } h2 { color: #444; } }
`
}

/**
 * 代码转 HTML（带语法高亮），可浏览器打开后打印为 PDF
 */
export async function codeToPDF(opts: {
  code: string
  language?: string
  title?: string
  description?: string
}): Promise<string> {
  ensureDir()
  const lang = opts.language || 'plaintext'
  let highlighted: string
  try {
    highlighted = hljs.highlight(opts.code, { language: lang }).value
  } catch {
    highlighted = hljs.highlightAuto(opts.code).value
  }

  const title = opts.title || '代码文档'
  const desc = opts.description || ''
  const safeName = title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 40)
  const fileName = `${safeName}_${Date.now()}.html`
  const filePath = path.join(workspaceRoot, fileName)

  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>${safeName}</title>
<style>${baseStyle()}</style>
</head>
<body>
<h1>${safeName}</h1>
${desc ? `<p class="meta">${desc}</p>` : ''}
<p class="meta">语言: ${lang} | 生成时间: ${new Date().toLocaleString('zh-CN')}</p>
<pre><code class="hljs language-${lang}">${highlighted}</code></pre>
</body>
</html>`

  fs.writeFileSync(filePath, html, 'utf-8')
  return `/api/fs/download?file=${encodeURIComponent(fileName)}`
}

/**
 * 将已上传文档转换为 Markdown 文本
 */
export async function documentToMarkdown(filePath: string, fileType: string): Promise<string> {
  const text = await parseDocument(filePath, fileType)
  // 返回原始文本，AI 可自行格式化为 Markdown
  return text
}

/**
 * 生成简历 HTML（可打印为 PDF）
 */
export async function generateResume(opts: {
  name: string
  title?: string
  email?: string
  phone?: string
  summary?: string
  skills?: string[]
  experience?: Array<{ company: string; role: string; period: string; bullets: string[] }>
  education?: Array<{ school: string; degree: string; period: string }>
  theme?: 'blue' | 'dark' | 'gold'
}): Promise<string> {
  ensureDir()
  const theme = opts.theme || 'gold'
  const accentColor = theme === 'blue' ? '#4A90E2' : theme === 'gold' ? '#D4AF37' : '#a0b4cc'

  const skillTags = (opts.skills || []).map(s => `<span class="tag">${s}</span>`).join('')

  const expHtml = (opts.experience || []).map(e => `
    <div class="section">
      <h2>${e.role} <span style="font-weight:normal;color:#6b7d95;font-size:14px">@ ${e.company}</span></h2>
      <p class="meta">${e.period}</p>
      <ul>${(e.bullets || []).map(b => `<li>${b}</li>`).join('')}</ul>
    </div>`).join('')

  const eduHtml = (opts.education || []).map(e => `
    <div class="section">
      <h2>${e.degree}</h2>
      <p class="meta">${e.school} | ${e.period}</p>
    </div>`).join('')

  const safeName = opts.name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 20)
  const fileName = `简历_${safeName}_${Date.now()}.html`
  const filePath = path.join(workspaceRoot, fileName)

  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>${opts.name} - 简历</title>
<style>
  ${baseStyle()}
  h1 { color: ${accentColor}; border-color: ${accentColor}; }
  .header { text-align: center; margin-bottom: 40px; }
  .contact { color: #6b7d95; font-size: 14px; }
  ul { padding-left: 20px; }
  ul li { margin-bottom: 6px; }
</style>
</head>
<body>
<div class="header">
  <h1>${opts.name}</h1>
  ${opts.title ? `<p style="color:${accentColor};font-size:16px">${opts.title}</p>` : ''}
  <p class="contact">${[opts.email, opts.phone].filter(Boolean).join(' | ')}</p>
</div>
${opts.summary ? `<div class="section"><h2>个人概要</h2><p>${opts.summary}</p></div>` : ''}
${skillTags ? `<div class="section"><h2>技能</h2><div>${skillTags}</div></div>` : ''}
${expHtml || ''}
${eduHtml || ''}
</body>
</html>`

  fs.writeFileSync(filePath, html, 'utf-8')
  return `/api/fs/download?file=${encodeURIComponent(fileName)}`
}
