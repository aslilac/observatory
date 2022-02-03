export function areMapsSimilar<K = unknown, V = unknown>(a: Map<K, V>, b: Map<K, V>) {
	if (a.size !== b.size) return false;

	const keysA = Array.from(a.keys());
	const keysB = Array.from(b.keys());

	return keysA.every((key) => keysB.includes(key));
}
