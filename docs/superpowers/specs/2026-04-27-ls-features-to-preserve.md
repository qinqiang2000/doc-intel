# Label Studio 经验保留清单（cross-spec notes）

**日期**：2026-04-27
**用途**：S1-S5 各 sub-spec 写作时**必须**交叉引用本文件，确认每条 LS 在 doc-intel 场景下被验证过的能力都被覆盖或显式弃用。
**适用范围**：本仓库（doc-intel / API_anything）的所有未来 sub-spec。

---

## 背景

doc-intel 重新设计选择 "rebase on API_anything"（决策见 `MEMORY.md` 与 brainstorming 会话）。API_anything design-v2.md 是面向通用 SaaS 的极简单文档闭环；Label Studio 则在 doc-intel 真实使用中沉淀了若干**针对多样本调试场景的有用细节**——这些是 design-v2 没覆盖的盲区。

本文件把这些盲区列出来，标明落地位置。每条都需要在对应 sub-spec 写作时被显式处理：要么覆盖，要么写明"故意不做"+ 理由。

---

## 必做项（已有归属 sub-spec）

### LS-1. 文档列表 / Data Manager 视图 → S1
- 可筛选 / 排序 / 分组的样本表格：status、最近更新、置信度区间、文件类型、是否 ground truth、是否人工 review 过
- design-v2 假设单文档工作台；真实用户上传 50+ 样本，必须有列表才能找回去。
- S1 数据模型必须支持这些维度的索引。

### LS-2. Ground Truth 标记 → S1（建模） + S4（消费）
- 样本（Document）有 `is_gold: bool` 或 Annotation 有 `is_ground_truth: bool` 字段。
- Evaluate（S4）只对 ground truth 样本跑对比；非 GT 样本只能跑预测、不能算准确率。
- S1 设计 Annotation 模型时必须预留这个字段；S4 不能事后加（破坏 acceptance criteria）。

### LS-3. Per-predict 模型 + Prompt 临时切换 → S2 / S3
- LS 优化版让用户每次 predict 可以临时指定 model 和 prompt，**不污染 Project 默认值**。
- 这是用户原话强调过的：调试时常常 "用 prompt v3 + model A 跑一下" 看效果。
- S2 的 predict 路由必须支持 `?prompt_version_id=&model_key=` 覆盖；S3 PromptVersion 模型必须暴露这种"试跑不保存为默认"的语义。

### LS-4. 批量 re-predict → S2
- "选中 N 份样本 → 用当前 Prompt 全部重跑" 必须是一键操作。
- 否则 Prompt 调一次要手动开 50 个文档点 reprocess——自助体验崩塌。
- S2 路由：`POST /api/v1/projects/:pid/batch-predict { document_ids: [...] }`，返回一个 batch_id；前端用 SSE 监听进度。

### LS-5. "下一份未 review" 任务队列 → S2
- 工作台顶栏除了"切换文档"下拉，还有 [▶ 下一份] 按钮，自动跳到 Project 内下一份"未 review"的样本。
- "未 review" 定义可配（无 annotation / 置信度<阈值 / 字段缺失）。
- S2 工作台头部交互必须包含此按钮 + 排队规则配置。

### LS-6. 字段级筛选 / 视图保存 → S1（数据） + S4（消费）
- "给我看所有 invoice_total 置信度<80% 的样本"，可存为命名视图 `views/low_confidence_total`。
- S1 的 Document 列表 API 必须支持 `?filter[field_name]=invoice_total&filter[confidence_lt]=0.8`。
- 视图保存功能可以放到 S4 之后再做，但筛选语义 S1 就要建好。

### LS-10. Project 创建向导 + 默认配置 → S1
- 新建 Project 不是空白页：让用户选"模板"（日本領収書 / 中国增票 / 自定义），自动填入合理的初始 prompt、字段 schema、推荐 model。
- design-v2 §7.4 的国家模板列表是好起点；但要落到 Project 数据初始化层面，不只是 UI 提示。
- S1 spec 必须设计 ProjectTemplate 资源（即使初期硬编码 5 个内置模板）。

### LS-11. 批量上传 / piaozone 导入 → S1
- 你们 LS 加的 "piaozone 导入按钮" 从外部源批量拉文档。
- S1 阶段：基础多文件上传（拖拽多选）必做；piaozone / S3 / 其他外部源是 Storage Importer 抽象，可以 S1 加 interface 占位、S5 之后实现具体 connector。
- S1 spec §"未决项" 必须列出 "Storage Importer 抽象是否 day-one"。

---

## 数据模型时顺手加（避免后期破坏性迁移）

### LS-7. Annotation 修改审计字段 → S2
- 每条 Annotation 加 `updated_by_user_id`、`updated_at`（已有），并保留**修改历史表** `annotation_revisions(annotation_id, before, after, by, at)`。
- 不需要专门 UI，但有问题排查时是救命稻草。
- S2 设计 Annotation 模型时一并加上，比 S5 才追加迁移便宜。

---

## 专门做（后续增量 spec）

### LS-8. Predict 对比视图（model A vs model B 结果并排） → S4 后增量
- 评估两个候选 model / prompt 谁更适合某类文档时刚需。
- S4 完成后单独写 spec，新增 `ComparisonRun` 实体。
- 不阻塞核心闭环。

### LS-9. Project 克隆 → S5 后增量
- "复制这个 Project 的配置（含 prompt + schema），数据另起" 按钮。
- 比 design-v2 §7.4 的固定模板更灵活——客户自己积累的成熟 Project 可以作为新 Project 的种子。
- S5 完成后单独写 spec。

### LS-12. Project 级统计仪表 → S5 后增量
- 总样本数 / 已 review / 平均置信度 / 字段覆盖率 / Evaluate 历史趋势。
- 适合 Project 详情页加一个 "Overview" tab。
- 不阻塞 API 发布闭环。

---

## 故意不做（YAGNI）

### LS-13. Webhook / 完成通知
- 批量 predict 完成、API 被调用等事件向外推送 webhook。
- 当前没有外部系统需要订阅，加上反而增加复杂度。
- 如果未来真有客户要"集成到他们的工作流"，再单独 spec。

### LS-14. 多人协作 / annotation locking
- "Alice 正在编辑这份样本，Bob 看到只读" 这类锁机制。
- 当前用户故事是"客户内部一人调试"，不需要协同。
- Workspace 级权限够用。

### LS-15. 多种导出格式（CoNLL/COCO/YOLO）
- LS 通用标注框架的导出能力。
- 我们只需要 Excel（已在 S4 计划中，从 doc-intel salvage）+ JSON（Evaluate 结果原生）。
- 其他格式 YAGNI。

---

## 写 sub-spec 时的 checklist

每个 sub-spec（S1-S5）的 review 阶段，**必须**对照本文件回答：

- [ ] 本 sub-spec 范围内归属的 LS-N 项是否都被覆盖？
- [ ] 如果某 LS-N 项标的是这个 sub-spec 但本次没做，spec 的 "未决项" / "故意不做" 章节是否写了 push 到下一个 spec 的理由？
- [ ] 数据模型设计是否预留了未来 LS-N 项需要的字段（典型：is_gold、updated_by、is_ground_truth）？

---

## 维护

新发现的 LS 场景闪光点 → 加到本文件对应分级。spec 写完后某项 LS-N 已落地 → 标 ✅ + 注明 spec 文件名 + commit。本文件是活的清单，不是历史档案。
