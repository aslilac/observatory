import { Component } from "react";
import { Button } from "./Button";

type ErrorBoundaryProps = {
	children: React.ReactNode;
};

type ErrorBoundaryState = {
	error: Error | null;
};

export class ErrorBoundary extends Component<
	ErrorBoundaryProps,
	ErrorBoundaryState
> {
	state: ErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: React.ErrorInfo) {
		console.error("Caught render error:", error, info.componentStack);
	}

	#reset = () => {
		this.setState({ error: null });
	};

	#reload = () => {
		location.reload();
	};

	render() {
		const { error } = this.state;

		if (!error) {
			return this.props.children;
		}

		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-4 px-7 text-center">
				<div className="text-[20px] font-semibold">Something broke</div>
				<div className="max-w-[480px] font-mono text-[12px] text-muted">
					{error.message || String(error)}
				</div>
				{error.stack && (
					<pre
						className="max-h-[200px] max-w-[640px] overflow-auto rounded-card border border-line-soft bg-fill px-3 py-2.5 text-left font-mono text-[10px] text-muted select-text"
					>
						{error.stack}
					</pre>
				)}
				<div className="flex gap-2">
					<Button onClick={this.#reset}>Try again</Button>
					<Button variant="primary" onClick={this.#reload}>
						Reload window
					</Button>
				</div>
			</div>
		);
	}
}
