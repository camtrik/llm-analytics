# 阴线回调买入法（规则量化 / 可配置参数草案）

目标：把 `strategy_note.md` 的三种“可买阴线”形态，量化成可配置、可回测、可复现的规则（本文件只定义信号口径，不构成投资建议）。

---

## 0) 数据与符号约定

### 输入数据（OHLCV Bar）

每根 K 线为：
- `o`: open（开盘价）
- `h`: high（最高价）
- `l`: low（最低价）
- `c`: close（收盘价）
- `v`: volume（成交量）

说明：
- 下文用 `t` 表示“当前（信号）bar”，`t-1` 表示上一根 bar。
- 所有“百分比”参数都用小数表示：`0.05 = 5%`。

### 派生指标（统一计算口径）

- 均线（可配置 `ma_type`）：
  - `MA(n)[t] = mean(c[t-n+1 .. t])`
- 成交量均值（**默认不包含当前 bar，避免把当日放量/缩量掺进基准**）：
  - `VOL_AVG(N)[t] = mean(v[t-N .. t-1])`
  - `VOL_RATIO[t] = v[t] / VOL_AVG(N)[t]`（若分母为 0 则视为不可用）
  - **健壮性**：若 `v` 缺失或全为 0，`VOL_AVG` 记为 NaN，并将依赖 `VOL_RATIO` 的规则视为“不触发”以避免错误放行；可选地忽略 0 量 bar 来求均值。
- K 线形态度量：
  - `RANGE[t] = max(h[t] - l[t], eps)`
  - `BODY[t] = abs(c[t] - o[t])`
  - `BODY_PCT[t] = BODY[t] / max(o[t], eps)`
    - BODY[t] = abs(c[t] - o[t])：实体长度（开盘到收盘的绝对价差）
    - BODY_PCT[t] = BODY[t] / max(o[t], eps)：把实体长度除以开盘价，变成无量纲比例
    - max(o[t], eps) 的目的： 避免 o[t]=0（或异常值）导致除以 0， eps 是很小的数（如 1e-12），只用于兜底
  - `CLOSE_NEAR_HIGH_RATIO[t] = (h[t] - c[t]) / RANGE[t]`
    - 越接近 0 表示收盘越靠近最高价；例如 `<= 0.2` 表示收在当天振幅的顶部 20% 区间。

---

## 1) 配置结构（建议）

下面是建议的配置结构（YAML 仅作示例，最终可落到 JSON / Pydantic）：

```yaml
version: v0
timeframe: "6M_1d"

common:
  ma_type: "SMA"                # SMA | EMA
  vol_avg_window: 5             # VOL_AVG 的窗口
  eps: 1e-12

  candle:
    require_bearish: true       # 是否要求 c < o
    min_body_pct: 0.002         # 过滤十字星/噪声（0.2%）
    min_range_pct: 0.005        # 可选：要求振幅足够（0.5%）

  trend:
    fast_ma: 5                  # 5 日
    slow_ma: 10                 # 10 日
    long_ma: 60                 # 60 日（趋势锚）
    require_close_above_fast_slow: true   # c[t] > MA(fast/slow)
    require_ma_order: true      # MA(fast)[t] > MA(slow)[t]
    require_long_ma_up: true    # 60MA 向上
    long_ma_slope_window: 3     # 用 MA(long)[t] 与 MA(long)[t-3] 比较
    long_ma_slope_min_pct: 0.0  # 允许的最小斜率（0=只要不下降）

  liquidity:
    enabled: false
    turnover_window: 20         # 近 20 根 bar 平均成交额
    min_avg_turnover: 1e8       # 成交额门槛（按 close*volume 估算；币种与标的相关）

rules:
  low_volume_pullback:
    enabled: true
    vol_ratio_max: 0.5          # VOL_RATIO[t] <= 0.5

  ma_pullback:
    enabled: true
    support_ma_list: [5, 10, 20, 60]
    touch_tol_pct: 0.003        # “回踩到均线附近”容忍度（0.3%）
    close_below_tol_pct: 0.001  # “不算跌穿”的收盘容忍（可允许略微收在均线下）
    vol_ratio_max: 0.8          # 回踩时缩量阈值（通常比 0.5 稍宽）

  high_volume_fake_red:
    enabled: true
    vol_expand_vs_prev_min: 1.5 # v[t] >= v[t-1] * 1.5
    open_gap_min_pct: 0.0       # o[t] >= c[t-1]*(1+gap)
    close_vs_prev_min_pct: 0.0  # c[t] >= c[t-1]*(1+min)；默认要求收盘仍高于昨收
    intraday_spike_min_pct: 0.01  # h[t] >= o[t]*(1+spike) 表示“盘中冲高”
    close_near_high_ratio_max: 0.2 # 收盘靠近最高价

risk:                           # 先量化参数，执行层可后续接入
  entry_execution: "next_open"  # close 信号，下一根开盘成交（避免同 bar 前视）
  stop_loss_pct: 0.05           # 5% 固定止损（也可替换为 swing_low）
  take_profit_levels: [0.10, 0.15] # 分批止盈阈值（10%、15%）
  max_position_weight: 0.5
  entry_tranches: [0.3, 0.2]    # 先 30%，再 20%
  add_on_drawdown_pct: 0.05     # 追加仓位触发：相对首次入场价回撤 5%
```

