// Paths here are written the way the platform writes them, as the scanner's
// search does: Windows puts "\" between names and takes "/" too. Everywhere
// else "/" is the only separator, and "\" is a character a name can have.
const windows = () => Ob.platform === "win32";

// `path` without the separators it ends with.
function trimEnd(path: string): string {
	return path.replace(windows() ? /[/\\]+$/ : /\/+$/, "");
}

// Where the last separator before `end` is, or -1.
function lastSeparator(path: string, end = path.length): number {
	const slash = path.lastIndexOf("/", end - 1);
	return windows() ? Math.max(slash, path.lastIndexOf("\\", end - 1)) : slash;
}

// `names` inside `base`: "C:\" and "Users" are "C:\Users" on Windows, and "/"
// and "Users" are "/Users" everywhere else.
export function joinPath(base: string, ...names: string[]): string {
	const rest = names.filter((name) => name.length > 0);
	if (rest.length === 0) {
		return base;
	}
	return [trimEnd(base), ...rest].join(windows() ? "\\" : "/");
}

// Last path segment, tolerant of trailing separators. A bare root ("/") is
// its own name.
export function basename(p: string): string {
	const trimmed = trimEnd(p) || p;
	const slash = lastSeparator(trimmed);
	return slash >= 0 ? trimmed.slice(slash + 1) || trimmed : trimmed;
}

// Whether `path` is one of `paths`, or inside one of them.
export function isWithin(path: string, paths: Set<string>): boolean {
	for (let end = path.length; end > 0; end = lastSeparator(path, end)) {
		if (paths.has(path.slice(0, end))) {
			return true;
		}
	}
	return false;
}
