# This patches over how badly electron-forge handles workspaces...

read -p "Are you sure you want to hotwire node_modules? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]
then
	echo "Linking..."
    ln -s ../../../node_modules/drivelist node_modules/drivelist
	ln -s ../../../node_modules/electron  node_modules/electron
	echo "Success!"
else
	echo "Exiting"
fi
