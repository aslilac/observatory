const { ipcRenderer } = require( 'electron' )
const garden = require( '../gardens.config' ).scope( 'ipc', 'renderer' )
const React = require( 'react' )
const ReactDOM = require( 'react-dom' )

const Display = require( './display' )
const menu = require( './menu' )

// This is a bit jancky, but it works.
let inPopState = false

ipcRenderer.on( 'vfs-render', ( event, packet ) => {
  console.log( packet )



  ReactDOM.render(
    React.createElement( Display, {
      ...packet
    }),
    document.getElementById( 'fs-display' )
  )

  // If we push before render it looks like we can go back even if we can't
  if ( !inPopState )
    history.pushState( packet.cursor, packet.name, location.href )
  else
    inPopState = false
})

window.addEventListener( 'popstate', event => {
  garden.log( event.state )
  inPopState = true
  if ( event.state ) ipcRenderer.send( 'vfs-navigateTo', ...event.state )
})

menu.showMenu()

// ipcRenderer.send( 'vfs-create', '/src' )
// ipcRenderer.send( 'vfs-create', '/' )
