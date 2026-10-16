import SwiftUI
import UserNotifications

/// Instellingen: everything about this app on this phone. Switch whatever you like on or off.
struct AppSettingsView: View {
    @ObservedObject var store: DoorStore
    @ObservedObject var model: AppModel
    @AppStorage(Pref.haptics) private var haptics = true
    @AppStorage(Pref.sounds) private var sounds = true
    @AppStorage(Pref.notifyVisits) private var notifyVisits = true
    @AppStorage(Pref.badge) private var badge = true
    @AppStorage(Pref.keepAwake) private var keepAwake = false
    @State private var iconName: String? = UIApplication.shared.alternateIconName
    @AppStorage(ExtraPref.quietOn) private var quietOn = false
    @AppStorage(ExtraPref.quietFrom) private var quietFrom = 22 * 60
    @AppStorage(ExtraPref.quietTo) private var quietTo = 7 * 60
    @AppStorage(Pref.confirmStatus) private var confirmStatus = false
    @AppStorage(Pref.confirmLockdown) private var confirmLockdown = true
    @AppStorage(Pref.showDuration) private var showDuration = true
    @AppStorage(Pref.showExtend) private var showExtend = true
    @AppStorage(Pref.showMessage) private var showMessage = true
    @AppStorage(Pref.showToggles) private var showToggles = true
    @AppStorage(Pref.showPlanner) private var showPlanner = true
    @AppStorage(Pref.largeButtons) private var largeButtons = false
    @AppStorage(Pref.statusColorTheme) private var colorTheme = true
    @AppStorage(Pref.compactInbox) private var compactInbox = false
    @AppStorage(Pref.autoSeen) private var autoSeen = true
    @AppStorage(Pref.autoLock) private var autoLock = 0
    @AppStorage(Pref.appearance) private var appearance = "dark"
    @AppStorage(Pref.presets) private var presets = "15,30,60,120"
    @AppStorage(Pref.startTab) private var startTab = "status"
    @AppStorage(Pref.devMode) private var devMode = false
    @AppStorage(Pref.accentHex) private var accentHex = ""
    @State private var server = UserDefaults.standard.string(forKey: "serverURL") ?? ""
    @State private var taps = 0
    @State private var askForget = false
    @State private var showAccount = false
    @State private var query = ""
    @State private var exporting = false
    @State private var importing = false
    @State private var showTour = false

