const drivelist = require( 'drivelist' )
const { ipcMain } = require( 'electron' )

const Vfs = require( './vfs' )

const garden = require( '../gardens.config' ).scope( 'ipc', 'main' )

let vfs = null

// XXX: In the future we should see if we have actually already scanned
// this (possibly nested) and use an existing vfs.
exports.push = function ( location, view ) {
  vfs = new Vfs( location )
  vfs.ready( () => {
    vfs.push( view )
  })
}

ipcMain.on( 'drivelist-create', async event => {
  let list = await drivelist.list()
  event.reply( 'drivelist-render', list )
})

// XXX: In the future we should see if we have actually already scanned
// this **(possibly nested)** and use an existing vfs.
ipcMain.on( 'vfs-create', ( event, location ) => {
  if ( vfs && vfs.location === location ) {
    if ( vfs.root ) {
      event.reply( 'vfs-render', vfs._prepIpcPacket() )
    }

    else {
      vfs.ready( () => {
        event.reply( 'vfs-render', vfs._prepIpcPacket() )
      })
    }
  }

  else {
    vfs = new Vfs( location )
    vfs.ready( () => {
      event.reply( 'vfs-render', vfs._prepIpcPacket() )
    })
  }
})

ipcMain.on( 'vfs-navigateUp', event => {
  if ( !vfs ) throw garden.error( 'No Vfs loaded' )
  vfs.navigateUp()
  event.reply( 'vfs-render', vfs._prepIpcPacket() )
})

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

ipcMain.on( 'vfs-navigateForward', ( event, ...names ) => {
  if ( !vfs ) throw garden.error( 'No Vfs loaded' )
  vfs.navigateForward( ...names )
  event.reply( 'vfs-render', vfs._prepIpcPacket() )
})

ipcMain.on( 'vfs-navigateTo', ( event, ...names ) => {
  if ( !vfs ) throw garden.error( 'No Vfs loaded' )
  vfs.navigateTo( ...names )
  event.reply( 'vfs-render', vfs._prepIpcPacket() )
})

ipcMain.on( 'vfs-inspect', ( event, ...names ) => {

})
