# S1 — Project + Document 管理

**日期**：2026-04-28
**Spec 编号**：S1（共 6 个 sub-spec：S0–S5）
**前置**：S0 完成，tag `s0-complete`（auth + workspace + engine 模块齐全，107 tests 通过）
**状态**：草稿，待 review

---

## 1. 背景

S0 完成了基础设施。S1 在其上加 **Project**（= ApiDefinition 合一）和 **Document**（上传的文件）两个核心域对象，让客户在 Workspace 下能：

1. 选模板新建 Project（"日本領収書"、"中国增值税发票"...）
2. 拖拽多文件上传到 Project
3. 查看文档列表，筛选状态/类型/搜索文件名
4. 标记某文档为 Ground Truth（S4 Evaluate 用）
5. 软删除 Project / Document

S1 **不**做的事（明确划入后续 sub-spec）：

- ProcessingResult / Annotation 模型 + predict 流程 → S2
- 工作台三栏 UI 与字段编辑 → S2
- Prompt 版本 + 自然语言矫正 → S3
- 字段级筛选 / 命名视图保存 → S4
- API 发布、ApiKey、`/extract/:api_code` → S5
- piaozone / S3 / 外部源 connector → S5+（Storage Importer 抽象不在 S1 day-one；YAGNI）
- ProjectTemplate DB 表 + admin CRUD → 永远不做（YAGNI；硬编码内置足够）
- Project 克隆 / 统计仪表 / 多人锁 / Webhook / 多种导出格式 → 永远不做或 S5+

完整决策上下文见 `docs/superpowers/specs/2026-04-27-ls-features-to-preserve.md`。

---

## 2. 上下文：与 LS 经验保留清单的对应

本 sub-spec 必须覆盖 LS-features-to-preserve.md 列出的下列项：

| LS-N | 在 S1 的落地形式 |
|---|---|
| **LS-1**（Data Manager 文档列表） | Document 列表 API 支持 status / file_type / search / GT / 分页排序；前端表格化呈现 |
| **LS-2**（Ground Truth 标记） | Document 加 `is_ground_truth: bool`；S2 加 Annotation-级时再细化 |
| **LS-6**（字段级筛选语义） | S1 仅 **基础**筛选（status/file_type/search/GT），字段级和命名视图 → S4 |
| **LS-10**（Project 创建向导 + 默认配置） | 5 个内置硬编码模板；Project 加 `template_key` 字段记录用户选了哪个 |
| **LS-11**（批量上传 + piaozone 导入） | S1 落多文件拖拽上传；piaozone / S3 connector → S5+，**不在 S1 加抽象层占位** |

不在 S1 范围的 LS-N（明确推后或不做）：LS-3、LS-4、LS-5（→ S2），LS-7（→ S2），LS-8 / LS-9 / LS-12（→ S5+ 单独 spec），LS-13 / LS-14 / LS-15（永不）。

---

## 3. S0 关联清理

### 3.1 删除 dashboard 的 engine processors 块

S0 在 `frontend/src/pages/DashboardPage.tsx` 临时显示 `/api/v1/engine/info` 输出作为占位（"S1 阶段会在这里加上 Project 列表..."）。S1 把整页改成 Project 列表，那个 engine processors 信息块**直接删除**——它在 S2 工作台会以更细的处理器选择 UI 复活。

### 3.2 路由变更

| 路由 | S0 状态 | S1 状态 |
|---|---|---|
| `/workspaces/:slug` | DashboardPage 占位 | **Project 列表页**（沿用名字 DashboardPage 或重命名为 ProjectListPage） |
| `/workspaces/:slug/projects/new` | 不存在 | **Project 创建向导** |
| `/workspaces/:slug/projects/:pid` | 不存在 | **Document 列表 + 上传 widget + GT 切换** |
| `/workspaces/:slug/projects/:pid/settings` | 不存在 | **Project 设置**（重命名、模板信息只读、危险区删除） |
| `/workspaces/:slug/settings` | WorkspaceSettingsPage | 不变 |
| `/dashboard` | 重定向到默认 workspace | 不变 |

