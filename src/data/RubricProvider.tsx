import React from "react";
import Loading from "@/components/Loading";
import { type ActiveRubric, useActiveRubric } from "./rubric";
import { RubricContext } from "./rubricContext";

/**
 * Loads the active rubric and its trait catalog once, for every page under it. Pages render only
 * once both have loaded, so a screen never has to handle a missing rubric.
 */
export function RubricProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const rubric = useActiveRubric();
  if (rubric === undefined) {
    return <Loading />;
  }
  return <RubricContext.Provider value={rubric}>{children}</RubricContext.Provider>;
}

/** For tests and stories: a fixed rubric, without loading it. */
export function RubricFixture({
  rubric,
  children,
}: {
  rubric: ActiveRubric;
  children: React.ReactNode;
}): React.ReactElement {
  return <RubricContext.Provider value={rubric}>{children}</RubricContext.Provider>;
}
