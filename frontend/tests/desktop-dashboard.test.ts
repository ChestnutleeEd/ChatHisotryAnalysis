import { describe, expect, it } from "vitest";

import {
  DASHBOARD_ROUTES,
  comparativeScopeNotice,
  methodologyCopy,
  routeAt,
  routeIndex,
  validateDashboardFilters,
} from "../src/presentation/desktop-dashboard";
import {
  desktopFailureMessage,
  desktopPhaseLabel,
  desktopStateLabel,
  durationBucket,
  workerPhaseLabel,
} from "../src/presentation/desktop-workflow";
import { canonicalFilters } from "./canonical-analytics-fixtures";

const dataset = {
  minimumCalendarDate: "2025-01-01",
  maximumCalendarDate: "2025-01-04",
};

describe("Stage 9 dashboard presentation contracts", () => {
  it("keeps the eight result routes stable and keyboard-cyclic", () => {
    expect(DASHBOARD_ROUTES).toEqual([
      "Overview",
      "Trends",
      "Comparison",
      "Activity",
      "Words & Years",
      "Message Types",
      "Replies & Sessions",
      "Export",
    ]);
    expect(routeIndex("Overview")).toBe(0);
    expect(routeAt(-1)).toBe("Export");
    expect(routeAt(DASHBOARD_ROUTES.length)).toBe("Overview");
  });

  it("validates inclusive global filters before dispatch", () => {
    const valid = validateDashboardFilters(
      canonicalFilters({ startDate: "2025-01-01", endDate: "2025-01-04" }),
      dataset,
    );
    expect(valid.errors).toEqual({});
    expect(valid.filters?.startDate).toBe("2025-01-01");

    const reversed = validateDashboardFilters(
      canonicalFilters({ startDate: "2025-01-04", endDate: "2025-01-01" }),
      dataset,
    );
    expect(reversed.filters).toBeUndefined();
    expect(reversed.errors.range).toContain("不能晚于");

    const impossible = validateDashboardFilters(
      canonicalFilters({ startDate: "2025-02-30" }),
      dataset,
    );
    expect(impossible.filters).toBeUndefined();
    expect(impossible.errors.startDate).toBeDefined();
  });

  it("uses stable, privacy-safe workflow copy", () => {
    expect(desktopStateLabel("preprocessing")).toContain("验证");
    expect(desktopPhaseLabel("preprocessing")).toContain("去重");
    expect(workerPhaseLabel("sessionization")).toContain("会话");
    expect(desktopFailureMessage("SIDECAR_PROTOCOL_INVALID")).not.toContain("stderr");
    expect(desktopFailureMessage("SIDECAR_PROTOCOL_INVALID")).not.toContain("/");
    expect(desktopFailureMessage("SIDECAR_PROTOCOL_INVALID")).not.toContain("traceback");
    expect(("SIDECAR_PROTOCOL_INVALID" as const)).toMatch(/^[A-Z][A-Z0-9_]*$/u);
    expect(durationBucket(5_000)).toContain("正在处理");
    expect(durationBucket(120_000)).toContain("可以取消");
    const copy = [...methodologyCopy(), comparativeScopeNotice()].join(" ");
    expect(copy).not.toMatch(/更在意|更关心|更主动|更重视/iu);
    expect(copy).toContain("本地");
  });
});
