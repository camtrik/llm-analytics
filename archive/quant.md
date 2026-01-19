# Quant（小白向）：用“第一三共 4568.T”跑一次 MA Crossover 的全过程解释（结合本项目代码）

你现在看到的 Quant Backtest 功能，本质上是在做两件事：
1) **回测（backtest）**：把一套规则（例如均线交叉）放到过去一段时间的价格序列上，模拟“如果当时按这套规则交易会怎样”，输出收益/回撤/交易次数等指标。  
2) **给出当前建议（signal）**：把同样的规则应用到“最新一根 K 线”，输出此刻更偏向 `BUY/SELL/HOLD` 的信号。

下面我用你截图中的例子：**第一三共 `4568.T` + 策略 `MA Crossover`（fast=10, slow=30）** 来解释每个参数、它们对结果的影响、返回字段含义，以及代码到底怎么调用的。

---

## 1) 你在界面上点击 “Run Quant” 时发生了什么

### 1.1 前端发起请求（实际代码）
前端在 `frontend/app/display/page.tsx` 里，点击按钮会执行 `runQuant()`，核心代码如下（原样摘录）：

```ts
const payload = {
  timeframe: quantTimeframe || "6M_1d",
  tickers: [ticker],
  strategy: quantStrategy,
  costs: { feesBps: Number.isFinite(fees) ? fees : 0, slippageBps: 0 },
  mode: "independent",
  initialCash: 100000,
  output: { includeEquityCurve: false },
};
const res = await fetch(`${apiBase}/api/quant/backtest`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
```

你可以把它理解成：
- 选了哪个 ticker/timeframe/策略/参数/手续费，就把这些打包成 JSON 发给后端。

### 1.2 后端入口（实际代码）
后端路由是 `POST /api/quant/backtest`，在 `backend/app/api/quant.py`：

```py
@router.post("/quant/backtest", response_model=BacktestResponse)
def run_backtest(payload: BacktestRequest) -> BacktestResponse:
    return backtest(payload)
```

后端会按 `backend/app/quant/schema.py` 的 `BacktestRequest` 校验请求体字段是否齐全、类型是否正确。

---

## 2) 这次 MA Crossover 回测里，各个参数是什么意思？有什么影响？

下面以你截图里的典型默认值解释。

### 2.1 `ticker`（例：`4568.T`）
- 你要回测的标的代码。
- 本项目会从 `MarketCache`（磁盘缓存）读取这个 ticker 的 OHLCV 数据。

### 2.2 `timeframe`（例：`6M_1d`）
它决定你拿到的价格序列“长什么样”：
- `6M_1d` 表示：**过去约 6 个月、按日线（1d）**。
- 影响：
  - bar 的数量（大概 120 根左右，取决于交易日）
  - 指标的稳定性（均线、RSI 这些需要足够 bars 才可靠）
  - 信号频率（同一个策略，日线通常比小时线信号更少）

### 2.3 `strategy.name`（这里是 `ma_crossover`）
表示使用哪一套规则：
- `ma_crossover`：均线交叉（趋势策略）
- `rsi_reversal`：RSI 反转（均值回归策略）

### 2.4 `strategy.params.fast` / `strategy.params.slow`（例：fast=10, slow=30）
这两个参数决定均线“看多短、多长的历史”：
- `fast=10`：快均线使用最近 10 根 bar 的收盘价平均值
- `slow=30`：慢均线使用最近 30 根 bar 的收盘价平均值

#### 它们会怎么影响结果？
直觉上：
- `fast` 越小：快均线越“敏感”，信号更频繁（更容易抖动）
- `slow` 越大：慢均线越“平滑”，趋势确认更慢
- 两者差距越大（比如 10 vs 60）：信号更少、更偏“抓大趋势”
- 两者差距越小（比如 10 vs 12）：信号更频繁、更容易被噪声来回打脸

本项目还做了校验（在 `backend/app/quant/engine.py`）：
- `slow <= fast` 会直接 `400` 报错，因为那样“慢均线”就没有意义了。
- `len(df) < slow + 2` 会报错，因为数据太少，算不出 slow 均线，也无法判断交叉。

