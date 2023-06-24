/// <reference types="jest" />

import { VirtualFileSystem } from "./vfs";

test("create vfs", async () => {
	const vfs = new VirtualFileSystem("/Library/Source/");
	await vfs.scan;
}, 30000);
