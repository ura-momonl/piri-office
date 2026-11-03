# 采购：报价核对

需求与规格 → 供应商候选 → 询价草稿 → 报价核对/比较 → ECE 内部采购申请 → 审批及采购人员执行 → 到货与实验使用。当前实现本地需求登记、报价验算及 ECE 申请的准备、附件上传、用户批准后提交和只读跟踪；不直接向供应商下单或付款。

catalog.json 存采购本身的事实，邮件行动继续由原邮件账本拥有；用 mail_task_id 关联，不复制邮件处理状态。每个供应商在该采购下保存当前报价；按用户要求替换旧报价时保留采购 id，不自动判断新旧报价关系。历史邮件和原附件仍为依据。项目归属从项目链接读取，共享采购不重复建单。

## 模块搭建策略

- agent 是本次工作的推进者：读原信、附件和用户最新决定，提取型号、数量、费用并判断哪些信息明确、哪些未知；只看新报价就不重开旧报价关系调查。
- 采购模块拥有采购事实和确定性计算，不用正则或另一个模型重新解释邮件，不建第二套邮件队列、自动催信或轮询。
- agent 先 `list` 读当前记录，保留无关字段后 `record`，再用 `check` 读回结果，在对话直接交付；只有必要的用户决策或对外动作批准才出卡片。
- `check` 验算录入数字，不自动证明其与原文一致；agent 负责来源核对。税为零不代表教育优惠，报价算对也不代表技术适配或可直接下单。

```powershell
node automation/run.mjs procurement list
node automation/run.mjs procurement check example-purchase
node automation/run.mjs procurement compare example-purchase
node automation/run.mjs procurement record <request.json>
```

## 报价录入契约

原有供应商字段继续有效。可附加 `items:[{description,part_number,quantity,unit_price,line_total}]`、`charges:{subtotal,shipping,tariff,tax}`、`education_discount:{status,evidence}` 和 `commercial_notes:[]`。具体完整入口见 `help procurement`。

- 未知值填 null 或省略，不能代填 0；优惠状态为 `unknown`、`confirmed` 或 `not_offered`，后两者必须有原文依据。状态由 agent 判断，程序不验证依据文本的语义。
- 金额按两位小数货币逐行四舍五入，逐项检查数量 × 单价、行金额之和＝小计、小计＋运费＋关税＋税＝报价总额。不反推税率、关税基数或未写明的折扣；不用于零位／三位小数货币。
- `record` 完整替换同 id 记录；结构错误或已知数字矛盾时不落盘；不完整的报价仍可登记。`check` 的 `arithmetic` 为 `matched`、`unknown` 或 `invalid`，缺项及原始来源随结果返回，商业条款保留为备注。
- `compare.comparable` 只是已知价格、同币种、含税运、人工确认技术适配且无录入错误的基础门槛，不是供应商推荐；数量、规格、时效与商业条件仍须按实际需求核对。

隔离回归：`node scripts/run-tests.mjs --procurement --keep`（脱敏副本，一次安全 Edge 启动访问 localhost 虚构站点；无真实学校／供应商／邮件或模型调用）。这不等于重新验收工作台按钮发起 agent 的整条路径。

