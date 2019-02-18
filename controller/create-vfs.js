const { ipcMain } = require( 'electron' )
const { VirtualFileSystem } = require( './VirtualFileSystem' )

let vfsCache = {}

ipcMain.on( 'create-vfs', ( event, path ) => {

  // This is all a janky quick-loader to enable fast iteration of the renderer.
  // Eventually when this ships, kill it.
  let vfs = vfsCache[ path ] || new VirtualFileSystem( path )

  vfs.ready( vfs => {
    vfsCache[ path ] = vfs
    vfs.cached = true
    event.sender.send( 'display-vfs', vfs )
  })
})
