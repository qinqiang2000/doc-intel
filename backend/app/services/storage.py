"""Local FS storage — pure functions, single point of file I/O for documents.

Future S3/cloud storage replaces this module wholesale; Document.file_path
shape stays the same (relative path under UPLOAD_DIR).
"""
from __future__ import annotations

import uuid as _uuid
from pathlib import Path

from app.core.config import get_settings


_EXT_BY_MIME: dict[str, str] = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
    "text/csv": "csv",
}

ALLOWED_MIME_TYPES: frozenset[str] = frozenset(_EXT_BY_MIME.keys())


def ext_for_mime(mime_type: str) -> str:
    """Return canonical file extension for a mime type, or 'bin' for unknown."""
    return _EXT_BY_MIME.get(mime_type, "bin")


def save_bytes(data: bytes, mime_type: str) -> tuple[str, str]:
    """Save raw bytes; return (document_uuid, relative_path).

    relative_path is `<uuid>.<ext>` rooted at settings.UPLOAD_DIR.
    """
    settings = get_settings()
    upload_dir = Path(settings.UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    document_uuid = str(_uuid.uuid4())
    ext = ext_for_mime(mime_type)
    rel_path = f"{document_uuid}.{ext}"
    abs_path = upload_dir / rel_path
    abs_path.write_bytes(data)
    return document_uuid, rel_path


def absolute_path(rel_path: str) -> Path:
    """Resolve a relative path against UPLOAD_DIR."""
    return Path(get_settings().UPLOAD_DIR) / rel_path


def delete_file(rel_path: str) -> None:
    """Idempotent — missing file is not an error."""
    abs_path = absolute_path(rel_path)
    if abs_path.exists():
        abs_path.unlink()
