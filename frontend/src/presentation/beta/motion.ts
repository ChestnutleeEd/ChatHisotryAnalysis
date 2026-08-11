import { useEffect, useRef, useState, type RefObject } from "react";

export const BETA_MOTION = {
  fastMs: 120,
  standardMs: 220,
  completionMs: 420,
  staggerMs: 36,
  maxStaggerMs: 180,
  easing: "cubic-bezier(.2, .8, .2, 1)",
} as const;

export type OneShotRevealState = "idle" | "entering" | "complete";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function motionDelayMs(index: number): number {
  if (!Number.isFinite(index)) {
    return 0;
  }
  return Math.min(Math.max(0, Math.trunc(index)) * BETA_MOTION.staggerMs, BETA_MOTION.maxStaggerMs);
}

/**
 * Reveals already-rendered content once. The idle state is intentionally
 * visible in CSS, so unsupported observers and interrupted animations never
 * hide content or move focus.
 */
export function useOneShotSceneReveal(enabled: boolean): {
  readonly ref: RefObject<HTMLElement | null>;
  readonly state: OneShotRevealState;
} {
  const ref = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<OneShotRevealState>(enabled ? "idle" : "complete");

  useEffect(() => {
    if (!enabled) {
      setState("complete");
      return;
    }
    const node = ref.current;
    if (node === null || typeof window === "undefined") {
      setState("complete");
      return;
    }

    let finished = false;
    let timeoutId: number | undefined;
    const motionQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : undefined;

    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      setState("complete");
    };

    const enter = (): void => {
      if (finished) {
        return;
      }
      setState("entering");
      timeoutId = window.setTimeout(finish, BETA_MOTION.standardMs + BETA_MOTION.maxStaggerMs + 80);
    };

    if (prefersReducedMotion() || typeof window.IntersectionObserver === "undefined") {
      finish();
      return;
    }

    const onAnimationEnd = (): void => finish();
    const onAnimationCancel = (): void => finish();
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        finish();
      }
    };
    const onMotionPreferenceChange = (event: MediaQueryListEvent): void => {
      if (event.matches) {
        finish();
      }
    };
    node.addEventListener("animationend", onAnimationEnd);
    node.addEventListener("animationcancel", onAnimationCancel);
    document.addEventListener("visibilitychange", onVisibilityChange);
    motionQuery?.addEventListener("change", onMotionPreferenceChange);
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        enter();
      }
    }, { threshold: 0.01 });
    observer.observe(node);

    return () => {
      observer.disconnect();
      node.removeEventListener("animationend", onAnimationEnd);
      node.removeEventListener("animationcancel", onAnimationCancel);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      motionQuery?.removeEventListener("change", onMotionPreferenceChange);
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [enabled]);

  return { ref, state };
}
