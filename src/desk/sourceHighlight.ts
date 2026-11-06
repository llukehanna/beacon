/**
 * Pure helpers for the source drawer: where a finding's quote sits in its document, and how to
 * name the model that extracted it. No React, no data access.
 */

export interface QuoteSplit {
  before: string;
  match: string;
  after: string;
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Splits `body` around `quote`. A stored quote is a raw slice of the body, so a plain search
 * finds it; when whitespace differs (re-wrapped text), the match is made on whitespace-collapsed
 * text and mapped back to the raw body. Null when the quote is not in the body.
 */
export function highlightQuote(body: string, quote: string): QuoteSplit | null {
  if (quote.trim() === "") {
    return null;
  }
  const exact = body.indexOf(quote);
  if (exact >= 0) {
    return split(body, exact, exact + quote.length);
  }
  const wanted = collapse(quote);
  if (wanted === "") {
    return null;
  }
  // Collapse the body, remembering each collapsed character's raw index.
  let text = "";
  const rawIndex: number[] = [];
  let spaceAt = -1;
  for (let i = 0; i < body.length; i++) {
    if (/\s/.test(body[i])) {
      if (spaceAt < 0) {
        spaceAt = i;
      }
      continue;
    }
    if (spaceAt >= 0 && text !== "") {
      text += " ";
      rawIndex.push(spaceAt);
    }
    spaceAt = -1;
    text += body[i];
    rawIndex.push(i);
  }
  const at = text.indexOf(wanted);
  if (at < 0) {
    return null;
  }
  return split(body, rawIndex[at], rawIndex[at + wanted.length - 1] + 1);
}

function split(body: string, start: number, end: number): QuoteSplit {
  return { before: body.slice(0, start), match: body.slice(start, end), after: body.slice(end) };
}

// The server's RULE_BASED_MODEL id; src/ does not import server code.
const RULE_BASED = "rule-based";
const CLAUDE_ID = /^claude-([a-z]+)-(\d+)-(\d+)$/;

/** A reader's name for an extraction model id: "Claude Haiku 4.5", "Rule-based extractor". */
export function modelLabel(model: string | null | undefined): string | null {
  if (model === null || model === undefined || model === "") {
    return null;
  }
  if (model === RULE_BASED) {
    return "Rule-based extractor";
  }
  const m = CLAUDE_ID.exec(model);
  if (m === null) {
    return model;
  }
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  return `Claude ${family} ${m[2]}.${m[3]}`;
}

/** What the model chip's tooltip says: the read was recorded when the demo data was built, never live. */
export function modelChipTitle(model: string | null | undefined): string {
  const label = modelLabel(model);
  if (model === RULE_BASED || label === null) {
    return "Read by a rule-based extractor (no model).";
  }
  return `Read by ${label} when the demo data was built; no model runs on this page.`;
}

/**
 * A finding's excerpt as displayed. Only an excerpt backed by a source document is a quotation;
 * an abstention reason or "Analyst entered ..." note is plain text. Null when there is none.
 */
export function excerptText(f: {
  sourceExcerpt?: string | null;
  sourceDocumentId?: string | null;
}): string | null {
  const excerpt = f.sourceExcerpt ?? "";
  if (excerpt === "") {
    return null;
  }
  return f.sourceDocumentId ? `\u201c${excerpt}\u201d` : excerpt;
}

/** One numbered line of a source document, with the cited part (if any) split out. */
export interface DocLine {
  /** 1-based, the numbering the grounding checks report. */
  n: number;
  text: string;
  /** True when part of the quote sits on this line. */
  cited: boolean;
  parts: { text: string; mark: boolean }[];
}

/**
 * A document as numbered lines with the quote marked, for the evidence panel. `found` is false
 * when the quote is not in the body (the lines are still returned, unmarked).
 */
export function docLines(body: string, quote: string | null): { lines: DocLine[]; found: boolean } {
  const hit = quote === null ? null : highlightQuote(body, quote);
  const from = hit === null ? 0 : hit.before.length;
  const to = hit === null ? 0 : from + hit.match.length;
  let offset = 0;
  const lines = body.split("\n").map((text, i): DocLine => {
    const start = offset;
    const end = start + text.length;
    offset = end + 1;
    const markFrom = Math.max(start, from);
    const markTo = Math.min(end, to);
    if (hit === null || markFrom >= markTo) {
      return { n: i + 1, text, cited: false, parts: [{ text, mark: false }] };
    }
    const parts = [
      { text: text.slice(0, markFrom - start), mark: false },
      { text: text.slice(markFrom - start, markTo - start), mark: true },
      { text: text.slice(markTo - start), mark: false },
    ].filter((p) => p.text !== "");
    return { n: i + 1, text, cited: true, parts };
  });
  return { lines, found: hit !== null };
}
