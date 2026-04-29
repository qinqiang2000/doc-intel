# doc-intel

> **文档智能提取自助平台** —— 上传 PDF/图片 → AI 提取字段 → 三栏交互核对 → 自然语言矫正 prompt → 一键生成可调用的 REST API。

---

## 功能

- 🔐 **多租户** — Email/密码注册 + JWT，Workspace 即租户边界
- 📁 **Project + Document** — 5 个内置模板（china_vat / us_invoice / japan_receipt / de_rechnung / custom），支持 PDF / 图片 / Excel 上传，软删除
- 🤖 **AI 提取** — Gemini / OpenAI 双引擎 + Mock，统一 async processor 接口
- 🖥️ **三栏工作台** — A 文档预览（react-pdf + bbox overlay）/ B 字段编辑 / C JSON（Flat / Detailed / Grouped 三种格式），bbox ↔ field 双向选中同步
- ✏️ **标注编辑** — bbox 拖拽/缩放/创建，字段 CRUD，全量 revision audit
- 🎯 **Ground Truth** — 文档可标 GT，作为 evaluation 的真值
- 💬 **NL 矫正** — 自然语言描述错误 → SSE 流式生成 revised prompt → 保存为版本 → 可激活
- 📜 **Prompt 版本** — 每个 Project 维护多版本 prompt，可激活某版作为 active
- 📊 **Evaluation** — 批量字段对比（exact / fuzzy / mismatch / missing），Excel 导出（Summary + Detail 双 sheet）
- 🔌 **API 发布** — 设 api_code → 创建 API key（仅返回一次）→ 公开端点 `/extract/:api_code` 接受 X-Api-Key

---

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | FastAPI + async SQLAlchemy 2.x + aiosqlite (WAL) + alembic |
| 前端 | Vite 8 + React 19 + TypeScript + Zustand + react-router 6 + react-pdf 9 + Tailwind |
| Auth | bcrypt（密码 + API key 一致 hash 策略，rounds=10）+ JWT |
| AI | google-genai（Gemini）/ openai（OpenAI），统一 AsyncProcessor 接口 |
| 测试 | pytest + httpx async / vitest + RTL |

---

## 快速启动

### 环境要求

| 工具 | 版本 |
|---|---|
| Python | 3.11+（推荐 uv 管理） |
| Node.js | 20+（pnpm 或 npm） |
| 网络 | 调真模型时需可访问 generativelanguage.googleapis.com / api.openai.com（本机 SOCKS 代理 OK） |

### 1. 克隆 + 装依赖

```bash
cd backend && uv sync && cd ..
cd frontend && npm install && cd ..
```

### 2. 配置 `.env`

`backend/.env`：

```bash
# 必填
JWT_SECRET_KEY=<至少 32 字符随机串>

# 选其一接入真模型
API_KEY=AIza...                 # Gemini
OPENAI_API_KEY=sk-...           # OpenAI

# 可选
USE_MOCK_DATA=                  # 留空 = 真模型；设 1 = 全程走 mock
DATABASE_URL=sqlite+aiosqlite:///./data/doc_intel.db
UPLOAD_DIR=./data/uploads
CORS_ORIGINS=["http://localhost:5173"]
ALL_PROXY=socks5://127.0.0.1:7890   # 如需代理
```

### 3. 跑 alembic + 启动

```bash
# 一键启动（依赖根目录 npm scripts，concurrently）
npm run dev

# 或分别启动
cd backend && uv run alembic upgrade head
cd backend && uv run uvicorn app.main:app --reload --port 8000

cd frontend && npm run dev   # http://localhost:5173
```

`scripts/run-dev.sh` 是另一个启动脚本，自动处理代理。

健康检查：

```bash
curl http://localhost:8000/health
# {"status":"ok","version":"0.1.0"}
```

---

## 项目结构

