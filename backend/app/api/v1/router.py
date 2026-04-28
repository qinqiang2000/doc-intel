"""Aggregate v1 router."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import annotations as annotations_module
from app.api.v1 import auth as auth_module
from app.api.v1 import documents as documents_module
from app.api.v1 import engine as engine_module
from app.api.v1 import predict as predict_module
from app.api.v1 import projects as projects_module
from app.api.v1 import templates as templates_module
from app.api.v1 import workspaces as workspaces_module

v1_router = APIRouter(prefix="/api/v1")
v1_router.include_router(auth_module.router)
v1_router.include_router(workspaces_module.router)
v1_router.include_router(projects_module.router)
v1_router.include_router(documents_module.router)
v1_router.include_router(annotations_module.router)
v1_router.include_router(engine_module.router)
v1_router.include_router(templates_module.router)
v1_router.include_router(predict_module.router)
