# React Query（TanStack Query）学习笔记：结合我们当前的实现

本文以我们已经完成的 `low-volume-pullback` 策略页（screener/backtest/range）为例，整理：
- React Query 的核心原理（它到底帮我们做了什么）
- 我们项目里是怎么接入、怎么用的
- 为什么“进详情再返回”不会丢数据
- 目前实现的边界（哪些行为我们刻意没做）

相关代码入口：
- Provider：`frontend/src/components/providers/query-client-provider.tsx`
- RootLayout 挂载：`frontend/src/app/layout.tsx`
- 策略页（示例）：`frontend/src/app/(main)/dashboard/strategy/low-volume-pullback/screener/page.tsx`
- URL 参数解析/归一化：`frontend/src/app/(main)/dashboard/strategy/low-volume-pullback/*/params.ts`

---

## 1. React Query 的“问题定义”

在没有 React Query 时，我们典型会在页面里手写：
- `loading / error / data` 的状态管理
- 取消/去抖/重复请求去重
- 缓存：上一页返回时是否保留结果、何时过期、何时重新拉取
- 多处复用同一个请求时的共享

React Query 把这些事情抽象成“Query（查询）”：
- **一个 queryKey 对应一份缓存数据**（以及它的状态：fresh/stale、error、更新时间、是否正在请求…）
- 组件只是“订阅”这份缓存，并在需要时触发获取

---

## 2. 核心概念（原理层）

### 2.1 QueryClient：全局管理者

`QueryClient` 是 React Query 的核心实例，包含：
- QueryCache：所有 query 的存储与索引
- 默认配置（staleTime、gcTime、重试等）
- 通过 `QueryClientProvider` 注入到 React 组件树，供 `useQuery` 等 hook 使用

我们项目里创建 QueryClient 的位置是：
`frontend/src/components/providers/query-client-provider.tsx`

关键点：
- 用 `useState(() => new QueryClient(...))` 确保 QueryClient **只创建一次**，不会因组件重渲染而丢缓存。

代码（节选）：
```tsx
// frontend/src/components/providers/query-client-provider.tsx
"use client";

import { type ReactNode, useState } from "react";
import { type DefaultOptions, QueryClient, QueryClientProvider } from "@tanstack/react-query";

const DEFAULT_QUERY_OPTIONS: DefaultOptions["queries"] = {
  staleTime: 5 * 60 * 1000,
  gcTime: 10 * 60 * 1000,
  retry: 1,
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
  keepPreviousData: true,
};

export function QueryClientRoot({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: DEFAULT_QUERY_OPTIONS },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

### 2.2 queryKey：缓存的唯一标识

`useQuery({ queryKey, queryFn })` 中：
- `queryKey` 用来标识“这是哪一份数据”
- 同样的 `queryKey`（语义上相同）→ 复用同一份缓存
- 不同的 `queryKey` → 会形成不同的缓存条目

我们的策略页使用的 key 形如：
- `["low-volume", "screener", params]`
- `["low-volume", "backtest", params]`
- `["low-volume", "range", params]`

其中 `params` 是从 URL `searchParams` 解析并 **normalize** 后得到的对象（见 3.2）。

### 2.3 queryFn：如何拿到数据

`queryFn` 是异步函数，负责真正发请求并返回 JSON。
在我们的实现里，`queryFn` 内部会：
- 拼 payload（把 URL 参数转成后端需要的类型）
- `fetch(...)`
- `if (!res.ok) throw new Error(...)`
- `return await res.json()`

`throw` 出来的错误会被 React Query 捕获并放到 `query.error` 中，组件可以用它展示错误 UI。

### 2.4 Observer：组件订阅缓存

每个 `useQuery(...)` 可以理解为创建/绑定了一个“observer（观察者）”：
- 组件 mount：observer 订阅缓存 → 有数据就渲染数据
- 组件 unmount：observer 取消订阅

**重要：取消订阅 ≠ 立刻删除缓存**。缓存会在 `gcTime` 后才可能被清理（详见 2.6）。

### 2.5 staleTime：多久算“新鲜”

`staleTime` 决定数据从“fresh”变成“stale”的时间。
- fresh：一般不会自动 refetch（取决于你的触发条件）
- stale：在某些场景（重新 mount、窗口聚焦、网络恢复等）可能触发 refetch（也取决于配置）

我们设置的默认值：`staleTime = 5min`（见 `frontend/src/components/providers/query-client-provider.tsx`）

### 2.6 gcTime（旧称 cacheTime）：没人用时缓存保留多久

`gcTime` 控制“当没有任何组件订阅一个 query（即没有 observer）时，这份缓存最多保留多久”。
- 当你从策略页跳到 ticker 详情页：策略页组件卸载 → observer 消失
- 但缓存还在（直到 gcTime 到期被回收）

我们设置的默认值：`gcTime = 10min`

---

## 3. 我们当前项目里的接入方式（实现层）

### 3.1 全局挂载 QueryClientProvider

我们在 `frontend/src/app/layout.tsx` 里包了一层：
- `QueryClientRoot`（client component）
- 再包 `PreferencesStoreProvider` 等

意义：
- Next.js App Router 的 layout 通常会在页面间切换时**保持不卸载**（同一 layout 下）
- 所以 `QueryClient` 也不会被销毁 → 缓存跨页面导航保留

这就是“进详情页再返回，结果不丢”的关键前提之一。

代码（节选）：
```tsx
// frontend/src/app/layout.tsx
import type { ReactNode } from "react";

