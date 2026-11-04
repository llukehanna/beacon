/**
 * Mock source documents. Each (provider, firm) pair renders to a short piece of
 * prose in that provider's house style, built from what the provider observes
 * for the firm (coverage gaps and errors included). Extraction reads these
 * documents, never the hidden truth. Pure: no DB, network, or crypto.
 */
import { ENRICH_AXES, PROVIDER_TRUST, type Provider } from "../../shared/vocab.js";
import { type FirmRef, PROVIDERS, idOf, observe } from "../enrichment/providers.js";
import { hash32, pick, rng } from "../enrichment/random.js";

/** Bump when any template changes: stored extractions made against older text go stale. */
export const DOCUMENT_VERSION = "doc-v1";

export interface DocumentField {
  axis: string;
  value: string;
  sentence: string;
}

export interface SourceDocument {
  documentId: string;
  provider: Provider;
  providerLabel: string;
  firmId: string;
  title: string;
  body: string;
  fields: DocumentField[];
  hash: string;
}

const hex = (n: number): string => n.toString(16).padStart(8, "0");

const plural = (n: string, one: string, many: string): string => (n === "1" ? one : many);

/** One sentence per axis. The value is always embedded exactly as `observe` returns it. */
const SENTENCES: Readonly<Record<string, (v: string) => string>> = {
  services_fit: (v) => `Its service offering is assessed as: ${v}.`,
  md_pedigree: (v) => `The senior bankers' backgrounds are summarized as: ${v}.`,
  balance_sheet_principal: (v) => `On principal activity, the record notes: ${v}.`,
  deal_size_usd_m: (v) => `A typical transaction is sized at about $${v} million.`,
  deals_per_md_l3y: (v) =>
    `The firm averaged ${v} closed deals per managing director over the last three years.`,
  firm_age: (v) => `The firm has been operating for ${v} ${plural(v, "year", "years")}.`,
  fee_generating_count: (v) =>
    `${v} ${plural(v, "professional is", "professionals are")} currently generating fees.`,
  advisory_conflict: (v) =>
    `Whether the firm carries a conflicting advisory relationship is recorded as ${v}.`,
  has_st_or_balance_sheet: (v) =>
    `Whether the firm runs a sales-and-trading desk or a balance sheet is recorded as ${v}.`,
  web_activity: (v) => `Whether the firm shows recent public web activity is recorded as ${v}.`,
  solvent: (v) => `Whether the firm is solvent is recorded as ${v}.`,
};

interface Style {
  heading: (name: string) => string;
  intro: readonly string[];
  closing: readonly string[];
}

/** House style per provider: the header line, plus pools for the filler sentences. */
const STYLES: Readonly<Record<Provider, Style>> = {
  beacondb: {
    heading: (name) => `Mock source: BeaconDB internal profile for ${name}.`,
    intro: [
      "This profile was compiled by the coverage team from calls and desk notes.",
      "Entries below are maintained by the sourcing team and reviewed each quarter.",
      "The profile is kept in the shared coverage workspace.",
    ],
    closing: [
      "Contact history is held on a separate tab.",
      "Questions about this profile go to the sourcing team.",
      "Ask the coverage team before sharing this profile outside the group.",
    ],
  },
  dealdb: {
    heading: (name) => `Mock source: Deal DB league-table entry for ${name}.`,
    intro: [
      "The entry is drawn from announced and reported advisory mandates.",
      "Rankings in the league table are refreshed from public announcements.",
      "Mandates are attributed to the lead advisor named in each announcement.",
    ],
    closing: [
      "Unannounced mandates are not included in the table.",
      "League-table placement is revised when new mandates are reported.",
      "Corrections can be submitted through the data desk.",
    ],
  },
  filings: {
    heading: (name) => `Mock source: regulatory filing summary for ${name}.`,
    intro: [
      "This summary restates the firm's most recent regulatory filing.",
      "The filer is registered as an advisory business under the applicable regime.",
      "Items below follow the order of the filing's disclosure sections.",
    ],
    closing: [
      "The full filing is available from the regulator on request.",
      "This summary does not replace the filing itself.",
      "Later amendments, if any, are not reflected here.",
    ],
  },
  websearch: {
    heading: (name) => `Mock source: About us page for ${name}, scraped from the firm's website.`,
    intro: [
      "Welcome to our website, where we introduce our team and the way we work.",
      "We partner closely with owners and management teams on important decisions.",
      "Our people are what set the firm apart from the first conversation.",
    ],
    closing: [
      "Get in touch to discuss how we can help.",
      "Reach out through the contact page to start a conversation.",
      "We look forward to hearing from you.",
    ],
  },
};

export function sourceDocument(provider: Provider, firm: FirmRef): SourceDocument {
  const firmId = idOf(firm);
  const name = firm.firmName ?? "this firm";
  const label = PROVIDERS[provider].label;
  const style = STYLES[provider];
  const r = rng(`doc|${provider}|${firmId}`);

  const fields: DocumentField[] = [];
  for (const axis of ENRICH_AXES) {
    const o = observe(provider, firm, axis);
    if (o) {
      fields.push({ axis: axis.axis, value: o.value, sentence: SENTENCES[axis.axis](o.value) });
    }
  }

  const middle =
    fields.length > 0
      ? fields.map((f) => f.sentence)
      : [`This record holds no detail on the topics tracked for ${name}.`];
  const lines = [style.heading(name), pick(r, style.intro), ...middle, pick(r, style.closing)];
  const body = lines.join("\n");
  return {
    documentId: `${provider}:${firmId}`,
    provider,
    providerLabel: label,
    firmId,
    title: `${label}: ${name}`,
    body,
    fields,
    hash: hex(hash32(`${DOCUMENT_VERSION}\n${body}`)),
  };
}

/** All four documents for a firm, most- to least-trusted provider. */
export function firmDocuments(firm: FirmRef): SourceDocument[] {
  return PROVIDER_TRUST.map((p) => sourceDocument(p, firm));
}

/** A stable fingerprint of the template version and every body. */
export function documentsHash(docs: readonly SourceDocument[]): string {
  return hex(hash32([DOCUMENT_VERSION, ...docs.map((d) => d.body)].join("\n\u0000\n")));
}
