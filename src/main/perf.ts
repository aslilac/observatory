// Main-side perf instrumentation. Toggle by launching with OB_PERF=1.
// Renderer has its own equivalent in src/renderer/perf.ts.

export const PERF = process.env["OB_PERF"] === "1";

export function perfLog(tag: string, message: string): void {
	if (!PERF) {
		return;
	}
	console.log(`[perf:${tag}] ${message}`);
}

export function timed<T>(tag: string, fn: () => T): T {
	if (!PERF) {
		return fn();
	}
	const start = performance.now();
	const result = fn();
	console.log(`[perf:main] ${tag} ${(performance.now() - start).toFixed(1)}ms`);
	return result;
}

export async function timedAsync<T>(
	tag: string,
	fn: () => Promise<T>,
): Promise<T> {
	if (!PERF) {
		return fn();
	}
	const start = performance.now();
	const result = await fn();
	console.log(`[perf:main] ${tag} ${(performance.now() - start).toFixed(1)}ms`);
	return result;
}
