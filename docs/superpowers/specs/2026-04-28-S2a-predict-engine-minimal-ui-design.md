# S2a — Predict 引擎 + 极简结果视图

**日期**：2026-04-28
**Spec 编号**：S2a（共 6 sub-spec：S0–S2a/b–S5；S2 拆为 S2a 后端+极简 UI / S2b 三栏工作台）
**前置**：tag `s1-complete`（180 tests pass）
**状态**：草稿，待 review

---

## 1. 背景

S0 + S1 完成后，客户能上传文档但**还跑不了 LLM 抽提**。S2a 是 doc-intel 的"价值闭环第一刀"：让任何一份上传的文档可以**点一下按钮跑出 ProcessingResult JSON + 可编辑字段列表**。

S2a **故意不做**三栏工作台 UX（design-v2 §7.6）——那是 S2b 的事。S2a 用最简单的 modal 让 predict 路径端到端跑通，先验证后端 + Annotation 模型正确，再进 UX 升级。

S2 完整范围被拆为：

- **S2a（本 spec）**：数据模型 + Predict（POST 单文档 + SSE 批量）+ Annotation CRUD + Next-unreviewed + 极简 UI（modal + drawer）。**预计 22-25h**。
- **S2b（后续 spec）**：三栏工作台（DocumentCanvas + FieldEditor + JsonPreview）+ bbox 联动 + 6 步骤 state machine + 文档切换器 + 工作台 URL。**预计 22-25h**。

S2a 完成后客户能跑通"上传 → predict → 看 JSON → 编辑字段 → 保存"。S2b 是 UX 升级，不增加新数据/路由。

---

## 2. LS-features 覆盖

| LS-N | 在 S2a 的落地 |
|---|---|
| **LS-3** Per-predict 模型/Prompt 覆盖 | `POST /predict` body `{prompt_override?, processor_key_override?}`，覆盖 Project 默认；不影响 Project 配置 |
| **LS-4** 批量 re-predict | `POST /api/v1/projects/:pid/batch-predict` body `{document_ids[]}` → SSE per-doc 进度 |
| **LS-5** "下一份未 review" 队列 | `GET /api/v1/projects/:pid/documents/next-unreviewed` 返回第一个无任何 ProcessingResult 的 Document |
| **LS-7** Annotation 审计字段 | Annotation 加 `updated_by_user_id`；新增 `annotation_revisions` 历史表，每次 PATCH/DELETE 写一行 |

不在 S2a 范围（推到后续）：

- **LS-2 Annotation 级 GT**：Annotation.is_ground_truth 字段在 S2a 加上但前端在 S4 才用
- **LS-6 字段级筛选**：S4
- 三栏工作台（design-v2 §7.6）→ S2b
- PromptVersion + 自然语言矫正（design-v2 §9.2）→ S3
- API 发布 / `/extract` → S5

---

## 3. 数据模型

### 3.1 ProcessingResult

```python
# app/models/processing_result.py
from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, gen_uuid

if TYPE_CHECKING:
    from app.models.document import Document


class ProcessingResultSource(str, enum.Enum):
    PREDICT = "predict"
    MANUAL_EDIT = "manual_edit"


class ProcessingResult(Base, TimestampMixin):
    __tablename__ = "processing_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)  # per-Document 自增
    structured_data: Mapped[dict] = mapped_column(JSON, nullable=False)  # AI 输出的结构化 JSON
    inferred_schema: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # 推断 schema
    prompt_used: Mapped[str] = mapped_column(Text, nullable=False)  # 实际使用的 prompt 全文
    processor_key: Mapped[str] = mapped_column(String(120), nullable=False)  # gemini|gemini-2.5-flash
    source: Mapped[ProcessingResultSource] = mapped_column(
        SAEnum(ProcessingResultSource, name="processing_result_source"), nullable=False
    )
    created_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    # 软删保留位（S2a 不暴露 API，纯内部）：如果将来需要回滚，可以软删某个版本
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    document: Mapped["Document"] = relationship()
```