S2 后续将在 `/workspaces/:slug/projects/:pid/workspace` 路径下加 6 步骤工作台——本 spec 不预留路径外的占位文件。

---

## 4. 数据模型

### 4.1 Project

```python
# app/models/project.py
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, gen_uuid

if TYPE_CHECKING:
    from app.models.document import Document


class Project(Base, TimestampMixin):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("workspace_id", "slug", name="uq_project_workspace_slug"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(60), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    template_key: Mapped[str | None] = mapped_column(String(60), nullable=True)
    created_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    # Soft delete
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    # S5 placeholders — left nullable in S1, populated by /publish in S5
    api_code: Mapped[str | None] = mapped_column(
        String(60), unique=True, index=True, nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(20), default="draft", nullable=False
    )  # draft | active | deprecated
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    documents: Mapped[list["Document"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
```

**说明**：

- `workspace_id` ON DELETE CASCADE：Workspace 删了它下属 Project 一起删
- `created_by` ON DELETE RESTRICT：删用户前先转所有权（与 Workspace.owner_id 同模式）
- `(workspace_id, slug)` 唯一：同 Workspace 内 slug 不重，跨 Workspace 可重
- `deleted_at` 索引：列表 API 默认过滤 `deleted_at IS NULL`
- `template_key`：取值 `china_vat | us_invoice | japan_receipt | de_rechnung | custom`，**不**做外键（模板是代码常量不是 DB 表）；nullable 是为了未来允许"无模板创建"
- S5 占位字段：`api_code`、`status`、`published_at` 在 S1 全 nullable / 默认 `draft`，**不**暴露给 S1 的 schema/API（避免客户写入），但建表带上避免 S5 再加迁移

### 4.2 Document

```python
# app/models/document.py
from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, gen_uuid

if TYPE_CHECKING:
    from app.models.project import Project


class DocumentStatus(str, enum.Enum):
    UPLOADING = "uploading"
    READY = "ready"
    FAILED = "failed"


class Document(Base, TimestampMixin):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)  # 原始文件名（用户看到的）
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)  # 存储路径（相对 UPLOAD_DIR）
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)  # bytes
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[DocumentStatus] = mapped_column(
        SAEnum(DocumentStatus, name="document_status"), default=DocumentStatus.UPLOADING, nullable=False
    )
    is_ground_truth: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    uploaded_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    # Soft delete
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    project: Mapped["Project"] = relationship(back_populates="documents")
```

**说明**：

- `project_id` ON DELETE CASCADE：Project 真删（不是软删）时一起删
- `is_ground_truth`：S1 仅 Document 级；S2 加 Annotation 时再细化
- `status` 状态机：upload 期间是 `uploading`；上传完成 → `ready`；写盘失败 → `failed`。S1 阶段无异步 LLM 处理，所以 `ready` 之后状态不再变（S2 加 `processing` / `processed` 由 ProcessingResult 跟踪，不复用此字段）

### 4.3 内置模板（不是 DB 表）

