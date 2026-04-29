"""Abstract base class for document processing strategies."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import AsyncIterator


class DocumentProcessor(ABC):
    """Abstract base class for document processing strategies."""

    @abstractmethod
    async def process_document(self, file_path: str, instruction: str) -> str:
        """Process a document and return extracted information as JSON string."""
        ...

    @abstractmethod
    def get_model_version(self) -> str:
        """Return the model version identifier (sync — pure formatting)."""
        ...

    async def chat_stream(self, *, system: str, user: str) -> AsyncIterator[str]:
        """Stream LLM tokens for a system+user chat. Default: NotImplementedError.

        Subclasses MAY implement; if not, callers must check capabilities.
        """
        raise NotImplementedError(
            f"{self.__class__.__name__}.chat_stream not implemented"
        )
        yield  # pragma: no cover (makes function an async generator)
