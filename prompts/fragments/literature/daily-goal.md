用户2026-10-17明确授权每日推荐，篇数灵活，不固定三篇。本次日期 {{date}}（America/Chicago）。先核对当地日期，过期任务不补跑旧日。
推荐口径以下面这段为准（来自 `literature/sources.json` 的 `lines.reading` 与 `lines.picks`，用户逐条确认过）；范围不是仅当前材料，不把收藏当喜欢：

{{rules}}

已有本日推荐就结束。否则 discover 只跑一次；来源限流不重试，不因抓取失败假装完整。先 browse candidates 分页题名，入围/不确定的才 show 摘要，缺的只为少数入围篇补取；不只看项目关键词排前面的文章。证据足够就结束，不逐篇另调模型。
选多少取决于值得看多少，可以零篇，不凑数；理论按启发价值酌情。每篇写问题、摘要/全文报告了什么、启发和可达性（无依据留白）。不可仅凭题名断言好工作。避免重复前几天推荐。
写 JSON {date:"{{date}}",items:[{doi,reason,basis:"abstract或fulltext",question,evidence,inspiration,reach}],note}，执行 literature recommend <JSON路径> 正式发布，确认 browse daily 1 能看到。零篇须说明原因。不要只留在聊天。
只做本次筛选和本地记录：不改代码/配置，不下载全文，不输入凭据/处理Duo，不对外发送；不派子agent、不建后续卡片、不加模型API、重试或定时任务。后台权限不够则如实记录缺口，不绕过。最终给出实际发布文件 {{file}} 的绝对路径。