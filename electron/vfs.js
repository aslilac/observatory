import drivelist from 'drivelist';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';

import gardens from '../gardens.config';
const garden = gardens.scope( 'VirtualFileSystem' );

const DIRECTORY = 0;
const FILE = 1;
const SYMLINK = 2;
const DEVICE = 3;
const UNKNOWN = 4;

class VirtualFileSystem extends EventEmitter {
  constructor( location ) {
    super();

    fs.stat( location )
      .then( () => {
        // Start logging status while we wait
        const status = setInterval( () => {
          garden.log( this.counts );
        }, 5000 );

        garden.time( 'vfs creation' );

        this._scan( location ).then( async vfs => {
          clearInterval( status );
          garden.log( this.counts );
          vfs.name = path.basename( location );
          garden.timeEnd( 'vfs creation' );

          const list = await drivelist.list();

          list.some( device =>
            device.mountpoints.some( mount => {
              if ( mount.path === this.location ) {
                vfs.name = mount.label || `${device.description} (${mount.path})`;
                vfs.capacity = device.size;
              }
            })
          );

          this.root = vfs;
          this.emit( 'ready' );
        });
      })
      .catch( error => garden.catch( error ) );

    this.location = path.normalize( location );
    this.root = null;
    this.cursor = [];

    this.counts = {
      files: 0,
      directories: 0,
      symlinks: 0,
      devices: 0,
      misc: 0
    };
  }

  ready( ...x ) {
    this.on( 'ready', ...x );
  }

  async _scan( location ) {
    const state = {
      type: DIRECTORY,
      size: 0,
      files: []
    };

    const files = await fs.readdir( location )
      .catch( error => {
        garden.catch( error );
      });

    if ( !files ) return state;

    await Promise.all( files.map( async name => {
      const entity = path.join( location, name );
      const stats = await fs.lstat( entity )
        .catch( error => void garden.catch( error ) );

      if ( !stats ) return state;

      else if ( stats.isSymbolicLink() ) {
        this.counts.symlinks++;
        // state.files.push({
        //   name, type: SYMLINK, size: 0
        // })
      }

      else if ( stats.isCharacterDevice() || stats.isBlockDevice() ) {
        this.counts.devices++;
        // state.files.push({
        //   name, type: DEVICE, size: 0
        // })
      }

      else if ( stats.isFile() ) {
        this.counts.files++;
        state.files.push({
          name, type: FILE,
          size: stats.size
        });
        state.size += stats.size;
      }

      else if ( stats.isDirectory() ) {
        this.counts.directories++;

        if ( process.platform === 'linux' && entity === '/proc' ) return state;
        if ( process.platform === 'darwin' && entity === '/Volumes' ) return state;

        const directory = await this._scan( entity );
        state.files.push({
          name,
          ...directory
        });
        state.size += directory.size;
      }

      else {
        this.counts.misc++;
        // state.files.push({
        //   name, type: UNKNOWN, size: 0
        // })
      }
    }) );

    state.files.sort( ( a, b ) => b.size - a.size );
    return state;
  }

  navigateUp() {
    this.cursor.pop();
  }

  navigateForward( ...names ) {
    const update = [ ...this.cursor, ...names ];
    const correct = this._findDirectory( update );

    if ( !correct ) throw garden.typeerror( 'Cursor does not exist or is not a directory!' );
    this.cursor = update;
  }

  navigateTo( ...names ) {
    const correct = this._findDirectory( names );

    if ( !correct ) throw garden.typeerror( 'Cursor does not exist or is not a directory!' );
    this.cursor = names;
  }

  push( view ) {
    const packet = this._prepIpcPacket();
    view.send( 'vfs-render', packet );
  }

  _findDirectory( cursor = this.cursor ) {
    let position = 0;
    const scale = this.root.size;
    let current = this.root;
    const correct = cursor.every( piece =>
      current.files.some( file => {
        if ( file.name === piece && file.type === DIRECTORY ) {
          current = file;

          return true;
        }
        position += file.size / scale;
      })
    );

    return correct && {
      position,
      ...current
    };
  }

  _prepIpcPacket( ...names ) {
    const cursor = [ ...this.cursor, ...names ];
    const directory = this._findDirectory( cursor );
    const isLargeEnough = file => file.size > directory.size * 0.003;
    const sanitize = recursive => file => ({
      name: file.name,
      type: file.type,
      size: file.size,
      ... recursive > 0 && file.type === DIRECTORY
        ? { files: file.files.filter( isLargeEnough ).map( sanitize( recursive - 1 ) ) }
        : { files: [] }

    });

    const packet = {
      name: this.root.name,
      cursor: cursor,

      type: DIRECTORY,
      rootCapacity: this.root.capacity || this.root.size,
      rootSize: this.root.size,
      capacity: directory.capacity || directory.size,
      position: directory.position,
      size: directory.size,
      // Basically, we just want to strip out any files that won't be rendered
      // on the list or the sunburst so that we don't have to serialize the
      // entire Vfs because that would be reaaaaally slow.
      list: {
        files: directory.files.map( sanitize() )
      },
      sunburst: {
        files: directory.files.filter( isLargeEnough ).map( sanitize( 6 ) )
      }
    };

    return packet;
  }
}

export default VirtualFileSystem;
