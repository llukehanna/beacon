import { useOsdkQuery } from "./hooks";

/** Every provider's reading of a firm, per axis (server function `firmObservations`). */
export function useFirmObservations(firmId: string | undefined) {
  return useOsdkQuery("firmObservations", firmId ? { firmId } : null);
}
