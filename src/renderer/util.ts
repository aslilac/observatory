const suffixes = ["bytes", "KB", "MB", "GB", "TB", "PB"];

export const readableSize = (size: number) => {
	// Initialized separately instead of with the for loop because
	// we need to use the value after, and I don't want to use var.
	let exp = 0;

	// Make sure we actually have a suffix and check if we need to step to it
	for (; exp + 1 < suffixes.length && size >= 1000; exp++) {
		size /= Ob.platform === "darwin" ? 1000 : 1024;
	}

	const sizeString =
		Math.trunc(size) === size ? size.toString() : size.toPrecision(3);

	return `${sizeString} ${suffixes[exp]!}`;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Compact human-friendly mtime label: "5m", "3h", "2d" for recent activity,
// "Mar 5" for this year, "Mar 5, 2024" for older. Tuned to fit in a fixed-
// width column next to the size readout.
export function readableDate(
	epochMs: number,
	now: number = Date.now(),
): string {
	if (!epochMs || !Number.isFinite(epochMs)) {
		return "—";
	}
	const delta = now - epochMs;
	if (delta < 0) {
		return "just now";
	}
	if (delta < MINUTE) {
		return "just now";
	}
	if (delta < HOUR) {
		return `${Math.floor(delta / MINUTE)}m ago`;
	}
	if (delta < DAY) {
		return `${Math.floor(delta / HOUR)}h ago`;
	}
	if (delta < 14 * DAY) {
		return `${Math.floor(delta / DAY)}d ago`;
	}
	const d = new Date(epochMs);
	const month = d.toLocaleString("en-US", { month: "short" });
	const thisYear = new Date(now).getFullYear();
	if (d.getFullYear() === thisYear) {
		return `${month} ${d.getDate()}`;
	}
	return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}
