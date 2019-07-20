import drivelist from 'drivelist'
import { dialog, TouchBar } from 'electron'
const { TouchBarButton, TouchBarLabel, TouchBarSpacer } = TouchBar

import ipc from '../ipc'

import gardens from '../../gardens.config'
const garden = gardens.scope( 'system', 'touchbar' )
const xd = gardens.scope( 'system', 'touchbar', 'XD' )

export async function init( view ) {
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
        new TouchBarButton({
          label: 'Scan directory',
          backgroundColor: '#b0a0ec',
          click() {
            dialog.showOpenDialog({
              properties: [ 'openDirectory' ]
            }, ( folders ) => {
              if ( folders ) ipc.push( folders[0], view )
            })
          }
        }),
        new TouchBarSpacer({
          size: 'large'
        })
      ]
    })
  )
}

export default { init }
