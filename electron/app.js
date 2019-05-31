const { app, BrowserWindow, Menu, TouchBar } = require( 'electron' )
const path = require( 'path' )
const url = require( 'url' )

const menu = require( './system/menu' )
const theme = require( './system/theme' )
const touchbar = require( './system/touchbar' )
const ipc = require( './ipc' )
const Vfs = require( './vfs' )

const garden = require( '../gardens.config' ).scope( 'electron' )

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
  if ( process.platform === 'darwin' ) {
    const repl = require( 'repl' )
    let x = repl.start({
      prompt: '> ',
      useGlobal: true
    })
    Object.assign( x.context, {
      Vfs, Old: require( '../old/VirtualFileSystem' ),
      view
    })
    x.on( 'exit', () => app.quit() )
  }

  // Load the app.
  view.loadURL( url.format({
    pathname: path.join(__dirname, '../client/index.html'),
    protocol: 'file:',
    slashes: true
  }) )

  view.on( 'ready-to-show', () => {
    view.show()
  })

  view.on( 'app-command', ( event, command ) => {
    garden.log( 'app-command', event, command )
    // Navigate the window back when the user hits their mouse back button
    if ( command === 'browser-backward' && view.webContents.canGoBack() ) {
      view.webContents.goBack()
    }

    else if ( command === 'browser-forward' && view.webContents.canGoForward() ) {
      view.webContents.goForward()
    }
  })

  view.on( 'swipe', ( event, direction ) => {
    garden.log( 'swipe', event, direction )
    // Navigate the window back when the users swipe
    if ( direction === 'left' && view.webContents.canGoBack() ) {
      view.webContents.goBack()
    }

    else if ( direction === 'right' && view.webContents.canGoForward() ) {
      view.webContents.goForward()
    }
  })

  view.on( 'will-navigate', event => {
    event.preventDefault()
    garden.log( 'No navigation allowed!' )
  })

  view.on( 'enter-full-screen', () => {

  })

  view.on( 'leave-full-screen', () => {

  })

  // Emitted when the window is closed.
  view.on( 'closed', () => {
    // Dereference the window object, so that Electron can close gracefully
    view = null
  })

  menu.init( view )
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