---

## 2) 通用过滤条件（所有规则共享）

### 2.1 K 线有效性（用于减少噪声）

建议默认：
- `require_bearish = true`：仅在 `c[t] < o[t]` 时认为是“阴线”；
- `min_body_pct`：过滤 “几乎不动”的假阴线/十字星；
- `min_range_pct`：可选，过滤极窄波动导致的形态误判。

### 2.2 上涨趋势（趋势为王）

把“上涨趋势”拆成可配置子条件（建议都开）：
- `c[t] > MA(fast)[t]` 且 `c[t] > MA(slow)[t]`（价格站上 5/10 日）
- `MA(fast)[t] > MA(slow)[t]`（均线多头排列）
- `MA(long)[t] > MA(long)[t - long_ma_slope_window] * (1 + long_ma_slope_min_pct)`（长均线向上）
- **样本长度提示**：在较短时间粒度（如 15 分钟）也能计算 60 根均线，但那只覆盖约 15 小时行情，并非“60 日”；若可用 bar 数小于最大均线窗口（`max(support_ma_list + [long_ma]) + 1`），应直接跳过信号或标记数据不足。

说明：
- 用 `long_ma_slope_window` 做一个简单“抬升”判定，避免只看 `MA(long)[t] > MA(long)[t-1]` 太敏感。
- 这部分是最关键的过滤器：不满足趋势条件时，三种阴线都不触发买入信号。

### 2.3 流动性（可选）

原文“成交量太小别碰”可以用“成交额”近似：
- `turnover[t] = c[t] * v[t]`
- `mean(turnover[t-window .. t-1]) >= min_avg_turnover`

说明：
- 不同市场/标的币种不同，`min_avg_turnover` 需要按你的交易标的重新标定。
- 若数据源没有可靠成交量或有缺失，建议关闭该过滤器。

---

## 3) 三条规则（形态量化）
总结：
回调能买的三种阴线
- 缩量回调阴线：上涨趋势中突然某一天收了一条阴线
  - 股票在上涨趋势中，股价在5日，10日均线上面
  - 成交量必须缩小，最好能缩小到前面5天平均成交量的一半一下
- 回踩均线阴线：股票跌到像5日，10日，20日或者60日这些重要的均线附近，然后收出一条阴线
  - 均线本身必须是向上走的
  - 股价回调到均线附近时，不能彻底跌穿
  - 回调时成交量要缩小，说明卖的人不多，力量不强
- 放量假阴线：股票当天开盘价比昨天高，盘中还冲高了一波，但是后来又被压下来，收盘价比昨天略低，但是成交量放大了很多
  - 股票必须在上涨趋势中
  - 当天到开盘价要高于昨天的收盘价，而且收盘价要接近当天的最高价
  - 成交量要明显放大，至少是前一天成交量的1.5倍以上


### 3.1 规则 1：缩量回调阴线（Low-Volume Pullback）

触发条件（建议口径）：
- 信号日（per-bar hit[t]）：
  - 满足“上涨趋势”：`c[t] > MA(fast)[t] && c[t] > MA(slow)[t] && MA(fast)[t] > MA(slow)[t]`
  - 阴线：`c[t] < o[t]`，且 `BODY_PCT[t] >= min_body_pct`
  - 缩量：`VOL_RATIO[t]=v[t]/VOL_AVG <= vol_ratio_max`（默认 `0.5`）
- 筛选口径（窗口）：最近 `recentBars` 日内，存在任意一天满足 `hit[t]=True` 即触发（并返回这些命中日期）。

说明：
- `vol_avg_window=5` 对应原文“前 5 天平均量”；默认用 `t-5 .. t-1` 作为基准（不含当日）。
- `vol_ratio_max` 越小越严格（更“缩量”），但信号更少。

