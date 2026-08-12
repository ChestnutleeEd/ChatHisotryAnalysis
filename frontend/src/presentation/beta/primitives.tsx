import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ImgHTMLAttributes, type ReactNode, type Ref } from "react";

import type { QueryChipViewModel } from "./view-model";
import { motionDelayMs, useOneShotSceneReveal } from "./motion";
import { useDerivedAnnualScene, type AnnualSceneNavigationItem } from "./annual-navigation";

export type BetaCardVariant = "hero" | "metric" | "narrative" | "chart" | "split" | "word" | "privacy";
export type BetaButtonVariant = "primary" | "secondary" | "tertiary" | "exit";
export type V3LayoutMode = "paired" | "asymmetric" | "stacked" | "full";

function joinClasses(...values: readonly (string | undefined | false)[]): string {
  return values.filter(Boolean).join(" ");
}

export function Scene({
  scene,
  className,
  children,
  reveal = false,
  motionIndex = 0,
  layoutMode = "full",
  whitespaceIntent,
  style,
  ...props
}: HTMLAttributes<HTMLElement> & {
  readonly scene?: string;
  readonly children: ReactNode;
  readonly reveal?: boolean;
  readonly motionIndex?: number;
  readonly layoutMode?: V3LayoutMode;
  readonly whitespaceIntent?: string;
}) {
  const motion = useOneShotSceneReveal(reveal);
  const motionStyle = reveal
    ? {
      ...style,
      "--beta-motion-delay": `${motionDelayMs(motionIndex)}ms`,
    } as CSSProperties
    : style;
  return (
    <section
      {...props}
      ref={reveal ? motion.ref : undefined}
      style={motionStyle}
      className={joinClasses("beta-scene", scene === undefined ? undefined : `beta-scene-${scene}`, className)}
      data-scene={scene}
      data-v3-scene={scene}
      data-v3-layout-mode={layoutMode}
      data-whitespace-intent={whitespaceIntent}
      data-motion={reveal ? "scene" : undefined}
      data-motion-state={reveal ? motion.state : undefined}
    >
      {children}
    </section>
  );
}

export function PageShell({
  mode = "annual",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  readonly mode?: "annual" | "home" | "detailed";
  readonly children: ReactNode;
}) {
  return (
    <div
      {...props}
      className={joinClasses("v3-page-shell", `v3-page-shell-${mode}`, className)}
      data-v3-page-shell={mode}
    >
      {children}
    </div>
  );
}

export function AnnualScene({
  scene,
  children,
  className,
  layoutMode = "full",
  whitespaceIntent,
  ...props
}: HTMLAttributes<HTMLElement> & {
  readonly scene: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly layoutMode?: V3LayoutMode;
  readonly whitespaceIntent?: string;
}) {
  return (
    <Scene
      {...props}
      scene={scene}
      className={joinClasses("v3-annual-scene", className)}
      layoutMode={layoutMode}
      whitespaceIntent={whitespaceIntent}
    >
      {children}
    </Scene>
  );
}

export function SceneIntro({
  number,
  kicker,
  title,
  summary,
  headingId,
  className,
}: {
  readonly number?: string;
  readonly kicker?: string;
  readonly title: string;
  readonly summary?: string;
  readonly headingId?: string;
  readonly className?: string;
}) {
  return (
    <header className={joinClasses("v3-scene-intro", className)}>
      {number !== undefined ? <span className="v3-scene-folio" aria-hidden="true">{number}</span> : null}
      <div>
        {kicker !== undefined ? <p className="v3-scene-kicker">{kicker}</p> : null}
        <h2 id={headingId} className="v3-scene-title">{title}</h2>
        {summary !== undefined ? <p className="v3-scene-summary">{summary}</p> : null}
      </div>
    </header>
  );
}

export function StoryGrid({
  mode = "full",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  readonly mode?: V3LayoutMode;
  readonly children: ReactNode;
}) {
  return (
    <div {...props} className={joinClasses("v3-story-grid", className)} data-layout-mode={mode}>
      {children}
    </div>
  );
}

