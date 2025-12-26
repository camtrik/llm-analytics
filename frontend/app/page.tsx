export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <main className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">LLM Analytics</h1>
        <p className="mt-3 text-sm text-slate-600">
          快速查看下载的 OHLCV 数据。
        </p>
        <a
          href="/display"
          className="mt-6 inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          进入 Display 页面
        </a>
      </main>
    </div>
  );
}
