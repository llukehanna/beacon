import React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useOsdkAction, useOsdkObjects } from "@/data/hooks";
import { Mandate, Search, runSearchAction } from "@/data/ontology";
import { type Command, useCommands } from "@/shell/commands";
import { Button, Chip, Notice, PageHeader, Panel } from "@/ui";
import {
  FACET_GEOGRAPHIES,
  FACET_INDUSTRIES,
  FACET_PRODUCTS,
  type MandateMatch,
  interpretMandate,
  searchVocabulary,
} from "../../shared/interpretMandate";
import { type FacetGroup, INDUSTRY_GROUPS, PRODUCT_GROUPS, REGIONS } from "../../shared/taxonomy";
import { FacetPicker } from "./FacetPicker";
import styles from "./SearchPage.module.css";
import { dropOptionKeeping, mergeValues, pickOption } from "./facetModel";

// /search/:mandateId: where a mandate's intent sentence becomes a Search. The analyst's picks on
// this page are the interpretation of the mandate: which regions, service lines and sector groups
// qualify a firm. Every Search runs exhaustively; this page is the interpretation surface, not a
// knob farm. The taxonomy is shared with the server's search matcher, so a tile the analyst can
// pick is always a value the backend understands.

interface MandateShape {
  mandateId: string;
  title?: string | null;
  intentStatement?: string | null;
  archetype?: string | null;
  priority?: string | null;
}

interface SearchShape {
  searchId: string;
  mandateId?: string | null;
  runAt?: string | number | Date | null;
  resultCount?: number | null;
}

const FIXED_BREADTH = "exhaustive";

const FACET_GROUPS: Readonly<Record<string, readonly FacetGroup[]>> = {
  [FACET_GEOGRAPHIES]: REGIONS,
  [FACET_PRODUCTS]: PRODUCT_GROUPS,
  [FACET_INDUSTRIES]: INDUSTRY_GROUPS,
};

const FACET_LABEL: Readonly<Record<string, string>> = {
  [FACET_GEOGRAPHIES]: "geography",
  [FACET_PRODUCTS]: "products",
  [FACET_INDUSTRIES]: "industries",
};

/**
 * One page instance per mandate: the route has no other key, so without it a move from one
 * mandate's search to another's (the palette, Back) would carry the first one's picks along.
 */
export default function SearchRoute(): React.ReactElement {
  const { mandateId } = useParams<{ mandateId: string }>();
  return <SearchPage key={mandateId} mandateId={mandateId} />;
}

