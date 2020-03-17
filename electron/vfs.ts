import * as drivelist from "drivelist";
import { EventEmitter } from "events";
import { promises as fs } from "fs";
import path from "path";

import gardens from "../gardens.config";
const garden = gardens.scope("VirtualFileSystem");

type Entity =
	| typeof DIRECTORY
	| typeof FILE
	| typeof SYMLINK
	| typeof DEVICE
	| typeof UNKNOWN;
const DIRECTORY = 0;
const FILE = 1;
const SYMLINK = 2;
const DEVICE = 3;
const UNKNOWN = 4;

type VfsNode = VfsDirectory | VfsFile;

type VfsDirectory = {
	type: typeof DIRECTORY;
	name?: string;
	size: number;
	capacity?: number; // for drives
	files: VfsNode[];
};

type VfsFile = {
	type: typeof FILE;
	name: string;
	size: number;
};

class VirtualFileSystem extends EventEmitter {
	name: string;
	location: string;
	cursor: string[];
	root: VfsDirectory;

	counts: {
		files: number;
		directories: number;
		symlinks: number;
		devices: number;
		misc: number;
	};

	constructor(location: string) {
		super();

		this.location = path.normalize(location);
		this.root = null;
		this.cursor = [];

		this.counts = {
			files: 0,
			directories: 0,
			symlinks: 0,
			devices: 0,
			misc: 0,
		};

		this.factory(location);
	}

	async factory(location: string) {
		await fs.stat(location);

		// Start logging status while we wait
		garden.time("vfs creation");
		const status = setInterval(() => {
			garden.log(this.counts);
		}, 5000);

		const vfs = await this._scan(location);
		vfs.name = path.basename(location); // this has to be set manually for recursion optimization

		// Clear the logging interval post scan, and log the final results
		clearInterval(status);
		garden.log(this.counts);
		garden.timeEnd("vfs creation");

		// Set the name and capacity if it's a drive (this could be better)
		const list = await drivelist.list();
		list.some(device =>
			device.mountpoints.some(mount => {
				if (mount.path === this.location) {
					vfs.name =
						mount.label || `${device.description} (${mount.path})`;
					vfs.capacity = device.size;
				}
			}),
		);

		this.root = vfs;
		this.emit("ready");
	}

	ready(...x) {
		this.on("ready", ...x);
	}

	async _scan(location: string): Promise<VfsDirectory> {
		const state: VfsDirectory = {
			type: DIRECTORY,
			size: 0,
			files: [],
		};

		const files = await fs.readdir(location).catch(error => {
			garden.catch(error);
		});

		if (!files) return state;

		await Promise.all(
			files.map(async name => {
				const entity = path.join(location, name);
				const stats = await fs
					.lstat(entity)
					.catch(error => void garden.catch(error));

				if (!stats) return state;
				else if (stats.isSymbolicLink()) {
					this.counts.symlinks++;
					// state.files.push({
					//   name, type: SYMLINK, size: 0
					// })
				} else if (stats.isCharacterDevice() || stats.isBlockDevice()) {
					this.counts.devices++;
					// state.files.push({
					//   name, type: DEVICE, size: 0
					// })
				} else if (stats.isFile()) {
					this.counts.files++;
					state.files.push({
						type: FILE,
						name,
						size: stats.size,
					});
					state.size += stats.size;
				} else if (stats.isDirectory()) {
					this.counts.directories++;

					if (process.platform === "linux" && entity === "/proc")
						return state;
					if (process.platform === "darwin" && entity === "/Volumes")
						return state;

					const directory = await this._scan(entity);
					state.files.push({
						name,
						...directory,
					});
					state.size += directory.size;
				} else {
					this.counts.misc++;
					// state.files.push({
					//   name, type: UNKNOWN, size: 0
					// })
				}
			}),
		);

		state.files.sort((a, b) => b.size - a.size);
		return state;
	}

	navigateUp() {
		this.cursor.pop();
	}

	navigateForward(...names: string[]) {
		const update = [...this.cursor, ...names];
		const correct = this._findDirectory(update);

		if (!correct)
			throw garden.typeerror(
				"Cursor does not exist or is not a directory!",
			);
		this.cursor = update;
	}

	navigateTo(...names: string[]) {
		const correct = this._findDirectory(names);

		if (!correct)
			throw garden.typeerror(
				"Cursor does not exist or is not a directory!",
			);
		this.cursor = names;
	}

	// Needs better type
	push(view: any) {
		const packet = this._prepIpcPacket();
		view.send("vfs-render", packet);
	}

	_findDirectory(cursor = this.cursor) {
		const scale = this.root.size;
		let position = 0;
		let current = this.root;
		const correct = cursor.every(piece =>
			current.files.some(file => {
				if (file.name === piece && file.type === DIRECTORY) {
					current = file;

					return true;
				}
				position += file.size / scale;
			}),
		);

		return (
			correct && {
				position,
				...current,
			}
		);
	}

	_prepIpcPacket(...names: string[]) {
		const cursor = [...this.cursor, ...names];
		const directory = this._findDirectory(cursor);
		const isLargeEnough = (file: VfsNode) =>
			file.size > directory.size * 0.003;
		const sanitize = (recursive?: number) => (file: VfsNode) => ({
			name: file.name,
			type: file.type,
			size: file.size,
			...(recursive > 0 && file.type === DIRECTORY
				? {
						files: file.files
							.filter(isLargeEnough)
							.map(sanitize(recursive - 1)),
				  }
				: { files: [] }),
		});

		const packet = {
			name: this.root.name,
			cursor: cursor,

			type: DIRECTORY,
			rootCapacity: this.root.capacity || this.root.size,
			rootSize: this.root.size,
			capacity: directory.capacity || directory.size,
			position: directory.position,
			size: directory.size,
			// Basically, we just want to strip out any files that won't be rendered
			// on the list or the sunburst so that we don't have to serialize the
			// entire Vfs because that would be reaaaaally slow.
			list: {
				files: directory.files.map(sanitize()),
			},
			sunburst: {
				files: directory.files.filter(isLargeEnough).map(sanitize(6)),
			},
		};

		return packet;
	}
}

export default VirtualFileSystem;
