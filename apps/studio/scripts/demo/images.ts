import { createRequire } from "node:module";
import type { MediaSlot } from "./types";

/**
 * The demo's images, composed as SVG and rasterised through sharp.
 *
 * Nothing binary is committed. A repository that ships a folder of PNG
 * fixtures acquires a folder of PNG fixtures nobody can regenerate, review or
 * recolour; a function that draws them stays legible and stays in sync with
 * the brand colours below.
 *
 * They are drawn rather than filled with a flat colour for a plainer reason:
 * the media library, the editor preview and every post card render these, and
 * a grid of coloured rectangles makes a screenshot look like a wireframe of a
 * CMS rather than a CMS.
 */

/**
 * sharp lives in `@cms/media`'s dependency tree, not the studio's.
 *
 * Adding it to `apps/studio/package.json` would mean an install, and the studio
 * has no runtime use for it — the one place it is needed is this script, which
 * already depends on `@cms/media` for storage. Resolving `require` relative to
 * that package's entry point finds the exact copy the upload pipeline itself
 * uses, so the seed cannot rasterise with a different version from the one that
 * will build the variants.
 */
const requireFromMedia = createRequire(import.meta.resolve("@cms/media"));

/**
 * The narrow slice of sharp's surface this file uses, declared locally.
 *
 * The package's own types are not resolvable from here for the same reason the
 * runtime require is indirect. Three methods is a small enough contract to
 * restate, and restating it keeps the file free of `any`.
 */
interface SharpInstance {
  png(): SharpInstance;
  toBuffer(): Promise<Buffer>;
}
type SharpFactory = (input: Buffer) => SharpInstance;

const sharp = requireFromMedia("sharp") as SharpFactory;

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

const INK = "#0B1220";
const INK_SOFT = "#182236";
const PAPER = "#F7F8FA";
const BRAND = "#2B59FF";
const BRAND_SOFT = "#8FA6FF";
const GREEN = "#12B981";
const AMBER = "#F59E0B";
const MUTED = "#64748B";
const LINE = "#D8DDE6";

/** One stack, so nothing depends on a font that may not be installed. */
const SANS = "Helvetica Neue, Helvetica, Arial, sans-serif";
const MONO = "Menlo, Consolas, monospace";

/** SVG is XML: an unescaped ampersand in a vendor name is a parse error. */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface TextOptions {
  x: number;
  y: number;
  size: number;
  fill: string;
  weight?: number;
  family?: string;
  anchor?: "start" | "middle" | "end";
  letterSpacing?: number;
  opacity?: number;
  /**
   * SVG collapses runs of whitespace like HTML does, which turns a
   * column-aligned monospace receipt into one ragged line. Only the mock
   * receipt needs this, so it is opt-in rather than the default.
   */
  preserveSpace?: boolean;
}

function text(value: string, o: TextOptions): string {
  return [
    `<text x="${o.x}" y="${o.y}"`,
    `font-family="${o.family ?? SANS}"`,
    `font-size="${o.size}"`,
    `font-weight="${o.weight ?? 400}"`,
    `fill="${o.fill}"`,
    `text-anchor="${o.anchor ?? "start"}"`,
    o.letterSpacing ? `letter-spacing="${o.letterSpacing}"` : "",
    o.opacity !== undefined ? `opacity="${o.opacity}"` : "",
    o.preserveSpace ? `xml:space="preserve"` : "",
    `>${esc(value)}</text>`,
  ]
    .filter(Boolean)
    .join(" ");
}

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  radius = 0,
  extra = "",
): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" ${extra}/>`;
}

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

/** The Acme wordmark, small, for the corner of every full-bleed graphic. */
function wordmark(x: number, y: number, fill: string): string {
  return [
    `<circle cx="${x + 9}" cy="${y - 6}" r="9" fill="${BRAND}"/>`,
    text("Acme", { x: x + 26, y, size: 20, fill, weight: 700, letterSpacing: 0.5 }),
  ].join("");
}

/* ------------------------------------------------------------------ */
/* The individual compositions                                         */
/* ------------------------------------------------------------------ */