### 2.4b `rsi_reversal` 的参数：`length` / `lower` / `upper`（当你切到 RSI 策略时）
如果你在 UI 里选择 `RSI Reversal`，那么参数会变成这三个：
- `length`（默认 14）：RSI 的计算窗口长度（看最近多少根 bar）
- `lower`（默认 30）：买入阈值（RSI 低于这个值认为“超卖”，触发买入）
- `upper`（默认 70）：卖出/平仓阈值（RSI 高于这个值认为“超买”，触发平仓）

它们的影响（直觉）：
- `length` 越小：RSI 越敏感，信号更频繁、更容易被噪声影响
- `lower` 越高：越容易触发买入（更频繁“抄底”）
- `upper` 越低：越容易触发卖出（更快止盈/退出）
- `lower`/`upper` 距离越小：进出更频繁，手续费影响更明显

### 2.5 `costs.feesBps`（例：10 bps）
`feesBps` 是手续费率（基点 bps）：
- 10 bps = 0.10% = 0.001（比例）
- 本项目把它转成 `commission` 传给 `backtesting.py`：
  - `fee_rate = fees_bps / 10_000.0`
  - `Backtest(... commission=fee_rate ...)`

#### 它会怎么影响结果？
手续费会在每次成交时扣掉，策略越频繁交易，手续费伤害越大。
- 趋势策略（MA）通常交易次数不多，手续费影响相对小
- 反转策略（RSI）可能交易更频繁，手续费影响会更大

> 目前 `slippageBps` 还没有计入回测，只是回传在 assumptions 里。

### 2.6 `initialCash`（例：100000）
回测起始资金（用来计算收益曲线与 Return%）。
- 大多数百分比指标（Return%、回撤）对这个数字不敏感，因为最终会除回初始资金。
- 但如果未来引入“最小下单单位/整数股/资金不足”等约束，initialCash 会变重要。

### 2.7 `mode`（当前固定 `independent`）
`independent` 表示：
- 每个 ticker 独立回测（各自一份资金、各自一条曲线）
- 当前不做“组合回测”（把多个 ticker 放在一起等权/按权重再平衡）

### 2.8 `output.includeEquityCurve`
是否返回权益曲线：
- `false`：返回更轻量，UI 只显示指标
- `true`：后端会从 `_equity_curve` 提取每个时间点的 Equity，用于画图

---

## 3) 策略原理（先讲思路，再看代码）

### 3.1 MA Crossover（趋势跟随）

#### 3.1.1 什么是 “SMA（简单移动平均）”
SMA 就是过去 N 根的平均值：
- `SMA_10`：过去 10 天的收盘价平均
- `SMA_30`：过去 30 天的收盘价平均

如果价格在持续上涨，短期平均（10日）通常会先抬升并超过长期平均（30日）。

#### 3.1.2 什么是 “交叉（crossover）”
所谓交叉就是“从一侧穿到另一侧”：
- **金叉**：快均线上穿慢均线（趋势变强的信号）→ 常见做法是买入
- **死叉**：快均线下穿慢均线（趋势变弱的信号）→ 常见做法是卖出/平仓

这类策略属于 **趋势跟随**：假设趋势一旦形成会延续一段时间。

#### 3.1.3 MA 的一个“成熟一点”的改进：加入最小风控（Trailing Stop）
你现在的 MA Crossover 只有“入场/出场”两条规则：
- 入场：金叉买入
- 出场：死叉平仓

这在震荡行情里很容易出现两个问题：
1) **回撤大**：价格从高点回落很久，等到均线真正死叉才退出，可能已经亏/吐回很多利润  
2) **假信号频繁**：涨一点金叉→买，跌一点死叉→卖，来回被磨损（手续费更会放大损失）

因此成熟的趋势策略通常会加一个“最小风控层”，最常见是 **移动止损（trailing stop）**：
- 思想：当你已经赚到一部分利润时，用一个“会跟着价格上移的止损线”保护利润；当价格回撤到止损线就先退出。
- 注意：这不改变你的入场逻辑，只是让退出更及时/更可控。

有两种你在 Day3 里提到的最小实现方式（都很常见）：

##### 3.1.3-1 固定比例 trailing stop（最容易理解）
例子：`trailPct = 8%`
- 买入后记录一个“最高价 peak”
- 止损线 = `peak * (1 - trailPct)`
- 如果价格从 peak 回撤超过 8% → 平仓

优点：简单直观、参数少。  
缺点：不同股票波动不同，8% 对高波动股可能太紧，对低波动股可能太松。