function SearchPage({ mandateId }: { mandateId: string | undefined }): React.ReactElement {
  const navigate = useNavigate();
  const run = useOsdkAction(runSearchAction);

  const mandateQuery = useOsdkObjects(Mandate, {
    where: { mandateId: { $eq: mandateId ?? "" } },
    pageSize: 1,
  });
  const mandate = ((mandateQuery.data ?? []) as unknown as MandateShape[])[0];
  const mandateInstance = (mandateQuery.data ?? [])[0];
  const headline =
    (mandate?.intentStatement ?? "").trim() ||
    (mandate?.title ?? "").trim() ||
    mandateId ||
    "Unknown mandate";

  // After submitting, watch the searches under this mandate; when one appears with runAt at or
  // after the moment of submission, route to the desk filtered on it.
  const { data: searchesData } = useOsdkObjects(Search, {
    where: { mandateId: { $eq: mandateId ?? "" } },
    orderBy: { runAt: "desc" },
    autoFetchMore: true,
  });
  const searches = React.useMemo(
    () => (searchesData ?? []) as unknown as SearchShape[],
    [searchesData],
  );
  const [runStartedAt, setRunStartedAt] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (runStartedAt === null) {
      return;
    }
    const fresh = searches.find((s) => {
      const raw = s.runAt;
      if (raw === null || raw === undefined) {
        return false;
      }
      const ts = raw instanceof Date ? raw.getTime() : new Date(raw as string | number).getTime();
      return !Number.isNaN(ts) && ts >= runStartedAt;
    });
    if (fresh) {
      setRunStartedAt(null);
      navigate(`/desk?search=${encodeURIComponent(fresh.searchId)}`);
    }
  }, [runStartedAt, searches, navigate]);

  const [picks, setPicks] = React.useState<Readonly<Record<string, readonly string[]>>>({
    [FACET_GEOGRAPHIES]: [],
    [FACET_PRODUCTS]: [],
    [FACET_INDUSTRIES]: [],
  });
  const geographies = picks[FACET_GEOGRAPHIES];
  const products = picks[FACET_PRODUCTS];
  const industries = picks[FACET_INDUSTRIES];
  const change = (facet: string, fn: (cur: readonly string[]) => string[]): void =>
    setPicks((cur) => ({ ...cur, [facet]: fn(cur[facet] ?? []) }));

  // The mandate's own words pre-fill the pickers once, and only while the visitor has not picked
  // anything. `read` holds what was applied, so the chips below it can be taken back one by one.
  const mandateText = (mandate?.intentStatement ?? "").trim() || (mandate?.title ?? "").trim();
  const touched = React.useRef(false);
  const readDone = React.useRef(false);
  const [read, setRead] = React.useState<{
    matches: MandateMatch[];
    unmatched: string[];
    none: boolean;
  } | null>(null);
  const edited =
    (facet: string) =>
    (next: string[]): void => {
      touched.current = true;
      change(facet, () => next);
    };

  React.useEffect(() => {
    if (mandateText === "" || readDone.current) {
      return;
    }
    readDone.current = true;
    if (touched.current) {
      return;
    }
    const out = interpretMandate(mandateText, searchVocabulary());
    setRead({ ...out, none: out.matches.length === 0 });
    setPicks((cur) => {
      const next = { ...cur };
      for (const m of out.matches) {
        next[m.facet] = pickOption(next[m.facet] ?? [], m.value, FACET_GROUPS[m.facet] ?? []);
      }
      return next;
    });
  }, [mandateText]);

  // Takes back what this chip named. Other chips keep theirs, even when this one's category
  // owned them (dropping Europe leaves a chip for the United Kingdom picked).
  const takeBack = (match: MandateMatch): void => {
    touched.current = true;
    const others = (read?.matches ?? []).filter((m) => m !== match && m.facet === match.facet);
    change(match.facet, (cur) =>
      dropOptionKeeping(
        cur,
        match.value,
        FACET_GROUPS[match.facet] ?? [],
        others.map((m) => m.value),
      ),
    );
    setRead((cur) =>
      cur === null ? cur : { ...cur, matches: cur.matches.filter((m) => m !== match) },
    );
  };

  const awaiting = runStartedAt !== null && run.error === undefined;
  const canRun = mandateInstance !== undefined && !run.isPending && !awaiting;

  // Products and industries feed the SDK's single `industries` parameter. The page keeps them
  // apart (service lines and sector groups are different taxonomies); the backend gets one list.
  const mergedIndustries = React.useMemo(
    () => mergeValues(products, industries),
    [products, industries],
  );
  const totalPicked = geographies.length + products.length + industries.length;

  const onRun = (): void => {
    if (mandateInstance === undefined || !canRun) {
      return;
    }
    setRunStartedAt(Date.now());
    void run
      .applyAction({
        mandate: mandateInstance,
        geographies: geographies.length > 0 ? geographies : undefined,
        industries: mergedIndustries.length > 0 ? mergedIndustries : undefined,
        // Seed firms and exclusions are not part of the analyst surface; the facet picks capture
        // the whole interpretation, and the action defaults these.
        seedFirms: undefined,
        exclusions: undefined,
        breadth: FIXED_BREADTH,
      } as never)
      .catch(() => {
        setRunStartedAt(null);
      });
  };

  // The palette runs the latest handler without being re-registered on every render.
  const latest = React.useRef(onRun);
  latest.current = onRun;
  const commands = React.useMemo<Command[]>(
    () =>
      canRun
        ? [
            {
              id: "search:run",
              label: "Run search for this mandate",
              group: "Actions",
              run: () => latest.current(),
            },
          ]
        : [],
    [canRun],
  );
  useCommands(commands);

  return (
    <div className={styles.page}>
      <PageHeader
        back={<Link to="/mandate">← Mandates</Link>}
        title="Interpret & run search"
        sub="What the mandate’s intent means, operationally: pick the regions and service / sector categories that qualify a firm."
        actions={
          <>
            {mandate?.archetype && <Chip>{mandate.archetype}</Chip>}
            {mandate?.priority && <Chip>{mandate.priority}</Chip>}
          </>
        }
      />

      <div className={styles.scroll}>
        <Panel className={styles.mandate}>
          <div className={styles.kicker}>Mandate</div>
          <h2 className={styles.headline} data-loading={mandateQuery.isLoading || undefined}>
            {mandateQuery.isLoading ? "Loading mandate…" : headline}
          </h2>
          <p className={styles.explain}>
            The tiles below are how you translate that sentence into an operational filter: pick the
            geographies, service lines, and sector groups that qualify a firm. Broad categories
            cascade to their sub-options; deselect any you don&rsquo;t want.
          </p>
          {read !== null && (read.none || read.matches.length > 0 || read.unmatched.length > 0) && (
            <div className={styles.read} role="group" aria-label="Read from the mandate">
              <div className={styles.readLabel}>Read from the mandate</div>
              {read.none ? (
                <p className={styles.readNote}>
                  Nothing in the mandate text mapped to a filter; set them below.
                </p>
              ) : (
                <ul className={styles.readList}>
                  {read.matches.map((m) => (
                    <li key={`${m.facet}:${m.value}`}>
                      <Chip className={styles.readChip}>
                        <span>
                          &ldquo;{m.phrase}&rdquo; &rarr; {FACET_LABEL[m.facet] ?? m.facet}:{" "}
                          {m.value}
                        </span>
                        <button
                          type="button"
                          className={styles.readRemove}
                          aria-label={`Remove ${m.value} (read from “${m.phrase}”)`}
                          onClick={() => takeBack(m)}
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      </Chip>
                    </li>
                  ))}
                </ul>
              )}
              {read.unmatched.length > 0 && (
                <p className={styles.readNote}>
                  No filter for: {read.unmatched.join(", ")}. The search does not narrow on it.
                </p>
              )}
              <p className={styles.readNote}>
                Pre-filled from the text above; nothing runs until you press Run search.
              </p>
            </div>
          )}
        </Panel>

        <Panel>
          <FacetPicker
            gridId="search-geography"
            label="Geography"
            helper="Regions or specific countries / cities the mandate targets. Blank = no geographic filter."
            groups={REGIONS}
            values={geographies}
            onChange={edited(FACET_GEOGRAPHIES)}
            customPlaceholder="Add another country or region, then press Enter"
          />
        </Panel>
        <Panel>
          <FacetPicker
            gridId="search-products"
            label="Products / service lines"
            helper="Which service lines the target firm should offer."
            groups={PRODUCT_GROUPS}
            values={products}
            onChange={edited(FACET_PRODUCTS)}
            customPlaceholder="Add another product / service, then press Enter"
          />
        </Panel>
        <Panel>
          <FacetPicker
            gridId="search-industries"
            label="Industries / sectors"
            helper="Which sector groups the target firm should cover. Adds are always allowed."
            groups={INDUSTRY_GROUPS}
            values={industries}
            onChange={edited(FACET_INDUSTRIES)}
            customPlaceholder="Add another industry, then press Enter"
          />
        </Panel>

        {run.error !== undefined && (
          <Notice>Search failed: {String(run.error)}. Your selections are preserved.</Notice>
        )}

        <div className={styles.runBar}>
          <Button variant="primary" disabled={!canRun} onClick={onRun}>
            {run.isPending ? "Running search…" : awaiting ? "Assembling universe…" : "Run search"}
          </Button>
          <span className={styles.status}>
            {awaiting
              ? "Attaching existing firms and creating new ones with discovery provenance. Routing to the desk when the search lands."
              : totalPicked === 0
                ? "No filters picked. The search will cast the widest possible net."
                : `${totalPicked} filter${totalPicked === 1 ? "" : "s"} across geography, products, and industries.`}
          </span>
        </div>
      </div>
    </div>
  );
}
