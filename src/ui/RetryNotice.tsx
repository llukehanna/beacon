import { Button } from "./Button";
import { Notice } from "./Notice";
import styles from "./RetryNotice.module.css";

/** A failed load, said in words, with a button that tries it again. */
export function RetryNotice({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <Notice className={[styles.row, className ?? ""].filter(Boolean).join(" ")}>
      <span>{message}</span>
      <Button onClick={onRetry}>Retry</Button>
    </Notice>
  );
}
