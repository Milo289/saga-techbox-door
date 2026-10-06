import SwiftUI
import LocalAuthentication
import WebKit
import UserNotifications

enum QuickAction: String {
    case open, closed, busy, lockdown
    var title: String {
        switch self {
        case .open: return "Deur staat op Open"
        case .closed: return "Deur staat op Gesloten"
        case .busy: return "Deur staat op Bezet"
        case .lockdown: return "Noodstop actief — deur dicht, paneel vergrendeld"
        }
    }
}

@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    @Published var configured: Bool
    /// "control" = control panel (your own login, Face ID) · "door" = this iPad/iPhone is the door screen
    @Published var role: String
    @Published var locked: Bool
    @Published var showSettings = false
    @Published var toast: String?
    @Published var openRequests = 0
    @Published var faceID: Bool { didSet { UserDefaults.standard.set(faceID, forKey: "faceID") } }
    weak var webView: WKWebView?
    private var pendingAction: QuickAction?
    private var toastTask: Task<Void, Never>?

    init() {
        #if DEBUG
        // test aid, only in the test build: set up the app from the launch environment (no typing needed)
        let env = ProcessInfo.processInfo.environment
        if let server = env["DEUR_TEST_SERVER"], let user = env["DEUR_TEST_USER"], let pass = env["DEUR_TEST_PASS"] {
            UserDefaults.standard.set(server, forKey: "serverURL")
            UserDefaults.standard.set(false, forKey: "faceID")
            _ = Keychain.save(username: user, password: pass)
        }
        if let a = env["DEUR_TEST_ACTION"], let action = QuickAction(rawValue: a) { pendingAction = action }
        #endif
        let savedRole = UserDefaults.standard.string(forKey: "role") ?? "control"
        role = savedRole
        let has = DoorApi.configured() != nil && (savedRole == "door" || Keychain.load() != nil)
        configured = has
        faceID = UserDefaults.standard.object(forKey: "faceID") as? Bool ?? true
        locked = savedRole != "door" // a door screen has no login and no Face ID
    }

    var canLock: Bool { faceID && LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) }

    // MARK: Face ID lock
    func lockNow() { if configured && role == "control" && canLock { locked = true } }

    func unlock() async {
        guard configured, role == "control" else { locked = false; return }
        guard canLock else { locked = false; await runPending(); return }
        let ctx = LAContext()
        ctx.localizedCancelTitle = "Annuleren"
        do {
            if try await ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Ontgrendel Deur Beheer") {
                locked = false
                await runPending()
            }
        } catch { /* stays locked; the lock screen offers another try */ }
    }

    // MARK: Quick actions (home-screen icon) and Siri
    func handle(_ action: QuickAction) {
        pendingAction = action
        if !locked { Task { await runPending() } }
    }

    private func runPending() async {
        guard let action = pendingAction, configured, let api = DoorApi.configured() else { return }
        pendingAction = nil
        do {
            switch action {
            case .open: try await api.setStatus("open")
            case .closed: try await api.setStatus("closed")
            case .busy: try await api.setStatus("busy")
            case .lockdown: try await api.lockdown()
            }
            haptic(action == .lockdown ? .warning : .success)
            show(action.title)
        } catch {
            haptic(.error)
            show(error.localizedDescription)
        }
    }

    // MARK: small helpers
    func show(_ text: String) {
        toast = text
        toastTask?.cancel()
        toastTask = Task { try? await Task.sleep(nanoseconds: 3_500_000_000); if !Task.isCancelled { toast = nil } }
    }

    func haptic(_ kind: UINotificationFeedbackGenerator.FeedbackType) { UINotificationFeedbackGenerator().notificationOccurred(kind) }

    func setBadge(_ n: Int) {
        openRequests = n
        UNUserNotificationCenter.current().setBadgeCount(n)
    }

    func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.badge, .alert, .sound]) { _, _ in }
    }

    func notifyIfInBackground(title: String, body: String) {
        guard UIApplication.shared.applicationState != .active else { return }
        let content = UNMutableNotificationContent()
        content.title = title; content.body = body; content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }

    func reload() { webView?.reload() }

    func finishSetup() {
        UserDefaults.standard.set("control", forKey: "role")
        role = "control"
        configured = true
        locked = false
        requestNotificationPermission()
    }

    /// This device becomes the door screen: only the server address is needed.
    func finishDoorSetup() {
        UserDefaults.standard.set("door", forKey: "role")
        role = "door"
        configured = true
        locked = false
    }

    func forgetEverything() {
        Keychain.delete()
        UserDefaults.standard.removeObject(forKey: "serverURL")
        UserDefaults.standard.removeObject(forKey: "role")
        role = "control"
        configured = false
        showSettings = false
    }
}
