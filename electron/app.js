// Handle initial platform setup before we do any heavy lifting
import './system/windows';

// Now we get to the actual app code.
import { app, BrowserWindow } from 'electron';
import path from 'path';
import url from 'url';

import './system/menu';
import navigation from './system/navigation';
import './system/theme';
import touchbar from './system/touchbar';

let smsr = false;
let view = null;

async function createWindow() {
  // Create the browser window.
  view = new BrowserWindow({
    backgroundColor: '#e73219',
    width: 1100, height: 800,
    show: false,
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true
    }
  });

  // Source map support
  // We put it here because we need to await it, and can't at top level.
  // Putting it here ensures we don't go very far without it in development.
  if ( !smsr && !app.isPackaged ) {
    await import( 'source-map-support/register' );
    smsr = true;
  }

  // REPL!
  // This also super-breaks launching on macOS when packaged and doesn't
  // work on Windows literally ever.
  if ( process.platform === 'darwin' && !app.isPackaged ) {
    const repl = require( 'repl' );
    const x = repl.start({
      prompt: '> ',
      useGlobal: true
    });
    Object.assign( x.context, {
      view
    });
    x.on( 'exit', () => app.quit() );
  }

  // Load the app.
  view.loadURL( url.format({
    pathname: path.join( __dirname, '../dist/index.html' ),
    protocol: 'file:',
    slashes: true
  }) );

  // Prevent seeing an unpopulated screen.
  view.on( 'ready-to-show', () => {
    view.show();
  });

  // Emitted when the window is closed.
  view.on( 'closed', () => {
    // Dereference the window object, so that Electron can close gracefully
    view = null;
  });

  // Attach everything to the window.
  navigation.init( view );
  touchbar.init( view );
}

// Launch on startup.
app.on( 'ready', () => {
  createWindow();
});

app.on( 'window-all-closed', () => {
  app.quit();
});
