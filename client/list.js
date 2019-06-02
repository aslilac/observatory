const { useState, ...React } = require( 'react' )

const garden = require( '../gardens.config' ).scope( 'renderer', 'list' )

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

module.exports = function List( props ) {
  const [ expanded, setExpanded ] = useState( false )

  garden.log( props )

  return React.createElement( 'section', { id: 'fs-display-list' },
    React.createElement( 'img', {
      src: 'assets/arrow-left.svg',
      className: 'back',

      onClick() { history.back() }
    }),
    React.createElement( 'h1', null,
      props.cursor.length
        ? props.cursor[ props.cursor.length - 1 ]
        : props.name,
        React.createElement( 'span', { className: 'size' }, HUMAN_READABLE_SIZE( props.size ) )
    ),
    // XXX: Should we make this expandable like it was before?
    React.createElement( 'ol', null,
      ( expanded ? props.files : props.files.filter( file => file.size >= props.size / 100 ) )
        .map( ( file, key ) => React.createElement(
          'li',
          {
            draggable: true,
            key,
            onClick() {
              if ( props.type === DIRECTORY ) ipcRenderer.send( 'vfs-navigateForward', file.name )
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
        )),
      ...( expanded ? [] : [
        React.createElement(
          'li',
          {
            onClick() { setExpanded( true ) },
            className: 'expand'
          },
          'smaller objects...'
        )
      ])
    )
  )
}
