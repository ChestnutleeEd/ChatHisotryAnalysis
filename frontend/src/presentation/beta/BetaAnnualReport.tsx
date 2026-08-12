import { useRef, useState, type RefObject } from "react";

import {
  BETA_REPORT_SECTIONS,
  type BetaReportSectionId,
} from "./report-sections";
import {
  committedReportSelection,
  reportSelectionValue,
  type BetaReportPresentationState,
  type RepresentedYearOption,
} from "./report-state";
import {
  ArtworkFrame,
  BaseCard,
  Badge,
  BetaButton,
  Metric,
  MethodologyDisclosure,
  PageShell,
  ProgressNavigator,
  Scene,
  SceneIntro,
  Surface,
  StoryGrid,
} from "./primitives";
import type { BetaRecapSkeletonViewModel } from "./view-model";
import type { BetaReportViewModelV1 } from "./report-contract";
import type { ShareCardViewModelV1 } from "./summary-contract";
import { BetaSharePreviewDialog } from "./BetaSharePreviewDialog";
import type { ShareCardPreviewModels } from "./share-preview-state";
import { BetaCoreReportSections, BetaUnavailableReportSections } from "./BetaCoreReportSections";
import type { CanonicalAnalysisResult } from "../../worker-analysis/analytics-contract";
import type {
  WorkerWordFrequencyDtoV1,
  WordFrequencyRole,
} from "../../worker-analysis/word-frequency-contract";
import { BetaWordEvidenceSections } from "./BetaWordEvidenceSections";
import annualOpeningHero from "../../assets/beta/art/annual-opening-hero-v1.webp";
import closingPoster from "../../assets/beta/art/closing-poster-v1.webp";

const REPORT_SCENES = [
  { key: "opening", label: "开场", section: "opening" },
  { key: "scale", label: "规模", section: "messages" },
  { key: "rhythm", label: "节奏", section: "peak-month" },
  { key: "balance", label: "平衡", section: "sender-share" },
  { key: "conversation", label: "交流", section: "sessions" },
  { key: "vocabulary", label: "词汇", section: "frequent-words" },
  { key: "closing", label: "收束", section: "summary-share" },
] as const satisfies readonly { key: string; label: string; section: BetaReportSectionId }[];

export interface BetaAnnualReportProps {
  readonly viewModel: BetaRecapSkeletonViewModel | BetaReportViewModelV1;
  readonly reportState: BetaReportPresentationState;
  readonly representedYears: readonly RepresentedYearOption[];
  readonly selectedSection: BetaReportSectionId;
  readonly pending: boolean;
  readonly analyticsResult?: CanonicalAnalysisResult;
  readonly wordFrequency?: WorkerWordFrequencyDtoV1;
  readonly wordRole?: WordFrequencyRole;
  readonly wordFrequencyPending?: boolean;
  readonly wordFrequencyError?: string;
  readonly onRangeChange: (value: string) => void;
  readonly onSectionChange: (section: BetaReportSectionId) => void;
  readonly onRestoreFullRange: () => void;
  readonly onOpenDetailed: () => void;
  readonly onWordRoleChange?: (role: WordFrequencyRole) => void;
  readonly shareCardViewModel?: ShareCardViewModelV1;
  readonly onBuildSharePreview?: () => ShareCardPreviewModels | undefined;
  readonly onSaveShareCardPng?: (viewModel: ShareCardViewModelV1, bytes: Uint8Array) => Promise<"saved" | "cancelled">;
}

function isBetaReportViewModel(
  value: BetaAnnualReportProps["viewModel"],
): value is BetaReportViewModelV1 {
  return "schemaVersion" in value && value.schemaVersion === "chat-history-analysis.beta-report-view-model.v1";
}

function committedRangeValue(
  reportState: BetaReportPresentationState,
  analyticsResult: CanonicalAnalysisResult | undefined,
): string {
  return reportSelectionValue(
    analyticsResult === undefined
      ? reportState.selection
      : committedReportSelection(reportState.selection, analyticsResult.filters),
  );
}

