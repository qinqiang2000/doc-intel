# S0 — Foundation：仓库改造 + Auth + Workspace 骨架

**日期**：2026-04-27
**Spec 编号**：S0（共 6 个 sub-spec：S0-S5）
**状态**：草稿，待 review

---

## 1. 背景与定位

本项目脱胎于 API_anything（产品同事的早期实现，位于本仓库当前路径）和 doc-intel（基于 Label Studio fork 的特化分支，位于 `/Users/qinqiang02/colab/codespace/ai/doc-intel/`）。两者各完成了部分目标，现合并为一个统一项目，定位为**自助式文档智能提取平台**：客户自己在 Workspace 内新建 Project、上传样本、调试 Prompt、选择模型、评估效果、一键发布提取 API。

完整决策上下文见 `MEMORY.md` 和早期 brainstorming 会话。本 spec 只覆盖第一个 sub-spec：**S0 Foundation**。

整体决策摘要（已确认，本 spec 不再讨论）：

| 决策 | 结果 |
|---|---|
| Project 模型 | Project = ApiDefinition（合一） |
| DB 设计 | 全新 greenfield，丢弃 LS 老库与现有 SQLite schema |
| ML 调用 | HTTP 走外部 ML backend（http://0.0.0.0:9090） |
| 多租户 | Workspace 即租户，Email + 密码 + JWT |
| 多文档调试 | Project 内多 Document，工作台支持文档切换；Prompt 在 Project 级共享 |
| 代码仓库 | 当前 API_anything 仓库内原地改造 |
| 前端栈 | Vite + React 19 + Tailwind + Zustand（保留） |
| 后端栈 | FastAPI + async SQLAlchemy 2.x + aiosqlite (WAL) |

---

## 2. S0 范围与目标

**S0 完成时，用户能做到**：

1. 通过浏览器访问前端，看到登录页；
2. 用 Email + 密码注册新账号；
3. 登录后进入 dashboard，能创建一个新 Workspace；
4. 在多个 Workspace 间切换；
5. （后端）所有现有 SQLAlchemy session 改为 async；
6. （后端）`GET /api/v1/ml/health` 能成功穿透到 `http://0.0.0.0:9090/health` 返回 ML backend 状态。

**S0 不做的事（明确划入后续 S1-S5）**：

- Project / Document 的任何模型与路由（→ S1）
- 文档上传 / 预览 / 工作台 UI（→ S1, S2）
- ML predict、SSE、ProcessingResult（→ S2, S3）
- Prompt 版本管理与对话矫正（→ S3）
- Evaluate（→ S4）
- API 发布、ApiDefinition 状态机、ApiKey、`/extract` 端点（→ S5）

**S0 故意删除的现有代码**（API_anything 已实现但与新方向冲突）：

- `backend/app/abstractions/`（StorageBackend、TaskRunner、AuthProvider 抽象层 — 用 YAGNI 原则去掉，需要时再加）
- `backend/app/services/{document_service,annotation_service,api_definition_service,api_key_service,extract_service,prompt_optimizer,schema_generator,template_service}.py`（语义全变，留下会误导）
- `backend/app/api/v1/{documents,annotations,api_defs,api_keys,extract,conversations,prompts,templates,usage}.py`
- `backend/app/models/{document,annotation,api_definition,api_key,conversation,prompt_version,usage_record}.py`
- 前端 `src/pages/{Workspace,ApiList,settings/*}.tsx`、`src/components/{workspace,workspace-v2,document,fields,api,templates}/*`、`src/stores/{workspace-store,document-store,api-store}.ts`
> **重要**：被删除的代码会先用 `git tag pre-rebase` 保留，且 doc-intel 仓库归档不动。S2 移植 workspace UI 时直接从 git history 或 archive 中找。

---

## 3. 仓库改造（S0 第一步）

执行顺序严格按 3.1 → 3.2 → 3.3，不可颠倒。

### 3.1 锁存当前状态 + 打 tag

```bash
cd /Users/qinqiang02/colab/codespace/ai/API_anything
git add -A && git commit -m "checkpoint: state before S0 rebase"
git tag pre-rebase
# 有 remote 时：git push origin pre-rebase
```

### 3.2 改名（可选，建议执行）

