# S2b1 — 三栏工作台 + 静态渲染

**日期**：2026-04-28
**Spec 编号**：S2b1（共 6 sub-spec：S0 / S1 / S2a / **S2b1+S2b2** / S3 / S4 / S5；S2b 拆为 S2b1 静态渲染 + S2b2 交互打磨）
**前置**：tag `s2a-complete`（255 tests pass）
**状态**：草稿，待 review

---

## 1. 背景

S2a 完成后，predict 端到端跑通，但 UX 还是单文档 modal，远没达到 design-v2 §7.6 的"三栏工作台"愿景：左 PDF 预览 + bbox 叠加，中字段编辑，右 JSON 输出，三栏点击联动。S2b1 把 modal 升级成 design-v2 §7.6 的三栏布局，让客户**真正看到** AI 在文档上画的框。

S2b 完整范围被拆为：

- **S2b1（本 spec）**：路由 + 三栏布局 + DocumentCanvas（PDF/image + bbox 只读叠加）+ AnnotationEditor 搬迁 + JsonPreview raw + 文档切换器 + ⚙️ 高级面板（processor/prompt override）+ 删除 PredictModal。预计 ~14.5h。
- **S2b2（下次 spec）**：6 步骤 StepIndicator UI + bbox 拖拽 / 缩放 + JSON 格式切换（flat/detailed/grouped）+ polish。预计 ~14h。

S2b1 完成后客户能"看": 左栏 PDF 上 AI 圈出的字段位置，中栏字段值可编辑，右栏 JSON 实时同步。S2b2 让 UX 从"看"变"调"。

---

## 2. LS-features 覆盖

| LS-N | 在 S2b1 的落地 |
|---|---|
| **LS-3** Per-predict 模型/Prompt 覆盖 | 工作台 A 栏顶部 ⚙️ 高级面板 — 用户可以在 Re-predict 前设置 processor_key 和 prompt 覆盖。S2a 的后端已支持，S2b1 加 UI |
| **LS-5** "下一份未 review" | 工作台顶部 toolbar 的 "▶ Next Unreviewed" 按钮，点击调 `loadNextUnreviewed` → 跳到下一份文档的工作台 URL |

不在 S2b1 范围（推到 S2b2 或 S3+）：
- LS-4 批量 re-predict（已在 S2a 完成，文档列表页保留）
- 6 步骤 StepIndicator UI（→ S2b2）
- bbox 拖拽编辑（→ S2b2）
- JSON 格式切换 flat/detailed/grouped（→ S2b2）
- 自然语言矫正（→ S3）

---

## 3. S2a 关系：删除 PredictModal

S2a 引入了 `frontend/src/components/predict/PredictModal.tsx` 和 `__tests__/PredictModal.test.tsx`（11 个测试中 6 个）。S2b1 用工作台替代它：**整文件删除，11 个测试中的 5 个 AnnotationEditor 测试保留**（AnnotationEditor 组件本身被工作台 B 栏复用），6 个 PredictModal 测试删除（行为搬到新 WorkspacePage 测试）。

`ProjectDocumentsPage` 行内的 "Predict" 按钮改成 "工作台"，`onClick` 改为 `navigate('/workspaces/:slug/projects/:pid/workspace?doc=:did')`。"▶ Next Unreviewed" 同样改为 navigate。原本顶部的 "+ Batch Predict" 保留不变（批量场景仍走右侧抽屉）。

`PredictModal` 删除后预期 frontend 测试数：原 129 - 6 = **123 后**，加 S2b1 新增 ~25 = **~148 总**。

---

## 4. 路由 + 入口

### 4.1 新路由

```
/workspaces/:slug/projects/:pid/workspace?doc=:did
```

注册在 `App.tsx` 的 protected 路由集合下（与 ProjectDocumentsPage 同级）。

### 4.2 `?doc=:did` 缺失行为

进入 `/workspace` 但 `?doc=` 缺失时：

1. 加载 `GET /api/v1/projects/:pid/documents?page=1&page_size=1`，取第一个非软删 doc → `replace` URL 加 `?doc=:did`
2. 列表为空 → 渲染占位页 "请先上传文档" + 链接回 `/projects/:pid`

### 4.3 入口点（行为修改）

| 入口 | S2a 行为 | S2b1 行为 |
|---|---|---|
| 文档列表行 "Predict" 按钮 | 打开 PredictModal | 改文字为 **"工作台"**，`navigate(/workspace?doc=:did)` |
| 顶部 "▶ Next Unreviewed" 按钮 | 打开 PredictModal | `loadNextUnreviewed()` → navigate workspace 路径 |
| 顶部 "+ Batch Predict" 按钮 | 打开 BatchPredictDrawer | **不变** |

