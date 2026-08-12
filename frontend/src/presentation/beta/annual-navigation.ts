import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface AnnualSceneNavigationItem {
  readonly key: string;
  readonly label: string;
  readonly section: string;
}

interface DerivedAnnualSceneOptions {
  readonly navigatorRef: RefObject<HTMLElement | null>;
  readonly items: readonly AnnualSceneNavigationItem[];
  readonly initialSceneKey: string;
}

interface DerivedAnnualSceneState {
  readonly sceneKey: string;
  readonly setSceneKey: (sceneKey: string) => void;
}

const READING_LINE_RATIO = 0.28;
const READING_LINE_PADDING_PX = 8;
const STABILITY_DELAY_MS = 96;

function boundedReadingLine(viewportHeight: number, navigatorBottom: number): number {
  const preferredLine = Math.round(viewportHeight * READING_LINE_RATIO);
  return Math.min(
    Math.max(8, viewportHeight - 8),
    Math.max(navigatorBottom + 24, preferredLine),
  );
}

/**
 * Derive the folio from the reading position, not from the last button click.
 * One observer owns the seven mounted scene sentinels and is disconnected on
 * unmount. It never reads analytics state or schedules a report request.
 */
export function useDerivedAnnualScene({
  navigatorRef,
  items,
  initialSceneKey,
}: DerivedAnnualSceneOptions): DerivedAnnualSceneState {
  const [sceneKey, setSceneKeyState] = useState(initialSceneKey);
  const sceneKeyRef = useRef(sceneKey);

  useEffect(() => {
    sceneKeyRef.current = sceneKey;
  }, [sceneKey]);

  useEffect(() => {
    const navigator = navigatorRef.current;
    const annualRoot = navigator?.closest<HTMLElement>("[data-v3-annual-report]");
    if (navigator === null || annualRoot === null || annualRoot === undefined || typeof window === "undefined") {
      return;
    }

    const scenes = items
      .map((item) => ({
        item,
        element: annualRoot.querySelector<HTMLElement>(`[data-v3-scene="${item.key}"]`),
      }))
      .filter((entry): entry is { readonly item: AnnualSceneNavigationItem; readonly element: HTMLElement } => entry.element !== null);
    if (scenes.length === 0 || typeof window.IntersectionObserver === "undefined") {
      return;
    }

    const navigatorBottom = navigator.getBoundingClientRect().bottom;
    const readingLine = boundedReadingLine(window.innerHeight, navigatorBottom);
    const rootMargin = `-${readingLine - READING_LINE_PADDING_PX}px 0px -${window.innerHeight - readingLine - READING_LINE_PADDING_PX}px 0px`;
    const intersecting = new Map<string, IntersectionObserverEntry>();
    let stabilityTimer: number | undefined;
    let disposed = false;

    const publishNearestScene = (): void => {
      const next = [...intersecting.entries()]
        .filter(([, entry]) => entry.isIntersecting)
        .sort((left, right) => {
          const leftDistance = Math.abs(left[1].boundingClientRect.top - readingLine);
          const rightDistance = Math.abs(right[1].boundingClientRect.top - readingLine);
          return leftDistance - rightDistance;
        })[0]?.[0];
      if (next === undefined || next === sceneKeyRef.current || disposed) {
        return;
      }
      sceneKeyRef.current = next;
      setSceneKeyState(next);
    };

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const scene = scenes.find((candidate) => candidate.element === entry.target);
        if (scene !== undefined) {
          intersecting.set(scene.item.key, entry);
        }
      }
      if (stabilityTimer !== undefined) {
        window.clearTimeout(stabilityTimer);
      }
      stabilityTimer = window.setTimeout(publishNearestScene, STABILITY_DELAY_MS);
    }, {
      rootMargin,
      threshold: [0, 0.18, 0.5],
    });

    scenes.forEach(({ element }) => observer.observe(element));
    return () => {
      disposed = true;
      observer.disconnect();
      if (stabilityTimer !== undefined) {
        window.clearTimeout(stabilityTimer);
      }
    };
  }, [items, navigatorRef]);

  const setSceneKey = useCallback((nextSceneKey: string): void => {
    if (!items.some((item) => item.key === nextSceneKey) || nextSceneKey === sceneKeyRef.current) {
      return;
    }
    sceneKeyRef.current = nextSceneKey;
    setSceneKeyState(nextSceneKey);
  }, [items]);

  return {
    sceneKey,
    setSceneKey,
  };
}
