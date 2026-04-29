# doc-intel E2E 手工验收指引（S0 → S5 全链路）

> 验收范围：8 个 sub-spec（S0 / S1 / S2a / S2b1 / S2b2 / S3 / S4 / S5）串联。
> 验收时间：约 30 分钟（含 LLM 等待）。
> 前置：本机有 SOCKS 代理可访问 Google Gemini / OpenAI；已发放真实 API key；端口 8000 / 5173 空闲。

---

## 0. 准备

### 0.1 环境变量
在 `backend/.env`（或启动脚本注入）：

```bash
# 必须 — 选其一即可。优先用 Gemini，便宜且快
API_KEY=AIza...                 # Google Gemini key（推荐）
OPENAI_API_KEY=sk-...           # OpenAI key（备选）

# 可选
USE_MOCK_DATA=                  # 留空。若设为 1 会走 mock，不调用真模型，验收时禁用
ALL_PROXY=socks5://127.0.0.1:7890  # 你的 SOCKS 代理地址
```

> **关键**：验收时 `USE_MOCK_DATA` 必须是空。`predict_service.predict_single` 会先读这个变量，非空就走 mock。

### 0.2 干净 DB
为避免历史数据干扰，建议从空库开始：

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
mv data/doc_intel.db data/doc_intel.db.bak.$(date +%s) 2>/dev/null || true
alembic upgrade head
```

### 0.3 启动服务
两个终端：

```bash
# T1 — 后端
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
source .venv/bin/activate
uvicorn app.main:app --port 8000 --reload

