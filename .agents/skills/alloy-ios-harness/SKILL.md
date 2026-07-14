---
name: alloy-ios-harness
description: Use when asked to run, launch, test, or screenshot the Alloy apple-harness on the iOS simulator, or to verify an AlloyUI/AlloyAudio/AlloyStorage change visually on iPhone. Covers xcodegen, xcodebuild, simctl boot/install/launch, and screenshot verification.
---

# Run the apple-harness in the iOS simulator

Build the SwiftUI preview harness as an iOS app and launch it in the
simulator. All commands run from `examples/apple-harness/`. The macOS
variant needs none of this — it's just `swift run AlloyHarness`.

## Steps

1. **Ensure the project exists** (it's gitignored; regenerate freely —
   required after any `project.yml` change):

   ```sh
   which xcodegen || brew install xcodegen
   xcodegen generate
   ```

2. **Build with a pinned derived-data path** — this makes the .app path
   deterministic instead of hunting through `~/Library/Developer/…`:

   ```sh
   xcodebuild -project AlloyHarnessIOS.xcodeproj -scheme AlloyHarnessIOS \
     -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
     -derivedDataPath .build-ios build
   ```

   The app lands at `.build-ios/Build/Products/Debug-iphonesimulator/AlloyHarnessIOS.app`.
   (Any available iPhone works; list with `xcrun simctl list devices available`.)

3. **Boot, install, launch** (bundle id `world.ally.AlloyHarnessIOS`):

   ```sh
   xcrun simctl boot "iPhone 17 Pro" 2>/dev/null; open -a Simulator
   xcrun simctl bootstatus "iPhone 17 Pro" -b
   xcrun simctl install "iPhone 17 Pro" .build-ios/Build/Products/Debug-iphonesimulator/AlloyHarnessIOS.app
   xcrun simctl terminate "iPhone 17 Pro" world.ally.AlloyHarnessIOS 2>/dev/null || true
   xcrun simctl launch "iPhone 17 Pro" world.ally.AlloyHarnessIOS
   ```

   `boot` on an already-booted device errors harmlessly. The `terminate`
   matters when re-launching after a rebuild — `launch` alone won't replace
   a running instance's code.

4. **Verify with a screenshot** — a returned PID is not proof the UI
   rendered:

   ```sh
   xcrun simctl io "iPhone 17 Pro" screenshot /absolute/path/shot.png
   ls -l /absolute/path/shot.png
   ```

   Use an absolute path and `ls` it afterwards: `simctl screenshot` can
   fail silently (prints "Detected file type 'PNG'" but writes nothing) on
   a malformed path. Then read the PNG to confirm real content, not a
   blank screen.

## Gotchas

- "Unable to lookup in current state: Shutdown" from `install`/`launch`
  means the simulator was shut down (e.g. user quit Simulator.app) —
  rerun step 3 from `boot`.
- The Storage demo's Google Drive card needs OAuth constants filled in
  `Sources/AlloyHarness/StorageDemoView.swift` (see its header comment);
  the Local card works with no setup.
- Rebuild loop after editing harness or library sources: step 2 → install →
  terminate → launch (step 1 only if `project.yml` changed).
