import SwiftUI
import CoreImage.CIFilterBuiltins

/// Rights in plain language ("Wat mag ik?").
enum Plain {
    static let rights: [(String, String)] = [
        ("view", "De status bekijken"), ("status", "De status op de deur wijzigen"), ("inbox", "Bezoekers lezen en beantwoorden"),
        ("people", "Personen en profielen beheren"), ("settings", "Instellingen van de deur wijzigen"), ("mail", "E-mail en meldingen instellen"),
        ("export", "Back-ups maken en gegevens exporteren"), ("audit", "Het logboek bekijken"), ("users", "Gebruikers beheren"),
        ("api", "API-sleutels beheren"), ("power", "Energie en wekschema instellen"), ("devices", "Microcontrollers koppelen"),
        ("unlock", "Het slot bedienen"), ("cameras", "Camera’s koppelen"), ("system", "Systeembeheer (alleen het hoofdaccount)"),
    ]
    static func sentences(_ perms: [String]) -> [String] { rights.filter { perms.contains($0.0) }.map(\.1) }
    static func missing(_ perms: [String]) -> [String] { rights.filter { !perms.contains($0.0) && $0.0 != "system" }.map(\.1) }
}

/// A QR code drawn from text (nothing is sent anywhere).
struct QRCodeView: View {
    let text: String
    var body: some View {
        if let img = make() {
            Image(decorative: img, scale: 1).interpolation(.none).resizable().scaledToFit()
                .padding(10).background(Color.white, in: RoundedRectangle(cornerRadius: 12))
        }
    }
    private func make() -> CGImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(text.utf8); f.correctionLevel = "M"
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)) else { return nil }
        return CIContext().createCGImage(out, from: out.extent)
    }
}

/// "Mijn account": what you may do, password, two-step verification, your devices, logging in another device, your own activity.
struct AccountDetailView: View {
    @ObservedObject var store: DoorStore
    @State private var twoStep = JSON(nil)
    @State private var sessions: [JSON] = []
    @State private var message: String?
    @State private var good = true
    // password
    @State private var current = ""
    @State private var next = ""
    // two-step setup
    @State private var setupSecret = ""
    @State private var setupURI = ""
    @State private var code = ""
    @State private var recovery: [String] = []
    @State private var disablePass = ""
    // QR to log in another device
    @State private var ticketURL: String?
    @State private var ticketUntil = Date()

    private var perms: [String] { store.perms }

