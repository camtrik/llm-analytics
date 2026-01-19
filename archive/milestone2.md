# Milestone 2（细化）：LLM 分析与“当前应执行什么操作”

目标：在 Milestone 1 的 `feed` 基础上，后端能调用 LLM（先支持 GPT + DeepSeek 两家 OpenAI-compatible），生成“当前时点应执行的操作建议”，并返回 **可校验的结构化 JSON**（便于落库、回看、后续接 Quant 对比/真实下单）。

> 约束：按你当前设定，`feed` 只读本地文件缓存；未 Load/Refresh 时不允许生成 feed，也不允许分析。

---

## 0) 参考 AI-Trader 的实现方式（我们要借鉴的点）

AI-Trader 的核心思路是：

1) **OpenAI-compatible 客户端抽象**
   - 通过 `base_url + api_key + model` 连接不同厂商（GPT/DeepSeek 等）。
   - 见：`AI-Trader/agent/base_agent/base_agent.py:401`（`ChatOpenAI` / `DeepSeekChatOpenAI` 的选择）

2) **DeepSeek 的兼容性修补**
   - 确保 `messages[].content` 一定是 string（有些 SDK 会发送 content parts）。
   - DeepSeek 某些网关可能把 `tool_calls.function.arguments` 返回成 JSON string，需要补 parse。
   - 见：`AI-Trader/agent/base_agent/base_agent.py:33`（`DeepSeekChatOpenAI` 的 `_get_request_payload` / `_generate` 修补）

3) **可靠性：重试 + 任务循环（agentic）**
   - 失败重试、指数退避。
   - 见：`AI-Trader/agent/base_agent/base_agent.py:443`（`_ainvoke_with_retry`）

4) **信息组织：system prompt 注入“当前状态”**
   - 把日期、持仓、价格等固定信息写入 system prompt。
   - 见：`AI-Trader/prompts/agent_prompt.py:25`

> 我们 Milestone 2 先不做 MCP tools 的 agentic loop（否则复杂度大），但会复用 1)2)3)4) 的工程套路：**provider 抽象 + DeepSeek 兼容性 + schema 校验重试 + 明确 prompt 结构**。

---

## 1) 输入（Input）：分析请求应包含什么

### 1.1 Feed（来自 Milestone 1）
从后端生成的 feed（或 feed 的引用 id）作为分析输入主体，至少包含：
- `date`：决策时刻（ISO，UTC）
- `positions`：从 SBI 导入得到的持仓（ticker/qty/avg_cost…）
- `tradableTickers`：允许交易的 ticker 列表
- `ohlcv`：两套 timeframe：
  - `10D_1h`：每 ticker 一组 bars
  - `6M_1d`：每 ticker 一组 bars
- `meta`：生成时间、每个 timeframe 的 min/maxTs/barCount（用于 freshness/可复现）

### 1.2 约束（建议新增，哪怕先给默认值）- implemented in AnalysisConstraints
为了让“应该执行什么操作”更可执行，建议分析接口允许传入/覆盖一些约束（MVP 给默认值也行）：
- `cash`：可用现金（如果暂时拿不到，允许 `null`，并要求模型输出“按比例/目标仓位”而非绝对数量）
- `maxOrders`：一次最多下几笔单（例如 3）
- `allowBuy` / `allowSell` / `allowShort`：交易方向限制（默认：只允许卖/买现货，不做空）
- `lotSize`：最小交易单位（日本股票通常 1 股或 100 股，按实际券商）- 未设置
- `feesBps` / `slippageBps`：交易成本假设 - 未设置
- `riskBudget`：最大回撤/单笔风险上限（MVP 可选）- 未设置

> 你当前 `positions` 来自 SBI CSV，但未包含现金与可买能力；如果不补 `cash`，建议先让模型输出“目标仓位/减仓比例”，并在 UI 明示“需要人工换算数量”。

---

## 2) 输出（Output）：结构化 JSON 结果（强制 schema）

Milestone 2 的关键不是“让模型说一堆话”，而是返回 **能被后端校验的 JSON**，最少包含：

### 2.1 `AnalysisResult`（建议字段）
- `meta`
  - `asOf`（ISO UTC）
  - `provider`（`gpt` / `deepseek`）
  - `model`
  - `promptVersion`
  - `feedMeta`（把输入 feed 的 `generatedAt`、timeframe `maxTs` 等带回来，确保可追溯）
