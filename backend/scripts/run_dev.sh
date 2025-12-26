#!/usr/bin/env bash
set -euo pipefail

DATA_CSV_PATH=${DATA_CSV_PATH:-../data/stock_data.csv} uvicorn app.main:app --reload --port 8000
