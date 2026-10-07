import SwiftUI
import UserNotifications

/// Only in the developer app (or after switching developer mode on): the inside of the app and the server.
struct DeveloperView: View {
    @ObservedObject var store: DoorStore
    @AppStorage(Pref.verboseLog) private var verbose = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Verbinding") {
                    kv("Server", store.base?.absoluteString ?? "—")
                    kv("Status", connectionText)
                    kv("Reactietijd", store.lastLatencyMs.map { "\($0) ms" } ?? "—")
                    kv("Sessiesleutel", store.token_.map { String($0.prefix(10)) + "…" } ?? "geen")
                    kv("Server-versie", store.state.server.version.string ?? "—")
                    kv("Rechten", store.perms.joined(separator: ", "))
                    Button("Gegevens nu verversen") { Task { try? await store.refresh(); store.show("Ververst") } }
                    Button("Opnieuw verbinden") { store.restart() }
                }
                Section("Hulpmiddelen") {
                    NavigationLink { EventLogView(store: store) } label: { Label("Live gebeurtenissen (\(store.events.count))", systemImage: "list.bullet.rectangle") }
                    NavigationLink { RawStateView(store: store) } label: { Label("Ruwe gegevens van de server", systemImage: "curlybraces") }
                    NavigationLink { ApiConsoleView(store: store) } label: { Label("API-console", systemImage: "terminal") }
                    Toggle("Elke API-aanroep loggen", isOn: $verbose)
                }
                Section("Testen") {
                    Button("Lokale melding sturen") { notify("Test", "Zo ziet een melding eruit.") }
                    Button("Bezoekersmelding nabootsen") { Sounds.message(); Haptics.success(); notify("Nieuw: Vraagje", "Sam — Wifi werkt niet"); store.log("test", "Bezoek nagebootst") }
                    Button("Bel nabootsen") { Sounds.bell(); Haptics.heavy(); store.show("Er is aangebeld"); store.log("test", "Bel nagebootst") }
                    Button("Alle trilpatronen") { Task { for f in [Haptics.tap, Haptics.success, Haptics.warning, Haptics.error, Haptics.heavy] { f(); try? await Task.sleep(nanoseconds: 450_000_000) } } }
                    Button("Gebeurtenissen wissen") { store.clearLog() }
                }
                Section("Omgeving") {
                    kv("Apparaat", UIDevice.current.model)
                    kv("iOS", UIDevice.current.systemVersion)
                    kv("App-id", Bundle.main.bundleIdentifier ?? "—")
                    kv("Versie", "\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?") (\(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"))")
                    kv("Soort bouwsel", Build.configuration + (Build.isDeveloperApp ? " · ontwikkelaarsapp" : ""))
                }
                Section("Gevaarlijk") {
                    Button("Alle app-instellingen terugzetten", role: .destructive) {
                        for k in UserDefaults.standard.dictionaryRepresentation().keys where k.hasPrefix("p.") { UserDefaults.standard.removeObject(forKey: k) }
                        UserDefaults.standard.registerAppDefaults(); store.show("Teruggezet")
                    }
                }
            }
            .scrollContentBackground(.hidden).background(Color.black.ignoresSafeArea())
            .navigationTitle("Ontwikkelaar")
        }
    }

    private var connectionText: String {
        switch store.connection { case .idle: return "uit"; case .connecting: return "verbinden"; case .live: return "live"; case .offline(let m): return "offline — \(m)" }
    }

    private func kv(_ k: String, _ v: String) -> some View {
        HStack(alignment: .top) { Text(k); Spacer(); Text(v).foregroundStyle(.secondary).multilineTextAlignment(.trailing).textSelection(.enabled) }
    }

    private func notify(_ title: String, _ body: String) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            let c = UNMutableNotificationContent(); c.title = title; c.body = body; c.sound = .default
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 2, repeats: false)))
        }
        store.show("Melding komt over 2 seconden — ga naar het beginscherm om hem te zien")
    }
}

