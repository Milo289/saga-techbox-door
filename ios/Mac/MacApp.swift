import SwiftUI
import AppKit
import UserNotifications

/// The Mac app: a real window with a sidebar, a menu bar item that shows the door status, and settings in the usual place (⌘,).
@main
struct DeurBeheerMacApp: App {
    @StateObject private var store = DoorStore.shared
    @NSApplicationDelegateAdaptor(MacDelegate.self) private var delegate

    init() {
        UserDefaults.standard.registerAppDefaults()
        #if DEBUG
        // test aid for development builds only: connect to a local test server without typing
        let e = ProcessInfo.processInfo.environment
        if let server = e["DEUR_TEST_SERVER"], let u = e["DEUR_TEST_USER"], let p = e["DEUR_TEST_PASS"] {
            UserDefaults.standard.set(server, forKey: "serverURL"); _ = Keychain.save(username: u, password: p)
        }
        #endif
    }

    var body: some Scene {
        WindowGroup(Build.isDeveloperApp ? "Deur Dev" : "Deur Beheer", id: "main") {
            MacRoot(store: store)
                .frame(minWidth: 820, minHeight: 560)
                .onAppear { MacNotify.setup(store) }
        }
        .defaultSize(width: 980, height: 660)
        .commands {
            CommandMenu("Deur") {
                Button("Open") { Task { await store.setStatus("open") } }.keyboardShortcut("1", modifiers: [.command, .option])
                Button("Gesloten") { Task { await store.setStatus("closed") } }.keyboardShortcut("2", modifiers: [.command, .option])
                Button("Bezet") { Task { await store.setStatus("busy") } }.keyboardShortcut("3", modifiers: [.command, .option])
                Divider()
                Button("Volg de openingstijden") { Task { await store.run("Volgt de openingstijden") { _ = try await store.post("api/status/auto") } } }
            }
        }

        MenuBarExtra {
            MenuBarContent(store: store).modifier(SchemeModifier())
        } label: {
            Image(nsImage: statusDot(store.hasState ? Palette.color(store.mode) : .gray, badge: store.newCount))
        }
        .menuBarExtraStyle(.window)

        Settings { MacSettings(store: store).frame(width: 760, height: 640).modifier(SchemeModifier()) }
    }
}

struct SchemeModifier: ViewModifier {
    @AppStorage(MacPref.appearance) private var appearance = "system"
    func body(content: Content) -> some View { content.preferredColorScheme(appearance.colorScheme) }
}

final class MacDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        DoorStore.shared.start()
        #if DEBUG
        // test aid for development builds only: save a picture of the window and quit
        if let path = ProcessInfo.processInfo.environment["DEUR_SNAPSHOT"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
                // first choice: a real picture of the window as it is on screen (dark mode shows its real colours)
                if ProcessInfo.processInfo.environment["DEUR_REAL_WINDOW"] != nil, let w = NSApp.windows.first(where: { $0.isVisible && $0.contentView != nil && $0.title != "" }),
                   let cg = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(w.windowNumber), [.boundsIgnoreFraming, .bestResolution]) {
                    try? NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
                    NSApp.terminate(nil)
                    return
                }
                if let w = NSApp.windows.first(where: { $0.isVisible && $0.contentView != nil && $0.title != "" }) ?? NSApp.windows.first, let v = w.contentView,
                   let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) {
                    v.cacheDisplay(in: v.bounds, to: rep)
                    // put the window's own background behind it (dark or light), so the picture looks like the real window
                    let img = NSImage(size: v.bounds.size)
                    img.lockFocus()
                    w.effectiveAppearance.performAsCurrentDrawingAppearance { NSColor.windowBackgroundColor.setFill(); NSRect(origin: .zero, size: v.bounds.size).fill() }
                    rep.draw(in: NSRect(origin: .zero, size: v.bounds.size))
                    img.unlockFocus()
                    if let tiff = img.tiffRepresentation, let out = NSBitmapImageRep(data: tiff) { try? out.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path)) }
                }
                NSApp.terminate(nil)
            }
        }
        #endif
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false } // keep the menu bar item
}

/// A coloured dot for the menu bar (a template image would lose its colour); a small red dot when something is waiting.
func statusDot(_ color: Color, badge: Int) -> NSImage {
    let size = NSSize(width: 20, height: 18)
    let img = NSImage(size: size, flipped: false) { _ in
        NSColor(color).setFill()
        NSBezierPath(ovalIn: NSRect(x: 3, y: 2, width: 14, height: 14)).fill()
        NSColor.black.withAlphaComponent(0.25).setStroke()
        let ring = NSBezierPath(ovalIn: NSRect(x: 3.5, y: 2.5, width: 13, height: 13)); ring.lineWidth = 1; ring.stroke()
        if badge > 0 { NSColor.systemRed.setFill(); NSBezierPath(ovalIn: NSRect(x: 12, y: 10, width: 8, height: 8)).fill() }
        return true
    }
    img.isTemplate = false
    return img
}

@MainActor enum MacNotify {
    private static var bag: [Any] = []
    private static var offlineTask: Task<Void, Never>?
    private static var toldOffline = false
    private static var seenAlerts = Set<String>()
    private static var firstState = true

    static func post(_ title: String, _ body: String) {
        let c = UNMutableNotificationContent(); c.title = title; c.body = body; c.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
    }

    /// Warnings for you: the server lost for more than a minute and a half, and warnings the server itself raises (disk full, errors, door screen gone).
    static func watch(_ store: DoorStore) {
        bag.append(store.$connection.sink { c in
            MainActor.assumeIsolated {
                switch c {
                case .live:
                    offlineTask?.cancel(); offlineTask = nil
                    if toldOffline { toldOffline = false; post("Weer verbonden", "De deurserver is weer bereikbaar.") }
                case .offline(let m):
                    guard offlineTask == nil, store.hasState else { return }
                    offlineTask = Task { try? await Task.sleep(nanoseconds: 90_000_000_000); if !Task.isCancelled { toldOffline = true; post("Geen verbinding met de deurserver", m) } }
                default: break
                }
            }
        })
        bag.append(store.$state.sink { s in
            MainActor.assumeIsolated {
                for a in s.alerts.array where a.resolvedAt.isNull {
                    let id = a.id.str
                    if seenAlerts.insert(id).inserted && !firstState && !Quiet.now { post("Waarschuwing", a.text.str) }
                }
                if !s.isNull { firstState = false }
            }
        })
    }

    static func setup(_ store: DoorStore) {
        if bag.isEmpty { watch(store) }
        store.onVisit = { r in
            guard !Quiet.now else { return }
            Sounds.message()
            guard UserDefaults.standard.bool(forKey: Pref.notifyVisits) else { return }
            let c = UNMutableNotificationContent()
            c.title = r.typeLabel; c.body = "\(r.name.isEmpty ? "Iemand" : r.name)\(r.summary.isEmpty ? "" : " — \(r.summary)")"; c.sound = .default
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
        }
        store.onRing = { if !Quiet.now { Sounds.bell() } }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }
}
