const { ipcRenderer } = require( 'electron' )
const path = require( 'path' )
const React = require( 'react' )

const menu = require( './menu' )
const List = require( './list' )
const Sunburst = require( './sunburst' )

const garden = require( '../gardens.config' ).scope( 'renderer' )

document.body.className += ` ${process.platform}`

let titlebar = document.getElementById( 'titlebar' )
titlebar.addEventListener( 'dragover', drag => drag.preventDefault() )
titlebar.addEventListener( 'drop', drop => {
    let pointer = drop.dataTransfer.getData( 'filePointer' )
    console.log( 'drop:', pointer )
    if ( pointer ) {
      drop.preventDefault()
      garden.log( 'deleting', pointer )

      let e = document.getElementById( pointer )
      garden.log( e )

      e.parentElement.removeChild( e )
      titlebar.appendChild( e )
    }
})

module.exports = function Display( props ) {
  let { sunburst, list, ...shared } = props

  return React.createElement(
    React.Fragment,
    null,
    React.createElement( 'section', { id: 'fs-display-navbar' },
      React.createElement( 'button', {
        onClick() {
          ipcRenderer.send( 'drivelist-create' )
        }
      }, 'Disks and folders' ),
      React.createElement( 'button', {
        onClick() {
          // navigateTo with no arguments goes to root
          ipcRenderer.send( 'vfs-navigateTo' )
        }
      }, props.name ),
      props.cursor.map( ( piece, key ) => React.createElement(
        'button',
        { key, onClick() {
          garden.log( props.cursor.slice( 0, key + 1 ) )
          ipcRenderer.send( 'vfs-navigateTo', ...props.cursor.slice( 0, key + 1 ) )
        } },
        piece
      ))
    ),
    React.createElement( Sunburst, {
      files: sunburst.files,
      ...shared
    }),
    React.createElement( List, {
      files: list.files,
      ...shared
    })
  )
}
