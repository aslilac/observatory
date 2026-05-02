import React from "react";

import { Button } from "./Button";

type ErrorBoundaryProps = {
	children: React.ReactNode;
};

type ErrorBoundaryState = {
	error: Error | null;
};

export class ErrorBoundary extends React.Component<
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

	private reset = () => this.setState({ error: null });

	private reload = () => {
		if (typeof window !== "undefined") window.location.reload();
	};

	render() {
		const { error } = this.state;
		if (!error) return this.props.children;

		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-[14px] px-[28px] text-center">
				<div className="text-[20px] font-semibold">Something broke</div>
				<div className="max-w-[480px] font-mono text-[12px] text-muted">
					{error.message || String(error)}
				</div>
				{error.stack && (
					<pre className="max-h-[200px] max-w-[640px] overflow-auto rounded-card border border-line-soft bg-fill px-[12px] py-[10px] text-left font-mono text-[10px] text-muted">
						{error.stack}
					</pre>
				)}
				<div className="flex gap-[8px]">
					<Button onClick={this.reset}>Try again</Button>
					<Button variant="primary" onClick={this.reload}>
						Reload window
					</Button>
				</div>
			</div>
		);
	}
}