```
doc-intel/
├── backend/
│   ├── app/
│   │   ├── main.py                     # FastAPI 入口 + CORS + lifespan
│   │   ├── core/                       # config, database, security, exceptions, deps
│   │   ├── models/                     # User, Workspace, Project, Document, Annotation,
│   │   │                               # ProcessingResult, AnnotationRevision,
│   │   │                               # PromptVersion, EvaluationRun, EvaluationFieldResult,
│   │   │                               # ApiKey
│   │   ├── schemas/                    # Pydantic v2 请求/响应
│   │   ├── services/                   # 业务逻辑（auth, project, document, predict,
│   │   │                               # annotation, prompt, correction, evaluation,
│   │   │                               # api_publish, ...）
│   │   ├── api/v1/                     # HTTP 路由（auth, workspaces, projects,
│   │   │                               # documents, annotations, predict, prompts,
│   │   │                               # correction, evaluations, api_publish,
│   │   │                               # extract_public, engine, templates）
│   │   ├── engine/
│   │   │   ├── processors/             # mock / gemini / openai / piaozone
│   │   │   ├── prompt/                 # 模板 prompt 构建
│   │   │   ├── analyzers/              # 输出校验/规整
│   │   │   └── utils.py                # should_use_mock_data 等
│   │   └── templates/builtin.py        # 5 个内置 Project 模板
│   ├── alembic/                        # 迁移链 d9e2957d1511 → ... → a3c7d9e2b4f5
│   ├── tests/                          # 184 测试（pytest async）
│   └── pyproject.toml
│
├── frontend/
│   ├── src/
│   │   ├── pages/                      # Auth, Workspace*, Project*, EvaluatePage,
│   │   │                               # PublishPage, WorkspacePage（三栏工作台）
│   │   ├── components/
│   │   │   ├── workspace/              # DocumentCanvas, BboxOverlay,
│   │   │   │                           # AnnotationEditor, JsonPreview,
│   │   │   │                           # StepIndicator, CorrectionDrawer, ...
│   │   │   ├── predict/                # PredictModal（批量 SSE）
│   │   │   ├── upload/                 # 上传组件
│   │   │   └── layout/                 # AppShell, ToastContainer
│   │   ├── stores/                     # auth-store, project-store, predict-store
│   │   └── lib/                        # api client, fetch helpers
│   └── package.json                    # vitest, RTL（33 个 .test.tsx）
│
├── docs/
│   ├── design-v2.md                    # UX 圣经（1100+ 行）
│   ├── superpowers/specs/              # 当前活的 8 个 sub-spec（S0-S5）
│   ├── superpowers/plans/              # 实施 plan
│   ├── acceptance/                     # 手工验收指引
│   └── legacy/                         # API_anything 时期早期文档（已过时）
│
├── scripts/run-dev.sh
├── docker-compose.yml
└── package.json                        # concurrently dev
```

---

## API 概览

后端在 `/api/v1` 下，OpenAPI doc 见 http://localhost:8000/docs。

### 认证（不需 token）

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
GET    /api/v1/auth/me                  # 需 Bearer token
```

返回的 `access_token` 用作后续所有 authed 请求的 `Authorization: Bearer <token>`。

### Workspace / Project / Document

```
GET    /api/v1/workspaces
POST   /api/v1/workspaces
PATCH  /api/v1/workspaces/{wid}
GET    /api/v1/workspaces/{wid}
DELETE /api/v1/workspaces/{wid}

GET    /api/v1/workspaces/{wid}/projects
POST   /api/v1/workspaces/{wid}/projects
GET    /api/v1/workspaces/{wid}/projects/{pid}
PATCH  /api/v1/workspaces/{wid}/projects/{pid}
DELETE /api/v1/workspaces/{wid}/projects/{pid}     # soft-delete

GET    /api/v1/projects/{pid}/documents
POST   /api/v1/projects/{pid}/documents            # multipart 上传
GET    /api/v1/projects/{pid}/documents/{did}
GET    /api/v1/projects/{pid}/documents/{did}/preview
PATCH  /api/v1/projects/{pid}/documents/{did}      # 改 GT / 重命名
DELETE /api/v1/projects/{pid}/documents/{did}
```

### 提取与标注

```
POST   /api/v1/projects/{pid}/predict                          # 同步单文档
POST   /api/v1/projects/{pid}/batch-predict                    # SSE batch
GET    /api/v1/documents/{did}/annotations
POST   /api/v1/documents/{did}/annotations
PATCH  /api/v1/documents/{did}/annotations/{aid}
DELETE /api/v1/documents/{did}/annotations/{aid}
```

### Prompt 版本与 NL 矫正

```
GET    /api/v1/projects/{pid}/prompt-versions
POST   /api/v1/projects/{pid}/prompt-versions                  # 保存新版
PATCH  /api/v1/projects/{pid}/active-prompt                    # 激活/取消
DELETE /api/v1/projects/{pid}/prompt-versions/{vid}
POST   /api/v1/projects/{pid}/documents/{did}/correct          # SSE 7 事件
```

### Evaluation

```
POST   /api/v1/projects/{pid}/evaluations
GET    /api/v1/projects/{pid}/evaluations
GET    /api/v1/evaluations/{rid}
DELETE /api/v1/evaluations/{rid}
GET    /api/v1/evaluations/{rid}/excel
```

### API 发布（S5）

```
POST   /api/v1/projects/{pid}/publish              # 设 api_code
POST   /api/v1/projects/{pid}/unpublish
GET    /api/v1/projects/{pid}/api-keys
POST   /api/v1/projects/{pid}/api-keys             # 创建 → 全 key 仅此一次返回
DELETE /api/v1/projects/{pid}/api-keys/{kid}
```

### 公开提取端点（无需登录，但需 API key）

```
POST   /extract/{api_code}
       Header: X-Api-Key: dik_<8 字符 prefix>-<剩余>
       Body:   multipart/form-data file=@xxx.pdf
