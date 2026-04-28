"""Auth router: /register, /login, /me."""
from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import CurrentUser, DbSession
from app.schemas.auth import (
    LoginRequest,
    MeResponse,
    RegisterRequest,
    TokenResponse,
    UserRead,
    WorkspaceWithRole,
)
from app.services.auth_service import (
    authenticate_user,
    list_user_workspaces,
    register_user,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(req: RegisterRequest, db: DbSession) -> TokenResponse:
    user, token = await register_user(
        db, email=req.email, password=req.password, display_name=req.display_name
    )
    return TokenResponse(token=token, user=UserRead.model_validate(user))


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: DbSession) -> TokenResponse:
    user, token = await authenticate_user(db, email=req.email, password=req.password)
    return TokenResponse(token=token, user=UserRead.model_validate(user))


@router.get("/me", response_model=MeResponse)
async def me(user: CurrentUser, db: DbSession) -> MeResponse:
    rows = await list_user_workspaces(db, user.id)
    return MeResponse(
        user=UserRead.model_validate(user),
        workspaces=[WorkspaceWithRole(**r) for r in rows],
    )
