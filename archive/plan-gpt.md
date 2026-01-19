## 现状（基于现存代码）
- 已实现：`frontend/app/display/page.tsx` 可选择 tickers，一键触发 `POST /api/refresh`（yfinance 拉取全部 timeframes），再用 `POST /api/bars/batch` 拉回每个 timeframe 的 bars；`RangeSwitcherChart` 目前只画 Close 的折线。
- 后端目前只有 “数据获取/缓存/返回 bars” 三件套：`/api/options`、`/api/refresh`、`/api/bars`（含 batch）。数据只存在进程内（`MarketDataCache`），没有持久化、没有特征层、没有 LLM/回测/持仓数据。

## 目标系统（来自 `next.md`）
1) AI 分析选中的 tickers，给出可执行策略（带约束/风险）。  
2) Quant 策略与 AI 策略对比（同一份 structured feed / 同一数据窗口）。  
3) 一键获取 SBI 账户持仓数据（至少做到“可导入 + 自动刷新”的路径）。

---

## 下一步应该做什么（最优先：把“structured feed”打通）
`next.md` 的关键建议是：不要只把原始 OHLCV 丢给 LLM，而是“原始数据（少量）+ 结构化特征（重点）+ 约束信息（必须）”。  
结合你最新的 Milestone 1 需求，下一步的最小闭环应当是：**先把“可复现的 Feed v0（日期 + 持仓 + 可交易标的 + 两个时间尺度的 OHLCV）”跑通，并提供 API 预览**，让：
- LLM 分析有稳定输入（先不加特征）；
- 后续 Quant/特征层都能复用同一个输入口径；
- 前端能预览“喂给模型的到底是什么”，方便 prompt/工程迭代与 debug。

---

## Milestone 1：Feed v0（1-2 天，先做）
**目标**：把 feed 先固定为你指定的 4 件事，并通过 API 返回（不依赖 LLM、不做特征、不做回测）：
1) `date`  
2) `positions`（先实现 SBI 导出文件解析；输入示例：`AI-Trader/sbi-position.csv`）  
3) `tradableTickers`（可交易股票列表）  
4) `ohlcv`：`tradableTickers` 中所有股票的 **`10D_1h`** 与 **`6M_1d`** OHLCV

### 后端（FastAPI）
1) SBI 持仓解析模块（独立出来，便于以后扩展到 HTML/自动抓取）
   - 新目录建议：`backend/app/portfolio/`
   - `sbi_csv.py`：解析类似 `AI-Trader/sbi-position.csv` 的导出表，产出统一 `positions` 结构（ticker/qty/avg_cost/currency/market 等，最少先保证 ticker+qty 可用）
   - `models.py`：Pydantic 定义 `Position`/`Portfolio`/`ImportResult`
2) 持仓导入/读取 API
   - `POST /api/portfolio/import/sbi`：上传 CSV → 解析 → 保存（MVP 可先存本地 JSON 或 SQLite）
   - `GET /api/portfolio`：返回当前持仓（给 feed/LLM 用）
3) Timeframe 配置对齐（你指定了 `10D_1h` 和 `6M_1d`）
   - 已完成：`backend/app/core/timeframes.py` 已包含 `10D_1h` 与 `6M_1d`（yfinance interval=`1h` / `1d`）
4) 本地 JSON 缓存（参考 AI-Trader 的 `daily_prices_*.json` 形态，建议做）
   - 背景：当前后端只做进程内缓存（`MarketDataCache`）；一旦重启进程或多次请求，会重复打 yfinance，慢且易触发限流。
   - 方案：将下载到的 OHLCV **按 ticker + timeframe** 落盘为 JSON（分别保存 `10D_1h` 与 `6M_1d`），每次请求按顺序读取：
     - memory cache → file cache（未过期）→ yfinance 下载 → 写回 file cache + memory cache
   - 目录建议：`var/market_cache/{timeframe}/{ticker}.json`（或 `data/market_cache/...`，但更推荐 `var/` 放运行期产物）
   - JSON 建议结构（不强制复刻 AlphaVantage 字段名，但要“可读 + 可复现”）：
     - `meta`: `{ticker, timeframe, period, interval, source, generatedAt, minTs, maxTs}`
     - `bars`: `[{t,o,h,l,c,v}, ...]`（与现有前端/后端 bars model 对齐）
   - 新增模块建议：`backend/app/data/file_cache.py`（读写 + TTL + 原子写入），避免把缓存逻辑散落在 downloader/repository 里