**说明**：
- `version` 每次 predict 相对该 Document 自增（先查当前最大 + 1）。不全局唯一。
- `structured_data` 是 LLM 直接输出的 JSON（AI 给什么存什么）；`inferred_schema` 由 schema_generator（暂用简易实现）从 structured_data 推断字段类型，存 JSON Schema-like dict。
- `prompt_used` 记录**实际使用**的 prompt 全文（含 expected_fields 注入和 prompt_override），便于 reproduce。
- `processor_key` 是 `factory.create()` 的参数，形如 `gemini|gemini-2.5-flash`、`mock|mock-v1.0`。
- `source` 区分 `predict`（LLM 调用产物）和 `manual_edit`（用户在 modal 里编辑后保存的"快照"，S2a 默认不做这种保存——只编辑 Annotation）。
- 不加 `(document_id, version)` 唯一约束因为 SQLite + 高并发 predict 可能撞，由 service 层用事务保证递增。

### 3.2 Annotation

```python
# app/models/annotation.py
from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, Float, ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, gen_uuid

if TYPE_CHECKING:
    from app.models.document import Document


class AnnotationSource(str, enum.Enum):
    AI_DETECTED = "ai_detected"  # 由 predict 生成
    MANUAL = "manual"            # 用户手动添加


class AnnotationFieldType(str, enum.Enum):
    STRING = "string"
    NUMBER = "number"
    DATE = "date"
    ARRAY = "array"
    OBJECT = "object"


class Annotation(Base, TimestampMixin):
    __tablename__ = "annotations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    field_name: Mapped[str] = mapped_column(String(120), nullable=False)
    field_value: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    field_type: Mapped[AnnotationFieldType] = mapped_column(
        SAEnum(AnnotationFieldType, name="annotation_field_type"),
        default=AnnotationFieldType.STRING, nullable=False,
    )
    bounding_box: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # {x, y, w, h, page} 百分比坐标
    source: Mapped[AnnotationSource] = mapped_column(
        SAEnum(AnnotationSource, name="annotation_source"), nullable=False
    )
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_ground_truth: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # LS-7 audit
    created_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    document: Mapped["Document"] = relationship()
```

**说明**：
- Annotation 是**当前真值**——不挂在某个 ProcessingResult 版本上，而是 Document-级的最新编辑态。新一轮 predict 会**覆盖** AI-detected Annotation（即 source=ai_detected 的行删除/替换），保留 `source=manual` 的行（用户手动加的字段不丢）。
- `bounding_box` JSON `{x: 0.58, y: 0.08, w: 0.20, h: 0.035, page: 0}` 百分比坐标。S2a 不渲染（无三栏 UI），但保存预留供 S2b 用。
- `field_type` 为 S3 prompt 生成提供类型 hint，S2a 默认 `string`。
- `is_ground_truth` 是 LS-2 Annotation 级 GT，S2a 字段就位但前端不暴露（Document 级 GT 在 S1 已实现）。
- LS-7 `updated_by_user_id`：每次 PATCH 由 service 设置为当前用户。

### 3.3 AnnotationRevision

```python
# app/models/annotation_revision.py
from __future__ import annotations

import enum
from typing import TYPE_CHECKING

from sqlalchemy import Enum as SAEnum, ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, gen_uuid


class RevisionAction(str, enum.Enum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"


class AnnotationRevision(Base, TimestampMixin):
    __tablename__ = "annotation_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    annotation_id: Mapped[str] = mapped_column(
        ForeignKey("annotations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    action: Mapped[RevisionAction] = mapped_column(
        SAEnum(RevisionAction, name="annotation_revision_action"), nullable=False
    )
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # 改前快照（create 时为 null）
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)   # 改后快照（delete 时为 null）
    changed_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
```

**说明**：
- 每次 Annotation `POST/PATCH/DELETE` 都写一行。
- `before`/`after` 完整 JSON 快照（Annotation 整行 dict），用空间换简单查询。
- S2a 不暴露查询 API，只是埋数据。S5+ 可以加 admin 视图。

---

## 4. Migration

新建 `backend/alembic/versions/<auto>_s2a_processing_results_annotations.py`：

- create `processing_results`：PK id, FK document_id CASCADE, FK created_by RESTRICT
- create `annotations`：PK id, FK document_id CASCADE, FK created_by RESTRICT, FK updated_by_user_id RESTRICT nullable
- create `annotation_revisions`：PK id, FK annotation_id CASCADE, FK changed_by RESTRICT