##### 3.1.3-2 ATR trailing stop（更“自适应”）
ATR（Average True Range）可以粗略理解成“最近一段时间的正常波动幅度”。
例子：`stop = peak - k * ATR`（例如 `k=2`）
- 波动大：ATR 大 → 止损更宽（不容易被噪声扫掉）
- 波动小：ATR 小 → 止损更紧（更早保护利润）

优点：对不同波动率的股票更公平。  
缺点：需要多一个指标 ATR 和一个倍率参数 `k`。

> 你们用 `backtesting.py` 的话，库本身也有“TrailingStrategy”一类的工具思路（本项目不一定要立刻依赖它），本质就是把“止损线跟随价格”这件事标准化。

---

#### 3.1.4 为什么要做 MA 风控增强？有没有必要？
如果你的目标只是“演示一个能给建议的 Quant”，不加风控也能跑通闭环；但如果你希望它在 UI 上更像“靠谱建议”，风控很有必要，原因是：
- **解释层面**：用户看到 `BUY` 但最大回撤 30% 会质疑；止损能显著降低极端回撤，让建议更可信
- **与 LLM 融合**：LLM 常被要求给“风险/止损条件”，Quant 提供一个明确的止损规则可以当作硬约束/证据
- **策略成熟度**：很多“看起来会赚钱”的趋势策略，真正能活下来靠的就是风险控制，而不是入场信号

因此：在你提出的 Day3 目标里，把“入场不变 + 最小止损退出”作为优先项是非常合理的。

### 3.2 RSI Reversal（均值回归）
RSI Reversal 属于 **均值回归（mean reversion）** 思路：价格短期“跌太多”后更可能反弹，“涨太多”后更可能回落。

#### 3.2.1 RSI 是什么（0～100 的“强弱值”）
RSI（Relative Strength Index，相对强弱指标）会输出 0～100 的数：
- 越接近 0：最近一段时间“跌的力量”更强
- 越接近 100：最近一段时间“涨的力量”更强

很多教程会用经验阈值：
- RSI < 30：可能“超卖”（跌得比较狠）
- RSI > 70：可能“超买”（涨得比较猛）

##### 3.2.1-1 RSI 到底是怎么“算出来”的（结合你们代码口径）
你可以把 RSI 理解成一个比值：  
> 最近 N 根里，“平均上涨幅度” 相对于 “平均下跌幅度” 的强弱。

你们现在的实现是 Wilder 常见口径的一个版本（指数/递推平滑），在 `backend/app/quant/strategies/rsi_reversal.py::compute_rsi_series()`。

分步骤（用“日线”举例；每根 bar 有一个 Close）：

1) 先算每天的价格变化（delta）  
   - `delta[t] = Close[t] - Close[t-1]`

2) 把变化拆成“涨幅”和“跌幅”（跌幅用正数表示）  
   - `gain[t] = max(delta[t], 0)`  
   - `loss[t] = max(-delta[t], 0)`

3) 对 gain/loss 做平滑，得到“平均涨幅/平均跌幅”  
   你们用的是递推形式（`alpha = 1/length`）：
   - `avg_gain[t] = alpha * gain[t] + (1 - alpha) * avg_gain[t-1]`
   - `avg_loss[t] = alpha * loss[t] + (1 - alpha) * avg_loss[t-1]`

4) 计算相对强弱 RS  
   - `RS[t] = avg_gain[t] / avg_loss[t]`（如果 avg_loss 为 0，表示几乎没跌，RS 会非常大）

5) 把 RS 映射到 0～100 的 RSI  
   - `RSI[t] = 100 - 100 / (1 + RS[t])`

直觉解释：
- 如果最近主要在涨（avg_gain 大、avg_loss 小）→ RS 很大 → RSI 接近 100
- 如果最近主要在跌（avg_gain 小、avg_loss 大）→ RS 很小 → RSI 接近 0

##### 3.2.1-2 length=14 代表什么
`length=14` 的意思不是“只看 14 天就结束”，而是：
- 平滑系数 `alpha = 1/14`，会让 RSI 大致反映“最近约 14 根 bar 的涨跌强弱”
- length 越小，alpha 越大 → RSI 更敏感、波动更大
- length 越大，alpha 越小 → RSI 更平滑、反应更慢