export function MetricCard({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { readonly children: ReactNode }) {
  return <article {...props} className={joinClasses("v3-metric-card", className)}>{children}</article>;
}

export function ChartPanel({
  label,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { readonly label: string; readonly children: ReactNode }) {
  return <figure {...props} className={joinClasses("v3-chart-panel", className)} aria-label={label}>{children}</figure>;
}

export function Annotation({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { readonly children: ReactNode }) {
  return <p {...props} className={joinClasses("v3-annotation", className)} data-v3-meaningful="annotation">{children}</p>;
}

export function SectionDivider({ className, ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr {...props} className={joinClasses("v3-section-divider", className)} />;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  return (
    <header className={joinClasses("beta-section-header", className)}>
      <div>
        {eyebrow !== undefined ? <p className="beta-section-eyebrow">{eyebrow}</p> : null}
        <h2 className="beta-section-title">{title}</h2>
        {description !== undefined ? <p className="beta-section-description">{description}</p> : null}
      </div>
      {children}
    </header>
  );
}

export function Metric({
  label,
  value,
  unit,
  description,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly description?: string;
  readonly className?: string;
}) {
  return (
    <div className={joinClasses("beta-metric", className)}>
      <span className="beta-metric-label">{label}</span>
      <div className="beta-metric-value">
        <strong>{value}</strong>
        {unit !== undefined && unit !== "" ? <span>{unit}</span> : null}
      </div>
      {description !== undefined ? <p className="beta-metric-description">{description}</p> : null}
    </div>
  );
}

export function MetricGroup({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { readonly children: ReactNode }) {
  return <div {...props} className={joinClasses("beta-metric-group", className)}>{children}</div>;
}

export function Surface({
  role = "card",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  readonly role?: "elevated" | "card" | "inset" | "subtle" | "status";
  readonly children: ReactNode;
}) {
  return <div {...props} className={joinClasses("beta-surface", `beta-surface-${role}`, className)}>{children}</div>;
}

export function Inset({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { readonly children: ReactNode }) {
  return <div {...props} className={joinClasses("beta-inset", className)}>{children}</div>;
}

export function ChartFrame({
  label,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { readonly label: string; readonly children: ReactNode }) {
  return <figure {...props} className={joinClasses("beta-chart-frame", className)} aria-label={label}>{children}</figure>;
}

export function Disclosure({
  summary,
  className,
  children,
}: {
  readonly summary: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return <details className={joinClasses("beta-disclosure", className)}><summary>{summary}</summary>{children}</details>;
}

export function Navigation({
  label,
  className,
  children,
}: {
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return <nav className={joinClasses("beta-navigation", className)} aria-label={label}>{children}</nav>;
}

export function ProgressNavigator({
  items,
  selectedSection,
  rangeValue,
  rangeOptions,
  sectionOptions,
  pending,
  onRangeChange,
  onSectionChange,
  onRestoreFullRange,
}: {
  readonly items: readonly AnnualSceneNavigationItem[];
  readonly selectedSection: string;
  readonly rangeValue: string;
  readonly rangeOptions: readonly { readonly value: string; readonly label: string }[];
  readonly sectionOptions: readonly { readonly value: string; readonly label: string }[];
  readonly pending: boolean;
  readonly onRangeChange: (value: string) => void;
  readonly onSectionChange: (section: string) => void;
  readonly onRestoreFullRange: () => void;
}) {
  const navigatorRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const initialSceneKey = items.find((item) => item.section === selectedSection)?.key ?? items[0]?.key ?? "";
  const derivedScene = useDerivedAnnualScene({
    navigatorRef,
    items,
    initialSceneKey,
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const currentScene = items.find((item) => item.key === derivedScene.sceneKey) ?? items[0];
  const currentIndex = currentScene === undefined ? 0 : items.findIndex((item) => item.key === currentScene.key);

  useEffect(() => {
    const selectedSceneKey = items.find((item) => item.section === selectedSection)?.key;
    if (selectedSceneKey !== undefined) {
      derivedScene.setSceneKey(selectedSceneKey);
    }
  }, [derivedScene.setSceneKey, items, selectedSection]);

  useEffect(() => {
    if (!panelOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setPanelOpen(false);
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panelOpen]);

  function selectSection(section: string): void {
    setPanelOpen(false);
    window.setTimeout(() => onSectionChange(section), 0);
  }

  function selectScene(item: AnnualSceneNavigationItem): void {
    derivedScene.setSceneKey(item.key);
    selectSection(item.section);
  }

  return (
    <nav
      ref={navigatorRef}
      className="v3-progress-navigator"
      aria-label="年度报告阅读导航"
      data-testid="beta-report-navigator"
      data-v3-navigator="annual"
      data-panel-open={panelOpen ? "true" : "false"}
    >
      <div className="v3-reading-dock">
        <div className="v3-dock-context" aria-live="polite">
          <span className="v3-dock-folio">{String(currentIndex + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}</span>
          <strong>{currentScene?.label ?? "开场"}</strong>
        </div>
        <ol className="v3-progress-steps" aria-label="年度报告七个场景">
          {items.map((item, index) => {
            const isCurrent = item.key === currentScene?.key;
            const state = isCurrent ? "current" : index < currentIndex ? "complete" : "upcoming";
            return (
              <li key={item.key} data-progress-state={state}>
                <button
                  type="button"
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={`第 ${index + 1} 场：${item.label}`}
                  onClick={() => selectScene(item)}
                >
                  <span aria-hidden="true">{index + 1}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <button
          ref={triggerRef}
          type="button"
          className="v3-range-toggle"
          aria-expanded={panelOpen}
          aria-controls="annual-range-controls"
          onClick={() => setPanelOpen((open) => !open)}
        >
          范围与章节
        </button>
      </div>
      {panelOpen ? (
        <div id="annual-range-controls" className="v3-range-panel" data-v3-meaningful="control-panel">
          <div className="v3-range-panel-heading">
            <p className="v3-panel-kicker">阅读设置</p>
            <p>选择已提交的回顾范围，或跳到一个逻辑章节。</p>
          </div>
          <label className="v3-range-field">
            <span>回顾范围</span>
            <select
              name="reportRange"
              autoComplete="off"
              value={rangeValue}
              disabled={pending}
              onChange={(event) => onRangeChange(event.currentTarget.value)}
            >
              {rangeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="v3-range-field">
            <span>跳转章节</span>
            <select
              name="reportSection"
              autoComplete="off"
              value={selectedSection}
              onChange={(event) => selectSection(event.currentTarget.value)}
            >
              {sectionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="v3-range-panel-action">
            <BetaButton variant="tertiary" disabled={pending} onClick={onRestoreFullRange}>
              恢复全部数据范围
            </BetaButton>
          </div>
        </div>
      ) : null}
    </nav>
  );
}

export function SkipLink({
  href = "#beta-main-content",
  children = "跳到主要内容",
}: {
  readonly href?: string;
  readonly children?: ReactNode;
}) {
  return <a className="beta-skip-link" href={href}>{children}</a>;
}

export function ToggleChip({
  label,
  checked,
  onChange,
  description,
  className,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly description?: string;
  readonly className?: string;
}) {
  return (
    <label className={joinClasses("beta-toggle-chip", className)}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      <span className="beta-toggle-chip-label">{label}</span>
      {description !== undefined ? <small>{description}</small> : null}
    </label>
  );
}

export function ArtworkFrame({
  src,
  width,
  height,
  alt = "",
  className,
  loading = "lazy",
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "width" | "height" | "loading"> & {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly alt?: string;
  readonly loading?: "eager" | "lazy";
}) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className={joinClasses("beta-artwork-frame", className)} style={{ "--beta-artwork-ratio": `${width} / ${height}` } as CSSProperties} aria-hidden={alt === "" ? true : undefined}>
      {failed ? (
        <div className="beta-artwork-fallback" aria-hidden="true" />
      ) : (
        <img
          {...props}
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={loading}
          onError={() => setFailed(true)}
        />
      )}
    </figure>
  );
}

export function BaseCard({
  variant,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  readonly variant: BetaCardVariant;
  readonly children: ReactNode;
}) {
  return (
    <article
      {...props}
      className={joinClasses("beta-card", `beta-card-${variant}`, className)}
      data-surface-role={variant === "privacy" ? "status" : variant === "hero" ? "report" : "card"}
    >
      {children}
    </article>
  );
}

export function BetaButton({
  variant = "secondary",
  loading = false,
  loadingLabel = "处理中",
  className,
  disabled,
  buttonRef,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: BetaButtonVariant;
  readonly loading?: boolean;
  readonly loadingLabel?: string;
  readonly buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      {...props}
      ref={buttonRef}
      type={props.type ?? "button"}
      className={joinClasses("beta-button", `beta-button-${variant}`, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      <span className="beta-button-label">{loading ? loadingLabel : children}</span>
    </button>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  readonly tone?: "neutral" | "privacy" | "partial" | "beta";
  readonly children: ReactNode;
}) {
  return <span className={`beta-badge beta-badge-${tone}`}>{children}</span>;
}

export function Chip({
  tone = "default",
  children,
}: {
  readonly tone?: "default" | "accent";
  readonly children: ReactNode;
}) {
  return <span className={`beta-chip beta-chip-${tone}`}>{children}</span>;
}

export function QueryChips({ chips }: { readonly chips: readonly QueryChipViewModel[] }) {
  return (
    <ul className="beta-query-chips" aria-label="当前已提交分析范围">
      {chips.map((chip) => (
        <li key={chip.id}>
          <Chip tone={chip.tone}>{chip.label}</Chip>
        </li>
      ))}
    </ul>
  );
}

export function StatusPill({
  tone,
  children,
}: {
  readonly tone: "success" | "pending" | "warning" | "error";
  readonly children: ReactNode;
}) {
  return <span className={`beta-status-pill beta-status-${tone}`}>{children}</span>;
}

export function HighlightSentence({ children }: { readonly children: ReactNode }) {
  return <p className="beta-highlight-sentence">{children}</p>;
}

export function MethodologyDisclosure({
  summary,
  chips = [],
  children,
}: {
  readonly summary: string;
  readonly chips?: readonly string[];
  readonly children: ReactNode;
}) {
  return (
    <details className="beta-methodology">
      <summary>
        <span>指标说明</span>
        <small>{summary}</small>
      </summary>
      {chips.length > 0 ? (
        <ul className="beta-method-chips" aria-label="方法标签">
          {chips.map((chip) => <li key={chip}><Chip>{chip}</Chip></li>)}
        </ul>
      ) : null}
      <div className="beta-methodology-copy">{children}</div>
    </details>
  );
}
