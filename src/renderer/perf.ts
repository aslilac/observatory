// Lightweight perf instrumentation. Enable from the dev console with
//   localStorage.setItem("observatory:perf", "1")
// and disable with
//   localStorage.removeItem("observatory:perf")
// Logs are tagged so they're easy to grep.

export function perfEnabled(): boolean {
	try {
		return localStorage.getItem("observatory:perf") === "1";
	} catch {
		return false;
	}
}

export function perfLog(tag: string, message: string): void {
	if (!perfEnabled()) return;
	// eslint-disable-next-line no-console
	console.log(`[perf:${tag}] ${message}`);
}

export function perfMark(name: string): void {
	if (!perfEnabled()) return;
	try {
		performance.mark(name);
	} catch {
		// Ignore — performance API may be unavailable in odd contexts.
	}
}

// Measures from the most recent `start` mark to now and logs the duration
// under `tag`. Resilient to a missing start mark (e.g. first navigation).
export function perfMeasure(tag: string, start: string): void {
	if (!perfEnabled()) return;
	try {
		const m = performance.measure(`measure:${tag}`, start);
		// eslint-disable-next-line no-console
		console.log(`[perf:${tag}] ${m.duration.toFixed(1)}ms`);
		performance.clearMarks(start);
		performance.clearMeasures(`measure:${tag}`);
	} catch {
		// Mark wasn't there — first run, etc.
	}
}
