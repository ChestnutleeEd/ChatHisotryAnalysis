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
  HighlightSentence,
  Metric,
  MethodologyDisclosure,
  Navigation,
  QueryChips,
  Scene,
  Surface,
} from "./primitives";
import type { BetaRecapSkeletonViewModel } from "./view-model";
import type { BetaReportViewModelV1 } from "./report-contract";
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
  const currentSection = BETA_REPORT_SECTIONS.find((section) => section.id === selectedSection) ?? BETA_REPORT_SECTIONS[0];
  const currentScene = REPORT_SCENES.find((scene) => scene.key === currentSection?.scene) ?? REPORT_SCENES[0];
  return (
    <Navigation label="年度报告导航" className="beta-report-navigation" data-testid="beta-report-navigator">
      <div className="beta-report-navigation-context" aria-live="polite">
        <span>年度回顾</span>
        <strong>{currentScene.label}</strong>
        <small>{currentSection?.order ?? 1} / {BETA_REPORT_SECTIONS.length}</small>
      </div>
      <ol className="beta-report-progress" aria-label="七个报告场景">
        {REPORT_SCENES.map((scene, index) => {
          const isCurrent = scene.key === currentScene.key;
          return (
            <li key={scene.key} className={isCurrent ? "is-current" : undefined}>
              <button
                type="button"
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`第 ${index + 1} 个场景：${scene.label}`}
                onClick={() => onSectionChange(scene.section)}
              >
                <span aria-hidden="true">{index + 1}</span>
                <em>{scene.label}</em>
              </button>
            </li>
          );
        })}
      </ol>
      <label className="beta-report-control-field beta-report-control-year">
        <span>回顾范围</span>
        <select
          name="reportRange"
          autoComplete="off"
          value={committedRangeValue(reportState, analyticsResult)}
          disabled={pending}
          onChange={(event) => onRangeChange(event.currentTarget.value)}
        >
          {representedYears.map((option) => (
            <option key={option.year} value={`year:${option.year}`}>
              {option.year} 年{option.scope === "partial-calendar-query" ? "（部分范围）" : ""}
            </option>
          ))}
          <option value="all-years">全部年份</option>
          {representedYears.length > 1 ? <option value="multi-year-overview">多年度总览</option> : null}
        </select>
      </label>
      <label className="beta-report-control-field beta-report-control-section">
        <span>跳转章节</span>
        <select
          name="reportSection"
          autoComplete="off"
          value={selectedSection}
          onChange={(event) => onSectionChange(event.currentTarget.value as BetaReportSectionId)}
        >
          {BETA_REPORT_SECTIONS.map((section) => (
            <option key={section.id} value={section.id}>
              {String(section.order).padStart(2, "0")} · {section.title}
            </option>
          ))}
        </select>
      </label>
      <div className="beta-report-navigation-actions">
        <BetaButton className="beta-report-restore-action" variant="tertiary" disabled={pending} onClick={onRestoreFullRange}>
          恢复全部数据范围
        </BetaButton>
      </div>
    </Navigation>
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
      />
    );
  }
  const hasWordEvidence =
    analyticsResult !== undefined &&
    wordRole !== undefined &&
    onWordRoleChange !== undefined;
  return (
    <section
      id="beta-main-content"
      className="beta-report"
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

      <Scene id="opening" scene="opening" className="beta-report-hero beta-card beta-card-hero" data-surface-role="report">
        <div className="beta-report-hero-copy">
          <div className="beta-home-kicker">
            <Badge tone="beta">年度聊天报告</Badge>
            <Badge tone="privacy">仅本地呈现</Badge>
            {viewModel.fixtureKind === "synthetic-automated-test" ? (
              <Badge tone="partial">自动化合成测试</Badge>
            ) : null}
          </div>
          <p className="beta-type-eyebrow">{viewModel.scopeLabel}</p>
          <h1 id="beta-report-heading" className="beta-type-display" tabIndex={-1}>{viewModel.displayYear}</h1>
          <p className="beta-type-report-lead">{viewModel.headline}</p>
          <QueryChips chips={viewModel.queryChips} />
          <Metric
            className="beta-report-hero-metric"
            label={viewModel.metricLabel}
            value={viewModel.metricValue}
            unit={viewModel.metricUnit}
            description={viewModel.metricDefinition}
          />
        </div>
        <div className="beta-report-hero-art">
          <ArtworkFrame src={annualOpeningHero} width={1536} height={1024} loading="eager" className="beta-opening-artwork" />
          <p className="beta-artwork-caption">抽象的时间与节奏记录</p>
        </div>
        <a className="beta-next-cue" href="#messages" onClick={() => onSectionChange("messages")}>
          下一节：消息
        </a>
      </Scene>

      <div className="beta-report-scenes">
        <BaseCard id="messages" variant="metric" className="beta-report-metric-scene">
          <p className="beta-type-eyebrow">消息 · 02</p>
          <h2 className="beta-type-heading">这一范围聊了多少？</h2>
          <div className="beta-metric-composition">
            <strong className="beta-type-metric">{viewModel.metricValue}</strong>
            <span className="beta-type-metric-unit">{viewModel.metricUnit}</span>
          </div>
          <p className="beta-type-secondary">{viewModel.metricDefinition}</p>
        </BaseCard>

        <BaseCard id="active-days" variant="narrative" className="beta-report-narrative-scene">
          <p className="beta-type-eyebrow">阅读方式 · 03–16</p>
          <h2 className="beta-type-heading">沿着固定章节继续阅读</h2>
          <HighlightSentence>{viewModel.narrative}</HighlightSentence>
          <p className="beta-type-body">当前章节会明确区分已就绪与尚未提供的指标；词频与词云在下方保持本地生成和可读列表。</p>
        </BaseCard>

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
            chips={["UTC+08", "post-dedup", "本地聚合"]}
          >
            <p>当前卡片只使用已提交的安全聚合与范围元数据，不读取源文件、正文、文件名、路径或联系人信息。</p>
            <p>消息数来自当前已提交结果；其他年度指标尚未接入时会保持明确的未就绪状态。</p>
          </MethodologyDisclosure>
          <div className="beta-report-footer-actions">
            <BetaButton variant="secondary" onClick={onOpenDetailed}>进入详细分析</BetaButton>
          </div>
        </BaseCard>
      </div>
    </section>
  );
}

