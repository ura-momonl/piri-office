# PIRI Office

PIRI Office 是一个本地运行的科研办公室：把 Codex、Claude Code、DeepSeek 三类助手放进同一个网页界面，围绕你的课题项目做对话、任务编排、文献检索、邮件、仪器与周计划。数据都留在你自己的电脑上。

**English summary.** PIRI Office is a local, Windows-first research office. One dashboard lets several coding/chat assistants (Codex, Claude Code, DeepSeek) work on your research projects: chat and task graphs, a project knowledge tree, a literature library with local RAG, mail triage, an instrument registry and weekly planning. Everything stays on your machine. MIT licensed.

这是公开发布的**去个性化版本**，和作者自己日常使用的办公室不同：不带作者的项目、仪器清单、软件集成、头像、助手的 skills 和每日留言，带的是代码、测试、提示词和说明。第一次启动会自己建空的项目、日历、采购和文献库；接入助手、建自己的项目都在界面里完成。

## 需要什么

| 必需 | 说明 |
| --- | --- |
| Windows 10/11 | 主要在 Windows 上使用和测试；部分功能（Edge 自动化、PowerShell 脚本、托盘）只在 Windows 上有 |
| Node.js 24 及 npm | `npm ci` 安装依赖 |
| 至少一个助手 | Codex CLI、Claude Code，或 DeepSeek（需要 Python 3.10+ 和 `dsh`）；界面里的“开始配置”会引导安装和登录 |

可选：Edge（浏览器自动化和界面测试）、PowerShell 7（Microsoft Graph 邮件和日历）、带 CUDA 的显卡（本地 embedding 和文献检索）、Docker（沙箱测试）。

## 开始

```
git clone https://github.com/ura-momonl/piri-office.git
cd piri-office
npm ci
node automation/run.mjs dashboard serve
```

然后打开 http://127.0.0.1:18787 ，首页点“开始配置”。`node automation/run.mjs help` 列出全部命令行模块。

## 示例项目

仓库自带一个**虚构的示例项目** `example-project`（一维热传导求解器的网格收敛），用来看项目框架长什么样；启动后在“项目”页能看到。它的 `workspace/projects/example-project/FRAMEWORK.md` 分三块：

- **项目说明**：固定背景——研究问题、分工、主要资料位置、怎么运行；
- **逻辑组织**：当前的理解，每条指向支撑它的日志，另有一个 Methods 节点记误差和阶数的定义；
- **时间日志**：按发生顺序的记录，编号 `T-日期-序号`。里面有一条计划、一条带真实数据的结果，和一条后来的更正（旧条目不改，由新记录用 `corrects` 声明）。

脚本 `analysis/convergence.mjs` 能直接运行，重新生成 `data/processed/convergence.csv`。试试：

```
node automation/run.mjs projects list
node automation/run.mjs projects outline example-project
node automation/run.mjs projects search "example-project#误差"
node automation/run.mjs projects framework example-project     # 检查结构和引用
```

规则见 [projects/FRAMEWORK-RULES.md](projects/FRAMEWORK-RULES.md)，命令和字段见 [projects/FRAMEWORK-TOOLS.md](projects/FRAMEWORK-TOOLS.md)。不需要它时，在项目页归档，或删掉 `workspace/projects/example-project/` 和 `projects/catalog.json` 里的这一项。

## 数据流向

- **对话和项目资料**：只发给你当次选的助手背后的服务——Codex（OpenAI）、Claude Code（Anthropic）、DeepSeek（DeepSeek 官方接口或 Command Code）。办公室自己不上传项目文件；助手按需读取项目里的文字并放进对话，所以放进项目的内容等于可能发给所选的助手。
- **本机计算**：记忆检索、项目节点检索用的 embedding 在本机 GPU 服务里算，向量留在 `.runtime/`，空闲 30 分钟后卸载。
- **文献**：只发 DOI、题名和检索词给 doi.org、OpenAlex、Crossref、arXiv、PMC 等公开接口；Web of Science 需要你自己的 key。
- **邮件**：通过 Microsoft Graph 读取（只读），发送必须你批准。带附件发送时会用 Codex 的登录令牌上传附件（见下表）。
- **更新**：`scripts/github-update.mjs` 访问 GitHub；助手 CLI 的自动更新访问 npm。
- **其余**：代码里没有统计或遥测的地址。
- **完全本地**：不接入任何助手时，界面、项目库、日历、文献库的本地部分照常可用（接入向导会先进入这个模式）。有数据合规要求时，只启用单位允许的那一家助手，并在“设置 → 使用哪些助手”里关掉其余。

## 它读写哪些位置

