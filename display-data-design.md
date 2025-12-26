# Display Data MVP Design（FastAPI + Next.js）

目标：先把 `download_data.py` 生成的 `data/stock_data.csv` 做成一个可交互页面：用户选择 `tickers`（可多选）和 `timeframe_combos`（单选或多选），点击后由后端按选择返回 K 线数据，前端渲染 K 线/成交量（并可切换不同 ticker/timeframe）。

---

## Scope

- In
  - 后端提供“按 ticker/timeframe 取 bars”的 API（从 CSV 读取）
  - 前端提供选择器 + 点击加载 + 图表渲染
- Out（本阶段不做）
  - LLM 分析、任务队列、结果存储
  - CSV→Parquet 转换（可作为下一阶段优化）
  - 鉴权与多用户

---

## Data Assumptions（来自当前 CSV）

`data/stock_data.csv` 包含列：
- `Timeframe`（例如 `1D_15m`, `1M_1d`, `5Y_1wk`）
- `Ticker`（例如 `9984.T`）
- `Datetime`（字符串；可能带时区，如 `2025-12-22 00:00:00+00:00`）
- `Open/High/Low/Close/Adj Close/Volume`

说明：
- `Adj Close` 是复权后的收盘价（考虑分红、拆分等调整）。K 线图使用原始 `Open/High/Low/Close`，`Adj Close` 仅用于后续指标计算或补充展示。

前端图表需要字段（统一命名）：
- `t`：时间戳（建议秒级 Unix）
- `o/h/l/c`：OHLC
- `v`：volume

---

## Backend（FastAPI）设计

### 后端职责（MVP）

- 读取 `data/stock_data.csv`（pandas）
- 提供 metadata（可选项列表）与 bars 查询
- 对请求参数做校验（ticker/timeframe 是否存在、limit 上限、时间范围合法）
- 输出前端友好的 JSON（时间戳 + OHLCV）
- 性能最低保障：对 CSV 读取做简单缓存（进程内 LRU/TTL），避免每次请求都全量 parse

### 后端文件结构建议（MVP）

建议在仓库新增 `backend/`，并把“数据访问”与“API 路由”分层，方便后续把 CSV 替换为 Parquet/DB 而不影响接口。

- `backend/`
  - `app/`
    - `main.py`：FastAPI 创建与挂载路由、CORS
    - `api/`
      - `router.py`：聚合所有路由
      - `options.py`：`GET /api/options`
    - `bars.py`：`GET /api/bars`、`POST /api/bars/batch`
    - `core/`
      - `config.py`：环境变量与路径配置（CSV 路径、limit 上限等）
      - `errors.py`：统一错误响应模型（`{error,message,details}`）
      - `logging.py`：日志配置（MVP 可选）
    - `data/`
      - `repository.py`：`BarsRepository`（读 CSV、过滤、排序、转时间戳）
      - `models.py`：Pydantic 响应模型（OptionsResponse、BarsResponse 等）
      - `cache.py`：简单缓存（按 mtime/TTL 失效；MVP 可选）
  - `scripts/`
    - `run_dev.sh`（可选）：本地启动命令封装
  - `pyproject.toml`/`requirements.txt`：依赖管理（任选其一）

说明：
- `repository.py` 是关键：后续做 Parquet/SQLite/Timescale，只需要替换实现，不改路由与前端。
- 如果暂时不引入 DB，本 MVP 可以完全不需要 `db/` 目录。

### API 列表（建议）

#### 1) 获取可选项（tickers/timeframes）

`GET /api/options`

用途：前端初始化下拉框与默认值。

Response（示例）：
```json
{
  "tickers": ["1619.T", "2644.T", "4063.T"],
  "timeframes": ["1D_15m", "1M_1d", "6M_1d", "5Y_1wk"],
  "dataset": {
    "source": "data/stock_data.csv",
    "rowCount": 3376,
    "minDatetime": 1700000000,
    "maxDatetime": 1760000000
  }
}
```

实现说明：
- tickers/timeframes 可以直接从 CSV distinct 得出（更贴近真实数据）；也可以先用 `tickers.py`/`timeframes.py` 的定义返回（更可控）。

#### 2) 查询 bars（单 ticker + 单 timeframe）

`GET /api/bars?ticker=9984.T&timeframe=1M_1d&limit=...`

Query：
- `ticker`（必填）
- `timeframe`（必填，对应 CSV 的 `Timeframe`）
- `limit`（可选；不传则返回该 timeframe 的全部 K 线；如传入则返回**最新 N 根**。服务端可设置最大上限，例如 5000）

