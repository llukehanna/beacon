/**
 * The demo persona the app is viewed as: analyst, deal-team lead or compliance. It is kept in
 * localStorage (every access is guarded: it can throw or come back empty in a private window) and
 * sent as the `X-Beacon-Persona` header on every API call. It is demo-only and unauthenticated: the
 * server trusts the header, which a real deployment never would (it derives the persona from SSO).
 */
import React from "react";
import {
  DEFAULT_PERSONA,
  PERSONA_HEADER,
  type Persona,
  parsePersona,
} from "../../shared/accessPolicy";

const STORAGE_KEY = "beacon.persona";

function readStored(): Persona {
  try {
    return parsePersona(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_PERSONA;
  }
}

let current: Persona = readStored();
const listeners = new Set<() => void>();

export function getPersona(): Persona {
  return current;
}

/** Make `persona` the one requests are sent as, and tell whoever listens. */
export function setPersona(persona: Persona): void {
  if (persona === current) {
    return;
  }
  current = persona;
  try {
    window.localStorage.setItem(STORAGE_KEY, persona);
  } catch {
    // Not saved: the choice holds for this page load only.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current persona; the component re-renders when it changes. */
export function usePersona(): Persona {
  return React.useSyncExternalStore(subscribe, getPersona, () => DEFAULT_PERSONA);
}

/** Headers every API call carries. */
export function personaHeaders(): Record<string, string> {
  return { [PERSONA_HEADER]: current };
}

/** `fetch` with the persona header added. */
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, headers: { ...personaHeaders(), ...init.headers } });
}
