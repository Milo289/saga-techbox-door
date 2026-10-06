import Foundation

/// Talks to the door server directly (used by quick actions and Siri / Shortcuts, without the web page).
struct DoorApi {
    enum Failure: LocalizedError {
        case noServer, noLogin, wrongLogin, blocked(String), server(String), offline
        var errorDescription: String? {
            switch self {
            case .noServer: return "Er is nog geen server ingesteld."
            case .noLogin: return "Er is nog geen inlog opgeslagen."
            case .wrongLogin: return "Gebruikersnaam of wachtwoord klopt niet."
            case .blocked(let m): return m
            case .server(let m): return m
            case .offline: return "Geen verbinding met de deurserver."
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
            let (data, resp) = try await URLSession.shared.data(for: req)
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            return ((resp as? HTTPURLResponse)?.statusCode ?? 0, json)
        } catch { throw Failure.offline }
    }

    func login(username: String, password: String) async throws -> String {
        let (code, json) = try await request("api/login", method: "POST", body: ["username": username, "password": password, "remember": true])
        if code == 200, let token = json["token"] as? String { return token }
        if code == 401 { throw Failure.wrongLogin }
        throw Failure.blocked((json["error"] as? String) ?? "Inloggen lukte niet (\(code)).")
    }

    /// Logs in with the login stored in the Keychain.
    func session() async throws -> String {
        guard let cred = Keychain.load() else { throw Failure.noLogin }
        return try await login(username: cred.username, password: cred.password)
    }

    private func post(_ path: String, _ body: [String: Any] = [:]) async throws {
        let token = try await session()
        let (code, json) = try await request(path, method: "POST", token: token, body: body)
        if code != 200 { throw Failure.server((json["error"] as? String) ?? "Dat lukte niet (\(code)).") }
        _ = try? await request("api/logout", method: "POST", token: token) // quick actions don't leave sessions behind
    }

    func setStatus(_ mode: String) async throws { try await post("api/status", ["mode": mode]) }
    func lockdown() async throws { try await post("api/system/lockdown") }
    func unlock() async throws { try await post("api/system/unlock") }
}
