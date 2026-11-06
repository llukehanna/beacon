import React from "react";
import { Button } from "@/ui";
import { ErrorPanel } from "./ErrorPanel";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** The last line of defence: an error no route caught shows a panel with a way to try again. */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <ErrorPanel
          title="Something went wrong"
          role="alert"
          actions={<Button onClick={() => this.setState({ error: null })}>Try again</Button>}
        >
          {this.state.error.message}
        </ErrorPanel>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
