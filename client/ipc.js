import { ipcRenderer, remote } from 'electron';
import React from 'react';
import ReactDOM from 'react-dom';

import Display from './display';
import menu from './menu';

import gardens from '../gardens.config';
const garden = gardens.scope( 'ipc', 'renderer' );

// This is a bit janky, but it works.
let inPopState = false;

ipcRenderer.on( 'vfs-render', ( event, packet ) => {
  garden.log( 'vfs-render packet:', packet );

  ReactDOM.render(
    <Display { ...packet } />,
    document.getElementById( 'fs-display' ),
    () => document.getElementById( 'loading' ).style.display = 'none'
  );

  // If we push before render it looks like we can go back even if we can't
  if ( !inPopState )
    history.pushState( packet.cursor, packet.name, location.href );
  else
    inPopState = false;
});

window.addEventListener( 'popstate', event => {
  garden.log( 'popstate event.state:', event.state );
  inPopState = true;
  if ( event.state ) ipcRenderer.send( 'vfs-navigateTo', ...event.state );
});

ipcRenderer.on( 'drivelist-render', ( event, list ) => {
  ReactDOM.render(
    <section>
      {
        list.map( ( device, dIndex ) =>
          device.mountpoints.map( ( mount, mIndex ) =>
            <button key={`${dIndex}-${mIndex}`} onClick={ () => {
              document.getElementById( 'loading' ).style.display = 'block';
              ipcRenderer.send( 'vfs-create', mount.path );
            }}>{mount.label || `${mount.path} (${device.description})`}</button>
          )
        ).flat()
      }
      <button onClick={ () => {
        remote.dialog.showOpenDialog({
          properties: [ 'openDirectory' ]
        },  folders => {
          if ( folders ) {
            document.getElementById( 'loading' ).style.display = 'block';
            ipcRenderer.send( 'vfs-create', folders[0] );
          }
        });
      }}>Scan directory</button>
    </section>,
    document.getElementById( 'fs-display' )
  );
  menu.showMenu();
});

ipcRenderer.send( 'drivelist-create' );
