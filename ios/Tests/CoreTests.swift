import XCTest
import Security
@testable import DeurBeheer

final class CoreTests: XCTestCase {
    func testAddressIsNormalised() {
        XCTAssertEqual(DoorApi.normalize("192.168.1.50:8080")?.absoluteString, "http://192.168.1.50:8080")
        XCTAssertEqual(DoorApi.normalize(" https://deur.local/ ")?.absoluteString, "https://deur.local")
        XCTAssertNil(DoorApi.normalize("   "))
    }

    func testJSONReadsWhatIsThereAndSurvivesWhatIsNot() {
        let j = JSON(try? JSONSerialization.jsonObject(with: Data(#"{"a":{"b":[1,2,3],"c":"x","d":true},"t":1700000000000}"#.utf8)))
        XCTAssertEqual(j.a.b.array.count, 3)
        XCTAssertEqual(j.a.c.str, "x")
        XCTAssertTrue(j.a.d.bool)
        XCTAssertEqual(j.nothing.deeper.str, "")
        XCTAssertNil(j.nothing.int)
        XCTAssertEqual(j.t.date?.timeIntervalSince1970, 1_700_000_000)
    }

    func testRightsInPlainLanguage() {
        let s = Plain.sentences(["view", "status"])
        XCTAssertEqual(s.count, 2)
        XCTAssertTrue(s.contains("De status op de deur wijzigen"))
        XCTAssertFalse(Plain.missing(["view"]).contains("Systeembeheer (alleen het hoofdaccount)"))
        XCTAssertTrue(Plain.missing(["view"]).contains("Gebruikers beheren"))
    }

    func testCertificateFingerprintMatchesOpenssl() throws {
        let der = Data(base64Encoded: "MIIBdDCCARmgAwIBAgIUHwcCewSN7de7BnLSNmjAw6JP9IswCgYIKoZIzj0EAwIwDzENMAsGA1UEAwwEdGVzdDAeFw0yNjEwMTYxNDM2MTVaFw0yNjExMTUxNDM2MTVaMA8xDTALBgNVBAMMBHRlc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQQRdz13+qmiCKD7ed+xZG3QbOBQb7ft+w1/NI8WPe9RnG6jJ4AgP0ggU7gu8DPEAo9mJuXnZZ1gbE4iEfdJtueo1MwUTAdBgNVHQ4EFgQU3wRkv5fhJVjegQBobHf5hf3e7lIwHwYDVR0jBBgwFoAU3wRkv5fhJVjegQBobHf5hf3e7lIwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNJADBGAiEAxBTGq2TYeZke+lTxEsVJPfMu9gMSCNODtx2jhoqJjp8CIQD1doTR9Pz8ZzAl8UfR+xPozGvDVhujgVohSGYI6QBZKA==")!
        let cert = try XCTUnwrap(SecCertificateCreateWithData(nil, der as CFData))
        XCTAssertEqual(Pins.fingerprint(cert), "BB:7B:AB:89:C4:4C:70:F8:13:A5:30:C1:F2:4D:21:5C:42:94:43:2C:21:F1:54:F9:F4:06:E9:38:54:52:B5:BB")
    }

    func testTrustIsRememberedPerServer() {
        Pins.forget(host: "test.invalid")
        XCTAssertNil(Pins.all["test.invalid"])
        Pins.trust(host: "test.invalid", fingerprint: "AA:BB")
        XCTAssertEqual(Pins.all["test.invalid"], "AA:BB")
        Pins.forget(host: "test.invalid")
        XCTAssertNil(Pins.all["test.invalid"])
    }

    func testQuickActionsRoundTrip() {
        let old = QuickStore.load()
        defer { QuickStore.save(old) }
        QuickStore.save([QuickPreset(name: "Test", mode: "busy", minutes: 5, message: "hoi", symbol: "bolt.fill")])
        XCTAssertEqual(QuickStore.load().first?.name, "Test")
        XCTAssertEqual(QuickStore.load().count, 1)
    }

    func testSettingsExportAndImport() {
        let d = UserDefaults.standard
        let before = d.object(forKey: Pref.presets)
        defer { if let before { d.set(before, forKey: Pref.presets) } else { d.removeObject(forKey: Pref.presets) } }
        d.set("5,10", forKey: Pref.presets)
        let data = SettingsPorting.export()
        XCTAssertFalse(String(decoding: data, as: UTF8.self).lowercased().contains("password"))
        d.set("1,2", forKey: Pref.presets)
        XCTAssertTrue(SettingsPorting.import(data))
        XCTAssertEqual(d.string(forKey: Pref.presets), "5,10")
        XCTAssertFalse(SettingsPorting.import(Data("{}".utf8)), "a file of another kind is refused")
    }

    func testErrorsAreInPlainDutch() {
        XCTAssertEqual(DoorApi.Failure.offline.errorDescription, "Geen verbinding met de deurserver.")
        XCTAssertNotNil(DoorApi.Failure.needs2fa("x").errorDescription)
        XCTAssertNotNil(DoorApi.Failure.untrusted(host: "h", fingerprint: "f").errorDescription)
    }
}