其他实现要点：
- `recentBars` 是窗口参数（不属于策略参数）：用于 UI/调用方决定“最近 N 天是否出现过信号日”。

### 3.2 规则 2：回踩均线阴线（MA Pullback）

触发条件（建议口径）：
- 满足“上涨趋势”
- 阴线：`c[t] < o[t]` 且 `BODY_PCT[t] >= min_body_pct`
- 存在一条支撑均线 `m ∈ support_ma_list`，满足：
  - “触碰/接近”：`l[t] <= MA(m)[t] * (1 + touch_tol_pct)`
  - “不算跌穿”：`c[t] >= MA(m)[t] * (1 - close_below_tol_pct)`
- 回踩缩量：`VOL_RATIO[t] <= vol_ratio_max`（默认 `0.8`）

说明：
- `touch_tol_pct` 用来量化“均线附近”，默认 0.3%（日线可更大一点，小时线可更小）。
- `close_below_tol_pct` 用来量化“盘中可破、收盘收回”的容忍度；默认 0.1%。
- `support_ma_list` 默认 `[5,10,20,60]`，也可以只保留 `[10,20,60]` 来减少噪声。

### 3.3 规则 3：放量假阴线（High-Volume Fake Red Candle）

这条在原文存在口径冲突：
- 一处说“收盘价比昨天略低”（`c[t] < c[t-1]`）
- 另一处说“开盘价和收盘价都比前一天高”（`o[t] > c[t-1]` 且 `c[t] > c[t-1]`），更符合“假阴线=看似跌、实则上涨”的定义

因此建议把“相对昨收的强弱”做成可配参数：`close_vs_prev_min_pct`。

触发条件（默认口径，更贴近“假阴线”）：
- 满足“上涨趋势”
- 阴线：`c[t] < o[t]` 且 `BODY_PCT[t] >= min_body_pct`
- 高开：`o[t] >= c[t-1] * (1 + open_gap_min_pct)`
- 收盘仍强（默认要求）：`c[t] >= c[t-1] * (1 + close_vs_prev_min_pct)`（默认 `0.0`）
  - 若你坚持“略低于昨收”的口径，可把 `close_vs_prev_min_pct` 设为负值，例如 `-0.005`（允许低 0.5%）
- 盘中冲高：`h[t] >= o[t] * (1 + intraday_spike_min_pct)`
- 收盘接近最高：`CLOSE_NEAR_HIGH_RATIO[t] <= close_near_high_ratio_max`
- 放量：`v[t] >= v[t-1] * vol_expand_vs_prev_min`（默认 `1.5`）

说明：
- “收盘接近最高”是为了避免那种“冲高回落、收在低位”的真派发阴线。
- 放量阈值可以用 “相对昨量” 或 “相对均量（VOL_RATIO）”；本文先给出相对昨量，便于直观理解。

---

## 4) 风控与执行参数（先量化，执行层后接）

这些不是“三条形态”本身，但属于策略闭环，建议也参数化：
- 进场成交价：`entry_execution = next_open`（避免同 bar 交易的前视偏差）
- 固定止损：`stop_loss_pct = 0.05`（5%）；或替换为“跌破信号 bar 低点 + buffer”
- 分批止盈：`take_profit_levels = [0.10, 0.15]`
- 分批建仓：`entry_tranches = [0.3, 0.2]` + `add_on_drawdown_pct = 0.05`，并限制 `max_position_weight = 0.5`

说明：
- “分批”更像组合/资金管理逻辑；如果只是做单标的回测，可先用“全仓进出”版本验证形态有效性，再升级到分批。

---

## 5) 落地到项目（对齐现有数据流）

若后续要在本项目实现：
- 数据来自 `MarketCache` 的 bars（字段就是 `o/h/l/c/v`）
- 均线、量比、形态全部可在 `backend/app/quant/engine.py` 的 `_bars_to_df` 后用 pandas 计算
- 建议优先把 “3 条规则的触发布尔值 + 关键中间量（MA、VOL_RATIO、CLOSE_NEAR_HIGH_RATIO）” 做成结构化输出，方便 UI 展示与调参



## 6) 回测

目标：做一个“事件回测 / 信号有效性检查”的工具：用户选一个 `as_of` 日期（或时间戳），用 **该日期及之前** 的 OHLCV 生成“缩量回调阴线”的买入候选，然后展示这些候选在 **之后 1～5 个交易日（bar）** 的走势/收益，用于判断该方法在历史上的短期有效性。