    var body: some View {
        Form {
            Section("Wie ben jij") {
                LabeledContent("Naam", value: store.state.me.name.str)
                LabeledContent("Rol", value: store.state.me.role.str.capitalized)
                DisclosureGroup("Wat je mag") {
                    ForEach(Plain.sentences(perms), id: \.self) { Label($0, systemImage: "checkmark.circle.fill").foregroundStyle(Palette.open).font(.callout) }
                    let no = Plain.missing(perms)
                    if !no.isEmpty {
                        Text("Dit mag je niet:").font(.footnote).foregroundStyle(.secondary).padding(.top, 4)
                        ForEach(no, id: \.self) { Label($0, systemImage: "xmark.circle").foregroundStyle(.secondary).font(.callout) }
                    }
                }
            }

            if !store.state.me.noPw.bool {
                Section("Wachtwoord wijzigen") {
                    SecureField("Huidig wachtwoord", text: $current)
                    SecureField("Nieuw wachtwoord (minstens 8 tekens)", text: $next)
                    Button("Wachtwoord wijzigen") { Task { await changePassword() } }.disabled(current.isEmpty || next.count < 8)
                }
            }

            Section {
                if !recovery.isEmpty {
                    Text("Bewaar deze herstelcodes ergens veilig. Elke code werkt één keer. Je ziet ze niet nog een keer.").font(.footnote)
                    Text(recovery.joined(separator: "\n")).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                    Button("Klaar, ik heb ze bewaard") { recovery = []; Task { await reload() } }
                } else if twoStep.enabled.bool {
                    Label("Staat aan", systemImage: "checkmark.shield.fill").foregroundStyle(Palette.open)
                    Text("Nog \(twoStep.recoveryLeft.int ?? 0) herstelcodes over.").font(.footnote).foregroundStyle(.secondary)
                    TextField("Code uit je app", text: $code).autocorrectionDisabledCompat()
                    Button("Nieuwe herstelcodes maken") { Task { await newRecovery() } }.disabled(code.isEmpty)
                    SecureField("Je wachtwoord (om uit te zetten)", text: $disablePass)
                    Button("Tweestapsverificatie uitzetten", role: .destructive) { Task { await disable() } }.disabled(code.isEmpty || disablePass.isEmpty)
                } else if !setupSecret.isEmpty {
                    Text("1. Scan deze code met je verificatie-app (Google Authenticator, Microsoft Authenticator, 1Password…).").font(.footnote)
                    QRCodeView(text: setupURI).frame(width: 200, height: 200)
                    Text("Lukt scannen niet? Typ deze sleutel over: \(setupSecret)").font(.footnote).textSelection(.enabled)
                    Text("2. Typ de code die de app nu laat zien.").font(.footnote)
                    TextField("Code van 6 cijfers", text: $code).autocorrectionDisabledCompat()
                    Button("Aanzetten") { Task { await enable() } }.disabled(code.isEmpty)
                } else {
                    Text("Naast je wachtwoord vraagt de server dan een code uit een app. Zo kan niemand met alleen je wachtwoord inloggen.").font(.footnote).foregroundStyle(.secondary)
                    Button("Instellen") { Task { await setup() } }
                }
            } header: { Text("Tweestapsverificatie") }

            Section {
                ForEach(Array(sessions.enumerated()), id: \.offset) { _, s in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(s.device.str + (s.current.bool ? " (dit apparaat)" : "")).font(.callout.weight(.medium))
                            Text("\(s.ip.str) · laatst actief \(s.lastSeen.date?.ago ?? "—")").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if !s.current.bool { Button("Uitloggen") { Task { await endSession(s.id.str) } }.buttonStyle(.borderless) }
                    }
                }
                if sessions.count > 1 { Button("Overal uitloggen behalve hier", role: .destructive) { Task { await endOthers() } } }
            } header: { Text("Mijn apparaten") }

            Section {
                if let ticketURL {
                    QRCodeView(text: ticketURL).frame(width: 220, height: 220)
                    Text("Scan met de camera van het andere apparaat. De code werkt twee minuten, één keer.").font(.footnote).foregroundStyle(.secondary)
                    TimelineView(.periodic(from: .now, by: 1)) { _ in
                        let left = max(0, Int(ticketUntil.timeIntervalSinceNow))
                        Text(left > 0 ? "Nog \(left) seconden" : "Verlopen — maak een nieuwe.").font(.caption).foregroundStyle(left > 0 ? Color.secondary : Palette.busy)
                    }
                }
                Button(ticketURL == nil ? "QR-code maken" : "Nieuwe QR-code") { Task { await makeTicket() } }
            } header: { Text("Inloggen op een ander apparaat") } footer: { Text("Handig voor je telefoon of een andere computer: scannen en je bent ingelogd, zonder wachtwoord te typen.") }

            Section("Mijn activiteit") {
                let mine = store.history.filter { $0.by == store.state.me.name.str }.prefix(12)
                if mine.isEmpty { Text("Nog niets.").foregroundStyle(.secondary) }
                ForEach(Array(mine)) { h in
                    VStack(alignment: .leading, spacing: 2) { Text(h.text).font(.callout); Text(h.at.ago).font(.caption).foregroundStyle(.secondary) }
                }
            }

            if let message { Section { Label(message, systemImage: good ? "checkmark.circle.fill" : "exclamationmark.triangle.fill").foregroundStyle(good ? Palette.open : Palette.busy) } }
        }
        .navigationTitle("Mijn account")
        .task { await reload() }
        .refreshable { await reload() }
    }

    private func say(_ m: String, _ ok: Bool = true) { message = m; good = ok; ok ? Haptics.success() : Haptics.error() }

    private func reload() async {
        twoStep = (try? await store.call("GET", "api/2fa/status")) ?? JSON(nil)
        sessions = ((try? await store.call("GET", "api/my/sessions")) ?? JSON(nil)).sessions.array
    }
    private func changePassword() async {
        do { _ = try await store.call("POST", "api/password", body: ["current": current, "next": next]); current = ""; next = ""; say("Wachtwoord gewijzigd. Andere apparaten zijn uitgelogd.") }
        catch { say(error.localizedDescription, false) }
    }
    private func setup() async {
        do { let r = try await store.call("POST", "api/2fa/setup", body: [:]); setupSecret = r.secret.str; setupURI = r.uri.str; code = ""; message = nil }
        catch { say(error.localizedDescription, false) }
    }
    private func enable() async {
        do { let r = try await store.call("POST", "api/2fa/enable", body: ["code": code]); recovery = r.recovery.strings; setupSecret = ""; code = ""; say("Tweestapsverificatie staat aan.") }
        catch { say(error.localizedDescription, false) }
    }
    private func newRecovery() async {
        do { let r = try await store.call("POST", "api/2fa/recovery", body: ["code": code]); recovery = r.recovery.strings; code = "" }
        catch { say(error.localizedDescription, false) }
    }
    private func disable() async {
        do { _ = try await store.call("POST", "api/2fa/disable", body: ["password": disablePass, "code": code]); code = ""; disablePass = ""; say("Tweestapsverificatie staat uit."); await reload() }
        catch { say(error.localizedDescription, false) }
    }
    private func endSession(_ id: String) async { _ = try? await store.call("POST", "api/my/sessions/revoke", body: ["id": id]); await reload() }
    private func endOthers() async { _ = try? await store.call("POST", "api/my/sessions/revoke", body: ["others": true]); say("Overal uitgelogd."); await reload() }
    private func makeTicket() async {
        guard let base = store.base else { return }
        do {
            let t = try await store.call("POST", "api/login/ticket", body: [:])
            ticketURL = base.absoluteString + "/admin#ticket=" + t.ticket.str
            ticketUntil = Date().addingTimeInterval(TimeInterval(t.expiresIn.int ?? 120))
        } catch { say(error.localizedDescription, false) }
    }
}

