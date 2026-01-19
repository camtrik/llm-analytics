# Quant 下一步计划（基于已实现的 MA + RSI 基础版本）

本文是在你们已经实现：
- `MA Crossover`（`backend/app/quant/strategies/ma_crossover.py`）
- `RSI Reversal`（`backend/app/quant/strategies/rsi_reversal.py`）
- API：`POST /api/quant/backtest`（`backend/app/api/quant.py` + `backend/app/quant/engine.py`）

的基础上，给出下一步“更像成熟投顾系统”的迭代计划。重点不是变成自动交易系统，而是让 Quant 输出**更可解释、更贴合持仓、更可融合到 LLM 建议**。

---

## 0) 当前实现的“现状总结”（我们从哪里出发）

### 0.1 你们现在的 Quant 输出是什么
`POST /api/quant/backtest` 对每个 ticker 返回：
- `signal.action`：`BUY/SELL/HOLD`（基于最后一根 bar 的指标判断）
- `metrics`：`totalReturn/maxDrawdown/tradeCount` +（可选）`winRate/avgHoldBars`
- `assumptions`：`feesBps/slippageBps/initialCash/mode`

### 0.2 你们现在的 Quant 回测“怎么跑”
- 数据：来自 `MarketCache` 的 OHLCV
- 执行：用 `backtesting.Backtest` 跑策略（`commission` 使用 `feesBps/10000`）
- 风险控制：目前没有止损/止盈/过滤器（只有入场/出场规则）

### 0.3 当前最重要的一个技术债（已解决）
RSI 的“回测用 RSI”和“signal 用 RSI”不是同一个实现：
- 回测：`backend/app/quant/strategies/rsi_reversal.py::_rsi`（numpy 版本）
- signal：`backend/app/quant/engine.py::_rsi_signal`（pandas ewm 版本）
这会导致极少数情况下“回测逻辑”和“当前信号”不一致。

---

## 1) 下一步总目标（面向投顾系统，而不是自动交易）

你们的产品目标是：**给出投资建议（结合 tickers 历史 + 当前持仓）**。
因此 Quant 下一步的核心不是“更精细地模拟成交”，而是：

1) 输出更贴近投顾语义的建议：`BUY / INCREASE / REDUCE / SELL / HOLD`（未持仓只会出现 `BUY/HOLD`，已持仓才会出现 `INCREASE/REDUCE/SELL`；如需表示仓位调整，可额外输出可选字段 `targetWeight`（目标权重）或 `deltaWeight`（在现有基础上调多少），可后置）
2) 解释为什么：给出结构化依据（例如“趋势向上”“超卖反弹”“风险过高”）
3) 与持仓联动：同一个信号，对“已持仓”和“未持仓”应给不同动作；如果没有持仓信息，按未持仓处理
4) 能被 LLM 复用：Quant 结果作为结构化特征/证据，喂给 LLM 提高建议质量（可后置）

---

## 2) 通用工程改造（MA/RSI 都需要，优先级最高）

### 2.1 明确 `signal.action` 的语义（避免误读）
现在的 `BUY/SELL/HOLD` 更像“方向倾向”，不是“今天发生交易”。
建议改成二层输出：
- `signal.position`：`0/1`（是否建议持有）
- `signal.action`：投顾动作（未持仓只会出现 `BUY/HOLD`，已持仓可能出现 `INCREASE/REDUCE/SELL`）
- `signal.reasonCodes`：例如 `["trend_up", "oversold"]`
- `signal.details`：关键指标值（MA/RSI 数值）

### 2.2 增加 `explain` 字段（可读理由）
对每个 ticker 输出一个简短解释模板（不是 LLM 那种长文）：
- MA：`fastMA=..., slowMA=..., lastCross=...`
- RSI：`rsi=..., zone=oversold/neutral/overbought`

### 2.3 统一指标计算口径（尤其 RSI）
把 `engine.py::_rsi_signal` 改为复用策略里的 `_rsi`（或反过来统一为一个公共实现文件）：
- 新建 `backend/app/quant/indicators.py`：`sma()` / `rsi_wilder()` 等
- 策略与 signal 都调用同一份 indicators

### 2.4 给“策略结果”增加可验证的中间量
在同一 API 响应中（可选开关）返回：
- 最新指标值：`latest.fastMA/latest.slowMA/latest.rsi`（偏离度/斜率可选）
- 最近一次触发事件：`lastEntryTs/lastExitTs`（可从 `_trades` 推断）
这样 UI/LLM 都能引用具体数值，减少“黑盒感”。

### 2.5 把 “成本/执行假设”说清楚
目前 `slippageBps` 未实现，但也会回传。下一步至少做到：
- `assumptions` 明确写：`executionPrice="close"`（或将来 `"next_open"`）
- 若 slippage 未实现，`assumptions.slippageApplied=false`

### 2.6 基础测试（防止越改越不确定）
最小测试集合（不追求覆盖率，追求锁定口径）：
- RSI：同一份 close 序列下，`signal` 与策略指标一致
- MA：`slow<=fast`/bars 太少会报 `400`
- stats 提取：`Return [%]`/`Max. Drawdown [%]` 等字段缺失时的 fallback 行为

---

## 3) MA Crossover 的下一步（让它更像成熟投顾建议）

