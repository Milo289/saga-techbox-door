import SwiftUI
import AudioToolbox
#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
#endif

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
    static let accentHex = "p.accentHex"   // this device's own accent colour (empty = follow the server)
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
    #if os(iOS)
    static func success() { if enabled { UINotificationFeedbackGenerator().notificationOccurred(.success) } }
    static func warning() { if enabled { UINotificationFeedbackGenerator().notificationOccurred(.warning) } }
    static func error() { if enabled { UINotificationFeedbackGenerator().notificationOccurred(.error) } }
    static func tap() { if enabled { UIImpactFeedbackGenerator(style: .light).impactOccurred() } }
    static func heavy() { if enabled { UIImpactFeedbackGenerator(style: .heavy).impactOccurred() } }
    #else
    // a Mac trackpad has a light tap feedback of its own
    private static func buzz() { if enabled { NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now) } }
    static func success() { buzz() }
    static func warning() { buzz() }
    static func error() { buzz() }
    static func tap() { buzz() }
    static func heavy() { buzz() }
    #endif
}

enum Sounds {
    static var enabled: Bool { UserDefaults.standard.bool(forKey: Pref.sounds) }
    #if os(iOS)
    static func bell() { if enabled { AudioServicesPlaySystemSound(1013) } }
    static func message() { if enabled { AudioServicesPlaySystemSound(1007) } }
    #else
    static func bell() { if enabled { NSSound(named: "Glass")?.play() } }
    static func message() { if enabled { NSSound(named: "Pop")?.play() } }
    #endif
}

/// The three door colours.
enum Palette {
    /// The colour theme chosen on the server (Ontwerp → Kleuren) overrides these; set whenever new data arrives.
    nonisolated(unsafe) static var override: [String: Color] = [:]
    nonisolated(unsafe) static var serverAccent: Color?
    static var open: Color { override["open"] ?? Color(red: 0.19, green: 0.82, blue: 0.35) }
    static var closed: Color { override["closed"] ?? Color(red: 1.0, green: 0.27, blue: 0.23) }
    static var busy: Color { override["busy"] ?? Color(red: 1.0, green: 0.62, blue: 0.04) }
    static func color(_ mode: String) -> Color { mode == "open" ? open : mode == "closed" ? closed : mode == "busy" ? busy : .gray }
    /// The colour of tabs, switches and buttons: this device's own choice, else the server's, else green.
    static var accent: Color {
        if let hex = UserDefaults.standard.string(forKey: Pref.accentHex), let c = Color(hex: hex) { return c }
        return serverAccent ?? Color(red: 0.19, green: 0.82, blue: 0.35)
    }
    static func apply(_ settings: JSON) {
        var o: [String: Color] = [:]
        for m in ["open", "closed", "busy"] { if let c = Color(hex: settings.colors[m].str) { o[m] = c } }
        override = o
        serverAccent = Color(hex: settings.accent.str)
    }
}

extension Color {
    /// "#0a84ff" → Color (nil when it is not a colour)
    init?(hex: String) {
        var h = hex.trimmingCharacters(in: .whitespaces)
        if h.hasPrefix("#") { h.removeFirst() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
    }
    var hexString: String {
        #if os(iOS)
        let u = UIColor(self); var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        u.getRed(&r, green: &g, blue: &b, alpha: &a)
        #else
        let u = NSColor(self).usingColorSpace(.sRGB) ?? .gray; let r = u.redComponent, g = u.greenComponent, b = u.blueComponent
        #endif
        return String(format: "#%02x%02x%02x", Int(r * 255), Int(g * 255), Int(b * 255))
    }
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
