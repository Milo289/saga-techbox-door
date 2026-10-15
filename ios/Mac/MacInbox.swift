import SwiftUI

/// Visitors: the list on the left, the chosen visitor with reply and actions on the right.
struct MacInbox: View {
    @ObservedObject var store: DoorStore
    @State private var selection: String?
    @State private var showDone = false
    @State private var query = ""

    private var list: [VisitRequest] {
        let base = showDone ? store.requests : store.openRequests
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? base : base.filter { ($0.name + " " + $0.summary + " " + $0.nr + " " + $0.typeLabel).lowercased().contains(q) }
    }

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                TextField("Zoeken in bezoekers", text: $query).textFieldStyle(.roundedBorder).padding([.horizontal, .top], 10).padding(.bottom, 6)
                List(list, selection: $selection) { r in row(r).tag(r.id) }
                    .overlay { if list.isEmpty { ContentUnavailableView("Niemand wacht", systemImage: "bell.slash", description: Text("Nieuwe bezoekers verschijnen hier meteen.")) } }
                Divider()
                HStack {
                    Toggle("Ook afgehandeld", isOn: $showDone).toggleStyle(.checkbox)
                    Spacer()
                    Menu {
                        Button("Exporteren als CSV…") { CSV.export(store.requests) }
                        Divider()
                        Button("Alles als gezien") { Task { await store.run("Gezien") { _ = try await store.post("api/requests/seen") } } }
                        Button("Afgehandelde wissen", role: .destructive) { Task { await store.run("Gewist") { _ = try await store.post("api/requests/clear") } } }
                    } label: { Image(systemName: "ellipsis.circle") }.menuStyle(.borderlessButton).fixedSize()
                }.padding(10)
            }.frame(minWidth: 280, idealWidth: 320, maxWidth: 420)
            Group {
                if let id = selection, let r = store.requests.first(where: { $0.id == id }) { MacRequestDetail(store: store, request: r).id(r.id) }
                else { ContentUnavailableView("Kies een bezoeker", systemImage: "person.crop.circle", description: Text("Dan kun je antwoorden, een afspraak bevestigen of iemand blokkeren.")) }
            }.frame(minWidth: 380, maxWidth: .infinity)
        }
        .navigationTitle("Bezoekers")
        .onChange(of: store.newCount) { _, _ in }
        .onAppear { if UserDefaults.standard.bool(forKey: Pref.autoSeen) { Task { try? await store.post("api/requests/seen") } } }
    }

    private func row(_ r: VisitRequest) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: r.symbol).foregroundStyle(r.state == "new" ? Palette.accent : .secondary).frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(r.name.isEmpty ? "Anoniem" : r.name).font(.headline)
                    if r.state == "new" { Text("NIEUW").font(.caption2.bold()).padding(.horizontal, 5).padding(.vertical, 1).background(Palette.accent, in: Capsule()).foregroundStyle(.black) }
                    Spacer()
                    Text(r.createdAt.ago).font(.caption).foregroundStyle(.secondary)
                }
                Text(r.typeLabel + (r.summary.isEmpty ? "" : " — \(r.summary)")).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                if !r.flagged.isEmpty { Label("Gemarkeerd", systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.orange) }
            }
        }.padding(.vertical, 4)
    }
}

struct MacRequestDetail: View {
    @ObservedObject var store: DoorStore
    let request: VisitRequest
    @State private var reply = ""
    @State private var apptTime = Date()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 14) {
                    Image(systemName: request.symbol).font(.system(size: 34)).foregroundStyle(Palette.accent)
                    VStack(alignment: .leading) {
                        Text(request.name.isEmpty ? "Anoniem" : request.name).font(.title.bold())
                        Text("\(request.typeLabel) · \(request.createdAt.ago)").foregroundStyle(.secondary)
                    }
                    Spacer()
                    Menu {
                        Button("Blokkeer 1 uur") { block(60) }
                        Button("Blokkeer 1 dag") { block(1440) }
                        Divider()
                        Button("Bericht verwijderen", role: .destructive) { Task { await store.run("Bericht verwijderd") { _ = try await store.post("api/requests/delete", ["id": request.id]) } } }
                    } label: { Label("Meer", systemImage: "ellipsis.circle") }.fixedSize()
                }
                if !request.summary.isEmpty { Text(request.summary).font(.title3).padding(14).frame(maxWidth: .infinity, alignment: .leading).background(.quaternary, in: RoundedRectangle(cornerRadius: 12)) }
                if !request.flagged.isEmpty { Label("Gemarkeerd door het filter: \(request.flagged.joined(separator: ", "))", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
                VStack(alignment: .leading, spacing: 6) {
                    if let at = request.at { Label("Gevraagde tijd: \(at.whenText)", systemImage: "calendar") }
                    if !request.nr.isEmpty { Label("Nummer \(request.nr)", systemImage: "number") }
                    if !request.email.isEmpty { Label(request.email, systemImage: "envelope") }
                    if !request.phone.isEmpty { Label("Bel terug: \(request.phone)\(request.whenText.isEmpty ? "" : " (\(request.whenText))")", systemImage: "phone.fill") }
                }.foregroundStyle(.secondary)
                if !request.reply.isEmpty { Label(request.reply, systemImage: "arrowshape.turn.up.left.fill").foregroundStyle(Palette.accent) }

                if request.type == "appointment" {
                    GroupBox("Afspraak") {
                        HStack { DatePicker("Tijd", selection: $apptTime, displayedComponents: [.date, .hourAndMinute]); Spacer()
                            Button("Bevestig afspraak") { Task { await store.run("Afspraak bevestigd") { _ = try await store.post("api/requests/accept", ["id": request.id, "at": ms(apptTime)]) } } }.buttonStyle(.borderedProminent) }.padding(6)
                    }
                }
                GroupBox("Antwoord op de deur") {
                    VStack(alignment: .leading, spacing: 10) {
                        Flow(spacing: 8) { ForEach(store.quickReplies, id: \.self) { q in Button(q) { send(q) }.buttonStyle(.bordered) } }
                        HStack {
                            TextField("Typ een antwoord…", text: $reply).textFieldStyle(.roundedBorder).onSubmit { send(reply) }
                            Button("Versturen") { send(reply) }.buttonStyle(.borderedProminent).disabled(reply.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }.padding(6)
                }
                if request.isOpen {
                    Button("Afhandelen") { Task { await store.run("Afgehandeld") { _ = try await store.post("api/requests/done", ["id": request.id]) } } }.controlSize(.large)
                }
            }.padding(24)
        }
    }

    private func send(_ t: String) {
        let text = t.trimmingCharacters(in: .whitespaces); guard !text.isEmpty else { return }
        Task { await store.run("Getoond op de deur") { _ = try await store.post("api/requests/reply", ["id": request.id, "reply": text]) }; reply = "" }
    }
    private func block(_ minutes: Int) { Task { await store.run("Geblokkeerd") { _ = try await store.post("api/moderation/block", ["id": request.id, "minutes": minutes]) } } }
}
