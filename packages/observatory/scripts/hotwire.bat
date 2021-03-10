: This patches over how badly electron-forge handles workspaces...

: Define a function we can call to actually hotwire things
echo "Linking..."

: mklink /d ..\..\node_modules node_modules
mklink /d node_modules\drivelist  ..\..\..\node_modules\drivelist
mklink /d node_modules\electron ..\..\..\node_modules\electron

echo "Success!"
