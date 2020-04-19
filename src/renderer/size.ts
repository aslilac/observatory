const suffixes = ["bytes", "KB", "MB", "GB", "TB", "PB"];

export default function (size: number) {
	let exp = 0;

	// Make sure we actually have a suffix and check if we need to step to it
	for (; exp + 1 < suffixes.length && size >= 1000; exp++) {
		size /= process.platform === "darwin" ? 1000 : 1024;
	}

	const sizeString =
		Math.trunc(size) === size ? size.toString() : size.toPrecision(3);

	return `${sizeString} ${suffixes[exp]}`;
}
