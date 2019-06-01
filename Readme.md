# observatory

It looks at files and stuff woohoo!

Observatory was made out of a desire for a higher quality and modern disk usage
analysis tool for Windows, Linux, and macOS utilizing the sunburst graph type.
Other alternatives out there are either slow, old, ugly, platform specific, or
some combination of all of these.

Observatory checks all the boxes that no one else does.

- Fast ✔
- Memory efficient ✔
- Pretty ✔
- Modern ✔
- Cross platform ✔

## Performance
DaisyDisk: 13.20s - 219.7MB

- VirtualFileSystem v1: 48.841s
- VirtualFileSystem v2 (Chrome): 88.692s - 168.4 MB
- VirtualFileSystem v2 (Node): 77.896s - 204.0 MB

VFS v1 is still monstrously faster for some reason, even though v2 is basically
exactly the same thing, and if anything is lighter weight. I don't get it.

## Goals
Full scan in less than 30 seconds on a MacBook Pro
- Currently takes about 60 seconds on my MacBook Pro and 25.5 seconds on my Windows desktop
