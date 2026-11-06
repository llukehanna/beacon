import React from "react";
import { Link } from "react-router-dom";
import { useTour } from "@/tour/tourContext";
import { Button, Panel } from "@/ui";
import styles from "./IntroCard.module.css";
import { browserStorage, dismissIntro, introDismissed } from "./introState";

const REPO_URL = "https://github.com/llukehanna/beacon";
const AUTHOR_URL = "https://lukeghanna.com";

const FACTS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Cites every value",
    body: "Each agent value links back to the sentence in the source it was read from.",
  },
  {
    title: "Says when it doesn’t know",
    body: "If no source supports an axis, Beacon records an abstention instead of a guess.",
  },
  {
    title: "Learns from your passes",
    body: "The reasons you give become proposed screening rules, and nothing takes effect until you approve it.",
  },
];

/**
 * A first-time visitor's way in: what Beacon is in one sentence, three things it does differently,
 * and the tour. Closing it is remembered in this browser; the tour stays reachable from the
 * command palette and the `?` list.
 */
export function IntroCard(): React.ReactElement | null {
  const { start } = useTour();
  const [open, setOpen] = React.useState(() => !introDismissed(browserStorage()));
  if (!open) {
    return null;
  }

  const dismiss = (): void => {
    dismissIntro(browserStorage());
    setOpen(false);
    // The close button is about to leave the page; keep the keyboard where it was.
    document.getElementById("main")?.focus({ preventScroll: true });
  };

  return (
    <Panel highlighted className={styles.card} aria-labelledby="intro-title">
      <div className={styles.head}>
        <div className={styles.lead}>
          <h2 id="intro-title" className={styles.title}>
            A sourcing desk for acquisition targets: it finds candidate firms, reads their sources,
            and shows its work.
          </h2>
        </div>
        <Button variant="ghost" onClick={dismiss} aria-label="Dismiss the introduction">
          <span aria-hidden="true">✕</span>
        </Button>
      </div>

      <ul className={styles.facts}>
        {FACTS.map((f) => (
          <li key={f.title}>
            <b>{f.title}</b>
            <span>{f.body}</span>
          </li>
        ))}
      </ul>

      <div className={styles.foot}>
        <Button variant="primary" onClick={start}>
          Take the 60-second tour
        </Button>
        <nav className={styles.links} aria-label="About Beacon">
          <Link to="/about">About</Link>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub <span aria-hidden="true">↗</span>
          </a>
          <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">
            Luke Hanna <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </div>
    </Panel>
  );
}
