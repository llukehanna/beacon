// Plain-language definitions for the jargon the desk uses. Rendered by
// <Term id="..."> (src/components/Term.tsx). Keys are the display terms.
export const GLOSSARY: Record<string, string> = {
  CF: "Corporate Finance: firms that advise on sell-side, buy-side and sector M&A. Scored on the CF rubric.",
  CS: "Capital Solutions: firms that advise on private credit, structured finance, private placements and secondaries. Scored on the CS rubric, with an extra advisory-conflict gate.",
  "Model: both":
    "This rule applies to both Corporate Finance (CF) and Capital Solutions (CS) firms.",
  "S&T / balance sheet":
    "Sales and trading, or principal activity on the firm's own balance sheet. Pass means the firm has none, so it can advise without a conflict.",
  Coverage:
    "How the firm organizes its bankers: around a single sector, several sectors, or as generalists.",
  "Hard gate":
    "A pass/fail requirement that screens a firm out regardless of its score. Fail any one and the firm is hard-rejected.",
  Drift:
    "New evidence has changed a firm's score or tier since the analyst last decided on it, so the earlier reason may no longer hold.",
  Tier: "The band an 18-point rubric score falls into: A is a strong fit, B moderate, C weak, and Rejected is below C.",
  Abstention:
    "No source had the value, so the agent recorded that instead of guessing. It marks where analyst judgment is needed.",
};
