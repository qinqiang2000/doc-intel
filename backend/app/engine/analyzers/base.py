"""Abstract base class for data analysis strategies."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class BaseAnalyzer(ABC):
    """Analyzer must be async to avoid blocking on LLM calls."""

    @abstractmethod
    async def analyze(self, data: Any, **kwargs) -> str:
        """Analyze data and return result string."""
        ...

    @abstractmethod
    def get_analyzer_info(self) -> dict[str, str]:
        """Return analyzer metadata (name, description, etc.)."""
        ...
