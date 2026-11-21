# Contributing

English | [简体中文](CONTRIBUTING.zh-CN.md)

## Setup

Requires macOS, [Raycast](https://raycast.com), Node.js 22+, and npm.

```bash
git clone https://github.com/iyekChen/logic-project-manager.git
cd logic-project-manager
npm install
npm run dev        # Run the extension in Raycast development mode
```

On first launch, Search Projects asks for a Projects Folder. Use a test folder rather than your real library, since actions like rename and Move to Trash change files on disk.

In development mode, Search Projects has an extra **Reset Onboarding (Dev)** action for testing the first-launch prompts.

## Scripts

```bash
npm run lint          # ESLint + Prettier
npm run fix-lint      # Auto-fix lint and formatting issues
npm test              # Run unit tests with Vitest
npm run test:watch    # Re-run tests on every change
npm run build         # Build the production extension
```

Before opening a PR, run lint, tests, and build. CI runs the same steps on macOS with Node 22, installing with `npm ci`, plus the audio player check below.

## Project layout

- `src/*.tsx` are the command entry points, one per command. Manage Tags is `manage-categories.tsx`.
- `src/core/` holds everything that isn't specific to Logic Pro: projects, bounces, collections, notes, search, and storage.
- `src/daws/logic/` holds the Logic-specific parts: reading `.logicx` packages, the Alternatives view, and editing Alternatives. They plug into the rest through the `DawAdapter` interface in `src/daws/types.ts`.
- Most UI text lives in `src/strings.ts`. Logic-specific wording is in `src/daws/labels.ts` and `src/daws/logic/strings.ts`, and command and preference titles are in `package.json`.
- `swift/` holds the audio player's source, and `scripts/` the script that builds it.
- `test/` holds the Vitest unit tests.

## Audio player

The audio player binary (`assets/audio-player`) is committed, so you don't need to build it to run the extension. If you change [`swift/AudioPlayer.swift`](https://github.com/iyekChen/logic-project-manager/blob/main/swift/AudioPlayer.swift), rebuild it and commit both the binary and `swift/AudioPlayer.swift.sha256`:

```bash
npm run build:player   # Requires Xcode Command Line Tools (swiftc, lipo)
```

[`scripts/build-audio-player.sh`](https://github.com/iyekChen/logic-project-manager/blob/main/scripts/build-audio-player.sh) compiles a universal arm64 + x86_64 binary targeting macOS 11 and records the source hash that CI checks. CI fails if `swift/AudioPlayer.swift.sha256` doesn't match the Swift source, then checks that the player still compiles. It doesn't check the committed binary, so make sure `assets/audio-player` is part of your commit.

## How it works

- **Logic projects:** a project is a `.logicx` package. Each Alternative is a numbered folder under `Alternatives/`. Its tempo, time signature, and key are read from its `MetaData.plist`, and Alternative names and the Active Alternative from `Resources/ProjectInformation.plist`, both with a built-in binary plist reader. Changes to Alternatives are written with macOS's `/usr/bin/plutil`, which keeps the binary format.
- **Playback:** a small Swift binary built on AVFoundation plays bounces as a detached process, so playback survives view changes and closing the Raycast window. The extension controls it through command and status files in its support folder. The player stops on its own when Raycast quits.
- **Analysis:** the same binary has an `analyze` mode that streams the file in chunks and computes RMS, peak, spectral centroid, and spectral flux using a 2048-point FFT, without loading the whole file into memory.