### 3.1 给出“强度”而不是只有 BUY/SELL
在趋势策略里，成熟系统会输出趋势强弱，常用的简单量：
- `distance = (fastMA - slowMA) / slowMA`（偏离程度）
- `slope = slope(slowMA)`（慢均线斜率，避免横盘噪声）

把动作从“二值”升级为“投顾建议”：
- 未持仓：
  - 趋势强（distance>阈值且 slope>0）→ `BUY`
  - 趋势弱/横盘 → `HOLD`
- 已持仓：
  - 趋势转弱（fast<slow 或 slope<0）→ `REDUCE` 或 `SELL`
  - 趋势仍强 → `HOLD`（或 `INCREASE`，需风险约束）

### 3.2 增加一个最小风控：移动止损（优先）
成熟趋势策略几乎都需要风险控制，否则回撤很难看。
建议优先做一个“ATR 移动止损”版本（不改变入场逻辑，只改变退出逻辑）：
- 入场：仍然用金叉/突破
- 退出：价格跌破 `entryPrice - k * ATR` 或 trailing stop

在 `backtesting.py` 体系里可以参考：
- `backtesting.lib.TrailingStrategy`（理念：用 ATR 设 trailing stop）

### 3.3 参数策略（避免拍脑袋）
MA 参数（fast/slow）下一步不要只靠默认值：
- 可选：新增一个“参数搜索”脚本/接口（离线也行），目标=最大化 `Return` 或 `Equity Final`，同时约束 `Max DD < X`、`#Trades < Y`（防过拟合/过度交易）。若暂不做搜索，可先给一组验证过的默认参数区间。

---

## 4) RSI Reversal 的下一步（把它从“接飞刀”变成可用建议）

### 4.1 把 RSI 从“全仓进出”改成“加减仓倾向”
在投顾系统里，RSI 更适合做“仓位倾斜（tilt）”：
- RSI < lower：倾向 `INCREASE`（或新开仓 `BUY`）
- RSI 在中间：`HOLD`
- RSI > upper：倾向 `REDUCE`（已持仓）或 `HOLD`（未持仓）

这样能避免 RSI 策略在震荡里频繁全仓进出。

### 4.2 必加过滤器：趋势过滤（避免下跌趋势里抄底）
成熟的 RSI 反转策略常配“趋势过滤”：
- 只有当长期趋势向上时（例如 close > MA200 或 slowMA 斜率 > 0）才允许 RSI<lower 的买入/加仓建议
- 若长期趋势向下：即使 RSI 很低，也最多给 `HOLD/REDUCE` + 风险提示

这一步能显著减少“越跌越买”的坑。

### 4.3 输出 RSI 的“区间解释”
把 RSI 输出拆成：
- `latestRsi`：数值
- `zone`：`oversold/neutral/overbought`
UI 与 LLM 都能直接用。

### 4.4 参数建议（更像成熟做法）
RSI 的成熟变体很多，建议按节奏逐步引入：
- 第一步：保留 `length=14, 30/70`，加趋势过滤
- 第二步：补一个更“短周期超卖”的变体（例如 RSI(2) + 更苛刻的阈值），但必须加过滤器/持有上限

---

## 5) 把 Quant 结果“接入投顾主链路”的两种方式（建议优先第 1 种）

### 5.1 方式一：新增 `POST /api/quant/recommend`（最贴近投顾，可排期后做）
输入：
- tickers + timeframe + strategy params
- 当前持仓（从 `GET /api/portfolio` 或由后端直接读取）
输出：
- 每个 ticker：`recommendation.action (BUY/INCREASE/REDUCE/SELL/HOLD)`
- 可选：`targetWeight/deltaWeight`（如果你想从“信号”进化到“组合建议”）
- 解释：reasonCodes + 简短 rationale

### 5.2 方式二：把 Quant 摘要塞进 LLM feed
在 LLM `/api/analysis/feed` 里加一个 `quantSummary`：
- MA/RSI 的当前信号、关键指标值、回测统计（简短）
然后在 prompt 里要求 LLM “引用 Quant 作为证据或说明为何忽略”。

---

## 6) 1–3 天可落地的推进顺序（建议）

### Day 1（高收益，低风险）
- 统一 RSI 计算口径（indicators 复用）
- 在 Quant 返回里增加 `latestIndicator`（MA/RSI 数值 + zone）
- 明确 assumptions：`executionPrice` + `slippageApplied`

### Day 2（让建议更像投顾）
- 新增 `recommendation` 输出（或新接口 `/api/quant/recommend`）
- recommendation 规则：结合 `portfolio`（已持仓 vs 未持仓）
- 前端：把 `BUY/SELL/HOLD` 改成展示 `recommendation`（更直观）

### Day 3（成熟化：风控/过滤器）
- MA：加入一个 ATR/trailing stop 的退出（或至少固定止损）
- RSI：加入趋势过滤（例如 MA200/slow slope）
- 可选：做一个简单参数搜索脚本（先离线）

---

## 7) 完成后的验收（DoD）
1) MA/RSI 都能输出：最新指标值 + 区间解释 + 投顾动作（结合是否持仓）。  
2) RSI 的回测与 signal 口径一致（同一 indicators 实现）。  
3) UI 能解释“为什么建议买/卖/加仓/减仓”（不是只有一个 badge）。  
4) 可选：Quant 摘要能进入 LLM 分析，让 LLM 建议更稳定。  
