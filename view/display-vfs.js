const path = require( 'path' )
const os = require( 'os' )
const { ipcRenderer } = require( 'electron' )
const { StateMachine } = require( 'prelude' )

const COLOR_SCALE = hue => `hsl(${hue.toFixed(2)}, 85%, 70%)`
const COLOR_SCALE_BORDER = hue => `hsl(${hue.toFixed(2)}, 100%, 10%)`

const HUMAN_READABLE_SUFFIXES = [ 'B', 'KB', 'MB', 'GB', 'TB', 'PB' ]
const HUMAN_READABLE_SIZE = function ( size ) {
  let power = 0
  let sizeString
  while ( power + 1 < HUMAN_READABLE_SUFFIXES.length && size > 1000 ) {
    size /= 1024
    power += 1
  }

  sizeString = Math.trunc( size ) === size
    ? size.toString()
    : size.toPrecision( 3 )

  return sizeString + ' ' + HUMAN_READABLE_SUFFIXES[ power ];
}

// Set up our state machine
const sm = Object.assign( new StateMachine(), {
  currentScreen: 'menu',
  preludeDom: null,
  currentTreeLocation: 0,
  currentSortingAlgorithm: ( a, b ) => b.size - a.size,

  treeListExpanded: false,

  vmapPointers: [],
  navigationHistory: [],

  collectedGarbage: [],

  scanDirectory( name, callback ) {
    sm.currentScreen = 'loading'
    ipcRenderer.send( 'create-vfs', name )
    ipcRenderer.on( 'display-vfs', ( event, vfs ) => {
      sm.currentScreen = 'tree'
      fillInfo( vfs.vroot, vfs.vroot )
      sm.currentTreeLocation = sm.vmapPointers.push( vfs.vroot ) - 1
    })
  },

  // stepInto( name ) {
  //   this.currentTreeLocation.push( name )
  //   updateTree()
  // },
  stepBack() {
    this.navigationHistory.length > 0
      ? this.currentTreeLocation = this.navigationHistory.pop()
      : sm.currentScreen = 'menu'
  }
})

// Prelude handles relating all of our DOM ID's into an easily accessable object.
new Prelude().ready( ({ dom, on }) => {
  document.documentElement.className += ` ${os.platform()}`

  // Define DOM dependent state controllers
  sm.preludeDom = dom
  sm.controller( [ 'currentScreen' ], name => {
    let screens = { menu: dom.menu, loading: dom.loading, tree: dom.tree }
    // Hide all of the screens initially
    Object.keys( screens ).forEach( screen => screens[ screen ].style.display = 'none' )
    if ( screens[ name ] ) {
      screens[ name ].style.display = '' // Reset selected screen to default
      dom.header.innerHTML = screens[ name ].getAttribute( 'header-title' )
    }
  })

  sm.controller(
    [ 'followerText', 'followerX', 'followerY', 'followerVisible' ],
    ( text, x, y, visible ) => {
      if ( visible ) {
        dom.follower.style.display = 'block'
        dom.follower.innerHTML = text
        dom.follower.style.top = `${y + 5}px`
        dom.follower.style.left = `${x + 10}px`
      } else dom.follower.style.display = 'none'
    }
  )

  sm.controller( [ 'currentTreeLocation' ], location => {
    // sm.navigationHistory.push( sm.currentTreeLocation )
    // This line is really hacky. The controller is called before the actual
    // value is set to the object so that the controller can save state if it so
    // desires, but we need the state to be set BEFORE we update the tree or it
    // will be set incorrectly.
    sm.props.currentTreeLocation = location
    sm.treeListExpanded = false
    updateTree()
  })

  sm.controller( [ 'treeListExpanded' ], expanded => {
    dom.treeExpander.style.display = expanded ? 'none' : 'inline-block'
    dom.treeCollapsedList.style.display = expanded ? 'block' : 'none'
    dom.treeListContainer.className = expanded ? 'expanded' : ''
  })

  // XXX: This is a shortcut for fast hot-loading. Kill it eventually.
  // setTimeout( () => sm.scanDirectory( '/' ), 100 )

  // Register global events
  on( dom.beginScanButton, 'click', () => sm.scanDirectory( dom.directoryLocation.value ) )
  on( dom.back, 'click', () => sm.stepBack() )
  on( dom.treeExpander, 'click', () => sm.treeListExpanded = true )

  on( dom.treeGarbage, 'dragover', drag => drag.preventDefault() )

  on( dom.treeGarbage, 'drop', drop => {
      let pointer = drop.dataTransfer.getData( 'filePointer' )
      console.log( 'drop:', pointer )
      if ( sm.vmapPointers[ pointer ] ) {
        drop.preventDefault()
        console.log( 'deleting', sm.vmapPointers[ pointer ].name )
        sm.collectedGarbage.push( pointer )
        delete sm.vmapPointers[ pointer ]
      }
  })
})

