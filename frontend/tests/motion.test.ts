import { describe, expect, it } from "vitest";

import { BETA_MOTION, motionDelayMs, V3_MOTION } from "../src/presentation/beta/motion";

describe("B5 motion contract", () => {
  it("keeps the frozen durations, easing, and stagger cap", () => {
    expect(BETA_MOTION).toMatchObject({
      fastMs: 120,
      standardMs: 220,
      completionMs: 420,
      staggerMs: 36,
      maxStaggerMs: 180,
      easing: "cubic-bezier(.2, .8, .2, 1)",
    });
    expect(motionDelayMs(0)).toBe(0);
    expect(motionDelayMs(3)).toBe(108);
    expect(motionDelayMs(9)).toBe(180);
    expect(motionDelayMs(99)).toBe(180);
    expect(motionDelayMs(-1)).toBe(0);
    expect(motionDelayMs(Number.NaN)).toBe(0);
  });
});

describe("V3 motion contract", () => {
  it("keeps micro, navigation, scene, data, and canvas timings bounded", () => {
    expect(V3_MOTION).toMatchObject({
      microMs: 180,
      navigationMs: 220,
      sceneMs: 520,
      dataMs: 560,
      canvasMs: 600,
      easeStandard: "cubic-bezier(.22, 1, .36, 1)",
      easeEmphasis: "cubic-bezier(.16, 1, .3, 1)",
    });
    expect(V3_MOTION.sceneMs).toBeGreaterThanOrEqual(420);
    expect(V3_MOTION.sceneMs).toBeLessThanOrEqual(560);
    expect(V3_MOTION.canvasMs).toBeLessThanOrEqual(600);
  });
});
