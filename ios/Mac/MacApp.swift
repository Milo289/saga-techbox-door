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
        WindowGroup("Deur Beheer", id: "main") {
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
            MenuBarContent(store: store)
        } label: {
            Image(nsImage: statusDot(store.hasState ? Palette.color(store.mode) : .gray, badge: store.newCount))
        }
        .menuBarExtraStyle(.window)

        Settings { MacSettings(store: store).frame(width: 560, height: 520) }
    }
}

final class MacDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        DoorStore.shared.start()
        #if DEBUG
        // test aid for development builds only: save a picture of the window and quit
        if let path = ProcessInfo.processInfo.environment["DEUR_SNAPSHOT"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
                if let w = NSApp.windows.first(where: { $0.isVisible && $0.contentView != nil && $0.title != "" }) ?? NSApp.windows.first, let v = w.contentView,
                   let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) {
                    v.cacheDisplay(in: v.bounds, to: rep)
                    try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
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
    static func setup(_ store: DoorStore) {
        store.onVisit = { r in
            Sounds.message()
            guard UserDefaults.standard.bool(forKey: Pref.notifyVisits) else { return }
            let c = UNMutableNotificationContent()
            c.title = r.typeLabel; c.body = "\(r.name.isEmpty ? "Iemand" : r.name)\(r.summary.isEmpty ? "" : " — \(r.summary)")"; c.sound = .default
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
        }
        store.onRing = { Sounds.bell() }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }
}
