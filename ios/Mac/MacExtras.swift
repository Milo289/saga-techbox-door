import SwiftUI
import AppKit

// Things this app can do that the web panel cannot: your own quick actions, quiet hours, today's numbers, search and export.

struct QuickAction: Codable, Identifiable, Hashable {
    var id = UUID()
    var name: String
    var mode: String          // open | closed | busy
    var minutes: Int          // 0 = until you change it
    var message: String
    var symbol: String
}

enum MacPref {
    static let appearance = "m.appearance"      // system | light | dark
    static let quick = "m.quick"
    static let quietOn = "m.quietOn"
    static let quietFrom = "m.quietFrom"        // minutes after midnight
    static let quietTo = "m.quietTo"
    static let showMenuCount = "m.menuCount"
}

enum QuickStore {
    static let defaults: [QuickAction] = [
        QuickAction(name: "Lunch", mode: "busy", minutes: 30, message: "Even lunch — over een half uur ben ik terug", symbol: "fork.knife"),
        QuickAction(name: "Vergadering", mode: "busy", minutes: 60, message: "In vergadering", symbol: "person.2.fill"),
        QuickAction(name: "Naar huis", mode: "closed", minutes: 0, message: "", symbol: "house.fill"),
    ]
    static func load() -> [QuickAction] {
        guard let d = UserDefaults.standard.data(forKey: MacPref.quick), let list = try? JSONDecoder().decode([QuickAction].self, from: d) else { return defaults }
        return list
    }
    static func save(_ list: [QuickAction]) { UserDefaults.standard.set(try? JSONEncoder().encode(list), forKey: MacPref.quick) }
}

extension DoorStore {
    func run(_ q: QuickAction) async { await setStatus(q.mode, minutes: q.minutes > 0 ? q.minutes : nil, message: q.message) }
}

extension String {
    var colorScheme: ColorScheme? { self == "light" ? .light : self == "dark" ? .dark : nil }
}

/// Quiet hours: no sound or notification for visitors between the two times.
enum Quiet {
    static var now: Bool {
        let d = UserDefaults.standard
        guard d.bool(forKey: MacPref.quietOn) else { return false }
        let from = d.object(forKey: MacPref.quietFrom) as? Int ?? 22 * 60, to = d.object(forKey: MacPref.quietTo) as? Int ?? 7 * 60
        let c = Calendar.current.dateComponents([.hour, .minute], from: Date()), m = (c.hour ?? 0) * 60 + (c.minute ?? 0)
        return from <= to ? (m >= from && m < to) : (m >= from || m < to)
    }
}

/// Today in numbers.
struct TodayStats {
    let visitors: Int, waiting: Int, bells: Int, averageReplyMinutes: Int?
    init(_ requests: [VisitRequest]) {
        let cal = Calendar.current
        let today = requests.filter { cal.isDateInToday($0.createdAt) }
        visitors = today.count; waiting = requests.filter(\.isOpen).count; bells = today.filter { $0.type == "bell" }.count
        let times = today.compactMap { r in r.repliedAt.map { $0.timeIntervalSince(r.createdAt) } }.filter { $0 >= 0 }
        averageReplyMinutes = times.isEmpty ? nil : max(1, Int((times.reduce(0, +) / Double(times.count) / 60).rounded()))
    }
}

struct StatTile: View {
    let value: String, label: String, symbol: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: symbol).foregroundStyle(Palette.accent)
            Text(value).font(.system(size: 28, weight: .bold, design: .rounded))
            Text(label).font(.caption).foregroundStyle(.secondary)
        }.padding(14).frame(maxWidth: .infinity, alignment: .leading).background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
    }
}

enum CSV {
    static func export(_ requests: [VisitRequest]) {
        func q(_ s: String) -> String { "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm"
        var out = "Tijd,Soort,Naam,Nummer,Onderwerp,Bericht,Antwoord,Status\n"
        for r in requests.sorted(by: { $0.createdAt < $1.createdAt }) {
            out += [f.string(from: r.createdAt), r.typeLabel, r.name, r.nr, r.topic, r.message, r.reply, r.state].map(q).joined(separator: ",") + "\n"
        }
        let panel = NSSavePanel(); panel.nameFieldStringValue = "bezoekers.csv"; panel.allowedContentTypes = [.commaSeparatedText]
        if panel.runModal() == .OK, let url = panel.url { try? out.write(to: url, atomically: true, encoding: .utf8) }
    }
}
