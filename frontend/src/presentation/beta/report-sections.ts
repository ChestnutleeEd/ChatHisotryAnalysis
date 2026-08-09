export const BETA_REPORT_SECTION_IDS = [
  "opening",
  "messages",
  "active-days",
  "longest-streak",
  "peak-month",
  "peak-weekday",
  "peak-hour",
  "sender-share",
  "message-length",
  "message-types",
  "sessions",
  "replies",
  "frequent-words",
  "distinctive-keywords",
  "word-cloud",
  "summary-share",
] as const;

export type BetaReportSectionId = (typeof BETA_REPORT_SECTION_IDS)[number];
export type BetaSectionDeliverySlot = "core" | "vocabulary" | "cloud" | "sharing";
export type BetaReportScene =
  | "opening"
  | "scale"
  | "rhythm"
  | "balance"
  | "conversation"
  | "vocabulary"
  | "closing";

export interface BetaReportSectionDefinition {
  readonly id: BetaReportSectionId;
  readonly order: number;
  readonly title: string;
  readonly question: string;
  readonly scene: BetaReportScene;
  readonly deliverySlot: BetaSectionDeliverySlot;
}

const section = (
  id: BetaReportSectionId,
  order: number,
  title: string,
  question: string,
  scene: BetaReportSectionDefinition["scene"],
  deliverySlot: BetaSectionDeliverySlot,
): BetaReportSectionDefinition => ({ id, order, title, question, scene, deliverySlot });

export const BETA_REPORT_SECTIONS: readonly BetaReportSectionDefinition[] = [
  section("opening", 1, "开场", "这是哪段时间的回顾？", "opening", "core"),
  section("messages", 2, "消息", "这一范围聊了多少？", "scale", "core"),
  section("active-days", 3, "聊天日", "有多少天聊过？", "scale", "core"),
  section("longest-streak", 4, "最长连续聊天", "最长连续聊了多久？", "scale", "core"),
  section("peak-month", 5, "活跃月份", "哪个月更常聊天？", "rhythm", "core"),
  section("peak-weekday", 6, "星期节奏", "通常星期几更常聊？", "rhythm", "core"),
  section("peak-hour", 7, "小时节奏", "一天中什么时候更常聊天？", "rhythm", "core"),
  section("sender-share", 8, "发送方分布", "双方各发了多少？", "balance", "core"),
  section("message-length", 9, "消息长度", "文字消息通常有多长？", "balance", "core"),
  section("message-types", 10, "消息类型", "除了文字，还发了什么？", "balance", "core"),
  section("sessions", 11, "会话", "一次聊天如何开始？", "conversation", "core"),
  section("replies", 12, "回复间隔", "回复间隔通常多久？", "conversation", "core"),
  section("frequent-words", 13, "常用词", "这一范围最常提到什么？", "vocabulary", "vocabulary"),
  section("distinctive-keywords", 14, "年度关键词", "哪些词更能代表这一年？", "vocabulary", "vocabulary"),
  section("word-cloud", 15, "词云", "这些词放在一起是什么样？", "vocabulary", "cloud"),
  section("summary-share", 16, "总结与分享", "如何带走这份回顾？", "closing", "sharing"),
] as const;

export function isBetaReportSectionId(value: string): value is BetaReportSectionId {
  return (BETA_REPORT_SECTION_IDS as readonly string[]).includes(value);
}

export function betaReportSection(id: BetaReportSectionId): BetaReportSectionDefinition {
  const result = BETA_REPORT_SECTIONS.find((candidate) => candidate.id === id);
  if (result === undefined) {
    throw new Error("UNKNOWN_BETA_REPORT_SECTION");
  }
  return result;
}