```python
# app/templates/builtin.py
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProjectTemplate:
    key: str
    display_name: str
    description: str
    expected_fields: list[str]  # 字段名列表，S2/S3 用来生成初始 prompt
    recommended_processor: str  # gemini | openai | piaozone | mock


BUILTIN_TEMPLATES: list[ProjectTemplate] = [
    ProjectTemplate(
        key="china_vat",
        display_name="🇨🇳 中国增值税发票",
        description="标准增值税专用发票/普通发票字段提取",
        expected_fields=[
            "invoice_number", "invoice_date", "buyer_name", "buyer_tax_id",
            "seller_name", "seller_tax_id", "total_amount", "tax_amount",
            "amount_in_words", "items",
        ],
        recommended_processor="gemini",
    ),
    ProjectTemplate(
        key="us_invoice",
        display_name="🇺🇸 US Standard Invoice",
        description="US-style invoice with vendor / customer / line items",
        expected_fields=[
            "invoice_number", "invoice_date", "due_date", "vendor_name",
            "customer_name", "subtotal", "tax", "total", "currency", "items",
        ],
        recommended_processor="gemini",
    ),
    ProjectTemplate(
        key="japan_receipt",
        display_name="🇯🇵 日本領収書",
        description="日本式领收书（小票）字段提取",
        expected_fields=[
            "doc_type", "merchant_name", "issue_date", "total_amount",
            "tax_amount", "currency",
        ],
        recommended_processor="gemini",
    ),
    ProjectTemplate(
        key="de_rechnung",
        display_name="🇩🇪 Deutsche Rechnung",
        description="德式发票字段提取（含 USt-IdNr.）",
        expected_fields=[
            "rechnungsnummer", "rechnungsdatum", "kunde_name", "ust_id",
            "nettobetrag", "umsatzsteuer", "gesamtbetrag", "items",
        ],
        recommended_processor="gemini",
    ),
    ProjectTemplate(
        key="custom",
        display_name="✨ 自定义",
        description="空模板，字段在工作台中由用户定义",
        expected_fields=[],
        recommended_processor="gemini",
    ),
]


def get_template(key: str) -> ProjectTemplate | None:
    return next((t for t in BUILTIN_TEMPLATES if t.key == key), None)


VALID_TEMPLATE_KEYS: set[str] = {t.key for t in BUILTIN_TEMPLATES}
```

**说明**：

- `expected_fields` 是字段名列表（不含中文 label、不含类型、不含校验规则）——S2 写 PromptVersion 时用这些名字生成 "请提取以下字段：..." 默认 prompt
- `recommended_processor` 是字符串，与 `app/engine/processors/factory.py` 注册名一致
- `display_name` 含国旗 emoji 走 design-v2 §7.4 风格
- 修改模板需要改代码 + commit；这是有意为之，避免运行时配置漂移

---

## 5. 存储

### 5.1 本地 FS

文件存到 `${UPLOAD_DIR}/{document_uuid}.{ext}`，扁平不嵌套：

- 不按 workspace_id / project_id 分目录——避免软删后 orphan 目录、避免重命名时改路径
- 扩展名从 mime_type 推断（pdf/png/jpg/jpeg/xlsx/xls/csv），未知类型用 `bin`
- `Document.file_path` 存相对路径 `{document_uuid}.{ext}`，不含 UPLOAD_DIR 前缀（迁移友好）

### 5.2 storage.py 接口

```python
# app/services/storage.py
from __future__ import annotations

import uuid as _uuid
from pathlib import Path

from app.core.config import get_settings


_EXT_BY_MIME = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
    "text/csv": "csv",
}


def ext_for_mime(mime_type: str) -> str:
    return _EXT_BY_MIME.get(mime_type, "bin")


def save_bytes(data: bytes, mime_type: str) -> tuple[str, str]:
    """Save raw bytes; return (document_uuid, file_path).
    file_path is relative to settings.UPLOAD_DIR.
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
    settings = get_settings()
    return Path(settings.UPLOAD_DIR) / rel_path


def delete_file(rel_path: str) -> None:
    """Idempotent delete — missing file is not an error."""
    abs_path = absolute_path(rel_path)
    if abs_path.exists():
        abs_path.unlink()
```

**故意不做**：StorageBackend 抽象类。S1 只本地 FS，S5+ 真要 S3 时再写抽象。YAGNI。

### 5.3 上传约束

- **单文件大小上限**：50MB（在 settings 里加 `MAX_UPLOAD_SIZE: int = 50 * 1024 * 1024`，由路由层校验，超过返回 413）
- **单 Project 文件数**：无上限（S5+ 加配额）
- **单次批量数**：无上限（前端串行调用 `POST /documents`，每次 1 个文件——server 端不做批量端点）
- **允许的 mime_type**：白名单 `application/pdf`、`image/png`、`image/jpeg`、`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`、`text/csv`，其他返回 `unsupported_file_type`（400）

---

## 6. API 端点

### 6.1 Projects

`/api/v1/workspaces/{workspace_id}/projects/*` 嵌套路由，要求 Bearer + Workspace 成员。