> 说明：你原话里写了“找出应该卖出的股票”，但这里按“买入法”理解为筛选 **应买入** 的候选；如果确实要反向做“应卖出”，可以在请求里加一个 `signalSide=BUY|SELL` 或单独定义卖出规则再扩展。

### 6.1 用户体验（预期行为）

- 用户在前端选择：
  - `timeframe`（优先先做 `6M_1d`，因为 1～5 天的走势语义更清晰）
  - `asOfDate`（日期）或 `asOfTs`（Unix 秒）
  - `horizonBars`（默认 5，表示取后续 1～5 根 bar）
  - 可选：是否只回测“命中标的”（默认 yes），以及筛选参数（`volRatioMax/minBodyPct/...`）
- 后端返回：
  - 在 `asOf` 时点命中的 ticker 列表（以及每个 ticker 的命中 bar、volRatio/bodyPct 等）
  - 每个命中 ticker 在 `asOf` 之后 1～5 根 bar 的 **价格路径** 与 **收益序列**（例如 close-to-close）
  - 汇总统计（例如：D+1/D+2/... 正收益占比、均值/中位数、最大/最小）
 
口径澄清（避免混淆）：
- `asOfDate/asOfTs` 是 **信号计算的截止时点**：只能使用 `asOf` 及之前的数据来判断是否命中（避免前视）。
- 若命中发生在 `asOf` 之前（例如 `asOf=2026-01-08`，命中阴线是 `2026-01-06`），则 forward 走势应从 **信号日的下一根 bar** 开始（即从 `2026-01-07` 起算 D+1..D+5），而不是从 `asOf` 次日开始。

### 6.2 API 设计（建议）

新增一个 API（和现有 screener 同一组路由下）：

- `POST /api/strategy/low_volume_pullback/backtest`

请求体（建议新增 Pydantic models，复用 `LowVolumePullbackParamsModel`）：

```json
{
  "timeframe": "6M_1d",
  "asOfDate": "2026-01-10",
  "asOfTs": null,
  "tickers": null,
  "onlyTriggered": true,
  "recentBars": 3,
  "horizonBars": 5,
  "entryExecution": "close",
  "params": {
    "fastMA": 5,
    "slowMA": 10,
    "longMA": 60,
    "longMaSlopeWindow": 3,
    "longMaSlopeMinPct": 0.0,
    "volAvgWindow": 5,
    "volRatioMax": 0.5,
    "minBodyPct": 0.002,
    "minRangePct": null,
    "eps": 1e-12
  }
}
```

说明：
- `asOfDate` 与 `asOfTs` 二选一；推荐前端用 `asOfDate`（input date）更直观。
- `entryExecution` 建议支持：
  - `"close"`：以信号日收盘价当作入场基准价（更简单）
  - `"next_open"`：以信号日后下一根 bar 的开盘价作为入场价（更贴近“信号在 close 出现”的无前视执行）

响应体（示例字段，具体可按 UI 需要裁剪）：

```json
{
  "timeframe": "6M_1d",
  "asOfTs": 1768003200,
  "horizonBars": 5,
  "params": { "...": "同请求" },
  "summary": {
    "universeSize": 225,
    "triggeredCount": 12,
    "avgReturnByDay": { "1": 0.004, "2": 0.006, "3": 0.005, "4": 0.007, "5": 0.009 },
    "winRateByDay": { "1": 0.58, "2": 0.62, "3": 0.54, "4": 0.60, "5": 0.66 }
  },
  "results": [
    {
      "symbol": "7011.T",
      "name": "三菱重工業",
      "signal": {
        "barIndex": 110,
        "asOfTs": 1768003200,
        "entryPrice": 1234.0,
        "volRatio": 0.42,
        "bodyPct": 0.006
      },
      "forward": [
        { "day": 1, "ts": 1768089600, "close": 1241.0, "return": 0.0057 },
        { "day": 2, "ts": 1768176000, "close": 1229.0, "return": -0.0041 }
      ]
    }
  ]
}
```

### 6.3 后端实现路径（对齐当前代码结构）

现有代码可复用点：
- 数据：`MarketCache.get_bars()` / `get_bars_batch()`（`backend/app/data/market_cache.py`）
- Bar→DataFrame：`app.quant.engine._bars_to_df`（当前已在 `backend/app/strategy/low_volume_pullback.py` 里复用）
- 参数模型：`backend/app/strategy/schema.py::LowVolumePullbackParamsModel`
- 现有筛选入口：`backend/app/strategy/service.py::low_volume_pullback`

