import gardens from 'gardens'

const manager = gardens.createManager( 'observatory' )

manager.scope( 'system', 'touchbar', 'XD' ).configure({
  scopeStyle: {
    color: '#fa4873'
  }
})

export default manager