#### 3.2.2 RSI Reversal 怎么交易（你们当前实现）
你们的规则是 long-only（只做多）+ 全仓进出：
- **买入（开多）**：当最新 RSI < `lower`（默认 30）且当前没有持仓 → 买入
- **卖出/平仓（退出）**：当最新 RSI > `upper`（默认 70）且当前有持仓 → 平仓
- 其他情况：不交易，保持现状

用一个“想象中的 RSI 序列”帮助理解：
- 第 1 天 RSI=28（低于 30）→ 触发买入（开仓）
- 接下来 RSI=35、45、55（没有到 70）→ 不动，继续持有
- 某天 RSI=72（高于 70）→ 触发平仓（卖出退出）

注意：它并不是“RSI 一低就每天都买”，而是“触发条件满足时开仓一次；持仓期间不重复买；触发退出条件时平仓一次”。

#### 3.2.3 RSI 反转为什么容易踩坑：下跌趋势里“越跌越买”
单独用 RSI（超卖就买）最大的问题是：  
如果一只股票处于 **长期下跌趋势**，它可以在很长时间里都“看起来超卖”（RSI 反复很低），这时抄底往往会越抄越亏。

所以成熟的均值回归策略几乎都会加一个 **趋势过滤（trend filter）**：
> 只有当大趋势向上（或至少不向下）时，才允许做“超卖买入”；否则就算超卖也谨慎/不买。

#### 3.2.4 RSI 趋势过滤的原理（你 Day3 提到的那种）
你提的过滤条件类似两种常见做法：

##### 3.2.4-1 用长周期均线：MA200 过滤（最常见）
规则示例（用日线举例）：
- 先算 MA200（过去 200 根日线的均线）
- 如果 `Close > MA200`（价格在长期均线之上），认为“长期趋势偏上”→ 允许 RSI 超卖买入
- 如果 `Close <= MA200`，认为“长期趋势偏弱/向下”→ 禁止超卖买入（只能 HOLD/REDUCE）

这非常像“只在牛市抄回调”，避免熊市接飞刀。

##### 3.2.4-2 用慢均线斜率：slowMA slope > 0
规则示例：
- 先算 `slowMA`（例如 60 或 120）
- 再算 `slowMA` 的斜率（例如最近 N 根 slowMA 是否在上升）
- 斜率 > 0 才允许 RSI 超卖买入

它比 MA200 更“动态”，有时能更快识别趋势转向，但参数会多一点（slow 窗口 + slope 窗口）。

#### 3.2.5 结合“持仓状态”的投顾动作（你 Day3 想要的）
趋势过滤加入后，RSI 的动作更像投顾：
- **未持仓**：
  - `trendUp=true` 且 `RSI < lower` → `BUY`
  - 其他 → `HOLD`
- **已持仓**：
  - `trendUp=false`（趋势转弱）→ 至少 `REDUCE`（甚至 `SELL`，取决于你希望多激进）
  - `trendUp=true` 且 `RSI > upper` → `REDUCE` / `TAKE_PROFIT`（实现上可映射成 `REDUCE`）
  - `trendUp=true` 且 `RSI < lower` → `INCREASE`（可选，需风险约束）

> 这也是为什么你提出“未持仓只 BUY/HOLD；已持仓才 INCREASE/REDUCE/SELL”很合理：它符合现实投顾语义。

---

#### 3.2.6 为什么要做 RSI 趋势过滤？有没有必要？
如果你只想要一个“能跑”的 RSI demo，过滤不是必须；但如果你希望 RSI 在你的投顾系统里“更少误导”，趋势过滤很有必要：
- **把最常见的失败模式堵住**：熊市/下跌趋势里反复超卖，RSI 会持续诱导买入
- **让建议更符合直觉**：投顾通常不会建议在长期下跌趋势里不断加仓抄底，除非有更强的基本面理由
- **更容易与 LLM 对齐**：LLM 可以把 `trendUp=false` 当作清晰的“不可买条件”，输出更稳定

结论：你 Day3 的 RSI 趋势过滤是“低成本高收益”的改进，尤其适合你这个“建议系统”。

---

## 4) 代码对照：我们是怎么把规则跑起来的

