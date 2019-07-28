import { ipcRenderer } from 'electron';
import React, { useState } from 'react';

import backArrow from './assets/arrow-left.svg';
import readableSize from './size';

import gardens from '../gardens.config';
const garden = gardens.scope( 'renderer', 'list' );

const DIRECTORY = 0;
// const FILE = 1;
// const SYMLINK = 2;
// const DEVICE = 3;
// const UNKNOWN = 4;

export default function List( props ) {
  const [ expanded, setExpanded ] = useState( false );

  garden.log( props );

  // function onDragStart() {
  //   titlebar.className = 'trash'
  //   let id = event.target.id = Math.floor( Math.random() * 899999 + 100000 )
  //   event.dataTransfer.setData( 'filePointer', id )
  //   event.dataTransfer.effectAllowed = 'move'
  // }

  // function onDragEnd() {
  //   titlebar.className = ''
  // }

  return <section id="fs-display-list">
    <img src={backArrow} className="back" onClick={() => history.back()} />
    <h1>{props.cursor.length
      ? props.cursor[ props.cursor.length - 1 ]
      : props.name}
    <span className="size">{ readableSize( props.size ) }</span>
    </h1>
    <ol>
      {
        ( expanded ? props.files : props.files.filter( file => file.size >= props.size / 100 ) )
          .map( ( file, key ) => <li draggable key={key} onClick={() => {
            if ( file.type === DIRECTORY ) ipcRenderer.send( 'vfs-navigateForward', file.name );
          }}>
            {file.name}
            <span className="size">{readableSize( file.size )}</span>
          </li> )
      }
      {
        expanded || <li className="expand" onClick={() => setExpanded( true ) }>
          show smaller items...
        </li>
      }
    </ol>
  </section>;
}