```

错误码：401 缺 / 错 key，403 项目已 unpublish，404 api_code 不存在，413 文件过大。

---

## 端到端调用示例

```bash
# 注册
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"Pass1234!","workspace_name":"Acme"}' \
  | jq .access_token | tr -d '"' > /tmp/token

TOKEN=$(cat /tmp/token)

# 创建 Project
PID=$(curl -s -X POST http://localhost:8000/api/v1/workspaces/<wid>/projects \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Receipts","template_key":"china_vat"}' | jq -r .id)

# 上传 + 提取
DID=$(curl -s -X POST http://localhost:8000/api/v1/projects/$PID/documents \
  -H "Authorization: Bearer $TOKEN" -F "file=@invoice.pdf" | jq -r .id)
curl -X POST http://localhost:8000/api/v1/projects/$PID/predict \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"document_id\":\"$DID\"}"

# 发布 + 拿 key
curl -X POST http://localhost:8000/api/v1/projects/$PID/publish \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"api_code":"receipts"}'
KEY=$(curl -s -X POST http://localhost:8000/api/v1/projects/$PID/api-keys \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"prod"}' | jq -r .key)

# 公开调用
curl -X POST http://localhost:8000/extract/receipts \
  -H "X-Api-Key: $KEY" -F "file=@invoice.pdf"
```

更完整流程见 [`docs/acceptance/2026-04-29-e2e-manual-acceptance.md`](docs/acceptance/2026-04-29-e2e-manual-acceptance.md)。

---

## 测试

```bash
cd backend && uv run pytest                     # 184 backend tests
cd frontend && npm test                         # 33 test files / 250 tests
```

E2E 真 Gemini 验收（手工）：见 `docs/acceptance/`。

---

## 开发说明

### 数据库迁移

```bash
cd backend
uv run alembic revision --autogenerate -m "describe change"
uv run alembic upgrade head
uv run alembic downgrade -1                     # 回滚一步
```

迁移链：`d9e2957d1511` (S0 users/workspaces) → `cc4a010e73f1` (S1 projects/documents) → `80840f9d0efa` (S2a annotations/results) → `e1b5c0d3f7a4` (S3 prompt_versions) → `f2a8d4e6c5b1` (S4 evaluations) → `a3c7d9e2b4f5` (S5 api_keys + project ALTER)。

### 添加 processor

1. 在 `backend/app/engine/processors/` 创建 `my_processor.py`，继承 `BaseProcessor`，实现 `async def extract(file_bytes, filename, prompt) -> dict`
2. 在 `factory.py` 注册 key
3. 模板里把 `recommended_processor` 设成新 key

### 添加内置模板

编辑 `backend/app/templates/builtin.py`，加一个 dict：`key`, `name`, `description`, `default_prompt`, `recommended_processor`, `field_schema`。

### 前端开发

工作台核心组件：
- `WorkspacePage.tsx` — 三栏壳
- `DocumentCanvas.tsx` — react-pdf + 图片渲染
- `BboxOverlay.tsx` — bbox 渲染 + 拖拽/创建
- `AnnotationEditor.tsx` — B 栏字段编辑
- `JsonPreview.tsx` — Flat / Detailed / Grouped
- `StepIndicator.tsx` — Upload → Predict → Correct → Tune → Format → GenerateAPI
- `CorrectionDrawer.tsx` — NL 矫正 SSE

State：`predict-store.ts`（Zustand）持有 currentDoc / annotations / promptVersions / evaluations / apiKeys 全部域。

---

## 平台状态

8 个 sub-spec（S0 / S1 / S2a / S2b1 / S2b2 / S3 / S4 / S5）feature-complete。Spec 与 plan 全部位于 `docs/superpowers/`。

最后一次集成验证（2026-04-29）：13 步 E2E 真 Gemini 走通，accuracy 在 NL 矫正后从 0.778 → 0.889。

## License

MIT