/** An abstract cover: concentric arcs over a dark ground, plus the headline. */
function coverExpensePolicy(w: number, h: number): string {
  const rings = [520, 420, 320, 220, 130]
    .map(
      (r, i) =>
        `<circle cx="${w - 260}" cy="${h / 2}" r="${r}" fill="none" stroke="${
          i % 2 === 0 ? BRAND : BRAND_SOFT
        }" stroke-width="${i === 4 ? 0 : 1.5}" opacity="${0.18 + i * 0.08}"/>`,
    )
    .join("");

  const grid = Array.from({ length: 18 }, (_, i) =>
    `<line x1="0" y1="${i * 50}" x2="${w}" y2="${i * 50}" stroke="#FFFFFF" stroke-width="1" opacity="0.03"/>`,
  ).join("");

  return svg(
    w,
    h,
    [
      rect(0, 0, w, h, INK),
      grid,
      rings,
      `<circle cx="${w - 260}" cy="${h / 2}" r="130" fill="${BRAND}" opacity="0.9"/>`,
      wordmark(90, 110, PAPER),
      text("GUIDES · EXPENSE POLICY", {
        x: 90,
        y: 360,
        size: 20,
        fill: BRAND_SOFT,
        weight: 700,
        letterSpacing: 3,
      }),
      text("A policy people", { x: 90, y: 470, size: 84, fill: PAPER, weight: 700 }),
      text("actually follow", { x: 90, y: 566, size: 84, fill: PAPER, weight: 700 }),
      text("Fewer rules, written where the money is spent.", {
        x: 90,
        y: 640,
        size: 28,
        fill: MUTED,
      }),
      text("acme.com/blog", { x: 90, y: h - 80, size: 20, fill: MUTED, family: MONO }),
    ].join(""),
  );
}

/** Days-to-close, as a labelled bar chart with a target line. */
function chartCloseCycle(w: number, h: number): string {
  const months = [
    { label: "Jan", days: 9 },
    { label: "Feb", days: 9 },
    { label: "Mar", days: 8 },
    { label: "Apr", days: 8 },
    { label: "May", days: 6 },
    { label: "Jun", days: 6 },
    { label: "Jul", days: 5 },
    { label: "Aug", days: 4 },
  ];

  const plotLeft = 150;
  const plotRight = w - 110;
  const baseline = h - 160;
  const top = 250;
  const max = 10;
  const slot = (plotRight - plotLeft) / months.length;
  const barWidth = slot * 0.52;
  const scale = (days: number) => ((baseline - top) * days) / max;

  const gridlines = [0, 2, 4, 6, 8, 10]
    .map((value) => {
      const y = baseline - scale(value);
      return [
        `<line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="${LINE}" stroke-width="1"/>`,
        text(String(value), { x: plotLeft - 24, y: y + 7, size: 20, fill: MUTED, anchor: "end" }),
      ].join("");
    })
    .join("");

  const bars = months
    .map((month, i) => {
      const x = plotLeft + slot * i + (slot - barWidth) / 2;
      const height = scale(month.days);
      const fill = month.days <= 5 ? GREEN : BRAND;
      return [
        rect(x, baseline - height, barWidth, height, fill, 6),
        text(String(month.days), {
          x: x + barWidth / 2,
          y: baseline - height - 18,
          size: 24,
          fill: INK,
          weight: 700,
          anchor: "middle",
        }),
        text(month.label, {
          x: x + barWidth / 2,
          y: baseline + 38,
          size: 22,
          fill: MUTED,
          anchor: "middle",
        }),
      ].join("");
    })
    .join("");

  const targetY = baseline - scale(5);

  return svg(
    w,
    h,
    [
      rect(0, 0, w, h, PAPER),
      rect(0, 0, w, 10, BRAND),
      wordmark(90, 90, INK),
      text("Days to close, month by month", {
        x: 90,
        y: 170,
        size: 44,
        fill: INK,
        weight: 700,
      }),
      text("One 40-person finance team, period end to signed-off books", {
        x: 90,
        y: 210,
        size: 24,
        fill: MUTED,
      }),
      gridlines,
      `<line x1="${plotLeft}" y1="${targetY}" x2="${plotRight}" y2="${targetY}" stroke="${AMBER}" stroke-width="2" stroke-dasharray="8 6"/>`,
      text("target · 5 days", {
        x: plotRight,
        y: targetY - 12,
        size: 20,
        fill: AMBER,
        weight: 700,
        anchor: "end",
      }),
      bars,
      `<line x1="${plotLeft}" y1="${baseline}" x2="${plotRight}" y2="${baseline}" stroke="${INK}" stroke-width="2"/>`,
    ].join(""),
  );
}