S0/S1 表不动。

---

## 5. Predict 服务

### 5.1 Prompt 合成（S2a 自包含）

```python
# app/services/predict.py
DEFAULT_PROMPT_TEMPLATE = """
你是一个文档信息提取专家。请从这份文档中提取以下字段，输出严格的 JSON：

{fields_section}

如果某个字段在文档里找不到，请省略该字段（不要输出 null/空字符串）。
所有金额相关字段输出为数字（不带货币符号、千分位逗号）。
日期统一用 YYYY-MM-DD 格式。
""".strip()


def build_default_prompt(template_key: str | None) -> str:
    """从 Project.template_key 派生默认 prompt。"""
    from app.templates.builtin import get_template
    if template_key:
        tpl = get_template(template_key)
        if tpl and tpl.expected_fields:
            fields = "\n".join(f"  - {f}" for f in tpl.expected_fields)
            return DEFAULT_PROMPT_TEMPLATE.format(fields_section=fields)
    return "请提取这份文档的关键字段并以 JSON 输出。"
```

S3 写 PromptVersion 时会替换这个函数为查 PromptVersion 表。

### 5.2 单文档 predict（同步）

```python
# app/services/predict.py
async def predict_single(
    db: AsyncSession,
    *,
    document: Document,
    project: Project,
    user: User,
    prompt_override: str | None = None,
    processor_key_override: str | None = None,
) -> ProcessingResult:
    # 1. 解析 processor_key
    if processor_key_override:
        processor_key = processor_key_override
    else:
        tpl = get_template(project.template_key) if project.template_key else None
        processor_type = tpl.recommended_processor if tpl else "gemini"
        processor_key = processor_type  # factory.create 会 fill default model_name from config

    # 2. 解析 prompt
    prompt = prompt_override or build_default_prompt(project.template_key)

    # 3. 调 engine
    parts = processor_key.split("|", 1)
    p_type = parts[0]
    p_kwargs = {"model_name": parts[1]} if len(parts) == 2 else {}
    processor = DocumentProcessorFactory.create(p_type, **p_kwargs)
    file_path = str(storage.absolute_path(document.file_path))
    raw_json_str = await processor.process_document(file_path, prompt)

    # 4. 解析 LLM 输出
    structured = _parse_llm_output(raw_json_str)  # uses extract_json + json.loads
    schema = _infer_schema(structured)

    # 5. 写 ProcessingResult（事务内 version 递增）
    next_version = await _next_version(db, document.id)
    pr = ProcessingResult(
        document_id=document.id,
        version=next_version,
        structured_data=structured,
        inferred_schema=schema,
        prompt_used=prompt,
        processor_key=processor_key,
        source=ProcessingResultSource.PREDICT,
        created_by=user.id,
    )
    db.add(pr)
    await db.flush()

    # 6. 同步 Annotations：删除该 document 上 source=ai_detected 的旧行，按 structured 写新行
    await _replace_ai_annotations(db, document.id, structured, user.id)

    await db.commit()
    await db.refresh(pr)
    return pr
```

`_parse_llm_output` 用 `app.engine.utils.extract_json` 取 markdown json 块，回退到原文 `json.loads`。Gemini/OpenAI 默认输出 JSON object 或数组，我们规范化为 `{fields: {...}}` 或 `{items: [...]}` 字典。

`_infer_schema` 朴素实现：遍历 dict，按值类型推断（str/int/float/list/dict）。

### 5.3 批量 predict（SSE）

```python
# app/services/predict.py
async def predict_batch_stream(
    db_factory,  # async session factory
    *,
    project_id: str,
    document_ids: list[str],
    user_id: str,
    prompt_override: str | None = None,
    processor_key_override: str | None = None,
) -> AsyncIterator[dict]:
    """Yields events: {document_id, status, processing_result_id?, error?}.
    The router wraps each yielded dict into an SSE event line."""
    succeeded = 0
    failed = 0
    for doc_id in document_ids:
        yield {"document_id": doc_id, "status": "started"}
        try:
            async with db_factory() as db:
                # re-fetch document + project + user fresh per iteration
                doc = await db.get(Document, doc_id)
                proj = await db.get(Project, project_id)
                user = await db.get(User, user_id)
                if doc is None or proj is None or doc.project_id != project_id:
                    yield {"document_id": doc_id, "status": "failed", "error": "document_not_found"}
                    failed += 1
                    continue
                pr = await predict_single(
                    db, document=doc, project=proj, user=user,
                    prompt_override=prompt_override,
                    processor_key_override=processor_key_override,
                )
            yield {"document_id": doc_id, "status": "completed", "processing_result_id": pr.id}
            succeeded += 1
        except Exception as e:
            yield {"document_id": doc_id, "status": "failed", "error": str(e)[:200]}
            failed += 1
    yield {"_final": True, "total": len(document_ids), "succeeded": succeeded, "failed": failed}
```

