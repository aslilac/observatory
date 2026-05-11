import * as path from "node:path";

const MATCH_CAP = 500;

export type SearchMatch = {
	path: string;
	size: number;
	type: "file" | "directory";
};

export type SearchResults = {
	matches: SearchMatch[];
	totalCount: number;
	totalSize: number;
	truncated: boolean;
};

// Walk the VFS from `basePath` and collect entries whose name contains
// `query` (case-insensitive). Both files and directories are matched;
// when a directory matches we still descend into it so users can find
// nested matches inside a hit.
export function searchVfs(
	root: Ob.VfsDirectory,
	basePath: string,
	query: string,
): SearchResults {
	const needle = query.trim().toLowerCase();
	if (!needle) {
		return { matches: [], totalCount: 0, totalSize: 0, truncated: false };
	}

	const matches: SearchMatch[] = [];
	let totalCount = 0;
	let totalSize = 0;

	const walk = (node: Ob.VfsNode, parent: string) => {
		const full = path.join(parent, node.name);
		if (node.name.toLowerCase().includes(needle)) {
			totalCount += 1;
			totalSize += node.size;
			matches.push({ path: full, size: node.size, type: node.type });
		}
		if (node.type === "directory") {
			for (const child of node.files) {
				walk(child, full);
			}
		}
	};

	for (const child of root.files) {
		walk(child, basePath);
	}

	matches.sort((a, b) => b.size - a.size);
	const truncated = matches.length > MATCH_CAP;
	return {
		matches: truncated ? matches.slice(0, MATCH_CAP) : matches,
		totalCount,
		totalSize,
		truncated,
	};
}
