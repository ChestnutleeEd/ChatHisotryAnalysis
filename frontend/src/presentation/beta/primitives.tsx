import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";

import type { QueryChipViewModel } from "./view-model";

export type BetaCardVariant = "hero" | "metric" | "narrative" | "chart" | "split" | "word" | "privacy";
export type BetaButtonVariant = "primary" | "secondary" | "tertiary" | "exit";

function joinClasses(...values: readonly (string | undefined | false)[]): string {
  return values.filter(Boolean).join(" ");
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
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: BetaButtonVariant;
  readonly loading?: boolean;
  readonly loadingLabel?: string;
}) {
  return (
    <button
      {...props}
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
