import React from "react";
import { useNavigate } from "react-router-dom";
import { useOsdkQuery } from "@/data/hooks";
import { type Command, useCommands } from "@/shell/commands";
import { mandateSubtitle } from "@/shell/status";
import type { HomeSummary } from "../../shared/summaries";
import { ActivityFeed } from "./ActivityFeed";
import { Headline } from "./Headline";
import styles from "./HomePage.module.css";
import { MetricRow } from "./MetricRow";
import { NeedsYou } from "./NeedsYou";
import { PipelineFunnel } from "./PipelineFunnel";
import { headlineText } from "./headlineText";

/** "Thursday, 5 November": the day the analyst is looking at, from the clock, not the data. */
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/**
 * Home: what happened, what needs the analyst, and why the numbers can be trusted. Every figure
 * comes from the `homeSummary` query function, which applies the same shared rules as the pages
 * these panels link to, so Home never promises work that a destination does not show.
 */
export default function HomePage(): React.ReactElement {
  const { data, isLoading, error } = useOsdkQuery<HomeSummary>("homeSummary");
  const navigate = useNavigate();
  // The clock behind relative ages and the date line, read again whenever the page renders.
  const now = Date.now();

  const commands = React.useMemo<Command[]>(
    () => [
      {
        id: "home:open-desk",
        label: "Open desk",
        group: "Actions",
        hint: "G D",
        run: () => navigate("/desk"),
      },
      {
        id: "home:new-mandate",
        label: "New mandate",
        group: "Actions",
        run: () => navigate("/mandate"),
      },
    ],
    [navigate],
  );
  useCommands(commands);

  const mandateLine = mandateSubtitle(null, data?.mandates.length);
  const dateLine = [dayFormat.format(now), mandateLine].filter(Boolean).join(" · ");
  const text = data === undefined ? null : headlineText(data.needsYouTotal, data.headline);

  return (
    <div className={styles.page}>
      <div className={styles.grid}>
        <div className={styles.head}>
          <Headline
            dateLine={dateLine}
            text={text}
            status={
              error !== undefined && error !== null
                ? "The summary could not be loaded."
                : isLoading
                  ? "Loading your inbox…"
                  : ""
            }
          />
        </div>
        {error !== undefined && error !== null && (
          <p className={styles.error} role="alert">
            {String(error)}
          </p>
        )}
        <div className={styles.metrics}>
          <MetricRow data={data} />
        </div>
        <div className={styles.funnel}>
          <PipelineFunnel counts={data?.funnel} />
        </div>
        <div className={styles.needs}>
          <NeedsYou
            items={data?.needsYou}
            total={data?.needsYouTotal ?? 0}
            counts={data?.needsYouCounts}
            now={now}
          />
        </div>
        <div className={styles.feed}>
          <ActivityFeed items={data?.activity} now={now} />
        </div>
      </div>
    </div>
  );
}
