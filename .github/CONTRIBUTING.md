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

Before opening a PR, run lint, tests, and build. CI runs the same steps on macOS with Node 22, installing with `npm ci`.

## Project layout

- `src/*.tsx` are the command entry points, one per command. Manage Tags is `manage-categories.tsx`.
- `src/core/` holds everything that isn't specific to Logic Pro: projects, bounces, collections, notes, search, and storage.
- `src/daws/logic/` holds the Logic-specific parts: reading `.logicx` packages, the Alternatives view, and editing Alternatives. They plug into the rest through the `DawAdapter` interface in `src/daws/types.ts`.
- Most UI text lives in `src/strings.ts`. Logic-specific wording is in `src/daws/labels.ts` and `src/daws/logic/strings.ts`, and command and preference titles are in `package.json`.
- `swift/audio-player/` is the audio player's Swift package, built by `ray build`.
- `test/` holds the Vitest unit tests.

## Audio player

The audio player is a Swift package in `swift/audio-player/`, built with [extensions-swift-tools](https://github.com/raycast/extensions-swift-tools). `ray build` compiles it, so there's no separate build step and no binary in the repository. Building it needs Xcode 16.3 or later.

[`swift/audio-player/Sources/AudioPlayer.swift`](https://github.com/iyekChen/logic-project-manager/blob/main/swift/audio-player/Sources/AudioPlayer.swift) exports three functions to TypeScript: `startPlayer` starts a detached worker and returns its pid, `runPlayer` is the playback loop, and `analyzeAudio` measures the audio. The plugin generates `main.swift`, so the file must not have top-level statements or `@main`.

## How it works

- **Logic projects:** a project is a `.logicx` package. Each Alternative is a numbered folder under `Alternatives/`. Its tempo, time signature, and key are read from its `MetaData.plist`, and Alternative names and the Active Alternative from `Resources/ProjectInformation.plist`, both with a built-in binary plist reader. Changes to Alternatives are written with macOS's `/usr/bin/plutil`, which keeps the binary format.
- **Playback:** a Swift worker built on AVFoundation plays bounces as a detached process, so playback survives view changes and closing the Raycast window. The extension controls it through command and status files in its support folder. The player stops on its own when Raycast quits.
- **Analysis:** the same Swift package has an `analyzeAudio` function that streams the file in chunks and computes RMS, peak, spectral centroid, and spectral flux using a 2048-point FFT, without loading the whole file into memory.
