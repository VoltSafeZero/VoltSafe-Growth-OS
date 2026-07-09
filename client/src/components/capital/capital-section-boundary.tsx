import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  label: string;
}

interface State {
  hasError: boolean;
}

/**
 * Section-level error boundary for Capital dashboards (Command Center, etc.).
 * Prevents one widget's render error from crashing the entire page — the
 * failing section collapses to a small inline notice instead of triggering
 * the global "Something went wrong" screen.
 */
export class CapitalSectionBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    console.error(`[CapitalSectionBoundary:${this.props.label}] render error:`, error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground bg-card border border-border rounded-xl p-4"
          data-testid={`section-error-${this.props.label}`}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Couldn't load "{this.props.label}". The rest of the page is unaffected.</span>
        </div>
      );
    }
    return this.props.children;
  }
}
