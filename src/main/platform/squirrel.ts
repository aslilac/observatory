// Compatibility with the Squirrel updater for Windows
import squirrel from "electron-squirrel-startup";

if (squirrel) process.exit(0);
