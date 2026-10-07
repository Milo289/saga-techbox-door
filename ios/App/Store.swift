import SwiftUI
import UserNotifications

struct EventLine: Identifiable {
    let id = UUID()
    let at = Date()
    let kind: String
    let text: String
}

/// All data of the door server, kept live through the same stream the web panel uses.
@MainActor
final class DoorStore: ObservableObject {
    static let shared = DoorStore()

    enum Connection: Equatable { case idle, connecting, live, offline(String) }

    @Published private(set) var state = JSON(nil)
    @Published private(set) var hasState = false
    @Published private(set) var connection: Connection = .idle
    @Published private(set) var events: [EventLine] = []
    @Published private(set) var lastLatencyMs: Int?
    @Published var banner: String?

    private var token: String?
    private var stream: Task<Void, Never>?
    private var running = false
    private var bannerTask: Task<Void, Never>?
    var token_: String? { token }

    var base: URL? { DoorApi.configured()?.base }

    // MARK: derived values
    var name: String { state.settings.name.string ?? "Deur" }
    var mode: String { state.view.mode.str }
    var label: String { state.view.label.str }
    var until: Date? { state.view.until.date }
    var message: String { state.view.message.str }
    var source: String { state.view.source.str }
    var perms: [String] { state.me.perms.strings }
    func can(_ p: String) -> Bool { perms.contains(p) }
    var requests: [VisitRequest] { state.requests.array.map(VisitRequest.init).sorted { $0.createdAt > $1.createdAt } }
    var openRequests: [VisitRequest] { requests.filter(\.isOpen) }
    var newCount: Int { requests.filter { $0.state == "new" }.count }
    var busy: [BusyBlock] { state.busy.array.map(BusyBlock.init) }
    var history: [HistoryLine] { state.history.array.map(HistoryLine.init) }
    var quickReplies: [String] { state.settings.quickReplies.strings }
    var isMaintenance: Bool { state.system.maintenance.bool }

    // MARK: connection
    func start() {
        guard !running, base != nil else { return }
        running = true
        stream = Task { await loop() }
    }

    func stop() {
        running = false
        stream?.cancel(); stream = nil
        if connection != .idle { connection = .idle }
    }

    func restart() { stop(); token = nil; start() }

    func forget() {
        stop(); token = nil; state = JSON(nil); hasState = false; events = []
    }

    private func loop() async {
        var failures = 0
        while running && !Task.isCancelled {
            do {
                connection = .connecting
                try await ensureToken()
                try await refresh()
                try await listen()
                failures = 0
            } catch is CancellationError {
                break
            } catch let f as DoorApi.Failure {
                if case .wrongLogin = f { connection = .offline("Inloggen mislukt — controleer je gegevens"); running = false; break }
                connection = .offline(f.localizedDescription)
                failures += 1
            } catch {
                connection = .offline("Geen verbinding met de deurserver")
                failures += 1
            }
            if !running { break }
            try? await Task.sleep(nanoseconds: UInt64(min(30, 2 + failures * 3)) * 1_000_000_000)
        }
    }

    private func ensureToken() async throws {
        if token != nil { return }
        guard let api = DoorApi.configured() else { throw DoorApi.Failure.noServer }
        token = try await api.session()
        log("login", "Ingelogd")
    }

    private func request(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> (Int, Data) {
        guard let base else { throw DoorApi.Failure.noServer }
        var req = URLRequest(url: base.appendingPathComponent(path))
        req.httpMethod = method
        req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let t0 = Date()
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            lastLatencyMs = Int(Date().timeIntervalSince(t0) * 1000)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if UserDefaults.standard.bool(forKey: Pref.verboseLog) { log("api", "\(method) \(path) → \(code) (\(lastLatencyMs ?? 0) ms)") }
            return (code, data)
        } catch { throw DoorApi.Failure.offline }
    }

