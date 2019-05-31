const { EventEmitter } = require( 'events' )
const fs = require( 'fs' ).promises
const path = require( 'path' )

const garden = require( '../gardens.config' ).scope( 'VirtualFileSystem' )

const DIRECTORY = 0
const FILE = 1
const SYMLINK = 2
const DEVICE = 3
const UNKNOWN = 4

class VirtualFileSystem extends EventEmitter {
  constructor( location ) {
    super()

    fs.stat( location )
      .then( () => {
        // Start logging status while we wait
        const status = setInterval( () => {
          garden.log( this.counts )
        }, 5000 )

        garden.time( 'vfs creation' )
        this._scan( location ).then( vfs => {
          clearInterval( status )
          garden.log( this.counts )
          garden.timeEnd( 'vfs creation' )

          if ( location === '/' ) {
            vfs.capacity = (process.platform === 'darwin' ? 256 : 500) * 1000 ** 3
          }

          if ( location === 'D:\\' ) {
            vfs.capacity = 2 * 1000 ** 4
          }

          this.root = vfs
          this.emit( 'ready' )
        })
      })
      .catch( error => garden.catch( error ) )

    this.location = location
    this.root = null
    this.cursor = []

    this.counts = {
      files: 0,
      directories: 0,
      symlinks: 0,
      devices: 0,
      misc: 0
    }
  }

  ready( ...x ) {
    this.on( 'ready', ...x )
  }

  async _scan( location ) {
    let state = {
      type: DIRECTORY,
      size: 0,
      files: []
    }

    let files = await fs.readdir( location )
      .catch( error => {
        garden.catch( error )
      })

    if ( !files ) return state

    await Promise.all( files.map( async name => {
      let entity = path.join( location, name )
      let stats = await fs.lstat( entity )
        .catch( error => void garden.catch( error ) )

      if ( !stats ) return state

      else if ( stats.isSymbolicLink() ) {
        this.counts.symlinks++
        // state.files.push({
        //   name, type: SYMLINK, size: 0
        // })
      }

      else if ( stats.isCharacterDevice() || stats.isBlockDevice() ) {
        this.counts.devices++
        // state.files.push({
        //   name, type: DEVICE, size: 0
        // })
      }

      else if ( stats.isFile() ) {
        this.counts.files++
        state.files.push({
          name, type: FILE,
          size: stats.size
        })
        state.size += stats.size
      }

      else if ( stats.isDirectory() ) {
        this.counts.directories++
        if ( process.platform === 'linux' && entity === '/proc' ) return state
        if ( location === '/' ) garden.time( entity )
        let directory = await this._scan( entity )
        if ( location === '/' ) garden.timeEnd( entity )
        state.files.push({
          name,
          ...directory
        })
        state.size += directory.size
      }

      else {
        this.counts.misc++
        // state.files.push({
        //   name, type: UNKNOWN, size: 0
        // })
      }
    }) )

    state.files.sort( ( a, b ) => b.size - a.size )
    return state
  }

  navigateUp() {
    this.cursor.pop()
  }

  navigateForward( ...names ) {
    let update = [ ...this.cursor, ...names ]
    let correct = this._findDirectory( update )

    if ( !correct ) throw garden.typeerror( 'Cursor does not exist or is not a directory!' )
    this.cursor = update
  }

  navigateTo( ...names ) {
    let correct = this._findDirectory( names )

    if ( !correct ) throw garden.typeerror( 'Cursor does not exist or is not a directory!' )
    this.cursor = names
  }

  push( view ) {
    let packet = this._prepIpcPacket()
    view.send( 'vfs-render', packet )
  }

  _findDirectory( cursor = this.cursor ) {
    let position = 0
    let scale = this.root.size
    let current = this.root
    let correct = cursor.every( piece =>
      current.files.some( file => {
        if ( file.name === piece && file.type === DIRECTORY ) {
          current = file

          return true
        }
        position += file.size / scale
      })
    )

    return correct && {
      position,
      ...current
    }
  }

  _prepIpcPacket( ...names ) {
    let cursor = [ ...this.cursor, ...names ]
    let directory = this._findDirectory( cursor )
    let isLargeEnough = file => file.size > directory.size * 0.003
    let sanitize = recursive => file => ({
      name: file.name,
      type: file.type,
      size: file.size,
      ...( recursive > 0 && file.type === DIRECTORY
        ? { files: file.files.filter( isLargeEnough ).map( sanitize( recursive - 1 ) ) }
        : { files: [] }
      )
    })

    let packet = {
      name: this.location === '/'
        ? 'SSD'
        : this.location === 'D:\\'
          ? 'HDD'
          : this.location,
      cursor: cursor,
      // Basically, we just want to strip out any files lists from directories
      // so that we only have to serialize a single layer in JSON, because
      // it is *reeeeeeally* slow.
      list: {
        type: DIRECTORY,
        size: directory.size,
        files: directory.files.map( sanitize() )
      },
      sunburst: {
        type: DIRECTORY,
        position: directory.position,
        rootCapacity: this.root.capacity || this.root.size,
        rootSize: this.root.size,
        capacity: directory.capacity || directory.size,
        size: directory.size,
        files: directory.files.filter( isLargeEnough ).map( sanitize( 6 ) )
      }
    }

    return packet
  }
}

module.exports = VirtualFileSystem
