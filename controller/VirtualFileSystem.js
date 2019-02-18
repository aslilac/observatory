const fs = require( 'fs' )
const path = require( 'path' )
const readline = require( 'readline' )
const garden = new (require( 'gardens' ).constructor)( 'VirtualFileSystem' )

class VirtualFileSystem {
  constructor( rootDirectory ) {
    this.waiters = []
    this.loaded = false
    this.vroot = null
    this.rootDirectory = rootDirectory

    this.depthTracker = []
    this.errorCount = 0
    this.linkCount = 0
    this.deviceCount = 0
    this.fileCount = 0
    this.directoryCount = 0
    this.otherCount = 0
    this._reportAwait = 0

    this.readErrors = []

    this._logstatus()
    garden.time( 'VFS Creation' )
    this.counterRunning = setInterval( () => this._logstatus(), 1000 )

    this._scanTree( rootDirectory, rootDirectory )
      .then( vroot => this._complete( vroot ) )
  }

  ready( waiter ) {
    this.loaded ? waiter( this ) : this.waiters.push( waiter )
  }

  _logstatus( done ) {
    let status = `E: ${this.errorCount}  L: ${this.linkCount}  B: ${this.deviceCount}` +
      `  F: ${this.fileCount}  D: ${this.directoryCount}  O: ${this.otherCount}` +
      `  Waited: ${this.fileCount + this.directoryCount + this.otherCount}/${this._reportAwait}`

    process.stdout.write( status )
    readline.moveCursor( process.stdout, -status.length, 0 )

    if ( done ) {
      process.stdout.write( '\n' )
      garden.timeEnd( 'VFS Creation' )

      // Most of the time these are permission issues that we don't care about.
      // this.readErrors.forEach( fail => garden.log( fail ) )
    }
  }

  _complete( vroot ) {
    clearInterval( this.counterRunning )

    this._logstatus( true )

    this.vroot = vroot
    this.loaded = true
    this.waiters.forEach( waiter => waiter( this ) )
    this.waiters = []
  }

  _scanTree( directory, name ) {
    return new Promise( fulfillMap => {
      let vmap = { size: 0, contents: [], name }

      fs.readdir( directory, ( error, listing ) => {
        if ( error ) {
          this.errorCount++
          this.readErrors.push( error )
          fulfillMap( vmap )
          return
        }

        // Iterate through the listing, and fulfill the promise once
        // all the inner files have been fulfilled.
        Promise.all( listing.map( file => {
          return new Promise( fulfillFile => {
            let t = process.hrtime()
            fs.lstat( path.join( directory, file ), ( error, stat ) => {
              let d = process.hrtime( t )

              if ( error ) {
                this.errorCount++
                this.readErrors.push( error )
                fulfillFile()
                return
              }

              if ( stat.isSymbolicLink() ) {
                this.linkCount++
                fulfillFile()
                return
              }

              if ( stat.isBlockDevice() || stat.isCharacterDevice() ) {
                this.deviceCount++
                fulfillFile()
                return
              }

              this._reportAwait++

              if ( stat.isDirectory() ) {
                this._scanTree( path.join( directory, file ), file )
                  .then( statListing => {
                    vmap.size += statListing.size
                    vmap.contents.push( statListing )
                    this.directoryCount++
                    fulfillFile()
                  })
              } else if ( stat.isFile() ) {
                vmap.size += stat.size
                vmap.contents.push({ size: stat.size, name: file })
                this.fileCount++
                fulfillFile()
              } else {
                this.otherCount++
                fulfillFile()
              }
            })
          })
        }) ).then( () => fulfillMap( vmap ) )

      })
    })
  }

}

module.exports.VirtualFileSystem = VirtualFileSystem
