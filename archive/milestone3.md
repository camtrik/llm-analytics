# Milestone 3（更新版）：Quant 建议能力（优先）+ 与 LLM 顺便对比（2–5 天）

**目标（当前版本）**：先把一个“传统 Quant 规则策略”做成可用的 **建议/信号功能**（BUY/SELL/HOLD），并能输出基础回测指标；同时在前端与 LLM 建议 **顺便并排展示**（不追求严格口径评测，LLM 输入也可以随之调整）。

> 关键点：Milestone 3 的第一优先级是“Quant 也能给建议”，对比是第二优先级；先跑通闭环再迭代口径。

---

## 0) 现状（与你当前代码对齐）
- 数据来源：`yfinance`；缓存落盘：`var/market_cache/{timeframe}/{ticker}.json`（`MarketCache`）
- cache 未 ready：后端会返回 `409 cache_not_ready`；前端要求先点 `Load`
- LLM 已完成：`/api/analysis/feed` + `/api/analysis/run` + history（SQLite）
- 前端页面：`frontend/app/display/page.tsx` 已具备 Load/Feed/Analyze/History/Chat

---

## 1) 我们要交付什么（Milestone 3 的最小闭环）

### 1.1 后端（Quant）
1) 新增 Quant 接口（建议一个就够）：
   - `POST /api/quant/backtest`：输入 ticker + timeframe + 策略参数 → 输出该 ticker 的：
     - **当前信号**（BUY/SELL/HOLD）
     - **基础指标**（totalReturn/maxDrawdown/交易次数…）
     -（可选）equity curve（用于前端画小图）
   - MVP 按“单次只跑 1 个 ticker”实现，换 ticker 重新请求即可；后续可扩展为批量逐 ticker 独立回测（非组合资金）。
2) 实现 1–2 个 baseline 策略（先 1 个也可以验收，2 个更有对比价值）：
   - 趋势：MA crossover
   - 均值回归：RSI reversal（或 Bollinger，二选一）

### 1.2 前端（展示 + 顺便对比）
- 在 `/display` 增加 Quant 面板：
  - 选择策略（MA/RSI）
  - 选择 timeframe（默认 `6M_1d`）
  - 参数输入（fast/slow 或 length/lower/upper）
  - 点击运行 → 展示 Quant 的 signal + 指标
- 同屏顺便展示 LLM：
  - LLM 的 `actions[]` 依旧显示
  - 每个 ticker 卡片上同时显示 Quant signal 与 LLM action（标注一致/不一致即可）

---

## 2) 技术路线（按当前目标：优先接库更快）

### 2.1 回测/策略库选择：优先 `backtesting.py`
在“先跑通 Quant 建议能力”的目标下，建议先用库：
- 策略实现更快（规则写成 Strategy 类）
- 能快速拿到 trades / equity curve / 基础统计
- 我们只需要把你现有 bars 转成它需要的 DataFrame 并封装成稳定的 API 输出

落地改动：
- `backend/requirements.txt` 增加 `backtesting`（必要时锁定版本）

> 如果库在“成交假设/成本/输出结构”上不易控制，再切换为手写回测核也不晚；但 Milestone 3 先以“跑起来”为准。

### 2.2 `backtesting.py` 怎么用（在本项目里的落地方式）
这里写清楚“怎么用”的原因：避免我们把时间花在争论口径；先按一条最小路径把 Quant signal 跑通。

**安装**
- `backend/requirements.txt` 追加：`backtesting`

**数据适配（你的 bars → backtesting DataFrame）**
- 你当前 bars 是 `{"time","t","o","h","l","c","v"}`；`backtesting.py` 需要 `pandas.DataFrame`，列名通常为：
  - `Open`, `High`, `Low`, `Close`, `Volume`
  - index 为递增的时间索引（建议用 `time` 转成 `datetime`）

建议在 `backend/app/quant/engine.py` 实现一个转换函数：
- 输入：`list[Bar]`（来自 `MarketCache.get_bars(...)` 或 batch）
- 输出：`pd.DataFrame`（index=DatetimeIndex，columns=OHLCV）

**策略实现（MA crossover / RSI）**
- 在 `backend/app/quant/strategies/` 下实现 Strategy 类（继承 `backtesting.Strategy`）
- 以 MA crossover 为例：在 `init()` 里计算均线，在 `next()` 里决定 `buy()` 或 `position.close()`

**运行回测**
- `Backtest(df, StrategyClass, cash=..., commission=...)` 然后 `bt.run()`
- 你可以先用最简单的：
  - `cash=1_000_000`（或固定 1.0 作为归一化）
  - `commission` 先不做（MVP）或用一个近似（见下方“成本”）

**从回测结果提取我们要的 API 输出**
- `stats = bt.run()`（包含 Return/Drawdown 等）
- `signal`：根据策略的最后状态/最后一次交易推断 `BUY|SELL|HOLD`
  - MVP 逻辑：最后一根 bar 后如果策略处于持仓状态 → `BUY`（或 `HOLD`），否则 `SELL`（或 `HOLD`）
- `metrics`：从 `stats` 里读字段并映射到我们自己的名字（例如 `totalReturn/maxDrawdown/tradeCount`）
- `equityCurve`（可选）：从 `stats` 或 `bt` 拿到 equity 序列并压缩成 `{t,equity}` 数组返回

