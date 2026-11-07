// Plain-language definitions for the jargon the desk uses. Rendered by
// <Term id="..."> (src/components/Term.tsx). Keys are the display terms.
export const GLOSSARY: Record<string, string> = {
  CF: "Corporate Finance: firms that advise on sell-side, buy-side and sector M&A. Scored on the CF rubric.",
  CS: "Capital Solutions: firms that advise on private credit, structured finance, private placements and secondaries. Scored on the CS rubric, with an extra advisory-conflict gate.",
  "Model: both":
    "This rule applies to both Corporate Finance (CF) and Capital Solutions (CS) firms.",
  "Sales & trading / balance sheet":
    "Sales and trading, or principal activity on the firm's own balance sheet. Pass means the firm has none. It screens a firm out only when an approved rule uses it.",
  Coverage:
    "How the firm organizes its bankers: around a single sector, several sectors, or as generalists.",
  "Hard gate":
    "Pass/fail checks on a firm. An advisory conflict hard-rejects a CS firm automatically. Sales & trading / balance sheet, web activity and solvent screen a firm out only when an approved rule uses them. Other automatic rejections (CS principal investors; CF generalists and conflicted services) come from the scored axes.",
  Drift:
    "A firm has moved since the analyst decided on it. Either a qualified firm's tier changed; a passed firm now scores in a higher tier, so the reason for passing may no longer hold; or a passed firm's outcome diverged from the pass, such as being acquired by a competitor.",
  Tier: "The band a firm's 18-point rubric score falls into: A (strong fit), B (moderate fit), C (weak fit), or Rejected below C. Cut-offs differ by thesis: A is 14+ for CF and 13+ for CS; B is 10+ and C is 6+ for both. A hard-rejected firm is Rejected at 0.",
  Abstention:
    "No source had a supported value (none stated one, or the stated value had no supporting quote), so the agent recorded that instead of guessing. It marks where analyst judgment is needed.",
};