### 4.1 将 MarketCache bars 转成回测 DataFrame
在 `backend/app/quant/engine.py::_bars_to_df()`：
- 输入：`bars`（每根含 `o/h/l/c/v` 和时间）
- 输出：`pandas.DataFrame`，列名是 backtesting 需要的 `Open/High/Low/Close/Volume`，index 是时间

```py
records.append(
  {
    "time": datetime.fromtimestamp(ts, tz=timezone.utc),
    "Open": float(bar.get("o", 0.0)),
    "High": float(bar.get("h", 0.0)),
    "Low": float(bar.get("l", 0.0)),
    "Close": float(bar.get("c", 0.0)),
    "Volume": float(bar.get("v", 0.0)) if bar.get("v") is not None else 0.0,
  }
)
df = pd.DataFrame(records).sort_values("time").set_index("time")
```

### 4.2 用 backtesting.py 运行回测
在 `backend/app/quant/engine.py::_run_strategy_on_bars()`（MA 分支）：

```py
bt = Backtest(
    df,
    MaCrossoverStrategy,
    cash=initial_cash,
    commission=fee_rate,
    exclusive_orders=True,
)
stats = bt.run(fast=fast, slow=slow)
```

这里你需要理解几个点：
- `MaCrossoverStrategy` 是你自己写的规则（见下一节）
- `cash=initial_cash` 是起始资金
- `commission=fee_rate` 是手续费（每次交易按比例扣）
- `exclusive_orders=True` 表示订单互斥：避免同一时刻同时持有多方向/多笔订单（更符合“简单策略”直觉）

### 4.3 MA Crossover 策略本身怎么写（真正的买卖逻辑）
在 `backend/app/quant/strategies/ma_crossover.py`：

```py
class MaCrossoverStrategy(Strategy):
    fast: int = 10
    slow: int = 30

    def init(self) -> None:
        close = self.data.Close
        self.fast_ma = self.I(SMA, close, self.fast)
        self.slow_ma = self.I(SMA, close, self.slow)

    def next(self) -> None:
        if crossover(self.fast_ma, self.slow_ma):
            if not self.position:
                self.buy()
        elif crossover(self.slow_ma, self.fast_ma):
            if self.position:
                self.position.close()
```

逐句解释：
- `init()`：在回测开始前把指标算出来（快/慢均线）
- `next()`：每来一根新 bar 就执行一次：
  - 如果检测到“快线上穿慢线”，并且当前没持仓 → `buy()`
  - 如果检测到“慢线上穿快线”（即快线下穿慢线），并且当前有持仓 → `position.close()`

这就把“规则”变成了可执行的买卖操作。

### 4.4 为什么还要单独返回一个 `signal`？
回测 `stats` 主要回答：“过去这段时间按规则做，表现怎样？”

但 UI 还需要一个“此刻建议动作”：
- 所以代码额外用 `_ma_signal(df, fast, slow)` 在**最后一根 bar**做判断，返回 `BUY/SELL/HOLD`

```py
def _ma_signal(df: pd.DataFrame, fast: int, slow: int) -> Action:
    fast_ma = df["Close"].rolling(fast, min_periods=fast).mean()
    slow_ma = df["Close"].rolling(slow, min_periods=slow).mean()
    if fast_ma.iloc[-1] > slow_ma.iloc[-1]:
        return "BUY"
    if fast_ma.iloc[-1] < slow_ma.iloc[-1]:
        return "SELL"
    return "HOLD"
```

重要：这里的 `BUY/SELL/HOLD` 更像“当前倾向的方向信号”，不是“刚刚发生了一笔交易”。
- 例如快线一直在慢线上方，你每次查看都会显示 `BUY`，但并不代表今天又买了一次。

### 4.5 RSI Reversal 的回测与策略代码（实际怎么调用）
当你在 UI 里选择 `RSI Reversal` 时，后端会走 `backend/app/quant/engine.py::_run_strategy_on_bars()` 里的 RSI 分支（核心逻辑如下）：

```py
bt = Backtest(
    df,
    RsiReversalStrategy,
    cash=initial_cash,
    commission=fee_rate,
    exclusive_orders=True,
)
stats = bt.run(length=length, lower=lower, upper=upper)
```

这里的 `RsiReversalStrategy` 就是你们写的策略类：`backend/app/quant/strategies/rsi_reversal.py`（原样摘录）：

