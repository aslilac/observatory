// Renderer-side path join. We never see Windows paths in this app (the
// scan roots come from the volume list or a POSIX dialog on Linux/macOS), so
// forward slashes and a couple of normalizations are enough.
export function joinPath(base: string, ...rest: string[]): string {
	const trimmedBase = base === "/" ? "" : base.replace(/\/+$/, "");
	const tail = rest
		.filter((p) => p.length > 0)
		.map((p) => p.replace(/^\/+|\/+$/g, ""))
		.filter((p) => p.length > 0)
		.join("/");
	if (!tail) {
		return base;
	}
	return `${trimmedBase}/${tail}`;
}

// Last path segment, tolerant of trailing separators and Windows paths.
// A bare root ("/") is its own name.
export function basename(p: string): string {
	const trimmed = p.replace(/[/\\]+$/, "") || p;
	const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return slash >= 0 ? trimmed.slice(slash + 1) || trimmed : trimmed;
}
