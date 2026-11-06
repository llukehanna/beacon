import type { FirmObservations } from "../../shared/summaries";
import { useOsdkQuery } from "./hooks";

/** Every provider's reading of a firm, per axis (server function `firmObservations`). */
export function useFirmObservations(firmId: string | undefined) {
  return useOsdkQuery<FirmObservations>("firmObservations", firmId ? { firmId } : {}, {
    enabled: Boolean(firmId),
  });
}