| 方法 | 路径 | 权限 | Body / Query | 响应 | 说明 |
|---|---|---|---|---|---|
| GET | `/api/v1/workspaces/{wsid}/projects` | 成员 | `?include_deleted=false` | `[ProjectRead]` | 列表，默认过滤软删 |
| POST | `/api/v1/workspaces/{wsid}/projects` | 成员 | `{name, slug, description?, template_key}` | `ProjectRead` 201 | 创建（创建者 = `created_by`） |
| GET | `/api/v1/workspaces/{wsid}/projects/{pid}` | 成员 | — | `ProjectDetail`（含模板信息只读 + 文档计数） | 详情 |
| PATCH | `/api/v1/workspaces/{wsid}/projects/{pid}` | 成员 | `{name?, description?}` | `ProjectRead` | 更新（slug 不可改） |
| DELETE | `/api/v1/workspaces/{wsid}/projects/{pid}` | 成员 | — | 204 | 软删（设 `deleted_at`） |
| POST | `/api/v1/workspaces/{wsid}/projects/{pid}/restore` | 成员 | — | `ProjectRead` | 恢复软删 |

### 6.1.1 Templates（全局，非 workspace-scoped）

| 方法 | 路径 | 权限 | 响应 | 说明 |
|---|---|---|---|---|
| GET | `/api/v1/templates` | 任何登录用户 | `[TemplateRead]` | 列出 5 个内置模板（前端创建向导用） |

### 6.2 Documents

`/api/v1/projects/{project_id}/documents/*` 嵌套路由，要求 Bearer + Project 所属 Workspace 的成员。Project 软删后这些路由返回 404。

| 方法 | 路径 | 权限 | Body / Query | 响应 | 说明 |
|---|---|---|---|---|---|
| POST | `/api/v1/projects/{pid}/documents` | 成员 | `multipart/form-data` 单 file | `DocumentRead` 201 | 上传 1 个文件；超过 50MB → 413 |
| GET | `/api/v1/projects/{pid}/documents` | 成员 | `?status=&mime_type=&q=&is_ground_truth=&sort_by=&order=&page=&page_size=` | `{items: [DocumentRead], total, page, page_size}` | 分页列表 |
| GET | `/api/v1/projects/{pid}/documents/{did}` | 成员 | — | `DocumentRead` | 详情 |
| GET | `/api/v1/projects/{pid}/documents/{did}/preview` | 成员 | — | `application/octet-stream` | 流式返回原文件（`Content-Disposition: inline; filename=...`） |
| PATCH | `/api/v1/projects/{pid}/documents/{did}` | 成员 | `{is_ground_truth?: bool}` | `DocumentRead` | S1 仅暴露 `is_ground_truth` 一字段；filename 后续可加 |
| DELETE | `/api/v1/projects/{pid}/documents/{did}` | 成员 | — | 204 | 软删（不删磁盘文件） |

> **磁盘文件何时真删？** S1 只软删（设 `deleted_at`），磁盘保留。一个独立的清理脚本 `scripts/purge_deleted.py`（**不在 S1 范围**，S5+ 加）会扫描 `deleted_at < now() - 30 days` 的文档，调 `storage.delete_file()` + 真删行。

### 6.3 列表筛选语义

`GET /documents` 查询参数：

- `status`：`uploading | ready | failed`，可重复（OR），如 `?status=ready&status=failed`
- `mime_type`：精确匹配，可重复
- `q`：filename 子串模糊（SQLite `LIKE %q%`，大小写不敏感）
- `is_ground_truth`：`true | false`
- `sort_by`：`created_at | updated_at | filename | file_size`，默认 `created_at`
- `order`：`asc | desc`，默认 `desc`
- `page`：1-based，默认 1
- `page_size`：默认 20，上限 100

返回 envelope：

```json
{
  "items": [...],
  "total": 123,
  "page": 1,
  "page_size": 20
}
```

### 6.4 错误码

S1 涉及的新错误码：