    enum Cat: String, Hashable, CaseIterable, Identifiable {
        case account, security, notifications, appearance, quick, advanced, server
        var id: String { rawValue }
        var title: String { switch self { case .account: return "Account"; case .security: return "Beveiliging"; case .notifications: return "Meldingen"; case .appearance: return "Uiterlijk"; case .quick: return "Snelle acties"; case .advanced: return "Geavanceerd"; case .server: return "Alle serverinstellingen" } }
        var symbol: String { switch self { case .account: return "person.crop.circle"; case .security: return "lock.shield"; case .notifications: return "bell.badge"; case .appearance: return "paintpalette"; case .quick: return "bolt.fill"; case .advanced: return "gearshape.2"; case .server: return "server.rack" } }
        var summary: String { switch self { case .account: return "Wie je bent, wachtwoord, tweestapsverificatie, apparaten, servers"; case .security: return "Face ID, vergrendelen, bevestigen, score van de server"; case .notifications: return "Geluid, trillen, stille uren"; case .appearance: return "Donker of licht, kleuren, hoofdscherm"; case .quick: return "Eigen knoppen en het bezoekersformulier"; case .advanced: return "Siri, bewaren en terugzetten, uitleg, over"; case .server: return "Alles wat het webpaneel ook kan instellen (alleen ontwikkelaarsversie)" } }
    }
    /// what you can find with the search box
    private static let index: [(String, Cat, String)] = [
        ("Mijn account", .account, "naam rol rechten wat mag ik"), ("Wachtwoord wijzigen", .account, "password veranderen"), ("Tweestapsverificatie", .account, "2fa code authenticator herstelcodes"),
        ("Mijn apparaten", .account, "sessies uitloggen overal"), ("Inloggen op een ander apparaat", .account, "qr scannen telefoon"), ("Servers", .account, "meerdere deuren wisselen ip adres"),
        ("Server of IP wijzigen", .account, "adres verbinden"), ("Account en server vergeten", .account, "uitloggen wissen"),
        ("Face ID", .security, "touch id vergrendelen biometrie"), ("Vergrendelen na verlaten", .security, "automatisch slot"), ("Bevestigen bij gevoelige acties", .security, "vragen noodstop status"),
        ("Beveiligingsscore", .security, "https certificaat logboek blokkades herstarten"),
        ("Geluid bij bezoekers", .notifications, "bel sound"), ("Trillen", .notifications, "haptics"), ("Stille uren", .notifications, "nacht niet storen"), ("Aantal op het app-icoon", .notifications, "badge"),
        ("Uiterlijk", .appearance, "donker licht thema"), ("Kleurthema", .appearance, "kleuren palet accent"), ("Hoofdscherm", .appearance, "knoppen duur bericht planner"), ("App-icoon", .appearance, "icoon"),
        ("Snelle acties", .quick, "lunch vergadering knoppen"), ("Bezoekersformulier", .quick, "verplicht naam e-mail"),
        ("Alle serverinstellingen", .server, "openingstijden pauzes vakantie mail meldingen teksten kleuren knoppen moderatie systeem"),
        ("Siri en Opdrachten", .advanced, "shortcuts spraak"), ("Instellingen bewaren en terugzetten", .advanced, "export import back-up"), ("Uitleg tonen", .advanced, "rondleiding help"), ("Over", .advanced, "versie ontwikkelaar"),
    ]
    private var results: [(String, Cat)] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return Self.index.filter { ($0.0 + " " + $0.2).lowercased().contains(q) }.map { ($0.0, $0.1) }
    }

    var body: some View {
        NavigationStack {
            List {
                if query.trimmingCharacters(in: .whitespaces).isEmpty {
                    Section {
                        ForEach(Cat.allCases.filter { $0 != .server || Build.isDeveloperApp }) { c in
                            NavigationLink(value: c) {
                                HStack(spacing: 14) {
                                    Image(systemName: c.symbol).font(.title3).foregroundStyle(Palette.accent).frame(width: 30)
                                    VStack(alignment: .leading, spacing: 2) { Text(c.title).font(.headline); Text(c.summary).font(.caption).foregroundStyle(.secondary) }
                                }.padding(.vertical, 4)
                            }
                        }
                    }
                } else if results.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    Section("Gevonden") {
                        ForEach(Array(results.enumerated()), id: \.offset) { _, r in
                            NavigationLink(value: r.1) { VStack(alignment: .leading) { Text(r.0); Text(r.1.title).font(.caption).foregroundStyle(.secondary) } }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden).background(Color.black.ignoresSafeArea())
            .navigationTitle("Instellingen")
            .searchable(text: $query, prompt: "Zoek in instellingen")
            .navigationDestination(for: Cat.self) { page($0) }
            .sheet(isPresented: $showAccount) { AccountSheet(store: store, model: model) }
            .sheet(isPresented: $showTour) { HelpTour() }
            .fileExporter(isPresented: $exporting, document: SettingsFile(data: SettingsPorting.export()), contentType: .json, defaultFilename: "deur-beheer-instellingen") { r in store.show(r == nil ? "Niet bewaard" : "Bewaard") }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { r in
                guard case .success(let url) = r else { return }
                let ok = url.startAccessingSecurityScopedResource(); defer { if ok { url.stopAccessingSecurityScopedResource() } }
                store.show(((try? Data(contentsOf: url)).map { SettingsPorting.import($0) } ?? false) ? "Instellingen teruggezet — start de app opnieuw voor alles" : "Dit bestand hoort niet bij Deur Beheer")
            }
            .confirmationDialog("Inlog en server vergeten?", isPresented: $askForget, titleVisibility: .visible) {
                Button("Vergeten", role: .destructive) { store.forget(); model.forgetEverything() }
                Button("Annuleren", role: .cancel) {}
            }
        }
    }

    @ViewBuilder private func page(_ c: Cat) -> some View {
        if c == .server { AllSettingsView(store: store).scrollContentBackground(.hidden).background(Color.black.ignoresSafeArea()) } else { pageForm(c) }
    }

    @ViewBuilder private func pageForm(_ c: Cat) -> some View {
        Form {
            switch c {
            case .account: accountPage
            case .security: securityPage
            case .notifications: notificationsPage
            case .appearance: appearancePage
            case .quick: quickPage
            case .advanced: advancedPage
            case .server: EmptyView()
            }
        }
        .scrollContentBackground(.hidden).background(Color.black.ignoresSafeArea())
        .navigationTitle(c.title).navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder private var accountPage: some View {
        Section {
            NavigationLink { AccountDetailView(store: store) } label: { Label("Mijn account", systemImage: "person.crop.circle") }
            NavigationLink { ServersView(store: store) } label: { Label("Servers", systemImage: "server.rack") }
        } footer: { Text("Wachtwoord, tweestapsverificatie, je apparaten en een QR-code om een ander apparaat in te laten loggen.") }
        Section("Server") {
            Button { showAccount = true } label: { Label("Account en server wijzigen…", systemImage: "person.crop.circle.badge.questionmark") }
            TextField("Adres", text: $server).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
            Button("Opslaan en opnieuw verbinden") {
                if let u = DoorApi.normalize(server) { UserDefaults.standard.set(u.absoluteString, forKey: "serverURL"); store.restart(); store.show("Verbinden…") } else { store.show("Dat adres klopt niet.") }
            }
            Button("Opnieuw verbinden") { store.restart() }
            Button("Inlog en server vergeten", role: .destructive) { askForget = true }
        }
    }

    @ViewBuilder private var securityPage: some View {
        Section {
            Toggle(isOn: $model.faceID) { Label("Vergrendelen met Face ID of Touch ID", systemImage: "faceid") }
            Picker(selection: $autoLock) {
                Text("Meteen").tag(0); Text("Na 1 minuut").tag(1); Text("Na 5 minuten").tag(5); Text("Na 15 minuten").tag(15); Text("Nooit").tag(-1)
            } label: { Label("Vergrendelen na verlaten", systemImage: "lock.rotation") }
        } header: { Text("Deze app") } footer: { Text("Zonder Face ID of Touch ID kan niemand die je telefoon pakt de deur bedienen.") }
        Section {
            Toggle(isOn: $confirmStatus) { Label("Vragen voor ik de status wijzig", systemImage: "questionmark.circle") }
            Toggle(isOn: $confirmLockdown) { Label("Vragen voor de noodstop", systemImage: "exclamationmark.octagon") }
        } header: { Text("Bevestigen") }
        Section {
            NavigationLink { SecurityOverviewView(store: store) } label: { Label("Beveiliging van de server", systemImage: "checkmark.shield") }
            NavigationLink { AccountDetailView(store: store) } label: { Label("Mijn activiteit en apparaten", systemImage: "list.bullet.rectangle") }
        } footer: { Text("De score, https, geblokkeerde adressen en het logboek van de deurserver.") }
    }

    @ViewBuilder private var notificationsPage: some View {
        Section {
            Toggle(isOn: $haptics) { Label("Trillen bij acties", systemImage: "iphone.radiowaves.left.and.right") }
            Toggle(isOn: $sounds) { Label("Geluid bij bezoekers", systemImage: "speaker.wave.2.fill") }
            Toggle(isOn: $notifyVisits) { Label("Melding bij nieuwe bezoeker", systemImage: "bell.badge.fill") }
            Toggle(isOn: $badge) { Label("Aantal op het app-icoon", systemImage: "app.badge.fill") }
            Picker(selection: Binding(get: { UserDefaults.standard.object(forKey: Pref.soundBell) as? Int ?? 0 }, set: { UserDefaults.standard.set($0, forKey: Pref.soundBell); Sounds.preview($0) })) { ForEach(Array(Sounds.names.enumerated()), id: \.offset) { Text($1).tag($0) } } label: { Label("Geluid bij aanbellen", systemImage: "bell.fill") }
            Picker(selection: Binding(get: { UserDefaults.standard.object(forKey: Pref.soundMessage) as? Int ?? 1 }, set: { UserDefaults.standard.set($0, forKey: Pref.soundMessage); Sounds.preview($0) })) { ForEach(Array(Sounds.names.enumerated()), id: \.offset) { Text($1).tag($0) } } label: { Label("Geluid bij een vraag", systemImage: "bubble.left.fill") }
            Button("Test het geluid en het trillen") { Haptics.success(); Sounds.bell(); store.show("Zo klinkt het") }
        } footer: { Text("De app krijgt bezoekers live binnen zolang hij open is. Voor meldingen als de app dicht is: vul bij de server een ntfy-onderwerp in (Webpaneel → Instellingen → Meldingen op je telefoon).") }
        Section {
            Toggle(isOn: $quietOn) { Label("Stille uren", systemImage: "moon.zzz.fill") }
            if quietOn {
                DatePicker("Van", selection: Binding(get: { minutesToDate(quietFrom) }, set: { quietFrom = dateToMinutes($0) }), displayedComponents: .hourAndMinute)
                DatePicker("Tot", selection: Binding(get: { minutesToDate(quietTo) }, set: { quietTo = dateToMinutes($0) }), displayedComponents: .hourAndMinute)
            }
        } footer: { Text("In stille uren blijft het geluid en de melding weg; bezoekers staan wel in de lijst.") }
    }

    @ViewBuilder private var appearancePage: some View {
        Section("Weergave") {
            Picker(selection: $appearance) { Text("Donker").tag("dark"); Text("Licht").tag("light"); Text("Zoals de telefoon").tag("system") } label: { Label("Uiterlijk", systemImage: "circle.lefthalf.filled") }
            Toggle(isOn: $keepAwake) { Label("Scherm aan houden zolang de app open is", systemImage: "sun.max.fill") }
            Picker(selection: Binding(get: { iconName ?? "" }, set: { v in
                let name = v.isEmpty ? nil : v
                UIApplication.shared.setAlternateIconName(name) { err in if err == nil { iconName = name } }
            })) {
                Text("Donker").tag(""); Text("Licht").tag("AppIconLight"); Text("Blauw").tag("AppIconBlue")
            } label: { Label("App-icoon", systemImage: "square.grid.2x2.fill") }
        }
        Section {
            ForEach(Array(store.state.palettes.array.enumerated()), id: \.offset) { _, p in
                Button {
                    Task { await store.run("Kleurthema: \(p.name.str)") { _ = try await store.post("api/settings", ["palette": p.id.str, "colors": ["open": p.open.str, "closed": p.closed.str, "busy": p.busy.str], "colorsLight": p.light.dict, "accent": p.accent.str]) } }
                } label: {
                    HStack(spacing: 14) {
                        PalettePreview(open: p.open.str, closed: p.closed.str, busy: p.busy.str, accent: p.accent.str)
                        Text(p.name.str).foregroundStyle(.primary)
                        Spacer()
                        if store.state.settings.palette.str == p.id.str { Image(systemName: "checkmark").foregroundStyle(Palette.accent) }
                    }
                }
            }
        } header: { Text("Kleurthema voor alles") } footer: { Text("Eén tik verandert de kleuren op het deurscherm, in het paneel en in alle apps. Het voorbeeld laat zien hoe de deur eruit gaat zien.") }
        .disabled(!store.can("settings"))
        Section {
            ColorPicker("Accentkleur van deze app", selection: Binding(get: { Palette.accent }, set: { c in accentHex = c.hexString }), supportsOpacity: false)
            if !accentHex.isEmpty { Button("Volg de server") { accentHex = "" } }
            Picker(selection: Binding(get: { model.role }, set: { model.switchRole(to: $0) })) {
                Text("Bedieningspaneel").tag("control"); Text("Deurscherm").tag("door")
            } label: { Label("Dit apparaat is", systemImage: "iphone.and.ipad") }
        } header: { Text("Alleen dit apparaat") } footer: { Text("Wisselen van type vergeet de server niet. Voor een deurscherm heb je geen inlog nodig.") }
        Section {
            Toggle("Tot wanneer? (keuze van de duur)", isOn: $showDuration)
            Toggle("Snel aanpassen (+15, +30, +1 uur)", isOn: $showExtend)
            Toggle("Bericht op de deur", isOn: $showMessage)
            Toggle("Schakelaars voor het deurscherm", isOn: $showToggles)
            Toggle("Bezet inplannen", isOn: $showPlanner)
            Toggle("Grote statusknoppen onder elkaar", isOn: $largeButtons)
            Toggle("Achtergrond in de kleur van de status", isOn: $colorTheme)
            HStack {
                Label("Snelkeuzes (minuten)", systemImage: "timer")
                Spacer()
                TextField("15,30,60,120", text: $presets).multilineTextAlignment(.trailing).keyboardType(.numbersAndPunctuation).frame(width: 150)
            }
            Picker(selection: $startTab) { Text("Status").tag("status"); Text("Bezoekers").tag("inbox"); Text("Beheer").tag("manage") } label: { Label("Opent op", systemImage: "rectangle.on.rectangle") }
        } header: { Text("Hoofdscherm") } footer: { Text("Zet weg wat je niet nodig hebt. De snelkeuzes zijn minuten, gescheiden door komma’s.") }
        Section("Bezoekers") {
            Toggle("Compacte lijst", isOn: $compactInbox)
            Toggle("Automatisch als gezien markeren", isOn: $autoSeen)
        }
    }

    @ViewBuilder private var quickPage: some View {
        Section {
            NavigationLink { QuickEditor() } label: { Label("Mijn snelle acties", systemImage: "bolt.fill") }
            if store.can("settings") { NavigationLink { FormSettingsView(store: store) } label: { Label("Bezoekersformulier", systemImage: "list.clipboard") } }
        } footer: { Text("Snelle acties zijn knoppen als “Lunch · 30 min · Bezet”. Je vindt ze op het hoofdscherm, bij het app-icoon en in Siri.") }
    }

    @ViewBuilder private var advancedPage: some View {
        Section("Siri en Opdrachten") {
            Label("Zeg “Zet de deur op open met Deur Beheer”, of gebruik de acties in de app Opdrachten voor je eigen automatiseringen. Ze staan ook in Spotlight.", systemImage: "waveform").font(.footnote).foregroundStyle(.secondary)
            Label("Houd het app-icoon ingedrukt voor Open, Gesloten, Bezet en Noodstop.", systemImage: "hand.tap.fill").font(.footnote).foregroundStyle(.secondary)
        }
        Section {
            Button { exporting = true } label: { Label("Instellingen bewaren als bestand", systemImage: "square.and.arrow.up") }
            Button { importing = true } label: { Label("Instellingen terugzetten uit een bestand", systemImage: "square.and.arrow.down") }
        } header: { Text("Bewaren en terugzetten") } footer: { Text("Dit zijn de instellingen van de app: je snelle acties, voorkeuren en de lijst met servers. Wachtwoorden zitten er nooit in.") }
        Section {
            Button { showTour = true } label: { Label("Uitleg tonen", systemImage: "questionmark.circle") }
        }
        Section("Over") {
            HStack { Text("Versie"); Spacer(); Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1").foregroundStyle(.secondary) }
                .contentShape(Rectangle())
                .onTapGesture {
                    taps += 1
                    if taps >= 7 { taps = 0; devMode.toggle(); Haptics.success(); store.show(devMode ? "Ontwikkelaarsmodus aan" : "Ontwikkelaarsmodus uit") }
                }
            HStack { Text("Soort app"); Spacer(); Text(Build.isDeveloperApp ? "Ontwikkelaarsversie" : "Gewone versie").foregroundStyle(.secondary) }
            if devMode && !Build.isDeveloperApp { Toggle("Ontwikkelaarsmodus", isOn: $devMode) }
        }
    }
}

private func minutesToDate(_ m: Int) -> Date { Calendar.current.date(bySettingHour: m / 60, minute: m % 60, second: 0, of: Date()) ?? Date() }
private func dateToMinutes(_ d: Date) -> Int { let c = Calendar.current.dateComponents([.hour, .minute], from: d); return (c.hour ?? 0) * 60 + (c.minute ?? 0) }

/// Make, change and remove your own quick actions.
struct QuickEditor: View {
    @State private var list = QuickStore.load()
    var body: some View {
        Form {
            ForEach($list) { $q in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Picker("", selection: $q.symbol) { ForEach(["fork.knife", "person.2.fill", "house.fill", "cup.and.saucer.fill", "phone.fill", "car.fill", "moon.fill", "clock.fill", "figure.walk", "bolt.fill"], id: \.self) { Image(systemName: $0).tag($0) } }.labelsHidden().frame(width: 70)
                        TextField("Naam", text: $q.name)
                    }
                    Picker("Status", selection: $q.mode) { Text("Open").tag("open"); Text("Gesloten").tag("closed"); Text("Bezet").tag("busy") }.pickerStyle(.segmented)
                    Stepper(q.minutes == 0 ? "Geen tijdslimiet" : "\(q.minutes) minuten", value: $q.minutes, in: 0...600, step: 5)
                    TextField("Bericht op de deur", text: $q.message)
                }.padding(.vertical, 4)
            }
            .onDelete { list.remove(atOffsets: $0) }
            Button { list.append(QuickPreset(name: "Nieuw", mode: "busy", minutes: 15, message: "", symbol: "clock.fill")) } label: { Label("Actie toevoegen", systemImage: "plus") }
            Button("Standaard herstellen") { list = QuickStore.defaults }
        }
        .navigationTitle("Snelle acties").navigationBarTitleDisplayMode(.inline)
        .onChange(of: list) { _, new in QuickStore.save(new) }
        .toolbar { EditButton() }
    }
}