- `summary`：一句话总览（可读）
- `actions[]`：建议操作列表（核心）
  - `ticker`
  - `action`：`BUY|SELL|HOLD|REDUCE|INCREASE`
  - `size`：建议优先支持两种之一（由 constraints 决定）
    - `qty`（绝对数量，只有 cash/lotSize 可用时才允许）
    - `targetWeight` / `deltaWeight`（比例型建议）
  - `timeframe`：`10D_1h` or `6M_1d`（主要依据哪个）
  - `rationale`：简短依据（必须引用输入里的可见事实，例如“6M_1d 下跌趋势 + 10D_1h 反弹失败”）
  - `risk`：止损/无效条件/主要风险
  - `confidence`：0-1
- `doNotTradeIf[]`：不可执行条件清单（例如“无现金/不可卖出/流动性不足”）- 虽然设置，但没看懂

### 2.2 校验与重试策略（必做）
- 后端用 Pydantic 校验 `AnalysisResult`。
- 校验失败：自动重试 1-2 次（把校验错误摘要回传给模型，要求“只输出符合 schema 的 JSON”）。
- 仍失败：返回 502/500，并把失败原因落库（便于 debug）。

---

## 3) API 设计（后端）

### 3.1 Provider 列表与默认值
- `GET /api/analysis/providers`
  - 返回可用 provider 列表（`gpt`、`deepseek`）及其默认 model（不返回 API key）

### 3.2 执行分析（同步 MVP，后续可升级 job/stream）
- `POST /api/analysis/run`
  - 入参：
    - `provider`：`gpt|deepseek`
    - `model`：可选（默认 provider 的 model）
    - `feed`：可以是 `feed` 全量，或 `feedRef`（指向 manifest+tickers 的组合）- 已经实现为feedRef?
    - `constraints`：可选
    - `promptVersion`：可选（默认 `v1`）
  - 出参：
    - `result`（`AnalysisResult`）
    - `raw`（可选，保存模型原始文本，便于排查）

> 与 Milestone 1 的“feed 只读文件”一致：如果 feed 缓存未就绪，`/run` 也应直接拒绝（409），并提示先 Load。

### 3.3 历史与复现
最低限度：
- `GET /api/analysis/history?provider=...&ticker=...`
- `GET /api/analysis/{id}`

---

## 4) 存储（SQLite MVP）

建立一张（或两张）表保存可复现信息：

- `analysis_runs`
  - `id`
  - `createdAt`
  - `provider` / `model`
  - `promptVersion`
  - `feedJson`（或 `feedRef + manifest snapshot`）
  - `constraintsJson`
  - `resultJson`
  - `rawText`（可选）
  - `status` / `error`

这样可以保证：
- 同一次分析可复现（输入 feed + constraints + promptVersion + model）
- 便于后续做 Quant 对比与评估

---

## 5) LLM Provider 实现（GPT + DeepSeek）

### 5.1 统一的 provider 抽象（借鉴 AI-Trader）
建议实现一个轻量的 provider registry：
- `provider=gpt`
  - `base_url`（默认 OpenAI）
  - `api_key`（env）
  - `default_model`（env）
- `provider=deepseek`
  - `base_url`（DeepSeek OpenAI-compatible endpoint）
  - `api_key`（env）
  - `default_model`（env）

### 5.2 DeepSeek 的兼容性处理（照搬 AI-Trader 的经验）
即使我们不用 tool calling，也建议保留以下“防坑”：
- 强制 `messages[].content` 为 string（避免 SDK/客户端传 list parts）
- 若未来使用 tool calling：DeepSeek 返回的 `tool_calls[].function.arguments` 可能是 string，需要 `json.loads`

### 5.3 超时/重试
参考 AI-Trader：
- 网络超时（例如 30s）
- 失败重试 2-3 次 + 退避（对 429/5xx 特别重要）

---

## 6) Prompt 设计（从 feed → 可执行操作）

### 6.0 Prompt 参考来源与融合方式（建议写成可版本化模板）

Milestone 2 的 prompt 建议融合两类现成资产（并在后端用 `promptVersion` 管理版本）：