建议新增/改造点：
1) **让检测逻辑支持“指定 as-of” + 窗口扫描**（避免只检测最后一根 bar）
   - 本策略当前采用 per-bar `hit[t]` 定义（趋势 + 阴线 + 缩量），并提供窗口扫描 helper：
     - `_compute_low_volume_pullback_series(df, params) -> hit/vol_ratio/body_pct`
     - `detect_low_volume_pullback_hits(df, params, end_idx, recent_bars)`：在 `[end_idx-recentBars+1..end_idx]` 内收集命中日
   - “screener” 与 “backtest” 复用同一套 `hit` 口径，避免漂移。

2) **新增一个回测 service 方法**
   - `backend/app/strategy/service.py` 新增 `low_volume_pullback_backtest(payload)`：
     - 复用你希望的 ticker 逻辑：默认日经225；若传了 tickers 则并集加入（与现有一致）。
     - 获取每个 ticker 的完整 df（至少覆盖 `asOf` 之前的 max_window，以及 `asOf` 之后 `horizonBars` 根）。
     - 找到 `asOf` 对应的 `end_idx`（见下节 6.4）。
     - 计算信号是否触发；若触发则计算 forward 路径并收集。
     - 生成汇总统计。

3) **新增 API 路由**
   - 在 `backend/app/api/strategy.py` 增加 `@router.post("/strategy/low_volume_pullback/backtest")`
   - `backend/app/api/router.py` 已 include strategy router，无需额外改动。

### 6.4 核心算法（如何找 as-of + 如何算 forward 1～5 天）

#### 6.4.1 把 as-of 日期映射到 bar index（关键）

推荐实现一个 helper（伪代码）：

- 输入：df（index=UTC datetime），`asOfDate` 或 `asOfTs`
- 输出：`end_idx`（满足 “只用 as-of 及之前数据”）

规则建议：
- 若传 `asOfTs`：找 `df.index <= asOfTs` 的最后一根 bar（`searchsorted` / `iloc`）
- 若传 `asOfDate`（YYYY-MM-DD）：
  - 将 df.index 转成 date（UTC）后，找 `date <= asOfDate` 的最后一根 bar
  - 这样可避免日线数据 timestamp 在 00:00:00 UTC 造成的边界困惑

如果找不到（日期早于第一根 bar），返回 `insufficient_bars`。

#### 6.4.2 信号计算（复用现有规则）

对每个 ticker：
- 先计算 per-bar `hit[t]`（趋势 + 阴线 + 缩量）；
- 用 `recentBars` 在窗口 `[end_idx - recentBars + 1 .. end_idx]` 内寻找“最近一次命中”的 `signal_idx`：
  - **回测默认使用最近一次命中**作为入场基准（更不易混淆）。
  - 同时可把窗口内 `hits` 全部返回给前端用于解释“近 N 天哪些日子也满足过”。

#### 6.4.3 forward 走势与收益

定义入场价格（由 `entryExecution` 控制）：
- `"close"`：`entry_price = close[signal_idx]`
- `"next_open"`：`entry_price = open[signal_idx + 1]`（若未来不存在则该 ticker 标注 `no_forward_bars`）

forward bars：
- 取 `signal_idx + 1 .. signal_idx + horizonBars` 的 bar（按 “交易日/可用 bar” 计数，不按自然日）
  - 其中 `signal_idx` 指的是 lookback 内用于入场的那根命中阴线（默认 hits[0]），因此 forward 的 D+1 是 **命中阴线的下一根 bar**。
- 对每个 forward bar 计算：
  - `return_k = close[signal_idx + k] / entry_price - 1`

同时可以返回归一化路径（便于前端画线叠加）：
- `normalized_close_k = close / entry_price`

### 6.5 前端展示（建议最低可用版本）

在 `frontend/app/display/page.tsx` 的 Low-Volume Pullback 区块下方新增 “Backtest” 子区块：
- 输入：
  - `asOfDate`（date picker）
  - `horizonBars`（1～20，默认 5）
  - `entryExecution`（close / next_open）
- 输出：
  - 表格：ticker、命中日期、volRatio、bodyPct、D+1..D+5 收益
  - 可选 mini chart：对命中 tickers 画 `normalized_close` 折线（同一坐标系）

### 6.6 校验与测试（建议）

