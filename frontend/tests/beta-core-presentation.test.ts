import { describe, expect, it } from "vitest";

import { groupMonthRows, visualMarkerScale } from "../src/presentation/beta/BetaCoreReportSections";
import type { BetaLocalizedVisualRowV1 } from "../src/presentation/beta/report-contract";

function row(key: string, value: number): BetaLocalizedVisualRowV1 {
  return {
    key,
    label: key,
    value,
    displayValue: `${value} 条`,
    secondaryLabel: null,
    widthPercent: value === 0 ? 0 : 100,
    tone: "primary",
  };
}

describe("V3.2 Annual presentation helpers", () => {
  it("groups existing month rows into deterministic 12-cell year matrices", () => {
    const january2025 = row("2025-01", 10);
    const december2024 = row("2024-12", 12);
    const march2025 = row("2025-03", 30);

    const groups = groupMonthRows([march2025, december2024, january2025]);

    expect(groups.map((group) => group.year)).toEqual(["2024", "2025"]);
    expect(groups[0]?.months).toHaveLength(12);
    expect(groups[0]?.months[11]).toBe(december2024);
    expect(groups[1]?.months[0]).toBe(january2025);
    expect(groups[1]?.months[1]).toBeNull();
    expect(groups[1]?.months[2]).toBe(march2025);
  });

  it("does not invent cells for malformed or out-of-range month keys", () => {
    const groups = groupMonthRows([
      row("2025-00", 10),
      row("2025-13", 20),
      row("not-a-month", 30),
    ]);

    expect(groups).toEqual([]);
  });

  it("keeps zero invisible while making a non-zero near-zero mark distinguishable", () => {
    expect(visualMarkerScale(0, { minimum: 4, maximum: 18 })).toBe(0);
    expect(visualMarkerScale(0.01, { minimum: 4, maximum: 18 })).toBeGreaterThanOrEqual(4);
    expect(visualMarkerScale(0.01, { minimum: 4, maximum: 18 })).toBeLessThan(
      visualMarkerScale(1, { minimum: 4, maximum: 18 }),
    );
    expect(visualMarkerScale(1, { minimum: 4, maximum: 18 })).toBe(18);
  });
});
