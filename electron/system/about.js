import { BrowserWindow, shell, TouchBar } from 'electron';
const { TouchBarButton } = TouchBar;
import path from 'path';
import url from 'url';

// import { version } from '../../package.json'

let aboutWindow = null;

function showAboutWindow() {
  if ( !aboutWindow ) {
    aboutWindow = new BrowserWindow({
      backgroundColor: '#e73219',
      width: 800, height: 575,
      show: false,
      titleBarStyle: 'hiddenInset',
      autoHideMenuBar: true,
      fullscreenable: false,
      minimizable: false,
      maximizable: false,
      resizable: false,
      alwaysOnTop: true
    });

    // Load the about page
    aboutWindow.loadURL( url.format({
      pathname: path.join( __dirname, '../client/about.html' ),
      protocol: 'file:',
      slashes: true
    }) );

    aboutWindow.webContents.on( 'new-window', ( event, url ) => {
      event.preventDefault();
      aboutWindow.close();
      shell.openExternal( url );
    });


    // Emitted when the window is closed.
    aboutWindow.on( 'closed', () => {
      // Dereference the window object, so that Electron can close it gracefully
      aboutWindow = null;
    });


    aboutWindow.setTouchBar(
      new TouchBar({
        items: [
          new TouchBarButton({
            label: 'Visit dev site',
            click() {
              shell.openExternal( 'https://mckay.la' );
            }
          })
        ],
        escapeItem: new TouchBarButton({
          label: `v${ '0.3.0' }`,
          backgroundColor: '#fa4873',
          click() {
            aboutWindow.close();
          }
        })
      })
    );

    aboutWindow.on( 'ready-to-show', () => {
      aboutWindow.show();
    });
  }
  else aboutWindow.show();
}


export default showAboutWindow;
