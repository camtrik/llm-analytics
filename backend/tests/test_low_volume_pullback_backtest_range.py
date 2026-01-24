from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest

import pandas as pd

# Ensure backend/ is on path for app.* imports
ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
for path in (ROOT, BACKEND):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.strategy.low_volume_pullback import (  # noqa: E402
    LowVolumePullbackParams,
    backtest_low_volume_pullback_range_on_df,
)


def _make_daily_df(
    start_date: datetime,
    closes: list[float],
    volumes: list[float],
    bearish_indices: set[int],
) -> pd.DataFrame:
    rows = []
    for idx, (close, vol) in enumerate(zip(closes, volumes)):
        ts = start_date + timedelta(days=idx)
        if idx in bearish_indices:
            open_ = close * 1.02
        else:
            open_ = close
        high = max(open_, close) * 1.001
        low = min(open_, close) * 0.999
        rows.append(
            {
                "time": ts,
                "Open": open_,
                "High": high,
                "Low": low,
                "Close": close,
                "Volume": vol,
            }
        )
    return pd.DataFrame(rows).set_index("time")


class LowVolumePullbackRangeBacktestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.params = LowVolumePullbackParams(
            fast_ma=2,
            slow_ma=3,
            long_ma=4,
            long_ma_slope_window=1,
            long_ma_slope_min_pct=0.0,
            vol_avg_window=2,
            vol_ratio_max=0.5,
            min_body_pct=0.01,
            min_range_pct=None,
            lookback_bars=1,
            eps=1e-12,
        )

    def test_range_counts_and_forward_denominators(self) -> None:
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        closes = [100, 101, 102, 103, 104, 105, 106, 100.7, 112, 118.72]
        volumes = [1000, 1000, 1000, 1000, 1000, 1000, 300, 1000, 300, 1000]
        df = _make_daily_df(start, closes, volumes, bearish_indices={6, 8})

        start_dt = datetime(2026, 1, 5, tzinfo=timezone.utc)
        end_dt = datetime(2026, 1, 9, 23, 59, 59, tzinfo=timezone.utc)
        result = backtest_low_volume_pullback_range_on_df(
            df=df,
            params=self.params,
            start_dt=start_dt,
            end_dt=end_dt,
            horizon_bars=3,
            entry_execution="close",
            bucket_threshold_pct=0.05,
        )

        self.assertEqual(result["evaluated_bars"], 5)  # 2026-01-05..2026-01-09 inclusive
        self.assertEqual(result["triggered_events"], 2)

        self.assertEqual(result["sample_count_by_day"], {1: 2, 2: 1, 3: 1})
        self.assertEqual(result["win_count_by_day"], {1: 1, 2: 1, 3: 1})

        buckets = result["bucket_count_by_day"]
        self.assertEqual(buckets[1]["down_gt_5"], 1, "ret=-0.05 should be down_gt_5")
        self.assertEqual(buckets[1]["up_gt_5"], 1)
        self.assertEqual(buckets[1]["down_0_5"], 0)
        self.assertEqual(buckets[1]["up_0_5"], 0)
        self.assertEqual(buckets[2]["up_gt_5"], 1)
        self.assertEqual(buckets[3]["up_gt_5"], 1)

    def test_bucket_boundaries_zero_and_plus_threshold(self) -> None:
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        closes = [100, 101, 102, 103, 104, 105, 106, 106, 111.3, 101.76]
        volumes = [1000, 1000, 1000, 1000, 1000, 1000, 300, 1000, 1000, 1000]
        df = _make_daily_df(start, closes, volumes, bearish_indices={6})

        signal_day = datetime(2026, 1, 7, tzinfo=timezone.utc)
        result = backtest_low_volume_pullback_range_on_df(
            df=df,
            params=self.params,
            start_dt=signal_day,
            end_dt=datetime(2026, 1, 7, 23, 59, 59, tzinfo=timezone.utc),
            horizon_bars=3,
            entry_execution="close",
            bucket_threshold_pct=0.05,
        )

        self.assertEqual(result["evaluated_bars"], 1)
        self.assertEqual(result["triggered_events"], 1)
        self.assertEqual(result["sample_count_by_day"], {1: 1, 2: 1, 3: 1})

        self.assertEqual(result["win_count_by_day"], {1: 0, 2: 1, 3: 0})

        buckets = result["bucket_count_by_day"]
        self.assertEqual(buckets[1]["up_0_5"], 1, "ret=0 should be up_0_5")
        self.assertEqual(buckets[2]["up_0_5"], 1, "ret=+0.05 should be up_0_5")
        self.assertEqual(buckets[3]["down_0_5"], 1, "ret=-0.04 should be down_0_5")


if __name__ == "__main__":
    unittest.main()

