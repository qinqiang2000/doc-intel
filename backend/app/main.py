"""doc-intel FastAPI entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# pydantic-settings 只把 .env 读进 Settings 对象，不会写入 os.environ。
# engine/processors 直接 os.environ.get(...)，所以这里显式加载一次。
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="doc-intel — 文档智能提取自助平台",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

# Routes — wired in Tasks 10-12
from app.api.v1.router import v1_router  # noqa: E402

app.include_router(v1_router)

from app.api.v1.extract_public import router as extract_router  # noqa: E402

app.include_router(extract_router)

# Serve uploaded files
_upload_dir = Path(settings.UPLOAD_DIR)
_upload_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static/uploads", StaticFiles(directory=str(_upload_dir)), name="uploads")


@app.get("/health", tags=["Health"])
def health_check() -> dict:
    return {"status": "ok", "version": settings.APP_VERSION}
