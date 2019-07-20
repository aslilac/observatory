import gardens from '../../gardens.config'
const garden = gardens.scope( 'system', 'navigation' )

export function init( view ) {
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

    view.on( 'swipe', (event, direction) => {
        garden.log( 'swipe', event, direction )
        // Navigate the window back when the users swipe
        if ( direction === 'left' && view.webContents.canGoBack() ) {
            view.webContents.goBack()
        }

        else if ( direction === 'right' && view.webContents.canGoForward() ) {
            view.webContents.goForward()
        }
    })

    view.on('will-navigate', event => {
        event.preventDefault()
        garden.log('No navigation allowed!')
    })

    view.on('enter-full-screen', () => {

    })

    view.on('leave-full-screen', () => {

    })
}

export default { init }