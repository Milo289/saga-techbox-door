import SwiftUI

struct InboxView: View {
    @ObservedObject var store: DoorStore
    @AppStorage(Pref.compactInbox) private var compact = false
    @AppStorage(Pref.autoSeen) private var autoSeen = true
    @State private var showAll = false
    @State private var selected: VisitRequest?

    private var list: [VisitRequest] { showAll ? store.requests : store.openRequests }

    var body: some View {
        NavigationStack {
            Group {
                if !store.can("inbox") {
                    ContentUnavailableView("Geen toegang", systemImage: "lock.fill", description: Text("Je account mag de bezoekers niet zien."))
                } else if list.isEmpty {
                    ContentUnavailableView(showAll ? "Nog niets" : "Alles is afgehandeld", systemImage: "tray", description: Text("Als iemand op de deur een knop aantikt, zie je het hier meteen."))
                } else {
                    List {
                        ForEach(list) { r in
                            Button { selected = r } label: { row(r) }.buttonStyle(.plain)
                                .listRowBackground(Color.white.opacity(0.06))
                                .swipeActions(edge: .trailing) {
                                    if r.isOpen { Button { Task { await store.run("Afgehandeld") { _ = try await store.post("api/requests/done", ["id": r.id]) } } } label: { Label("Klaar", systemImage: "checkmark") }.tint(.green) }
                                }
                        }
                    }.scrollContentBackground(.hidden)
                }
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Bezoekers")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("", selection: $showAll) { Text("Open").tag(false); Text("Alles").tag(true) }.pickerStyle(.segmented).frame(width: 180)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { Task { await store.run("Gezien") { _ = try await store.post("api/requests/seen") } } } label: { Label("Alles als gezien", systemImage: "eye") }
                        Button(role: .destructive) { Task { await store.run("Gewist") { _ = try await store.post("api/requests/clear") } } } label: { Label("Afgehandelde wissen", systemImage: "trash") }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
            .refreshable { try? await store.refresh() }
            .sheet(item: $selected) { r in RequestDetail(store: store, request: store.requests.first { $0.id == r.id } ?? r) }
            .onAppear { markSeen() }
            .onChange(of: store.newCount) { _, n in if n > 0 { markSeen() } }
        }
    }

    private func markSeen() {
        guard autoSeen, store.newCount > 0, store.can("inbox") else { return }
        Task { try? await store.post("api/requests/seen") }
    }

    private func row(_ r: VisitRequest) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: r.symbol).font(.title3).foregroundStyle(r.state == "new" ? Palette.open : .secondary).frame(width: 30)
            VStack(alignment: .leading, spacing: compact ? 2 : 5) {
                HStack {
                    Text(r.name.isEmpty ? "Anoniem" : r.name).font(.headline).foregroundStyle(.white)
                    if r.state == "new" { Text("NIEUW").font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 2).background(Palette.open, in: Capsule()).foregroundStyle(.black) }
                    Spacer()
                    Text(r.createdAt.ago).font(.caption).foregroundStyle(.secondary)
                }
                Text(r.typeLabel + (r.summary.isEmpty ? "" : " — \(r.summary)")).font(.subheadline).foregroundStyle(.secondary).lineLimit(compact ? 1 : 3)
                if !r.flagged.isEmpty { Label("Gemarkeerd: \(r.flagged.joined(separator: ", "))", systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(Palette.busy) }
                if !compact, !r.reply.isEmpty { Label(r.reply, systemImage: r.autoReplied ? "sparkles" : "arrowshape.turn.up.left.fill").font(.caption).foregroundStyle(Palette.open).lineLimit(2) }
            }
        }.padding(.vertical, compact ? 2 : 6)
    }
}