每次循环开新 session（每文档独立事务，单个失败不连带回滚已成功的）。

---

## 6. API 端点

### 6.1 Predict

| 方法 | 路径 | 权限 | Body | 响应 |
|---|---|---|---|---|
| POST | `/api/v1/projects/{pid}/documents/{did}/predict` | 成员 | `{prompt_override?, processor_key_override?}` | `ProcessingResultRead` 200（同步阻塞）|
| POST | `/api/v1/projects/{pid}/batch-predict` | 成员 | `{document_ids: [str], prompt_override?, processor_key_override?}` | `text/event-stream` SSE |
| GET | `/api/v1/projects/{pid}/documents/next-unreviewed` | 成员 | — | `DocumentRead` 200 / 404 `no_unreviewed_documents` |

#### 6.1.1 单 doc predict 响应
```json
{
  "id": "<pr-uuid>",
  "document_id": "<did>",
  "version": 3,
  "structured_data": { "...llm output..." },
  "inferred_schema": { "...types..." },
  "prompt_used": "你是一个文档信息提取专家...",
  "processor_key": "gemini|gemini-2.5-flash",
  "source": "predict",
  "created_by": "<uid>",
  "created_at": "..."
}
```

#### 6.1.2 SSE 事件协议
```
event: predict_progress
data: {"document_id":"d-1","status":"started"}

event: predict_progress
data: {"document_id":"d-1","status":"completed","processing_result_id":"pr-x"}

event: predict_progress
data: {"document_id":"d-2","status":"failed","error":"engine_error: ..."}

event: done
data: {"total":2,"succeeded":1,"failed":1}
```

每个 SSE 行 `data:` 后是单行 JSON。客户端用浏览器原生 `EventSource` 不支持 POST/header；S2a 用 `fetch + ReadableStream` 解析 SSE（与 doc-intel-legacy 同模式，参考其 `useSSE` hook 思路移植）。

### 6.2 Annotation CRUD

| 方法 | 路径 | 权限 | Body | 响应 |
|---|---|---|---|---|
| GET | `/api/v1/documents/{did}/annotations` | 成员 | — | `[AnnotationRead]` |
| POST | `/api/v1/documents/{did}/annotations` | 成员 | `{field_name, field_value?, field_type?, bounding_box?, is_ground_truth?}` | `AnnotationRead` 201 |
| PATCH | `/api/v1/documents/{did}/annotations/{aid}` | 成员 | `{field_value?, field_type?, bounding_box?, is_ground_truth?}` | `AnnotationRead` |
| DELETE | `/api/v1/documents/{did}/annotations/{aid}` | 成员 | — | 204 |

POST 默认 `source=manual`。PATCH 默认更新 `updated_by_user_id` + 写 AnnotationRevision。DELETE 软删（设 `deleted_at`，不真删 — Annotation 级 GT 历史可能有用）。

GET 默认过滤 `deleted_at IS NULL`。

### 6.3 错误码（S2a 新增）

| code | HTTP | 触发 |
|---|---|---|
| `predict_failed` | 500 | engine 调用异常 |
| `processor_not_available` | 400 | processor_key_override 引用了不存在的 processor |
| `document_too_large_for_processor` | 413 | 某些 processor 有自身大小上限（gemini 50MB、openai 20MB），超出时 |
| `no_unreviewed_documents` | 404 | next-unreviewed 返回时所有文档都已 predict 过 |
| `annotation_not_found` | 404 | annotation deleted 或不存在 |
| `predict_in_progress` | 409 | 同一 document 已有 predict 在跑（用 advisory lock 或 `last_predict_started_at` 字段；S2a **暂不实现并发保护**，留 S2b 加） |

