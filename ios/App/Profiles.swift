import SwiftUI
import Security
import UniformTypeIdentifiers

/// More than one door server: each with its own address and login (the password stays in the Keychain, apart for each server).
struct ServerProfile: Codable, Identifiable, Hashable {
    var id = UUID().uuidString
    var name: String
    var url: String
    var username: String
}

enum Profiles {
    private static let key = "servers.v1"
    static var all: [ServerProfile] {
        get { (UserDefaults.standard.data(forKey: key)).flatMap { try? JSONDecoder().decode([ServerProfile].self, from: $0) } ?? [] }
        set { UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: key) }
    }
    private static func service(_ id: String) -> String { Keychain.service + ".server." + id }

    private static func savePassword(_ pw: String, id: String, user: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service(id)]
        SecItemDelete(base as CFDictionary)
        var add = base; add[kSecAttrAccount as String] = user; add[kSecValueData as String] = Data(pw.utf8); add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        if SecItemAdd(add as CFDictionary, nil) != errSecSuccess { UserDefaults.standard.set(pw, forKey: "debug.pw." + id) }
    }
    private static func loadPassword(id: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service(id), kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        if SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let d = item as? Data { return String(data: d, encoding: .utf8) }
        return UserDefaults.standard.string(forKey: "debug.pw." + id)
    }

    /// The server and login that are active now, kept as a profile (or updated when it is already there).
    @discardableResult
    static func keepCurrent(name: String) -> ServerProfile? {
        guard let url = UserDefaults.standard.string(forKey: "serverURL"), let cred = Keychain.load() else { return nil }
        var list = all
        let p: ServerProfile
        if let i = list.firstIndex(where: { $0.url == url && $0.username == cred.username }) { list[i].name = name.isEmpty ? list[i].name : name; p = list[i] }
        else { p = ServerProfile(name: name.isEmpty ? (URL(string: url)?.host ?? url) : name, url: url, username: cred.username); list.append(p) }
        savePassword(cred.password, id: p.id, user: cred.username)
        all = list
        return p
    }
    static func isActive(_ p: ServerProfile) -> Bool { UserDefaults.standard.string(forKey: "serverURL") == p.url && Keychain.load()?.username == p.username }

    @MainActor static func activate(_ p: ServerProfile) {
        guard let pw = loadPassword(id: p.id) else { DoorStore.shared.show("Het wachtwoord van deze server is niet meer bewaard."); return }
        if let current = DoorApi.configured(), Keychain.load() != nil, !all.contains(where: { $0.url == current.base.absoluteString && $0.username == Keychain.load()?.username }) { keepCurrent(name: "") }
        _ = Keychain.save(username: p.username, password: pw)
        Keychain.deleteToken()
        UserDefaults.standard.set(p.url, forKey: "serverURL")
        DoorStore.shared.restart()
        DoorStore.shared.show("Verbonden met \(p.name)")
    }
    static func remove(_ p: ServerProfile) {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service(p.id)] as CFDictionary)
        UserDefaults.standard.removeObject(forKey: "debug.pw." + p.id)
        all = all.filter { $0.id != p.id }
    }
}

/// "Servers": switch between door servers, and see at once how each door is doing.
struct ServersView: View {
    @ObservedObject var store: DoorStore
    @State private var list = Profiles.all
    @State private var status: [String: (label: String, mode: String)] = [:]
    @State private var newName = ""

    var body: some View {
        Form {
            Section {
                if list.isEmpty { Text("Nog geen servers bewaard. Bewaar de huidige server om er later snel naar terug te kunnen.").foregroundStyle(.secondary) }
                ForEach(list) { p in
                    HStack(spacing: 10) {
                        Circle().fill(Palette.color(status[p.id]?.mode ?? "")).frame(width: 12, height: 12)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.name).font(.headline)
                            Text("\(p.url) · \(p.username)").font(.caption).foregroundStyle(.secondary)
                            if let s = status[p.id] { Text(s.label).font(.caption).foregroundStyle(.secondary) }
                        }
                        Spacer()
                        if Profiles.isActive(p) { Label("Actief", systemImage: "checkmark.circle.fill").foregroundStyle(Palette.open).font(.caption) }
                        else { Button("Wisselen") { Profiles.activate(p); list = Profiles.all }.buttonStyle(.borderless) }
                    }
                }
                .onDelete { idx in for i in idx { Profiles.remove(list[i]) }; list = Profiles.all }
            } header: { Text("Mijn deuren") }