| code | HTTP | 触发场景 |
|---|---|---|
| `project_not_found` | 404 | Project 不存在或已软删 |
| `project_slug_taken` | 409 | 同 Workspace 内 slug 已存在 |
| `invalid_template_key` | 422 | template_key 不在内置 5 个里 |
| `document_not_found` | 404 | Document 不存在或已软删 |
| `unsupported_file_type` | 400 | mime_type 不在白名单 |
| `file_too_large` | 413 | 文件超过 50MB |
| `upload_failed` | 500 | 写盘失败（status 设 `failed`，文件回滚） |

---

## 7. Pydantic Schemas

```python
# app/schemas/project.py
from __future__ import annotations

import re
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$")


class TemplateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    key: str
    display_name: str
    description: str
    expected_fields: list[str]
    recommended_processor: str


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=3, max_length=60)
    description: str | None = Field(default=None, max_length=500)
    template_key: str  # 必填，"custom" 表示无模板

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        v = v.strip().lower()
        if not _SLUG_RE.match(v):
            raise ValueError("slug must be lowercase alphanumeric with hyphens, 3-60 chars")
        return v


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    workspace_id: str
    name: str
    slug: str
    description: str | None
    template_key: str | None
    created_by: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class ProjectDetail(ProjectRead):
    template: TemplateRead | None  # null 当 template_key="custom" 或 None
    document_count: int  # 软删后不计


# app/schemas/document.py
from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, ConfigDict


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    filename: str
    file_path: str
    file_size: int
    mime_type: str
    status: str
    is_ground_truth: bool
    uploaded_by: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class DocumentUpdate(BaseModel):
    is_ground_truth: bool | None = None


class DocumentList(BaseModel):
    items: list[DocumentRead]
    total: int
    page: int
    page_size: int
```

**注意**：`ProjectRead` 不含 S5 的 `api_code` / `status` / `published_at` 字段——这些由 S5 spec 加到 schema。S1 客户端看不到也不能写。

---

## 8. 前端

### 8.1 新增页面

| 文件 | 路由 | 职责 |
|---|---|---|
| `pages/ProjectListPage.tsx` | `/workspaces/:slug` | 列出所属 Project，"+ 新建" 按钮跳到向导 |
| `pages/ProjectCreatePage.tsx` | `/workspaces/:slug/projects/new` | 选模板 + 填名称/slug/描述 → 创建 |
| `pages/ProjectDocumentsPage.tsx` | `/workspaces/:slug/projects/:pid` | Document 列表 + 上传 widget + 筛选 + GT 切换 + 删除 |
| `pages/ProjectSettingsPage.tsx` | `/workspaces/:slug/projects/:pid/settings` | 重命名 / 描述 / 模板信息只读 / 危险区删除 |

### 8.2 改 `App.tsx`

把现有的 `<Route path="/dashboard" element={<DashboardPage />} />` 替换为 `<Navigate to="/workspaces" replace />`（实际上由 AppShell 的 currentWorkspaceId 自动跳到 `/workspaces/:slug`）。把 `/workspaces/:slug` 改成 `<ProjectListPage />`。

### 8.3 删除 `DashboardPage.tsx` 的 engine processors 块

S0 占位，S1 完整删除（整个 file 由 ProjectListPage 替换；DashboardPage 整文件删除，App.tsx 的 import 也删）。

### 8.4 新 store：project-store

```typescript
// frontend/src/stores/project-store.ts
interface ProjectState {
  projects: Project[];          // 当前 workspace 下的 projects
  templates: Template[];         // 5 个内置模板（GET /templates 后缓存）
  loading: boolean;
  error: string | null;

  loadProjects: (workspaceId: string) => Promise<void>;
  loadTemplates: () => Promise<void>;
  createProject: (workspaceId: string, input: ProjectCreateInput) => Promise<Project>;
  deleteProject: (projectId: string) => Promise<void>;
  // S1 不做：updateProject / restoreProject — 在 ProjectSettingsPage 内联调 api 即可
}
```