5) Feed v0 预览 API（核心）
   - `GET /api/tradable` 或复用现有 `GET /api/options`：给出 `tradableTickers`
   - `POST /api/analysis/feed-v0`
     - 入参建议：`date`（可选，默认 now）、`tradableTickers`（可选，默认全部）、`includePositions=true`
     - 出参固定结构：
       - `date`
       - `positions`
       - `tradableTickers`
       - `ohlcv`: `{ "10D_1h": {ticker: bars[]}, "6M_1d": {ticker: bars[]} }`
       - `meta`: 数据源（yfinance）、生成时间、数据时间范围、版本号（便于复现与排查）
6) 给 Feed v0 定稳定 schema（Pydantic）
   - 新目录建议：`backend/app/analysis/models.py`：`FeedV0Request/FeedV0Response`

#### 改善cache问题

目标：让 “前端点击 Load” 成为唯一的数据刷新入口；**文件缓存为唯一权威**；`bars`/`feed` 只读文件，未 Load 时不可生成。

1) 统一成一个 `MarketCache`（同一份数据被 bars/feed 复用）
   - 文件落盘路径：`var/market_cache/{timeframe}/{ticker}.json`
   - `MarketCache` 负责：文件读写、manifest 覆盖校验、新鲜度判断
   - 读取策略统一由 `MarketCache` 处理（不要在各处散落 if/else）：
     - `bars`/`feed`：只读文件 + manifest 校验（缺失/过期直接报错）
     - 仅在 Load/Refresh 模式下允许回源 yfinance，并写文件 + 更新 manifest
   - 可选：保留短期内存 cache 仅作加速，但**不作为权威来源**（缺省可不实现）

2) Load/Refresh 行为（按 ticker 原子落盘）
   - Load/Refresh 仅拉取**用户选择的 tickers**，但每个 ticker 必须拉取 **全部 `TIMEFRAME_COMBOS`**
   - 对单个 ticker：所有 timeframe 全部成功后再落盘 + 更新 manifest（避免“半套缓存”）
   - 若某 ticker 失败：继续处理后续 tickers，并在响应里返回失败列表/原因

3) `feed` 只读文件（无隐式下载）
   - `POST /api/analysis/feed`：只从 `var/market_cache/...` 读取；缺失或过期返回 409 `cache_not_ready`
   - 前端：在未完成 Load/Refresh 前将 “生成 Feed” 按钮置灰，并提示用户先 Load

4) 引入 `manifest.json`（累积式可用集合）
   - 路径：`var/market_cache/manifest.json`
   - 结构建议：
     - `generatedAt`（manifest 最后更新时间）
     - `entries`：按 ticker 聚合
       - `entries.{ticker}.fetchedAt`
       - `entries.{ticker}.{timeframe}.minTs/maxTs/barCount`
   - `feed`/`bars` 生成前先检查 manifest 是否覆盖所需 tickers/timeframes；不完整则报错并提示重新 Load
  - 新鲜度按每个 timeframe 的 `maxTs` 判断（阈值放在配置层或由 interval 规则自动推导）
    - 默认规则：`interval < 1h` => `1h`；`interval >= 1h` => `interval`
    - 建议写入配置（例如 `core/timeframes.py` 新增 `TIMEFRAME_TTL_SECONDS`），便于覆盖特殊情况
    - `1D_15m`: `now - maxTs > 1h` 视为过期
    - `5D_30m`: `now - maxTs > 1h` 视为过期
    - `10D_1h`: `now - maxTs > 1h` 视为过期
    - `1M_1d`: `now - maxTs > 24h` 视为过期
    - `6M_1d`: `now - maxTs > 24h` 视为过期
    - `5Y_1wk`: `now - maxTs > 7d` 视为过期


5) 时间字段（bars API 与 cache 文件）
   - 保留 `t`（unix 秒）+ `time`（ISO UTC 字符串）同时存在
   - 前端图表继续使用 `t`；JSON 预览时把 `time` 优先展示（不依赖字段顺序）

6) `/api/options` 简化
   - 保留 tickers/timeframes/tickerInfo；移除 dataset rowCount/min/max 展示


### 前端（Next.js）
1) 在 `/display` 页加一个 “Feed v0 Preview” 面板（先不接 LLM）
   - 展示：`date`、`positions`、`tradableTickers` 数量、两套 timeframe 的 bars 样例（例如每个 timeframe 每个 ticker 只展示最后 3-5 根）
2) 增加 “导入 SBI 持仓 CSV” 的入口（只要能把 positions 填进 feed 即可）

**验收标准**
- 上传一份 SBI CSV 后，`GET /api/portfolio` 能返回可用的 `positions`，并在 `POST /api/analysis/feed-v0` 中体现。
- `POST /api/analysis/feed-v0` 返回结构稳定且可复现（含 `meta`，至少包含生成时间与数据范围）。
- `10D_1h` 与 `6M_1d` 的 OHLCV 能成功拉取并返回（对大列表需要有超时/大小保护策略）。

---

