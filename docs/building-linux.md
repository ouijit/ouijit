# Building Ouijit for Linux

This document explains how to build Ouijit for Linux x64 from macOS.

## The Challenge

Ouijit uses `node-pty`, a native Node.js module that requires compilation for each target platform and architecture. Cross-compilation of native modules is not supported by Electron, so we use Docker with QEMU emulation to build the Linux binaries.

## Prerequisites

- **macOS** (Apple Silicon or Intel)
- **Lima** - Linux virtual machine manager for macOS
- **Node.js 20+**

### Install Lima

```bash
brew install lima
```

## Building

Run the build script:

```bash
npm run make:linux
```

This will:
1. Download a Linux limactl binary into a staging directory
2. Create/start a Lima VM (`ouijit-linux-builder`) with Node.js and QEMU
3. Cross-compile `node-pty` for x64 inside an emulated Docker container
4. Package the Electron app with staged binaries via `OUIJIT_CROSS_STAGING`
5. Create `out/ouijit-linux-x64.zip`

The first run takes longer as it sets up the VM and downloads Docker images. Subsequent builds are faster.

## Output

The build produces:
- `out/ouijit-linux-x64/` - Unpacked application
- `out/ouijit-linux-x64.zip` - Distributable archive

## Verification

To verify the binaries are correct:

```bash
file out/ouijit-linux-x64/resources/app/node_modules/node-pty/build/Release/pty.node
# Should output: ELF 64-bit LSB shared object, x86-64, ...

file out/ouijit-linux-x64/resources/bin/limactl
# Should output: ELF 64-bit LSB executable, x86-64, ...
```

## Installing on Linux

Extract the zip and run:

```bash
unzip ouijit-linux-x64.zip
cd ouijit-linux-x64
./ouijit
```

## Troubleshooting

### Lima VM issues

Reset the build VM:
```bash
limactl stop ouijit-linux-builder
limactl delete ouijit-linux-builder
npm run make:linux  # Will recreate
```

### QEMU emulation crashes

If the Docker build crashes with memory errors, the x64 emulation may be unstable. Try:
```bash
limactl shell ouijit-linux-builder
# Then manually run:
nerdctl run --rm --platform linux/amd64 -v /tmp/test:/w -w /w node:20 npm init -y
```

### Alternative: Build on native Linux

If emulation is too slow or unstable, build directly on a Linux x64 machine:

```bash
# On Linux x64:
git clone <repo>
cd ouijit
npm install
npm run make -- --targets=@electron-forge/maker-zip
# Output: out/make/zip/linux/x64/ouijit-linux-x64-1.0.0.zip
```

## Why not GitHub Actions?

GitHub Actions would be the most reliable option for production releases. Add a workflow:

```yaml
# .github/workflows/build-linux.yml
name: Build Linux
on: [push, workflow_dispatch]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: npm run make -- --targets=@electron-forge/maker-zip
      - uses: actions/upload-artifact@v4
        with:
          name: linux-x64
          path: out/make/zip/linux/x64/*.zip
```