Response（示例）：
```json
{
  "ticker": "9984.T",
  "timeframe": "1M_1d",
  "bars": [
    {"t": 1734825600, "o": 100, "h": 110, "l": 95, "c": 108, "v": 123456}
  ]
}
```

实现说明：
- **MVP 约定（方案 B）**：`timeframe` 就是一个固定时间范围的数据集，不提供 `start/end`。后端返回该 timeframe 的完整序列；如传入 `limit`，则在排序后取**最新 N 根**。
- 后端统一将 `Datetime` 解析为 timezone-aware datetime（按 UTC 处理），再输出 unix 秒（前端图表更省心）。
- 按 `Datetime` 升序排序，去掉重复时间点（如出现）。

#### 3) 查询 bars（多 ticker + 单 timeframe）——用于“一次点选加载多个”

`POST /api/bars/batch`

Body（示例）：
```json
{
  "tickers": ["1619.T", "9984.T"],
  "timeframe": "1D_15m",
  "limit": 500
}
```

Response（示例）：
```json
{
  "timeframe": "1D_15m",
  "series": {
    "1619.T": [{"t": 1734825600, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}],
    "9984.T": [{"t": 1734825600, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}]
  }
}
```

实现说明：
- 批量接口减少前端多请求（但 response 可能较大，需要 limit 与 tickers 数量上限）。
- MVP 可以先做单 ticker 接口，前端循环请求；稳定后再加 batch。

### 内部模块建议（便于后续替换 Parquet/DB）

- `BarsRepository`
  - `list_options()`：返回 tickers/timeframes/dataset 统计
  - `get_bars(ticker, timeframe, start, end, limit)`：返回序列
  - `get_bars_batch(tickers, timeframe, start, end, limit)`：返回多序列

数据缓存建议（MVP）：
- 进程内缓存已读入的 DataFrame（TTL 30-120s 或基于文件 mtime 失效）
- 先按 `Timeframe` 分片缓存（减少每次过滤成本）

### 错误处理（统一 JSON）

- 400：参数缺失/格式不对（例如 limit 过大）
- 404：ticker/timeframe 在数据里不存在
- 500：CSV 读取失败/解析失败

错误体示例：
```json
{"error":"invalid_request","message":"timeframe not found","details":{"timeframe":"X"}}
```

---

## Frontend（Next.js）设计

### 页面（MVP）

`/display`
- 左侧控制面板：
  - Ticker 多选（支持搜索）
  - Timeframe 选择（单选；或支持多选但建议先单选）
  - 时间范围（可选：最近 N 根K / start-end）
  - `Load` 按钮（触发请求）
- 右侧展示区：
  - Tabs：按 ticker 切换查看（当多选 tickers 时）
  - 主图：K 线 + 成交量（同一 ticker）
  - 可选：一个小表格显示最近几根K（调试/对照）

### 组件拆分

- `TickerMultiSelect`
  - 数据源：`GET /api/options`
  - 交互：搜索、全选/清空、已选展示
- `TimeframeSelect`
  - 数据源：`GET /api/options`
- `RangePicker`（可选）
  - 模式 A：最近 `N` 根K（默认 200/500，对应 `limit`）
- `LoadButton`
  - 点击后触发数据拉取（并展示 loading/error）
- `ChartPanel`
  - 接收 `bars` 数据，渲染 K 线与 volume
- `TickerTabs`
  - 多 ticker 时用 tabs 切换（一次加载或懒加载）

### 采用的库（建议）

- 图表：`lightweight-charts`（K 线体验最好，性能也好）
- 数据请求与缓存：`@tanstack/react-query`
- UI：`Tailwind CSS + shadcn/ui`
- 表单状态（可选）：`react-hook-form`
- 日期处理：`dayjs`（或 `date-fns`）

### 数据拉取策略（MVP 友好）

- 页面加载时请求一次 `/api/options`（缓存）
- 点击 `Load` 后：
  - 若先实现单 ticker 接口：对选中的 tickers 并行请求 `/api/bars`，加载完成后更新 UI
  - 若实现 batch：一次请求 `/api/bars/batch`
- 为避免 UI 卡顿：
  - 限制一次最多选 N 个 tickers（例如 10）
  - 默认 limit 200~500

---

## UX & Acceptance Criteria

- 用户打开 `/display`：
  - 能看到 tickers 与 timeframes 可选项
  - 默认选中一个 ticker + 一个 timeframe
- 用户多选 tickers、选择 timeframe，点击 `Load`：
  - 在 1-2 秒内显示图表（本地开发视数据量而定）
  - 若某 ticker 在该 timeframe 无数据，UI 显示“无数据”而不是全局报错
- 图表：
  - K 线正常、时间轴正确（时区不乱）
  - 成交量与 K 线对齐