```bash
cd /Users/qinqiang02/colab/codespace/ai
mv API_anything doc-intel
```

`pyproject.toml` 的 `name` 也从 `apianything-backend` 改为 `doc-intel-backend`。

> 如果你（用户）希望保留 API_anything 目录名作为致敬，可以跳过此步，本 spec 后续路径用 `<repo>` 表示根目录。

### 3.3 删除清单（按 §2 列表）

一次性删除上述文件 / 目录。删除后 backend 短期会无法 import（这是预期），由后续 S0 步骤逐步补回。

---

## 4. 后端架构

### 4.1 目标目录结构（S0 完成时）

```
<repo>/backend/
├── app/
│   ├── main.py                    # FastAPI 入口 + 异步 lifespan
│   ├── core/
│   │   ├── config.py              # Pydantic Settings
│   │   ├── database.py            # async engine + session factory
│   │   ├── security.py            # 密码哈希 + JWT 编解码
│   │   ├── deps.py                # get_db, get_current_user, get_current_workspace
│   │   └── exceptions.py          # 统一异常处理
│   ├── ml_client.py               # ML backend HTTP 封装（从 doc-intel 搬过来，改 async）
│   ├── models/
│   │   ├── __init__.py
│   │   ├── base.py                # DeclarativeBase + 通用 mixin (id, created_at, updated_at)
│   │   ├── user.py                # User
│   │   ├── workspace.py           # Workspace
│   │   └── workspace_member.py    # WorkspaceMember
│   ├── schemas/
│   │   ├── auth.py                # LoginRequest/RegisterRequest/TokenResponse/MeResponse
│   │   └── workspace.py           # WorkspaceCreate/WorkspaceRead/MemberRead
│   ├── services/
│   │   ├── auth_service.py        # register, authenticate, issue_token
│   │   └── workspace_service.py   # create, list_for_user, add_member, get_role
│   └── api/v1/
│       ├── __init__.py
│       ├── router.py              # 聚合 v1_router
│       ├── auth.py                # /auth/register, /auth/login, /auth/me
│       ├── workspaces.py          # /workspaces (CRUD + members)
│       └── ml.py                  # /ml/health
├── alembic/                       # 现有 alembic.ini + versions 清空，重新 init
├── tests/
│   ├── conftest.py                # async fixture: db session, test_user, test_workspace
│   ├── test_auth.py
│   ├── test_workspace.py
│   └── test_ml_health.py
└── pyproject.toml                 # async deps + 改名
```

### 4.2 依赖变更

`pyproject.toml` 新增 / 修改：

```toml
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "python-multipart>=0.0.12",

    # async DB
    "sqlalchemy[asyncio]>=2.0.30",
    "aiosqlite>=0.20.0",
    "alembic>=1.13.0",

    # config & validation
    "pydantic>=2.7.0",
    "pydantic-settings>=2.3.0",
    "pydantic[email]>=2.7.0",     # EmailStr

    # auth
    "passlib[bcrypt]>=1.7.4",
    "python-jose[cryptography]>=3.3.0",  # JWT

    # ML backend
    "httpx>=0.27.0",
]
```

去除原有的 `psycopg2-binary` extra（暂不需要）。`pytest-asyncio` 保留。

### 4.3 数据模型（S0 仅 3 张表）

```python
# models/base.py
from datetime import datetime
from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
import uuid

class Base(DeclarativeBase):
    pass

class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

def gen_uuid() -> str:
    return str(uuid.uuid4())
```

```python
# models/user.py
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base, TimestampMixin, gen_uuid

class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    memberships: Mapped[list["WorkspaceMember"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
```

```python
# models/workspace.py
from sqlalchemy import String, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base, TimestampMixin, gen_uuid

class Workspace(Base, TimestampMixin):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(60), unique=True, index=True, nullable=False)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)

    members: Mapped[list["WorkspaceMember"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )
```

```python
# models/workspace_member.py
from sqlalchemy import String, ForeignKey, UniqueConstraint, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum
from .base import Base, TimestampMixin, gen_uuid

class WorkspaceRole(str, enum.Enum):
    OWNER = "owner"
    MEMBER = "member"

class WorkspaceMember(Base, TimestampMixin):
    __tablename__ = "workspace_members"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_workspace_member"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    role: Mapped[WorkspaceRole] = mapped_column(SAEnum(WorkspaceRole), nullable=False)

    workspace: Mapped[Workspace] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="memberships")
```

