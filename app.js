let { app, BrowserWindow, Menu } = require( 'electron' )
let path = require( 'path' )
let url = require( 'url' )
let observer = require( './controller/create-vfs' )

let view

// TODO: Make this more robust for Mac users
// Menu.setApplicationMenu( null )

function createWindow() {
  // Create the browser window.
  view = new BrowserWindow({
    backgroundColor: '',
    width: 800, height: 400,
    show: false,
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true
  })

  // and load the index.html of the app.
  view.loadURL( url.format({
    pathname: path.join(__dirname, 'view/panel.html'),
    protocol: 'file:',
    slashes: true
  }) )

  view.on( 'ready-to-show', () => {
    view.show()
  })

  // Open the DevTools.
  // view.webContents.openDevTools()

  // Emitted when the window is closed.
  view.on( 'closed', () => {
    // Dereference the window object, so that Electron can close gracefully
    view = null
  })

}

app.on( 'ready', () => {
  createWindow()
})

app.on( 'activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if ( view == null ) {
    createWindow()
  }
})

app.on( 'window-all-closed', () => {
  app.quit()
})
