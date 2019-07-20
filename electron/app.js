const { app, BrowserWindow } = require( 'electron' )
const path = require( 'path' )
const url = require( 'url' )

const menu = require( './system/menu' )
const navigation = require( './system/navigation' )
const theme = require( './system/theme' )
const touchbar = require( './system/touchbar' )
const ipc = require( './ipc' )
const Vfs = require( './vfs' )

let view = null

function createWindow() {
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
  })

  // REPL!
  // For some reason Windows shits it's pants if we try to do this, not
  // that I'm fucking surprised.
  // This also super-breaks launching on macOS when not done through the console.
  // if ( process.platform === 'darwin' ) {
  //   const repl = require( 'repl' )
  //   let x = repl.start({
  //     prompt: '> ',
  //     useGlobal: true
  //   })
  //   Object.assign( x.context, {
  //     Vfs,
  //     view
  //   })
  //   x.on( 'exit', () => app.quit() )
  // }

  // Load the app.
  view.loadURL( url.format({
    pathname: path.join( __dirname, '../client/index.html' ),
    protocol: 'file:',
    slashes: true
  }) )

  view.on( 'ready-to-show', () => {
    view.show()
  })

  // Emitted when the window is closed.
  view.on( 'closed', () => {
    // Dereference the window object, so that Electron can close gracefully
    view = null
  })

  menu.init( view )
  navigation.init( view )
  touchbar.init( view )
}

app.on( 'ready', () => {
  createWindow()
})

// Might not be necessary if we quit on window-all-closed
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
