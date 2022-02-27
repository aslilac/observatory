# Observatory

Peak into (your disk) space!

![screenshot](/media/observatory.png)

Observatory was made out of a desire for a high quality and modern disk usage analysis tool
that can be used on all of the most popular desktop operating systems. Other alternatives out
there are either old, ugly, confusing, platform specific, or some combination of all of these.

Observatory checks all the boxes that no one else does!

-   Pretty ✔
-   Easy to use ✔
-   Cross platform ✔
-   Fast ✔ (sort of)

The last two are both things that are kind of work-in-progress. The current scanning
implementation is in TypeScript, which comes with some performance and memory usage concerns.
On a reasonably powerful laptop it's fine, but on some lower end machines it may cause issues.

## Build

To build Observatory, you'll first need to install a recent version of
[Node](https://nodejs.org).

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