- 单元测试（后端）：
  - 给一段构造的 df（或固定 fixture）验证：
    - as-of 定位到正确 bar
    - `vol_avg` 不包含当日（与你的量化口径一致）
    - `recentBars` 窗口能向前找到最近一次命中
    - forward returns 计算正确
- 端到端（手工）：
  - 选一个 `asOfDate`，确认返回的每个 ticker 的 `signal.asOfTs` ≤ `asOfDate` 对应日期
  - 随机抽样 1～2 个 ticker，对照图表/数据确认 D+1..D+5 的 close 与回测输出一致

### 6.7 性能与缓存（可选优化）

现状注意点：
- 你的 `MarketCache.refresh()` 会为每个 ticker 下载所有 timeframes，并要求每个 timeframe 都有数据才算成功；回测若大量触发刷新会变慢且失败率上升。

建议三条改进方向（可分阶段做）：
1) 回测 API 默认 **不自动 refresh**，遇到 cache_not_ready 直接提示用户先 `/api/refresh` 或前端先做“预加载”；
2) 前端提供一个“预加载日经225 6M_1d”的按钮：一次性把回测所需 universe 的数据拉到本地，回测仅在缓存时间范围内工作（可要求 `asOf` 落在 `minTs..maxTs` 且未来至少有 1～horizonBars 根 bar 可用）；
3) 若需要自动补数据，优先给 `MarketCache` 增加一个 “只刷新指定 timeframe” 的方法（避免下载所有周期，降低耗时与失败率）。

### 6.8 里程碑（最小可交付）

1) 后端：加 backtest 请求/响应 schema + service + API route（仅支持 `6M_1d` + close entry）
2) 后端：支持 `entryExecution=next_open` + 汇总统计
3) 前端：加日期选择 + 表格展示 D+1..D+5 收益
4) 前端：加归一化走势折线图（可选）

---

## 6.9 区间胜率与分桶统计（startDate ~ endDate）

需求：在现有“单日 asOf 回测”的基础上，新增一个“区间统计模块”，用户输入 `startDate`、`endDate` 与 `horizonBars`，直接给出该区间内所有信号样本的整体胜率，并按收益幅度分桶统计比例。

### 6.9.1 统计口径（先定清楚）

1) 样本（event）的定义（建议默认）：
- 对每个 ticker，在区间内每一个可用 bar 作为 `asOf` 候选；
- 用该 `asOf` 当天做一次 per-bar hit 检测（趋势 + 阴线 + 缩量）；
- 若 `hit[asOf]=True`，则记为一个样本（`symbol + asOf_bar_index`）。

说明（与 6.10.1 重构一致）：
- 本策略已移除 `lookbackBars`（策略参数），区间统计口径固定为“只认当天是否 hit”（等价旧实现的 `lookbackBars=1`）。

2) “总胜率”的定义（建议两种都支持，默认 A）：
- A（默认）：用 `D+horizonBars` 的收益 `return_h`，定义 `return_h > 0` 为胜；
- B：对每个 `D+1..D+horizonBars` 都计算 winRateByDay，并在 UI 默认展示 `D+horizonBars` 作为“总胜率”。

3) 分桶统计（你提出的四档，按每个 `D+k` 分别统计，k=1..horizonBars）：
- `down_gt_5`: `return <= -0.05`
- `down_0_5`: `-0.05 < return < 0`
- `up_0_5`: `0 <= return <= 0.05`
- `up_gt_5`: `return > 0.05`

说明：
- 边界建议固定为上面这样（0 归到 “up_0_5”），避免口径不一致。
- 若 forward bars 不足：按 day 维度分别计数（哪一天没数据就不计入那一天的分母），并且 **需要在 summary 返回每个 day 的分母/样本数**，前端才能提示 “D+5 只有 N 条有效样本（endDate 附近不足）”。

### 6.9.2 API 设计（建议新增）

新增一个 endpoint（不要复用单日 backtest，避免 response 过大）：
- `POST /api/strategy/low_volume_pullback/backtest/range`

请求体建议：
```json
{
  "timeframe": "6M_1d",
  "startDate": "2026-01-01",
  "endDate": "2026-03-31",
  "tickers": null,
  "horizonBars": 5,
  "entryExecution": "close",
  "params": { "volRatioMax": 0.5, "minBodyPct": 0.002 }
}
```