**说明**：
- UUID 用 `String(36)` 存（v4 字符串），SQLite 友好，未来切 Postgres 不需要改 schema。
- `Workspace.slug` 用于 URL 友好的路径（例：`/workspaces/japan-receipts/...`）。
- `owner_id` 是冗余字段（也能从 `WorkspaceMember.role=='owner'` 推出），但保留作为 invariant：每个 Workspace 必须有一个明确的 owner，删除 owner 用户时必须先转让。
- **删除外键策略（故意不一致）**：
  - `Workspace.owner_id ON DELETE RESTRICT`：不允许删除还在拥有 workspace 的用户，先调用 transfer-ownership 或删 workspace。
  - `WorkspaceMember.user_id ON DELETE CASCADE`：删用户时自动清理其普通成员关系（owner 关系会被上一条 RESTRICT 拦住）。
  - `WorkspaceMember.workspace_id ON DELETE CASCADE`：删 workspace 时连带清成员关系。
  - 这两条配合后效果：删用户时如果他还是某个 workspace 的 owner，整个删除失败；如果只是普通成员，他的成员关系自动被清。

### 4.4 SQLite 安全配置（database.py 关键代码）

```python
# core/database.py
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine, AsyncSession
from sqlalchemy import event
from app.core.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.DATABASE_URL,           # sqlite+aiosqlite:///./data/doc_intel.db
    echo=settings.SQL_ECHO,
    pool_pre_ping=True,
)

@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragma(dbapi_conn, _):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
```

### 4.5 Auth：JWT + bcrypt

- 密码哈希：`passlib[bcrypt]`，rounds=12（默认）。
- JWT：`python-jose`，HS256，密钥从 `settings.JWT_SECRET_KEY`（必须从环境变量读，启动时校验非空）。
- Token 形态：`{ "sub": user_id, "email": email, "exp": ts }`。Access token 过期 7 天（原型方便；后续可加 refresh token，S0 不做）。
- Token 通过 `Authorization: Bearer <token>` header 传递。
- 前端用 localStorage 持久化 token（原型简化；后续可改 httpOnly cookie，S0 不做）。

`core/security.py` 暴露：

```python
def hash_password(plain: str) -> str: ...
def verify_password(plain: str, hashed: str) -> bool: ...
def create_access_token(*, user_id: str, email: str) -> str: ...
def decode_access_token(token: str) -> dict | None: ...   # None on invalid/expired
```

### 4.6 API 端点（S0 全集）

| 方法 | 路径 | Auth | Body | 响应 | 说明 |
|---|---|---|---|---|---|
| POST | `/api/v1/auth/register` | 公开 | `{email, password, display_name}` | `{token, user}` | 注册并立即登录 |
| POST | `/api/v1/auth/login` | 公开 | `{email, password}` | `{token, user}` | 登录 |
| GET | `/api/v1/auth/me` | Bearer | — | `{user, workspaces: [{id, name, slug, role}]}` | 当前用户 + 所有 workspace 列表 |
| GET | `/api/v1/workspaces` | Bearer | — | `[Workspace + role]` | 我所属的 workspace 列表（同 me 里的字段，独立 endpoint 方便分页扩展） |
| POST | `/api/v1/workspaces` | Bearer | `{name, slug, description?}` | `Workspace` | 创建（创建者自动 owner） |
| GET | `/api/v1/workspaces/:wsid` | Bearer + 成员 | — | `Workspace + members` | 详情 |
| PATCH | `/api/v1/workspaces/:wsid` | Bearer + owner | `{name?, description?}` | `Workspace` | 更新（slug 不可改） |
| DELETE | `/api/v1/workspaces/:wsid` | Bearer + owner | — | 204 | 删除（cascade members） |
| POST | `/api/v1/workspaces/:wsid/members` | Bearer + owner | `{email, role}` | `Member` | 邀请已注册用户加入（找不到 email → 404） |
| DELETE | `/api/v1/workspaces/:wsid/members/:uid` | Bearer + owner | — | 204 | 移除成员 |
| GET | `/health` | 公开 | — | `{status, version}` | 后端自身健康检查 |
| GET | `/api/v1/ml/health` | Bearer | — | `{ml_status, ml_version, ml_url}` | 透传 ML backend `/health` |

