import type { ElementType, HTMLAttributes } from "react";
import styles from "./Panel.module.css";

interface PanelProps extends HTMLAttributes<HTMLElement> {
  /** Element to render; a section by default. */
  as?: ElementType;
  /** Raised surface with a brighter edge, for the one panel a screen leads with. */
  highlighted?: boolean;
}

/** A layered surface with a hairline edge and a 1 px inner top highlight. */
export function Panel({ as: Tag = "section", highlighted, className, ...rest }: PanelProps) {
  const classes = [styles.panel, highlighted ? styles.highlighted : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return <Tag className={classes} {...rest} />;
}