# T2 — 前端
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
pnpm dev   # 或 npm run dev，跑在 5173
```

健康检查：
```bash
curl -s http://localhost:8000/api/v1/health   # → {"status":"ok"}
```

### 0.4 准备样本文件
任意 1 张发票/收据 PDF 即可，示例：
```
/Users/qinqiang02/colab/codespace/ai/demo-invoice-ai/Source.gv.pdf
```
这张 PDF 已用于自动化 smoke。它是一份芬兰发票，含：
- 发票号 3744516
- 日期 2024-11-27
- buyer: HONOR TECHNOLOGIES FINLAND OY，VAT `FI 32034811`
- seller: F9 DISTRIBUTION OY，VAT `FI23476220`
- 总额 62750（含税 12750）

---

## 1. S0 — 注册 + 登录（Auth + Workspace）

### 步骤
1. 浏览器开 http://localhost:5173 → 跳到 `/auth/register`
2. 注册账号
   - email：`acceptance@example.com`
   - password：`Pass1234!`
   - workspace name：`Acceptance`
3. 自动跳转到 `/workspaces/acceptance/projects`

### 期望
- ✅ Header 右上角显示邮箱
- ✅ 列表为空，有 "Create Project" 按钮
- ✅ DB：`users`, `workspaces`, `workspace_members` 各新增 1 行

---

## 2. S1 — 创建 Project + 上传文档

### 步骤
1. 点 "Create Project"
2. 选模板 **China VAT Invoice**（任意发票类模板都行）
3. name=`Receipts`，slug 自动 `receipts`
4. 创建后跳转到 `/workspaces/acceptance/projects/<pid>/documents`
5. 点 "Upload Document"，选样本 PDF
6. 上传完成后文档列表出现 `Source.gv.pdf`，状态 READY

### 期望
- ✅ 文档列表显示文件名 + 大小 + 上传时间
- ✅ 点击文件名进入工作台 `/workspaces/acceptance/projects/<pid>/workspace?did=<did>`
- ✅ 左栏 PDF 渲染成功
- ✅ DB：`projects`, `documents` 各 1 行

---

## 3. S2a + S2b1 — Predict + 三栏工作台

### 步骤
1. 工作台中栏点 **Run Prediction**（或顶部 ▶ 按钮）
2. 等 5-10 秒，等待 Gemini 调用返回

### 期望
- ✅ Step indicator: Upload ✓ → Predict ✓ → Correct (current)
- ✅ 中栏 PDF 上叠加 bbox 框（橙色/绿色），按字段着色
- ✅ 右栏 JSON Preview 显示完整字段
- ✅ 字段值对照（数值精确，VAT 应是 `FI32034811` 无空格 ← 这是 default prompt 行为）
   ```json
   {
     "invoice_number": "3744516",
     "invoice_date": "2024-11-27",
     "buyer_name": "HONOR TECHNOLOGIES FINLAND OY",
     "buyer_tax_id": "FI32034811",
     "seller_name": "F9 DISTRIBUTION OY",
     "seller_tax_id": "FI23476220",
     "total_amount": 62750,
     "tax_amount": 12750,
     "items": [...]
   }
   ```
- ✅ DB：`processing_results` 1 行，`annotations` ~9 行（每字段 1 行）

---

## 4. S2b2 — 工作台交互

### 步骤
1. 右栏 JSON 下拉切 **Detailed** → 显示带 bbox/置信度的对象数组
2. 切回 **Flat**
3. 中栏点某个 bbox（比如 invoice_number 的框）→ 右栏对应行高亮
4. 右栏点某行 → 中栏对应 bbox 高亮 + 滚到可见

### 期望
- ✅ 三种 JSON 格式（Flat / Detailed / Grouped）都能切换无报错
- ✅ B↔A 选中双向同步
- ✅ 拖拽 bbox 顶点能改大小（可选验证）

---

## 5. S2a — 设置 Ground Truth + 编辑字段

### 步骤
1. 文档详情页（或工作台底部）勾选 "Mark as Ground Truth"
2. 在右栏直接编辑某个字段，比如把 `seller_name` 改成 `F9 DISTRIBUTION ΟΥ`（注意是希腊字母 Ο）—— 让它和真值匹配
3. 保存（Ctrl+S 或自动保存）

### 期望
- ✅ Document 标记为 GT（DB `documents.is_ground_truth=1`）
- ✅ 编辑产生 `annotation_revisions` 行（CREATE / UPDATE 类型）
- ✅ 工作台 step indicator: Correct ✓ 解锁 Tune

---

## 6. S4 — Evaluate baseline

### 步骤
1. 工作台顶部点 📊 **Evaluate** 按钮 → 跳到 `/workspaces/acceptance/projects/<pid>/evaluate`
2. 点 **Run Evaluation**，名字填 `baseline`
3. 等 5-10 秒，列表出现一条 run

### 期望
- ✅ run.status = `completed`
- ✅ Summary 行：
  - documents=1
  - fields≈9
  - matches≈7
  - **accuracy ≈ 0.778**（buyer_tax_id 不匹配 + items 因 score_field 已知 bug 不匹配）
- ✅ 点 run 进入 detail，per-field breakdown：
  - invoice_number: exact ✓
  - invoice_date: exact ✓
  - buyer_name: exact ✓
  - **buyer_tax_id: mismatch**（pred=`FI32034811`，expected=`FI 32034811`）
  - seller_name: exact ✓
  - seller_tax_id: exact ✓
  - total_amount: exact ✓
  - tax_amount: exact ✓
  - **items: mismatch**（已知 score_field key-order bug，列表序列化不一致）
- ✅ 点 "Download Excel" 得到 .xlsx，2 个 sheet：Summary / Detail，能用 Excel/openpyxl 打开

---

## 7. S3 — NL 矫正 + 保存 prompt 版本

### 步骤
1. 回到工作台，顶部点 ✨ **Tune Prompt**（或 step indicator 点 Tune）
2. 在对话框输入：
   ```
   buyer_tax_id 字段输出为国家代码+空格+数字部分（例如 FI 32034811）
   ```
3. 提交，观察 SSE 流：
   - `prompt_token` 流式打印新 prompt
   - `revised_prompt` 一次性给完整 diff
   - `predict_started` → `predict_result` → `done`
4. 在弹出的 prompt diff 视图中点 **Save as new version**，命名 `v1-with-spaced-vat`
5. 点 **Activate** 把 v1 设为 active

### 期望
- ✅ SSE 7 个事件按顺序到达（不卡死）
- ✅ Diff 视图左右对比能看到新增的「buyer_tax_id 字段输出为国家代码+空格+数字部分」一行
- ✅ Save 后 `prompt_versions` 新增 1 行（version=1）
- ✅ Activate 后 `projects.active_prompt_version_id` 指向 v1
- ✅ 矫正即时 re-predict 的结果中 `buyer_tax_id = "FI 32034811"`（**含空格**）—— 验证 resolve_prompt 优先级生效

---

## 8. 第二次 predict（验证 active prompt 真正在用）

### 步骤
1. 回到工作台，再点 ▶ Re-predict
2. 等返回

### 期望
- ✅ `processing_results` 又新增 1 行
- ✅ 该 row 的 `prompt_used` 字段含 "国家代码+空格" 这句（说明 resolve_prompt 走 active version）
- ✅ 提取出的 buyer_tax_id 含空格

---

## 9. S4 — Evaluate after revision

### 步骤
1. 📊 Evaluate 页再点 **Run Evaluation**，名字填 `after-revision`
2. 等返回

### 期望
- ✅ run.status = `completed`
- ✅ Summary：
  - matches ≈ 8
  - **accuracy ≈ 0.889**（+0.111 提升，buyer_tax_id 现在 exact）
- ✅ Detail：buyer_tax_id 从 mismatch 变 **exact** ✓

---

## 10. S5 — Publish + Create API key

### 步骤
1. step indicator 点 step 5 **GenerateAPI**（应该已解锁）→ 跳 `/workspaces/acceptance/projects/<pid>/api`
2. 状态徽章：**Draft**
3. 输入 api_code = `receipts`，点 **Publish**
4. 状态变 **Published**，显示发布时间
5. 点 **+ New Key**，name=`acceptance-test`，点 Create
6. 弹窗显示完整 key 一次（形如 `dik_xxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`），**复制下来**
7. 关闭弹窗，列表只显示 prefix `dik_xxxxxxxx`

### 期望
- ✅ `projects.api_code='receipts'`，`api_published_at` 非空
- ✅ `api_keys` 新增 1 行，`key_hash` 是 bcrypt hash（$2b$10$...），`key_prefix` 是前 12 字符
- ✅ 全 key 仅在 POST 响应里返回一次，刷新列表只能看到 prefix

---

## 11. 公开端点 `/extract/:api_code` —— 真 Gemini 端到端

### 步骤
```bash
KEY="dik_xxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"   # 上一步复制的
PDF=/Users/qinqiang02/colab/codespace/ai/demo-invoice-ai/Source.gv.pdf

