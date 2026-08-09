import { Badge, BetaButton, QueryChips, Scene, Surface } from "./primitives";
import type { BetaHomeViewModel } from "./view-model";

export function BetaHome({
  viewModel,
  pending,
  onOpenRecap,
  onOpenDetailed,
  onRestoreFullRange,
}: {
  readonly viewModel: BetaHomeViewModel;
  readonly pending: boolean;
  readonly onOpenRecap: () => void;
  readonly onOpenDetailed: () => void;
  readonly onRestoreFullRange: () => void;
}) {
  return (
    <section id="beta-main-content" className="beta-home" data-beta-mode="home" aria-labelledby="beta-home-heading" tabIndex={-1}>
      <Scene scene="home" className="beta-home-hero">
        <div className="beta-home-copy">
          <div className="beta-home-kicker">
            <Badge tone="beta">Beta 年度回顾</Badge>
            <Badge tone="privacy">本地处理 · 不上传</Badge>
          </div>
          <p className="beta-type-eyebrow">已提交分析范围</p>
          <h1 id="beta-home-heading" className="beta-type-display" tabIndex={-1}>{viewModel.heading}</h1>
          <p className="beta-type-report-lead">{viewModel.lead}</p>
          <QueryChips chips={viewModel.queryChips} />
          <div className="beta-home-actions">
            <BetaButton variant="primary" loading={pending} onClick={onOpenRecap}>
              查看年度聊天报告
            </BetaButton>
            <BetaButton variant="secondary" disabled={pending} onClick={onOpenDetailed}>
              进入详细分析
            </BetaButton>
          </div>
          {viewModel.empty ? (
            <BetaButton variant="tertiary" disabled={pending} onClick={onRestoreFullRange}>
              恢复全部数据范围
            </BetaButton>
          ) : null}
        </div>
        <Surface role="elevated" className="beta-home-folio" aria-label="当前分析摘要">
          <p className="beta-type-eyebrow">当前范围</p>
          <p className="beta-type-title">{viewModel.scopeLabel}</p>
          <p className="beta-type-secondary">{viewModel.messageCountLabel}</p>
          <p className="beta-type-metadata">
            {viewModel.representedYears.length > 0
              ? `${viewModel.representedYears.length} 个有消息的年份`
              : "当前范围暂无有消息的年份"}
          </p>
          <span className="beta-home-summary-mark" aria-hidden="true" />
        </Surface>
      </Scene>
    </section>
  );
}
