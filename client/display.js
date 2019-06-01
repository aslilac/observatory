const { ipcRenderer } = require( 'electron' )
const path = require( 'path' )
const React = require( 'react' )

const menu = require( './menu' )
const Sunburst = require( './sunburst' )

const garden = require( '../gardens.config' ).scope( 'renderer' )

const DIRECTORY = 0
const FILE = 1
const SYMLINK = 2
const DEVICE = 3
const UNKNOWN = 4
const HUMAN_READABLE_SUFFIXES = [ 'bytes', 'KB', 'MB', 'GB', 'TB', 'PB' ]

const HUMAN_READABLE_SIZE = function ( size ) {
  let power = 0
  let sizeString
  while ( power + 1 < HUMAN_READABLE_SUFFIXES.length && size > 1000 ) {
    size /= process.platform === 'darwin' ? 1000 : 1024
    power += 1
  }

  sizeString = Math.trunc( size ) === size
    ? size.toString()
    : size.toPrecision( 3 )

  return sizeString + ' ' + HUMAN_READABLE_SUFFIXES[ power ];
}

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
  // If I ever use Babel or anything for this
  // <> </>

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
      }, props.name),
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
      id: 'fs-display-sunburst',
      files: sunburst.files,
      ...shared
    }),
    React.createElement( 'section', { id: 'fs-display-list', directory: props.list },
      React.createElement( 'img', {
        src: 'assets/arrow-left.svg',
        className: 'back',

        onClick() { history.back() },
        onKeyPress( event ) {
          garden.log( event )
        }
      }),
      React.createElement( 'h1', null,
        props.cursor.length
          ? props.cursor[ props.cursor.length - 1 ]
          : props.name
      ),
      // XXX: Should we make this expandable like it was before?
      React.createElement( 'ol', null,
        list.files.map( ( file, key ) => React.createElement(
          'li',
          {
            draggable: true,
            key,
            onClick() {
              if ( shared.type === DIRECTORY ) ipcRenderer.send( 'vfs-navigateForward', file.name )
            },
            onDragStart( event ) {
              titlebar.className = 'trash'
              let id = event.target.id = Math.floor( Math.random() * 899999 + 100000 )
              event.dataTransfer.setData( 'filePointer', id )
              event.dataTransfer.effectAllowed = 'move'
            },
            onDragEnd() {
              titlebar.className = ''
            }
          },
          file.name,
          React.createElement( 'span', { className: 'size' }, HUMAN_READABLE_SIZE( file.size ) )
        ))
      )
    )
  )
}