    /// One call to the server with your own login. Logs in again once if the session ended.
    @discardableResult
    func call(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> JSON {
        try await ensureToken()
        var (code, data) = try await request(method, path, body: body)
        if code == 401 { token = nil; try await ensureToken(); (code, data) = try await request(method, path, body: body) }
        let json = JSON(try? JSONSerialization.jsonObject(with: data))
        if code >= 400 { throw DoorApi.Failure.server(json.error.string ?? "Dat lukte niet (\(code)).") }
        return json
    }

    /// A change on the server. Refreshes the data afterwards so the screen is right at once.
    @discardableResult
    func post(_ path: String, _ body: [String: Any] = [:]) async throws -> JSON {
        let out = try await call("POST", path, body: body)
        log("actie", path)
        try? await refresh()
        return out
    }

    func refresh() async throws {
        let json = try await call("GET", "api/admin-state")
        state = json; hasState = true
        if connection != .live { connection = .live }
    }

    // MARK: live stream
    private func listen() async throws {
        guard let base, let token else { return }
        var comps = URLComponents(url: base.appendingPathComponent("events"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "role", value: "admin"), URLQueryItem(name: "token", value: token)]
        var req = URLRequest(url: comps.url!)
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 60 * 60
        let (bytes, resp) = try await URLSession.shared.bytes(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 { self.token = nil; throw DoorApi.Failure.offline }
        if code != 200 { throw DoorApi.Failure.server("De live verbinding gaf een fout (\(code)).") }
        connection = .live
        log("verbinding", "Live")
        var event = "message", dataLine = ""
        for try await line in bytes.lines {
            if Task.isCancelled { return }
            if line.hasPrefix("event:") { event = line.dropFirst(6).trimmingCharacters(in: .whitespaces) }
            else if line.hasPrefix("data:") { dataLine += line.dropFirst(5).trimmingCharacters(in: .whitespaces) }
            else if line.isEmpty {
                if !dataLine.isEmpty || event != "message" { handle(event: event, data: dataLine) }
                event = "message"; dataLine = ""
            }
        }
        log("verbinding", "Gesloten door de server")
    }

    var onVisit: ((VisitRequest) -> Void)?
    var onRing: (() -> Void)?

    private func handle(event: String, data: String) {
        let json = JSON(try? JSONSerialization.jsonObject(with: Data(data.utf8)))
        switch event {
        case "state": state = json; hasState = true; if UserDefaults.standard.bool(forKey: Pref.verboseLog) { log("state", "Bijgewerkt") }
        case "visit": log("bezoek", VisitRequest(json).summary); onVisit?(VisitRequest(json))
        case "ring": log("bel", "Er is aangebeld"); onRing?()
        case "ping": break
        default: log(event, String(data.prefix(120)))
        }
    }

    func log(_ kind: String, _ text: String) {
        events.insert(EventLine(kind: kind, text: text), at: 0)
        if events.count > 300 { events.removeLast(events.count - 300) }
    }

    func clearLog() { events = [] }

    // MARK: messages on screen
    func show(_ text: String) {
        banner = text
        bannerTask?.cancel()
        bannerTask = Task { try? await Task.sleep(nanoseconds: 3_200_000_000); if !Task.isCancelled { banner = nil } }
    }

    // MARK: actions
    func setStatus(_ mode: String, minutes: Int? = nil, until: Date? = nil) async {
        var body: [String: Any] = ["mode": mode]
        if let minutes { body["minutes"] = minutes }
        if let until { body["until"] = ms(until) }
        await run("De deur staat op \(DoorModeKind(rawValue: mode)?.label ?? mode)") { _ = try await self.post("api/status", body) }
    }

    /// Runs a change, with feedback (haptics and a message).
    func run(_ okText: String, _ work: @escaping () async throws -> Void) async {
        do { try await work(); Haptics.success(); show(okText) }
        catch { Haptics.error(); show(error.localizedDescription) }
    }

    /// Changes one block of the server's settings (e.g. "visitors") and sends the whole block back.
    func changeSetting(_ key: String, _ field: String, _ value: Any) async {
        var block = state.settings[key].dict
        block[field] = value
        await run("Opgeslagen") { _ = try await self.post("api/settings", [key: block]) }
    }

    func setNote(_ note: String) async {
        await run(note.isEmpty ? "Bericht gewist" : "Bericht staat op de deur") { _ = try await self.post("api/settings", ["note": note]) }
    }
}