function ClosingScene({
  onOpenDetailed,
  methodology,
  privacyLabel = "本地聚合结果 · 不含消息正文或联系人身份",
}: {
  readonly onOpenDetailed: () => void;
  readonly methodology?: readonly { readonly id: string; readonly label: string; readonly value: string }[];
  readonly privacyLabel?: string;
}) {
  return (
    <Scene id="summary-share" scene="closing" className="beta-closing-scene" aria-labelledby="beta-closing-heading">
      <div className="beta-closing-copy">
        <p className="beta-type-eyebrow">总结与分享 · 16</p>
        <h2 id="beta-closing-heading" className="beta-type-heading">把这段本地记录留在手边</h2>
        <p className="beta-type-report-lead">回顾在这里收束；你的范围、指标和表达边界仍由本地已提交结果决定。</p>
        <p className="beta-type-body">这份 Beta 先提供可读的年度回顾。分享与导出的位置已经预留，但当前不会声称这些功能可用。</p>
        <Surface role="subtle" className="beta-closing-share-slot">
          <div>
            <Badge tone="partial">后续批次</Badge>
            <strong>分享与导出位置</strong>
          </div>
          <p>当前只呈现年度回顾；后续批次会在不上传原始内容的前提下接入分享与导出。</p>
        </Surface>
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
}: BetaAnnualReportProps & { readonly viewModel: BetaReportViewModelV1 }) {
  const canRenderWordEvidence = analyticsResult !== undefined && wordRole !== undefined && onWordRoleChange !== undefined;
  return (
    <section
      id="beta-main-content"
      className="beta-report beta-report-core"
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
        className="beta-v2-scene beta-v2-vocabulary"
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
          />
        ) : (
          <BetaUnavailableReportSections />
        )}
      </Scene>

      <ClosingScene
        onOpenDetailed={onOpenDetailed}
        methodology={viewModel.methodology}
        privacyLabel={`${viewModel.privacy.badgeLabel} · 不含消息正文或联系人身份。`}
      />
    </section>
  );
}