Document store **不**单独建——文档列表与具体 Project 强绑定，在 `ProjectDocumentsPage` 里用本地 useState + useEffect 管理。如果将来发现需要跨页面共享再抽 store。

### 8.5 上传组件

`components/upload/DocumentUploader.tsx`：

- 拖拽区 + 隐藏 `<input type="file" multiple>`
- 选中文件后逐个 `POST /documents`（串行，进度逐个展示）
- 单文件 >50MB 客户端先校验拒绝（不浪费网络）
- 失败的文件保留在列表显示错误，可重试
- 全部完成后触发回调，父组件刷新文档列表

### 8.6 列表筛选 UI

`ProjectDocumentsPage.tsx` 顶部工具栏：

- 文件名搜索 input（debounced 300ms）
- 状态下拉（All / Ready / Uploading / Failed）
- 类型下拉（All / PDF / Image / Excel / CSV）
- GT 切换（All / Only GT / Non-GT）
- 排序下拉 + 顺序切换

下方表格列：filename / size / mime / status / GT chip / created_at / 操作（设 GT / 删除 / 预览）

---

## 9. 测试策略

### 9.1 后端（pytest）

| 文件 | 测试要点 | 数量估计 |
|---|---|---|
| `test_project.py` | CRUD + slug 唯一 + template_key 校验 + 软删 + 恢复 + 跨 workspace 隔离 + RBAC | 8-10 |
| `test_document.py` | 上传成功 + 大小限制 + 类型白名单 + 列表筛选 + GT toggle + 软删 + 跨 project 隔离 | 10-12 |
| `test_storage.py` | save_bytes / ext_for_mime / absolute_path / delete_file 幂等 | 4 |
| `test_templates.py` | GET /templates 返回 5 个 + 每个有 expected_fields | 2 |

预期累计：S0 的 45 + S1 的 ~26 = **71+ 后端测试**。

### 9.2 前端（vitest + RTL）

| 文件 | 测试要点 | 数量 |
|---|---|---|
| `__tests__/project-store.test.ts` | loadProjects / loadTemplates / createProject / deleteProject + 错误路径 | 6 |
| `pages/__tests__/ProjectListPage.test.tsx` | 渲染列表 / 空状态 / "+新建" 跳转 / 删除确认 | 4 |
| `pages/__tests__/ProjectCreatePage.test.tsx` | 模板选择 + 表单提交 + 错误 + auto-slug | 5 |
| `pages/__tests__/ProjectDocumentsPage.test.tsx` | 加载列表 / 上传 / 筛选 / GT toggle / 删除 / 分页 | 8 |
| `pages/__tests__/ProjectSettingsPage.test.tsx` | 重命名 / 删除流程 / 非成员被拒 | 4 |
| `components/upload/__tests__/DocumentUploader.test.tsx` | 多文件选择 / 大小拦截 / 类型拦截 / 进度 / 失败重试 | 6 |

预期累计：S0 的 68 + S1 的 ~33 = **100+ 前端测试**。

### 9.3 TDD 强制

所有 backend + frontend 单元都按 superpowers TDD 红→绿→提交。subagent dispatch prompt 必须包含 RED→GREEN 强制要求（参考 S0/T13-T17 的成功范式）。

---

## 10. Acceptance Criteria（S1 完成的客观判定）

人工 smoke flow（每步必通过）：

1. 启动 backend / frontend，登录 alice，进入 Demo workspace（沿用 S0 数据）
2. 看到 Project 列表（空），点"+ 新建 Project"
3. 选模板 `🇯🇵 日本領収書`，name=Receipts、slug=receipts → 创建 → 跳到 `/workspaces/demo/projects/<pid>`
4. 上传 3 个 PDF（拖拽多文件） → 列表里出现 3 行，状态 = `ready`
5. 上传一个 100MB 的文件 → 客户端拒绝 + 错误提示
6. 上传一个 .docx 文件 → 服务端 400 unsupported_file_type
7. 切第一个文档 GT 标记，列表 chip 变绿
8. 筛选 GT only → 只剩 1 行；切回 All → 3 行
9. 搜索 filename 子串 → 只剩匹配的
10. 删除一个文档 → 列表少一行；DB 里 `deleted_at` 非 null（手动 sqlite3 验证）
11. 进入 Project 设置页 → 删除 Project → 跳回 `/workspaces/demo`，列表无该 Project
12. `pytest` + `vitest` 全绿（≥ 71 backend + ≥ 101 frontend = ≥ 172 tests，含 S0 留存）
13. 后端重启后，所有数据保留（含 GT 标记 + 软删状态）
14. Bob（Demo member）能看到 Receipts，但 Bob 自己的 workspace（如有）看不到 Receipts