/** A product screenshot: sidebar, KPI tiles, a trend line and a vendor table. */
function dashboardSpend(w: number, h: number): string {
  const sidebar = 230;
  const nav = ["Overview", "Cards", "Expenses", "Approvals", "Payables", "Reports"];

  const navItems = nav
    .map((label, i) => {
      const y = 150 + i * 54;
      const active = i === 0;
      return [
        active ? rect(20, y - 26, sidebar - 44, 40, "#1E2A42", 8) : "",
        rect(38, y - 12, 12, 12, active ? BRAND : MUTED, 3),
        text(label, { x: 62, y: 0 + y, size: 19, fill: active ? PAPER : "#93A0B5" }),
      ].join("");
    })
    .join("");

  const tiles = [
    { label: "Committed this quarter", value: "$1.94M", delta: "+6.2%", good: false },
    { label: "Budget variance", value: "-$84K", delta: "under", good: true },
    { label: "Unreconciled card spend", value: "$12,430", delta: "31 items", good: false },
  ];

  const tileWidth = 380;
  const tileCards = tiles
    .map((tile, i) => {
      const x = sidebar + 50 + i * (tileWidth + 24);
      return [
        rect(x, 160, tileWidth, 150, "#FFFFFF", 14, `stroke="${LINE}"`),
        text(tile.label, { x: x + 26, y: 200, size: 18, fill: MUTED }),
        text(tile.value, { x: x + 26, y: 258, size: 42, fill: INK, weight: 700 }),
        text(tile.delta, {
          x: x + 26,
          y: 290,
          size: 18,
          fill: tile.good ? GREEN : AMBER,
          weight: 700,
        }),
      ].join("");
    })
    .join("");

  const points = [0.42, 0.5, 0.46, 0.58, 0.63, 0.6, 0.71, 0.78, 0.74, 0.86, 0.9, 0.97];
  const chartX = sidebar + 50;
  const chartY = 360;
  const chartW = 760;
  const chartH = 300;
  const step = chartW / (points.length - 1);
  // The plot sits on the card's inner floor, not on `chartY + chartH`, which
  // would leave a band of blank card below the series.
  const plotFloor = chartY + chartH + 38;
  const plotHeight = chartH - 40;
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${chartX + i * step},${plotFloor - p * plotHeight}`)
    .join(" ");
  const area = `${line} L${chartX + chartW},${plotFloor} L${chartX},${plotFloor} Z`;

  const vendors = [
    ["Amazon Business", "$184,220"],
    ["Delta Air Lines", "$121,905"],
    ["Datadog", "$96,400"],
    ["WeWork", "$74,180"],
    ["Slack", "$41,300"],
  ];
  const tableX = chartX + chartW + 40;
  const tableRows = vendors
    .map((row, i) => {
      const y = chartY + 96 + i * 46;
      return [
        text(row[0] ?? "", { x: tableX + 24, y, size: 19, fill: INK }),
        text(row[1] ?? "", { x: w - 74, y, size: 19, fill: INK, weight: 700, anchor: "end" }),
        `<line x1="${tableX + 24}" y1="${y + 16}" x2="${w - 74}" y2="${y + 16}" stroke="${LINE}" stroke-width="1"/>`,
      ].join("");
    })
    .join("");

  return svg(
    w,
    h,
    [
      rect(0, 0, w, h, "#EEF1F6"),
      rect(0, 0, sidebar, h, INK),
      wordmark(38, 80, PAPER),
      navItems,
      rect(sidebar, 0, w - sidebar, 96, "#FFFFFF"),
      text("Spend overview", { x: sidebar + 50, y: 58, size: 30, fill: INK, weight: 700 }),
      rect(w - 260, 30, 180, 38, "#EEF1F6", 8),
      text("Last 90 days", { x: w - 240, y: 55, size: 18, fill: MUTED }),
      tileCards,
      rect(chartX, chartY, chartW, chartH + 60, "#FFFFFF", 14, `stroke="${LINE}"`),
      text("Committed vs invoiced", {
        x: chartX + 26,
        y: chartY + 40,
        size: 20,
        fill: INK,
        weight: 700,
      }),
      `<path d="${area}" fill="${BRAND}" opacity="0.12"/>`,
      `<path d="${line}" fill="none" stroke="${BRAND}" stroke-width="3.5" stroke-linejoin="round"/>`,
      rect(tableX, chartY, w - tableX - 50, chartH + 60, "#FFFFFF", 14, `stroke="${LINE}"`),
      text("Largest vendors", {
        x: tableX + 24,
        y: chartY + 40,
        size: 20,
        fill: INK,
        weight: 700,
      }),
      tableRows,
    ].join(""),
  );
}

/** A pull-quote card, the kind a customer story is shared with. */
function quoteNorthwind(w: number, h: number): string {
  return svg(
    w,
    h,
    [
      rect(0, 0, w, h, INK_SOFT),
      `<circle cx="${w - 120}" cy="${h - 100}" r="420" fill="${BRAND}" opacity="0.14"/>`,
      `<circle cx="120" cy="-60" r="300" fill="${GREEN}" opacity="0.10"/>`,
      text("“", { x: 100, y: 330, size: 260, fill: BRAND, weight: 700 }),
      text("We stopped chasing receipts", { x: 240, y: 320, size: 56, fill: PAPER, weight: 700 }),
      text("and started closing on the", { x: 240, y: 396, size: 56, fill: PAPER, weight: 700 }),
      text("fourth working day.", { x: 240, y: 472, size: 56, fill: PAPER, weight: 700 }),
      `<line x1="240" y1="545" x2="420" y2="545" stroke="${BRAND}" stroke-width="4"/>`,
      text("Elena Marsh", { x: 240, y: 610, size: 28, fill: PAPER, weight: 700 }),
      text("Financial Controller, Northwind Logistics", {
        x: 240,
        y: 650,
        size: 24,
        fill: BRAND_SOFT,
      }),
      wordmark(240, h - 90, PAPER),
    ].join(""),
  );
}

/** The approval route, as boxes and arrows. */
function flowApprovals(w: number, h: number): string {
  const boxes = [
    { x: 90, y: 430, w: 260, h: 130, title: "Submitted", sub: "card swipe or claim", fill: "#FFFFFF" },
    { x: 430, y: 430, w: 260, h: 130, title: "Under $75", sub: "auto-approved", fill: "#E7F8F1" },
    { x: 770, y: 280, w: 280, h: 130, title: "Budget owner", sub: "$75 – $5,000", fill: "#FFFFFF" },
    { x: 770, y: 580, w: 280, h: 130, title: "Finance review", sub: "over $5,000", fill: "#FFFFFF" },
    { x: 1140, y: 430, w: 300, h: 130, title: "Posted to the GL", sub: "coded and reconciled", fill: "#E8EDFF" },
  ];

  const drawn = boxes
    .map((b) =>
      [
        rect(b.x, b.y, b.w, b.h, b.fill, 14, `stroke="${LINE}" stroke-width="2"`),
        text(b.title, { x: b.x + 26, y: b.y + 56, size: 28, fill: INK, weight: 700 }),
        text(b.sub, { x: b.x + 26, y: b.y + 92, size: 20, fill: MUTED }),
      ].join(""),
    )
    .join("");

  const arrow = (x1: number, y1: number, x2: number, y2: number, colour: string) =>
    `<path d="M${x1},${y1} L${x2},${y2}" stroke="${colour}" stroke-width="3" fill="none" marker-end="url(#arrowhead)"/>`;

  return svg(
    w,
    h,
    [
      `<defs><marker id="arrowhead" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="${MUTED}"/></marker></defs>`,
      rect(0, 0, w, h, PAPER),
      rect(0, 0, w, 10, BRAND),
      wordmark(90, 90, INK),
      text("How an approval routes itself", {
        x: 90,
        y: 180,
        size: 44,
        fill: INK,
        weight: 700,
      }),
      text("Two thresholds, one exception path, no queue to babysit", {
        x: 90,
        y: 222,
        size: 24,
        fill: MUTED,
      }),
      arrow(350, 495, 420, 495, MUTED),
      arrow(690, 475, 760, 360, MUTED),
      arrow(690, 515, 760, 630, MUTED),
      arrow(1050, 350, 1130, 470, MUTED),
      arrow(1050, 640, 1130, 520, MUTED),
      drawn,
      text("94% of claims never reach a human", {
        x: 90,
        y: h - 60,
        size: 24,
        fill: GREEN,
        weight: 700,
      }),
    ].join(""),
  );
}

/** A receipt-matching panel. The one asset that ships without alt text. */
function receiptCapture(w: number, h: number): string {
  const fields = [
    ["Merchant", "Blue Bottle Coffee"],
    ["Amount", "$42.10"],
    ["Date", "14 Aug 2026"],
    ["Category", "Client meals"],
    ["Attendees", "3"],
  ];

  const rows = fields
    .map((field, i) => {
      const y = 300 + i * 62;
      return [
        text(field[0] ?? "", { x: 90, y, size: 20, fill: MUTED }),
        text(field[1] ?? "", { x: 320, y, size: 20, fill: INK, weight: 700 }),
        `<line x1="90" y1="${y + 22}" x2="640" y2="${y + 22}" stroke="${LINE}" stroke-width="1"/>`,
      ].join("");
    })
    .join("");

  return svg(
    w,
    h,
    [
      rect(0, 0, w, h, "#EEF1F6"),
      rect(50, 50, w - 100, h - 100, "#FFFFFF", 18, `stroke="${LINE}"`),
      text("Receipt captured", { x: 90, y: 130, size: 34, fill: INK, weight: 700 }),
      rect(90, 160, 200, 36, "#E7F8F1", 18),
      text("matched · 0.98", {
        x: 190,
        y: 185,
        size: 18,
        fill: GREEN,
        weight: 700,
        anchor: "middle",
      }),
      text("Fields read from the image", { x: 90, y: 250, size: 20, fill: MUTED, weight: 700 }),
      rows,
      rect(700, 160, w - 790, h - 250, "#F3F5F9", 14, `stroke="${LINE}" stroke-dasharray="6 6"`),
      text("BLUE BOTTLE", { x: 740, y: 230, size: 22, fill: INK, weight: 700, family: MONO }),
      text("2 x drip            9.00", {
        x: 740,
        y: 280,
        size: 18,
        fill: MUTED,
        family: MONO,
        preserveSpace: true,
      }),
      text("1 x pastry          6.50", {
        x: 740,
        y: 314,
        size: 18,
        fill: MUTED,
        family: MONO,
        preserveSpace: true,
      }),
      text("1 x lunch          22.00", {
        x: 740,
        y: 348,
        size: 18,
        fill: MUTED,
        family: MONO,
        preserveSpace: true,
      }),
      text("tax                 4.60", {
        x: 740,
        y: 382,
        size: 18,
        fill: MUTED,
        family: MONO,
        preserveSpace: true,
      }),
      `<line x1="740" y1="404" x2="1180" y2="404" stroke="${LINE}" stroke-width="1"/>`,
      text("TOTAL              42.10", {
        x: 740,
        y: 440,
        size: 20,
        fill: INK,
        weight: 700,
        family: MONO,
        preserveSpace: true,
      }),
      text("Card ending 4417 · authorised 14 Aug 12:41", {
        x: 740,
        y: 500,
        size: 17,
        fill: MUTED,
        family: MONO,
      }),
    ].join(""),
  );
}

/**
 * A monogram avatar.
 *
 * A generated portrait would be a lie about a person who does not exist; a
 * monogram is honest, recognisable at 32px in a byline, and enough for the
 * author-completeness meter to count a photo as present.
 */
function avatar(size: number, initials: string, from: string, to: string): string {
  const id = `g-${initials.toLowerCase()}`;
  return svg(
    size,
    size,
    [
      `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/></linearGradient></defs>`,
      rect(0, 0, size, size, INK),
      `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 18}" fill="url(#${id})"/>`,
      `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 40}" fill="none" stroke="#FFFFFF" stroke-width="3" opacity="0.35"/>`,
      text(initials, {
        x: size / 2,
        y: size / 2 + 46,
        size: 150,
        fill: "#FFFFFF",
        weight: 700,
        anchor: "middle",
        letterSpacing: 2,
      }),
    ].join(""),
  );
}

/* ------------------------------------------------------------------ */
/* Rasterisation                                                       */
/* ------------------------------------------------------------------ */

const COMPOSITIONS: Record<MediaSlot, (w: number, h: number) => string> = {
  coverExpensePolicy,
  chartCloseCycle,
  dashboardSpend,
  quoteNorthwind,
  flowApprovals,
  receiptCapture,
  avatarMaya: (size) => avatar(size, "MO", BRAND, "#7C3AED"),
  avatarDaniel: (size) => avatar(size, "DR", GREEN, "#0EA5E9"),
  avatarPriya: (size) => avatar(size, "PR", AMBER, "#EF4444"),
};

/**
 * Draw one image and return PNG bytes.
 *
 * PNG rather than JPEG because these are flat vector artwork with hard edges
 * and text; JPEG would ring around every letter. The upload pipeline re-encodes
 * into the AVIF/WebP ladder anyway, so the format here only decides what the
 * stored original looks like.
 */
export async function renderImage(
  slot: MediaSlot,
  width: number,
  height: number,
): Promise<Buffer> {
  const compose = COMPOSITIONS[slot];
  return sharp(Buffer.from(compose(width, height), "utf8")).png().toBuffer();
}
