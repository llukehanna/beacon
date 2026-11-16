import React from "react";
import type { ActiveRubric } from "./rubric";

/** The loaded rubric, provided by `RubricProvider`. */
export const RubricContext = React.createContext<ActiveRubric | undefined>(undefined);

/** The active rubric and catalog. Only for components rendered under `RubricProvider`. */
export function useRubric(): ActiveRubric {
  const rubric = React.useContext(RubricContext);
  if (rubric === undefined) {
    throw new Error("useRubric needs a RubricProvider above it");
  }
  return rubric;
}
