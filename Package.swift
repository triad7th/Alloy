// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "Alloy",
  platforms: [.iOS(.v17), .tvOS(.v17), .watchOS(.v10), .macOS(.v14)],
  products: [
    .library(name: "AlloyTime", targets: ["AlloyTime"]),
    .library(name: "AlloyUI", targets: ["AlloyUI"]),
    .library(name: "AlloyAudio", targets: ["AlloyAudio"]),
  ],
  targets: [
    .target(name: "AlloyTime", path: "swift/Sources/AlloyTime"),
    .testTarget(name: "AlloyTimeTests", dependencies: ["AlloyTime"],
                path: "swift/Tests/AlloyTimeTests"),
    .target(name: "AlloyUI", path: "swift/Sources/AlloyUI"),
    .testTarget(name: "AlloyUITests", dependencies: ["AlloyUI"],
                path: "swift/Tests/AlloyUITests"),
    .target(name: "AlloyAudio", path: "swift/Sources/AlloyAudio"),
    .testTarget(name: "AlloyAudioTests", dependencies: ["AlloyAudio"],
                path: "swift/Tests/AlloyAudioTests"),
  ]
)