function ReportNavigator({
  reportState,
  analyticsResult,
  representedYears,
  selectedSection,
  pending,
  onRangeChange,
  onSectionChange,
  onRestoreFullRange,
}: {
  readonly reportState: BetaReportPresentationState;
  readonly analyticsResult?: CanonicalAnalysisResult;
  readonly representedYears: readonly RepresentedYearOption[];
  readonly selectedSection: BetaReportSectionId;
  readonly pending: boolean;
  readonly onRangeChange: (value: string) => void;
  readonly onSectionChange: (section: BetaReportSectionId) => void;
  readonly onRestoreFullRange: () => void;
}) {
  const rangeOptions = [
    ...representedYears.map((option) => ({
      value: `year:${option.year}`,
      label: `${option.year} 年${option.scope === "partial-calendar-query" ? "（部分范围）" : ""}`,
    })),
    { value: "all-years", label: "全部年份" },
    ...(representedYears.length > 1 ? [{ value: "multi-year-overview", label: "多年度总览" }] : []),
  ];
  const sectionOptions = BETA_REPORT_SECTIONS.map((section) => ({
    value: section.id,
    label: `${String(section.order).padStart(2, "0")} · ${section.title}`,
  }));
  return (
    <ProgressNavigator
      items={REPORT_SCENES}
      selectedSection={selectedSection}
      rangeValue={committedRangeValue(reportState, analyticsResult)}
      rangeOptions={rangeOptions}
      sectionOptions={sectionOptions}
      pending={pending}
      onRangeChange={onRangeChange}
      onSectionChange={(section) => onSectionChange(section as BetaReportSectionId)}
      onRestoreFullRange={onRestoreFullRange}
    />
  );
}

