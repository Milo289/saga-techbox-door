import SwiftUI

/// The page you use all day: what the door says now, and big buttons to change it.
struct MacStatus: View {
    @ObservedObject var store: DoorStore
    @State private var message = ""
    @State private var customMinutes = 45
    @AppStorage(Pref.presets) private var presets = "15,30,60,120"
    @State private var quick = QuickStore.load()

    private var durations: [Int] { presets.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }.filter { $0 > 0 } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                let today = TodayStats(store.requests)
                HStack(spacing: 12) {
                    StatTile(value: "\(today.visitors)", label: "bezoekers vandaag", symbol: "person.2.fill")
                    StatTile(value: "\(today.waiting)", label: "wachten op antwoord", symbol: "bell.badge.fill")
                    StatTile(value: "\(today.bells)", label: "keer aangebeld", symbol: "bell.fill")
                    StatTile(value: today.averageReplyMinutes.map { "\($0) min" } ?? "—", label: "gemiddeld antwoord", symbol: "timer")
                }
                if store.can("status"), !quick.isEmpty {
                    Text("Snelle acties").font(.headline)
                    Flow(spacing: 10) {
                        ForEach(quick) { q in
                            Button { Task { await store.run(q) } } label: { Label(q.name + (q.minutes > 0 ? " · \(q.minutes) min" : ""), systemImage: q.symbol).padding(.horizontal, 6).padding(.vertical, 4) }
                                .buttonStyle(.bordered).tint(Palette.color(q.mode))
                        }
                    }
                }
                Text("Zet de deur op").font(.headline)
                HStack(spacing: 14) {
                    ForEach(DoorModeKind.allCases) { m in modeButton(m) }
                }
                if store.can("status") {
                    GroupBox("Hoe lang?") {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Kies eerst hoe lang, daarna de status — of gebruik de snelle knoppen hieronder.").font(.caption).foregroundStyle(.secondary)
                            HStack {
                                ForEach(durations, id: \.self) { n in
                                    Button(n >= 60 && n % 60 == 0 ? "\(n / 60) uur" : "\(n) min") { Task { await store.setStatus(store.mode == "open" ? "busy" : store.mode, minutes: n) } }
                                }
                                Divider().frame(height: 18)
                                Stepper("\(customMinutes) min", value: $customMinutes, in: 5...600, step: 5).fixedSize()
                                Button("Bezet voor \(customMinutes) min") { Task { await store.setStatus("busy", minutes: customMinutes) } }
                            }
                            HStack {
                                Button("Volg de openingstijden") { Task { await store.run("Volgt de openingstijden") { _ = try await store.post("api/status/auto") } } }
                                Button("Bezet beëindigen") { Task { await store.run("Bezet beëindigd") { _ = try await store.post("api/busy/end") } } }
                            }
                        }.padding(6)
                    }
                    GroupBox("Bericht op de deur") {
                        HStack {
                            TextField("bijv. Ik ben zo terug", text: $message).textFieldStyle(.roundedBorder).onSubmit { post() }
                            Button("Plaatsen") { post() }.disabled(message.isEmpty)
                            Button("Wissen") { message = ""; Task { await store.setNote("") } }
                        }.padding(6)
                    }
                }
                if !store.busy.isEmpty {
                    GroupBox("Ingeplande bezet-tijden") {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(store.busy) { b in
                                HStack { Image(systemName: "clock"); Text("\(b.from.whenText) – \(b.to.hm)"); if !b.note.isEmpty { Text(b.note).foregroundStyle(.secondary) }; Spacer()
                                    Button(role: .destructive) { Task { await store.run("Verwijderd") { _ = try await store.post("api/busy/remove", ["id": b.id]) } } } label: { Image(systemName: "trash") }.buttonStyle(.borderless) }
                            }
                        }.padding(6)
                    }
                }
            }.padding(28)
        }
        .navigationTitle("Status")
        .onAppear { message = store.state.settings.note.str; quick = QuickStore.load() }
    }

    private var header: some View {
        HStack(spacing: 18) {
            ZStack {
                Circle().fill(Palette.color(store.mode).opacity(0.25)).frame(width: 84, height: 84)
                Image(systemName: DoorModeKind(rawValue: store.mode)?.symbol ?? "door.left.hand.closed").font(.system(size: 38)).foregroundStyle(Palette.color(store.mode))
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(store.hasState ? "\(store.name) is \(store.label.lowercased())" : "Verbinden…").font(.system(size: 30, weight: .bold))
                if let u = store.until { Text("tot \(u.hm) · \(durationText(u.timeIntervalSinceNow)) te gaan").foregroundStyle(.secondary) }
                if !store.message.isEmpty { Text(store.message).foregroundStyle(.secondary) }
                if store.isMaintenance { Label("Noodstop of onderhoud actief", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
            }
            Spacer()
        }
        .padding(20).background(Palette.color(store.mode).opacity(0.10), in: RoundedRectangle(cornerRadius: 18))
    }

    private func modeButton(_ m: DoorModeKind) -> some View {
        Button { Task { await store.setStatus(m.rawValue) } } label: {
            VStack(spacing: 8) {
                Image(systemName: m.symbol).font(.system(size: 30))
                Text(m.label).font(.title3.weight(.semibold))
            }.frame(maxWidth: .infinity, minHeight: 100)
        }
        .buttonStyle(.borderedProminent).tint(Palette.color(m.rawValue)).opacity(store.mode == m.rawValue ? 1 : 0.8)
        .overlay(alignment: .topTrailing) { if store.mode == m.rawValue { Image(systemName: "checkmark.circle.fill").foregroundStyle(.white).padding(8) } }
        .disabled(!store.can("status"))
    }

    private func post() { let m = message; Task { await store.setNote(m) } }
}
