import SwiftUI
import UIKit

@main
struct DeurBeheerApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    var body: some Scene { WindowGroup { ContentView() } }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

/// Quick actions: press and hold the app icon → Open / Gesloten / Bezet / Noodstop.
final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        if let item = connectionOptions.shortcutItem { route(item) }
    }
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        route(shortcutItem); completionHandler(true)
    }
    private func route(_ item: UIApplicationShortcutItem) {
        guard let last = item.type.split(separator: ".").last, let action = QuickAction(rawValue: String(last)) else { return }
        Task { @MainActor in AppModel.shared.handle(action) }
    }
}