export function BetaAnnualReport({
  viewModel,
  reportState,
  representedYears,
  selectedSection,
  pending,
  analyticsResult,
  wordFrequency,
  wordRole,
  wordFrequencyPending,
  wordFrequencyError,
  onRangeChange,
  onSectionChange,
  onRestoreFullRange,
  onOpenDetailed,
  onWordRoleChange,
  shareCardViewModel,
  onBuildSharePreview,
  onSaveShareCardPng,
}: BetaAnnualReportProps) {
  if (isBetaReportViewModel(viewModel)) {
    return (
      <BetaCoreAnnualReport
        viewModel={viewModel}
        reportState={reportState}
        representedYears={representedYears}
        selectedSection={selectedSection}
        pending={pending}
        analyticsResult={analyticsResult}
        wordFrequency={wordFrequency}
        wordRole={wordRole}
        wordFrequencyPending={wordFrequencyPending}
        wordFrequencyError={wordFrequencyError}
        onRangeChange={onRangeChange}
        onSectionChange={onSectionChange}
        onRestoreFullRange={onRestoreFullRange}
        onOpenDetailed={onOpenDetailed}
        onWordRoleChange={onWordRoleChange}
        shareCardViewModel={shareCardViewModel}
        onBuildSharePreview={onBuildSharePreview}
        onSaveShareCardPng={onSaveShareCardPng}
      />
    );
  }
  const hasWordEvidence =
    analyticsResult !== undefined &&
    wordRole !== undefined &&
    onWordRoleChange !== undefined;
  const selectLatestYear = () => {
    const latestYear = representedYears[representedYears.length - 1]?.year;
    if (latestYear !== undefined) onRangeChange(`year:${latestYear}`);
  };
  return (
    <PageShell mode="annual" className="v3-annual-page-shell">
      <section
        id="beta-main-content"
        className="beta-report v3-annual-report"
        data-v3-annual-report="true"
        data-beta-mode="annual-recap"
        data-fixture-kind={viewModel.fixtureKind}
        aria-labelledby="beta-report-heading"
        aria-busy={pending}
      >
      <ReportNavigator
        reportState={reportState}
        analyticsResult={analyticsResult}
        representedYears={representedYears}
        selectedSection={selectedSection}
        pending={pending}
        onRangeChange={onRangeChange}
        onSectionChange={onSectionChange}
        onRestoreFullRange={onRestoreFullRange}
      />

      {reportState.recoveryUsesDatasetRange ? (
        <p className="beta-recovery-note" role="status">
          已从数据集范围重建年度基准；请选择年份或全部年份以提交新的范围。
        </p>
      ) : null}

      <Scene id="opening" scene="opening" layoutMode="asymmetric" whitespaceIntent="opening-cinematic" className="v3-annual-scene v3-opening-scene" data-section-status="ready" reveal motionIndex={0} aria-labelledby="beta-report-heading">
        <StoryGrid mode="asymmetric" className="v3-opening-grid">
          <div className="v3-opening-copy" data-v3-geometry-cell="opening-copy" data-v3-cell-mode="asymmetric">
            <p className="v3-opening-folio">年度回顾 · 01 / {viewModel.scopeLabel}</p>
            <h1 id="beta-report-heading" className="v3-opening-title" tabIndex={-1}>{viewModel.displayYear}</h1>
            <p className="v3-opening-lead">{viewModel.headline}</p>
            {viewModel.fixtureKind === "synthetic-automated-test" ? (
              <p className="v3-opening-partial" role="note">合成测试夹具：以下内容不连接真实用户数据。</p>
            ) : null}
            <Metric
              className="v3-opening-metric"
              label={viewModel.metricLabel}
              value={viewModel.metricValue}
              unit={viewModel.metricUnit}
              description={viewModel.metricDefinition}
            />
            <dl className="v3-opening-facts">
              <div><dt>当前范围</dt><dd>{viewModel.scopeLabel}</dd></div>
              <div><dt>呈现边界</dt><dd>仅本地聚合</dd></div>
              <div><dt>报告状态</dt><dd>骨架数据</dd></div>
            </dl>
            <a className="v3-next-cue" href="#messages" onClick={() => onSectionChange("messages")}>下一节：规模</a>
          </div>
          <div className="v3-opening-art" data-v3-geometry-cell="opening-art" data-v3-cell-mode="asymmetric">
            <ArtworkFrame src={annualOpeningHero} width={1536} height={1024} loading="eager" className="v3-opening-artwork" />
            <p className="v3-artwork-caption">抽象的时间与节奏记录</p>
          </div>
        </StoryGrid>
      </Scene>

      <div className="v3-core-scenes">
        <Scene id="scale-scene" scene="scale" layoutMode="asymmetric" className="v3-annual-scene v3-scale-scene" reveal motionIndex={1} aria-labelledby="v3-skeleton-scale-heading">
          <SceneIntro number="02" kicker="规模" title="把这一年放到尺度里" summary="消息总量先成为主尺度；其余章节会在完整安全聚合结果就绪后展开。" headingId="v3-skeleton-scale-heading" />
          <StoryGrid mode="asymmetric" className="v3-scale-grid">
            <article id="messages" className="v3-skeleton-primary" data-v3-geometry-cell="scale-primary" data-v3-cell-mode="asymmetric">
              <p className="v3-logical-kicker">消息 · 02</p>
              <h3 className="v3-logical-title">这一范围聊了多少？</h3>
              <Metric label={viewModel.metricLabel} value={viewModel.metricValue} unit={viewModel.metricUnit} description={viewModel.metricDefinition} />
              <p className="v3-logical-lead">{viewModel.metricDefinition}</p>
            </article>
            <article id="active-days" className="v3-skeleton-evidence" data-v3-geometry-cell="scale-evidence" data-v3-cell-mode="asymmetric">
              <p className="v3-logical-kicker">阅读方式 · 03–16</p>
              <h3 className="v3-logical-title">沿着固定章节继续阅读</h3>
              <p className="v3-logical-lead">{viewModel.narrative}</p>
              <p className="v3-skeleton-status">当前章节会明确区分已就绪与尚未提供的指标；完整年度核心故事会在结果提交后显示。</p>
            </article>
          </StoryGrid>
        </Scene>
      </div>

        {BETA_REPORT_SECTIONS.filter((section) => section.order >= 4 && section.order <= 12).map((section) => (
          <span key={section.id} id={section.id} className="beta-report-section-anchor" aria-hidden="true" />
        ))}

        {hasWordEvidence ? (
          <BetaWordEvidenceSections
            result={analyticsResult}
            frequency={wordFrequency}
            requestedRole={wordRole}
            requestedYear={reportState.selection.kind === "year" ? reportState.selection.year : null}
            pending={wordFrequencyPending ?? false}
            error={wordFrequencyError}
            onRoleChange={onWordRoleChange}
            onSelectYear={selectLatestYear}
          />
        ) : BETA_REPORT_SECTIONS.filter((section) => section.order >= 13 && section.order <= 14).map((section) => (
          <span key={section.id} id={section.id} className="beta-report-section-anchor" aria-hidden="true" />
        ))}

        {BETA_REPORT_SECTIONS.filter((section) => section.order >= 15 && section.id !== "summary-share" && (!hasWordEvidence || section.id !== "word-cloud")).map((section) => (
          <span key={section.id} id={section.id} className="beta-report-section-anchor" aria-hidden="true" />
        ))}

      <ClosingScene onOpenDetailed={onOpenDetailed} />

        <BaseCard variant="privacy" className="beta-report-map-card">
          <div className="beta-report-map-heading">
            <div>
              <p className="beta-type-eyebrow">报告目录</p>
              <h2 className="beta-type-title">从开场到总结，共 16 个阅读章节</h2>
            </div>
            <Badge tone="privacy">本地聚合结果</Badge>
          </div>
          <ol className="beta-report-map">
            {BETA_REPORT_SECTIONS.map((section) => (
              <li key={section.id} data-delivery-slot={section.deliverySlot}>
                <button type="button" onClick={() => onSectionChange(section.id)}>
                  <span>{String(section.order).padStart(2, "0")}</span>
                  <strong>{section.title}</strong>
                  <small>{section.question}</small>
                </button>
              </li>
            ))}
          </ol>
          <MethodologyDisclosure
            summary="查看范围、时区与当前骨架边界"
            chips={["UTC+08", "去重后消息", "本地聚合"]}
          >
            <p>当前卡片只使用已提交的安全聚合与范围元数据，不读取源文件、正文、文件名、路径或联系人信息。</p>
            <p>消息数来自当前已提交结果；其他年度指标尚未接入时会保持明确的未就绪状态。</p>
          </MethodologyDisclosure>
          <div className="beta-report-footer-actions">
            <BetaButton variant="secondary" onClick={onOpenDetailed}>进入详细分析</BetaButton>
          </div>
        </BaseCard>
      </section>
    </PageShell>
  );
}

