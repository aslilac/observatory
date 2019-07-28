import { ipcRenderer } from 'electron';
import React, { createContext, Fragment } from 'react';
import ReactDOM from 'react-dom';

import Application from './application';
import Display from './display';
import Menu from './menu';

import gardens from '../gardens.config';
const garden = gardens.scope( 'ipc', 'renderer' );

const CurrentScreen = createContext( 'menu' );
// Can be 'menu', 'loading' or 'fs'

// This is a bit janky, but it works.
let inPopState = false;

ipcRenderer.on( 'vfs-render', ( event, packet ) => {
  garden.log( 'vfs-render packet:', packet );

  ReactDOM.render(
    <Display { ...packet } />,
    document.querySelector( '#application' ),
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

ipcRenderer.on( 'drivelist-render', ( _, list ) => {
  ReactDOM.render(
    <CurrentScreen.Provider value={{ currentScreen: 'menu', sandwich: 'yum' }}>
      <Application screen="menu">
        <Menu list={list} />
      </Application>
      <section>
        <CurrentScreen.Consumer>{
          context => <p>Sandwich? {context.sandwich}</p>
        }</CurrentScreen.Consumer>
      </section>
    </CurrentScreen.Provider>,
    document.querySelector( '#application' )
  );
});

ipcRenderer.send( 'drivelist-create' );
