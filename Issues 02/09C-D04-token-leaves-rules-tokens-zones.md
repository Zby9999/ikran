# Token Leaves Rules / Tokens 分区(Color / Typography / Materials)

Status: ready-for-human

## Parent

- `09C-A-design-system-reader-projection-resizable-split.md`

## What to build

背景:Draft Design System 的内容模型已收敛为三种 kind(schema 归 09B 修订持有):

- `token` —— 确定值声明(color / typography / spacing / radius / shadow …),无
  scope;领域归属由 `domain` 表达;
- `domain-rule` —— 领域级判断规则(「不要用阴影做区域区分」「CTA 用 ink 色」
  「标题用负字距」),存于所属领域的 source 文件;
- `global-rule` —— 全局原则,只出现在 `design-system.json`,由 Foundations Home
  承载。

此前 `token.json` 只有 token 一个物种,Color / Typography / Materials 三页也因此
只能渲染 token rows;领域级判断规则没有家——塞进 token.json 会被 classifyToken
的 name regex 误归 Materials,塞给 Home 又够不上全局原则。09B 修订后,domain-rule
作为 kind 声明的 entry 存于 token.json,本 issue 负责让三页正确呈现它们。

三页每页默认两个呈现区,顺序锁定 **Rules 在上**(「判断在前,数值在后」;极简
seed 下页面以真实内容——规则卡——开场,而不是空 Tokens 区)。

**Rules 区(domain-rule entries)**

- 文字优先的规则卡,泛化 `InteractionRuleCard`
  (`components/workbench/design-system-browser.tsx`):折叠行 = 序号锚点 +
  statement + meaning + status chip + 展开箭头;展开后 = entry 字段条件渲染
  (非空才显示)+ ⓘ evidence 链 + candidate 审批;
- 展开字段区与 Home principles / Interaction rules 共用 `dsb-principle-fields`
  视觉语言,是同一卡片家族的第三个成员;字段内容按 entry value 数据驱动,不为
  domain rule 设计新视觉;
- domain-rule 的 status / approval 语义与 token 相同(candidate → formalized,
  approval write-back 与 evidence lineage 不变)。

**Tokens 区(token entries)**

- 现有 `TokenLeafPage` 行为不变:rows 按 primitive / semantic / component 三层
  分组;
- specimens 不在本 issue 范围(Typography specimens 已在 09C-A 交付;Color 色板
  归 09C-C 修订后范围)。

**空区与空页**

- 区只在有内容时渲染:无 domain-rule 的 leaf 不出现 Rules 区,无 token 的 leaf
  不出现 Tokens 区——区级空态是排版噪音;
- 整页皆空时保留现有 leaf 级空态("No tokens classified here yet");
- 极简 seed 的典型效果:Materials 页 = 一张「不要用阴影做区域区分」规则卡,
  无 Tokens 区。

**投影与分类**

- view model 按 `entry.kind` 拆分:`kind === "domain-rule"` → Rules 区;
  `kind === "token"` 或未声明 → Tokens 区;
- 未声明 kind 的存量 entry 完全按现状渲染(向后兼容默认),不做推断、不做伪装;
- `classifyToken` 的 name regex 只服务于无 `domain` 字段的旧 token,domain-rule
  entry 不再进入 token 分类。

## Locked product decisions

- kind 词表钉死:`token | domain-rule | global-rule`。本 issue 与 09B 修订共用
  同一词表,任何改名需两文件同步。不引入 `form` / `scope` 等其他分类字段。
- Layout 不做确定/概念分组(已取消):Layout entry 全是 domain-rule,确定值与
  概念的区分由卡片内部字段级分离(headline vs facts)承担,capture atlas 不动。
- Rules 在上、Tokens 在下,三页一致。
- 规则卡外壳复用 Interaction 卡片;展开字段区数据驱动,不做视觉分叉。
- 空区不渲染;leaf 级空态保留。
- 否定规则的反例样本(带阴影卡片打 ✗)不进本 issue。
- 导航结构不变(Home / Color / Typography / Materials / Layout / Interaction);
  Components section 不受影响。
- 本 issue 只做呈现;kind 的 schema、kind↔文件归属校验、round-trip 与抽取声明
  归 09B。
- 设计师已确认:本 issue 的文字契约足够实现,不需要额外 Figma reference。

## Acceptance criteria

- [x] view model 将 token.json entries 按 kind 拆分投影:domain-rule → Rules 区;
      token / 未声明 → Tokens 区。domain-rule 不再进入 classifyToken 分类。
- [x] Color / Typography / Materials 三页 Rules 区在上、Tokens 区在下;无内容的
      区不渲染;皆空时显示 leaf 级空态。
- [x] Rules 区规则卡与 Interaction 卡片同构:折叠行(锚点 + statement +
      meaning + status chip + 箭头)、展开字段(条件渲染)、evidence popover、
      candidate 审批;展开字段区沿用 `dsb-principle-fields` 视觉语言。
- [x] domain-rule entry 的 approval write-back 路径与 token 相同,无回归。
- [x] 无 kind 的旧 fixture 渲染与改动前完全一致(对比测试)。
- [x] 面包屑、leaf 命名、导航项不变。
- [x] 投影为确定性纯函数;unit tests 覆盖 kind 拆分、空区不渲染、旧数据兼容、
      domain-rule 审批状态映射。
- [x] e2e(真实 Browser 核对)在 09B schema slice 落地、可 ingest 携带 kind 的
      token.json 后补齐。

## Real Agent validation

- [ ] 09B 完成真实项目重新抽取后,Materials leaf 的 Rules 区呈现真实
      domain-rule(如「不要用阴影做区域区分」),Tokens 区呈现真实 token;两区
      内容与 token.json source 一一对应。
- [ ] Color / Typography 领域的 domain-rule(如「CTA 用 ink 色」「标题用
      负字距」)出现在对应 leaf 的 Rules 区,而不是被误归为 Materials token。

## Blocked by

- fixture-first 实现无阻塞(view-model fixtures 不需要 ingest);
- e2e 与 Real Agent validation 依赖 09B 的 schema round-trip slice(可 ingest /
  DB view / derived export 携带 kind 的 token.json)。

## Out of scope

- Tokens 区的 specimens(Color 色板归 09C-C 修订后范围;Materials 样本待真实
  token 出现后单独立项)。
- Layout 分组 / `form` 字段(已取消)。
- 否定规则反例样本。
- Interaction / Layout / Home / Components 的任何呈现改动。
- kind 的 schema、校验与抽取契约(归 09B)。
