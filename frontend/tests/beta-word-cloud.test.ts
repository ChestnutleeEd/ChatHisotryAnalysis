import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BetaWordCloud } from "../src/presentation/beta/BetaWordCloud";
import { WORD_CLOUD_MIN_FREQUENCY } from "../src/word-cloud-layout/contracts";
import { createWordCloudPresentation } from "../src/word-cloud-layout/presentation";
import { createSyntheticFrequencyDto } from "./word-cloud-layout-fixtures";

describe("BetaWordCloud accessible Canvas contract", () => {
  it("keeps Canvas decorative and exposes one bounded list for the same selected words", () => {
    const frequency = createSyntheticFrequencyDto(32);
    const presentation = createWordCloudPresentation(
      frequency,
      [],
      "raw-count",
      32,
      WORD_CLOUD_MIN_FREQUENCY,
    );
    const html = renderToStaticMarkup(createElement(BetaWordCloud, {
      frequency,
      metric: "raw-count",
      customHiddenWords: [],
    }));
    expect(html).toContain('id="word-cloud"');
    expect(html).toContain('<canvas');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-layout-source="worker"');
    expect(html.match(/class="beta-word-cloud-list-rank"/gu)).toHaveLength(presentation.items.length);
    expect(html).not.toContain("canonicalEvents");
    expect(html).not.toContain("messageBody");
    expect(html).not.toContain("queryKey");
  });

  it("filters hidden words synchronously, keeps both metrics readable, and labels role/year", () => {
    const frequency = createSyntheticFrequencyDto(6);
    const hidden = frequency.items[1]!.normalizedToken;
    const html = renderToStaticMarkup(createElement(BetaWordCloud, {
      frequency,
      metric: "per-10000-eligible-tokens",
      customHiddenWords: [hidden],
      onHideWord: () => undefined,
    }));
    expect(html).not.toContain(`>${hidden}<`);
    expect(html).toContain("每万词频率");
    expect(html).toContain("出现");
    expect(html).toContain("双方");
    expect(html).toContain("2025 年");
    expect(html).toContain("隐藏此词");
  });

  it("shows a contentful empty state instead of a blank Canvas when all candidates are hidden", () => {
    const frequency = createSyntheticFrequencyDto(3);
    const html = renderToStaticMarkup(createElement(BetaWordCloud, {
      frequency,
      metric: "raw-count",
      customHiddenWords: frequency.items.map((item) => item.normalizedToken),
    }));
    expect(html).toContain("当前范围内没有足够的可展示词语");
    expect(html).not.toContain('<canvas');
    expect(html).not.toContain('class="beta-word-cloud-list-rank"');
  });
});