extension View {
    @ViewBuilder func autocorrectionDisabledCompat() -> some View {
        #if os(iOS)
        self.textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        self.autocorrectionDisabled()
        #endif
    }
}

/// For the person who looks after the door: score, https, blocked addresses, log check, restart.
struct SecurityOverviewView: View {
    @ObservedObject var store: DoorStore
    @State private var bans = JSON(nil)
    @State private var verify: String?
    @State private var confirmRestart = false
    @State private var confirmUpdate = false
    @State private var upd = JSON(nil)
    @State private var message: String?

    private var sec: JSON { store.state.security }
    private var https: JSON { store.state.https }

    var body: some View {
        Form {
            if !sec.isNull {
                Section {
                    HStack(alignment: .firstTextBaseline) {
                        Text("\(sec.score.int ?? 0)").font(.system(size: 44, weight: .bold)).foregroundStyle(color)
                        Text("van 100").foregroundStyle(.secondary)
                    }
                    ForEach(Array(sec.items.array.enumerated()), id: \.offset) { _, i in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: i.ok.bool ? "checkmark.circle.fill" : "exclamationmark.circle.fill").foregroundStyle(i.ok.bool ? Palette.open : Palette.busy)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(i.text.str).font(.callout)
                                if !i.tip.str.isEmpty { Text(i.tip.str).font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer()
                            if !i.fix.str.isEmpty { Button("Los op") { Task { await fix(i.fix.str) } }.buttonStyle(.borderless) }
                        }
                    }
                } header: { Text("Beveiligingsscore") }
            } else {
                Section { Text("De score is te zien met het recht “Instellingen wijzigen”.").foregroundStyle(.secondary) }
            }

            if !https.isNull {
                Section {
                    Label(https.running.bool ? "Https staat aan" : (https.enabled.bool ? "Https start…" : "Https staat uit"), systemImage: https.running.bool ? "lock.fill" : "lock.open")
                    if https.running.bool {
                        ForEach(https.urls.strings, id: \.self) { Text($0).font(.footnote).textSelection(.enabled) }
                        Text("Vingerafdruk: \(https.fingerprint.str)").font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                    }
                    Button(https.enabled.bool ? "Https uitzetten" : "Https aanzetten") { Task { await store.run(https.enabled.bool ? "Https staat uit" : "Https staat aan") { _ = try await store.post("api/https/settings", ["enabled": !https.enabled.bool]) } } }
                } header: { Text("Beveiligde verbinding") } footer: { Text("De server maakt zijn eigen certificaat; je hoeft niets te kopen. Deze app vraagt één keer of je de vingerafdruk vertrouwt.") }
            }

            if store.can("settings") {
                Section("Geblokkeerde adressen") {
                    let list = bans.bans.array
                    if list.isEmpty && bans.lockouts.array.isEmpty { Text("Er is nu niemand geblokkeerd.").foregroundStyle(.secondary) }
                    ForEach(Array(list.enumerated()), id: \.offset) { _, b in
                        HStack { Text(b.ip.str); Spacer(); Button("Opheffen") { Task { await unban(b.ip.str) } }.buttonStyle(.borderless) }
                    }
                    ForEach(Array(bans.lockouts.array.enumerated()), id: \.offset) { _, b in
                        HStack { Text("\(b.ip.str) — \(b.tries.int ?? 0) foute pogingen").font(.callout); Spacer(); Button("Opheffen") { Task { await unban(b.ip.str) } }.buttonStyle(.borderless) }
                    }
                }
            }

            if store.can("audit") {
                Section {
                    Button("Controleer het logboek") { Task { await checkLog() } }
                    if let verify { Text(verify).font(.callout) }
                } header: { Text("Logboek") } footer: { Text("Elke regel is aan de vorige vastgemaakt. Wordt er iets aangepast, dan zie je dat hier.") }
            }

            if store.can("system") {
                Section {
                    Text(updateLine).font(.callout)
                    if !upd.isNull && upd.live.bool && !upd.persistent.bool {
                        Text("Deze server draait van een live-schijf zonder eigen gegevensschijf: na een herstart van de computer zijn de gegevens en de update weg.").font(.caption).foregroundStyle(Palette.busy)
                    }
                    Button("Zoek naar updates") { Task { await checkUpdate() } }
                    if upd.newer.bool && upd.hasBundle.bool && upd.supervised.bool {
                        Button("Bijwerken naar \(upd.version.str)") { confirmUpdate = true }
                    }
                } header: { Text("Server bijwerken") } footer: { Text("De server downloadt de nieuwe versie zelf, controleert de ondertekening, maakt een back-up en herstart. Betas kies je op het web-paneel (Systeem).") }
                Section("Server") {
                    Button("Server herstarten", role: .destructive) { confirmRestart = true }
                }
            }
            if let message { Section { Text(message).foregroundStyle(.secondary) } }
        }
        .navigationTitle("Beveiliging")
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog("De server wordt bijgewerkt en herstart (een halve minuut). Er wordt eerst een back-up gemaakt.", isPresented: $confirmUpdate, titleVisibility: .visible) {
            Button("Bijwerken") { Task { await store.run("Bijwerken…") { _ = try await store.post("api/update/apply") } } }
            Button("Annuleren", role: .cancel) {}
        }
        .confirmationDialog("De server herstart nu. Het duurt een paar seconden.", isPresented: $confirmRestart, titleVisibility: .visible) {
            Button("Herstarten", role: .destructive) { Task { await store.run("Herstarten…") { _ = try await store.post("api/system/restart") } } }
            Button("Annuleren", role: .cancel) {}
        }
    }

    private var color: Color { let s = sec.score.int ?? 0; return s >= 80 ? Palette.open : s >= 50 ? Palette.busy : Palette.closed }
    private var updateLine: String {
        if upd.isNull { return "Even kijken…" }
        if !upd.error.str.isEmpty { return upd.error.str }
        if upd.newer.bool { return "Er is een nieuwere versie: \(upd.version.str) (nu \(upd.current.str))." }
        return upd.checked.bool ? "De server is bij (versie \(upd.current.str))." : "Versie \(upd.current.str). Zoek naar updates om te kijken of er iets nieuws is."
    }
    private func checkUpdate() async { upd = (try? await store.post("api/update/check")) ?? JSON(nil) }
    private func load() async {
        if store.can("settings") { bans = (try? await store.call("GET", "api/security/bans")) ?? JSON(nil) }
        if store.can("system") { upd = (try? await store.call("GET", "api/update")) ?? JSON(nil) }
    }
    private func unban(_ ip: String) async { _ = try? await store.call("POST", "api/security/unban", body: ["ip": ip]); await load() }
    private func fix(_ id: String) async { await store.run("Opgelost") { _ = try await store.post("api/security/fix", ["id": id]) } }
    private func checkLog() async {
        do { let v = try await store.call("GET", "api/audit/verify"); verify = v.ok.bool ? "✓ Het logboek klopt (\(v.lines.int ?? 0) regels)." : "✗ Het logboek is aangepast bij regel \((v.brokenAt.int ?? 0) + 1)." }
        catch { verify = error.localizedDescription }
    }
}

