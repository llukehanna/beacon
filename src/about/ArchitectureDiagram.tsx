import React from "react";
import styles from "./ArchitectureDiagram.module.css";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  offline?: boolean;
}

const BOXES: readonly Box[] = [
  { x: 24, y: 10, w: 312, h: 46, title: "Analyst in the browser", sub: "React app" },
  { x: 24, y: 88, w: 312, h: 46, title: "API", sub: "Cloudflare Worker" },
  { x: 24, y: 166, w: 312, h: 46, title: "Actions", sub: "named, validated, one transaction each" },
  { x: 24, y: 244, w: 100, h: 58, title: "Agent", sub: "reads sources" },
  { x: 134, y: 244, w: 100, h: 58, title: "Rubric", sub: "scores and tiers" },
  { x: 244, y: 244, w: 92, h: 58, title: "Rules", sub: "from reasons" },
  { x: 24, y: 334, w: 312, h: 46, title: "Postgres", sub: "history is append-only" },
  {
    x: 24,
    y: 412,
    w: 312,
    h: 58,
    title: "Offline: Claude extraction",
    sub: "recorded once as fixtures, read by the app",
    offline: true,
  },
];

/** A vertical arrow from one box's bottom edge to the next box's top edge. */
const DOWN: ReadonlyArray<readonly [number, number, number]> = [
  [180, 56, 88],
  [180, 134, 166],
  [74, 212, 244],
  [184, 212, 244],
  [290, 212, 244],
];

/**
 * How the parts fit together, at business level: the screen, the API, the actions that are the
 * only way to write, the three things actions call, the database they alone write to and the offline model run whose
 * recorded answers feed the agent. Drawn with the design tokens so it follows the theme. The
 * labels sit in the page's text beside it, so the drawing carries a short description only.
 */
export function ArchitectureDiagram(): React.ReactElement {
  return (
    <svg
      className={styles.svg}
      viewBox="0 0 360 484"
      role="img"
      aria-label="Architecture: the browser calls an API, which applies named actions. Actions call the agent, the rubric and rule clustering, and write to Postgres. An offline Claude extraction run feeds the agent through recorded fixtures."
    >
      <defs>
        <marker
          id="arch-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0 L8 4 L0 8 z" className={styles.head} />
        </marker>
      </defs>

      {DOWN.map(([x, y1, y2]) => (
        <line
          key={`${x}-${y1}`}
          x1={x}
          y1={y1}
          x2={x}
          y2={y2 - 1}
          className={styles.line}
          markerEnd="url(#arch-arrow)"
        />
      ))}
      {/* Actions are the only writer: their transaction reaches the database around the side. */}
      <path
        d="M336 189 H350 V357 H337"
        className={styles.line}
        fill="none"
        markerEnd="url(#arch-arrow)"
      />
      {/* The recorded answers rise from the offline run to the agent. */}
      <path
        d="M24 441 H10 V273 H23"
        className={styles.offlineLine}
        fill="none"
        markerEnd="url(#arch-arrow)"
      />

      {BOXES.map((b) => (
        <g key={b.title}>
          <rect
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={8}
            className={b.offline === true ? styles.offline : styles.box}
          />
          <text
            x={b.x + b.w / 2}
            y={b.y + b.h / 2 - 3}
            textAnchor="middle"
            className={styles.title}
          >
            {b.title}
          </text>
          {b.sub !== undefined && (
            <text
              x={b.x + b.w / 2}
              y={b.y + b.h / 2 + 13}
              textAnchor="middle"
              className={styles.sub}
            >
              {b.sub}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
