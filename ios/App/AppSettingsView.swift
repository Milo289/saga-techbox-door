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
    @State private var server = UserDefaults.standard.string(forKey: "serverURL") ?? ""
    @State private var taps = 0
    @State private var askForget = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle(isOn: $haptics) { Label("Trillen bij acties", systemImage: "iphone.radiowaves.left.and.right") }
                    Toggle(isOn: $sounds) { Label("Geluid bij bezoekers", systemImage: "speaker.wave.2.fill") }
                    Toggle(isOn: $notifyVisits) { Label("Melding bij nieuwe bezoeker", systemImage: "bell.badge.fill") }
                    Toggle(isOn: $badge) { Label("Aantal op het app-icoon", systemImage: "app.badge.fill") }
                    Button("Test het geluid en het trillen") { Haptics.success(); Sounds.bell(); store.show("Zo klinkt het") }
                } header: { Text("Meldingen") } footer: { Text("De app krijgt bezoekers live binnen zolang hij open is. Voor meldingen als de app dicht is: vul bij de server een ntfy-onderwerp in (Webpaneel → Instellingen → Meldingen op je telefoon).") }

                Section("Beveiliging") {
                    Toggle(isOn: $model.faceID) { Label("Vergrendelen met Face ID", systemImage: "faceid") }
                    Picker(selection: $autoLock) {
                        Text("Meteen").tag(0); Text("Na 1 minuut").tag(1); Text("Na 5 minuten").tag(5); Text("Na 15 minuten").tag(15); Text("Nooit").tag(-1)
                    } label: { Label("Vergrendelen na verlaten", systemImage: "lock.rotation") }
                    Toggle(isOn: $confirmStatus) { Label("Vragen voor ik de status wijzig", systemImage: "questionmark.circle") }
                    Toggle(isOn: $confirmLockdown) { Label("Vragen voor de noodstop", systemImage: "exclamationmark.octagon") }
                }

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
                    Picker(selection: $startTab) {
                        Text("Status").tag("status"); Text("Bezoekers").tag("inbox"); Text("Beheer").tag("manage")
                    } label: { Label("Opent op", systemImage: "rectangle.on.rectangle") }
                } header: { Text("Hoofdscherm") } footer: { Text("Zet weg wat je niet nodig hebt. De snelkeuzes zijn minuten, gescheiden door komma’s.") }

                Section("Bezoekers") {
                    Toggle("Compacte lijst", isOn: $compactInbox)
                    Toggle("Automatisch als gezien markeren", isOn: $autoSeen)
                }

                Section("Weergave") {
                    Picker(selection: $appearance) { Text("Donker").tag("dark"); Text("Licht").tag("light"); Text("Zoals de telefoon").tag("system") } label: { Label("Uiterlijk", systemImage: "circle.lefthalf.filled") }
                    Toggle(isOn: $keepAwake) { Label("Scherm aan houden zolang de app open is", systemImage: "sun.max.fill") }
                }

                Section("Server") {
                    TextField("Adres", text: $server).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    Button("Opslaan en opnieuw verbinden") {
                        if let u = DoorApi.normalize(server) { UserDefaults.standard.set(u.absoluteString, forKey: "serverURL"); store.restart(); store.show("Verbinden…") } else { store.show("Dat adres klopt niet.") }
                    }
                    Button("Opnieuw verbinden") { store.restart() }
                    Button("Inlog en server vergeten", role: .destructive) { askForget = true }
                }

                Section("Siri en Opdrachten") {
                    Label("Zeg “Zet de deur op open met Deur Beheer”, of gebruik de acties in de app Opdrachten voor je eigen automatiseringen.", systemImage: "waveform").font(.footnote).foregroundStyle(.secondary)
                    Label("Houd het app-icoon ingedrukt voor Open, Gesloten, Bezet en Noodstop.", systemImage: "hand.tap.fill").font(.footnote).foregroundStyle(.secondary)
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
            .scrollContentBackground(.hidden).background(Color.black.ignoresSafeArea())
            .navigationTitle("Instellingen")
            .confirmationDialog("Inlog en server vergeten?", isPresented: $askForget, titleVisibility: .visible) {
                Button("Vergeten", role: .destructive) { store.forget(); model.forgetEverything() }
                Button("Annuleren", role: .cancel) {}
            }
        }
    }
}
