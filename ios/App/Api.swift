import Foundation

/// Talks to the door server directly (used by quick actions and Siri / Shortcuts, without the web page).
struct DoorApi {
    enum Failure: LocalizedError {
        case noServer, noLogin, wrongLogin, blocked(String), server(String), offline, needs2fa(String), untrusted(host: String, fingerprint: String)
        var errorDescription: String? {
            switch self {
            case .noServer: return "Er is nog geen server ingesteld."
            case .noLogin: return "Er is nog geen inlog opgeslagen."
            case .wrongLogin: return "Gebruikersnaam of wachtwoord klopt niet."
            case .blocked(let m): return m
            case .server(let m): return m
            case .offline: return "Geen verbinding met de deurserver."
            case .needs2fa: return "Er is een code uit je verificatie-app nodig."
            case .untrusted: return "Het certificaat van de server is nog niet vertrouwd."
            }
        }
    }

    let base: URL

    static func configured() -> DoorApi? {
        guard let s = UserDefaults.standard.string(forKey: "serverURL"), let url = DoorApi.normalize(s) else { return nil }
        return DoorApi(base: url)
    }

    /// "192.168.1.50:8080" → http://192.168.1.50:8080
    static func normalize(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if !s.lowercased().hasPrefix("http://") && !s.lowercased().hasPrefix("https://") { s = "http://" + s }
        while s.hasSuffix("/") { s.removeLast() }
        guard let url = URL(string: s), url.host != nil else { return nil }
        return url
    }

    private func request(_ path: String, method: String = "GET", token: String? = nil, body: [String: Any]? = nil) async throws -> (Int, [String: Any]) {
        var req = URLRequest(url: base.appendingPathComponent(path))
        req.httpMethod = method
        req.timeoutInterval = 12
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        do {
            let (data, resp) = try await Net.session.data(for: req)
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            return ((resp as? HTTPURLResponse)?.statusCode ?? 0, json)
        } catch {
            if let host = req.url?.host, let fp = Pins.takePending(host) { throw Failure.untrusted(host: host, fingerprint: fp) }
            throw Failure.offline
        }
    }

    func login(username: String, password: String) async throws -> String {
        let (code, json) = try await request("api/login", method: "POST", body: ["username": username, "password": password, "remember": true])
        if code == 200, let token = json["token"] as? String { return token }
        if code == 200, json["needs2fa"] as? Bool == true, let mfa = json["mfa"] as? String { throw Failure.needs2fa(mfa) }
        if code == 401 { throw Failure.wrongLogin }
        throw Failure.blocked((json["error"] as? String) ?? "Inloggen lukte niet (\(code)).")
    }

    /// The second step: the code from the verification app (or a recovery code).
    func finish2fa(mfa: String, code: String) async throws -> String {
        let (status, json) = try await request("api/login/2fa", method: "POST", body: ["mfa": mfa, "code": code])
        if status == 200, let token = json["token"] as? String { return token }
        throw Failure.blocked((json["error"] as? String) ?? "Die code werkt niet (\(status)).")
    }

    /// Only checks that the password is right (a code that is still needed counts as right).
    func verify(username: String, password: String) async throws {
        do { _ = try await login(username: username, password: password) } catch Failure.needs2fa { }
    }

    /// The saved session key if the server still accepts it; otherwise a new login with the login stored in the Keychain.
    func session() async throws -> String {
        if let saved = Keychain.loadToken() {
            let (code, _) = try await request("api/me", token: saved)
            if code == 200 { return saved }
        }
        guard let cred = Keychain.load() else { throw Failure.noLogin }
        let token = try await login(username: cred.username, password: cred.password)
        Keychain.saveToken(token)
        return token
    }

    private func post(_ path: String, _ body: [String: Any] = [:]) async throws {
        let token = try await session()
        let (code, json) = try await request(path, method: "POST", token: token, body: body)
        if code != 200 { throw Failure.server((json["error"] as? String) ?? "Dat lukte niet (\(code)).") }
        if Keychain.loadToken() != token { _ = try? await request("api/logout", method: "POST", token: token) } // quick actions don't leave sessions behind (the saved key stays)
    }

    func setStatus(_ mode: String) async throws { try await post("api/status", ["mode": mode]) }
    func lockdown() async throws { try await post("api/system/lockdown") }
    func unlock() async throws { try await post("api/system/unlock") }
}
