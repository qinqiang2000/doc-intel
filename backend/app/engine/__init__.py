"""doc-intel engine: LLM processors + utilities for document extraction.

Ported from /Users/qinqiang02/colab/codespace/ai/label-studio-ml-backend/invoice_extractor/.
Adapted for async FastAPI: process_document is async; LLM SDK calls in real
processors must use SDK async APIs or asyncio.to_thread() to avoid blocking
the event loop.
"""
