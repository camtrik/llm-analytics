from __future__ import annotations

import json
import textwrap
from datetime import datetime, timezone
from typing import Any

from fastapi.encoders import jsonable_encoder

from app.analysis.models import FeedResponse
from app.analysis.schema import AnalysisConstraints, ProviderName


def _dump_model(model: Any) -> Any:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    if hasattr(model, "dict"):
        return model.dict()
    return model


def _format_json(data: Any) -> str:
    encoded = jsonable_encoder(data)
    return json.dumps(encoded, ensure_ascii=False, indent=2)


def build_messages(
    feed: FeedResponse,
    constraints: AnalysisConstraints,
    provider: ProviderName,
    model: str,
    prompt_version: str,
    previous_errors: list[str] | None = None,
    last_output: str | None = None,
) -> list[dict[str, str]]:
    max_orders = constraints.maxOrders or 3
    system_prompt = textwrap.dedent(
        f"""
        You are a trading research assistant. Based only on the provided feed and constraints, output actionable next steps.
        Return STRICT JSON only; no Markdown or prose. The JSON schema is:
        meta: {{
          asOf: ISO datetime in UTC,
          provider: "{provider}",
          model: "{model}",
          promptVersion: "{prompt_version}",
          feedMeta: copy feed.meta and any helpful notes about data coverage
        }}
        summary: one-line overview (<= 280 chars).
        actions: array (max {max_orders}) of {{
          ticker: string (must be in feed.tradableTickers),
          action: BUY | SELL | HOLD | REDUCE | INCREASE,
          timeframe: one of feed.ohlcv keys (10D_1h or 6M_1d),
          qty: number | null,
          targetWeight: number | null,
          deltaWeight: number | null,
          rationale: brief fact-based reason citing visible bars/trends,
          risk: stop conditions or key risks,
          confidence: 0-1
        }}
        doNotTradeIf: array of strings listing blocking conditions (e.g., no cash, missing data).
        conversation: array of natural-language turns for UX display (only user/assistant roles, skip system).

        Rules:
        - Limit actions to {max_orders}. Prefer weight-based sizing when cash is unknown.
        - Respect constraints: allowBuy/allowSell/allowShort; if a direction is disallowed, omit those actions.
        - Use facts from feed.ohlcv only; do not invent prices. If data is stale or missing, add a doNotTradeIf entry.
        - If no clear edge, return actions=[] and a concise summary explaining hold/observe stance.
        - Keep JSON valid and machine-readable; avoid code fences.
        - In conversation, explain reasoning/changes succinctly; keep it 1-3 short sentences per assistant turn.
        """
    ).strip()

    payload = {
        "feed": _dump_model(feed),
        "constraints": _dump_model(constraints),
    }
    user_parts = [
        "Feed and constraints (JSON):",
        _format_json(payload),
    ]
    if previous_errors:
        error_text = "; ".join(previous_errors[-3:])
        user_parts.append(
            f"Previous response failed schema validation: {error_text}. Respond with corrected JSON only."
        )
    if last_output:
        user_parts.append("Your last invalid output:")
        user_parts.append(last_output)
    user_message = "\n".join(user_parts)

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]
