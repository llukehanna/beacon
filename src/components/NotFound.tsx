import React from "react";
import { useLocation } from "react-router-dom";
import { ButtonLink } from "@/ui";
import { ErrorPanel } from "./ErrorPanel";

/** What a path that matches no route shows, inside the shell so navigation stays at hand. */
export default function NotFound(): React.ReactElement {
  const { pathname } = useLocation();
  return (
    <ErrorPanel
      title="Page not found"
      actions={
        <>
          <ButtonLink to="/" variant="primary">
            Go to Home
          </ButtonLink>
          <ButtonLink to="/pipeline">Open the pipeline</ButtonLink>
        </>
      }
    >
      There is nothing at <code>{pathname}</code>.
    </ErrorPanel>
  );
}