> S0 **不做**：忘记密码、邮件验证、refresh token、邮件邀请未注册用户、SSO、API key（管理 API 不用 key）。

### 4.7 错误响应

沿用 API_anything 现有的统一错误格式（如果保留 `core/exceptions.py`）：

```json
{ "error": { "code": "invalid_credentials", "message": "Email or password incorrect." } }
```

S0 涉及的错误码：`invalid_credentials`、`email_already_registered`、`unauthorized`、`forbidden`、`workspace_not_found`、`user_not_found`、`workspace_slug_taken`、`ml_backend_unavailable`。

---

## 5. 前端架构

### 5.1 目标目录结构（S0 完成时）

```
<repo>/frontend/src/
├── App.tsx                        # 路由表
├── main.tsx                       # ReactDOM.render
├── lib/
│   ├── api-client.ts              # axios 实例（已存在）+ 注入 Authorization header
│   ├── auth-storage.ts            # localStorage 读写 token
│   └── toast.ts                   # （已存在）
├── stores/
│   ├── auth-store.ts              # Zustand: { user, token, workspaces, currentWorkspaceId, ...actions }
│   └── (其他旧 store 全部删除)
├── components/
│   ├── auth/
│   │   ├── LoginForm.tsx
│   │   └── RegisterForm.tsx
│   ├── layout/
│   │   ├── AppShell.tsx           # 顶栏 + 侧栏 + outlet
│   │   └── WorkspaceSwitcher.tsx  # 顶栏右侧切换器
│   └── ToastContainer.tsx         # （已存在）
└── pages/
    ├── auth/
    │   ├── LoginPage.tsx
    │   └── RegisterPage.tsx
    ├── DashboardPage.tsx          # 登录后落地：当前 workspace 概览（S0 时只显示 workspace 名 + members + "Coming soon: Projects"）
    ├── WorkspaceCreatePage.tsx    # 新建 workspace
    └── WorkspaceSettingsPage.tsx  # 成员管理（owner 可见）
```

### 5.2 路由表

```typescript
/                          → redirect to /dashboard if logged in else /login
/login                     → LoginPage
/register                  → RegisterPage
/dashboard                 → DashboardPage（默认 workspace；如果用户没有 workspace，跳到 /workspaces/new）
/workspaces/new            → WorkspaceCreatePage
/workspaces/:slug          → DashboardPage（指定 workspace）
/workspaces/:slug/settings → WorkspaceSettingsPage
```

未登录访问受保护路由 → 重定向到 `/login`。登录后从 `currentWorkspaceId` 决定默认 workspace。

### 5.3 Auth store（Zustand）核心 API

```typescript
interface AuthState {
  token: string | null;
  user: User | null;
  workspaces: WorkspaceWithRole[];
  currentWorkspaceId: string | null;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;             // GET /auth/me
  switchWorkspace: (workspaceId: string) => void;
  createWorkspace: (input: WorkspaceCreate) => Promise<Workspace>;
}
```

启动时（`main.tsx` 或 `AppShell` 挂载 effect）：从 localStorage 读 token，如果存在调 `refreshMe()` 验证有效；无效则清空。

### 5.4 axios 拦截器

- request：自动注入 `Authorization: Bearer ${token}`（如果有）
- response：401 → 调 `logout()` + 重定向 `/login`

### 5.5 UI 设计语言

继承 design-v2.md §7.1 的暗色主题色彩 / 排版系统（这是后续 S2 的主战场）。S0 阶段只用最少的样式：
- 登录 / 注册：居中卡片，`colors.surface` 背景
- AppShell：顶栏（logo + workspace switcher + user menu）+ 主内容区
- WorkspaceSwitcher：dropdown 列出我的所有 workspace + "+ 新建 workspace"
- Dashboard：欢迎语 + workspace 信息 + "项目即将上线" 占位

---

## 6. ML backend 集成（S0 仅 health 探活）

`backend/app/ml_client.py` 从 `doc-intel/backend/app/ml_client.py` 整体搬过来，做以下改动：

