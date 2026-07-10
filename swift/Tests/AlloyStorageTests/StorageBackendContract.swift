import Foundation
import Testing
@testable import AlloyStorage

/// Twin of web .../backends/storage-backend.contract.ts — same scenarios, same instants.
let contractT1 = Date(timeIntervalSince1970: 1_751_980_000)
let contractT2 = Date(timeIntervalSince1970: 1_751_990_000)

func runStorageBackendContract(_ make: () async throws -> any StorageBackend) async throws {
  // write then read round-trips
  var b = try await make()
  try await b.write(StorageRecord(id: "a", name: "a.json", updatedAt: contractT1, payload: #"{"v":1}"#))
  var got = try await b.read(id: "a")
  #expect(got?.id == "a" && got?.name == "a.json" && got?.payload == #"{"v":1}"#)
  #expect(got?.updatedAt == contractT1)

  // read of a missing id resolves nil
  b = try await make()
  #expect(try await b.read(id: "nope") == nil)

  // list returns metadata for every record
  b = try await make()
  try await b.write(StorageRecord(id: "a", name: "a.json", updatedAt: contractT1, payload: "x"))
  try await b.write(StorageRecord(id: "b", name: "b.json", updatedAt: contractT2, payload: "y"))
  let metas = try await b.list()
  #expect(metas.map(\.id).sorted() == ["a", "b"])

  // write replaces an existing record
  b = try await make()
  try await b.write(StorageRecord(id: "a", name: "a.json", updatedAt: contractT1, payload: "old"))
  try await b.write(StorageRecord(id: "a", name: "renamed.json", updatedAt: contractT2, payload: "new"))
  got = try await b.read(id: "a")
  #expect(got?.name == "renamed.json" && got?.payload == "new" && got?.updatedAt == contractT2)
  #expect(try await b.list().count == 1)

  // delete removes and is idempotent
  b = try await make()
  try await b.write(StorageRecord(id: "a", name: "a.json", updatedAt: contractT1, payload: "x"))
  try await b.delete(id: "a")
  #expect(try await b.read(id: "a") == nil)
  try await b.delete(id: "a") // absent id: no throw
}
