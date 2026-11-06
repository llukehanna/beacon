import styles from "./Sparkline.module.css";

const WIDTH = 110;
const HEIGHT = 36;
const PAD = 3;

function coordinates(points: number[]): Array<[number, number]> {
  const min = Math.min(...points);
  const span = Math.max(...points) - min;
  const step = (WIDTH - PAD * 2) / (points.length - 1);
  return points.map((value, i): [number, number] => [
    PAD + i * step,
    // A flat series sits mid-height instead of dividing by zero.
    span === 0 ? HEIGHT / 2 : HEIGHT - PAD - ((value - min) / span) * (HEIGHT - PAD * 2),
  ]);
}

const trace = (xy: Array<[number, number]>) =>
  xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");

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
  const xy = coordinates(points);
  const last = xy[xy.length - 1][0];
  return (
    <svg
      className={`${styles.spark} ${styles[tone]}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-hidden="true"
      focusable="false"
    >
      <path
        className={styles.area}
        d={`${trace(xy)} L${last.toFixed(1)} ${HEIGHT} L${PAD} ${HEIGHT} Z`}
      />
      <path className={styles.line} d={trace(xy)} />
    </svg>
  );
}