响应体建议（只返回统计 + 少量样本信息，避免爆炸）：
```json
{
  "timeframe": "6M_1d",
  "startTs": 1764614400,
  "endTs": 1772323199,
  "horizonBars": 5,
  "entryExecution": "close",
  "params": { "...": "最终合并后的参数" },
  "summary": {
    "universeSize": 225,
    "evaluatedBars": 20000,
    "triggeredEvents": 1200,
    "sampleCountByDay": { "1": 1200, "2": 1188, "3": 1175, "4": 1160, "5": 1142 },
    "winRateByDay": { "1": 0.53, "2": 0.55, "3": 0.54, "4": 0.56, "5": 0.57 },
    "bucketRateByDay": {
      "1": { "down_gt_5": 0.02, "down_0_5": 0.45, "up_0_5": 0.49, "up_gt_5": 0.04 },
      "5": { "down_gt_5": 0.06, "down_0_5": 0.37, "up_0_5": 0.46, "up_gt_5": 0.11 }
    }
  }
}
```

### 6.9.3 后端实现计划（对齐现有代码）

1) Schema 增量（`backend/app/strategy/schema.py`）
- 新增 `LowVolumePullbackBacktestRangeRequest/Response/Summary/BucketRate` 等模型；
- Bucket 字段用固定键名（`down_gt_5`/`down_0_5`/`up_0_5`/`up_gt_5`），避免前端 hardcode 出错。
- Summary 增加 `sampleCountByDay`（每个 D+k 的分母）用于提示 forward 不足。

2) Service 增量（`backend/app/strategy/service.py`）
- 新增 `low_volume_pullback_backtest_range(payload)`：
  - 解析 `startDate/endDate` -> `[start_dt, end_dt]`（UTC，end 用 23:59:59）
  - 复用 universe 解析与参数合并逻辑（`_default_tickers/_resolve_params_from_config`）
  - 复用 cache 读取（建议默认 `autoRefreshIfMissing=false`，避免区间统计触发大量下载）
  - 遍历 tickers 做聚合统计。

3) 核心计算函数（建议放 `backend/app/strategy/low_volume_pullback.py`，可单测）
- 目标：避免对每个 asOf 重复计算 rolling MA（否则区间统计会非常慢）。
- 建议实现一个“预计算一次指标，然后在 index 上滑动”的函数：
  - 预先计算 `fast_ma/slow_ma/long_ma/vol_avg/body_pct/...` 以及 `hit[idx]` 布尔序列；
  - 在 `[start_idx..end_idx]` 区间内逐 idx 判断 `hit[idx]`（当天是否命中）；
  - 若命中，计算 forward returns（`entryExecution`）并更新：
    - `winRateByDay[k]` 计数（ret>0）
    - `bucketRateByDay[k]` 四桶计数
  - 最后统一除以分母得到比例。

4) API 路由（`backend/app/api/strategy.py`）
- 增加 `@router.post("/strategy/low_volume_pullback/backtest/range")`，返回 range summary。

5) 配置（可选，`backend/app/config/strategy.yaml`）
- 增加 `low_volume_pullback.rangeBacktest` 默认项：
  - `autoRefreshIfMissing`、`horizonBars`、`entryExecution`、`bucketThresholdPct: 0.05` 等
  - （可选）`dedupeBySignal` / `cooldownBars`（当未来引入“跨日形态/多日信号”时再考虑）

### 6.9.4 前端展示计划（`frontend/app/display/page.tsx`）

在现有 Low-Volume Pullback 的 Backtest 模块下方新增 “Range Metrics”：
- 输入：
  - `startDate` / `endDate`（date picker）
  - `horizonBars`、`entryExecution`
- 输出：
  - 一行“总胜率”（默认展示 `D+horizonBars`）
  - 一个按 `D+1..D+horizonBars` 的表格：
    - `win%`
    - `down_gt_5% / down_0_5% / up_0_5% / up_gt_5%` 四列（或四个彩色条形）

### 6.9.5 测试计划（后端）

- 新增 `backend/tests/test_low_volume_pullback_backtest_range.py`
  - 构造小 df，覆盖：
    - start/end 边界与 searchsorted 的取值
    - bucket 边界（-5%、0、+5%）归类正确
    - forward 不足时分母按 day 分开统计
    - （默认口径）按天 `hit[asOf]=True` 计 event，不产生“追认重复”


## 6.10 重构

### 6.10.1 lookbackbars的重构

目标：针对“缩量回调阴线（Low-Volume Pullback）”这条规则，**去除 `params.lookbackBars`**（策略参数），把“最近 N 天/最近 N 根 bar”的概念提升为**外层窗口参数**（例如 `recentBars`），而信号判定本身永远是“**单日/单 bar 独立判断**”（per-bar `hit[t]`）。

