import SwiftUI
import UserNotifications

/// The app itself: Status · Bezoekers · Beheer · Instellingen (· Ontwikkelaar).
struct MainTabView: View {
    @ObservedObject var model: AppModel
    @StateObject private var store = DoorStore.shared
    @AppStorage(Pref.startTab) private var startTab = "status"
    @AppStorage(Pref.badge) private var badge = true
    @AppStorage(Pref.keepAwake) private var keepAwake = false
    @AppStorage(Pref.notifyVisits) private var notifyVisits = true
    @AppStorage(Pref.devMode) private var devMode = false
    @Environment(\.scenePhase) private var phase
    @State private var tab = "status"

    var body: some View {
        ZStack {
            TabView(selection: $tab) {
                StatusView(store: store).tag("status")
                    .tabItem { Label("Status", systemImage: "door.left.hand.open") }
                InboxView(store: store).tag("inbox")
                    .tabItem { Label("Bezoekers", systemImage: "bell.fill") }
                    .badge(badge ? store.newCount : 0)
                ManageView(store: store, model: model).tag("manage")
                    .tabItem { Label("Beheer", systemImage: "slider.horizontal.3") }
                AppSettingsView(store: store, model: model).tag("settings")
                    .tabItem { Label("Instellingen", systemImage: "gearshape.fill") }
                if Build.isDeveloperApp || devMode {
                    DeveloperView(store: store).tag("dev")
                        .tabItem { Label("Ontwikkelaar", systemImage: "hammer.fill") }
                }
            }
            .tint(.green)
            BannerView(store: store)
        }
        .onAppear {
            tab = startTab
            store.onVisit = { r in visit(r) }
            store.onRing = { Sounds.bell(); Haptics.heavy() }
            store.start()
            UIApplication.shared.isIdleTimerDisabled = keepAwake
        }
        .onChange(of: phase) { _, new in
            if new == .active { store.start(); try? UNUserNotificationCenter.current().setBadgeCount(badge ? store.newCount : 0) } else if new == .background { store.stop() }
        }
        .onChange(of: keepAwake) { _, v in UIApplication.shared.isIdleTimerDisabled = v }
        .onChange(of: store.newCount) { _, n in UNUserNotificationCenter.current().setBadgeCount(badge ? n : 0) }
        .onChange(of: model.pendingTab) { _, t in if let t { tab = t; model.pendingTab = nil } }
    }

    private func visit(_ r: VisitRequest) {
        Sounds.message(); Haptics.success()
        store.show("\(r.typeLabel): \(r.name.isEmpty ? "iemand" : r.name)")
        if notifyVisits { model.notifyIfInBackground(title: r.typeLabel, body: "\(r.name.isEmpty ? "Iemand" : r.name)\(r.summary.isEmpty ? "" : " — \(r.summary)")") }
    }
}
