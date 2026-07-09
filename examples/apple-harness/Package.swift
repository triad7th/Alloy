// swift-tools-version: 6.0
// Preview harness for Alloy on Apple platforms — a macOS SwiftUI app run
// with `swift run AlloyHarness` (no Xcode project needed). macOS exercises
// the same Liquid Glass AlloyUI and AVAudioEngine AlloyAudio code paths as
// iOS; HarnessRootView is structured to drop into an iOS app target
// unchanged if a device-preview project is added later. Never released.
import PackageDescription

let package = Package(
  name: "AlloyHarness",
  platforms: [.macOS("26.0")],
  dependencies: [
    .package(name: "Alloy", path: "../..")
  ],
  targets: [
    .executableTarget(
      name: "AlloyHarness",
      dependencies: [
        .product(name: "AlloyTime", package: "Alloy"),
        .product(name: "AlloyUI", package: "Alloy"),
        .product(name: "AlloyAudio", package: "Alloy"),
      ],
      path: "Sources/AlloyHarness"
    )
  ]
)
