# Building Ouijit for Linux

Production Linux builds are produced by the
[`.github/workflows/release.yml`](../.github/workflows/release.yml) workflow
when a version tag is pushed.

This document covers building a Linux x64 binary locally from macOS, for
testing.

## The challenge

Ouijit uses `node-pty`, a native Node.js module that requires compilation for
each target platform and architecture. Cross-compilation of native modules is
not supported by Electron, so the local script uses a Lima VM with Docker +
QEMU emulation.

If you have a native Linux x64 machine available, [building there
directly](#alternative-build-on-native-linux) is faster and avoids QEMU
emulation flakiness.

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

The first run also downloads Docker images for the emulation environment. Later builds skip these steps.

## Output

- `out/ouijit-linux-x64/` - unpacked application
- `out/ouijit-linux-x64.zip` - distributable archive

## Verification

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

