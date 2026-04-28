"""Analyzers — pre-processing helpers for non-image documents (Excel, etc.)."""
from app.engine.analyzers.base import BaseAnalyzer

__all__ = ["BaseAnalyzer"]

# Optional: ExcelAnalyzer (requires google-genai)
try:
    from app.engine.analyzers.excel_analyzer import ExcelAnalyzer
    __all__.append("ExcelAnalyzer")
except ImportError:
    pass
