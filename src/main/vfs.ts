import * as drivelist from "drivelist";
import { promises as fs } from "fs";
import path from "path";

import { mountVfs, store } from "../store/main";
import { DIRECTORY, FILE, RenderTree, VfsDirectory, VfsNode } from "../types";

export class VirtualFileSystem {
	location: string;
	root: VfsDirectory;

	counts: {
		files: number;
		directories: number;
		symlinks: number;
		devices: number;
		misc: number;
	};

	constructor(location: string) {
		this.location = path.normalize(location);
		this.root = null;

		this.counts = {
			files: 0,
			directories: 0,
			symlinks: 0,
			devices: 0,
			misc: 0,
		};

		this.factory();
	}

	async factory() {
		const location = this.location;

		// TODO: We should probably check that it's a directory, and handle errors
		// if it doesn't exist
		await fs.stat(location);

		// Start logging status while we wait
		console.time("vfs creation");
		const status = setInterval(() => {
			console.log(this.counts);
		}, 5000);

		const vfs = await this._scan(location);
		vfs.name = path.basename(location); // this has to be set manually for recursion optimization

		// Clear the logging interval post scan, and log the final results
		clearInterval(status);
		console.log(this.counts);
		console.timeEnd("vfs creation");

		// Set the name and capacity if it's a drive (this could be better)
		const list = await drivelist.list();
		list.some((device) =>
			device.mountpoints.some((mount) => {
				if (mount.path === location) {
					vfs.name =
						mount.label || `${device.description} (${mount.path})`;
					vfs.capacity = device.size;
				}
			}),
		);

		this.root = vfs;

		const tree = this.getRenderTree();
		store.dispatch(mountVfs(location, tree));
	}

	async _scan(location: string): Promise<VfsDirectory> {
		const state: VfsDirectory = {
			type: DIRECTORY,
			name: "MISSING_NO",
			size: 0,
			files: [],
		};

		const files = await fs.readdir(location).catch((error) => {
			console.error(error);
		});

		if (!files) return state;

		await Promise.all(
			files.map(async (name) => {
				const entity = path.join(location, name);
				const stats = await fs
					.lstat(entity)
					.catch((error) => console.error(error));

				if (!stats) return;
				else if (stats.isFile()) {
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
						return;
					if (process.platform === "darwin")
						if (
							entity === "/Volumes" ||
							entity === "/System/Volumes" ||
							entity.includes("/Templates/Data/")
						)
							return;

					const directory = await this._scan(entity);
					state.files.push({
						...directory,
						name,
					});
					state.size += directory.size;
				} else if (stats.isSymbolicLink()) {
					this.counts.symlinks++;
					// state.files.push({
					//   name, type: SYMLINK, size: 0
					// })
				} else if (stats.isCharacterDevice() || stats.isBlockDevice()) {
					this.counts.devices++;
					// state.files.push({
					//   name, type: DEVICE, size: 0
					// })
				} else {
					this.counts.misc++;
				}
			}),
		);

		state.files.sort((a, b) => b.size - a.size);
		return state;
	}

	private getDirectory(cursor: string[]) {
		const scale = this.root.size;
		let position = 0;
		let current = this.root;
		const correct = cursor.every((piece) =>
			current.files.some((file) => {
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

	getRenderTree(cursor: string[] = []): RenderTree {
		const directory = this.getDirectory(cursor);
		const isLargeEnough = (file: VfsNode) =>
			file.size > directory.size * 0.003;
		const sanitize = (recursive?: number) => (file: VfsNode): VfsNode => ({
			name: file.name,
			type: file.type,
			size: file.size,
			files:
				recursive > 0 && file.type === DIRECTORY
					? file.files
							.filter(isLargeEnough)
							.map(sanitize(recursive - 1))
					: [],
		});

		return {
			name: this.root.name,
			cursor,

			type: DIRECTORY,
			rootCapacity: this.root.capacity || this.root.size,
			rootSize: this.root.size,
			capacity: directory.capacity || directory.size,
			position: directory.position,
			size: directory.size,

			// Basically, we just want to strip out any files that won't be rendered
			// on the list or the sunburst because serialization is slow, so the less
			// we have here the better.
			list: {
				files: directory.files.map(sanitize()),
			},
			sunburst: {
				files: directory.files.filter(isLargeEnough).map(sanitize(6)),
			},
		};
	}
}
