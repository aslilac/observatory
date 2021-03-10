# This patches over how badly electron-forge handles workspaces...

# Define a function we can call to actually hotwire things
hotwire() {
	echo "Linking..."

    # ln -s ../../node_modules node_modules
    ln -s ../../../node_modules/drivelist node_modules/drivelist
    ln -s ../../../node_modules/electron node_modules/electron
	echo "Success!"
}

# If you pass -y then don't prompt (useful for CI)
if [[ $1 == "-y" ]]
then
	hotwire
	exit 0
fi

# Ask the user to confirm by pressing y
read -p "Are you sure you want to hotwire node_modules? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]
then
	hotwire
else
	echo "Exiting"
fi
