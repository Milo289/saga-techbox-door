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
            .tint(Palette.accent)
            BannerView(store: store)
            if store.can("power"), let pend = store.state.power.pending.at.date {
                VStack {
                    TimelineView(.periodic(from: .now, by: 1)) { _ in
                        let left = max(0, Int(pend.timeIntervalSinceNow))
                        HStack {
                            Text("Computer gaat uit over \(left / 60):\(String(format: "%02d", left % 60))").font(.subheadline.bold())
                            Button("Afbreken") { Task { await store.run("Afgebroken") { _ = try await store.post("api/power/cancel") } } }.buttonStyle(.borderedProminent).tint(.black)
                        }.frame(maxWidth: .infinity).padding(.vertical, 10).background(Palette.busy).foregroundStyle(.black)
                    }
                    Spacer()
                }
            }
        }
        .onAppear {
            tab = startTab
            store.onVisit = { r in visit(r) }
            store.onRing = { if !Quiet.now { Sounds.bell(); Haptics.heavy() } }
            store.start()
            UIApplication.shared.isIdleTimerDisabled = keepAwake
        }
        .onChange(of: phase) { _, new in
            if new == .active { store.start(); try? UNUserNotificationCenter.current().setBadgeCount(badge ? store.newCount : 0) } else if new == .background { store.stop() }
        }
        .onChange(of: keepAwake) { _, v in UIApplication.shared.isIdleTimerDisabled = v }
        .onChange(of: store.newCount) { _, n in UNUserNotificationCenter.current().setBadgeCount(badge ? n : 0) }
        .onChange(of: model.pendingTab) { _, t in if let t { tab = t; model.pendingTab = nil } }
        .onChange(of: alertKey) { _, _ in checkAlerts() }
        .task(id: offlineKey) { await watchOffline() }
    }

    // warnings for you: new warnings from the server, and a server that has been gone for more than a minute and a half
    @State private var seenAlerts = Set<String>()
    @State private var firstAlerts = true
    private var alertKey: String { store.state.alerts.array.filter { $0.resolvedAt.isNull }.map { $0.id.str }.joined(separator: ",") }
    private var offlineKey: String { if case .offline = store.connection { return "offline" } else { return "ok" } }

    private func checkAlerts() {
        for a in store.state.alerts.array where a.resolvedAt.isNull {
            if seenAlerts.insert(a.id.str).inserted && !firstAlerts {
                store.show("⚠ \(a.text.str)"); if !Quiet.now { Haptics.warning() }
                model.notifyIfInBackground(title: "Waarschuwing", body: a.text.str)
            }
        }
        if store.hasState { firstAlerts = false }
    }

    private func watchOffline() async {
        guard offlineKey == "offline", store.hasState else { return }
        try? await Task.sleep(nanoseconds: 90_000_000_000)
        guard !Task.isCancelled, case .offline(let m) = store.connection else { return }
        store.show("Geen verbinding met de deurserver"); if !Quiet.now { Haptics.warning() }
        model.notifyIfInBackground(title: "Geen verbinding met de deurserver", body: m)
    }

    private func visit(_ r: VisitRequest) {
        if !Quiet.now { Sounds.message(); Haptics.success() }
        store.show("\(r.typeLabel): \(r.name.isEmpty ? "iemand" : r.name)")
        if notifyVisits && !Quiet.now { model.notifyIfInBackground(title: r.typeLabel, body: "\(r.name.isEmpty ? "Iemand" : r.name)\(r.summary.isEmpty ? "" : " — \(r.summary)")") }
    }
}
