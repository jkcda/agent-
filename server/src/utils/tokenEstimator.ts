/**
 * 启发式 Token 估算
 *
 * 中文 ≈ 1.5 tokens/字，英文 ≈ 0.25 tokens/字符，代码/数字 ≈ 0.3 tokens/字符
 * 精度 ±20%，对预算控制足够
 */
export function estimateTokens(text: string): number {
  let tokens = 0
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code >= 0x4E00 && code <= 0x9FFF) {
      // CJK 统一表意文字
      tokens += 1.5
    } else if (code >= 0x3040 && code <= 0x30FF) {
      // 日文假名
      tokens += 1.5
    } else if (code >= 0xAC00 && code <= 0xD7AF) {
      // 韩文
      tokens += 1.5
    } else if (code >= 0x30A0 && code <= 0x30FF) {
      // 韩文（另一段）
      tokens += 1.5
    } else {
      // 英文、数字、符号、空格等
      tokens += 0.25
    }
  }
  return Math.ceil(tokens)
}

/**
 * 批量估算
 */
export function estimateMessagesTokens(
  messages: { role: string; content: string }[],
  systemPrompt?: string
): number {
  let total = 0
  if (systemPrompt) {
    total += estimateTokens(systemPrompt)
  }
  for (const msg of messages) {
    total += estimateTokens(msg.content)
  }
  return total
}
