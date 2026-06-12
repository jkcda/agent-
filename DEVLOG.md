# NEXUS Desktop v1 开发总结

## 项目概述

从 NEXUS Web 端（`aiconnent/`）拆分桌面端为独立项目（`nexus-desktop/`），实现零外部依赖一键启动。

---

## 架构设计

### 原 Web 端架构
```
aiconnent/
├── server/          ← Node.js + Express + MySQL + Redis + LanceDB
├── client/          ← Web 前端（Vue3）
├── client-desktop/  ← 桌面端前端（Vue3 + Electron）
└── client-miniapp/  ← 小程序
```
前后端共用，桌面端依赖 MySQL/Redis/LanceDB，无法单机运行。

### 新桌面端架构
```
nexus-desktop/
├── server/     ← 精简后端（Express + JSON 存储，无外部依赖）
├── client/     ← 桌面端前端（Vue3 + Electron）
├── workspace/  ← 默认工作区
└── start.bat   ← 一键启动脚本
```

### 砍掉的功能
| 组件 | 原因 |
|------|------|
| MySQL | 桌面端单用户，JSON 文件足够 |
| Redis | 单用户无并发需求 |
| LanceDB/RAG | 向量检索信息失真，工具调文件系统更准 |
| 长期记忆 | Claude Code 风格，不跨会话 |
| 知识库 | 桌面端直接用文件系统 |
| 聊天室/Socket.IO | 单机用不到 |
| 用户系统/微信登录 | 桌面端不需要 |
| 角色扮演 | 简化 Agent |
| 视频处理 | ffmpeg-static 太重 |

### 保留的核心功能
- LLM 多模型切换（OpenAI/Anthropic 格式）
- Agent 工具调用（文件系统 + 搜索 + 生图 + 文档生成）
- 多模态图片理解
- MCP 工具（Playwright）
- 上下文压缩 + 持久记忆
- 文档生成（PPT/Word/PDF）

---

## 存储方案

```
server/data/
├── settings.json              ← LLM/Embedding/Rerank/Image/Search 配置
├── history/{sessionId}.jsonl  ← 每个会话一个文件，一行一条消息
├── compaction/{sessionId}.md  ← 会话摘要（token 超限自动生成）
└── memory/*.md                ← 持久记忆（跨会话用户偏好等）
```

- `store/settings.ts` — JSON 键值对存储
- `store/chatHistory.ts` — JSONL 追加写入，按行读取
- `services/compaction.ts` — Myers diff 摘要压缩
- `services/memory.ts` — LLM 自动提取持久记忆

---

## 开发过程中遇到的问题及修复

### 1. 工具调用结果太大撑爆 API（583KB → 15KB）

**现象**：AI 调用 `fs_list` 递归遍历目录，返回 583KB JSON，超出 API 258K token 上限

**原因**：`fs_list` 工具 `recursive: true` 时递归遍历整个目录树

**修复**：
- 从 Agent 工具列表中移除 `fs_list`
- Agent 用 `fs_index`（项目概览，143 字符）+ `fs_read`（读单个文件）替代
- `fs_read` 文件限制 20K 字符，`fs_grep` 限制 50 条结果

### 2. LLM 伪造工具调用

**现象**：LLM 在回复中写 `🔧 fs_read`、`→ src/App.vue` 等文字，实际没调工具

**原因**：
- 历史消息中的 `[本轮工具调用]` 日志被注入上下文，LLM 看到后模仿
- System prompt 不够明确

**修复**：
- 后端保存消息时不再拼入工具调用日志
- 加载历史时 `stripToolLog()` 过滤旧日志
- System prompt 增加"禁止模拟工具调用"规则
- 工具描述增加"必须使用此工具"触发词

### 3. 会话历史丢失

**现象**：Electron 重启后之前的对话找不到

**原因**：`localStorage` 在 Electron 重启后丢失，前端用 `Date.now()` 生成新 sessionId

