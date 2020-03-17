const SUFFIXES = ["bytes", "KB", "MB", "GB", "TB", "PB"];

export default function(size) {
	let power = 0;

	// Make sure we actually have a suffix and check if we need to step to it
	while (power + 1 < SUFFIXES.length && size > 1000) {
		size /= process.platform === "darwin" ? 1000 : 1024;
		power += 1;
	}

	const sizeString =
		Math.trunc(size) === size ? size.toString() : size.toPrecision(3);

	return `${sizeString} ${SUFFIXES[power]}`;
}
