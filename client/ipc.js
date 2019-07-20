const { ipcRenderer, remote } = require( 'electron' )
const garden = require( '../gardens.config' ).scope( 'ipc', 'renderer' )
const React = require( 'react' )
const ReactDOM = require( 'react-dom' )

const Display = require( './display' )
const menu = require( './menu' )

// This is a bit janky, but it works.
let inPopState = false

ipcRenderer.on( 'vfs-render', ( event, packet ) => {
  garden.log( 'vfs-render packet:', packet )

  ReactDOM.render(
    React.createElement( Display, {
      ...packet
    }),
    document.getElementById( 'fs-display' ),
    () => document.getElementById( 'loading' ).style.display = 'none'
  )

  // If we push before render it looks like we can go back even if we can't
  if ( !inPopState )
    history.pushState( packet.cursor, packet.name, location.href )
  else
    inPopState = false
})

window.addEventListener( 'popstate', event => {
  garden.log( 'popstate event.state:', event.state )
  inPopState = true
  if ( event.state ) ipcRenderer.send( 'vfs-navigateTo', ...event.state )
})

ipcRenderer.on( 'drivelist-render', ( event, list ) => {
  ReactDOM.render(
    React.createElement( 'section', null,
      list.map( device =>
        device.mountpoints.map( ( mount, key ) =>
          React.createElement(
            'button',
            {
              key,
              onClick() {
                document.getElementById( 'loading' ).style.display = 'block'
                ipcRenderer.send( 'vfs-create', mount.path )
              }
            },
            mount.label || `${mount.path} (${device.description})`
          )
        )
      ).flat(),
      // This is for development, I need a way to remove it eventually
      React.createElement( 'button',
        {
          onClick() {
            document.getElementById( 'loading' ).style.display = 'block'
            ipcRenderer.send( 'vfs-create', '/src' )
          }
        },
        '/src'
      ),
      React.createElement( 'button',
        {
          onClick() {
            remote.dialog.showOpenDialog({
              properties: [ 'openDirectory' ]
            },  ( folders ) => {
              if ( folders ) ipc.push( folders[0], view )
            })
          }
        },
        'Scan directory'
      )
    ),
    document.getElementById( 'fs-display' )
  )
  menu.showMenu()
})

ipcRenderer.send( 'drivelist-create' )
