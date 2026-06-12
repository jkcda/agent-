import { MultiServerMCPClient } from '@langchain/mcp-adapters'

let mcpClient: MultiServerMCPClient | null = null
const disabledServers = new Set<string>()

interface McpServerConfig {
  name: string
  label: string
  icon: string
  transport: 'stdio'
  command: string
  args: string[]
}

const serverConfigs: McpServerConfig[] = [
  {
    name: 'playwright',
    label: 'Playwright 浏览器',
    icon: '🎭',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp'],
  },
]

export async function initMCP() {
  if (mcpClient) return mcpClient

  mcpClient = new MultiServerMCPClient({
    throwOnLoadError: false,
    prefixToolNameWithServerName: true,

    mcpServers: Object.fromEntries(
      serverConfigs
        .filter(s => !disabledServers.has(s.name))
        .map(s => [s.name, { transport: s.transport, command: s.command, args: s.args }])
    ),
  })

  if (Object.keys(mcpClient as any).length) {
    await mcpClient.initializeConnections()
    console.log('[MCP] Servers connected')
  }
  return mcpClient
}

export async function getMcpTools() {
  if (!mcpClient) return [] // MCP 尚未初始化完成，返回空工具列表等待连接
  try {
    return await mcpClient.getTools()
  } catch {
    return [] // 连接异常时降级，不影响核心对话
  }
}

/** 获取 MCP 状态：每个 server 的名称、标签、图标、是否启用、工具数 */
export async function getMcpStatus() {
  const status: {
    name: string; label: string; icon: string; enabled: boolean; toolCount: number
  }[] = []

  const toolMap = mcpClient
    ? await mcpClient.getTools().then(tools => {
        const map = new Map<string, number>()
        for (const t of tools) {
          const name = (t as any).name || ''
          const server = name.split('__')[0] || 'unknown'
          map.set(server, (map.get(server) || 0) + 1)
        }
        return map
      })
    : new Map<string, number>()

  for (const cfg of serverConfigs) {
    status.push({
      name: cfg.name,
      label: cfg.label,
      icon: cfg.icon,
      enabled: !disabledServers.has(cfg.name),
      toolCount: toolMap.get(cfg.name) || 0,
    })
  }

  return status
}

/** 启用/禁用 MCP Server（需重启服务生效） */
export function toggleMcpServer(name: string, enabled: boolean) {
  if (enabled) {
    disabledServers.delete(name)
  } else {
    disabledServers.add(name)
  }
  return { name, enabled, note: 'Server 状态变更将在下次服务重启后生效' }
}

export async function closeMCP() {
  if (mcpClient) {
    await mcpClient.close()
    mcpClient = null
  }
}