curl -sS -X POST http://localhost:8000/extract/receipts \
  -H "X-Api-Key: $KEY" \
  -F "file=@$PDF" | python3 -m json.tool
```

### 期望
- ✅ HTTP 200，约 5-8 秒返回（真 Gemini 一次调用）
- ✅ 返回 JSON：
  ```json
  {
    "document_id": "...",
    "structured_data": {
      "invoice_number": "3744516",
      "invoice_date": "2024-11-27",
      "buyer_name": "HONOR TECHNOLOGIES FINLAND OY",
      "buyer_tax_id": "FI 32034811",   // ← 含空格，证明公开端点也用 active prompt v1
      "seller_name": "F9 DISTRIBUTION OY",
      "seller_tax_id": "FI23476220",
      "total_amount": 62750,
      "tax_amount": 12750,
      "items": [...]
    }
  }
  ```
- ✅ DB：新增 1 行 `documents`（uploaded_by = key 创建者）+ 1 行 `processing_results`
- ✅ `api_keys.last_used_at` 更新为刚才时间

### 异常验证（建议都跑一遍）

```bash
# 1. 缺 X-Api-Key → 401
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8000/extract/receipts -F "file=@$PDF"
# 期望: 401

# 2. 错误 key → 401
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8000/extract/receipts \
  -H "X-Api-Key: dik_wrong" -F "file=@$PDF"
# 期望: 401

# 3. unknown api_code → 404
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8000/extract/nonexistent \
  -H "X-Api-Key: $KEY" -F "file=@$PDF"
# 期望: 404

# 4. unpublish 后 → 403
TOKEN=...   # 从浏览器 localStorage 复制 access_token
PID=...     # 从 URL 复制
curl -sS -X POST http://localhost:8000/api/v1/projects/$PID/unpublish -H "Authorization: Bearer $TOKEN"
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8000/extract/receipts \
  -H "X-Api-Key: $KEY" -F "file=@$PDF"
# 期望: 403
```

---

## 12. PublishPage UI 验收

回到 `/workspaces/acceptance/projects/<pid>/api`：

### 期望
- ✅ 状态徽章正确反映 published / disabled
- ✅ 复制 cURL 例子按钮可用，里面替换了真 api_code
- ✅ Delete key → 列表立即移除，再用该 key 调 `/extract/receipts` → 401（key 软删 = is_active=false）

---

## 全程通过的判定

| sub-spec | 关键证据 | 步骤 |
|---|---|---|
| S0 | 登录后能看到 workspace | 1 |
| S1 | Project 创建 + 文档上传 | 2 |
| S2a | predict 写 ProcessingResult + Annotation | 3 |
| S2b1 | 三栏 + bbox 渲染 | 3 |
| S2b2 | JSON 3 格式 + B↔A 选中同步 | 4 |
| S3 | NL 矫正 SSE + prompt version + activate 改变 predict | 7-8 |
| S4 | accuracy 0.778 → 0.889 + Excel 导出 | 6, 9 |
| S5 | publish + key + `/extract/:api_code` 真 Gemini 200 | 10-11 |

任何一步偏离期望即算不过。

---

## 已知遗留（不算 bug，但请知悉）

1. **score_field items 字段比对**：predicted 是 list，json.dumps(sort_keys=True) 后与 expected（字符串形式）比对会因 key 顺序不一致出现 spurious mismatch。所有 items 字段在 eval 中固定 mismatch，不影响其他字段评分。验收 accuracy 0.889 = 9 个字段 8 exact 1 mismatch（items），buyer_tax_id 本身正常变 exact。
2. **AnnotationRevision 仅记录用户编辑**：predict 自动播种的 ai_detected annotations 不写 revision。审计要看 `processing_results.prompt_used` + `processor_key` 完整快照。
3. **Mock processor 默认返回单个 items 字段**：开 `USE_MOCK_DATA=1` 时只能验证流程不能验证内容。验收必须用真 LLM。
4. **PredictModal 没有 processor 选择 UI**：用 Project.template.recommended_processor 的默认值。要试 mock 必须 curl。
5. **代理依赖**：用户本机若无 SOCKS 代理且不能直连 Gemini，predict 会超时。检查 `ALL_PROXY` 或网络可达性。
6. **无 rate limiting / analytics**：S5 范围严格不含。

---

## 自动化对照
仓库已有 422 backend tests + 250 frontend tests pass。本指引是**端到端集成验收**，覆盖自动化测试无法跑的真 LLM 路径（S3 NL 矫正、S5 公开端点）。
