# AI 精细化学习规划

基于 Next.js + Electron 的 AI 学习规划工具，支持 Web 和桌面端。自动生成阶段化学习计划、苏格拉底式 AI 教学、多题型检测、间隔复习与模拟面试，数据全部存储在本地 SQLite。

## 界面预览

| 首页 | 首次配置 |
|:---:|:---:|
| ![首页](docs/screenshots/01-home.png) | ![首次配置](docs/screenshots/02-onboarding.png) |

| AI 教学对话 | 阶段检测 |
|:---:|:---:|
| ![AI 教学对话](docs/screenshots/03-teach-chat.png) | ![阶段检测](docs/screenshots/04-assessment.png) |

| 教学背景主题 | 导师头像 |
|:---:|:---:|
| ![教学背景主题](docs/screenshots/05-teach-theme.png) | ![导师头像](docs/screenshots/06-tutor-avatar.png) |

## 功能概览

- **多种建计划方式**：按学习目标 / 上传书籍 / 导入本地代码仓库生成阶段计划
- **AI 对话教学**：苏格拉底式引导；导师与学员头像可更换；重点词彩色下划线高亮（设置中可开关）
- **教学界面美化**：可切换背景主题（极光 / 暮色 / 墨海 / 薄荷）或上传自定义背景图
- **阶段检测与沉淀**：答题评估、历史记录回看
- **模拟面试**：计划级 / 阶段级面试官（友善 / 标准 / 压力）风格
- **资料推荐、实战项目、知识图谱、复习与导出**

## 技术栈

- **前端**: Next.js 16 + React 19 + TypeScript + Tailwind CSS 4
- **UI 组件**: shadcn/ui + Recharts + React Flow
- **AI**: Vercel AI SDK（支持 OpenAI / Anthropic / DeepSeek / Kimi）
- **数据库**: SQLite（better-sqlite3，本地存储）
- **桌面端**: Electron 43 + electron-builder

## 环境要求

- **Node.js** >= 18（推荐 20+）
- **pnpm**（推荐）或 npm
- C/C++ 编译工具链（`better-sqlite3` 需要编译原生模块）
  - macOS: `xcode-select --install`
  - Windows: `npm install -g windows-build-tools`
  - Linux: `sudo apt install build-essential python3`

## 本地安装与运行

### 1. 克隆项目

```bash
git clone git@github.com:QIYUEKURONG/ai-learning-planner.git
cd ai-learning-planner
```

### 2. 安装依赖

```bash
pnpm install
# 或
npm install
```

### 3. 启动开发服务

**Web 模式**（浏览器访问 http://localhost:3000）：

```bash
pnpm dev
```

**Electron 桌面模式**（自动启动桌面窗口，端口 3456）：

```bash
pnpm electron:dev
```

### 4. 配置 AI

启动后在**设置页面**配置以下信息：

| 配置项 | 说明 |
|--------|------|
| LLM 提供商 | `openai` / `anthropic` / `deepseek` / `kimi` |
| API Key | 对应提供商的 API 密钥 |
| Base URL | 自定义 API 地址（可选） |
| 模型 | 指定模型名称（可选） |
| Tavily API Key | 增强资源搜索（可选） |
| 重点词下划线高亮 | 教学对话中重点词强调效果（默认开启） |

## 构建部署

**Web 生产构建**：

```bash
pnpm build
pnpm start
```

**Electron 桌面打包**（生成 `.app` 并安装到 `/Applications`）：

```bash
pnpm electron:desktop
# 产物：
# - dist/mac-arm64/精细化AI规划.app
# - /Applications/精细化AI规划.app
```

仅打包到 `dist/`：

```bash
pnpm electron:build
```

## 项目结构

```
├── src/
│   ├── app/                 # Next.js 页面 + API 路由
│   ├── components/
│   │   ├── ui/              # shadcn 组件
│   │   └── teach-chat.tsx   # 教学对话（头像 / 背景 / 重点词）
│   ├── db/                  # SQLite schema + 查询
│   └── lib/                 # AI、LLM、代码项目、数据源
├── electron/main.js         # Electron 主进程
├── docs/screenshots/        # README 界面截图
├── data/                    # SQLite 数据库存储目录（开发）
└── scripts/                 # 构建辅助脚本（standalone / 安装到 Applications）
```

## 数据存储

- **开发模式**: `./data/learning-planner.db`
- **Electron 打包后**: `~/Library/Application Support/ai-learning-planner/data/`（macOS，跨版本稳定路径）
- 所有数据存储在本地，无需外部数据库
