#!/usr/bin/env bash
set -euo pipefail

PYTHONPATH=${PYTHONPATH:-.} uvicorn app.main:app --reload --port 8000
