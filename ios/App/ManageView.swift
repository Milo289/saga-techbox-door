import SwiftUI

/// Beheer: the server, your account, people, the activity log and the emergency buttons.
struct ManageView: View {
    @ObservedObject var store: DoorStore
    @ObservedObject var model: AppModel
    @AppStorage(Pref.confirmLockdown) private var confirmLockdown = true
    @State private var showWeb = false
    @State private var showDoor = false
    @State private var askLockdown = false

    var body: some View {
        NavigationStack {
            List {
                Section("Server") {
                    row("Naam", store.name)
                    row("Versie", store.state.server.version.string ?? "—")
                    row("Draait al", uptime)
                    row("Verbonden schermen", store.state.server.clients.int.map(String.init) ?? "—")
                    row("Reactietijd", store.lastLatencyMs.map { "\($0) ms" } ?? "—")
                }
                Section("Jouw account") {
                    row("Naam", store.state.me.name.str)
                    row("Rol", store.state.me.role.str)
                    if !store.perms.isEmpty {
                        Flow(spacing: 6) {
                            ForEach(store.perms, id: \.self) { p in
                                Text(store.state.permLabels[p].string ?? p).font(.caption).padding(.horizontal, 8).padding(.vertical, 4).background(Color.white.opacity(0.1), in: Capsule())
                            }
                        }
                    }
                }
                Section("Openen") {
                    Button { showWeb = true } label: { Label("Volledig webpaneel (Ontwerp, teksten, indeling…)", systemImage: "safari") }
                    Button { showDoor = true } label: { Label("Deurscherm bekijken", systemImage: "rectangle.portrait") }
                }
                if store.can("inbox") && !store.state.pendingProfiles.array.isEmpty {
                    Section("Profielen ter goedkeuring") {
                        ForEach(Array(store.state.pendingProfiles.array.enumerated()), id: \.offset) { _, p in
                            HStack {
                                VStack(alignment: .leading) { Text(p.name.str).font(.headline); Text(p.nr.str).font(.caption).foregroundStyle(.secondary) }
                                Spacer()
                                Button("Goedkeuren") { Task { await store.run("Goedgekeurd") { _ = try await store.post("api/moderation/profile", ["id": p.id.str, "approve": true]) } } }.buttonStyle(.borderedProminent).tint(Palette.open).foregroundStyle(.black)
                                Button("Afwijzen", role: .destructive) { Task { await store.run("Afgewezen") { _ = try await store.post("api/moderation/profile", ["id": p.id.str, "approve": false]) } } }.buttonStyle(.bordered)
                            }
                        }
                    }
                }
                if store.can("inbox") && !store.state.blocked.array.isEmpty {
                    Section("Geblokkeerd") {
                        ForEach(Array(store.state.blocked.array.enumerated()), id: \.offset) { _, b in
                            HStack {
                                VStack(alignment: .leading) { Text(b.kind.str == "ip" ? "Telefoon" : "Profiel \(b.value.str)").font(.headline); Text(b.until.date.map { "tot \($0.whenText)" } ?? "voor altijd").font(.caption).foregroundStyle(.secondary) }
                                Spacer()
                                Button("Opheffen") { Task { await store.run("Blokkade opgeheven") { _ = try await store.post("api/moderation/unblock", ["id": b.id.str]) } } }.buttonStyle(.bordered)
                            }
                        }
                    }
                }
                if store.can("settings") {
                    Section("Moderatie") {
                        modToggle("Ongepaste woorden herkennen", "filter")
                        modToggle("Ingebouwde lijst gebruiken", "defaultList")
                        modToggle("Nieuwe profielen eerst goedkeuren", "profileApproval")
                        Picker("Bij een scheldwoord", selection: Binding(get: { store.state.settings.moderation.action.str }, set: { v in Task { await store.changeSetting("moderation", "action", v) } })) {
                            Text("Verbergen en markeren").tag("mask"); Text("Alleen markeren").tag("flag"); Text("Niet doorlaten").tag("block")
                        }
                        Stepper("Limiet: \(store.state.settings.moderation.maxPerHour.int ?? 20) per telefoon per uur", value: Binding(get: { store.state.settings.moderation.maxPerHour.int ?? 20 }, set: { v in Task { await store.changeSetting("moderation", "maxPerHour", v) } }), in: 1...500)
                    }
                }
                if store.can("people") {
                    Section("Personen") {
                        NavigationLink { PeopleView(store: store) } label: { Label("\(store.state.people.array.count) personen", systemImage: "person.2.fill") }
                    }
                }
                if store.can("users") {
                    Section("Gebruikers") {
                        ForEach(store.state.users.array.indices, id: \.self) { i in
                            let u = store.state.users.array[i]
                            HStack { Text(u.name.string ?? u.username.str); Spacer(); Text(u.role.str).foregroundStyle(.secondary) }
                        }
                    }
                }
                if store.can("audit") {
                    Section("Activiteit") {
                        ForEach(Array(store.history.prefix(25))) { h in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(h.text).font(.subheadline)
                                Text("\(h.at.whenText) · \(h.by.isEmpty ? "systeem" : h.by)").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if store.can("system") {
                    Section("Systeem") {
                        Button { Task { await store.run("Back-up gemaakt") { _ = try await store.post("api/system/backups/create") } } } label: { Label("Back-up maken", systemImage: "externaldrive.badge.plus") }
                        Button { Task { await store.run("Andere sessies beëindigd") { _ = try await store.post("api/system/revoke-all") } } } label: { Label("Andere sessies beëindigen", systemImage: "person.crop.circle.badge.xmark") }
                        if store.isMaintenance {
                            Button { Task { await store.run("Paneel ontgrendeld") { _ = try await store.post("api/system/unlock") } } } label: { Label("Paneel weer ontgrendelen", systemImage: "lock.open.fill") }
                        }
                        Button(role: .destructive) { if confirmLockdown { askLockdown = true } else { lockdown() } } label: { Label("Noodstop", systemImage: "exclamationmark.octagon.fill") }
                    }
                }
            }
            .scrollContentBackground(.hidden).background(Color.black.ignoresSafeArea())
            .navigationTitle("Beheer")
            .refreshable { try? await store.refresh() }
            .confirmationDialog("Noodstop: de deur gaat dicht, het paneel wordt vergrendeld en iedereen anders wordt uitgelogd.", isPresented: $askLockdown, titleVisibility: .visible) {
                Button("Noodstop", role: .destructive) { lockdown() }
                Button("Annuleren", role: .cancel) {}
            }
            .fullScreenCover(isPresented: $showWeb) { WebPanelCover(model: model, close: { showWeb = false }) }
            .sheet(isPresented: $showDoor) { if let base = store.base { DoorPreview(base: base) } }
        }
    }

    private func modToggle(_ title: String, _ field: String) -> some View {
        Toggle(title, isOn: Binding(get: { store.state.settings.moderation[field].bool }, set: { v in Task { await store.changeSetting("moderation", field, v) } })).tint(.green)
    }

    private func lockdown() { Haptics.heavy(); Task { await store.run("Noodstop actief") { _ = try await store.post("api/system/lockdown") } } }

    private func row(_ k: String, _ v: String) -> some View { HStack { Text(k); Spacer(); Text(v).foregroundStyle(.secondary) } }

    private var uptime: String {
        guard let s = store.state.server.uptime.double else { return "—" }
        return durationText(s)
    }
}

struct WebPanelCover: View {
    @ObservedObject var model: AppModel
    let close: () -> Void
    var body: some View {
        ZStack(alignment: .topTrailing) {
            if let api = DoorApi.configured() { WebContainer(base: api.base, model: model).ignoresSafeArea() }
            Button { close() } label: { Image(systemName: "xmark.circle.fill").font(.title).symbolRenderingMode(.palette).foregroundStyle(.white, .black.opacity(0.6)) }
                .padding(.top, 54).padding(.trailing, 14)
        }.preferredColorScheme(.dark)
    }
}

struct DoorPreview: View {
    let base: URL
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            DoorWebView(url: base).ignoresSafeArea(edges: .bottom)
                .navigationTitle("Deurscherm").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Sluiten") { dismiss() } } }
        }.preferredColorScheme(.dark)
    }
}

struct PeopleView: View {
    @ObservedObject var store: DoorStore
    @State private var search = ""
    @State private var nr = ""
    @State private var name = ""
    @State private var email = ""

    private var people: [JSON] {
        let all = store.state.people.array
        guard !search.isEmpty else { return all }
        return all.filter { "\($0.nr.str) \($0.name.str) \($0.email.str)".localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        List {
            Section("Toevoegen") {
                TextField("Nummer of gebruikersnaam", text: $nr).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Naam", text: $name)
                TextField("E-mail (optioneel)", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                Button("Opslaan") {
                    Task {
                        await store.run("Opgeslagen") { _ = try await store.post("api/v1/people/upsert", ["nr": nr, "name": name, "email": email]) }
                        nr = ""; name = ""; email = ""
                    }
                }.disabled(nr.isEmpty || name.isEmpty)
            }
            Section("\(people.count) personen") {
                ForEach(Array(people.enumerated()), id: \.offset) { _, p in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.name.str).font(.headline)
                        Text("\(p.nr.str)\(p.email.str.isEmpty ? "" : " · \(p.email.str)")\(p.self.bool ? " · zelf aangemaakt" : "")").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden).background(Color.black.ignoresSafeArea())
        .searchable(text: $search, prompt: "Zoeken")
        .navigationTitle("Personen")
    }
}
