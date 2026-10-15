import SwiftUI

/// Management: the checklist, energy (screen and computer off/on), moderation queue and safety buttons.
struct MacManage: View {
    @ObservedObject var store: DoorStore
    @State private var askPower: String?
    @State private var askLockdown = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                let health = store.state.health.array
                if !health.isEmpty {
                    GroupBox {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(Array(health.enumerated()), id: \.offset) { _, h in
                                HStack(alignment: .top) {
                                    Image(systemName: h.ok.bool ? "checkmark.circle.fill" : "exclamationmark.circle.fill").foregroundStyle(h.ok.bool ? Color.green : Color.orange)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(h.text.str)
                                        if !h.ok.bool { Text(h.tip.str).font(.caption).foregroundStyle(.secondary) }
                                    }
                                }
                            }
                        }.padding(6).frame(maxWidth: .infinity, alignment: .leading)
                    } label: { Label("Controle", systemImage: "checklist") }
                }

                if store.can("power"), store.state.power.available.bool {
                    GroupBox {
                        VStack(alignment: .leading, spacing: 10) {
                            if let pend = store.state.power.pending.at.date {
                                TimelineView(.periodic(from: .now, by: 1)) { _ in
                                    let left = max(0, Int(pend.timeIntervalSinceNow))
                                    HStack {
                                        Label("Computer gaat uit over \(left / 60):\(String(format: "%02d", left % 60))", systemImage: "power").foregroundStyle(.orange).font(.headline)
                                        Button("Afbreken") { Task { await store.run("Afgebroken") { _ = try await store.post("api/power/cancel") } } }.buttonStyle(.borderedProminent)
                                    }
                                }
                            }
                            if !store.state.power.enabled.bool { Label("Energiebeheer staat uit — zet het aan in het webpaneel (Instellingen → Energie).", systemImage: "info.circle").foregroundStyle(.secondary) }
                            HStack {
                                Button { Task { await store.run("Scherm uit") { _ = try await store.post("api/power/now", ["action": "screenOff"]) } } } label: { Label("Scherm uit", systemImage: "display") }
                                Button { Task { await store.run("Scherm aan") { _ = try await store.post("api/power/now", ["action": "screenOn"]) } } } label: { Label("Scherm aan", systemImage: "display") }
                                Divider().frame(height: 18)
                                Button(role: .destructive) { askPower = "computer" } label: { Label("Computer uit…", systemImage: "power") }
                                Button { askPower = "hibernate" } label: { Label("Slaapstand…", systemImage: "moon.fill") }
                                Button { askPower = "restart" } label: { Label("Herstart…", systemImage: "arrow.clockwise") }
                            }.disabled(!store.state.power.enabled.bool)
                        }.padding(6).frame(maxWidth: .infinity, alignment: .leading)
                    } label: { Label("Energie", systemImage: "bolt.fill") }
                }

                let pending = store.state.pendingProfiles.array
                if store.can("inbox"), !pending.isEmpty {
                    GroupBox {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(Array(pending.enumerated()), id: \.offset) { _, p in
                                HStack {
                                    VStack(alignment: .leading) { Text(p.name.str).font(.headline); Text(p.nr.str).font(.caption).foregroundStyle(.secondary) }
                                    Spacer()
                                    Button("Goedkeuren") { Task { await store.run("Goedgekeurd") { _ = try await store.post("api/moderation/profile", ["id": p.id.str, "approve": true]) } } }.buttonStyle(.borderedProminent)
                                    Button("Afwijzen", role: .destructive) { Task { await store.run("Afgewezen") { _ = try await store.post("api/moderation/profile", ["id": p.id.str, "approve": false]) } } }
                                }
                            }
                        }.padding(6)
                    } label: { Label("Profielen ter goedkeuring", systemImage: "person.badge.clock") }
                }

                let blocked = store.state.blocked.array
                if store.can("inbox"), !blocked.isEmpty {
                    GroupBox {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(Array(blocked.enumerated()), id: \.offset) { _, b in
                                HStack {
                                    VStack(alignment: .leading) { Text(b.kind.str == "ip" ? "Telefoon" : "Profiel \(b.value.str)").font(.headline); Text(b.until.date.map { "tot \($0.whenText)" } ?? "voor altijd").font(.caption).foregroundStyle(.secondary) }
                                    Spacer()
                                    Button("Opheffen") { Task { await store.run("Blokkade opgeheven") { _ = try await store.post("api/moderation/unblock", ["id": b.id.str]) } } }
                                }
                            }
                        }.padding(6)
                    } label: { Label("Geblokkeerd", systemImage: "hand.raised.fill") }
                }

                GroupBox {
                    HStack {
                        if store.can("system") {
                            Button { Task { await store.run("Back-up gemaakt") { _ = try await store.post("api/system/backups/create") } } } label: { Label("Back-up maken", systemImage: "externaldrive.badge.plus") }
                            Button { Task { await store.run("Andere sessies beëindigd") { _ = try await store.post("api/system/revoke-all") } } } label: { Label("Andere sessies beëindigen", systemImage: "person.2.slash") }
                        }
                        Spacer()
                        Button(role: .destructive) { askLockdown = true } label: { Label("Noodstop", systemImage: "exclamationmark.octagon.fill") }.buttonStyle(.borderedProminent).tint(.red).disabled(!store.can("system"))
                    }.padding(6)
                } label: { Label("Veiligheid", systemImage: "lock.shield") }

                GroupBox {
                    VStack(alignment: .leading, spacing: 6) {
                        info("Server", UserDefaults.standard.string(forKey: "serverURL") ?? "—")
                        info("Versie", store.state.server.version.str.isEmpty ? "—" : store.state.server.version.str)
                        info("Verbonden schermen", store.state.server.clients.int.map(String.init) ?? "—")
                        info("Jouw rol", "\(store.state.me.name.str) · \(store.state.me.role.str)")
                    }.padding(6)
                } label: { Label("Server", systemImage: "server.rack") }
            }.padding(28)
        }
        .navigationTitle("Beheer")
        .confirmationDialog("Weet je het zeker?", isPresented: Binding(get: { askPower != nil }, set: { if !$0 { askPower = nil } }), titleVisibility: .visible) {
            Button("Ja, doe het", role: .destructive) { if let a = askPower { Task { await store.run("Afteltijd gestart") { _ = try await store.post("api/power/now", ["action": a]) } } }; askPower = nil }
            Button("Annuleren", role: .cancel) { askPower = nil }
        } message: { Text("Er verschijnt een afteltijd op het deurscherm; je kunt hem afbreken.") }
        .confirmationDialog("Noodstop: het bedieningspaneel gaat voor iedereen op slot.", isPresented: $askLockdown, titleVisibility: .visible) {
            Button("Noodstop activeren", role: .destructive) { Task { await store.run("Noodstop actief") { _ = try await store.post("api/system/lockdown") } } }
            Button("Annuleren", role: .cancel) {}
        }
    }

    private func info(_ k: String, _ v: String) -> some View { HStack { Text(k).foregroundStyle(.secondary); Spacer(); Text(v).textSelection(.enabled) } }
}
