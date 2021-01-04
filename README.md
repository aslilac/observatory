# Observatory

![package version](https://img.shields.io/badge/observatory-v0.10.0-12142d.svg)
![stability](https://img.shields.io/badge/stability-beta-6680f2.svg)
[![main](https://github.com/partheseas/observatory/workflows/main/badge.svg)](https://github.com/partheseas/observatory/actions)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

![screenshot](/media/observatory.png)

Observatory was made out of a desire for a high quality and modern disk usage analysis tool
that can be used on all the most popular desktop operating systems. Other alternatives out
there are either old, ugly, confusing, platform specific, or some combination of all of these.

Observatory checks all the boxes that no one else does.

-   Pretty ✔
-   Modern ✔
-   Cross platform ✔
-   Fast ✔ (sort of)
-   Memory efficient ✔ (sort of)

The last two are both things that are kind of work-in-progress. The current scanning
implementation is in TypeScript, which comes with some performance and memory usage concerns.
On a reasonably powerful laptop it's fine, but on some lower end machines it may cause issues.

## Build

To build Observatory, you'll first need to install the latest versions of
[Node](https://nodejs.org) and [Yarn](https://classic.yarnpkg.com).

Install dependencies:

```shell
yarn
```

To run in development:

```shell
yarn dev
```

Build an installer:

```shell
yarn forge
```

## Performance

-   DaisyDisk: 13.20s
-   Observatory: 77.896s

DaisyDisk will probably always be faster since it can optimize specifically for
macOS and runs directly on hardware instead of inside of V8. I'm currently attempting to
rewrite the disk analysis in Rust, which could potentially see a huge improvement in
performance, but that's yet to be proven.

### Goals

Full scan _should_ take less than 20 seconds on a recent/decent MacBook Pro. It
currently takes much longer.
