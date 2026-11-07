import { TOUR_STEPS, type TourStep } from "./tourSteps";

/** The query parameter that holds the tour's place, one-based: `?tour=3`. */
export const TOUR_PARAM = "tour";

/** The zero-based step named by `?tour=<1-6>`; null when the parameter is absent or not a stop. */
export function stepFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get(TOUR_PARAM);
  if (raw === null || !/^\d+$/.test(raw)) {
    return null;
  }
  const n = Number(raw);
  return n >= 1 && n <= TOUR_STEPS.length ? n - 1 : null;
}

/**
 * `search` with the tour parameter set to a zero-based step, or removed for null. Other parameters
 * keep their place, so the Desk's `firmId` survives the walk through its three stops.
 */
export function stepSearch(search: string, step: number | null): string {
  const params = new URLSearchParams(search);
  if (step === null) {
    params.delete(TOUR_PARAM);
  } else {
    params.set(TOUR_PARAM, String(step + 1));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/** The search a step opens with when the tour arrives from another page: its params and its place. */
export function arrivalSearch(step: TourStep, index: number): string {
  return stepSearch(new URLSearchParams(step.params ?? {}).toString(), index);
}

/**
 * `search` with the step's params filled in where it lacks them, or null when none is missing. A
 * value already there is kept, so a link that names another firm still opens that firm.
 */
export function withStepParams(search: string, step: TourStep): string | null {
  const params = new URLSearchParams(search);
  let changed = false;
  for (const [key, value] of Object.entries(step.params ?? {})) {
    if (!params.has(key)) {
      params.set(key, value);
      changed = true;
    }
  }
  return changed ? `?${params.toString()}` : null;
}

/** The step after `i`, or null after the last. */
export function nextStep(i: number): number | null {
  return i + 1 < TOUR_STEPS.length ? i + 1 : null;
}

/** The step before `i`, or null before the first. */
export function prevStep(i: number): number | null {
  return i > 0 ? i - 1 : null;
}

/** The element a step points at, or null when it has none or it is not on the page (centred card). */
export function resolveAnchor(doc: Document, step: TourStep): Element | null {
  if (step.anchor === null) {
    return null;
  }
  return doc.querySelector(`[data-tour="${step.anchor}"]`);
}