**修复**：
- 启动时从服务器加载全量会话列表
- localStorage 有记录 → 恢复该会话
- 没有 → 自动选最近的会话
- 一个都没有 → 才新建

### 4. 上下文窗口硬编码

**现象**：Token 预算 90K/115K 写死，换模型后不对

**修复**：
- `CapabilityLLMConfig` 新增 `contextWindow` 字段（默认 128K）
- 历史压缩阈值 = `contextWindow - 5000`
- 设置页面可配置

### 5. exec 命令 120 秒超时

**现象**：LLM 修改代码后爱 `npm run dev`，阻塞 120 秒

**修复**：
- 超时 120s → 15s
- 超时后不报错，返回"命令在 15 秒内未结束（可能是服务已启动）"
- System prompt 增加"只能执行瞬时会结束的命令"

### 6. 长时间任务突然中断

**现象**：Agent 读多个文件后对话截断

**修复**：
- `recursionLimit`: 50 → 200
- `maxTokens`: 16384 → 32768

### 7. Diff 对比功能重写

**现象**：原 `buildDiff` 按位置对比，插入一行后所有行都标为修改

**修复**：
- 后端用 `diff` 包实现 Myers diff 算法
- 输出格式 `行号| 内容`（`+` 绿色新增，`-` 红色删除，` ` 灰色上下文）
- 前端 diff 直接渲染在对话中（可折叠 `<details>`），不走预览面板
- 使用 `:deep()` 穿透 Vue scoped 样式隔离

### 8. 打包 winCodeSign 错误

**现象**：`electron-builder` 打包时 winCodeSign 7z 解压 macOS 符号链接失败

**原因**：winCodeSign 包含 macOS `.dylib` 符号链接，Windows 7z 无法创建

**修复**：换用 `electron-packager`，无需 winCodeSign
```bash
npx electron-packager . "NEXUS Desktop" --platform=win32 --arch=x64 \
  --out=release-v2 --overwrite --prune \
  --extra-resource="../server/dist" \
  --extra-resource="../server/package.json" \
  --extra-resource="../server/node_modules"
```

### 9. 打包后前端 API 请求 404

**现象**：打包后访问 `/api/ai/models` 变成 `file:///E:/api/ai/models`

**原因**：前端用相对路径 `/api/...`，打包后是 `file://` 协议

**修复**：`apis/index.ts` 导出 `API_HOST`，打包时自动切换绝对路径
```ts
export const API_HOST = window.location.protocol === 'file:'
  ? 'http://127.0.0.1:3001' : ''
```
所有 fetch 调用改为 `fetch(API_HOST + '/api/...')`

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Vue 3 + Element Plus |
| 桌面壳 | Electron + vite-plugin-electron |
| 后端 | Express + TypeScript |
| AI 框架 | LangChain (createAgent + streamEvents) |
| 存储 | JSON + JSONL + MD 文件 |
| 图标 | @iconify/vue (vscode-icons + mdi) |
| Diff | diff (Myers algorithm) |
| 打包 | electron-packager |

---

## 最终产物

```
release-v2/NEXUS Desktop-win32-x64/
├── NEXUS Desktop.exe          ← 双击启动
├── resources/
│   ├── app/                   ← 前端
│   ├── dist/                  ← 后端编译代码
│   ├── node_modules/          ← 后端依赖
│   └── package.json           ← 后端配置
```

**大小**：~1.4GB（Electron 400M + 后端依赖 231M + 前端依赖 100M）

---

## 启动方式

**开发模式**：
```bash
cd nexus-desktop/client && npm run electron:dev
```

**打包版**：
```
双击 release-v2/NEXUS Desktop-win32-x64/NEXUS Desktop.exe
```

---

## 已知限制

1. electron-builder 无法使用（winCodeSign bug），暂用 electron-packager
2. Windows 7z 解压 macOS 符号链接需要管理员权限
3. 打包版 ~1.4GB，未做进一步裁剪
4. MCP Playwright 需要系统安装 Chromium
5. 搜索和生图需要额外 API Key（Tavily、火山引擎 ARK）
