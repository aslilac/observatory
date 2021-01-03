// Compatibility with the Squirrel updater for Windows
import squirrel = require("electron-squirrel-startup");

if (squirrel) process.exit(0);