---

## 7. Frontend

### 7.1 新依赖

无新依赖。`fetch + ReadableStream` 解析 SSE 用浏览器原生。

### 7.2 新 store：`predict-store`

```typescript
// frontend/src/stores/predict-store.ts
interface PredictState {
  loading: Record<string, boolean>;       // documentId -> in-flight
  results: Record<string, ProcessingResult>;  // documentId -> latest PR (cached)
  batchProgress: BatchProgress | null;

  predictSingle(projectId: string, documentId: string, opts?: PredictOptions): Promise<ProcessingResult>;
  predictBatch(projectId: string, documentIds: string[], opts?: PredictOptions): Promise<void>;  // streams via SSE, updates batchProgress
  loadAnnotations(documentId: string): Promise<Annotation[]>;
  patchAnnotation(documentId: string, annotationId: string, patch: AnnotationPatch): Promise<Annotation>;
  deleteAnnotation(documentId: string, annotationId: string): Promise<void>;
  addAnnotation(documentId: string, input: NewAnnotation): Promise<Annotation>;
  loadNextUnreviewed(projectId: string): Promise<Document | null>;
}
```

### 7.3 SSE helper

```typescript
// frontend/src/lib/sse.ts
export async function* streamSse<T>(
  url: string,
  init: RequestInit
): AsyncIterable<{ event: string; data: T }> {
  const resp = await fetch(url, init);
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const lines = block.split("\n");
      let event = "message";
      let data = "";
      for (const l of lines) {
        if (l.startsWith("event:")) event = l.slice(6).trim();
        else if (l.startsWith("data:")) data += l.slice(5).trim();
      }
      if (data) yield { event, data: JSON.parse(data) as T };
    }
  }
}
```

### 7.4 新组件 / 改动

| 文件 | 类型 | 说明 |
|---|---|---|
| `components/predict/PredictModal.tsx` | 新 | 单文档 predict modal：spinner → 2 列（缩略图 + 字段编辑器） |
| `components/predict/AnnotationEditor.tsx` | 新 | Modal 内的字段列表 + 行内编辑 + 加字段按钮 |
| `components/predict/BatchPredictDrawer.tsx` | 新 | 右侧抽屉：批量进度行表，每文档一行 ⋯/✓/✗ |
| `pages/ProjectDocumentsPage.tsx` | 改 | 每行加 "Predict" 按钮；表头加多选 checkbox 列；顶部加 "+ Batch Predict（N selected）"、"▶ Next Unreviewed" 按钮 |
| `stores/predict-store.ts` | 新 | 见 §7.2 |
| `lib/sse.ts` | 新 | 见 §7.3 |

### 7.5 PredictModal UX

```
┌─────────────────────────────────────────────────┐
│ Predict — invoice.pdf                       [✕] │
├──────────────────┬──────────────────────────────┤
│                  │  字段                         │
│   📄 thumbnail   │  ┌─────────────────────────┐ │
│   (preview img   │  │ invoice_number: INV-001 │ │
│    via /preview) │  │ total_amount:   ¥1,234  │ │
│                  │  │ ...                     │ │
│   filename:      │  │ [+ 添加字段]            │ │
│   invoice.pdf    │  └─────────────────────────┘ │
│                  │  v3 · gemini-2.5-flash       │
│                  │  predicted by Alice 2m ago   │
├──────────────────┴──────────────────────────────┤
│              [Re-predict] [关闭] [保存]         │
└─────────────────────────────────────────────────┘
```

- 打开 modal 时若文档已有 ProcessingResult，直接显示最新版（不自动 predict）。若无，自动触发 predict（spinner 30s）。
- "Re-predict" 按钮：清掉本地未保存编辑，触发新一轮 predict（生成新版本）。
- 字段行：行内输入框直接编辑 field_value，回车 / blur 调 PATCH。`ai_detected` 字段标 🤖 chip，`manual` 标 ✏️ chip。
- "+ 添加字段" 弹小表单：name + value + type → POST /annotations。
- 关闭 modal 时若有未保存编辑，confirm 提示。

### 7.6 BatchPredictDrawer UX