1. 把 `httpx.Client`（同步）改为 `httpx.AsyncClient`（异步），所有方法加 `async def`，`with` 改 `async with`。
2. `_request` 改为 async，所有调用方相应 await。
3. `predict()` 方法保留但 S0 不暴露给路由（S2 才用），先把 method signature 留住即可。
4. 新增依赖注入入口：

```python
# core/deps.py
from app.ml_client import MLClient

_singleton: MLClient | None = None

def get_ml_client() -> MLClient:
    global _singleton
    if _singleton is None:
        _singleton = MLClient()
    return _singleton
```

5. `api/v1/ml.py`：

```python
@router.get("/health")
async def ml_health(
    user: User = Depends(get_current_user),
    ml: MLClient = Depends(get_ml_client),
):
    try:
        h = await ml.health()
        return {"ml_status": "ok", "ml_version": h.get("version"), "ml_url": ml.base_url}
    except MLClientError as e:
        raise HTTPException(503, {"code": "ml_backend_unavailable", "message": str(e)})
```

---

## 7. Alembic 迁移

S0 完成时 alembic 状态：

1. 删除现有 `<repo>/backend/alembic/versions/*` 所有迁移文件（greenfield）。
2. 重新 `alembic init` 或保留现有 `alembic.ini`，更新 `env.py` 用 async engine（参考 alembic 官方 async cookbook）。
3. 生成第一个迁移：`alembic revision --autogenerate -m "S0: users, workspaces, workspace_members"`。
4. 跑 `alembic upgrade head`。

数据库文件路径默认 `<repo>/backend/data/doc_intel.db`（gitignored）。

---

## 8. 测试策略

S0 测试覆盖（pytest + pytest-asyncio）：

| 测试文件 | 关键 case |
|---|---|
| `test_auth.py` | register 成功 / 重复 email 报 409 / login 成功+wrong password / me 需要 token |
| `test_workspace.py` | owner 创建 workspace / list 只显示 my workspaces / 非成员访问 :wsid 报 403 / owner 邀请成员 / member 不能 邀请 / slug 唯一 |
| `test_ml_health.py` | mock httpx 返回 200 → ml_status=ok；mock 返回 500 → 503 ml_backend_unavailable |

**conftest.py 提供**：
- `db_session` fixture：每个测试一个 in-memory SQLite，自动建表
- `test_user` fixture：创建用户并返回 user + token
- `test_workspace` fixture：基于 test_user 创建 workspace
- `client` fixture：`httpx.AsyncClient` + ASGI transport

前端不要求自动化测试（S0 阶段）。手工 smoke 步骤见 §10。

---

## 9. 配置与环境变量

`.env`（gitignored）+ `.env.example`（committed）：

```bash
# Database
DATABASE_URL=sqlite+aiosqlite:///./data/doc_intel.db
SQL_ECHO=false

# Auth
JWT_SECRET_KEY=<run: openssl rand -hex 32>
JWT_ACCESS_TOKEN_EXPIRE_DAYS=7

# ML Backend
ML_BACKEND_URL=http://0.0.0.0:9090

# CORS
CORS_ORIGINS=http://localhost:5173

# Misc
LOG_LEVEL=INFO
APP_ENV=development
```

启动时 `Settings` 校验：`JWT_SECRET_KEY` 必须 ≥32 字符；`DATABASE_URL` 必须以 `sqlite+aiosqlite://` 或 `postgresql+asyncpg://` 开头。

---

## 10. Acceptance Criteria（S0 完成的客观判定）

人工 smoke flow（必须每步成功才算 S0 完成）：

