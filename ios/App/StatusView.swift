import SwiftUI

/// Front screen: the status of the door and everything you want to do with it, one tap away.
struct StatusView: View {
    @ObservedObject var store: DoorStore
    @AppStorage(Pref.showDuration) private var showDuration = true
    @AppStorage(Pref.showExtend) private var showExtend = true
    @AppStorage(Pref.showMessage) private var showMessage = true
    @AppStorage(Pref.showToggles) private var showToggles = true
    @AppStorage(Pref.showPlanner) private var showPlanner = true
    @AppStorage(Pref.largeButtons) private var largeButtons = false
    @AppStorage(Pref.statusColorTheme) private var colorTheme = true
    @AppStorage(Pref.confirmStatus) private var confirmStatus = false
    @AppStorage(Pref.presets) private var presetsText = "15,30,60,120"
    @AppStorage(Pref.recentMessages) private var recentText = ""

    enum Duration: Equatable { case none, minutes(Int), until(Date) }
    @State private var duration: Duration = .none
    @State private var showCustom = false
    @State private var customTime = Date().addingTimeInterval(3600)
    @State private var note = ""
    @State private var noteLoaded = false
    @State private var pendingMode: String?
    @State private var planFrom = Date()
    @State private var planTo = Date().addingTimeInterval(3600)
    @State private var planNote = ""