```
┌─────────────────────────────┐
│ Batch Predict (3 docs)  [✕] │
├─────────────────────────────┤
│ ✓ alpha.pdf  v3             │
│ ⋯ beta.pdf   in progress    │
│ ✗ gamma.pdf  failed: ...    │
├─────────────────────────────┤
│              [完成]         │
└─────────────────────────────┘
```

- 选中行后顶栏 "+ Batch Predict (N)" 按钮启用。
- 点击后右侧抽屉打开，前端起 SSE 流。
- 完成后保留抽屉直到用户手动关闭，可点失败行查看 error 详情。

### 7.7 Next-unreviewed 按钮

- ProjectDocumentsPage 顶部右侧加 "▶ Next Unreviewed" 按钮。
- 点击 → `GET /next-unreviewed`：
  - 200 → 直接打开 PredictModal for 该文档（自动触发 predict）
  - 404 `no_unreviewed_documents` → toast "已全部 predict 过"

---

## 8. 测试策略

### 8.1 Backend（pytest）— 目标 ≥30 new

| 文件 | 测试要点 | 数量 |
|---|---|---|
| `test_processing_result_model.py` | create + version 自增 + cascade delete + source enum | 5 |
| `test_annotation_model.py` | create + cascade delete + audit fields + soft delete + bounding_box JSON | 6 |
| `test_annotation_revision_model.py` | revision 表跟随 PATCH/DELETE 写入 + before/after 形态 | 3 |
| `test_predict_endpoint.py` | 单 doc predict 成功（mock processor）+ prompt_override + processor_key_override + 错误处理（unsupported processor）+ Annotation 同步 + version 递增 | 8 |
| `test_batch_predict_endpoint.py` | SSE 协议 + 部分失败 + done event + 空 document_ids + 跨 project doc 拒绝 | 6 |
| `test_annotation_api.py` | GET / POST / PATCH / DELETE + revision 写入 + 软删过滤 | 6 |
| `test_next_unreviewed.py` | 返回首个无 PR 文档 + 全部 predict 后 404 + 软删文档跳过 | 3 |

预期：80（S1）+ ~37 = **≥117 backend tests**。

### 8.2 Frontend（vitest + RTL）— 目标 ≥25 new

| 文件 | 测试要点 | 数量 |
|---|---|---|
| `__tests__/predict-store.test.ts` | predictSingle / predictBatch SSE / annotation CRUD / nextUnreviewed | 8 |
| `__tests__/sse.test.ts` | streamSse 解析多事件 / event:data 配对 / 流结束 | 3 |
| `predict/__tests__/PredictModal.test.tsx` | 加载 latest result / spinner / 编辑保存 / re-predict / 关闭确认 | 6 |
| `predict/__tests__/AnnotationEditor.test.tsx` | 行内编辑 / + 添加字段 / 删除 / 类型切换 | 5 |
| `predict/__tests__/BatchPredictDrawer.test.tsx` | SSE 进度更新 / 部分失败 / done event 后保留状态 | 4 |
| `pages/__tests__/ProjectDocumentsPage.test.tsx` 增量 | predict 按钮 / batch 多选 / next-unreviewed 按钮 | 3 (增量) |

预期：100（S1）+ ~29 = **≥129 frontend tests**。

### 8.3 TDD 强制

所有 backend + frontend 单元先写失败测试，看 RED，再实现，看 GREEN，再 commit。每次 dispatch prompt 含强制要求。

---

## 9. Acceptance Criteria

人工 smoke flow（spec §10 14 步加 S2a 增量）：

1. 启动 backend + frontend，登录 alice
2. 进入 S1 创建好的 Receipts project，已有 alpha/beta.pdf（重新 seed）
3. 点 alpha.pdf 行的 "Predict"
4. Modal 出现 spinner，30s 内（mock processor）显示 ProcessingResult JSON + Annotation 字段列表
5. 行内编辑某字段 → blur → PATCH 调用成功 → modal 内显示 saved
6. 点 "Re-predict" → 新 version 出现，version 标记从 v1 → v2
7. 关闭 modal，回到列表
8. 多选 alpha + beta → 点 "+ Batch Predict (2)"
9. 抽屉出现，每文档逐个变成 ✓
10. 点 "▶ Next Unreviewed"（空 project 测试）→ 404 toast
11. 在 DB 里验证 `processing_results` 表 ≥ 3 行（alpha v1+v2 + beta v1）
12. 在 DB 里验证 `annotations` 表有 ai_detected 行 + 用户手动 PATCH 后 `updated_by_user_id` 非 null
13. 在 DB 里验证 `annotation_revisions` 至少有 1 行 update
14. backend 重启 → 重登 alice → 所有数据保留
15. `pytest` + `vitest` 全绿（≥117 backend + ≥129 frontend = ≥246 tests）