function ClosingScene({
  onOpenDetailed,
  methodology,
  privacyLabel = "本地聚合结果 · 不含消息正文或联系人身份",
  shareCardViewModel,
  sharePreviewTriggerRef,
  onOpenSharePreview,
}: {
  readonly onOpenDetailed: () => void;
  readonly methodology?: readonly { readonly id: string; readonly label: string; readonly value: string }[];
  readonly privacyLabel?: string;
  readonly shareCardViewModel?: ShareCardViewModelV1;
  readonly sharePreviewTriggerRef?: RefObject<HTMLButtonElement | null>;
  readonly onOpenSharePreview?: () => void;
}) {
  const shareCardUnavailable = shareCardViewModel?.exportAvailability.status === "unavailable";
  return (
    <Scene id="summary-share" scene="closing" layoutMode="asymmetric" whitespaceIntent="closing-cinematic" className="beta-closing-scene" reveal motionIndex={5} aria-labelledby="beta-closing-heading">
      <div className="beta-closing-copy">
        <p className="beta-type-eyebrow">总结与分享 · 16</p>
        <h2 id="beta-closing-heading" className="beta-type-heading">把这段本地记录留在手边</h2>
        <p className="beta-type-report-lead">回顾在这里收束；你的范围、指标和表达边界仍由本地已提交结果决定。</p>
        <p className="beta-type-body">这份 Beta 先提供可读的年度回顾。分享与导出的位置已经预留，但当前不会声称这些功能可用。</p>
        {shareCardViewModel === undefined ? (
          <Surface role="subtle" className="beta-closing-share-slot">
            <div>
              <Badge tone="partial">后续批次</Badge>
              <strong>分享与导出位置</strong>
            </div>
            <p>当前只呈现年度回顾；后续批次会在不上传原始内容的前提下接入分享与导出。</p>
          </Surface>
        ) : (
          <Surface role="subtle" className="beta-closing-share-entry" data-share-card-availability={shareCardViewModel.exportAvailability.status}>
            <div className="beta-closing-share-entry-heading">
              <div>
                <Badge tone={shareCardUnavailable ? "partial" : "privacy"}>{shareCardUnavailable ? "暂不可用" : "年度回顾卡"}</Badge>
                <strong>把这段范围整理成一张回顾卡</strong>
              </div>
              <span>{shareCardViewModel.scope.partial ? "部分日期范围" : shareCardViewModel.rangeLabel}</span>
            </div>
            <p>预览只使用当前本地统计结果，不包含聊天正文或联系人身份。</p>
            <BetaButton
              buttonRef={sharePreviewTriggerRef}
              data-testid="beta-share-preview-trigger"
              variant="primary"
              disabled={shareCardUnavailable || onOpenSharePreview === undefined}
              onClick={onOpenSharePreview}
            >
              生成回顾卡
            </BetaButton>
            {shareCardUnavailable ? <small className="beta-closing-share-entry-reason">当前范围没有可用的用户消息，暂时无法生成回顾卡。</small> : null}
          </Surface>
        )}
        {methodology !== undefined ? (
          <MethodologyDisclosure summary="查看范围、分母与表达边界" chips={["UTC+08:00", "本地聚合", "非评价性"]}>
            <ul className="beta-methodology-facts">
              {methodology.map((fact) => <li key={fact.id}><strong>{fact.label}</strong><span>{fact.value}</span></li>)}
            </ul>
          </MethodologyDisclosure>
        ) : null}
        <p className="beta-core-privacy-note">{privacyLabel}</p>
        <BetaButton variant="secondary" onClick={onOpenDetailed}>进入详细分析</BetaButton>
      </div>
      <div className="beta-closing-art">
        <ArtworkFrame src={closingPoster} width={1122} height={1402} className="beta-closing-poster" />
        <p className="beta-artwork-caption">抽象的累积与继续</p>
      </div>
    </Scene>
  );
}

