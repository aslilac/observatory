# Observatory

Observatory was made out of a desire for a high quality and modern disk usage analysis tool that can be used on all the most popular desktop operating systems. Other alternatives out there are either old, ugly, confusing, platform specific, or some combination of all of these.

Observatory checks all the boxes that no one else does.

- [x] Pretty
- [x] Modern
- [x] Cross platform
- [x] Fast

## Build

To build Observatory, you'll first need to install the latest versions of [Node](https://nodejs.org) and [Yarn](https://classic.yarnpkg.com).

Install dependencies:

```shell
yarn
yarn configure
```

To run in development:

```shell
yarn dev
```

Test a production build:

```shell
yarn preview
```

Build an installer:

```shell
yarn forge
```

## Performance comparisons

> [!NOTE] Last updated 2026 May 11

### macOS 26

Comparisons run on an MacBook Pro, M1 Max, 64GB memory, 2TB SSD. Scan includes over 5 million files, totaling about 1TB of disk usage.

1. DaisyDisk: 29.1s
2. Observatory: 33.2s
