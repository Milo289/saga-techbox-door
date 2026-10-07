import Foundation

enum DoorModeKind: String, CaseIterable, Identifiable {
    case open, closed, busy
    var id: String { rawValue }
    var label: String { switch self { case .open: return "Open"; case .closed: return "Gesloten"; case .busy: return "Bezet" } }
    var symbol: String { switch self { case .open: return "door.left.hand.open"; case .closed: return "door.left.hand.closed"; case .busy: return "clock.fill" } }
}

struct VisitRequest: Identifiable, Equatable {
    let id: String
    let type: String
    let name: String
    let nr: String
    let topic: String
    let message: String
    let reason: String
    let email: String
    let state: String
    let reply: String
    let at: Date?
    let createdAt: Date
    let repliedAt: Date?
    let autoReplied: Bool

    init(_ j: JSON) {
        id = j.id.str; type = j.type.str; name = j.name.str; nr = j.nr.str; topic = j.topic.str
        message = j.message.str; reason = j.reason.str; email = j.email.str; state = j.state.str; reply = j.reply.str
        at = j.at.date; createdAt = j.createdAt.date ?? Date(); repliedAt = j.repliedAt.date; autoReplied = j.autoReplied.bool
    }

    var typeLabel: String {
        switch type { case "bell": return "Aangebeld"; case "appointment": return "Tijd boeken"; case "message": return "Vraagje"; default: return "Verzoek" }
    }
    var symbol: String {
        switch type { case "bell": return "bell.fill"; case "appointment": return "calendar"; case "message": return "bubble.left.fill"; default: return "hand.raised.fill" }
    }
    var isOpen: Bool { state == "new" || state == "seen" }
    var summary: String {
        [topic.isEmpty ? nil : topic, message.isEmpty ? nil : message, reason.isEmpty ? nil : reason].compactMap { $0 }.joined(separator: " — ")
    }
}

struct BusyBlock: Identifiable {
    let id: String
    let from: Date
    let to: Date
    let note: String
    init(_ j: JSON) { id = j.id.str; from = j.from.date ?? Date(); to = j.to.date ?? Date(); note = j.note.str }
}

struct HistoryLine: Identifiable {
    let id = UUID()
    let at: Date
    let type: String
    let text: String
    let by: String
    init(_ j: JSON) { at = j.at.date ?? Date(); type = j.type.str; text = j.text.str; by = j.by.str }
}

extension Date {
    /// "15:30" — 24 hours, Dutch.
    var hm: String { Self.hmFormatter.string(from: self) }
    private static let hmFormatter: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "nl_NL"); f.dateFormat = "HH:mm"; return f
    }()
    /// "vandaag 15:30", "morgen 09:00", "ma 09:00"
    var whenText: String {
        let cal = Calendar.current
        if cal.isDateInToday(self) { return hm }
        if cal.isDateInTomorrow(self) { return "morgen \(hm)" }
        let f = DateFormatter(); f.locale = Locale(identifier: "nl_NL"); f.dateFormat = "EEE d MMM"
        return "\(f.string(from: self)) \(hm)"
    }
    var ago: String {
        let s = Int(-timeIntervalSinceNow)
        if s < 60 { return "zojuist" }
        if s < 3600 { return "\(s / 60) min geleden" }
        if s < 86400 { return "\(s / 3600) uur geleden" }
        return whenText
    }
}

func durationText(_ seconds: TimeInterval) -> String {
    let mins = max(1, Int((seconds / 60).rounded(.up)))
    if mins < 60 { return mins == 1 ? "1 minuut" : "\(mins) minuten" }
    let h = mins / 60, r = mins % 60
    return r == 0 ? "\(h) uur" : "\(h) uur en \(r) min"
}
