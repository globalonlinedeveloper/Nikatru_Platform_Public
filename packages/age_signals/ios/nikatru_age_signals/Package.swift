// swift-tools-version: 5.9
// [ADR 082] §5 — the Apple Declared Age Range adapter (DeclaredAgeRange is a system
// framework, iOS 26+; the source guards it with #if canImport and #available).

import PackageDescription

let package = Package(
  name: "nikatru_age_signals",
  platforms: [
    .iOS("13.0")
  ],
  products: [
    .library(name: "nikatru-age-signals", targets: ["nikatru_age_signals"])
  ],
  dependencies: [],
  targets: [
    .target(
      name: "nikatru_age_signals",
      dependencies: []
    )
  ]
)
