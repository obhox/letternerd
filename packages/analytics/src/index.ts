/**
 * What is and is not working, and what to do about it.
 *
 * Three signal sources, kept deliberately separate because they measure
 * different things and fail independently: audience from Falorb (the CMS ships
 * no beacon of its own — a second beacon means two pageview numbers that never
 * agree), search from Google Search Console, and AI crawler hits the CMS
 * already collects first-party.
 *
 * The package's own contribution is neither of those. It is the join: the CMS
 * knows the document — its slug, publish date, word count, links — and the
 * providers know the traffic. `insights.ts` is where those meet and become a
 * ranked list an editor can work through, and it is pure: no network, no
 * database, no clock, no environment.
 */

export * from "./types";
export * from "./path";
export * from "./provider";
export * from "./falorb";
export * from "./search-console";
export * from "./insights";
