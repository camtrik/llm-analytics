from __future__ import annotations

import csv
import io
import re
from typing import Iterable

from app.portfolio.models import Position


_CODE_RE = re.compile(r"^(\d{4,5})(?:\s+(.+))?$")

def parse_sbi_positions(payload: bytes) -> tuple[list[Position], int]:
    text = _decode_bytes(payload)
    reader = csv.reader(io.StringIO(text))
    positions: list[Position] = []
    skipped = 0
    for row in reader:
        if not row:
            continue
        first = row[0].strip()
        match = _CODE_RE.match(first)
        if not match:
            continue
        code = match.group(1)
        name = match.group(2).strip() if match.group(2) else None
        qty = _parse_number(row[2] if len(row) > 2 else None)
        if qty is None:
            skipped += 1
            continue
        avg_cost = _parse_number(row[3] if len(row) > 3 else None)
        ticker = _normalize_ticker(code)
        positions.append(
            Position(
                ticker=ticker,
                qty=qty,
                avg_cost=avg_cost,
                currency="JPY",
                market="TSE",
                name=name,
            )
        )
    return positions, skipped

def _decode_bytes(payload: bytes) -> str:
    for encoding in ("utf-8-sig", "cp932"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    return payload.decode("utf-8", errors="replace")


def _parse_number(value: str | None) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text in {"-", "----/--/--"}:
        return None
    text = text.replace(",", "")
    try:
        return float(text)
    except ValueError:
        return None


def _normalize_ticker(code: str) -> str:
    cleaned = code.strip()
    if "." in cleaned:
        return cleaned
    if cleaned.isdigit() and len(cleaned) in (4, 5):
        return f"{cleaned}.T"
    return cleaned