#### 其他问题记录
- （Done）返回值，比如
  ```
    def _validate_manifest(
        self, manifest: dict[str, Any], tickers: list[str], timeframes: list[str]
    ) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
  ```
  中的返回值太没有可读性了。能不能在创建对应的interface, or whatever you called it 

- 想要的效果应该是当前这个ticker的某个timeframe如果missing或者stale，应该在bars/batch的时候重新拉取，现在貌似变成了只要有一个timeframe过期则直接整个ticker重新拉取？(有时间再改)



## Milestone 2：LLM 分析（2-4 天）
**目标**：把 Milestone 1 的 Feed 当作 prompt 的主要输入之一，调用一次 LLM 并返回严格结构化结果（可落库、可对比）。

### 后端
1) LLM client（OpenAI-compatible）
   - 通过 env：`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`
2) Prompt 模板 + 结构化输出
   - `backend/app/analysis/prompt.py`：明确输入字段（Feed）、输出 schema、约束（不要给不可执行建议）
   - `backend/app/analysis/schema.py`：Pydantic 结果模型（signals/scenarios/risk/plan/confidence/data_limitations）
3) API
   - `POST /api/analysis/run`：入参=feed（或 feed id）+ 模型参数；出参=jobId（或同步返回，先简化）
   - `GET /api/analysis/{id}`：查结果/状态
4) 存储（MVP）
   - SQLite：保存 `feed_json`、`result_json`、`model/prompt_version`、时间、错误信息（先不做流式也可以）

### 前端
- 在 `/display` 或新页 `/analysis`：
  - 按当前选中 ticker/timeframe 一键 “Analyze”
  - 展示结构化卡片（signals/risk/plan）+ 原始文本（可选）

**验收标准**
- 结果一定能被 schema 校验；校验失败能自动重试或返回明确错误。
- 能从历史记录回看某次分析（最小：按 ticker+timeframe 列表）。

---

## Milestone 3：Quant 策略与对比（2-5 天）
**目标**：实现 1-2 个 baseline quant 策略，并把其结果与 LLM 输出并排展示/对比。

1) 先选库（建议 `backtesting.py`，集成成本低；或先手写一个向量化回测更可控）
2) 实现至少两类策略（与特征体系对应）
   - 趋势：MA crossover / breakout
   - 均值回归：RSI 反转 / 布林带
3) 指标统一
   - total return、max drawdown、Sharpe（简化）、胜率、交易次数、平均持仓周期、交易成本假设
4) API
   - `POST /api/quant/backtest`：输入=同一个 feed（或同样的 bars window）+ 策略参数；输出=指标 + equity curve（可选）
5) UI 对比
   - 同屏展示：LLM 的 plan vs quant 的规则与历史表现（同一 timeframe/window）

---

## Milestone 4：SBI 持仓（分两段做，先易后难）
**阶段 A（强烈建议先做，1-2 天）**：支持导入/更新持仓（“一键”先从本地文件开始）
- `POST /api/portfolio/import`：上传 SBI 导出的 CSV/HTML（先调研格式）
- 后端解析为统一 holdings schema（ticker/qty/avg_cost/currency/market）
- `GET /api/portfolio`：前端展示持仓并可作为 LLM constraints 输入

**阶段 B（自动化，时间不确定）**：真正“一键抓取”
- 先调研 SBI 是否有官方 API；没有则走 Playwright/Selenium 抓取
- 难点：验证码/2FA/设备认证、反爬、会话管理、安全存储凭证
- 实操建议：只在本机跑抓取（不部署到公网），凭证放系统 keychain 或 `.env`，并提供手动触发刷新

---

## 需要你确认的 4 个关键决策（确认后实现会更顺）
1) LLM Provider：优先用哪家（OpenAI/DeepSeek/Qwen/Claude via compatible）？是否需要本地模型？
2) 风险/约束默认值：最大仓位、是否允许加仓、止损/止盈规则、手续费/滑点假设、交易频率上限。
3) Quant 对比的“统一口径”：用哪个 timeframe 做回测？窗口用 6M_1d 还是 5Y_1wk？
4) SBI 持仓获取方式优先级：先接受“导出文件导入”作为 MVP 吗，还是必须直接自动抓取？

---

## 你可能还想补充进 Feed v0 的 3 个字段（建议，但不强制）
1) `asOf`：本次 feed 对应的“决策时刻”（UTC 时间戳或 ISO 字符串），便于复现与对齐新闻过滤。  
2) `marketAssumptions`：手续费/滑点/允许交易频率/是否允许做空（哪怕 Milestone 2 先不用，后续很快会用到）。  
3) `dataQuality`：每个 timeframe 的 bars 数量、缺失率、最后一根 bar 的时间（避免“数据没拉全但模型照样给建议”）。