---

## 5. 三栏布局

### 5.1 整体结构

```
┌─────────────────────────────────────────────────────────────┐
│ AppShell banner (顶层不变)                                   │
├─────────────────────────────────────────────────────────────┤
│ Workspace toolbar:                                          │
│   ◀ x.pdf ▾    ← 上一份  下一份 →   ▶ Next Unreviewed     │
├──────────────────────────────────┬──────────────┬──────────┤
│ A: DocumentCanvas (flex-1)       │ B: Field     │ C: JSON  │
│   ⚙️ 高级 (折叠)                  │    Editor    │    raw   │
│   ┌──────────────────────┐       │   (360px)    │  (380px) │
│   │ PDF/image + bbox     │       │              │          │
│   │ overlay              │       │ [field 1] ✓  │ {        │
│   │                      │       │ [field 2] ✓  │   ...    │
│   │                      │       │ [+ 添加]     │ }        │
│   └──────────────────────┘       │              │          │
└──────────────────────────────────┴──────────────┴──────────┘
```

宽度行为：
- 视口 ≥ 1280px：A flex-1，B 固定 360px，C 固定 380px
- 视口 < 1280px：B/C 改为 tab 切换（`[字段]` `[JSON]` 顶部 tab），保留 A 全宽

design-v2 §7.6 用固定 340px，本 spec 加 20px 给字段名留更多空间（中文字段名常常 12+ 字符）。

### 5.2 文件结构

```
frontend/src/pages/
└── WorkspacePage.tsx              # 主路由组件，三栏布局 + toolbar

frontend/src/components/workspace/
├── WorkspaceToolbar.tsx           # 文档切换器 + Next Unreviewed
├── DocumentCanvas.tsx             # A 栏：PDF/image 渲染
├── BboxOverlay.tsx                # bbox 叠加层（DocumentCanvas 内嵌）
├── AdvancedPanel.tsx              # ⚙️ 高级折叠面板（processor + prompt override）
├── FieldEditorPanel.tsx           # B 栏 wrapper（包 AnnotationEditor）
├── JsonPreview.tsx                # C 栏 raw JSON
└── __tests__/
    └── (各组件的 vitest+RTL 测试)

# 复用（不动）
frontend/src/components/predict/AnnotationEditor.tsx       # B 栏内核
frontend/src/components/predict/__tests__/AnnotationEditor.test.tsx

# 删除
frontend/src/components/predict/PredictModal.tsx
frontend/src/components/predict/__tests__/PredictModal.test.tsx
```

---

## 6. 状态 + Store

### 6.1 predict-store 增量改动

```typescript
// 在 PredictState 加：
selectedAnnotationId: string | null;
setSelectedAnnotationId: (id: string | null) => void;

currentStep: 0 | 1 | 2 | 3;  // 暂不渲染 StepIndicator，但留状态
setStep: (step: 0 | 1 | 2 | 3) => void;

apiFormat: "flat" | "detailed" | "grouped";  // 同上，state 留空
setApiFormat: (f: "flat" | "detailed" | "grouped") => void;
```

不加新 store；predict-store 已有 results/loading/batchProgress + actions。新加这 3 个 state + 3 个 setter。

### 6.2 三栏联动

| 操作 | A 栏响应 | B 栏响应 | C 栏响应 |
|---|---|---|---|
| 点击 A 栏某 bbox | 该框边框 + 角标变靛蓝色（`#6366f1`） | 对应字段行加蓝色左边框，自动滚到可见区 | 对应 `field_name` 高亮（黄色背景） |
| 点击 B 栏某字段行 | 对应 bbox 选中态 | 该行选中态 | 对应 JSON path 高亮 |
| 点击 A 栏空白 / Esc 键 | 清掉所有选中 | 清行选中 | 清 JSON 高亮 |

实现：所有组件订阅 `selectedAnnotationId`；点击各自更新 store；其他订阅者自动 re-render。

### 6.3 Annotation ↔ bbox 映射

Annotation `bounding_box` JSON 形如 `{x: 0.58, y: 0.08, w: 0.20, h: 0.035, page: 0}` 百分比坐标。BboxOverlay 用 CSS 绝对定位 + 百分比：

```tsx
<div style={{
  position: "absolute",
  left: `${bbox.x * 100}%`,
  top: `${bbox.y * 100}%`,
  width: `${bbox.w * 100}%`,
  height: `${bbox.h * 100}%`,
}} />
```

