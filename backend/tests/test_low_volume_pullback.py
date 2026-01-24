from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest

import sys

# Ensure project root is on path for app.* imports
ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
for path in (ROOT, BACKEND):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import pandas as pd

from app.strategy.low_volume_pullback import LowVolumePullbackParams, _detect_low_volume_pullback


def _make_df(closes: list[float], volumes: list[float]) -> pd.DataFrame:
    """Helper to build a minimal OHLCV DataFrame with bearish bars on demand."""
    base_time = datetime(2024, 1, 1, tzinfo=timezone.utc)
    rows = []
    for idx, (c, v) in enumerate(zip(closes, volumes)):
        # Make opens slightly above close so we can create bearish bars when desired in test data.
        o = c + (0.2 if idx >= len(closes) - 2 else 0.0)
        h = max(o, c) + 0.1
        l = min(o, c) - 0.1
        rows.append(
            {
                "time": base_time + timedelta(days=idx),
                "Open": o,
                "High": h,
                "Low": l,
                "Close": c,
                "Volume": v,
            }
        )
    df = pd.DataFrame(rows).set_index("time")
    return df


class LowVolumePullbackTests(unittest.TestCase):
    def setUp(self) -> None:
        # Use small windows to keep synthetic data short.
        self.params = LowVolumePullbackParams(
            fast_ma=2,
            slow_ma=3,
            long_ma=4,
            long_ma_slope_window=1,
            long_ma_slope_min_pct=0.0,
            vol_avg_window=2,
            vol_ratio_max=0.5,
            min_body_pct=0.01,  # 1%
            min_range_pct=None,
            lookback_bars=3,
            eps=1e-12,
        )

    def test_detects_multiple_hits_within_lookback(self) -> None:
        # Rising trend; last two bars are bearish with body >=1% and volume ratio below 0.5.
        closes = [10, 10.5, 11, 11.5, 12, 12.5, 13.0, 13.2]
        volumes = [1000, 1000, 900, 950, 1000, 1000, 300, 300]
        df = _make_df(closes, volumes)

        result = _detect_low_volume_pullback(df, self.params)

        self.assertTrue(result["triggered"])
        hits = result.get("hits", [])
        self.assertEqual(len(hits), 2, "Expect two hits in lookback window")
        latest = hits[0]
        older = hits[1]
        self.assertGreater(latest["as_of"], older["as_of"])
        self.assertLessEqual(latest["vol_ratio"], self.params.vol_ratio_max)
        self.assertLessEqual(older["vol_ratio"], self.params.vol_ratio_max)

    def test_no_hit_when_volume_not_shrunk(self) -> None:
        # Same prices, but last bar volume is higher than average -> should not trigger.
        closes = [10, 10.5, 11, 11.5, 12, 12.5, 13.0, 13.2]
        volumes = [1000, 1000, 900, 950, 1000, 980, 1200, 1500]
        df = _make_df(closes, volumes)

        result = _detect_low_volume_pullback(df, self.params)

        self.assertFalse(result["triggered"])
        self.assertEqual(result.get("hits"), [])


if __name__ == "__main__":
    unittest.main()