function BetaCoreAnnualReport({
  viewModel,
  reportState,
  representedYears,
  selectedSection,
  pending,
  analyticsResult,
  wordFrequency,
  wordRole,
  wordFrequencyPending,
  wordFrequencyError,
  onRangeChange,
  onSectionChange,
  onRestoreFullRange,
  onOpenDetailed,
  onWordRoleChange,
  shareCardViewModel,
  onBuildSharePreview,
  onSaveShareCardPng,
}: BetaAnnualReportProps & { readonly viewModel: BetaReportViewModelV1 }) {
  const sharePreviewTriggerRef = useRef<HTMLButtonElement>(null);
  const [sharePreviewOpen, setSharePreviewOpen] = useState(false);
  const [sharePreviewModels, setSharePreviewModels] = useState<ShareCardPreviewModels>();
  const canRenderWordEvidence = analyticsResult !== undefined && wordRole !== undefined && onWordRoleChange !== undefined;
  const selectLatestYear = () => {
    const latestYear = representedYears[representedYears.length - 1]?.year;
    if (latestYear !== undefined) onRangeChange(`year:${latestYear}`);
  };
  function openSharePreview(): void {
    if (shareCardViewModel?.exportAvailability.status !== "ready" || onBuildSharePreview === undefined) {
      return;
    }
    const models = onBuildSharePreview();
    if (models === undefined) {
      return;
    }
    setSharePreviewModels(models);
    setSharePreviewOpen(true);
  }
  return (
    <PageShell mode="annual" className="v3-annual-page-shell">
      <section
        id="beta-main-content"
        className="beta-report beta-report-core v3-annual-report"
        data-v3-annual-report="true"
        data-beta-mode="annual-recap"
        aria-labelledby="beta-report-heading"
        aria-busy={pending}
      >
      <ReportNavigator
        reportState={reportState}
        analyticsResult={analyticsResult}
        representedYears={representedYears}
        selectedSection={selectedSection}
        pending={pending}
        onRangeChange={onRangeChange}
        onSectionChange={onSectionChange}
        onRestoreFullRange={onRestoreFullRange}
      />

      {pending ? (
        <p className="beta-report-pending" role="status">
          正在更新报告；以下暂时保留上一份完整报告。
        </p>
      ) : null}
      {viewModel.metadata.partialLabel !== null ? (
        <p className="beta-report-scope-banner" role="note">{viewModel.metadata.partialLabel}</p>
      ) : null}

      <BetaCoreReportSections viewModel={viewModel} />

      <Scene
        id="vocabulary-scene"
        scene="vocabulary"
        layoutMode="full"
        className="beta-v2-scene beta-v2-vocabulary"
        reveal
        motionIndex={4}
        aria-labelledby="beta-v2-scene-vocabulary-heading"
      >
        <header className="beta-v2-scene-heading">
          <span className="beta-v2-scene-number" aria-hidden="true">06</span>
          <div>
            <p className="beta-type-eyebrow">词汇</p>
            <h2 id="beta-v2-scene-vocabulary-heading" className="beta-type-heading">从常用词到整体词云</h2>
            <p className="beta-v2-scene-summary">三种词汇体验各自回答不同问题：出现最多、年度区分度，以及放在一起的整体形状。</p>
          </div>
        </header>
        {canRenderWordEvidence ? (
          <BetaWordEvidenceSections
            result={analyticsResult}
            frequency={wordFrequency}
            requestedRole={wordRole}
            requestedYear={analyticsResult.filters.selectedYear}
            pending={wordFrequencyPending ?? false}
            error={wordFrequencyError}
            onRoleChange={onWordRoleChange}
            onSelectYear={selectLatestYear}
          />
        ) : (
          <BetaUnavailableReportSections />
        )}
      </Scene>

      <ClosingScene
        onOpenDetailed={onOpenDetailed}
        methodology={viewModel.methodology}
        privacyLabel={`${viewModel.privacy.badgeLabel} · 不含消息正文或联系人身份。`}
        shareCardViewModel={shareCardViewModel}
        sharePreviewTriggerRef={sharePreviewTriggerRef}
        onOpenSharePreview={openSharePreview}
      />
      {shareCardViewModel !== undefined && sharePreviewModels !== undefined ? (
        <BetaSharePreviewDialog
          open={sharePreviewOpen}
          models={sharePreviewModels}
          currentViewModel={shareCardViewModel}
          triggerRef={sharePreviewTriggerRef}
          onClose={() => setSharePreviewOpen(false)}
          onSavePng={onSaveShareCardPng}
        />
      ) : null}
      </section>
    </PageShell>
  );
}
