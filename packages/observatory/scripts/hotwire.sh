# This patches over how badly electron-forge handles workspaces...

# Define a function we can call to actually hotwire things
hotwire() {
	echo "Linking..."

	# Clean up any existing entries.
	# Try to delete it as a symlink first...
	# rm -f node_modules > /dev/null
	# Then delete it as a directory. If we delete it as a directory first
	# but it is a symlink, we'll delete all of our installed node_modules
	# which is bad. But if we only try to delete it as a symlink, this script
	# might fail, which is also bad.
	# rm -rf node_modules > /dev/null

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
