import styles from "./Sparkline.module.css";

const WIDTH = 110;
const HEIGHT = 36;
const PAD = 3;

function linePath(points: number[]): string {
  const min = Math.min(...points);
  const span = Math.max(...points) - min;
  const step = (WIDTH - PAD * 2) / (points.length - 1);
  return points
    .map((value, i) => {
      const x = PAD + i * step;
      // A flat series sits mid-height instead of dividing by zero.
      const y =
        span === 0 ? HEIGHT / 2 : HEIGHT - PAD - ((value - min) / span) * (HEIGHT - PAD * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Inline trend line. Draws nothing for fewer than two points: no trend is not a flat trend. */
export function Sparkline({
  points,
  tone,
}: {
  points: number[];
  tone: "accent" | "green" | "muted";
}) {
  if (points.length < 2) {
    return null;
  }
  return (
    <svg
      className={`${styles.spark} ${styles[tone]}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-hidden="true"
      focusable="false"
    >
      <path d={linePath(points)} />
    </svg>
  );
}
