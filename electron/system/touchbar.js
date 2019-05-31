const { TouchBar } = require( 'electron' )
const { TouchBarButton, TouchBarLabel, TouchBarSpacer } = TouchBar

const ipc = require( '../ipc' )

const garden = require( '../../gardens.config' ).scope( 'system', 'touchbar' )
const xd = require( '../../gardens.config' ).scope( 'system', 'touchbar', 'XD' )

exports.init = function( view ) {
  view.setTouchBar(
    new TouchBar({
      items: [
        new TouchBarButton({
          label: 'Hello',
          backgroundColor: '#39bd79',
          click() { garden.log( 'Hello' ) }
        }),
        new TouchBarSpacer({
          size: 'large'
        }),
        new TouchBarLabel({
          label: 'Scan ',
          textColor: '#b991e6'
        }),
        ...[{ name: 'SSD', path: '/' }, { name: '/src', path: '/src' } ].map( ({name, path}) => new TouchBarButton({
          label: name,
          backgroundColor: '#9680ed',
          click() {
            garden.log( `Scanning drive ${name}` )
            ipc.push( path, view )
          }
        }) ),
        new TouchBarSpacer({
          size: 'large'
        })
      ]
    })
  )
}
