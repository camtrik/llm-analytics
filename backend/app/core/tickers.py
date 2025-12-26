# tickers.py
# Frequently watched stocks / ETFs (yfinance compatible)

JP_CORE_TICKER_INFO = {
    # --- ETFs ---
    "1619.T": "TOPIX-17 医药品 ETF",
    "2644.T": "Global X 半导体 ETF (Japan)",
    # --- Individual Stocks ---
    "4568.T": "第一三共",
    "9984.T": "SoftBank Group",
    "4523.T": "エーザイ",
    "4063.T": "信越化学",
}

# Optional: some commonly watched large-cap / tech stocks
JP_OPTIONAL_TICKER_INFO = {
    "6758.T": "Sony Group",
    "7974.T": "Nintendo",
}

TICKER_INFO = {**JP_CORE_TICKER_INFO, **JP_OPTIONAL_TICKER_INFO}
ALL_TICKERS = list(TICKER_INFO.keys())