**成本（MVP 处理方式）**
- 首选：在回测里真实扣费。将请求里的 `feesBps` 转成 `commission`（成交金额比例）传给 backtesting.py；滑点如暂不实现，需在 `assumptions` 中标注 `slippageBps` 未扣。
- 如果将来需要关闭扣费，也在 `assumptions` 中明确 `feesBps=0`/`slippageBps=0`，避免误导。

> 说明：之前没在计划里展开到“如何使用 backtesting.py”的细节，是因为当时我们还在决定“是否要严格口径对比”。现在你明确了“先做 Quant 建议功能”，我已经把库落地路径写进计划，避免实现时再走弯路。

---

## 3) 后端设计（建议）

### 3.1 目录结构（建议）
新增：`backend/app/quant/`
- `models.py`：Quant API 的 Pydantic DTO（请求/响应）
- `engine.py`：把 `MarketCache` bars 转成回测所需 DataFrame，并跑策略
- `strategies/ma_crossover.py`
- `strategies/rsi_reversal.py`（或 `bollinger_reversion.py`）

新增路由：`backend/app/api/quant.py`，并在 `backend/app/api/router.py` include

### 3.2 `POST /api/quant/backtest`（建议输入/输出）
**请求（示意）**
```json
{
  "timeframe": "6M_1d",
  "tickers": ["AAPL", "MSFT"],
  "strategy": { "name": "ma_crossover", "params": { "fast": 10, "slow": 30 } },
  "costs": { "feesBps": 10, "slippageBps": 0 },
  "mode": "independent",  // independent=逐 ticker 独立资金；portfolio=共享资金（可选后做）
  "output": { "includeEquityCurve": true }
}
```

**响应（示意）**
```json
{
  "timeframe": "6M_1d",
  "strategy": { "name": "ma_crossover", "params": { "fast": 10, "slow": 30 } },
  "assumptions": {
    "feesBps": 10,
    "slippageBps": 0,
    "longOnly": true,
    "mode": "independent"  // independent=每个 ticker 各用一份资金；portfolio=共享资金（需要资金分配）
  },
  "results": {
    "AAPL": {
      "signal": { "action": "BUY", "asOf": "2026-01-18T00:00:00Z" },
      "metrics": { "totalReturn": 0.12, "maxDrawdown": 0.08, "tradeCount": 5 },
      "equityCurve": [ { "t": 1700000000, "equity": 1.0 }, { "t": 1700086400, "equity": 1.01 } ]
    }
  }
}
```

**错误处理**
- cache 未 ready：沿用 `MarketCache` 行为，返回 `409 cache_not_ready`（提示先 `Load`）
- 参数非法（如 `slow <= fast`）：`400 invalid_request` + details
- bars 太少：`400 invalid_request` + details（需要多少/实际多少）
- mode 不支持：`400 invalid_request`，MVP 先支持 `independent`（逐 ticker 独立资金）；`portfolio` 模式可排期后做

---

## 4) 策略定义（MVP）

### 4.1 MA Crossover（优先做）
- 参数：`fast=10`，`slow=30`（要求 `slow > fast`）
- 信号：金叉 BUY、死叉 SELL，其余 HOLD

### 4.2 RSI Reversal（第二个策略）
- 参数：`length=14`，`lower=30`，`upper=70`
- 信号：RSI < lower → BUY；RSI > upper → SELL；其余 HOLD

---

## 5) 指标（MVP 先做“够用的”，后续再补齐）

第一阶段（必须）：
- `totalReturn`
- `maxDrawdown`
- `tradeCount`

第二阶段（有时间就补）：
- `sharpe`（简化）
- `winRate`
- `avgHoldBars`
- 成本假设的显示与回传（`feesBps`/`slippageBps`）

---

## 6) 前端（`/display`）怎么加（MVP）
- 新增 Quant 区块：
  - 策略选择（MA/RSI）
  - timeframe 选择（默认 `6M_1d`）
  - 参数输入
  - Run Backtest 按钮
- 结果展示：
  - 每个 ticker 显示：Quant signal + metrics
  - 旁边继续显示 LLM 的 action（“顺便对比”）

---

## 7) 2–5 天拆解（按“先跑通 Quant 建议”为主线）

### Day 1：Quant API + 1 个策略跑通
- 引入 `backtesting.py`
- 新增 `POST /api/quant/backtest`
- MA crossover 跑通（单 ticker，返回 signal + totalReturn/maxDD/tradeCount）

### Day 2：多 ticker + 第二策略 + UI 最小展示
- 批量 tickers 跑通（逐 ticker 独立回测）
- RSI（或 Bollinger）实现
- 前端加 Quant 面板与结果卡片

### Day 3（可选）：指标补齐 + equity curve 小图
- 补 sharpe/winRate/avgHoldBars
- 用 `lightweight-charts` 画 equity curve（可选）

### Day 4–5（可选）：把 Quant 结果注入 LLM 输入做“融合”
- 在 LLM feed/prompt 里加入 Quant 的 signal/指标摘要（让 LLM 在建议里“参考规则信号”）
- UI 显示“LLM 是否参考 Quant”与差异点（非严格评测）

---

## 8) 验收标准（当前版本）
1) cache ready（先 `Load`）时，`POST /api/quant/backtest` 能返回选中 tickers 的 Quant signal。  
2) 至少 1 个策略可用（MA crossover）；最好再加 1 个（RSI/Bollinger）。  
3) 前端 `/display` 能看到 Quant 建议，并能与 LLM 建议并排展示（不要求严格同口径）。  