            Section {
                TextField("Naam (bijv. Lokaal 2.14)", text: $newName)
                Button("Bewaar de huidige server") { Profiles.keepCurrent(name: newName); newName = ""; list = Profiles.all; Task { await refresh() } }
                    .disabled(DoorApi.configured() == nil)
            } footer: { Text("Alle bewaarde deuren staan hier met hun status. Tik op Wisselen om met een andere deur te werken.") }
        }
        .navigationTitle("Servers")
        .task { await refresh() }
        .refreshable { await refresh() }
    }

    private func refresh() async {
        for p in list {
            guard let base = DoorApi.normalize(p.url) else { continue }
            var req = URLRequest(url: base.appendingPathComponent("api/state")); req.timeoutInterval = 5
            if let (data, _) = try? await Net.session.data(for: req) {
                let j = JSON(try? JSONSerialization.jsonObject(with: data))
                status[p.id] = (j.view.label.str, j.view.mode.str)
            } else { status[p.id] = ("Niet bereikbaar", "") }
        }
    }
}

/// A short tour for the first start (and again when you ask).
struct HelpTour: View {
    @Environment(\.dismiss) private var dismiss
    @State private var page = 0
    private let pages: [(String, String, String)] = [
        ("door.left.hand.open", "De status zetten", "Tik op Open, Gesloten of Bezet. Kies erbij tot wanneer, en zet eventueel een bericht op de deur."),
        ("bell.fill", "Bezoekers", "Als iemand aanbelt of iets vraagt, zie je het hier meteen. Antwoord met één tik; het antwoord staat groot op de deur."),
        ("bolt.fill", "Snelle acties", "Maak je eigen knoppen, zoals “Lunch · 30 min · Bezet”, bij Instellingen → Snelle acties. Ook via Siri en Opdrachten."),
        ("lock.shield.fill", "Veilig", "Zet bij Instellingen → Account tweestapsverificatie aan, en kies of de app zich vergrendelt met Face ID of Touch ID."),
    ]
    var body: some View {
        VStack(spacing: 18) {
            TabView(selection: $page) {
                ForEach(Array(pages.enumerated()), id: \.offset) { i, p in
                    VStack(spacing: 14) {
                        Image(systemName: p.0).font(.system(size: 56)).foregroundStyle(Palette.accent)
                        Text(p.1).font(.title2.bold())
                        Text(p.2).multilineTextAlignment(.center).foregroundStyle(.secondary).padding(.horizontal, 24)
                    }.tag(i)
                }
            }
            #if os(iOS)
            .tabViewStyle(.page).indexViewStyle(.page(backgroundDisplayMode: .always))
            #endif
            HStack {
                if page > 0 { Button("Terug") { withAnimation { page -= 1 } } }
                Spacer()
                if page < pages.count - 1 { Button("Verder") { withAnimation { page += 1 } }.buttonStyle(.borderedProminent) }
                else { Button("Aan de slag") { UserDefaults.standard.set(true, forKey: "tour.done"); dismiss() }.buttonStyle(.borderedProminent) }
            }.padding(.horizontal, 24).padding(.bottom, 16)
        }
        .frame(minWidth: 320, minHeight: 360)
        .preferredColorScheme(.dark)
    }
}

/// Export and import of this app's own settings (quick actions, preferences, saved servers without passwords).
enum SettingsPorting {
    static let keys = [Pref.haptics, Pref.sounds, Pref.notifyVisits, Pref.badge, Pref.confirmStatus, Pref.confirmLockdown, Pref.showDuration, Pref.showExtend, Pref.showMessage, Pref.showToggles, Pref.showPlanner, Pref.largeButtons, Pref.statusColorTheme, Pref.compactInbox, Pref.autoSeen, Pref.autoLock, Pref.appearance, Pref.presets, Pref.startTab, Pref.accentHex, ExtraPref.quietOn, ExtraPref.quietFrom, ExtraPref.quietTo]
    static func export() -> Data {
        var out: [String: Any] = [:]
        for k in keys { if let v = UserDefaults.standard.object(forKey: k) { out[k] = v } }
        out["quick"] = (try? JSONEncoder().encode(QuickStore.load())).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        out["servers"] = Profiles.all.map { ["name": $0.name, "url": $0.url, "username": $0.username] }
        out["format"] = "saga-deur-app-1"
        return (try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])) ?? Data()
    }
    @discardableResult
    static func `import`(_ data: Data) -> Bool {
        guard let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], o["format"] as? String == "saga-deur-app-1" else { return false }
        for k in keys { if let v = o[k] { UserDefaults.standard.set(v, forKey: k) } }
        if let q = o["quick"] as? String, let d = q.data(using: .utf8), let list = try? JSONDecoder().decode([QuickPreset].self, from: d) { QuickStore.save(list) }
        if let s = o["servers"] as? [[String: String]] {
            var list = Profiles.all
            for e in s { if let n = e["name"], let u = e["url"], let us = e["username"], !list.contains(where: { $0.url == u && $0.username == us }) { list.append(ServerProfile(name: n, url: u, username: us)) } }
            Profiles.all = list
        }
        return true
    }
}

struct SettingsFile: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data = Data()
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
