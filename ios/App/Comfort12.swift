import SwiftUI
import Charts

/// New in 3.5.0-beta.12, shared by the iPhone, the iPad and the Mac: how busy the door is, the first-run list, a test of the bell, and a star and an own note on a request.

private struct HourBar: Identifiable { let hour: Int; let n: Int; var id: Int { hour } }

/// "Drukte": a bar chart of the requests per hour of the day (the last 30 days), with the busiest hour and the average time to answer.
struct BusyChartCard: View {
    @ObservedObject var store: DoorStore
    @State private var stats = JSON(nil)
    @State private var failed = false

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                if stats.isNull {
                    Text(failed ? "De drukte kon niet worden geladen." : "Laden…").foregroundStyle(.secondary)
                } else {
                    let bars = stats.byHour.array.enumerated().map { HourBar(hour: $0.offset, n: $0.element.int ?? 0) }
                    Chart(bars) { b in
                        BarMark(x: .value("Uur", b.hour), y: .value("Verzoeken", b.n)).foregroundStyle(Palette.accent.gradient)
                    }
                    .chartXAxis { AxisMarks(values: [0, 6, 12, 18, 23]) { v in AxisGridLine(); AxisValueLabel { if let h = v.as(Int.self) { Text("\(h)u") } } } }
                    .frame(height: 110)
                    .accessibilityLabel("Verzoeken per uur van de dag")
                    HStack(spacing: 18) {
                        Label("\(stats.total.int ?? 0) verzoeken", systemImage: "person.2")
                        if (stats.total.int ?? 0) > 0 { Label(String(format: "drukste uur %02d:00", stats.busiestHour.int ?? 0), systemImage: "clock") }
                        if let m = stats.avgReplyMinutes.int { Label("antwoord in \(m) min", systemImage: "timer") }
                    }.font(.caption).foregroundStyle(.secondary)
                }
            }.padding(.vertical, 4)
        } label: { Label("Drukte, laatste 30 dagen", systemImage: "chart.bar.fill") }
        .task { await load() }
    }

    private func load() async {
        do { stats = try await store.call("GET", "api/stats"); failed = false } catch { failed = true }
    }
}

/// "Eerste keer instellen": what is switched on and what still has to be done (only shown while something is open).
struct ChecklistCard: View {
    @ObservedObject var store: DoorStore
    @State private var list = JSON(nil)

    var body: some View {
        Group {
            let items = list.items.array
            let open = items.filter { !$0.ok.bool }
            if !list.isNull, !open.isEmpty {
                GroupBox {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(open.enumerated()), id: \.offset) { _, i in
                            VStack(alignment: .leading, spacing: 2) {
                                Label(i.text.str, systemImage: "circle").font(.callout)
                                Text(i.tip.str).font(.caption).foregroundStyle(.secondary).padding(.leading, 28)
                            }
                        }
                        Text("Je regelt dit in het web-paneel van de server.").font(.caption2).foregroundStyle(.tertiary)
                    }.padding(.vertical, 4)
                } label: { Label("Eerste keer instellen: \(items.count - open.count) van \(items.count) klaar", systemImage: "checklist") }
            }
        }
        .task { list = (try? await store.call("GET", "api/checklist")) ?? JSON(nil) }
    }
}

/// Rings the bell on every door screen without making a request, to hear that the sound works.
struct TestBellButton: View {
    @ObservedObject var store: DoorStore
    var body: some View {
        Button {
            Task { await store.run("De bel is getest") { _ = try await store.post("api/bell/test") } }
        } label: { Label("Test de bel", systemImage: "bell.and.waves.left.and.right") }
        .disabled(!store.can("status"))
    }
}

/// A star and an own note on a request (only the staff sees them), and how often this phone came before.
struct RequestExtras: View {
    @ObservedObject var store: DoorStore
    let request: VisitRequest
    @State private var note = ""

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                Toggle(isOn: Binding(get: { request.starred }, set: { on in
                    Task { await store.run(on ? "Ster erbij" : "Ster weg") { _ = try await store.post("api/requests/star", ["id": request.id, "on": on]) } }
                })) { Label("Met ster", systemImage: request.starred ? "star.fill" : "star").foregroundStyle(request.starred ? Color.yellow : Color.primary) }
                if request.visits > 1 { Label("\(request.visits)e keer van deze telefoon", systemImage: "arrow.triangle.2.circlepath").font(.subheadline).foregroundStyle(.secondary) }
                TextField("Notitie (alleen jij ziet die)", text: $note, axis: .vertical).lineLimit(1...4).textFieldStyle(.roundedBorder)
                Button("Notitie bewaren") {
                    Task { await store.run("Notitie bewaard") { _ = try await store.post("api/requests/note", ["id": request.id, "text": note]) } }
                }.disabled(note == request.note)
            }.padding(.vertical, 4)
        } label: { Label("Voor jezelf", systemImage: "person.crop.circle.badge.checkmark") }
        .onAppear { note = request.note }
    }
}
