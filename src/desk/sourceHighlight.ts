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