    private var presets: [Int] { presetsText.split(separator: ",").compactMap { Int($0) }.filter { $0 > 0 } }
    private var canChange: Bool { store.can("status") }
    private var current: Color { Palette.color(store.mode) }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                hero
                modeButtons
                if !canChange { Label("Je hebt geen recht om de status te wijzigen.", systemImage: "lock.fill").font(.footnote).foregroundStyle(.secondary) }
                if showDuration { durationCard }
                if showExtend { extendCard }
                if showMessage { messageCard }
                if showToggles { togglesCard }
                if showPlanner { plannerCard }
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 40)
        }
        .refreshable { try? await store.refresh() }
        .background(background)
        .sheet(isPresented: $showCustom) { customSheet }
        .confirmationDialog("De deur zetten op \(DoorModeKind(rawValue: pendingMode ?? "")?.label ?? "")?", isPresented: Binding(get: { pendingMode != nil }, set: { if !$0 { pendingMode = nil } }), titleVisibility: .visible) {
            Button("Ja, zet de deur om") { if let m = pendingMode { apply(m) }; pendingMode = nil }
            Button("Annuleren", role: .cancel) { pendingMode = nil }
        }
        .onAppear { if !noteLoaded { note = store.state.settings.note.str; noteLoaded = true } }
    }

    private var background: some View {
        ZStack {
            Color.black
            if colorTheme && store.hasState { RadialGradient(colors: [current.opacity(0.28), .clear], center: .top, startRadius: 10, endRadius: 520) }
        }.ignoresSafeArea().animation(.easeInOut(duration: 0.8), value: store.mode)
    }

    // MARK: status card
    private var hero: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Circle().fill(current).frame(width: 12, height: 12).shadow(color: current, radius: 8)
                Text(store.name).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                connectionPill
            }
            Text(store.hasState ? store.label : "…").font(.system(size: 64, weight: .heavy, design: .rounded)).foregroundStyle(current)
                .minimumScaleFactor(0.5).lineLimit(1).contentTransition(.opacity)
            TimelineView(.periodic(from: .now, by: 20)) { _ in
                VStack(alignment: .leading, spacing: 4) {
                    Text(untilLine).font(.title3.weight(.semibold))
                    if !store.message.isEmpty { Text(store.message).font(.subheadline).foregroundStyle(.secondary) }
                }
            }
            HStack(spacing: 8) {
                tag(sourceText, symbol: "tag.fill")
                if store.newCount > 0 { tag("\(store.newCount) nieuw", symbol: "bell.badge.fill") }
            }
        }
        .card(20)
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(current.opacity(0.35), lineWidth: 1.5))
    }

    private var untilLine: String {
        guard store.hasState else { return "Verbinden met de deurserver…" }
        guard let until = store.until else { return "Geen eindtijd" }
        let left = until.timeIntervalSinceNow
        let then = store.state.view.then.string
        let thenLabel = store.state.view.thenLabel.string ?? ""
        if let then, left > 0 {
            let word = then == "closed" ? "gaan we sluiten" : then == "open" ? "zijn we weer open" : "zijn we \(thenLabel.lowercased())"
            return "Over \(durationText(left)) \(word) (\(until.whenText))"
        }
        return "Tot \(until.whenText)"
    }

    private var sourceText: String {
        switch store.source { case "manual": return "Handmatig"; case "hours": return "Openingstijden"; case "planned": return "Gepland"; default: return "Standaard" }
    }

    private func tag(_ text: String, symbol: String) -> some View {
        Label(text, systemImage: symbol).font(.caption.weight(.semibold))
            .padding(.horizontal, 10).padding(.vertical, 6).background(Color.white.opacity(0.1), in: Capsule())
    }

    private var connectionPill: some View {
        HStack(spacing: 5) {
            Circle().fill(store.connection == .live ? Palette.open : store.connection == .connecting ? Palette.busy : Palette.closed).frame(width: 8, height: 8)
            Text(store.connection == .live ? "Live" : store.connection == .connecting ? "Verbinden" : "Offline").font(.caption.weight(.semibold))
        }.padding(.horizontal, 10).padding(.vertical, 5).background(Color.white.opacity(0.1), in: Capsule())
    }

    // MARK: the three big buttons
    private var modeButtons: some View {
        let layout = largeButtons ? AnyLayout(VStackLayout(spacing: 12)) : AnyLayout(HStackLayout(spacing: 12))
        return layout {
            ForEach(DoorModeKind.allCases) { m in
                let active = store.mode == m.rawValue
                Button {
                    Haptics.tap()
                    if confirmStatus { pendingMode = m.rawValue } else { apply(m.rawValue) }
                } label: {
                    VStack(spacing: 8) {
                        Image(systemName: m.symbol).font(.system(size: largeButtons ? 34 : 28, weight: .semibold))
                        Text(m.label).font(.headline)
                        if !largeButtons { Text(durationShort).font(.caption2).opacity(0.7).lineLimit(1) }
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, largeButtons ? 26 : 20)
                    .background(active ? Palette.color(m.rawValue) : Color.white.opacity(0.09), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .foregroundStyle(active ? Color.black : Palette.color(m.rawValue))
                }
                .buttonStyle(.plain).disabled(!canChange).opacity(canChange ? 1 : 0.5)
            }
        }
    }

    private var durationShort: String {
        switch duration { case .none: return "geen eindtijd"; case .minutes(let n): return n >= 60 && n % 60 == 0 ? "\(n / 60) uur" : "\(n) min"; case .until(let d): return "tot \(d.hm)" }
    }

    private func apply(_ mode: String) {
        Task {
            switch duration {
            case .none: await store.setStatus(mode)
            case .minutes(let n): await store.setStatus(mode, minutes: n)
            case .until(let d): await store.setStatus(mode, until: d)
            }
        }
    }

    // MARK: how long
    private var durationCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Tot wanneer?", symbol: "clock")
            Flow(spacing: 8) {
                Chip(text: "Geen eindtijd", selected: duration == .none) { duration = .none }
                ForEach(presets, id: \.self) { n in
                    Chip(text: n >= 60 && n % 60 == 0 ? "\(n / 60) uur" : "\(n) min", selected: duration == .minutes(n)) { duration = .minutes(n) }
                }
                Chip(text: customLabel, symbol: "clock.badge", selected: { if case .until = duration { return true } else { return false } }()) { showCustom = true }
            }
            Text("Kies hoe lang, tik dan op Open, Gesloten of Bezet.").font(.footnote).foregroundStyle(.secondary)
        }.card()
    }

    private var customLabel: String { if case .until(let d) = duration { return "Tot \(d.hm)" }; return "Tot een tijd…" }

    private var customSheet: some View {
        NavigationStack {
            VStack(spacing: 20) {
                DatePicker("Eindtijd", selection: $customTime, displayedComponents: [.hourAndMinute]).datePickerStyle(.wheel).labelsHidden()
                Button("Gebruik deze tijd") {
                    var t = customTime
                    if t <= Date() { t = Calendar.current.date(byAdding: .day, value: 1, to: t) ?? t }
                    duration = .until(t); showCustom = false
                }.buttonStyle(PrimaryButton())
                Spacer()
            }.padding(20).navigationTitle("Tot hoe laat?").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Sluiten") { showCustom = false } } }
        }.presentationDetents([.medium]).preferredColorScheme(.dark)
    }

    // MARK: extend / back to normal
    private var extendCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Snel aanpassen", symbol: "bolt.fill")
            Flow(spacing: 8) {
                ForEach([15, 30, 60], id: \.self) { n in
                    Chip(text: n >= 60 ? "1 uur" : "\(n) min", symbol: "plus") {
                        let base = max(store.until ?? Date(), Date())
                        Task { await store.setStatus(store.mode, until: base.addingTimeInterval(Double(n) * 60)) }
                    }
                }
                if store.source == "manual" {
                    Chip(text: "Volg openingstijden", symbol: "calendar.badge.clock") {
                        Task { await store.run("Volgt de openingstijden") { _ = try await store.post("api/status/auto") } }
                    }
                }
                if store.mode == "busy" {
                    Chip(text: "Bezet beëindigen", symbol: "xmark.circle") {
                        Task { await store.run("Bezet beëindigd") { _ = try await store.post("api/busy/end") } }
                    }
                }
            }
        }.card().disabled(!canChange)
    }

    // MARK: message on the door
    private var messageCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Bericht op de deur", symbol: "text.bubble")
            TextField("Bijv. “Pakketjes bij de buren”", text: $note, axis: .vertical).lineLimit(1...3)
                .padding(12).background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            HStack {
                Button("Plaatsen") { send(note) }.buttonStyle(PrimaryButton()).disabled(note.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Wissen") { note = ""; send("") }.buttonStyle(PrimaryButton(tint: Color.white.opacity(0.12), fg: .white))
            }
            let recent = recentText.split(separator: "\n").map(String.init)
            if !recent.isEmpty {
                Flow(spacing: 8) { ForEach(recent, id: \.self) { r in Chip(text: r) { note = r; send(r) } } }
            }
        }.card().disabled(!canChange)
    }

    private func send(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty {
            var list = recentText.split(separator: "\n").map(String.init).filter { $0 != t }
            list.insert(t, at: 0)
            recentText = list.prefix(6).joined(separator: "\n")
        }
        Task { await store.setNote(t) }
    }

    // MARK: switches
    private func toggle(_ title: String, _ symbol: String, _ key: String, _ field: String) -> some View {
        Toggle(isOn: Binding(get: { store.state.settings[key][field].bool }, set: { v in Task { await store.changeSetting(key, field, v) } })) {
            Label(title, systemImage: symbol)
        }.tint(.green)
    }

    private var togglesCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle("Op het deurscherm", symbol: "switch.2").padding(.bottom, 8)
            VStack(spacing: 12) {
                toggle("Deurbel", "bell.fill", "visitors", "doorbell")
                toggle("Tijd booken", "calendar", "visitors", "appointments")
                toggle("Vraagje", "bubble.left.fill", "visitors", "messages")
                toggle("Redenen tonen", "list.bullet", "visitors", "reasons")
                toggle("Bel ook bij Gesloten of Bezet", "bell.badge", "visitors", "bellWhenBlocked")
                Divider().overlay(Color.white.opacity(0.1))
                toggle("Openingstijden volgen", "calendar.badge.clock", "hours", "enabled")
                toggle("Scherm dimmen ’s nachts", "moon.fill", "dim", "enabled")
            }
        }.card().disabled(!store.can("settings"))
    }

    // MARK: planned busy
    private var plannerCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Bezet inplannen", symbol: "calendar.badge.plus")
            ForEach(store.busy) { b in
                HStack {
                    Image(systemName: "clock.fill").foregroundStyle(Palette.busy)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(b.from.whenText) – \(b.to.hm)").font(.subheadline.weight(.semibold))
                        if !b.note.isEmpty { Text(b.note).font(.caption).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    Button(role: .destructive) { Task { await store.run("Verwijderd") { _ = try await store.post("api/busy/remove", ["id": b.id]) } } } label: { Image(systemName: "trash") }
                }
            }
            if store.busy.isEmpty { Text("Niets ingepland.").font(.footnote).foregroundStyle(.secondary) }
            Divider().overlay(Color.white.opacity(0.1))
            DatePicker("Van", selection: $planFrom, displayedComponents: [.date, .hourAndMinute])
            DatePicker("Tot", selection: $planTo, displayedComponents: [.date, .hourAndMinute])
            TextField("Waarvoor? (optioneel)", text: $planNote)
                .padding(12).background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            Button("Inplannen") {
                Task {
                    await store.run("Bezet ingepland") { _ = try await store.post("api/busy/add", ["from": ms(planFrom), "to": ms(planTo), "note": planNote]) }
                    planNote = ""
                }
            }.buttonStyle(PrimaryButton(tint: Palette.busy))
        }.card().disabled(!canChange)
    }
}
