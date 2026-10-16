import Foundation
import CryptoKit
import Security

/// https with the server's own certificate authority (no domain, nothing bought).
/// The first time the app sees the authority it asks the user to check its fingerprint; after that only that
/// authority is accepted for that server (the same trust-on-first-use that SSH uses).
enum Pins {
    private static let key = "pins.v1"
    private static let lock = NSLock()
    private static var pending: [String: String] = [:]

    static var all: [String: String] {
        get { UserDefaults.standard.dictionary(forKey: key) as? [String: String] ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    /// "AA:BB:…" like the panel shows it
    static func fingerprint(_ cert: SecCertificate) -> String {
        let data = SecCertificateCopyData(cert) as Data
        return SHA256.hash(data: data).map { String(format: "%02X", $0) }.joined(separator: ":")
    }

    static func takePending(_ host: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        return pending.removeValue(forKey: host)
    }
    static func trust(host: String, fingerprint: String) { lock.lock(); var a = all; a[host] = fingerprint; all = a; lock.unlock() }
    static func forget(host: String) { lock.lock(); var a = all; a.removeValue(forKey: host); all = a; lock.unlock() }

    /// The decision for one server certificate: normal trust, or the pinned authority, or "ask the user".
    static func decide(_ ch: URLAuthenticationChallenge) -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        guard ch.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust, let trust = ch.protectionSpace.serverTrust else { return (.performDefaultHandling, nil) }
        if SecTrustEvaluateWithError(trust, nil) { return (.useCredential, URLCredential(trust: trust)) }
        let host = ch.protectionSpace.host
        let chain = (SecTrustCopyCertificateChain(trust) as? [SecCertificate]) ?? []
        if let pin = all[host], let ca = chain.first(where: { fingerprint($0) == pin }) {
            SecTrustSetAnchorCertificates(trust, [ca] as CFArray)
            SecTrustSetAnchorCertificatesOnly(trust, true)
            if SecTrustEvaluateWithError(trust, nil) { return (.useCredential, URLCredential(trust: trust)) }
        }
        // the server sends its leaf and then the authority: remember the authority so the user can be asked
        if chain.count > 1, let ca = chain.last { lock.lock(); pending[host] = fingerprint(ca); lock.unlock() }
        return (.cancelAuthenticationChallenge, nil)
    }
}

final class PinDelegate: NSObject, URLSessionDelegate {
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let (d, c) = Pins.decide(challenge)
        completionHandler(d, c)
    }
}

/// The one network session for every call to the door server.
enum Net {
    static let session = URLSession(configuration: .default, delegate: PinDelegate(), delegateQueue: nil)
}