struct RequestDetail: View {
    @ObservedObject var store: DoorStore
    let request: VisitRequest
    @Environment(\.dismiss) private var dismiss
    @State private var reply = ""
    @State private var apptTime = Date()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 14) {
                        Image(systemName: request.symbol).font(.largeTitle).foregroundStyle(Palette.open)
                        VStack(alignment: .leading) {
                            Text(request.name.isEmpty ? "Anoniem" : request.name).font(.title2.bold())
                            Text("\(request.typeLabel) · \(request.createdAt.ago)").foregroundStyle(.secondary)
                        }
                    }
                    if !request.summary.isEmpty { Text(request.summary).font(.title3).card() }
                    if !request.flagged.isEmpty { Label("Gemarkeerd door het filter: \(request.flagged.joined(separator: ", "))", systemImage: "exclamationmark.triangle.fill").font(.subheadline).foregroundStyle(Palette.busy) }
                    if !request.phone.isEmpty, let url = URL(string: "tel:" + request.phone.filter { "0123456789+".contains($0) }) {
                        Link(destination: url) { Label("Bel \(request.phone)", systemImage: "phone.fill").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 12) }
                            .buttonStyle(.borderedProminent).tint(Palette.open).foregroundStyle(.black)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        if let at = request.at { Label("Gevraagde tijd: \(at.whenText)", systemImage: "calendar") }
                        if !request.nr.isEmpty { Label("Nummer \(request.nr)", systemImage: "number") }
                        if !request.email.isEmpty { Label(request.email, systemImage: "envelope") }
                    }.font(.subheadline).foregroundStyle(.secondary)
                    if !request.reply.isEmpty { Label(request.reply, systemImage: "arrowshape.turn.up.left.fill").foregroundStyle(Palette.open).card() }

                    if request.type == "appointment" {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionTitle("Afspraak", symbol: "calendar.badge.checkmark")
                            DatePicker("Tijd", selection: $apptTime, displayedComponents: [.date, .hourAndMinute])
                            Button("Bevestig afspraak") {
                                Task { await store.run("Afspraak bevestigd") { _ = try await store.post("api/requests/accept", ["id": request.id, "at": ms(apptTime)]) }; dismiss() }
                            }.buttonStyle(PrimaryButton(tint: Palette.open))
                        }.card()
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        SectionTitle("Antwoord op de deur", symbol: "arrowshape.turn.up.left")
                        Flow(spacing: 8) { ForEach(store.quickReplies, id: \.self) { q in Chip(text: q) { send(q) } } }
                        TextField("Typ een antwoord…", text: $reply, axis: .vertical).lineLimit(1...3)
                            .padding(12).background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        Button("Versturen") { send(reply) }.buttonStyle(PrimaryButton()).disabled(reply.trimmingCharacters(in: .whitespaces).isEmpty)
                    }.card()

                    if request.isOpen {
                        Button("Afhandelen") { Task { await store.run("Afgehandeld") { _ = try await store.post("api/requests/done", ["id": request.id]) }; dismiss() } }
                            .buttonStyle(PrimaryButton(tint: Color.white.opacity(0.12), fg: .white))
                    }
                }.padding(16)
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Bezoeker").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Button { block(60) } label: { Label("Blokkeer 1 uur", systemImage: "hand.raised") }
                        Button { block(1440) } label: { Label("Blokkeer 1 dag", systemImage: "hand.raised") }
                        Button { block(0) } label: { Label("Blokkeer voor altijd", systemImage: "hand.raised.fill") }
                        Divider()
                        Button(role: .destructive) { Task { await store.run("Bericht verwijderd") { _ = try await store.post("api/requests/delete", ["id": request.id]) }; dismiss() } } label: { Label("Bericht verwijderen", systemImage: "trash") }
                    } label: { Label("Modereren", systemImage: "shield.lefthalf.filled") }
                }
                ToolbarItem(placement: .topBarTrailing) { Button("Sluiten") { dismiss() } }
            }
            .onAppear { apptTime = request.at ?? Date().addingTimeInterval(3600) }
        }.preferredColorScheme(.dark).presentationDetents([.large])
    }

    private func block(_ minutes: Int) {
        Task { await store.run("Geblokkeerd") { _ = try await store.post("api/moderation/block", ["id": request.id, "minutes": minutes]) } }
    }

    private func send(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        Task { await store.run("Getoond op de deur") { _ = try await store.post("api/requests/reply", ["id": request.id, "reply": t]) }; reply = "" }
    }
}