```py
class RsiReversalStrategy(Strategy):
    length: int = 14
    lower: float = 30
    upper: float = 70

    def init(self) -> None:
        close = self.data.Close
        self.rsi = self.I(lambda s, l: compute_rsi_series(pd.Series(s), l), close, self.length)

    def next(self) -> None:
        latest_rsi = self.rsi[-1]
        if not self.position and latest_rsi < self.lower:
            self.buy()
        elif self.position and latest_rsi > self.upper:
            self.position.close()
```

逐句解释：
- `init()`：把 RSI 这条指标序列算出来（`self.I(_rsi, ...)`）
- `next()`：每根新 bar 都检查最新 RSI：
  - 没仓位且 RSI 太低 → 买入
  - 有仓位且 RSI 太高 → 平仓

### 4.6 RSI 的 `signal` 是怎么计算的（用于 UI 的 BUY/SELL/HOLD）
和 MA 一样，后端会额外算一个“当前信号”，逻辑在 `backend/app/quant/engine.py::_rsi_signal()`：
- 最新 RSI < lower → `BUY`
- 最新 RSI > upper → `SELL`
- 否则 `HOLD`
 
目前你们已经把 RSI 口径统一了：回测与 signal 都复用 `compute_rsi_series()`。

---

## 5) 返回结果里的每个字段是什么意思（看懂你截图里的结果）

后端响应结构由 `backend/app/quant/schema.py::BacktestResponse` 定义，核心字段如下：

### 5.1 `timeframe`
本次回测实际使用的 timeframe（例如 `6M_1d`）。

### 5.2 `strategy`
回传你用的策略名和参数（用于“可复现”与 UI 展示）。

### 5.3 `assumptions`
回测假设（你可以理解为“这次回测是怎么跑的”）：
- `feesBps`：手续费 bps
- `slippageBps`：滑点 bps（目前未计入）
- `longOnly`：是否只做多（当前 true）
- `mode`：`independent`/`portfolio`（当前 independent）
- `initialCash`：初始资金

### 5.4 `results[ticker].signal`
当前信号（建议动作）：
- `action`：`BUY`/`SELL`/`HOLD`（由最新一根 bar 的指标判断）
- `asOf`：最新一根 bar 的时间（“信号基于哪个时点”）

### 5.5 `results[ticker].metrics`
历史表现指标（来自 backtesting 的统计结果）：
- `totalReturn`：总收益率（例如 0.12 表示 +12%）
- `maxDrawdown`：最大回撤比例（例如 0.2833 表示 28.33%）
- `tradeCount`：交易次数（通常是已平仓交易的数量）
- `winRate`：胜率（盈利交易/总交易）
- `avgHoldBars`：平均持仓 bar 数（“平均持有多少根K线”）

### 5.6 `results[ticker].equityCurve`（如果打开 includeEquityCurve）
权益曲线点列：
- `t`：时间戳（秒）
- `equity`：该时刻的权益值（单位是“货币金额”，基于 initialCash 和成交/手续费）

---

## 6) 一个现实的“读数”示例：为什么会出现 “BUY 但 Total Return 为负”

你截图里出现了类似：
- signal 是 `BUY`
- 但 `Total Return` 可能是负数（策略在 6 个月窗口里亏钱）

这完全可能发生，原因是：
- signal 只看“现在快线在慢线上方”→ 趋势条件满足 → `BUY`
- 但在历史窗口里，这个策略可能经历过几次“假突破/震荡”，总体收益为负

所以你可以把这两个东西分开理解：
- `signal`：今天此刻的“规则判断”
- `metrics`：过去这段时间“这套规则的历史表现”

---

## 7) 你下一步最值得问的三个问题（真正把 Quant 用起来）

1) **这套规则在不同 timeframe 的表现是否一致？**（比如 `6M_1d` vs `10D_1h`）  
2) **手续费从 0 bps 调到 10 bps 之后，收益/交易次数变化多大？**（量化“频繁交易是否值得”）  
3) **fast/slow 换一组参数后，tradeCount 和 maxDrawdown 如何变化？**（更激进 vs 更稳健）  

如果你希望我在 `quant.md` 里再加一个“按你截图数据做一段手算示例”（例如解释第一个金叉触发点、为什么那天会 buy），我需要你把 `4568.T` 的那段 bars（至少 close 序列/时间）贴出来或让我读取对应的 `var/market_cache/6M_1d/4568.T.json`。  