---

## 10. 风险与未决项

| 风险 | 缓解 |
|---|---|
| LLM 调用 30s 同步阻塞 uvicorn worker | 单文档场景接受（用户在 modal 等）；批量走 SSE 不阻塞；并发过载 → S5+ 加 worker pool |
| LLM 输出不是合法 JSON | `_parse_llm_output` 用 try/except + extract_json fallback；失败时 ProcessingResult.structured_data 存 `{"_raw": "..."}` + source=predict（便于人工 review）；ML processor 已经在 prompt 里要求 JSON 格式 |
| Annotation 同步覆盖了用户编辑 | predict 只删 `source=ai_detected`，保留 `manual`。同名 manual 字段不被覆盖（按 field_name 去重） |
| 并发 predict 同一 document → version race | S2a 不加锁，靠事务 SERIALIZABLE-like 行为 + version=max+1 select。极端并发可能撞 unique（如果加约束）→ S2a 不加 `(document_id, version)` unique，留待 S5+ 加 advisory lock |
| LLM 实际跑（非 mock）需要 API key | smoke 用 `mock` processor 跑通；真 LLM 由用户配置 .env GEMINI_API_KEY 等再测 |

**未决项**（可在 review 时表态）：
- 是否 S2a 就给 PredictModal 加 "查看历史版本" 下拉？默认推到 S2b。
- Annotation 编辑后是否立即保存还是按"保存按钮"批量？默认每字段 blur 即 PATCH（更直观），保存按钮只是"完成确认"语义。

---

## 11. 工作量估算

| 阶段 | 估时 |
|---|---|
| §3 数据模型 + alembic + 6 model tests | 2.5 h |
| §5 predict service（含 SSE）+ 14 endpoint tests | 4 h |
| §6.2 Annotation router + revision + 6 tests | 2 h |
| §6.1 next-unreviewed + 3 tests | 0.5 h |
| 前端 sse.ts helper + 3 tests | 1 h |
| 前端 predict-store + 8 tests | 2 h |
| 前端 PredictModal + AnnotationEditor + 11 tests | 4 h |
| 前端 BatchPredictDrawer + 4 tests | 2 h |
| 前端 ProjectDocumentsPage 集成 + 3 tests | 1.5 h |
| smoke + s2a-complete tag | 1.5 h |
| **总计** | **21 h（约 3 工作日）** |

## 12. 与后续衔接

S2b 起手：
- 在 PredictModal 底下加版本切换器（已有 ProcessingResult 多版本）
- 重组 modal → 三栏工作台 `/workspaces/:slug/projects/:pid/workspace?doc=:did` 路由
- DocumentCanvas 用 react-pdf 渲染 + bbox 叠加（Annotation.bounding_box 已就位）
- FieldEditor 复用 S2a 的 AnnotationEditor 逻辑
- JsonPreview 直接展示 ProcessingResult.structured_data
- 6 步骤 state machine 包装上面三栏

S2a 数据模型不动；S2b 全是 UX 重组。

---

## 13. 参考

- LS 经验保留清单：`docs/superpowers/specs/2026-04-27-ls-features-to-preserve.md`
- API_anything design-v2：`design-v2.md` §5.2（ProcessingResult/Annotation 模型字段）、§6.1（API endpoints）、§7.5（SSE 事件）、§9.1-§9.4（流程图）
- doc-intel-legacy SSE 实现参考：`/Users/qinqiang02/colab/codespace/ai/doc-intel-legacy/backend/app/services/predict.py` + `routers/predictions.py`（不直接复用，作为 SSE 协议参考）
- engine module（已在 S0 移植）：`backend/app/engine/processors/factory.py`、`backend/app/engine/utils.py:extract_json`
