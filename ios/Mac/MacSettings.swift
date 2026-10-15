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
    @AppStorage(MacPref.appearance) private var appearance = "system"
    @AppStorage(MacPref.quietOn) private var quietOn = false
    @AppStorage(MacPref.quietFrom) private var quietFrom = 22 * 60
    @AppStorage(MacPref.quietTo) private var quietTo = 7 * 60
    @State private var quick = QuickStore.load()
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
                Section("Weergave") {
                    Picker("Uiterlijk", selection: $appearance) { Text("Zoals deze Mac").tag("system"); Text("Licht").tag("light"); Text("Donker").tag("dark") }.pickerStyle(.segmented)
                }
                Section("Kleur") {
                    HStack(spacing: 10) {
                        ForEach([("", "Volg de server"), ("#30d158", "Groen"), ("#0a84ff", "Blauw"), ("#bf5af2", "Paars"), ("#ff375f", "Roze"), ("#ff9f0a", "Oranje"), ("#64d2ff", "Lucht")], id: \.0) { hex, name in
                            Button { accentHex = hex } label: {
                                ZStack {
                                    Circle().fill(hex.isEmpty ? Palette.serverAccent ?? .green : Color(hex: hex) ?? .green).frame(width: 26, height: 26)
                                    if accentHex == hex { Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.white) }
                                }
                            }.buttonStyle(.plain).help(name)
                        }
                        Spacer()
                        ColorPicker("Eigen kleur", selection: Binding(get: { Color(hex: accentHex) ?? Palette.accent }, set: { accentHex = $0.hexString }))
                    }
                    Text("Dit is de kleur van knoppen en markeringen in deze app op deze Mac. De kleuren van Open, Gesloten en Bezet volgen het thema van de server (Ontwerp → Kleuren).").font(.caption).foregroundStyle(.secondary)
                }
            }.formStyle(.grouped).tabItem { Label("Uiterlijk", systemImage: "paintpalette") }

            Form {
                Section {
                    ForEach($quick) { $q in
                        HStack {
                            Picker("", selection: $q.symbol) { ForEach(["fork.knife", "person.2.fill", "house.fill", "cup.and.saucer.fill", "phone.fill", "car.fill", "moon.fill", "clock.fill", "figure.walk", "bolt.fill"], id: \.self) { Image(systemName: $0).tag($0) } }.frame(width: 60).labelsHidden()
                            TextField("Naam", text: $q.name).frame(width: 110)
                            Picker("", selection: $q.mode) { Text("Open").tag("open"); Text("Gesloten").tag("closed"); Text("Bezet").tag("busy") }.frame(width: 100).labelsHidden()
                            Stepper("\(q.minutes == 0 ? "geen limiet" : "\(q.minutes) min")", value: $q.minutes, in: 0...600, step: 5).frame(width: 150)
                            TextField("Bericht op de deur", text: $q.message)
                            Button(role: .destructive) { quick.removeAll { $0.id == q.id } } label: { Image(systemName: "trash") }.buttonStyle(.borderless)
                        }
                    }
                    HStack {
                        Button("Actie toevoegen") { quick.append(QuickAction(name: "Nieuw", mode: "busy", minutes: 15, message: "", symbol: "clock.fill")) }
                        Button("Standaard herstellen") { quick = QuickStore.defaults }
                    }
                } header: { Text("Snelle acties") } footer: { Text("Eén klik zet de deur op een status, voor een tijd, met een bericht. Je ziet ze op de Status-pagina en onder het icoon in de menubalk. Ze staan alleen op deze Mac.") }
            }.formStyle(.grouped).tabItem { Label("Snelle acties", systemImage: "bolt.fill") }.onChange(of: quick) { _, new in QuickStore.save(new) }

            Form {
                Section("Stille uren") {
                    Toggle("Geen geluid of melding in deze uren", isOn: $quietOn)
                    DatePicker("Van", selection: Binding(get: { minutesToDate(quietFrom) }, set: { quietFrom = dateToMinutes($0) }), displayedComponents: .hourAndMinute).disabled(!quietOn)
                    DatePicker("Tot", selection: Binding(get: { minutesToDate(quietTo) }, set: { quietTo = dateToMinutes($0) }), displayedComponents: .hourAndMinute).disabled(!quietOn)
                    Text("Bezoekers blijven gewoon in de lijst en het menubalk-icoon krijgt nog steeds een rode stip.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Menubalk") {
                    Text("Het icoon toont de kleur van de deur. Klik erop voor de status, je snelle acties en de nieuwste bezoekers.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Sneltoetsen") {
                    LabeledContent("Open", value: "⌥⌘1"); LabeledContent("Gesloten", value: "⌥⌘2"); LabeledContent("Bezet", value: "⌥⌘3"); LabeledContent("Instellingen", value: "⌘,")
                }
            }.formStyle(.grouped).tabItem { Label("Meer", systemImage: "ellipsis.circle") }
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

private func minutesToDate(_ m: Int) -> Date { Calendar.current.date(bySettingHour: m / 60, minute: m % 60, second: 0, of: Date()) ?? Date() }
private func dateToMinutes(_ d: Date) -> Int { let c = Calendar.current.dateComponents([.hour, .minute], from: d); return (c.hour ?? 0) * 60 + (c.minute ?? 0) }
