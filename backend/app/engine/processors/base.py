"""Abstract base class for document processing strategies."""
from __future__ import annotations

from abc import ABC, abstractmethod


class DocumentProcessor(ABC):
    """Abstract base class for document processing strategies.

    All concrete processors must be async to avoid blocking the FastAPI
    event loop on LLM SDK calls. Use the SDK's native async API where
    available (AsyncOpenAI, genai.aio.*) or wrap sync calls with
    asyncio.to_thread().
    """

    @abstractmethod
    async def process_document(self, file_path: str, instruction: str) -> str:
        """Process a document and return extracted information as JSON string."""
        ...

    @abstractmethod
    def get_model_version(self) -> str:
        """Return the model version identifier (sync — pure formatting)."""
        ...
