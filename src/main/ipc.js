import { list as drivelist } from "drivelist";
import { ipcMain } from "electron";

import Vfs from "./vfs";

import gardens from "../../gardens.config";
const garden = gardens.scope("ipc", "main");

let vfs = null;

// XXX: In the future we should see if we have actually already scanned
// this (possibly nested) and use an existing vfs.
export function push(location, view) {
	vfs = new Vfs(location);
	vfs.ready(() => {
		vfs.push(view);
	});
}

ipcMain.on("drivelist-create", async event => {
	const list = await drivelist();
	event.reply("drivelist-render", list);
});

// XXX: In the future we should see if we have actually already scanned
// this **(possibly nested)** and use an existing vfs.
ipcMain.on("vfs-create", (event, location) => {
	if (vfs && vfs.location === location) {
		if (vfs.root) {
			event.reply("vfs-render", vfs._prepIpcPacket());
		} else {
			vfs.ready(() => {
				event.reply("vfs-render", vfs._prepIpcPacket());
			});
		}
	} else {
		vfs = new Vfs(location);
		vfs.ready(() => {
			event.reply("vfs-render", vfs._prepIpcPacket());
		});
	}
});

ipcMain.on("vfs-navigateUp", event => {
	if (!vfs) throw garden.error("No Vfs loaded");
	vfs.navigateUp();
	event.reply("vfs-render", vfs._prepIpcPacket());
});

// ipcMain.on( 'vfs-preview', ( event, ...names ) => {
//   if ( !vfs ) throw garden.error( 'No Vfs loaded' )
//   // XXX: This could be better. Generating the sunburst is the most expensive part
//   // of _prepIpcPacket, but we don't reaelly need to generate two of them.
//   let real = vfs._prepIpcPacket()
//   let preview = vfs._prepIpcPacket( ...names )
//
//   real.list = preview.list
//   event.reply( 'vfs-render', real )
// })

ipcMain.on("vfs-navigateForward", (event, ...names) => {
	if (!vfs) throw garden.error("No Vfs loaded");
	vfs.navigateForward(...names);
	event.reply("vfs-render", vfs._prepIpcPacket());
});

ipcMain.on("vfs-navigateTo", (event, ...names) => {
	if (!vfs) throw garden.error("No Vfs loaded");
	vfs.navigateTo(...names);
	event.reply("vfs-render", vfs._prepIpcPacket());
});

// TODO:
// ipcMain.on( 'vfs-inspect', ( event, ...names ) => {
//
// });

export default { push };