`page` 字段：S2b1 渲染所有页（react-pdf 多页堆叠），bbox 落到对应 page 的容器内。S2a Annotation.bounding_box 默认是单页文档的 `page=0`。

---

## 7. DocumentCanvas（A 栏）

### 7.1 文件类型分发

```typescript
// DocumentCanvas.tsx
if (mime_type === "application/pdf") return <PdfRender />;
if (mime_type.startsWith("image/")) return <ImageRender />;
return <UnsupportedPlaceholder />;  // xlsx/csv 占位
```

### 7.2 PDF 渲染

依赖：`react-pdf` ^9.x（**已在 frontend/package.json 里**，从 S0 留下，无需新装）。

```typescript
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

<Document
  file={previewUrl}  // /api/v1/projects/:pid/documents/:did/preview
  onLoadSuccess={({ numPages }) => setNumPages(numPages)}
  loading={<div>加载 PDF...</div>}
>
  {Array.from({ length: numPages }, (_, i) => (
    <div key={i} className="relative mb-2" ref={(el) => pageRefs.current[i] = el}>
      <Page pageNumber={i + 1} width={containerWidth} renderTextLayer={false} />
      <BboxOverlay
        annotations={annotations.filter((a) => (a.bounding_box?.page ?? 0) === i)}
        selectedAnnotationId={selectedId}
        onSelect={setSelectedAnnotationId}
      />
    </div>
  ))}
</Document>
```

`renderTextLayer={false}` 关掉文本层（不需要选词，且关掉避免和 bbox click 冲突）。

### 7.3 图像渲染

```typescript
<div className="relative inline-block">
  <img src={previewUrl} onLoad={(e) => setImgSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
  <BboxOverlay annotations={annotations} selectedAnnotationId={selectedId} onSelect={...} />
</div>
```

### 7.4 PDF.js worker 配置

react-pdf 需要 worker URL。在 `frontend/src/main.tsx` 全局设置一次：

```typescript
import { pdfjs } from "react-pdf";
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
```

Vite 会处理 URL bundling 自动。

---

## 8. BboxOverlay 组件

```typescript
interface Props {
  annotations: Annotation[];          // 过滤过 page 后传入
  selectedAnnotationId: string | null;
  onSelect: (id: string | null) => void;
  containerSize: { w: number; h: number };  // 父容器渲染后尺寸（PDF 渲染后 w x h）
}
```

每个 Annotation 渲染一个绝对定位 div。颜色按置信度分级（design-v2 §7.6.A）：

| 条件 | 边框色 |
|---|---|
| `selectedAnnotationId === a.id` | `#6366f1` 靛蓝（4px solid） |
| `a.confidence >= 0.95` | `#22c55e` 绿（2px solid） |
| `a.confidence >= 0.90` | `#f59e0b` 橙（2px solid） |
| `a.confidence < 0.90` 或 `null` | `#ef4444` 红（2px solid） |

每个框左上角小标签牌（`top: -20px; left: 0;`）显示 `field_name` + 置信度（9px）。

点击 → `onSelect(a.id)`。点击容器空白（不在任何框内）→ `onSelect(null)`。

---

## 9. AdvancedPanel（⚙️ 高级面板）

折叠面板，默认收起。展开后两字段：

```
⚙️ 高级 ▾                    [Re-predict]
─────────────────────────────────
processor_key (覆盖):
  [gemini|gemini-2.5-flash    ]   placeholder=Project 默认: gemini
prompt 覆盖:
  ┌────────────────────────────┐
  │ (空 = 用模板默认 prompt)   │
  │                            │
  └────────────────────────────┘
```

提交时把这两个值通过 `predictSingle(projectId, did, { promptOverride, processorKeyOverride })` 传后端。

值跨文档保留（用户调好一组 override 想 batch 跑都用）—— 存在 predict-store 加：

```typescript
processorOverride: string;  // ""=用 Project 默认
promptOverride: string;     // ""=用模板默认
setProcessorOverride: (s: string) => void;
setPromptOverride: (s: string) => void;
```

切换文档不清空。逐 Project 都共享一组覆盖（不持久化到 localStorage—S5 加）。

---

## 10. WorkspaceToolbar

```typescript
interface Props {
  documents: { id: string; filename: string }[];  // 来自 GET /projects/:pid/documents（同 store)
  currentDocId: string;
  onSwitch: (did: string) => void;
}
```

布局（顶部一条，64px 高）：