默认只在项目文件夹里读写（`.runtime/` 放运行数据，已被 Git 忽略）。下面这些是和项目外的东西打交道的地方，都是对应功能启用时才会发生：

| 功能 | 项目外读写了什么 |
| --- | --- |
| Codex | 读 `~/.codex`（登录状态、配置、会话统计），启动 `%APPDATA%\npm` 下的 CLI；可用 `CODEX_HOME`、`MAIL_FLOW_CODEX_BIN` 改位置 |
| Claude Code | 读 `~/.claude`（登录状态、额度），启动 `~/.local/bin/claude.exe`；可用 `WORKFLOW_CLAUDE_BIN` 改位置 |
| DeepSeek | 以 `~/.dsh` 作为 `dsh` 的工作目录，**会写入** |
| 接入向导 | 你点击后才执行官方安装命令，会写 `%APPDATA%\npm` 或 `~/.local` |
| Microsoft Graph 邮件 | 在 `.runtime/mail-flow/` 里运行 PowerShell SDK，登录缓存**会写** `~/.mg`；需要先在 `mail-flow/config.json` 填账号 |
| 自启和计划任务 | `dashboard/Install-Startup.ps1`、`remote/Install-Startup.ps1`、`automation/Register-Collector.ps1` 由你手动运行时才会写启动文件夹和任务计划 |
| 助手 CLI 自动更新 | `dashboard/Update-Clis.ps1` 后台空闲时更新 Codex 和 Claude 的 CLI（写全局 npm 目录） |
| 邮件附件 | 发送带附件的邮件时，用 `~/.codex/auth.json` 里的登录令牌向 chatgpt.com 上传附件；不带附件不会用到 |
| 提示词页面 | 只读展示 `~/.claude/CLAUDE.md`、`~/.dsh/AGENTS.md` 和各 CLI 的 skills 目录，说明助手实际会读到什么（`OFFICE_BASE_HOME` 可改位置） |
| 测试 | 在系统临时目录的 `piri-office-tests` 里建脱敏副本，并清理其中超过一天的旧副本 |
| 仪器页 | 在本机找 VS Code（`Code.exe`）来打开驱动文件，没装就不打开 |
| 浏览器 | 固定使用 `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` |
| 网络 | npm、GitHub、各助手的官方接口、DOI/OpenAlex/arXiv 等文献接口；`usage/extra-resets.mjs` 访问的第三方站点是可选的 |

**时区：** 日历、周计划、每日任务和“今天”都按办公室时区算，设置在 `weekly/config.json` 的 `timezone`（IANA 名，如 `America/Los_Angeles`，默认 `America/Chicago`），改完重启后端；浏览器在哪个时区都按它显示。

**安全提示：** 网页服务只监听本机回环地址，没有登录认证，不要把端口暴露出去。聊天里出现的本机文件路径可以在网页里预览，规则见 `dashboard/local-files.mjs`。

## 测试

```
node scripts/run-tests.mjs --list     # 看会跑哪些文件
node scripts/run-tests.mjs            # 在脱敏的临时副本里跑全部测试，不碰真实数据
```

测试在系统临时目录下的 `piri-office-tests` 里建副本。本版本公开的测试都是在不带作者数据的干净副本里通过的。

## 更新

```
node scripts/github-update.mjs            # 预览有什么变化
node scripts/github-update.mjs --apply    # 应用；你改过的文件不会被覆盖
```

## 文档

- [AGENTS.md](AGENTS.md)：助手在这个目录里工作时遵循的约定和命令入口
- [automation/README.md](automation/README.md)、[work/AUTONOMY.md](work/AUTONOMY.md)、[work/RESULT-REVIEW.md](work/RESULT-REVIEW.md)：模块、任务编排与成果审查
- [projects/README.md](projects/README.md)：项目资料库（逻辑组织和时间顺序两条线）
- [prompts/README.md](prompts/README.md)：提示词怎么放、怎么改、怎么检查
- [literature/README.md](literature/README.md)、[mail-flow/README.md](mail-flow/README.md)、[instruments/README.md](instruments/README.md)、[weekly/README.md](weekly/README.md)：文献、邮件、仪器、周计划
- [automation/TESTING-AND-SANDBOX.md](automation/TESTING-AND-SANDBOX.md)、[browser/SAFETY.md](browser/SAFETY.md)：测试、沙箱和浏览器自动化的约定

## 配置

`mail-flow/config.json` 和 `literature/config.json` 里是占位值（示例账号、示例图书馆地址），按自己的情况改；它们在公开仓库里被跟踪，**不要把真实账号或密码提交回去**。

## 许可

MIT，见 [LICENSE](LICENSE)。`dashboard/vendor/` 下的第三方组件保留各自的许可证。
