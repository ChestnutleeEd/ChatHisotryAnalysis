import { useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ImgHTMLAttributes, type ReactNode, type Ref } from "react";

import type { QueryChipViewModel } from "./view-model";

export type BetaCardVariant = "hero" | "metric" | "narrative" | "chart" | "split" | "word" | "privacy";
export type BetaButtonVariant = "primary" | "secondary" | "tertiary" | "exit";

function joinClasses(...values: readonly (string | undefined | false)[]): string {
  return values.filter(Boolean).join(" ");
}

export function Scene({
  scene,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  readonly scene?: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      {...props}
      className={joinClasses("beta-scene", scene === undefined ? undefined : `beta-scene-${scene}`, className)}
      data-scene={scene}
    >
      {children}
    </section>
  );
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
