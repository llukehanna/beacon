import React from "react";
import { useRouteError } from "react-router-dom";
import { claimChunkReload, isChunkLoadError } from "@/chunkReload";
import css from "@/components/ErrorBoundary.module.css";

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Router errorElement: reload once after a deploy swapped the chunks; otherwise a readable panel. */
function RouteError(): React.ReactElement {
  const error = useRouteError();
  const stale = isChunkLoadError(error);
  const reloading = React.useMemo(() => stale && claimChunkReload(sessionStore()), [stale]);

  React.useEffect(() => {
    if (reloading) {
      window.location.reload();
    }
  }, [reloading]);

  if (reloading) {
    return (
      <div role="status" className={css.container}>
        <p className={css.message}>Updating to the latest version…</p>
      </div>
    );
  }
  return (
    <div role="alert" className={css.container}>
      <h2>{stale ? "Beacon was updated" : "Something went wrong"}</h2>
      <p className={css.message}>
        {stale
          ? "This tab is running an older version. Reload to get the current one."
          : error instanceof Error
            ? error.message
            : "An unexpected error stopped this page from loading."}
      </p>
      <button className={css.retryButton} onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}

export default RouteError;
