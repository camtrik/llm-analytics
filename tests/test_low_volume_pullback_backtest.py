from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest

import pandas as pd

# Ensure project root is on path for app.* imports
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.strategy.low_volume_pullback import (  # noqa: E402
    LowVolumePullbackParams,
    backtest_low_volume_pullback_on_df,
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


class LowVolumePullbackBacktestTests(unittest.TestCase):
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
            eps=1e-12,
        )

    def test_backtest_uses_signal_day_next_bar_for_forward(self) -> None:
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        closes = [100, 101, 102, 103, 104, 105, 106, 107, 108]
        # Make 2026-01-06 (index=5) a low-volume bearish day.
        volumes = [1000, 1000, 1000, 1000, 1000, 300, 1000, 1000, 1000]
        df = _make_daily_df(start, closes, volumes, bearish_indices={5})

        cutoff = datetime(2026, 1, 8, 23, 59, 59, tzinfo=timezone.utc)
        result = backtest_low_volume_pullback_on_df(
            df=df,
            params=self.params,
            cutoff_dt=cutoff,
            recent_bars=3,
            horizon_bars=2,
            entry_execution="close",
        )

        self.assertTrue(result["triggered"])
        # Signal should be 2026-01-06 (index=5), and forward should start on 2026-01-07.
        signal_ts = int(result["signal_ts"])
        expected_signal_ts = int((start + timedelta(days=5)).timestamp())
        self.assertEqual(signal_ts, expected_signal_ts)

        forward = result["forward"]
        self.assertEqual(len(forward), 2)
        first_forward_ts = int(forward[0]["ts"])
        expected_first_forward_ts = int((start + timedelta(days=6)).timestamp())
        self.assertEqual(first_forward_ts, expected_first_forward_ts)

        # Entry is close on 2026-01-06 = 105
        self.assertAlmostEqual(float(forward[0]["return"]), 106 / 105 - 1, places=8)
        self.assertAlmostEqual(float(forward[1]["return"]), 107 / 105 - 1, places=8)

    def test_backtest_next_open_entry(self) -> None:
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        closes = [100, 101, 102, 103, 104, 105, 106, 107, 108]
        volumes = [1000, 1000, 1000, 1000, 1000, 300, 1000, 1000, 1000]
        df = _make_daily_df(start, closes, volumes, bearish_indices={5})

        cutoff = datetime(2026, 1, 8, 23, 59, 59, tzinfo=timezone.utc)
        result = backtest_low_volume_pullback_on_df(
            df=df,
            params=self.params,
            cutoff_dt=cutoff,
            recent_bars=3,
            horizon_bars=2,
            entry_execution="next_open",
        )

        self.assertTrue(result["triggered"])
        forward = result["forward"]
        # Entry is next day's open, which equals close=106 in our synthetic data.
        self.assertAlmostEqual(float(forward[0]["return"]), 106 / 106 - 1, places=8)
        self.assertAlmostEqual(float(forward[1]["return"]), 107 / 106 - 1, places=8)


if __name__ == "__main__":
    unittest.main()