struct EventLogView: View {
    @ObservedObject var store: DoorStore
    @State private var filter = ""
    private var lines: [EventLine] { filter.isEmpty ? store.events : store.events.filter { "\($0.kind) \($0.text)".localizedCaseInsensitiveContains(filter) } }
    var body: some View {
        List(lines) { e in
            VStack(alignment: .leading, spacing: 2) {
                HStack { Text(e.kind.uppercased()).font(.caption2.bold()).foregroundStyle(Palette.open); Spacer(); Text(e.at.formatted(date: .omitted, time: .standard)).font(.caption2).foregroundStyle(.secondary) }
                Text(e.text).font(.system(.footnote, design: .monospaced))
            }
        }
        .scrollContentBackground(.hidden).background(Color.black.ignoresSafeArea())
        .searchable(text: $filter, prompt: "Filter")
        .navigationTitle("Gebeurtenissen")
        .toolbar { Button("Wissen") { store.clearLog() } }
    }
}

struct RawStateView: View {
    @ObservedObject var store: DoorStore
    @State private var part = "view"
    private let parts = ["view", "settings", "requests", "busy", "me", "server", "system", "history", "people"]
    var body: some View {
        VStack(spacing: 0) {
            Picker("Deel", selection: $part) { ForEach(parts, id: \.self) { Text($0).tag($0) } }.pickerStyle(.menu).padding(8)
            ScrollView {
                Text(store.state[part].pretty).font(.system(.caption, design: .monospaced)).frame(maxWidth: .infinity, alignment: .leading).padding(12).textSelection(.enabled)
            }
        }
        .background(Color.black.ignoresSafeArea())
        .navigationTitle("Ruwe gegevens")
        .toolbar { Button { UIPasteboard.general.string = store.state[part].pretty; store.show("Gekopieerd") } label: { Image(systemName: "doc.on.doc") } }
    }
}

struct ApiConsoleView: View {
    @ObservedObject var store: DoorStore
    @State private var method = "GET"
    @State private var path = "api/admin-state"
    @State private var body_ = ""
    @State private var output = ""
    @State private var busy = false

    var body: some View {
        Form {
            Section("Aanroep") {
                Picker("Methode", selection: $method) { Text("GET").tag("GET"); Text("POST").tag("POST") }.pickerStyle(.segmented)
                TextField("pad, bijv. api/status", text: $path).textInputAutocapitalization(.never).autocorrectionDisabled()
                if method == "POST" {
                    TextEditor(text: $body_).font(.system(.footnote, design: .monospaced)).frame(minHeight: 90)
                        .overlay(alignment: .topLeading) { if body_.isEmpty { Text("{\"mode\":\"open\"}").font(.system(.footnote, design: .monospaced)).foregroundStyle(.secondary).padding(.top, 8).padding(.leading, 5).allowsHitTesting(false) } }
                }
                Button { send() } label: { HStack { if busy { ProgressView() }; Text("Versturen") } }.disabled(busy || path.isEmpty)
            }
            if !output.isEmpty {
                Section("Antwoord") {
                    Text(output).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                    Button("Kopiëren") { UIPasteboard.general.string = output }
                }
            }
        }
        .scrollContentBackground(.hidden).background(Color.black.ignoresSafeArea())
        .navigationTitle("API-console")
    }

    private func send() {
        busy = true
        Task {
            defer { busy = false }
            let t0 = Date()
            var body: [String: Any]?
            if method == "POST", !body_.trimmingCharacters(in: .whitespaces).isEmpty {
                guard let d = body_.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { output = "De body is geen geldige JSON."; return }
                body = o
            }
            do {
                let clean = path.hasPrefix("/") ? String(path.dropFirst()) : path
                let out = try await store.call(method, clean, body: method == "POST" ? (body ?? [:]) : nil)
                output = "OK · \(Int(Date().timeIntervalSince(t0) * 1000)) ms\n\n" + out.pretty
            } catch { output = "Fout: \(error.localizedDescription)" }
            store.log("api", "\(method) \(path)")
        }
    }
}