function updateTree() {
  let dom = sm.preludeDom
  let vmap = sm.vmapPointers[ sm.currentTreeLocation ]

  // If we aren't pointing correctly into a tree location then just abort
  // Don't crash or throw an error, just log a warning to the console.
  if ( !vmap ) {
    // But we only need to if the tree is actually being displayed. Otherwise,
    // it's not a big deal (like if we're calling this on startup from the menu)
    if ( sm.currentScreen === 'tree' )
      console.warn( 'Attempting to updateTree with an empty vmap pointer (sm.currentTreeLocation)' )
    return
  }

  let renderState = {
    blockStart: vmap.beginningHue || 0,
    blockMax: vmap.maximumHue || 250,
    localStart: null,
    localMaxDelta: null,
    displayTarget: dom.treeDisplay,
    listTarget: dom.treeList,
    collapsedListTarget: dom.treeCollapsedList,
    listedItems: 0
  }

  renderState.localStart = renderState.blockStart

  dom.treeList.innerHTML = ''
  dom.treeDisplay.innerHTML = ''
  dom.treeCollapsedList.innerHTML = ''

  dom.header.innerHTML = 'todo: button control thing'

  let header = addTreeListItem( vmap, vmap, renderState )
  header.className = "tree-list-header"

  console.log('-VMAP--RENDER STATE--------------------------------------------')
  console.log( vmap )
  console.log( renderState )
  console.log('-FILES---------------------------------------------------------')

  vmap.contents.sort( sm.currentSortingAlgorithm ).forEach( ( fileDetails, index ) => {
    fileDetails.pointer = sm.vmapPointers.push( fileDetails ) - 1
    drawListing( vmap, fileDetails, renderState )
    console.log( fileDetails )
  })
}

function drawListing( vmap, fileDetails, renderState ) {
  fillInfo( vmap, fileDetails, renderState )
  addTreeListItem( vmap, fileDetails, renderState )
  addDisplayListItem( vmap, fileDetails, renderState )
}

function fillInfo( vmap, fileDetails, renderState ) {
  if ( !fileDetails.sizeFactor ) fileDetails.sizeFactor = fileDetails.size / vmap.size

  if ( renderState && !fileDetails.hue ) {
    renderState.localMaxDelta = fileDetails.sizeFactor * (renderState.blockMax - renderState.blockStart)

    fileDetails.beginningHue = renderState.localStart
    fileDetails.hue          = renderState.localStart + renderState.localMaxDelta / 2
    fileDetails.maximumHue   = renderState.localStart + renderState.localMaxDelta

    fileDetails.color  = COLOR_SCALE( fileDetails.hue )
    fileDetails.border = COLOR_SCALE_BORDER( fileDetails.hue )

    renderState.localStart += fileDetails.sizeFactor * ( renderState.blockMax - renderState.blockStart )
  }
}

function addTreeListItem( vmap, fileDetails, renderState ) {
  let sizeString = HUMAN_READABLE_SIZE( fileDetails.size )

  let listItem = document.createElement( 'li' )

  let bullet = document.createElement( 'mark' )
  bullet.style.backgroundColor = fileDetails.color
  listItem.appendChild( bullet )

  // Even though this displays last, we make it first so that it floats
  // in a prettier way than it otherwise would.
  let fileSize = document.createElement( 'label' )
  fileSize.appendChild( document.createTextNode( sizeString ) )
  listItem.appendChild( fileSize )

  let fileName = document.createElement( 'label' )
  fileName.appendChild( document.createTextNode( fileDetails.name ) )
  listItem.appendChild( fileName )

  if ( fileDetails.sizeFactor > 0.005 && fileDetails.size > 20000 || renderState.listedItems < 5 )
    renderState.listTarget.appendChild( listItem )
  else renderState.collapsedListTarget.appendChild( listItem )

  renderState.listedItems++

  registerEvents( listItem, fileDetails )

  return listItem
}

function addDisplayListItem( vmap, fileDetails, renderState ) {
  // Lets only draw "big" things.
  let areaWidth = renderState.displayTarget.getBoundingClientRect().width
  if ( fileDetails.sizeFactor * areaWidth < 3 ) return

  let displayItem = document.createElement( 'span' )

  displayItem.style.width = fileDetails.sizeFactor * areaWidth + 'px'
  displayItem.style.backgroundColor = fileDetails.color
  displayItem.style.borderColor = fileDetails.border

  renderState.displayTarget.appendChild( displayItem )
  registerEvents( displayItem, fileDetails )
}

function registerEvents( item, fileDetails ) {
  // Basically if it's a folder
  if ( fileDetails.contents )
    item.addEventListener( 'click', () => {
      // This detects if it's a listing for the directory we are already in.
      // If so, then we should step back into it's parent directory.
      if ( sm.currentTreeLocation === fileDetails.pointer ) sm.stepBack()
      else {
        sm.navigationHistory.push( sm.currentTreeLocation )
        sm.currentTreeLocation = fileDetails.pointer
      }
    })

  item.addEventListener( 'mousemove', mouse => {
    sm.followerText = fileDetails.name
    sm.followerVisible = true
    sm.followerX = mouse.clientX
    sm.followerY = mouse.clientY
  })

  item.addEventListener( 'mouseleave', mouse => {
    sm.followerVisible = false
  })

  item.draggable = true

  item.addEventListener( 'dragstart', drag => {
    drag.dataTransfer.setData( 'filePointer', fileDetails.pointer )
    drag.dataTransfer.effectAllowed = 'move'
  })
}