import { QueryClientRoot } from "@/components/providers/query-client-provider";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryClientRoot>
          {/* ...其它全局 Provider... */}
          {children}
        </QueryClientRoot>
      </body>
    </html>
  );
}
```

### 3.2 URL 参数归一化（让 queryKey 稳定且可复现）

我们把每个页面的参数解析提取到独立文件：
- `frontend/src/app/(main)/dashboard/strategy/low-volume-pullback/screener/params.ts`
- `frontend/src/app/(main)/dashboard/strategy/low-volume-pullback/backtest/params.ts`
- `frontend/src/app/(main)/dashboard/strategy/low-volume-pullback/range/params.ts`

这一步做两件事：
1) `parseXxxSearchParams(searchParams)`：从 URL 读字符串
2) `normalizeXxxParams(params)`：把“非法/缺失/NaN”回退到默认值，避免出现“同义参数”导致缓存碎片

比如 screener：
- `volRatioMax/minBodyPct/recentBars` 遇到 NaN → 回退默认
- `onlyTriggered` 强制成 `"0" | "1"`

range/backtest：
- 对 `entryExecution` 做白名单：只有 `"next_open"` 才保留，否则回退 `"close"`

代码（节选，URL → params → 写回 URL，screener）：
```tsx
// frontend/src/app/(main)/dashboard/strategy/low-volume-pullback/screener/page.tsx
const searchParams = useSearchParams();
const router = useRouter();
const pathname = usePathname();
const [isTransitioning, startTransition] = useTransition();

// URL 是单一事实来源：每次 searchParams 变化，就重新解析 params
const params = useMemo(() => parseScreenerSearchParams(searchParams), [searchParams]);

const updateParams = useCallback(
  (updates: Partial<ScreenerParams>) => {
    startTransition(() => {
      const next = buildSearchParams(searchParams, updates);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  },
  [router, pathname, searchParams],
);
```

代码（节选，range）：
```ts
// frontend/src/app/(main)/dashboard/strategy/low-volume-pullback/range/params.ts
export const normalizeRangeParams = (params: RangeParams): RangeParams => ({
  ...RANGE_DEFAULT_PARAMS,
  ...params,
  horizonBars: Number.isNaN(parseInt(params.horizonBars, 10)) ? RANGE_DEFAULT_PARAMS.horizonBars : params.horizonBars,
  volRatioMax: Number.isNaN(parseFloat(params.volRatioMax)) ? RANGE_DEFAULT_PARAMS.volRatioMax : params.volRatioMax,
  minBodyPct: Number.isNaN(parseFloat(params.minBodyPct)) ? RANGE_DEFAULT_PARAMS.minBodyPct : params.minBodyPct,
  entryExecution: params.entryExecution === "next_open" ? "next_open" : "close",
});
```

### 3.3 手动触发查询：enabled:false + refetch()

策略页的“运行”按钮语义是：**用户点击才请求**，不自动请求。

所以我们统一使用：
- `useQuery({ enabled: false, ... })`
- 点击按钮时 `await query.refetch()`

例如 screener 页（简化后逻辑）：
- `enabled: false`
- `run()` → `screenerQuery.refetch()`

对应代码：`frontend/src/app/(main)/dashboard/strategy/low-volume-pullback/screener/page.tsx`

这相当于把 `useQuery` 当成“一个带缓存的 request 容器”：
- 它负责缓存、状态、错误
- 但请求的触发时机由我们控制

代码（节选，screener）：
```tsx
// frontend/src/app/(main)/dashboard/strategy/low-volume-pullback/screener/page.tsx
const screenerQuery = useQuery({
  queryKey: ["low-volume", "screener", params],
  queryFn: async (): Promise<LowVolumeResponse> => {
    const payload = {
      timeframe: params.timeframe,
      tickers: null,
      onlyTriggered: params.onlyTriggered === "1",
      recentBars: parseInt(params.recentBars, 10) || undefined,
      params: {
        volRatioMax: parseFloat(params.volRatioMax),
        minBodyPct: parseFloat(params.minBodyPct),
      },
    };
    const res = await fetch(`${API_BASE}/api/strategy/low_volume_pullback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`筛选失败 (${res.status})`);
    return (await res.json()) as LowVolumeResponse;
  },
  enabled: false, // 手动触发
});

const run = async () => {
  if (!params.timeframe) return;
  await screenerQuery.refetch();
};
```

### 3.4 isFetching vs isLoading：我们用的是“是否在请求中”

我们在按钮 disabled 上使用：
- `isLoading = query.isFetching || isTransitioning`

这里 `isTransitioning` 来自 `startTransition`，用于 URL 更新时避免 UI 卡顿。

React Query 的几个常见状态：
- `isFetching`：只要有网络请求在飞就为 true（包含后台 refetch）
- `isLoading`：第一次加载（且没有缓存数据）时为 true（不同版本/场景语义略有差别）

我们这里用 `isFetching` 更贴近“运行中…”按钮展示。

---

## 4. 为什么“返回上一页不会丢数据”（结合我们的实现）

以前会丢的根因是：结果存在页面的 `useState`，页面一卸载 state 就没了。

现在不丢的原因可以拆成两层：

### 4.1 结果存到了 QueryCache，而不是页面 state

这里最关键的一点是：`screenerQuery.data` **不是我们手动 `setState` 塞进去的**，它来自 React Query 的 **QueryCache**。

把它想象成一个全局的（在 `QueryClient` 里）Map：
- key：`queryKey`（例如 `["low-volume", "screener", params]`）
- value：这次请求的最新结果（`LowVolumeResponse`）+ 一堆元信息（状态、时间戳、是否正在请求等）

当你点击“运行筛选”时，实际发生的顺序大概是：

1) `run()` 执行 → 调用 `screenerQuery.refetch()`
2) React Query 进入“请求中”状态（`isFetching=true`），并开始执行 `queryFn`
3) `queryFn` 内部 `fetch(...)` + `await res.json()` 成功返回 `LowVolumeResponse`
4) React Query **把返回值写入 QueryCache**（对应这个 `queryKey`）
5) React Query 通知所有正在订阅这个 `queryKey` 的组件（observer）：“数据更新了”
6) 当前页面组件因为订阅了这条 query，于是 re-render；此时 `screenerQuery.data` 就变成了最新值

