// Version numbers as package.json and the release tags have them (1.2.0,
// v1.0.0-beta.1), compared by semver's rules.

type Version = {
	release: [number, number, number];
	prerelease: string[];
};

function parse(version: string): Version | null {
	const match =
		/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
			version,
		);
	if (!match) {
		return null;
	}
	return {
		release: [Number(match[1]), Number(match[2]), Number(match[3])],
		prerelease: match[4]?.split(".") ?? [],
	};
}

// A prerelease (1.0.0-beta.1) comes before its release (1.0.0). Between
// two of the same release, identifiers that are numbers count numerically,
// and before any that aren't, and a shorter run of them comes first when
// the rest are the same.
function compare(a: Version, b: Version): number {
	for (let i = 0; i < 3; i++) {
		const by = a.release[i]! - b.release[i]!;
		if (by !== 0) {
			return by;
		}
	}
	if (a.prerelease.length === 0 || b.prerelease.length === 0) {
		return b.prerelease.length - a.prerelease.length;
	}
	for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i++) {
		const x = a.prerelease[i]!;
		const y = b.prerelease[i]!;
		const xNumber = /^\d+$/.test(x);
		const yNumber = /^\d+$/.test(y);
		if (xNumber && yNumber) {
			const by = Number(x) - Number(y);
			if (by !== 0) {
				return by;
			}
		} else if (xNumber !== yNumber) {
			return xNumber ? -1 : 1;
		} else if (x !== y) {
			return x < y ? -1 : 1;
		}
	}
	return a.prerelease.length - b.prerelease.length;
}

// Whether `version` comes after `than`. Never, if either isn't a version.
export function isNewer(version: string, than: string): boolean {
	const a = parse(version);
	const b = parse(than);
	return a !== null && b !== null && compare(a, b) > 0;
}
