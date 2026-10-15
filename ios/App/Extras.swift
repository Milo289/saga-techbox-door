import SwiftUI

// Things the apps can do that the web panel cannot: your own quick actions, quiet hours and today's numbers. Shared by the iPhone and the Mac app.

struct QuickPreset: Codable, Identifiable, Hashable {
    var id = UUID()
    var name: String
    var mode: String          // open | closed | busy
    var minutes: Int          // 0 = until you change it
    var message: String
    var symbol: String
}

enum ExtraPref {
    static let appearance = "m.appearance"      // system | light | dark (Mac)
    static let quick = "m.quick"
    static let quietOn = "m.quietOn"
    static let quietFrom = "m.quietFrom"        // minutes after midnight
    static let quietTo = "m.quietTo"
}

enum QuickStore {
    static let defaults: [QuickPreset] = [
        QuickPreset(name: "Lunch", mode: "busy", minutes: 30, message: "Even lunch — over een half uur ben ik terug", symbol: "fork.knife"),
        QuickPreset(name: "Vergadering", mode: "busy", minutes: 60, message: "In vergadering", symbol: "person.2.fill"),
        QuickPreset(name: "Naar huis", mode: "closed", minutes: 0, message: "", symbol: "house.fill"),
    ]
    static func load() -> [QuickPreset] {
        guard let d = UserDefaults.standard.data(forKey: ExtraPref.quick), let list = try? JSONDecoder().decode([QuickPreset].self, from: d) else { return defaults }
        return list
    }
    static func save(_ list: [QuickPreset]) { UserDefaults.standard.set(try? JSONEncoder().encode(list), forKey: ExtraPref.quick) }
}

extension DoorStore {
    func run(_ q: QuickPreset) async { await setStatus(q.mode, minutes: q.minutes > 0 ? q.minutes : nil, message: q.message) }
}

extension String {
    var colorScheme: ColorScheme? { self == "light" ? .light : self == "dark" ? .dark : nil }
}

/// Quiet hours: no sound or notification for visitors between the two times.
enum Quiet {
    static var now: Bool {
        let d = UserDefaults.standard
        guard d.bool(forKey: ExtraPref.quietOn) else { return false }
        let from = d.object(forKey: ExtraPref.quietFrom) as? Int ?? 22 * 60, to = d.object(forKey: ExtraPref.quietTo) as? Int ?? 7 * 60
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
            Text(value).font(.system(size: 26, weight: .bold, design: .rounded)).minimumScaleFactor(0.6).lineLimit(1)
            Text(label).font(.caption).foregroundStyle(.secondary).lineLimit(2)
        }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Color.gray.opacity(0.18), in: RoundedRectangle(cornerRadius: 14))
    }
}