1) **“顾问层/严格 JSON 输出”模板**（作为主骨架）
   - 参考：`investment-prompt.md:1`
   - 可直接复用其中的结构：输入区块（account/positions/market/assets/orders）、硬性风控约束、以及“严格 JSON schema”要求。
   - 与本项目的对齐建议：
     - `as_of` → `meta.asOf`
     - `universe` → `tradableTickers`
     - `actions[]` 的 `symbol/side/qty/...` → 我们的 `actions[]`（若现金未知，则用 `targetWeight/deltaWeight` 代替 `qty`）

2) **“交易 agent 的行为约束/防幻觉措辞”模板**（作为补充规则/语气）
   - 参考：
     - 美股版：`AI-Trader/prompts/agent_prompt.py:25`
     - A 股版（约束更强）：`AI-Trader/prompts/agent_prompt_astock.py:30`
   - 可借鉴点：
     - 明确“不要虚构信息”“信息不足则输出 hold/不交易条件”
     - 明确“基于给定输入做判断”的标准化措辞
   - 不建议照搬点（Milestone 2 暂不做工具调用/真实下单）：
     - “必须调用 buy/sell 工具”“交易系统限制说明”等 agentic/执行相关条款

### 6.1 Prompt 结构（建议）
- System:
  - 角色：研究/交易助理（但要避免“保证盈利”）
  - 输入说明：feed 字段解释（timeframes、bars 字段）
  - 约束：必须遵守 constraints；若缺失现金/规则则只能输出比例建议
  - 输出：严格 JSON（给出 schema 概要）
- User:
  - 附上 `feed`（JSON，必要时可做简化：只传最近 N 根 bars + 统计摘要；但 Milestone 2 可以先全量）

### 6.2 输出必须“可执行/可验证”的规则
建议明确要求模型：
- 每个 action 都必须引用至少 1 条可见事实（来自 OHLCV 的趋势/波动/近期拐点）
- 如果信息不足（例如现金未知），必须输出 `doNotTradeIf` 并把 size 改成 `targetWeight/deltaWeight`
- 必须限制 action 数量不超过 `maxOrders`

---

## 7) 前端（Next.js）最小改动

在 `/display` 页面新增：
- Provider 选择（`gpt` / `deepseek`）
- `Analyze` 按钮（仅在“已 Load/缓存就绪”时可点击；否则置灰）
- 结果展示（结构化卡片 + raw JSON）
- 历史记录入口（后续）

---

## 8) Milestone 2 验收标准（Definition of Done）

1) 选择 provider（GPT/DeepSeek）+ 点击 Analyze → 后端成功调用 LLM 并返回 `AnalysisResult`。  
2) 后端对输出做 schema 校验；校验失败会自动重试；最终失败会返回明确错误且可追踪。  
3) 结果可落库并可查询历史；每条记录可复现（含 feed snapshot/manifest 信息 + promptVersion + model）。  
4) DeepSeek 与 GPT 都能稳定跑通（同一套 provider 抽象 + 基础兼容性处理）。  



## 改善
- 对话友好化（保持严格 JSON，同时支持自然语言跟进）
  - 在 `AnalysisResult` 增加 `conversation` 字段（数组或最近一条），专用于对话文本；actions/meta/doNotTradeIf 仍保持结构化。
  - 初次回复：`conversation` 写明主要依据/理由摘要；续聊时将用户提问与模型自然语言回复记录追加（同时允许 actions/meta 发生变化）。
  - 接口：`/analysis/run` 返回 `conversation`；`/analysis/continue` 追加 user/assistant，并返回更新后的 `conversation`+`actions` 等。
  - 前端：Result 卡片下方只展示 `conversation`（不直接渲染整段 JSON），同时右上可通过箭头/选择切换查看各轮对话对应的 `actions/meta` 快照；原始 JSON 保留在 Raw 区域。
  - 校验：继续对话时依旧跑 schema 校验，允许 `actions` 更新；若模型返回无效 JSON，按现有重试策略修正。
  - 显示切换：Result 卡片保持现有布局不变，聊天区域只显示 `conversation` 内容；提供左右箭头或选择器在多轮对话之间切换，切换时同步展示该轮对应的 actions/meta/doNotTradeIf 快照；Raw 区域展示当前所选轮的完整 JSON。
