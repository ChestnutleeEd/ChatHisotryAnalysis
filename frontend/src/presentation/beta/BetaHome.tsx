import { BetaButton, PageShell, QueryChips, Scene } from "./primitives";
import type { BetaHomeViewModel } from "./view-model";

export function BetaHome({
  viewModel,
  pending,
  onOpenRecap,
  onOpenDetailed,
  onAnalyzeOtherFiles,
  onRestoreFullRange,
}: {
  readonly viewModel: BetaHomeViewModel;
  readonly pending: boolean;
  readonly onOpenRecap: () => void;
  readonly onOpenDetailed: () => void;
  readonly onAnalyzeOtherFiles: () => void;
  readonly onRestoreFullRange: () => void;
}) {
  return (
    <PageShell mode="home" className="v3-home-page-shell">
      <section
        id="beta-main-content"
        className="beta-home v3-home-portal"
        data-beta-mode="home"
        data-v3-home-portal="true"
        aria-labelledby="beta-home-heading"
        tabIndex={-1}
      >
        <Scene scene="home" className="v3-home-hero" layoutMode="asymmetric">
          <div className="v3-home-portal-grid">
            <div className="v3-home-copy">
              <p className="v3-home-folio">本地档案 · 首页</p>
              <p className="v3-home-eyebrow">已提交分析范围</p>
              <h1 id="beta-home-heading" className="v3-home-title" data-mode-focus-target tabIndex={-1}>{viewModel.heading}</h1>
              <p className="v3-home-lead">{viewModel.lead}</p>
              <QueryChips chips={viewModel.queryChips} />
              <div className="v3-home-actions">
                <BetaButton
                  variant="primary"
                  loading={pending}
                  data-testid="beta-home-annual-report"
                  onClick={onOpenRecap}
                >
                  查看年度报告
                </BetaButton>
                <BetaButton variant="secondary" disabled={pending} onClick={onOpenDetailed}>
                  进入详细分析
                </BetaButton>
              </div>
              <div className="v3-home-recovery-actions" aria-label="数据操作">
                {viewModel.empty ? (
                  <BetaButton variant="tertiary" disabled={pending} onClick={onRestoreFullRange}>
                    恢复全部数据范围
                  </BetaButton>
                ) : null}
                <BetaButton variant="tertiary" disabled={pending} onClick={onAnalyzeOtherFiles}>
                  重新选择文件
                </BetaButton>
              </div>
              <p className="v3-home-privacy-line">只在本机处理 · 不上传消息正文或联系人信息</p>
            </div>
            <aside className="v3-home-scope" aria-label="当前分析范围">
              <div className="v3-home-scope-heading">
                <p className="v3-home-scope-kicker">当前分析</p>
                <strong>{viewModel.messageCountLabel}</strong>
              </div>
              <dl>
                <div><dt>范围</dt><dd>{viewModel.scopeLabel}</dd></div>
                <div><dt>状态</dt><dd>{viewModel.scopeStatusLabel}</dd></div>
                <div><dt>最新年份</dt><dd>{viewModel.latestRepresentedYear ?? "—"}</dd></div>
              </dl>
              <span className="v3-home-archive-mark" aria-hidden="true" />
            </aside>
          </div>
        </Scene>
      </section>
    </PageShell>
  );
}
