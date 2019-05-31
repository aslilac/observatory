const { systemPreferences } = require( 'electron' )

const garden = require( '../../gardens.config' ).scope( 'systemPreferences', 'theme' )

if ( process.platform === 'darwin' ) {
  systemPreferences.subscribeNotification(
    'AppleInterfaceThemeChangedNotification',
    () => garden.log( `Dark mode: ${systemPreferences.isDarkMode()}` )
  )
}
