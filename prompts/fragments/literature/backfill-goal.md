回填 {{year}} 年老文献，收入资料库“其他入库”一档。收录口径以下面这段为准（来自 `literature/sources.json` 的 `lines.library`，用户逐条确认过）：

{{rules}}

做法：`literature backfill "{{year}} 1 150"` 分页读题名（按 next_from 翻页），按收录口径选序号，写 `{year:{{year}},ranks:[…]}` 后 `literature ingest <JSON路径>`。ingest 要几分钟，放后台，完成后核对入库条数和缺摘要篇数。不逐篇读摘要。

全文：ingest 完成后，对本批入库的每一篇逐篇串行 `literature fetch <doi>`（DOI 按序号取自 `.runtime/literature/backfill-{{year}}.json`），放后台；已有 PDF 会复用。路线、状态含义、预算规则和少量检索补漏见 `literature/README.md` 的“获取全文”一节。返回不是 available 的，先记 DOI 与状态并继续下一篇；常规获取结束后，仅对带 `search_suggested:true` 的按该节用现有检索工具找公开版本，再用已登记的 `--source` 入口核验下载。不得将 closed 当作没有免费版本；区分找到链接与通过全文身份校验。不重试失败来源、不加 `--login`、不自己处理 Duo 或凭据、不换用未登记的下载方式。取全文及少量补漏告一段落后跑 `literature library ingest` 再 `literature library embed`（增量，按 PDF 哈希跳过未变，本机 GPU，无模型 API）；列入 failed 的（多为扫描件）记下 DOI，不另行处理。

宁少勿滥，拿不准偏向不收。本年被引门槛：{{citation_floor}}（派出者给定，不自行放宽）。读完第一页先停下来自查，入选约占候选的四分之一；明显偏多先收紧再往下翻。不读用户的项目，不按项目名或材料名匹配；规则、说明、汇报里不举具体论文或材料当例子。

只做回填入库、取全文和建索引：不改代码、配置和收录规则，不输入凭据，不对外发送，不派子 agent、不建后续卡片，来源限流不重试。汇报写清：读了多少题名、入库多少、缺摘要几篇、取得全文几篇、其余各状态的 DOI 清单、新增索引的篇数和 failed 的 DOI、被引门槛、可怎样收紧。
