"""Application settings loaded from environment / .env."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    APP_NAME: str = "doc-intel"
    APP_VERSION: str = "0.1.0"
    APP_ENV: Literal["development", "production", "test"] = "development"
    LOG_LEVEL: str = "INFO"

    DATABASE_URL: str = Field(default="sqlite+aiosqlite:///./data/doc_intel.db")
    SQL_ECHO: bool = False

    JWT_SECRET_KEY: str = Field(min_length=32)
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_DAYS: int = 7

    ML_BACKEND_URL: str = "http://0.0.0.0:9090"

    CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    UPLOAD_DIR: str = "./data/uploads"

    @field_validator("DATABASE_URL")
    @classmethod
    def _check_db_url(cls, v: str) -> str:
        if not (v.startswith("sqlite+aiosqlite://") or v.startswith("postgresql+asyncpg://")):
            raise ValueError(
                "DATABASE_URL must use sqlite+aiosqlite:// or postgresql+asyncpg:// driver"
            )
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
