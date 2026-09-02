import { describe, expect, it } from "vitest";
import type { DecayInput, DocumentFacts, Insight, InsightInput, PagePerformance } from "../index";
import {
  INSIGHT_KINDS,
  daysBetween,
  findDecayingContent,
  findLowCtrHighImpressions,
  findNearMissRankings,
  findNeverCrawledByAi,
  findOrphans,
  findThinUnderperformers,
  median,
  positionBandOf,
  rankInsights,
} from "../index";

const NOW = "2026-09-01";

function facts(id: string, overrides: Partial<DocumentFacts> = {}): DocumentFacts {
  return {
    documentId: id,
    slug: id,
    path: `/blog/${id}`,
    title: `Post ${id}`,
    publishedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function row(
  id: string,
  performance: Omit<PagePerformance, "path">,
  overrides: Partial<DocumentFacts> = {},
): InsightInput {
  const documentFacts = facts(id, overrides);
  return { facts: documentFacts, performance: { path: documentFacts.path, ...performance } };
}

/** Filler pages that establish a band's median without being candidates themselves. */
function band(prefix: string, count: number, position: number, ctr: number, impressions = 200) {
  return Array.from({ length: count }, (_unused, index) =>
    row(`${prefix}${index}`, { impressions, clicks: Math.round(impressions * ctr), ctr, position }),
  );
}

describe("median", () => {
  it("takes the middle of an odd set and the mean of the middle two of an even set", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("is undefined for an empty set rather than zero", () => {
    expect(median([])).toBeUndefined();
  });

  it("is not dragged by an outlier the way a mean would be", () => {
    expect(median([1, 2, 3, 4, 100_000])).toBe(3);
  });
});

describe("positionBandOf", () => {
  it("splits on halves, so page one and page two do not blur together", () => {
    expect(positionBandOf(10.4)?.label).toBe("4-10");
    expect(positionBandOf(10.6)?.label).toBe("11-20");
    expect(positionBandOf(3.4)?.label).toBe("1-3");
    expect(positionBandOf(3.6)?.label).toBe("4-10");
    expect(positionBandOf(97)?.label).toBe("21+");
  });
});

describe("daysBetween", () => {
  it("counts whole days and refuses unusable input", () => {
    expect(daysBetween("2026-08-01", NOW)).toBe(31);
    expect(daysBetween(null, NOW)).toBeUndefined();
    expect(daysBetween("not a date", NOW)).toBeUndefined();
  });
});

describe("findLowCtrHighImpressions", () => {
  it("flags a page whose CTR is far below its own position band's median", () => {
    const rows = [
      ...band("filler", 6, 6, 0.05),
      row("target", { impressions: 4000, clicks: 40, ctr: 0.01, position: 6.2 }),
    ];

    const found = findLowCtrHighImpressions(rows);
    expect(found).toHaveLength(1);
    expect(found[0]?.documentId).toBe("target");
    expect(found[0]?.kind).toBe(INSIGHT_KINDS.lowCtrHighImpressions);
    expect(found[0]?.severity).toBe("high");
    expect(found[0]?.metric?.["positionBand"]).toBe("4-10");
    expect(found[0]?.metric?.["bandMedianCtr"]).toBe(0.05);
    expect(found[0]?.suggestedAction).toMatch(/title/i);
  });

  it("does not flag a low CTR that is normal for its band — position 30 at 1%", () => {
    const rows = [
      ...band("deep", 6, 30, 0.01),
      row("target", { impressions: 4000, clicks: 40, ctr: 0.01, position: 30 }),
    ];
    expect(findLowCtrHighImpressions(rows)).toEqual([]);
  });

  it("flags the identical CTR when the page ranks where clicks are expected", () => {
    const rows = [
      ...band("shallow", 6, 6, 0.05),
      row("target", { impressions: 4000, clicks: 40, ctr: 0.01, position: 6 }),
    ];
    expect(findLowCtrHighImpressions(rows).map((insight) => insight.documentId)).toEqual(["target"]);
  });

  it("stays silent when its band has too few pages to have a trustworthy median", () => {
    const rows = [
      ...band("filler", 3, 6, 0.05),
      row("target", { impressions: 4000, clicks: 40, ctr: 0.01, position: 6.2 }),
    ];
    expect(findLowCtrHighImpressions(rows)).toEqual([]);
  });

  it("ignores tiny-impression pages when computing the band median", () => {
    // Eight pages with two impressions each and a near-zero CTR would drag the
    // band median down far enough to hide the real finding.
    const rows = [
      ...band("legit", 5, 6, 0.05),
      ...band("noise", 8, 6, 0.001, 2),
      row("target", { impressions: 4000, clicks: 80, ctr: 0.02, position: 6 }),
    ];
    expect(findLowCtrHighImpressions(rows).map((insight) => insight.documentId)).toEqual(["target"]);
  });

  it("stays silent below the impressions floor", () => {
    const rows = [
      ...band("filler", 6, 6, 0.05),
      row("target", { impressions: 40, clicks: 0, ctr: 0, position: 6.2 }),
    ];
    expect(findLowCtrHighImpressions(rows)).toEqual([]);
  });

  it("skips documents with no search data at all", () => {
    expect(findLowCtrHighImpressions([row("a", { views: 900 })])).toEqual([]);
  });
});

describe("findNearMissRankings", () => {
  it("flags a page just off page one with real demand behind it", () => {
    const found = findNearMissRankings([row("a", { position: 12.4, impressions: 800, clicks: 9 })]);
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("high");
    expect(found[0]?.kind).toBe(INSIGHT_KINDS.nearMissRanking);
    expect(found[0]?.suggestedAction).toMatch(/refresh/i);
  });

  it("stays silent below the impressions floor", () => {
    expect(findNearMissRankings([row("a", { position: 12.4, impressions: 20 })])).toEqual([]);
  });

  it("ignores pages already on page one and pages far beyond page two", () => {
    expect(findNearMissRankings([row("a", { position: 4.1, impressions: 800 })])).toEqual([]);
    expect(findNearMissRankings([row("b", { position: 25, impressions: 800 })])).toEqual([]);
  });

  it("includes the boundaries it advertises", () => {
    expect(findNearMissRankings([row("a", { position: 8, impressions: 60 })])).toHaveLength(1);
    expect(findNearMissRankings([row("b", { position: 20, impressions: 60 })])).toHaveLength(1);
  });

  it("skips a page with no measured position", () => {
    expect(findNearMissRankings([row("a", { impressions: 800 })])).toEqual([]);
  });
});

describe("findDecayingContent", () => {
  function decay(
    id: string,
    previous: Omit<PagePerformance, "path">,
    current: Omit<PagePerformance, "path">,
    overrides: Partial<DocumentFacts> = {},
  ): DecayInput {
    const documentFacts = facts(id, { dateModified: "2024-01-01T00:00:00.000Z", ...overrides });
    return {
      facts: documentFacts,
      previous: { path: documentFacts.path, ...previous },
      current: { path: documentFacts.path, ...current },
    };
  }

  it("flags a sustained click decline on a stale page", () => {
    const found = findDecayingContent([decay("a", { clicks: 100 }, { clicks: 40 })], { now: NOW });
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("high");
    expect(found[0]?.metric?.["clickDropRatio"]).toBeCloseTo(0.6);
    expect(found[0]?.detail).toMatch(/clicks fell from 100 to 40/);
  });

  it("stays silent on a small baseline, where a percentage means nothing", () => {
    expect(findDecayingContent([decay("a", { clicks: 3 }, { clicks: 1 })], { now: NOW })).toEqual([]);
  });

  it("stays silent when the page was updated recently — that is re-evaluation, not decay", () => {
    const rows = [decay("a", { clicks: 100 }, { clicks: 40 }, { dateModified: "2026-08-20T00:00:00.000Z" })];
    expect(findDecayingContent(rows, { now: NOW })).toEqual([]);
  });

  it("flags a position slide when there were enough impressions to trust it", () => {
    const rows = [
      decay("a", { position: 8, impressions: 1000, clicks: 5 }, { position: 14, impressions: 900, clicks: 4 }),
    ];
    const found = findDecayingContent(rows, { now: NOW });
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("medium");
    expect(found[0]?.metric?.["positionDropPoints"]).toBe(6);
  });

  it("ignores a position slide on a page with too few impressions to be signal", () => {
    const rows = [decay("a", { position: 8, impressions: 40 }, { position: 20, impressions: 30 })];
    expect(findDecayingContent(rows, { now: NOW })).toEqual([]);
  });

  it("stays silent when nothing actually declined", () => {
    expect(findDecayingContent([decay("a", { clicks: 100 }, { clicks: 98 })], { now: NOW })).toEqual([]);
    expect(findDecayingContent([decay("a", { clicks: 100 }, { clicks: 140 })], { now: NOW })).toEqual([]);
  });

  it("ignores unpublished documents", () => {
    const rows = [decay("a", { clicks: 100 }, { clicks: 10 }, { publishedAt: null })];
    expect(findDecayingContent(rows, { now: NOW })).toEqual([]);
  });
});

describe("findOrphans", () => {
  it("flags a published page nothing links to", () => {
    const found = findOrphans([row("a", {}, { internalInboundLinks: 0 })]);
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("high");
    expect(found[0]?.kind).toBe(INSIGHT_KINDS.orphan);
  });

  it("flags a near-orphan less urgently", () => {
    expect(findOrphans([row("a", {}, { internalInboundLinks: 1 })])[0]?.severity).toBe("medium");
  });

  it("says nothing about a well-linked page", () => {
    expect(findOrphans([row("a", {}, { internalInboundLinks: 2 })])).toEqual([]);
  });

  it("skips a document whose link graph was never computed — undefined is not zero", () => {
    expect(findOrphans([row("a", {})])).toEqual([]);
  });

  it("ignores unpublished documents", () => {
    expect(findOrphans([row("a", {}, { internalInboundLinks: 0, publishedAt: null })])).toEqual([]);
  });

  it("downgrades an orphan that is ranking anyway", () => {
    const found = findOrphans([row("a", { impressions: 900 }, { internalInboundLinks: 0 })]);
    expect(found[0]?.severity).toBe("low");
  });
});

describe("findNeverCrawledByAi", () => {
  it("flags a long-published page no AI crawler has fetched", () => {
    const found = findNeverCrawledByAi([row("a", {}, { publishedAt: "2026-01-01T00:00:00.000Z" })], {
      now: NOW,
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("high");
    expect(found[0]?.kind).toBe(INSIGHT_KINDS.neverCrawledByAi);
  });

  it("stays silent for a page published days ago", () => {
    const rows = [row("a", {}, { publishedAt: "2026-08-20T00:00:00.000Z" })];
    expect(findNeverCrawledByAi(rows, { now: NOW })).toEqual([]);
  });

  it("scales severity with how long the silence has lasted", () => {
    const rows = [row("a", {}, { publishedAt: "2026-07-18T00:00:00.000Z" })];
    expect(findNeverCrawledByAi(rows, { now: NOW })[0]?.severity).toBe("low");
  });

  it("says nothing once a crawler has been seen", () => {
    const rows = [
      row("a", {}, { publishedAt: "2025-01-01T00:00:00.000Z", lastCrawledByAiAt: "2026-08-30T00:00:00.000Z" }),
    ];
    expect(findNeverCrawledByAi(rows, { now: NOW })).toEqual([]);
  });

  it("ignores unpublished documents", () => {
    expect(findNeverCrawledByAi([row("a", {}, { publishedAt: null })], { now: NOW })).toEqual([]);
  });
});

describe("findThinUnderperformers", () => {
  it("flags a short page search is ignoring", () => {
    const found = findThinUnderperformers([row("a", { impressions: 10 }, { wordCount: 200 })]);
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("medium");
    expect(found[0]?.kind).toBe(INSIGHT_KINDS.thinUnderperformer);
  });

  it("never escalates past medium — this is backlog work", () => {
    const found = findThinUnderperformers([row("a", { impressions: 0 }, { wordCount: 20 })]);
    expect(found[0]?.severity).toBe("medium");
  });

  it("needs both halves: short but performing, or long but ignored, is silent", () => {
    expect(findThinUnderperformers([row("a", { impressions: 900 }, { wordCount: 200 })])).toEqual([]);
    expect(findThinUnderperformers([row("b", { impressions: 10 }, { wordCount: 2000 })])).toEqual([]);
  });

  it("skips a document whose word count or impressions were never measured", () => {
    expect(findThinUnderperformers([row("a", { impressions: 10 })])).toEqual([]);
    expect(findThinUnderperformers([row("b", {}, { wordCount: 200 })])).toEqual([]);
  });

  it("gives a new page time before judging it, when a clock is supplied", () => {
    const rows = [row("a", { impressions: 10 }, { wordCount: 200, publishedAt: "2026-08-25T00:00:00.000Z" })];
    expect(findThinUnderperformers(rows, { now: NOW })).toEqual([]);
    expect(findThinUnderperformers(rows)).toHaveLength(1);
  });
});

describe("rankInsights", () => {
  function insight(overrides: Partial<Insight> & Pick<Insight, "kind" | "documentId" | "severity">): Insight {
    return {
      title: "t",
      detail: "d",
      suggestedAction: "a",
      ...overrides,
    };
  }

  const high = insight({
    kind: INSIGHT_KINDS.orphan,
    documentId: "orphan-1",
    severity: "high",
    metric: { impressions: 10 },
  });
  const highBigger = insight({
    kind: INSIGHT_KINDS.lowCtrHighImpressions,
    documentId: "ctr-1",
    severity: "high",
    metric: { impressions: 4000 },
  });
  const medium = insight({
    kind: INSIGHT_KINDS.nearMissRanking,
    documentId: "near-1",
    severity: "medium",
    metric: { impressions: 900 },
  });
  const low = insight({ kind: INSIGHT_KINDS.thinUnderperformer, documentId: "thin-1", severity: "low" });

  it("puts severity first and opportunity size second", () => {
    const ranked = rankInsights([low, medium, high, highBigger]);
    expect(ranked.map((item) => item.documentId)).toEqual(["ctr-1", "orphan-1", "near-1", "thin-1"]);
  });

  it("breaks ties between kinds by how cheap and certain the fix is", () => {
    const a = insight({ kind: INSIGHT_KINDS.thinUnderperformer, documentId: "z", severity: "medium" });
    const b = insight({ kind: INSIGHT_KINDS.lowCtrHighImpressions, documentId: "z", severity: "medium" });
    expect(rankInsights([a, b]).map((item) => item.kind)).toEqual([
      INSIGHT_KINDS.lowCtrHighImpressions,
      INSIGHT_KINDS.thinUnderperformer,
    ]);
  });

  it("is deterministic regardless of the order the rules ran in", () => {
    const all = [low, medium, high, highBigger];
    const forwards = rankInsights(all).map((item) => item.documentId);
    const backwards = rankInsights([...all].reverse()).map((item) => item.documentId);
    expect(backwards).toEqual(forwards);
  });

  it("totally orders identical findings, so repeated renders do not reshuffle", () => {
    const twins = [
      insight({ kind: INSIGHT_KINDS.orphan, documentId: "b", severity: "medium" }),
      insight({ kind: INSIGHT_KINDS.orphan, documentId: "a", severity: "medium" }),
    ];
    expect(rankInsights(twins).map((item) => item.documentId)).toEqual(["a", "b"]);
    expect(rankInsights([...twins].reverse()).map((item) => item.documentId)).toEqual(["a", "b"]);
  });

  it("does not mutate the array it was given", () => {
    const input = [low, highBigger];
    rankInsights(input);
    expect(input.map((item) => item.documentId)).toEqual(["thin-1", "ctr-1"]);
  });

  it("puts an unknown kind after the known ones rather than throwing", () => {
    const unknown = insight({ kind: "experimental", documentId: "x", severity: "medium" });
    const ranked = rankInsights([unknown, medium]);
    expect(ranked.map((item) => item.kind)).toEqual([INSIGHT_KINDS.nearMissRanking, "experimental"]);
  });
});
