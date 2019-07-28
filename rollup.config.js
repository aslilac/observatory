import minify from 'rollup-plugin-babel-minify';

export default {
  input: 'electron/app.js',
  external: [
    'drivelist',
    'electron',
    'electron-squirrel-startup',
    'events',
    'fs',
    'gardens',
    'path',
    'url',
    'source-map-support/register'
  ],
  plugins: [ minify({ comments: false }) ],
  output: {
    file: 'target/app.js',
    format: 'cjs',
    sourcemap: true
  }
};