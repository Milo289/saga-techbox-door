import SwiftUI
import AudioToolbox

/// Everything you can switch on or off in the app itself (Instellingen → Deze app).
enum Pref {
    static let haptics = "p.haptics"
    static let sounds = "p.sounds"
    static let notifyVisits = "p.notifyVisits"
    static let badge = "p.badge"
    static let keepAwake = "p.keepAwake"
    static let confirmStatus = "p.confirmStatus"
    static let confirmLockdown = "p.confirmLockdown"
    static let showDuration = "p.showDuration"
    static let showMessage = "p.showMessage"
    static let showToggles = "p.showToggles"
    static let showPlanner = "p.showPlanner"
    static let showExtend = "p.showExtend"
    static let largeButtons = "p.largeButtons"
    static let statusColorTheme = "p.statusColorTheme"
    static let compactInbox = "p.compactInbox"
    static let autoSeen = "p.autoSeen"
    static let autoLock = "p.autoLock"        // minutes; 0 = at once, -1 = never
    static let appearance = "p.appearance"    // system | dark | light
    static let presets = "p.presets"          // "15,30,60,120"
    static let startTab = "p.startTab"
    static let devMode = "p.devMode"
    static let verboseLog = "p.verboseLog"
    static let recentMessages = "p.recentMessages"
}

extension UserDefaults {
    func registerAppDefaults() {
        register(defaults: [
            Pref.haptics: true, Pref.sounds: true, Pref.notifyVisits: true, Pref.badge: true, Pref.keepAwake: false,
            Pref.confirmStatus: false, Pref.confirmLockdown: true,
            Pref.showDuration: true, Pref.showMessage: true, Pref.showToggles: true, Pref.showPlanner: true, Pref.showExtend: true,
            Pref.largeButtons: false, Pref.statusColorTheme: true, Pref.compactInbox: false, Pref.autoSeen: true,
            Pref.autoLock: 0, Pref.appearance: "dark", Pref.presets: "15,30,60,120", Pref.startTab: "status",
            Pref.devMode: false, Pref.verboseLog: false,
        ])
    }
}

enum Haptics {
    static var enabled: Bool { UserDefaults.standard.bool(forKey: Pref.haptics) }
    static func success() { if enabled { UINotificationFeedbackGenerator().notificationOccurred(.success) } }
    static func warning() { if enabled { UINotificationFeedbackGenerator().notificationOccurred(.warning) } }
    static func error() { if enabled { UINotificationFeedbackGenerator().notificationOccurred(.error) } }
    static func tap() { if enabled { UIImpactFeedbackGenerator(style: .light).impactOccurred() } }
    static func heavy() { if enabled { UIImpactFeedbackGenerator(style: .heavy).impactOccurred() } }
}

enum Sounds {
    static var enabled: Bool { UserDefaults.standard.bool(forKey: Pref.sounds) }
    static func bell() { if enabled { AudioServicesPlaySystemSound(1013) } }
    static func message() { if enabled { AudioServicesPlaySystemSound(1007) } }
}

/// The three door colours.
enum Palette {
    static let open = Color(red: 0.19, green: 0.82, blue: 0.35)
    static let closed = Color(red: 1.0, green: 0.27, blue: 0.23)
    static let busy = Color(red: 1.0, green: 0.62, blue: 0.04)
    static func color(_ mode: String) -> Color { mode == "open" ? open : mode == "closed" ? closed : mode == "busy" ? busy : .gray }
}

enum Build {
    /// True in the separate developer app (its own icon and name, installed next to the normal one).
    static var isDeveloperApp: Bool {
        #if DEVELOPER
        return true
        #else
        return false
        #endif
    }
    /// The developer tab shows in the developer app, or in the normal app once you switched developer mode on (tap the version 7 times).
    static var devEnabled: Bool { isDeveloperApp || UserDefaults.standard.bool(forKey: Pref.devMode) }
    static var configuration: String {
        #if DEBUG
        return "Debug"
        #else
        return "Release"
        #endif
    }
}