这样做的好处：
- 语义更清晰：策略定义只回答“这一天是否是信号日”，窗口规则由调用方决定；
- 复用更强：screener / 单日回测 / 区间统计都围绕同一个 `hit` 序列做窗口扫描或事件统计；
- 性能更稳：区间/批量场景不再“每个 asOf 反复重算 rolling”，而是一次预计算指标 -> 得到 `hit` 序列后再做扫描/聚合。

#### 影响范围（需要改动的地方）

后端（策略与 API）：
- `backend/app/strategy/low_volume_pullback.py`
  - `LowVolumePullbackParams`：移除 `lookback_bars`
  - 移除 `_detect_low_volume_pullback()`（原“单日判定”能力由 `_compute_low_volume_pullback_series` + `detect_low_volume_pullback_hits` 覆盖）
  - `backtest_low_volume_pullback_on_df()`：信号日选取逻辑需要调整（见下方方案）
  - `backtest_low_volume_pullback_range_on_df()`：去掉 lookback>1 的分支，事件口径固定为“hit 当天才算 event”
- `backend/app/strategy/schema.py`
  - `LowVolumePullbackParamsModel/PatchModel`：移除 `lookbackBars`
  - 请求体：新增外层 `recentBars`（screener 与单日 backtest 可用；range backtest 默认不需要）
- `backend/app/strategy/service.py`
  - 参数合并逻辑去掉 `lookbackBars`
  - screener/backtest 读取 `recentBars` 并做窗口扫描
- `backend/app/config/strategy.yaml`
  - 删除 `params.lookbackBars` 与 `rangeBacktest.params.lookbackBars`
  - 可新增 `screener.recentBars`、`backtest.recentBars` 默认值（例如 3）

前端：
- `frontend/app/display/page.tsx`
  - “Lookback”输入改名为 “Recent (bars/days)” 并改为发送 `recentBars`
  - Range Metrics 默认不需要 recentBars（事件是按天 hit），可隐藏或固定为 1

测试：
- `backend/tests/test_low_volume_pullback.py`：当前依赖“lookback 内多次命中”的断言需要改写
- `backend/tests/test_low_volume_pullback_backtest.py`：单日回测信号日定位逻辑变更后需同步
- `backend/tests/test_low_volume_pullback_backtest_range.py`：去掉 lookback 分支后仍应保持通过

文档：
- 本文中所有 `lookbackBars` 的描述需要更新为 `recentBars`（外层窗口）+ “per-bar hit”定义。

#### 实现计划（建议步骤）

1) 定义统一的 per-bar `hit` 计算入口（用于复用与性能）
- 在 `low_volume_pullback.py` 抽一个内部函数：一次性计算指标并返回 `hit` 序列（可附带 `vol_ratio/body_pct` 序列供输出）。
- range backtest / screener / backtest 的窗口扫描都复用该函数。

2) 去除 `lookbackBars`（策略参数层）
- `LowVolumePullbackParams` / `LowVolumePullbackParamsModel/PatchModel` 删除该字段；
- `strategy.yaml` 删除对应配置项；
- Service 的 params merge 同步调整。

3) 引入 `recentBars`（外层窗口层）
- Screener 请求体新增 `recentBars?: int`（默认从 config 取，例如 3）：
  - 逻辑：对最近 `recentBars` 根 bar 各自做 per-bar hit（或在 hit 序列上切片），若存在 hit 则返回 ticker；
  - 返回：`hits` 列表保留（命中日期可多条），`asOf` 可继续表示“最近一次命中”的时间戳。
- 单日 backtest 请求体新增 `recentBars?: int`（默认从 config 取）：
  - 兼容当前 UX：用户选择 `asOfDate`（截止日），后端在 `[asOf - recentBars + 1, asOf]` 窗口内找“最近一次 hit”作为 `signal_idx`；
  - 这样保留“选 2026-01-08 也能回测 2026-01-06 的信号”的体验，但**不再把 lookback 当成策略参数**。

4) 区间统计口径保持“按天事件”（range backtest）
- 事件定义固定为：`hit[asOf]==True` 才记 event（等价 old lookbackBars=1 的口径）；
- 保留 `sampleCountByDay` 分母逻辑（forward 不足不计入）。

5) 同步更新前端与测试
- 前端字段与提示文案改为 `recentBars`；
- 更新/补充单元测试：
  - per-bar hit（当天 vs 非当天）
  - `recentBars` 窗口扫描能找到最近一次 hit
  - range backtest 计数不受影响
