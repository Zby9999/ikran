export type Classification =
  | "reusable"
  | "page-local"
  | "conflict"
  | "open-gap"
  | "proposed-update"
  | "none";

export type ProposalStatus = "pending" | "confirmed" | "canceled";

export interface FeedbackRecord {
  id: string;
  time: string;
  runId: string;
  summary: string;
  linkage: string | null;
}

export interface Proposal {
  id: string;
  classification: Classification;
  title: string;
  change: string;
  reason: string;
  affectedItems: string[];
  feedbackIds: string[];
  status: ProposalStatus;
}

export interface UnpromotedFeedback {
  feedback: FeedbackRecord;
  agentReason: string;
  returned: boolean;
}

export const CLASS_META: Record<
  Classification,
  { label: string; tone: "blue" | "green" | "purple" | "pink" | "danger" | "muted" }
> = {
  reusable: { label: "可复用候选", tone: "blue" },
  "page-local": { label: "局部例外", tone: "purple" },
  conflict: { label: "规则冲突", tone: "danger" },
  "open-gap": { label: "开放缺口", tone: "pink" },
  "proposed-update": { label: "拟议更新", tone: "green" },
  none: { label: "无发现", tone: "muted" }
};

export const FEEDBACK: FeedbackRecord[] = [
  {
    id: "f1",
    time: "14:02",
    runId: "run-3",
    summary: "卡片之间的间距在这个页面太挤了，透不过气",
    linkage: "prototype-surface"
  },
  {
    id: "f2",
    time: "14:15",
    runId: "run-3",
    summary: "列表项也想要同样的呼吸感，别只改卡片",
    linkage: "prototype-surface"
  },
  {
    id: "f3",
    time: "14:31",
    runId: "run-3",
    summary: "统一改成 16px 吧，这个尺寸看着对",
    linkage: "region · card-grid"
  },
  {
    id: "f4",
    time: "14:40",
    runId: "run-3",
    summary: "这个页面的标题层级感觉不对，详情页应该有自己的一套",
    linkage: null
  },
  {
    id: "f5",
    time: "15:03",
    runId: "run-3",
    summary: "按钮圆角这里用 8px，跟整体更搭",
    linkage: "region · actions"
  },
  {
    id: "f6",
    time: "15:20",
    runId: "run-3",
    summary: "这里的蓝色再亮一点试试",
    linkage: "region · header"
  },
  {
    id: "f7",
    time: "15:47",
    runId: "run-3",
    summary: "还是按规则里的蓝色来，刚才那个太跳了",
    linkage: "region · header"
  }
];

export const INITIAL_PROPOSALS: Proposal[] = [
  {
    id: "p1",
    classification: "reusable",
    title: "卡片间距规则扩展至列表场景",
    change:
      "spacing/card-gap 由 12px 调整为 16px，并将该规则的适用范围从「卡片网格」扩展为「卡片与列表容器」。",
    reason:
      "三条独立反馈指向同一判断：拥挤感不只出现在卡片网格，列表场景同样存在。设计师已给出明确数值 16px。",
    affectedItems: ["spacing/card-gap", "component/list", "component/card-grid"],
    feedbackIds: ["f1", "f2", "f3"],
    status: "confirmed"
  },
  {
    id: "p2",
    classification: "proposed-update",
    title: "标题层级规则补充「详情页」用法",
    change:
      "在 typography/heading 规则中新增详情页层级约定：详情页标题降一级使用，强调内容而非页面。",
    reason:
      "设计师指出详情页标题层级不对。现有规则只覆盖了列表页与营销页两种场景。",
    affectedItems: ["typography/heading"],
    feedbackIds: ["f4"],
    status: "canceled"
  },
  {
    id: "p3",
    classification: "page-local",
    title: "本页按钮圆角 8px(规则不变)",
    change:
      "全局 radius/button 维持 6px 不变;本页面 actions 区的按钮作为局部例外使用 8px。",
    reason:
      "设计师明确要求 8px,但结合上下文判断这是与「本页整体视觉」的搭配决策,不足以推广为全局规则。",
    affectedItems: ["prototype · actions 区"],
    feedbackIds: ["f5"],
    status: "pending"
  },
  {
    id: "p4",
    classification: "open-gap",
    title: "深色模式 token 缺失",
    change:
      "不修改现有规则。登记开放缺口:color/* 全部 token 仅有亮色定义,深色模式无规则可依。",
    reason:
      "本轮迭代中未触及,但 Agent 在比对规则时发现该缺口,按约定登记为 open gap 而非静默跳过。",
    affectedItems: ["color/*"],
    feedbackIds: [],
    status: "pending"
  },
  {
    id: "p5",
    classification: "conflict",
    title: "强调色规则与新反馈冲突",
    change:
      "color/accent 规则保持 #68a7f9。曾收到「调亮」反馈,但已被设计师本人后续反馈推翻,规则不变更。",
    reason:
      "同一会话内先后的两条反馈互相矛盾,以最新决定为准。按冲突流程登记,便于追溯。",
    affectedItems: ["color/accent"],
    feedbackIds: ["f6", "f7"],
    status: "pending"
  }
];

export const INITIAL_UNPROMOTED: UnpromotedFeedback[] = [
  {
    feedback: FEEDBACK[5],
    agentReason: "已被后续反馈推翻(15:47「还是按规则里的蓝色来」)",
    returned: false
  },
  {
    feedback: FEEDBACK[6],
    agentReason: "与现行规则一致,无需变更 —— 归入提案 5 的冲突登记",
    returned: false
  }
];

export function feedbackById(id: string): FeedbackRecord {
  const hit = FEEDBACK.find((f) => f.id === id);
  if (!hit) throw new Error(`unknown feedback ${id}`);
  return hit;
}
