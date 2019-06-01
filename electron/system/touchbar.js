const drivelist = require( 'drivelist' )
const { TouchBar } = require( 'electron' )
const { TouchBarButton, TouchBarLabel, TouchBarSpacer } = TouchBar

const ipc = require( '../ipc' )

const garden = require( '../../gardens.config' ).scope( 'system', 'touchbar' )
const xd = require( '../../gardens.config' ).scope( 'system', 'touchbar', 'XD' )

exports.init = async function( view ) {
  let list = await drivelist.list()
  view.setTouchBar(
    new TouchBar({
      items: [
        new TouchBarButton({
          label: 'Disks and folders',
          backgroundColor: '#232358',
          click() { garden.log( 'Hello' ) }
        }),
        new TouchBarSpacer({
          size: 'large'
        }),
        new TouchBarLabel({
          label: 'Scan ',
          textColor: '#b991e6'
        }),
        ...(list.map( device =>
          device.mountpoints.map( mount =>
            new TouchBarButton({
              label: mount.label || `${mount.path} (${device.description})`,
              backgroundColor: '#9680ed',
              click() { ipc.push( mount.path, view ) }
            })
          )
        ).flat()),
        new TouchBarSpacer({
          size: 'small'
        }),
        // This is for development, I need a way to remove it eventually
        new TouchBarButton({
          label: '/src',
          backgroundColor: '#b0a0ec',
          click() { ipc.push( '/src', view ) }
        }),
        new TouchBarSpacer({
          size: 'large'
        })
      ]
    })
  )
}
