// The two files a Linux system describes itself with: os-release (shell-like
// KEY="value" lines) and a Flatpak's /.flatpak-info (an ini file, with
// [Group] headers).

// os-release(5): values may be quoted, with \" \\ \$ \` escaped inside.
export function parseOsRelease(text: string): Map<string, string> {
	const fields = new Map<string, string>();
	for (const line of text.split("\n")) {
		const match = /^\s*([A-Za-z0-9_]+)=(.*)$/.exec(line);
		if (!match) {
			continue;
		}
		let value = match[2]!.trim();
		const quote = value[0];
		if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
			value = value.slice(1, -1);
			if (quote === '"') {
				value = value.replace(/\\(["\\$`])/g, "$1");
			}
		}
		fields.set(match[1]!, value);
	}
	return fields;
}

// "Group.key" → value.
export function parseKeyFile(text: string): Map<string, string> {
	const fields = new Map<string, string>();
	let group = "";
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) {
			continue;
		}
		const header = /^\[(.+)\]$/.exec(line);
		if (header) {
			group = header[1]!;
			continue;
		}
		const equals = line.indexOf("=");
		if (equals > 0) {
			fields.set(
				`${group}.${line.slice(0, equals).trim()}`,
				line.slice(equals + 1).trim(),
			);
		}
	}
	return fields;
}

// A Flatpak ref, "runtime/org.freedesktop.Platform/x86_64/26.08", as
// "org.freedesktop.Platform 26.08".
export function describeRef(ref: string): string {
	const [, id, , branch] = ref.split("/");
	return id && branch ? `${id} ${branch}` : ref;
}
