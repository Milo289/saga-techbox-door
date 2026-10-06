import AppIntents

/// Siri and the Shortcuts app: "Zet de deur op open met Deur Beheer", automations, widgets of your own.
enum DoorMode: String, AppEnum {
    case open, closed, busy
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Status"
    static var caseDisplayRepresentations: [DoorMode: DisplayRepresentation] = [.open: "Open", .closed: "Gesloten", .busy: "Bezet"]
}

struct SetDoorStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Zet de deurstatus"
    static var description = IntentDescription("Zet de deur op Open, Gesloten of Bezet.")
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Status") var mode: DoorMode
    static var parameterSummary: some ParameterSummary { Summary("Zet de deur op \(\.$mode)") }

    init() {}
    init(mode: DoorMode) { self.mode = mode }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let api = DoorApi.configured() else { throw DoorApi.Failure.noServer }
        try await api.setStatus(mode.rawValue)
        return .result(dialog: "De deur staat op \(mode == .open ? "open" : mode == .closed ? "gesloten" : "bezet").")
    }
}

struct LockdownIntent: AppIntent {
    static var title: LocalizedStringResource = "Noodstop"
    static var description = IntentDescription("Deur dicht, paneel vergrendeld en alle anderen uitgelogd.")
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let api = DoorApi.configured() else { throw DoorApi.Failure.noServer }
        try await api.lockdown()
        return .result(dialog: "Noodstop actief. De deur is dicht en het paneel is vergrendeld.")
    }
}

struct DoorShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: SetDoorStatusIntent(mode: .open), phrases: ["Zet de deur op open met \(.applicationName)"], shortTitle: "Deur open", systemImageName: "door.left.hand.open")
        AppShortcut(intent: SetDoorStatusIntent(mode: .closed), phrases: ["Zet de deur op gesloten met \(.applicationName)"], shortTitle: "Deur gesloten", systemImageName: "door.left.hand.closed")
        AppShortcut(intent: SetDoorStatusIntent(mode: .busy), phrases: ["Zet de deur op bezet met \(.applicationName)"], shortTitle: "Bezet", systemImageName: "clock")
        AppShortcut(intent: LockdownIntent(), phrases: ["Noodstop met \(.applicationName)"], shortTitle: "Noodstop", systemImageName: "exclamationmark.octagon")
    }
}
