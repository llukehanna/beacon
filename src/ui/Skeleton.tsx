import styles from "./Skeleton.module.css";

/** Loading placeholder: `lines` text-height bars, or one block of `height` px. */
export function Skeleton({ lines, height }: { lines?: number; height?: number }) {
  if (height !== undefined) {
    return <div className={styles.bar} style={{ height }} aria-hidden="true" />;
  }
  const count = lines ?? 1;
  return (
    <div className={styles.lines} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={styles.bar}
          // The last line of a paragraph runs short.
          style={{ width: count > 1 && i === count - 1 ? "60%" : "100%" }}
        />
      ))}
    </div>
  );
}
