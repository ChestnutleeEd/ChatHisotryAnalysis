import {
  BETA_REPORT_SECTIONS,
  type BetaReportSectionId,
} from "./report-sections";
import {
  reportSelectionValue,
  type BetaReportPresentationState,
  type RepresentedYearOption,
} from "./report-state";
import {
  BaseCard,
  Badge,
  BetaButton,
  HighlightSentence,
  MethodologyDisclosure,
  QueryChips,
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
      className="beta-report"
      data-beta-mode="annual-recap"
      data-fixture-kind={viewModel.fixtureKind}
      aria-labelledby="beta-report-heading"
      aria-busy={pending}
    >
      <nav className="beta-report-navigation" aria-label="年度报告导航">
        <label>
          <span>回顾范围</span>
          <select
            value={reportSelectionValue(reportState.selection)}
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
        <label>
          <span>跳转章节</span>
          <select
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
        <BetaButton variant="tertiary" disabled={pending} onClick={onRestoreFullRange}>
          恢复全部数据范围
        </BetaButton>
      </nav>

      {reportState.recoveryUsesDatasetRange ? (
        <p className="beta-recovery-note" role="status">
          已从数据集范围重建年度基准；请选择年份或全部年份以提交新的范围。
        </p>
      ) : null}

      <BaseCard id="opening" variant="hero" className="beta-report-hero">
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
        </div>
        <div className="beta-report-hero-metric" aria-label={`${viewModel.metricLabel} ${viewModel.metricValue} ${viewModel.metricUnit}`}>
          <span className="beta-type-metadata">{viewModel.metricLabel}</span>
          <strong className="beta-type-metric">{viewModel.metricValue}</strong>
          <span className="beta-type-metric-unit">{viewModel.metricUnit}</span>
        </div>
        <a className="beta-next-cue" href="#messages" onClick={() => onSectionChange("messages")}>
          下一节：消息
        </a>
      </BaseCard>

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

        {BETA_REPORT_SECTIONS.filter((section) => section.order >= 15 && (!hasWordEvidence || section.id !== "word-cloud")).map((section) => (
          <span key={section.id} id={section.id} className="beta-report-section-anchor" aria-hidden="true" />
        ))}

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
  const opening = viewModel.sections[0];
  const canRenderWordEvidence = analyticsResult !== undefined && wordRole !== undefined && onWordRoleChange !== undefined;
  return (
    <section
      className="beta-report beta-report-core"
      data-beta-mode="annual-recap"
      aria-labelledby="beta-report-heading"
      aria-busy={pending}
    >
      <nav className="beta-report-navigation" aria-label="年度报告导航">
        <label>
          <span>回顾范围</span>
          <select
            value={reportSelectionValue(reportState.selection)}
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
        <label>
          <span>跳转章节</span>
          <select
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
        <BetaButton variant="tertiary" disabled={pending} onClick={onRestoreFullRange}>
          恢复全部数据范围
        </BetaButton>
      </nav>

      {pending ? (
        <p className="beta-report-pending" role="status">
          正在更新报告；以下暂时保留上一份完整报告。
        </p>
      ) : null}
      {viewModel.metadata.partialLabel !== null ? (
        <p className="beta-report-scope-banner" role="note">{viewModel.metadata.partialLabel}</p>
      ) : null}

      <header className="beta-core-report-header">
        <div>
          <div className="beta-home-kicker">
            <Badge tone="beta">年度聊天报告</Badge>
            <Badge tone="privacy">{viewModel.privacy.localOnlyLabel}</Badge>
          </div>
          <p className="beta-type-eyebrow">{viewModel.metadata.scopeLabel}</p>
          <h1 id="beta-report-heading" className="beta-type-display" tabIndex={-1}>{viewModel.metadata.scopeLabel}</h1>
          <p className="beta-type-report-lead">{opening?.lead ?? "当前范围回顾"}</p>
          <QueryChips chips={viewModel.metadata.queryChips} />
        </div>
      </header>

      <BetaCoreReportSections viewModel={viewModel} />

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

      <BaseCard id="summary-share" variant="privacy" className="beta-core-summary-card">
        <div className="beta-core-card-heading">
          <div>
            <p className="beta-type-eyebrow">总结与分享 · 16</p>
            <h2 className="beta-type-heading">这份回顾如何被带走？</h2>
          </div>
          <Badge tone="partial">尚未提供</Badge>
        </div>
        <p className="beta-type-report-lead">当前 Beta 只呈现本地聚合指标；分享卡片与导出会在后续批次处理。</p>
        <MethodologyDisclosure summary="查看范围、分母与表达边界" chips={["UTC+08:00", "本地聚合", "非评价性"]}>
          <ul className="beta-methodology-facts">
            {viewModel.methodology.map((fact) => (
              <li key={fact.id}><strong>{fact.label}</strong><span>{fact.value}</span></li>
            ))}
          </ul>
        </MethodologyDisclosure>
        <p className="beta-core-privacy-note">{viewModel.privacy.badgeLabel} · 不含消息正文或联系人身份。</p>
        <BetaButton variant="secondary" onClick={onOpenDetailed}>进入详细分析</BetaButton>
      </BaseCard>
    </section>
  );
}
