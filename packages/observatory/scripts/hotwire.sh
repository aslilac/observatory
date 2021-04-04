# This patches over how badly electron-forge handles workspaces...

# Utility for linking individual packages
lip() {
	mkdir -p $(dirname node_modules/${2})
	ln -s ${1}/node_modules/${2} node_modules/${2}
}

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

	local repo_root=$(git rev-parse --show-toplevel)

	# Ideally we'd be able to just link the whole thing, but unfortunately that
	# doesn't work
    # ln -s ${repo_root}/node_modules node_modules

	# Needed for `electron-forge start`
    lip $repo_root "drivelist"
    lip $repo_root "electron"

	# Needed for `electron-forge make`
	lip $repo_root "@mckayla/electron-redux"
	lip $repo_root "bindings"
	lip $repo_root "redux"
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
