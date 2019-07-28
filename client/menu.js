import { ipcRenderer, remote } from 'electron';
import React from 'react';
import ReactDOM from 'react-dom';

import Application from './application';

function startScan( path ) {
  ReactDOM.render(
    <Application screen="loading" />,
    document.querySelector( '#application' )
  );

  ipcRenderer.send( 'vfs-create', path );
}

export default function Menu({ list }) {
  return <section>
    <ul id="menu-drivelist">{
      list.map( ( device, dIndex ) =>
        device.mountpoints.map( ( mount, mIndex ) =>

          <li>
            {mount.label || `${mount.path} (${device.description})`}
            <button key={`${dIndex}-${mIndex}`} onClick={ () => {
              startScan( mount.path );
            }}>Scan</button>
          </li>
        )
      ).flat()
    }</ul>
    <button onClick={ () => {
      remote.dialog.showOpenDialog({
        properties: [ 'openDirectory' ]
      },  folders => {
        if ( folders ) {
          startScan( folders[ 0 ] );
        }
      });
    }}>Scan directory</button>
  </section>;
}