因此，“写进 `screenerQuery.data`”准确说法是：
- **数据先写进 QueryCache**
- `screenerQuery.data` 只是“这个组件当前读到的缓存快照”

读取方式就是直接从 `screenerQuery.data` 拿：
- `const results = screenerQuery.data?.results ?? []`

代码（节选，读取缓存数据）：
```ts
// frontend/src/app/(main)/dashboard/strategy/low-volume-pullback/screener/page.tsx
const results = screenerQuery.data?.results ?? [];
```

补充：如果 `queryFn` 抛错（例如 `!res.ok` 时 `throw new Error(...)`），那这次不会写入新的 `data`，而是更新 `screenerQuery.error`；UI 就会走我们渲染的错误提示分支。

### 4.2 QueryClient 没卸载（layout 持久化）

从策略页跳到 ticker 详情页：
- 策略页组件卸载（observer 消失）
- 但 `QueryClientRoot` 还在（因为在 `app/layout.tsx`）
- 所以 cache 仍存在（至少在 `gcTime` 内）

当你返回策略页：
- `useQuery` 用同一个 `queryKey` 重新订阅
- 直接拿到 cache 里的 data → UI 立即恢复

---

## 5. 我们“刻意没做”的行为（现状边界）

### 5.1 刷新页面（F5）不会保留结果

原因：
- React Query 的默认 cache 在内存里
- 刷新等于整个 JS runtime 重启 → QueryClient 重建 → cache 清空

要做到刷新仍保留，需要额外做“持久化缓存”（例如 sessionStorage persist）。
我们目前保持未实现（见 `frontend-refactor-new.md` 里的 PR3）。

### 5.2 新标签页打开同一 URL 不会自动跑一次请求

原因：
- 我们用了 `enabled:false`
- 新标签页只会解析参数并渲染页面，但不会自动 `refetch()`

这在策略工具里通常是合理的（避免误触发昂贵请求），也符合“用户点击运行才执行”的心智。

---

## 6. 小练习：如何验证你真的理解了“key 驱动缓存”

1) 打开 screener 页，点“运行筛选”
2) 记住当前 URL 的 query 参数（比如 `volRatioMax=0.5...`）
3) 改一个参数（比如把 `volRatioMax` 改为 `0.4`），再运行

你会得到两份缓存：
- key = `["low-volume","screener", paramsA]`
- key = `["low-volume","screener", paramsB]`

只要你把 URL 改回 paramsA（并且我们不清 cache），页面就能立刻读回之前那一份结果。

---

## 7. 测试：我们怎么保证参数解析/归一化可预期

我们添加了一个轻量测试脚本来验证 `params.ts` 的行为：
- 测试文件：`frontend/tests/low-volume-pullback/params.test.cjs`
- 运行命令：`cd frontend && npm run test`

它会检查类似：
- NaN/非法值会回退到默认值
- `entryExecution=bad` 会回退到 `"close"`

这类测试的价值在于：你改 URL 参数逻辑时，可以快速知道是否破坏了“同义参数归一化”的前提（直接影响 React Query 缓存命中率）。

代码（节选）：
```js
// frontend/tests/low-volume-pullback/params.test.cjs
const rangeExec = parseRangeSearchParams(toParams("entryExecution=bad")).entryExecution;
assert.equal(rangeExec, "close"); // fallback when invalid
```
