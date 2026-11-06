/** The class on the evidence drawer; it is a dialog, but the Desk's own shortcuts still apply in it. */
export const EVIDENCE_DRAWER_CLASS = "beacon-evidence-drawer";

/**
 * True while a dialog other than the evidence drawer is open (a confirmation, the shortcut list,
 * the command palette): it owns the keyboard, so the Desk's single-key shortcuts stand down.
 */
export function otherDialogOpen(doc: Document = document): boolean {
  return Array.from(doc.querySelectorAll('[role="dialog"]')).some(
    (d) =>
      d.closest(`.${EVIDENCE_DRAWER_CLASS}`) === null &&
      d.querySelector(`.${EVIDENCE_DRAWER_CLASS}`) === null,
  );
}