---

## 11. 风险与未决项

| 风险 | 缓解 |
|---|---|
| 前端逐个串行上传 N 个文件，慢 | S1 接受这个权衡（简单、稳定）；若客户抱怨，S2+ 改并行（每次最多 3 个并发） |
| `Document.file_path` 与 `data/uploads/` 物理目录耦合 | 当前 `storage.py` 是唯一文件 I/O 出口；将来改 S3 只改 storage.py + Document 不改 schema |
| 软删大量积压占磁盘 | S1 不做清理脚本；记到 S5+ todo |
| 模板硬编码改动需要 commit + 部署 | 内部使用接受，5 个模板预期 12 个月稳定；真要动态再 S5+ 加 DB 表 |

**未决项**（非阻塞，可在 review 阶段表态）：

- **是否暴露 PATCH 修改 filename**？S1 默认不做。客户用错文件名一般直接删了重传。
- **是否给 Document 加 `tags: list[str]`**？LS-1 提到"分组"。S1 暂不做——分组可以用 GT 标记 + 后续视图（S4）实现。
- **Project Settings 页是否能改 `template_key`**？默认不做（语义不清：换模板后已传文档怎么办？）。

---

## 12. 工作量估算

| 步骤 | 估时 |
|---|---|
| §3 + §4 模型 + alembic migration | 2 h |
| §5 storage.py + 测试 | 1 h |
| §6 + §7 Projects router + service + schemas + 测试 | 3 h |
| §6 + §7 Documents router + service + 上传 + 测试 | 3.5 h |
| §6 templates router + 内置常量 | 0.5 h |
| §8 ProjectListPage + project-store | 2 h |
| §8 ProjectCreatePage（模板向导） | 2 h |
| §8 ProjectDocumentsPage + DocumentUploader + 列表筛选 | 4 h |
| §8 ProjectSettingsPage | 1 h |
| §10 smoke + 收尾 | 1.5 h |
| **总计** | **20.5 h（约 3 工作日）** |

与 S0 同量级；S1 比 S0 多了"模型 + 路由 + UI 三件套各两次"，但每件都比 S0 的 auth/JWT 简单，所以总时长接近。

---

## 13. 与后续 sub-spec 的衔接

S2（工作台 + Predict）将：

- 在 `/workspaces/:slug/projects/:pid` 路径下加 `/workspace?doc=:docId` 子路由（design-v2 §7.6 三栏）
- 加 `ProcessingResult` + `Annotation` 模型，外键到 Document（S1 已就位）
- 用 `Project.template_key` → `BUILTIN_TEMPLATES[k].expected_fields` → 生成初始 PromptVersion
- 用 `Project.template_key` → `BUILTIN_TEMPLATES[k].recommended_processor` → 设置 Project 默认 model

S2 不修改 S1 的任何 model schema。S5 才回填 Project 的 `api_code` / `published_at` 等字段。

---

## 14. 参考

- LS 经验保留清单：`docs/superpowers/specs/2026-04-27-ls-features-to-preserve.md`
- API_anything 设计 v2：`design-v2.md` §5.2（Document 模型字段参考）、§7.4（国家模板列表）
- S0 spec：`docs/superpowers/specs/2026-04-27-S0-foundation-design.md`
- 上一代 LS Project 模型（参考字段，不复用代码）：`/Users/qinqiang02/colab/codespace/ai/doc-intel-legacy/backend/app/models/project.py`（如果还需要某个字段灵感）