```
┌──────────────────────────────────────────────────────────┐
│ ◀ Receipts                                               │ ← 项目名（点击回到 /projects/:pid）
│   📄 alpha.pdf ▾    [← 上一份] [下一份 →]   [▶ Next Unreviewed] │
└──────────────────────────────────────────────────────────┘
```

下拉项：所有 deleted_at IS NULL 的文档，current 加 ●。
"上一份" / "下一份" 按文档 created_at 顺序在当前文档前/后切换；首/末时禁用。
"Next Unreviewed" 复用 S2a 的 `loadNextUnreviewed(projectId)`，404 时 toast "已全部 predict 过"。

切换时 URL 用 `navigate(?doc=newDid, { replace: false })`，不破坏浏览器 history（用户能 back）。

---

## 11. JsonPreview（C 栏，S2b1 = raw）

```typescript
const data = result?.structured_data ?? null;

return (
  <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-3 overflow-auto h-full">
    <div className="text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-2">
      Structured Data {result && `· v${result.version}`}
    </div>
    {data ? (
      <pre className="text-xs leading-relaxed whitespace-pre-wrap text-[#a5f3fc]" style={{ fontFamily: "Fira Code, Courier New, monospace" }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    ) : (
      <div className="text-xs text-[#64748b]">尚无 predict 结果</div>
    )}
  </div>
);
```

S2b2 在此处加格式切换 flat/detailed/grouped 三个 tab + 转换函数。S2b1 不实现。

`selectedAnnotationId` 高亮：在 S2b1 的 raw 模式下，简单实现是搜文本——找到 `"<field_name>":` 包它一层 `<mark>`。**S2b1 spec 暂不实现** JSON 高亮联动（对应 design-v2 §7.6 联动表里的 "C 栏 JSON 路径高亮"），留 S2b2 做（需要 AST 解析才精准）。S2b1 测试不强制。

---

## 12. 测试策略

### 12.1 Frontend (vitest + RTL) — 目标 +25 net

| 文件 | 测试要点 | 数量 |
|---|---|---|
| `predict-store.test.ts` 增量 | 加 selectedAnnotationId / currentStep / apiFormat / processorOverride / promptOverride | 5 |
| `WorkspaceToolbar.test.tsx` | 渲染当前文档 + 下拉 + prev/next 禁用边界 + Next Unreviewed 调 store | 5 |
| `DocumentCanvas.test.tsx` | image 渲染 + PDF 渲染 mock + unsupported placeholder | 4 |
| `BboxOverlay.test.tsx` | 渲染多个 bbox + 颜色按 confidence 分级 + 点击触发 onSelect + 空白点击 null | 5 |
| `AdvancedPanel.test.tsx` | 默认收起 + 展开后 input + Re-predict 调 predictSingle 带 override + 跨文档保留 | 4 |
| `JsonPreview.test.tsx` | 渲染 structured_data + null 时占位 | 2 |
| `WorkspacePage.test.tsx` | 路由 ?doc 缺失时跳第一个 + 跳后 auto-trigger predict + 三栏渲染 + 三栏联动 | 5 |
| `ProjectDocumentsPage.test.tsx` 增量改 | 行 "工作台" 按钮 navigate 到工作台 URL；Next Unreviewed 也是 navigate；删 PredictModal mock | 3 替换原 |

净增 ~25 个测试。同时删掉 6 个 PredictModal 测试。最终：123（删后）+ 25 ≈ **148 frontend tests**。

### 12.2 Backend

S2b1 不动 backend → backend 测试数不变（126）。

### 12.3 Mock 策略

- react-pdf 在测试里用 `vi.mock('react-pdf', ...)` 替换为简单 div（避免 jsdom 不支持 PDF.js worker）
- 所有 PDF 渲染测试只验证 wrapper 行为，不验证 PDF 渲染结果

### 12.4 TDD 强制

每个组件测试先写失败 → 实现 → 通过 → commit，沿用 S0/S1/S2a 范式。

---

## 13. Acceptance Criteria

人工 smoke flow（S2a smoke 之后紧接）：

