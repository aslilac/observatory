exports.showMenu = function () {
  ReactDOM.render(
    React.createElement( 'section', null,
      [
        { name: 'SSD', location: '/' },
        { name: '/src', location: '/src' },
        ...( process.platform === 'win32' ? [{ name: 'HDD', location: 'D:\\' }] : [] )
      ].map( ( target, key ) => React.createElement(
        'button',
        {
          key,
          onClick() {
            ipcRenderer.send( 'vfs-create', target.location )
          }
        },
        target.name
      ))
    ),
    document.getElementById( 'fs-display-list' )
  )
}
