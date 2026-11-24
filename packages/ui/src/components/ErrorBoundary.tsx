import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Redlinify UI error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
        <div className="w-full max-w-lg rounded-2xl border border-rose-500/40 bg-slate-900 p-6 shadow-2xl">
          <div className="mb-3 flex items-center gap-2.5 text-rose-400">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <h1 className="text-base font-semibold text-slate-100">
              Something went wrong in the Redlinify UI
            </h1>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-slate-400">
            Your diagram data on disk is safe. Reload the workbench to recover.
          </p>
          <pre className="mb-4 max-h-40 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] text-rose-300 whitespace-pre-wrap break-words">
            {this.state.error.message || "Unexpected rendering error"}
          </pre>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reload Workbench
            </button>
          </div>
        </div>
      </div>
    );
  }
}
