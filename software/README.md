# 软件登记与操作入口

`software/catalog.json` 登记你本机上助手可以代为操作的软件（仿真求解器、绘图软件、数据工具、命令行程序等）。公开版里它是空的，按自己的环境添加。

```
node automation/run.mjs software list          # 已登记软件一览
node automation/run.mjs software list full     # 完整详情（含可执行文件是否存在）
node automation/run.mjs software show <id>     # 单项详情
node automation/run.mjs software plan <request.json>   # 生成一份软件工作计划（不会启动软件）
```

## 一条登记的字段

`apps` 数组里每项是一个对象：

| 字段 | 含义 |
| --- | --- |
| `id`、`name` | 唯一标识和显示名 |
| `executable`、`working_directory` | 可执行文件和工作目录 |
| `connector` | 助手调用它的方式（命令行、脚本，留空表示靠界面操作） |
| `requires_running` | 是否要求软件已经在运行 |
| `operator`、`owner` | 由哪位助手操作、谁负责维护这条登记 |
| `route` | 一两句话写清怎么用、有什么限制 |
| `status`、`verified_at`、`verification` | 当前状态与最近一次核对的依据 |

## 约定

- 登记只记入口，不扫描个人配置，不保存凭据。
- 操作前先看软件里哪份文件正在打开，保留未保存的改动；计划（`plan`）只描述步骤，不会启动软件、关闭文档或操作仪器。
- 助手把软件操作交给负责它的助手时，用 `agent handoff` 写清目标、输入和输出位置。
