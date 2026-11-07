import React from "react";
import { type DataAdapter, restAdapter } from "./adapter";

/** The adapter the hooks use. The REST adapter unless a provider above says otherwise (tests, another backend). */
export const DataAdapterContext = React.createContext<DataAdapter>(restAdapter);

export const DataAdapterProvider = DataAdapterContext.Provider;

export function useDataAdapter(): DataAdapter {
  return React.useContext(DataAdapterContext);
}