1. `cd <repo>/backend && uv sync && uv run alembic upgrade head && uv run uvicorn app.main:app --reload` → 启动无报错，访问 `/health` 返回 ok。
2. `cd <repo>/frontend && npm install && npm run dev` → 浏览器打开 `http://localhost:5173`，自动跳到 `/login`。
3. 点 "注册" → 填 email/密码/显示名 → 提交 → 登录 → 跳到 `/workspaces/new`（因为没有 workspace）。
4. 创建 workspace `name=Demo, slug=demo` → 跳到 `/workspaces/demo` → 看到 dashboard 占位页。
5. 顶栏 workspace switcher 显示 `Demo`，下拉里有 "+ 新建 workspace"。
6. 再创建一个 workspace `name=Test2, slug=test2` → 切到它 → URL 变 `/workspaces/test2`。
7. 进入 `/workspaces/demo/settings`，邀请第二个用户（先在另一浏览器注册）→ 该用户登录后能在 switcher 里看到 Demo workspace 且 role=member。
8. 第二个用户访问 `/workspaces/demo/settings` → 看不到邀请按钮（因为不是 owner）。
9. 后端 `GET /api/v1/ml/health` 返回 `ml_status=ok`（前提 ML backend 已在 9090 运行）。如 ML backend 未启动，返回 503 + 友好错误。
10. 关闭后端、重启，所有数据保留（SQLite 持久化）。
11. `pytest` 全部通过（≥ 15 个 case）。

---

## 11. 风险与未决项

| 风险 | 缓解 |
|---|---|
| async SQLAlchemy 在 Alembic env.py 配置容易踩坑 | 直接抄官方 async template；conftest 用 in-memory SQLite，实际部署用文件 SQLite |
| 前端 axios 401 拦截器导致死循环 | 拦截器内判定不是 `/auth/login` 路径才跳转 |
| JWT secret 泄漏后所有 token 都得失效 | S0 阶段简化：手动改 secret，所有用户被迫重登。生产化在 S5+ 加 token 黑名单 / 短期 token + refresh |
| SQLite WAL 文件（`-wal`、`-shm`）忘记备份 | 备份 cron 用 `sqlite3 ".backup"` 命令，自动包含未 checkpoint 的 WAL 数据 |
| `mv API_anything → doc-intel` 后 git 链断裂 | git 自动检测 rename（≥50% 内容相似），历史保留 |

**未决项（不阻塞 S0 启动，留 spec review 决定）**：

- **是否真的执行 `mv` 改名**？我倾向是；如果你说 "不改名"，跳过 §3.1 即可，其他无影响。
- **JWT 过期时间 7 天合理吗**？short-token + refresh 机制要不要 S0 就做？我倾向 S0 不做，简化。
- **是否需要 "邀请未注册用户" 的功能**？这需要邮件发送基础设施。S0 不做，只能邀请已注册用户。

---

## 12. 工作量估算

| 步骤 | 估时 |
|---|---|
| §3 仓库改造（mv、tag、删除清单） | 0.5 h |
| §4.1-4.2 backend 骨架 + 依赖 | 1 h |
| §4.3 数据模型 + alembic 初始迁移 | 1.5 h |
| §4.4 SQLite 配置 + database.py | 0.5 h |
| §4.5 security.py（密码 + JWT） | 1 h |
| §4.6 auth + workspace 路由 + service 层 | 4 h |
| §6 ml_client async 化 + ml/health 路由 | 1 h |
| §5 前端 auth + workspace 骨架 | 6 h |
| §8 测试编写 | 3 h |
| §10 smoke 跑通 + 修 bug | 2 h |
| **总计** | **20.5 小时（约 3 个工作日）** |

---

## 13. 与后续 sub-spec 的衔接

S0 完成后，S1 直接在 `/workspaces/:slug` 路径下加 Project 列表 + 详情。不需要修改 §4 的任何模型表。Project 模型新增字段时跑新的 alembic migration。

S2 移植 workspace UI 时，把 API_anything 删掉的 `components/workspace-v2/*` 从 `pre-rebase` git tag 中 `git checkout pre-rebase -- frontend/src/components/workspace-v2/` 取回，再适配新的 store 结构。

---

## 14. 参考

- API_anything 设计圣经：`<repo>/design-v2.md`（保留不动）
- 上一代实现的 ml_client：`/Users/qinqiang02/colab/codespace/ai/doc-intel/backend/app/ml_client.py`
- doc-intel SSE 实现：`/Users/qinqiang02/colab/codespace/ai/doc-intel/backend/app/services/predict.py`、`routers/predictions.py`（S2 才用，S0 不动）
- 上一代 LS 评估逻辑：`label-studio/label_studio/data_manager/actions/document_evaluation.py`（S4 才用）
- SQLAlchemy async 文档：https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
- Alembic async cookbook：https://alembic.sqlalchemy.org/en/latest/cookbook.html#using-asyncio-with-alembic
