import React from "react";
import { useLocation } from "react-router-dom";
import { stepFromSearch } from "./tourModel";
import { TOUR_STEPS } from "./tourSteps";

export interface TourControls {
  /** Opens the tour at its first stop. */
  start: () => void;
}

export const TourContext = React.createContext<TourControls>({ start: () => undefined });

/** Starts the guided tour from anywhere inside the app shell. */
export function useTour(): TourControls {
  return React.useContext(TourContext);
}

/**
 * The id of the stop the tour is on, read from `?tour=`; null when it is not running. Screens use
 * it to put themselves in the state a stop describes (the Desk opens its evidence drawer).
 */
export function useTourStepId(): string | null {
  const { search } = useLocation();
  const i = stepFromSearch(search);
  return i === null ? null : TOUR_STEPS[i].id;
}
