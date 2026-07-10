import Testing
@testable import AlloyStorage

@Suite struct PKCETests {
  @Test func matchesRFC7636AppendixBVector() {
    // Twin fixture: web .../auth/pkce.spec.ts
    #expect(
      PKCE.codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  }

  @Test func generatesUniqueBase64urlVerifiers() {
    let a = PKCE.generateCodeVerifier()
    let b = PKCE.generateCodeVerifier()
    #expect(a.count == 64 && a != b)
    #expect(a.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
  }
}