/// A small picture of how the door looks with a colour theme.
struct PalettePreview: View {
    let open: String, closed: String, busy: String, accent: String
    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 8).fill(Color.black)
            VStack(alignment: .leading, spacing: 3) {
                Text("Open").font(.system(size: 13, weight: .heavy)).foregroundStyle(Color(hex: open) ?? .green)
                HStack(spacing: 3) { ForEach([closed, busy, accent], id: \.self) { Capsule().fill(Color(hex: $0) ?? .gray).frame(width: 14, height: 5) } }
            }.padding(7)
        }
        .frame(width: 72, height: 46)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.white.opacity(0.15)))
    }
}



/// A report to send to the developer: versions, connection, the last events. Never contains passwords, keys or session tokens.
@MainActor enum Diagnostics {
    static func report(_ store: DoorStore) -> String {
        let info = Bundle.main.infoDictionary ?? [:]
        var lines = ["Deur Beheer — diagnose", "Tijd: \(Date().formatted(date: .abbreviated, time: .standard))",
                     "App: \(Bundle.main.bundleIdentifier ?? "?") \(info["CFBundleShortVersionString"] as? String ?? "?") (\(info["CFBundleVersion"] as? String ?? "?")) \(Build.configuration)",
                     "Systeem: \(ProcessInfo.processInfo.operatingSystemVersionString)",
                     "Server: \(store.base?.absoluteString ?? "—")", "Server-versie: \(store.state.server.version.str)",
                     "Verbinding: \(store.connection)", "Reactietijd: \(store.lastLatencyMs.map { "\($0) ms" } ?? "—")",
                     "Account: \(store.state.me.name.str) (\(store.state.me.role.str))", "Rechten: \(store.perms.joined(separator: ", "))",
                     "Https: \(store.state.https.running.bool ? "aan" : "uit")", "Beveiligingsscore: \(store.state.security.score.int.map(String.init) ?? "—")",
                     "Bewaarde servers: \(Profiles.all.count), vertrouwde certificaten: \(Pins.all.count)", "", "Laatste gebeurtenissen:"]
        for e in store.events.prefix(100) { lines.append("\(e.at.formatted(date: .omitted, time: .standard)) [\(e.kind)] \(e.text)") }
        return lines.joined(separator: "\n")
    }
}
