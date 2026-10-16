import SwiftUI
import AppKit

enum MacPage: String, CaseIterable, Identifiable {
    case status, inbox, manage, form, activity, server, dev
    var id: String { rawValue }
    var title: String { switch self { case .status: return "Status"; case .inbox: return "Bezoekers"; case .manage: return "Beheer"; case .form: return "Bezoekersformulier"; case .activity: return "Activiteit"; case .server: return "Serverinstellingen"; case .dev: return "Ontwikkelaar" } }
    var symbol: String { switch self { case .status: return "door.left.hand.open"; case .inbox: return "bell.fill"; case .manage: return "slider.horizontal.3"; case .form: return "list.clipboard"; case .activity: return "list.bullet.rectangle"; case .server: return "gearshape.2"; case .dev: return "hammer.fill" } }
}

/// First the connection screen, then the app: sidebar on the left, the chosen page on the right.
struct MacRoot: View {
    @ObservedObject var store: DoorStore
    @AppStorage(MacPref.appearance) private var appearance = "system"
    @State private var page: MacPage? = {
        #if DEBUG
        if let p = ProcessInfo.processInfo.environment["DEUR_PAGE"], let m = MacPage(rawValue: p) { return m }
        #endif
        return .status
    }()
    /// nil while we look in the Keychain (done off the main thread: macOS may ask permission there, and the window must not freeze meanwhile)
    @State private var configured: Bool?

    var body: some View {
        Group {
            if configured == nil {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Even laden…").foregroundStyle(.secondary)
                    Text("Vraagt je Mac toestemming om je inlog uit de Sleutelhanger te lezen? Kies “Altijd toestaan”.").font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 360)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if configured == false {
                MacConnect(store: store) { configured = true; store.restart() }
            } else {
                NavigationSplitView {
                    List(MacPage.allCases.filter { ($0 != .dev && $0 != .server) || Build.isDeveloperApp }, selection: $page) { p in
                        Label(p.title, systemImage: p.symbol)
                            .badge(p == .inbox ? store.newCount : 0)
                            .tag(p)
                    }
                    .navigationSplitViewColumnWidth(min: 170, ideal: 190, max: 240)
                    .safeAreaInset(edge: .bottom) { ConnectionBadge(store: store).padding(12) }
                } detail: {
                    ZStack(alignment: .bottom) {
                        switch page ?? .status {
                        case .status: MacStatus(store: store)
                        case .inbox: MacInbox(store: store)
                        case .manage: MacManage(store: store)
                        case .form: FormSettingsView(store: store)
                        case .activity: MacActivity(store: store)
                        case .server: NavigationStack { AllSettingsView(store: store) }
                        case .dev: MacDev(store: store)
                        }
                        if let b = store.banner {
                            Text(b).font(.callout.weight(.medium)).padding(.horizontal, 16).padding(.vertical, 10)
                                .background(.regularMaterial, in: Capsule()).shadow(radius: 6).padding(.bottom, 18)
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                    }
                    .animation(.snappy, value: store.banner)
                }
                .tint(Palette.accent)
            }
        }
        .preferredColorScheme(appearance.colorScheme)
        .securitySheets(store)
        .sheet(isPresented: Binding(get: { configured == true && !UserDefaults.standard.bool(forKey: "tour.done") && store.hasState }, set: { _ in })) { HelpTour() }
        .task { configured = await Task.detached { DoorApi.configured() != nil && Keychain.load() != nil }.value }
    }
}

struct ConnectionBadge: View {
    @ObservedObject var store: DoorStore
    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(text).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            Spacer()
        }
    }
    private var color: Color { switch store.connection { case .live: return .green; case .connecting: return .orange; default: return .red } }
    private var text: String {
        switch store.connection {
        case .live: return "Live" + (store.lastLatencyMs.map { " · \($0) ms" } ?? "")
        case .connecting: return "Verbinden…"
        case .idle: return "Niet verbonden"
        case .offline(let m): return m
        }
    }
}

/// Connect to a server: type the address or let the app search the network, then log in.
struct MacConnect: View {
    @ObservedObject var store: DoorStore
    let done: () -> Void
    @State private var server = UserDefaults.standard.string(forKey: "serverURL") ?? ""
    @State private var user = ""
    @State private var pass = ""
    @State private var found: [Discovery.Found] = []
    @State private var searching = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        HStack(spacing: 0) {
            ZStack {
                LinearGradient(colors: [Palette.accent.opacity(0.9), Color(red: 0.05, green: 0.12, blue: 0.1)], startPoint: .topLeading, endPoint: .bottomTrailing)
                VStack(spacing: 14) {
                    Image(systemName: "door.left.hand.open").font(.system(size: 64, weight: .light)).foregroundStyle(.white)
                    Text("Saga Techbox Deur").font(.title.bold()).foregroundStyle(.white)
                    Text("Jouw werkplek voor de deur").foregroundStyle(.white.opacity(0.8))
                }
            }.frame(width: 330)
            VStack(alignment: .leading, spacing: 14) {
                Text("Verbinden met de deurserver").font(.title2.bold())
                Text("Vul het adres van de server in, of laat de app hem zoeken in je netwerk.").foregroundStyle(.secondary)
                HStack {
                    TextField("bijv. 192.168.1.50:8080", text: $server).textFieldStyle(.roundedBorder)
                    Button { search() } label: { if searching { ProgressView().controlSize(.small) } else { Text("Zoeken") } }.disabled(searching)
                }
                ForEach(found) { s in
                    Button { server = s.url } label: {
                        HStack { Image(systemName: "server.rack"); VStack(alignment: .leading) { Text(s.name).font(.headline); Text("\(s.host):\(s.port) · versie \(s.version)").font(.caption).foregroundStyle(.secondary) }; Spacer(); if server == s.url { Image(systemName: "checkmark") } }
                            .padding(10).background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
                    }.buttonStyle(.plain)
                }
                TextField("Gebruikersnaam", text: $user).textFieldStyle(.roundedBorder)
                SecureField("Wachtwoord", text: $pass).textFieldStyle(.roundedBorder).onSubmit { Task { await connect() } }
                if let error { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange).font(.callout) }
                HStack {
                    Spacer()
                    Button { Task { await connect() } } label: { if busy { ProgressView().controlSize(.small) } else { Text("Verbinden") } }
                        .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(busy || server.isEmpty || user.isEmpty || pass.isEmpty)
                }
                Spacer()
                Text("Je inlog wordt versleuteld in de Sleutelhanger van deze Mac bewaard.").font(.caption).foregroundStyle(.secondary)
            }.padding(28)
        }
    }

    private func search() {
        searching = true
        Task { found = await Discovery.find(); searching = false; if found.isEmpty { error = "Geen server gevonden. Staat hij aan, en op hetzelfde netwerk?" } else { error = nil; if found.count == 1 { server = found[0].url } } }
    }

    private func connect() async {
        error = nil; busy = true; defer { busy = false }
        guard let url = DoorApi.normalize(server) else { error = "Dat adres klopt niet."; return }
        let name = user.trimmingCharacters(in: .whitespaces).lowercased()
        do {
            try await DoorApi(base: url).verify(username: name, password: pass)
            guard Keychain.save(username: name, password: pass) else { error = "Opslaan in de Sleutelhanger mislukte."; return }
            UserDefaults.standard.set(name, forKey: "accountName")
            UserDefaults.standard.set(url.absoluteString, forKey: "serverURL")
            pass = ""; done()
        } catch { self.error = error.localizedDescription }
    }
}
