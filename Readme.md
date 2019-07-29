# Observatory
![package version](https://img.shields.io/badge/observatory-v0.3.0-12142d.svg)
![stability](https://img.shields.io/badge/stability-beta-6680f2.svg)

Observatory was made out of a desire for a higher quality and modern disk usage
analysis tool for Windows, Linux, and macOS utilizing the sunburst graph type.
Other alternatives out there are either slow, old, ugly, platform specific, or
some combination of all of these.

Observatory checks all the boxes that no one else does.

- Pretty ✔
- Modern ✔
- Cross platform ✔
- Fast ✔ (sort of)
- Memory efficient ✔ (sort of)

The last two are both things that are kind of work-in-progress. On a modern SSD
the loading times are reasonable to wait for and memory usage isn't really an issue,
although both could definitely be improved. You're more than welcome to help improve
them if you want.

Observatory is open source and available free of charge. I put a lot of love and work into it, and
if you'd like to [show appreciation](https://cash.app/$partheseas) I'd be incredibly thankful!

## Build
To build Observatory, you'll first need to install the latest versions of [Node.js](https://nodejs.org)
and [Yarn](https://yarnpkg.com). Once installed, clone this repository
to your computer and run `yarn` inside of it to install the rest of
Observatory's dependencies.

To run in development:
```shell
yarn start
```

Build for release:
```shell
yarn forge
```

## Performance
- DaisyDisk: 13.20s - 219.7MB
- VirtualFileSystem v1: 48.841s
- VirtualFileSystem v2: 77.896s

VFS v1 is still monstrously faster for some reason, even though v2 is basically
exactly the same thing, and if anything is lighter weight. I don't get it.

DaisyDisk will probably always be faster since it can optimize specifically for
macOS and runs directly on hardware instead of inside of V8, but I have no
interesting in rewriting Observatory natively any time soon since that would
really complicate my goal of being cross platform. That being said, it is still
a goal to improve performance and figure out why there was such a major
regression in v2.

### Goals
Full scan in less than 30 seconds on a MacBook Pro
- Currently takes about 60 seconds on my MacBook Pro and 25.5 seconds on my Windows desktop
