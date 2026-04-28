#!/usr/bin/env bash
# Start backend (uvicorn :8000) + frontend (vite :5173) for dev/smoke.
# Reads API_KEY / OPENAI_API_KEY from env. Reset DB if RESET_DB=1.
#
# Usage:
#   API_KEY=... OPENAI_API_KEY=... ./scripts/run-dev.sh
#   RESET_DB=1 API_KEY=... ./scripts/run-dev.sh   # wipe data/doc_intel.db first
#
# Env passes through to backend so engine processors (gemini/openai) pick them up.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${RESET_DB:-0}" == "1" ]]; then
  echo "[run-dev] wiping data/doc_intel.db*"
  rm -f backend/data/doc_intel.db backend/data/doc_intel.db-shm backend/data/doc_intel.db-wal
fi

echo "[run-dev] alembic upgrade head"
( cd backend && uv run alembic upgrade head )

echo "[run-dev] starting backend on http://127.0.0.1:8000"
( cd backend && API_KEY="${API_KEY:-}" OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 ) &
BACKEND_PID=$!

echo "[run-dev] starting frontend on http://localhost:5173"
( cd frontend && npm run dev ) &
FRONTEND_PID=$!

trap 'echo "[run-dev] stopping"; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; wait' INT TERM

wait
