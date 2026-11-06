import styles from "./MonogramTile.module.css";
import { monogram } from "./monogram";

/** A firm's initials on an indigo tile. Decorative: the firm name is always shown beside it. */
export function MonogramTile({ name }: { name: string }) {
  return (
    <div className={styles.tile} aria-hidden="true">
      {monogram(name)}
    </div>
  );
}
