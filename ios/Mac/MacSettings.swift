import SwiftUI
import ServiceManagement

/// Settings (⌘,): account and server, what the app does on this Mac, looks.
struct MacSettings: View {
    @ObservedObject var store: DoorStore
    @AppStorage(Pref.notifyVisits) private var notifyVisits = true
    @AppStorage(Pref.sounds) private var sounds = true
    @AppStorage(Pref.haptics) private var haptics = true
    @AppStorage(Pref.autoSeen) private var autoSeen = true
    @AppStorage(Pref.presets) private var presets = "15,30,60,120"
    @AppStorage(Pref.accentHex) private var accentHex = ""
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var server = UserDefaults.standard.string(forKey: "serverURL") ?? ""
    @State private var user = ""
    @State private var pass = ""
    @State private var message: String?
    @State private var askForget = false
    @State private var found: [Discovery.Found] = []

    var body: some View {
        TabView {
            Form {
                Section("Nu") {
                    LabeledContent("Account", value: store.state.me.name.string ?? UserDefaults.standard.string(forKey: "accountName") ?? "—")
                    LabeledContent("Server", value: UserDefaults.standard.string(forKey: "serverURL") ?? "—")
                    LabeledContent("Verbinding", value: connection)
                }
                Section("Server of IP wijzigen") {
                    TextField("Adres", text: $server, prompt: Text("192.168.1.50:8080"))
                    HStack {
                        Button("Opslaan en verbinden") { saveServer() }
                        Button("Zoek in dit netwerk") { Task { found = await Discovery.find(); if found.isEmpty { message = "Geen server gevonden." } } }
                    }
                    ForEach(found) { s in Button("\(s.name) — \(s.host):\(s.port)") { server = s.url; saveServer() } }
                }
                Section("Ander account") {
                    TextField("Gebruikersnaam", text: $user)
                    SecureField("Wachtwoord", text: $pass)
                    Button("Inloggen met dit account") { Task { await switchAccount() } }.disabled(user.isEmpty || pass.isEmpty)
                }
                if let message { Text(message).foregroundStyle(.secondary) }
                Section {
                    Button("Opnieuw verbinden") { store.restart() }
                    Button("Account en server vergeten", role: .destructive) { askForget = true }
                }
            }.formStyle(.grouped).tabItem { Label("Account", systemImage: "person.crop.circle") }

            Form {
                Section("Meldingen en geluid") {
                    Toggle("Melding bij een nieuwe bezoeker", isOn: $notifyVisits)
                    Toggle("Geluid bij een bezoeker of de bel", isOn: $sounds)
                    Toggle("Trackpad-trilling bij acties", isOn: $haptics)
                    Toggle("Bezoekers automatisch als gezien markeren", isOn: $autoSeen)
                }
                Section("Op deze Mac") {
                    Toggle("Openen bij het inloggen", isOn: $launchAtLogin).onChange(of: launchAtLogin) { _, on in
                        do { if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() } } catch { message = "Dat lukte niet: \(error.localizedDescription)" }
                    }
                    TextField("Snelle tijden (minuten)", text: $presets)
                }
            }.formStyle(.grouped).tabItem { Label("Deze app", systemImage: "gearshape") }

            Form {
                Section("Kleur") {
                    HStack {
                        ColorPicker("Accentkleur van deze Mac", selection: Binding(get: { Color(hex: accentHex) ?? Palette.accent }, set: { accentHex = $0.hexString }))
                        Button("Standaard") { accentHex = "" }
                    }
                    Text("De kleuren van Open, Gesloten en Bezet volgen het thema dat je op de server hebt gekozen (Ontwerp → Kleuren).").font(.caption).foregroundStyle(.secondary)
                }
            }.formStyle(.grouped).tabItem { Label("Uiterlijk", systemImage: "paintpalette") }
        }
        .confirmationDialog("Account en server vergeten? Je moet daarna opnieuw instellen.", isPresented: $askForget, titleVisibility: .visible) {
            Button("Vergeten", role: .destructive) { store.forget(); Keychain.delete(); UserDefaults.standard.removeObject(forKey: "serverURL"); message = "Vergeten. Start de app opnieuw om opnieuw in te stellen." }
            Button("Annuleren", role: .cancel) {}
        }
    }

    private var connection: String { switch store.connection { case .live: return "live"; case .connecting: return "verbinden…"; case .idle: return "uit"; case .offline(let m): return m } }

    private func saveServer() {
        guard let url = DoorApi.normalize(server) else { message = "Dat adres klopt niet."; return }
        UserDefaults.standard.set(url.absoluteString, forKey: "serverURL"); server = url.absoluteString; store.restart(); message = "Verbinden met \(url.host ?? server)…"
    }

    private func switchAccount() async {
        guard let base = DoorApi.normalize(server) ?? DoorApi.configured()?.base else { message = "Vul eerst een serveradres in."; return }
        let name = user.trimmingCharacters(in: .whitespaces).lowercased()
        do {
            _ = try await DoorApi(base: base).login(username: name, password: pass)
            guard Keychain.save(username: name, password: pass) else { message = "Opslaan in de Sleutelhanger mislukte."; return }
            UserDefaults.standard.set(name, forKey: "accountName")
            UserDefaults.standard.set(base.absoluteString, forKey: "serverURL"); pass = ""; store.restart(); message = "Ingelogd als \(name)"
        } catch { message = error.localizedDescription }
    }
}
