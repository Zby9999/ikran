# ADR 0003：Runtime 直接摄取 Figma 位置证据

**Status:** accepted（2026-07-12）

Ikran 将 Figma Connection 和确定性的 Figma positional evidence 摄取收归 Runtime，使设计师无需等待活跃 Agent 即可把 Figma selection link 变成可视、可标注的 Evidence Surface；实现级 Figma context 仍由 Agent 按需通过宿主 Figma MCP 获取。本决策取代 ADR 0001/0002 中「Ikran 零 Figma 接触」「Seed 纯 Agent-first」及 Agent 通过 `record_evidence_package` 提交 Figma 截图作为 Active 产品路径的部分。

## 决策

- MVP 使用安装级、只读的 **Figma Connection**。用户提供 Personal Access Token，凭证存放在 macOS Keychain，跨本地项目复用，不进入项目 SQLite、artifact、日志或 research export。OAuth 与多账户是 Future Work，不在 MVP 实施。
- Figma Connection 是 Workbench 的前置门槛：未连接时显示连接面板并锁定画布；粘贴 Figma link 直接失败，不创建 pending Seed Reference。
- 设计师可在 Workbench 粘贴、Agent 也可经语义 MCP tool 添加 Seed Reference；两者调用同一 Runtime command，并记录真实 initiator。
- 一个项目可有任意数量的 Seed References，它们共同表达同一种设计语言并共享一个项目级 Design Language Description；单个 Reference 可附带可选 Reference Note。Description 不阻塞摄取，但为空时阻止进入正式 Design Intent Alignment。
- Seed Reference 的幂等身份是 canonical `file_key` + normalized `node_id`。原始 URL 留作显示与审计；分享时间等非身份参数不参与身份。重复提交只复用并聚焦已有 Frame，不创建重复 Reference 或 Surface。
- Runtime 通过 Figma API 只捕获 **Figma positional evidence**：截图、canonical source identity，以及把区域定位到候选源节点所需的最低 node identity/name/type/bounds 数据。Runtime 不预取实现级布局、样式、组件或变量上下文。
- Runtime capture 是 Figma positional evidence 的唯一 Active 产品来源。Agent-supplied `record_evidence_package` 路径退役；Agent 需要实现级细节时，根据 source identity 或 Runtime 排序出的 node candidates 自主调用宿主 Figma MCP。
- Runtime 只进行确定性的空间相交与候选排序，不把几何关系伪装成语义理解。只有 Agent 在按需检查 Figma source 后才能确认 annotation 的 `primaryNodeId`。
- 新 Seed Reference、初始 positional evidence、Figma Evidence Surface 与成功事件在同一成功边界内原子提交。链接无效、无权限或 capture 失败时显示错误，不留下半成品 Reference、Surface 或成功研究事实。
- Evidence 保持 append-only lineage。重复粘贴不刷新；只有显式 Refresh 才捕获新版本并将其设为 current，历史 Surface 与其 annotation 保留用于审计和回放。

## 为什么

Agent-host-only ingestion 使核心体验取决于 Agent 是否正在运行、是否继续调用 Figma MCP，以及是否成功声明 evidence。用户粘贴 Figma link 后可能长期只看到无截图的 awaiting state，这与 Ikran 所需的顺滑画布流转相冲突。Runtime 直接完成可确定、低语义的视觉与位置摄取，可以让画布立即可用；同时把高语义、实现级读取留给 Agent，避免 Runtime 复制 Agent 的设计推理能力或演变成完整 Figma-to-code 转换器。

## 被否决的替代

1. **继续由 Agent host 完成所有 Figma ingestion**：避免保存凭证，但无法保证粘贴后立即可视，核心体验依赖活跃 Agent。
2. **Runtime 预取完整 Figma implementation context**：上下文、存储、限流和隐私成本过高，也模糊 Runtime 确定性与 Agent 推理的边界。
3. **失败后保留 pending/failed Seed Reference**：会在画布和研究记录中形成不完整对象；改为连接前置门槛和成功后原子提交。
4. **MVP 直接使用 OAuth**：最终产品体验更好，但应用审核、callback、client secret/token broker 和 refresh 生命周期会扩大当前转型范围；MVP 先验证 token-based connection，OAuth 留作 Future Work。

## 后果

- 当前 PRD 必须改写 Seed entry、Figma 接触面、Evidence provenance、工具面、用户故事、测试和成功标准。
- `register_seed_reference` 应收口为双 initiator 共用的 add/import command；`list_pending_seed_evidence` 与 Agent-supplied `record_evidence_package` 退出 Active 工具面。
- Runtime 新增 Figma Connection Gate、凭证安全存储、Figma API adapter、原子 capture、显式 refresh、positional node index 与 annotation candidate 查询能力。
- 历史 Agent-supplied evidence、ADR 和 Issue 05 完成报告继续保留；自动化/真实验证仍需诚实区分，不把旧完成报告改写成仿佛当时已经采用本决策。
- 具体 UI 必须继续遵循设计师的 Figma reference；本 ADR 不自行定义连接面板、导入状态或错误状态的视觉设计。
