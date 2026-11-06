import React from "react";
import { useRouteError } from "react-router-dom";
import { claimChunkReload, isChunkLoadError } from "@/chunkReload";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Button } from "@/ui";

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
      <ErrorPanel title="Updating" role="status">
        Updating to the latest version…
      </ErrorPanel>
    );
  }
  return (
    <ErrorPanel
      title={stale ? "Beacon was updated" : "Something went wrong"}
      role="alert"
      actions={<Button onClick={() => window.location.reload()}>Reload</Button>}
    >
      {stale
        ? "This tab is running an older version. Reload to get the current one."
        : error instanceof Error
          ? error.message
          : "An unexpected error stopped this page from loading."}
    </ErrorPanel>
  );
}

export default RouteError;