1. 启动 backend + frontend，登录 alice，进入有 alpha.pdf + beta.pdf 的 Receipts project（S2a 数据复用）
2. 列表行点 "工作台" 按钮 → URL 变 `/workspaces/demo/projects/:pid/workspace?doc=<alpha>`
3. 工作台三栏渲染：A 栏 alpha.pdf 内容（PDF.js 渲染），B 栏 ai_detected annotations（继承 S2a），C 栏 raw JSON
4. 顶栏文档选择器显示 `📄 alpha.pdf ▾`，下拉里能看到 alpha + beta
5. 点 A 栏某 bbox → 该框变靛蓝 + B 栏对应行加蓝边
6. 点 B 栏某字段行 → A 栏对应 bbox 高亮
7. 点 A 栏空白 → 所有联动取消
8. 点 "下一份 →" → URL 变 `?doc=<beta>`，三栏更新到 beta
9. 工作台 ⚙️ 高级 展开 → 输 `processor_key=mock` → 点 Re-predict → spinner → 新 version 显示
10. 点 ◀ Receipts → 跳回 `/projects/:pid` 列表
11. 列表行原 "Predict" 按钮已变成 "工作台"，原 PredictModal 完全消失
12. `vitest` 全绿（≥ 148 frontend tests）
13. `pytest` 全绿（126 backend，不变）

---

## 14. 风险与未决项

| 风险 | 缓解 |
|---|---|
| react-pdf worker 在 Vite 8 里需要正确 URL bundling | 使用 `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`，已是 Vite 文档推荐写法 |
| jsdom 不支持 PDF.js | 测试 mock react-pdf 为 stub 组件 |
| 大 PDF（10+ 页）渲染慢 | S2b1 不优化；如真客户上 50 页 PDF 出问题，S2b2 加虚拟滚动或分页 |
| Mock processor 返回单 `items: [...]` 字段 → BboxOverlay 没东西画 | 接受：mock 设计如此。真实 LLM 输出顶层多字段 + bbox（gemini Structured Outputs 可指定）→ 客户场景下 bbox 会有内容 |
| `bounding_box` 在 S2a mock 数据里都是 null | A 栏 bbox 数 = 0；联动测试要么用 fixture 数据，要么 mock store 直接塞含 bbox 的 annotation。Smoke flow 接受"没有 bbox 可点"——视觉退化为纯文本编辑器，仍能验证三栏 |

**未决项**（review 时表态）：
- BboxOverlay 颜色阈值 0.95/0.90 是 design-v2 原值，OK 吗？
- Tab 切换断点 1280px 是否合理？

---

## 15. 工作量估算

| 步骤 | 估时 |
|---|---|
| 路由 + WorkspacePage 骨架 | 1.5h |
| DocumentCanvas（react-pdf + image） | 2h |
| BboxOverlay 组件 + 联动逻辑 | 2.5h |
| WorkspaceToolbar（文档切换器 + prev/next/unreviewed） | 1.5h |
| AdvancedPanel + override store 字段 | 1.5h |
| FieldEditorPanel wrapper（B 栏布局，复用 AnnotationEditor） | 0.5h |
| JsonPreview raw | 1h |
| 删除 PredictModal + ProjectDocumentsPage 改 "工作台" 按钮 + AppShell `S0` 改 `S2b` | 1h |
| predict-store 增量改 + 5 测试 | 1h |
| 各组件 RTL 测试（~20 个） | 2.5h |
| smoke + s2b1-complete tag | 1h |
| **总计** | **~16h（约 2 工作日）** |

略高于初估 14.5h（实际写完发现 toolbar + advanced panel 比预期复杂）。仍在 22-25h 上限内，且可以独立 ship。

---

## 16. 与 S2b2 衔接

S2b2 起手：
- predict-store 已有 `currentStep` + `apiFormat` state，UI 直接挂上
- BboxOverlay 已有 `onSelect` hook，加 `onMove(newBbox)` + `onResize(newBbox)` callbacks 即可，PATCH Annotation.bounding_box 的逻辑接到 store
- JsonPreview 加格式切换 tab，复用 raw 渲染做 `flat` 模式，加两个转换函数 `toDetailed(data, annotations)` `toGrouped(data, schema)`
- 加 StepIndicator 顶部组件，订阅 currentStep + 提供导航按钮

S2b1 数据/路由不动；S2b2 全是 UI/UX 增量。

---

## 17. 参考

- API_anything design-v2：`design-v2.md` §7.6（三栏布局 + DocumentCanvas + BboxOverlay 详述）、§7.8（C 栏格式切换 → S2b2）、§7.9（StepIndicator → S2b2）、§7.12（workspace-store）
- LS 经验保留清单：`docs/superpowers/specs/2026-04-27-ls-features-to-preserve.md`
- S2a spec：`docs/superpowers/specs/2026-04-28-S2a-predict-engine-minimal-ui-design.md`（数据模型 + Annotation.bounding_box 字段）
- react-pdf docs：https://github.com/wojtekmaj/react-pdf
