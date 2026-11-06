import React from "react";
import { Term } from "@/components/Term";
import { HARD_GATE_PASS_WHEN } from "../findingActions";
import { type FirmView } from "./deskModel";

interface HardGate {
  editKey: string;
  readKey: keyof FirmView;
  label: string;
  helper?: React.ReactNode;
  // Which stored boolean reads as "cleared" for this gate. Analyst-facing
  // copy is Pass/Fail (uniform "Pass = cleared"); storage stays the same
  // boolean the ontology already speaks. Two of the four gates invert:
  //   advisoryConflict / hasStOrBalanceSheet: true = has-problem = Fail
  //   webActivity / solvent:                  true = clean = Pass
  passWhen: boolean;
}

// SDK read key is hasSTOrBalanceSheet; action write key is hasStOrBalanceSheet.
// Polarity lives in HARD_GATE_PASS_WHEN (findingActions) so it stays in
// sync with the conflict-prompt formatter and the accept/verify logic.
export const HARD_GATES: HardGate[] = [
  {
    editKey: "advisoryConflict",
    readKey: "advisoryConflict",
    label: "Advisory conflict",
    helper: (
      <>
        <Term id="CS">CS</Term> hard-reject
      </>
    ),
    passWhen: HARD_GATE_PASS_WHEN.advisoryConflict,
  },
  {
    editKey: "hasStOrBalanceSheet",
    readKey: "hasSTOrBalanceSheet",
    label: "S&T / balance sheet",
    passWhen: HARD_GATE_PASS_WHEN.hasStOrBalanceSheet,
  },
  {
    editKey: "webActivity",
    readKey: "webActivity",
    label: "Web activity",
    passWhen: HARD_GATE_PASS_WHEN.webActivity,
  },
  {
    editKey: "solvent",
    readKey: "solvent",
    label: "Solvent",
    passWhen: HARD_GATE_PASS_WHEN.solvent,
  },
];
