import SwiftUI
import LocalAuthentication
import WebKit

struct ContentView: View {
    @ObservedObject var model = AppModel.shared
    @Environment(\.scenePhase) private var phase

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if !model.configured {
                OnboardingView(model: model)
            } else if let api = DoorApi.configured() {
                if model.role == "door" {
                    DoorScreenView(base: api.base, model: model).ignoresSafeArea()
                } else {
                    WebContainer(base: api.base, model: model).ignoresSafeArea()
                    if model.locked { LockView(model: model) }
                }
            }
            if let t = model.toast {
                VStack { Spacer(); Text(t).font(.subheadline.weight(.semibold)).padding(.horizontal, 18).padding(.vertical, 12)
                    .background(.white, in: Capsule()).foregroundStyle(.black).padding(.bottom, 40) }
                    .transition(.move(edge: .bottom).combined(with: .opacity)).allowsHitTesting(false)
            }
        }
        .animation(.spring(duration: 0.35), value: model.toast)
        .preferredColorScheme(.dark)
        .statusBarHidden(model.configured && model.role == "door")
        .persistentSystemOverlays(model.configured && model.role == "door" ? .hidden : .automatic)
        .sheet(isPresented: $model.showSettings) { SettingsView(model: model) }
        .onAppear { if model.configured && model.role == "control" { Task { await model.unlock() } } }
        .onChange(of: phase) { _, new in
            if new == .background { model.lockNow() }
            if new == .active, model.locked, model.configured, model.role == "control" { Task { await model.unlock() } }
        }
    }
}

struct LockView: View {
    @ObservedObject var model: AppModel
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 18) {
                Image(systemName: "faceid").font(.system(size: 54)).foregroundStyle(.green)
                Text("Deur Beheer").font(.title2.bold())
                Text("Vergrendeld").foregroundStyle(.secondary)
                Button { Task { await model.unlock() } } label: { Text("Ontgrendel").font(.headline).frame(width: 220).padding(.vertical, 14) }
                    .buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black)
            }
        }
    }
}

struct OnboardingView: View {
    @ObservedObject var model: AppModel
    @State private var choice: String?
    @State private var server = ""
    @State private var user = ""
    @State private var pass = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        if choice == nil { picker } else { form }
    }

    /// First start: what is this iPhone / iPad?
    private var picker: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Circle().fill(.green).frame(width: 26, height: 26).shadow(color: .green, radius: 14).padding(.top, 60)
                Text("Saga Techbox Deur").font(.largeTitle.bold())
                Text("Wat is dit apparaat?").foregroundStyle(.secondary)
                choiceCard("Bedieningspaneel", "Jouw werkplek: status zetten, bezoekers beantwoorden, met Face ID, Siri en snelle acties.", "slider.horizontal.3", "control")
                choiceCard("Deurscherm", "Deze iPad of iPhone hangt bij de deur en toont het deurscherm. Blijft altijd aan.", "ipad.landscape", "door")
                Text("De server zelf draait op een computer (Mac, Windows of Linux) met de Saga Techbox Deur-app.").font(.footnote).foregroundStyle(.secondary)
            }.padding(24)
        }
    }

    private func choiceCard(_ title: String, _ text: String, _ symbol: String, _ value: String) -> some View {
        Button { choice = value } label: {
            HStack(spacing: 14) {
                Image(systemName: symbol).font(.title2).frame(width: 36).foregroundStyle(.green)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.headline)
                    Text(text).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
        }.buttonStyle(.plain)
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Button { choice = nil; error = nil } label: { Label("Terug", systemImage: "chevron.left") }.padding(.top, 50)
                Circle().fill(.green).frame(width: 26, height: 26).shadow(color: .green, radius: 14)
                Text(choice == "door" ? "Deurscherm" : "Bedieningspaneel").font(.largeTitle.bold())
                Text("Jouw eigen beheer-app. Alles wat het hoofdaccount kan, met Face ID, Siri en snelle acties.").foregroundStyle(.secondary)
                field("Adres van de deurserver", "bijv. 192.168.1.50:8080", $server, url: true)
                if choice != "door" {
                    field("Gebruikersnaam", "bijv. milo", $user)
                    SecureField("Wachtwoord", text: $pass).textContentType(.password).padding(14).background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                }
                if let error { Text(error).foregroundStyle(.red).font(.subheadline.weight(.semibold)) }
                Button { Task { await connect() } } label: {
                    HStack { if busy { ProgressView().tint(.black) }; Text("Verbinden").font(.headline) }.frame(maxWidth: .infinity).padding(.vertical, 15)
                }.buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black).disabled(busy || server.isEmpty || (choice != "door" && (user.isEmpty || pass.isEmpty)))
                Text(choice == "door" ? "Het deurscherm blijft aan en het scherm gaat niet op slot. Tik vijf keer linksboven om de instellingen te openen." : "Je inlog wordt versleuteld bewaard in de Sleutelhanger van dit apparaat en nergens anders.").font(.footnote).foregroundStyle(.secondary)
            }.padding(24)
        }
    }

    private func field(_ title: String, _ prompt: String, _ text: Binding<String>, url: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            TextField(prompt, text: text).textInputAutocapitalization(.never).autocorrectionDisabled()
                .keyboardType(url ? .URL : .default).padding(14).background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func connect() async {
        error = nil; busy = true; defer { busy = false }
        guard let url = DoorApi.normalize(server) else { error = "Dat adres klopt niet."; return }
        if choice == "door" {
            var req = URLRequest(url: url.appendingPathComponent("healthz")); req.timeoutInterval = 8
            guard let (_, res) = try? await URLSession.shared.data(for: req), (res as? HTTPURLResponse)?.statusCode == 200 else { error = "Geen deurserver gevonden op dit adres."; return }
            UserDefaults.standard.set(url.absoluteString, forKey: "serverURL")
            model.finishDoorSetup()
            return
        }
        do {
            _ = try await DoorApi(base: url).login(username: user.trimmingCharacters(in: .whitespaces).lowercased(), password: pass)
            UserDefaults.standard.set(url.absoluteString, forKey: "serverURL")
            guard Keychain.save(username: user.trimmingCharacters(in: .whitespaces).lowercased(), password: pass) else { error = "Opslaan in de Sleutelhanger mislukte."; return }
            pass = ""
            model.finishSetup()
        } catch { self.error = error.localizedDescription }
    }
}

struct SettingsView: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var server = UserDefaults.standard.string(forKey: "serverURL") ?? ""
    @State private var message: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("Adres", text: $server).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    Button("Opslaan en opnieuw laden") {
                        if let u = DoorApi.normalize(server) { UserDefaults.standard.set(u.absoluteString, forKey: "serverURL"); model.reload(); message = "Opgeslagen"; dismiss() } else { message = "Dat adres klopt niet." }
                    }
                }
                if model.role == "control" {
                Section("Beveiliging") {
                    Toggle("Vergrendelen met Face ID", isOn: $model.faceID)
                    Text("De app vergrendelt zich zodra je hem verlaat.").font(.footnote).foregroundStyle(.secondary)
                }
                Section("Direct bedienen") {
                    ForEach([("Deur open", QuickAction.open), ("Deur gesloten", .closed), ("Bezet", .busy)], id: \.1) { item in
                        Button(item.0) { dismiss(); model.handle(item.1) }
                    }
                    Button("Noodstop", role: .destructive) { dismiss(); model.handle(.lockdown) }
                    Text("Deze acties staan ook bij het ingedrukt houden van het app-icoon, en in Opdrachten en Siri.").font(.footnote).foregroundStyle(.secondary)
                }
                }
                Section {
                    Button("Inlog en server vergeten", role: .destructive) { model.forgetEverything() }
                }
                if let message { Text(message).foregroundStyle(.secondary) }
                Section("Over") {
                    LabeledContent("Dit apparaat is", value: model.role == "door" ? "Deurscherm" : "Bedieningspaneel")
                    LabeledContent("Versie", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1")
                }
            }
            .navigationTitle("Instellingen")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Klaar") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
    }
}

/// The door screen on an iPad or iPhone by the door: the public door page, full screen, never goes to sleep.
/// Five taps in the top-left corner open the settings (change server, switch role).
struct DoorScreenView: View {
    let base: URL
    @ObservedObject var model: AppModel

    var body: some View {
        ZStack(alignment: .topLeading) {
            DoorWebView(url: base)
            Color.clear.frame(width: 90, height: 90).contentShape(Rectangle())
                .onTapGesture(count: 5) { model.showSettings = true }
        }
        .background(Color.black)
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }
}

struct DoorWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.navigationDelegate = context.coordinator
        web.load(URLRequest(url: url))
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let url: URL
        init(url: URL) { self.url = url }
        // the server may still be starting (or the network is gone for a moment): keep trying
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { retry(webView) }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { retry(webView) }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { retry(webView) }
        private func retry(_ web: WKWebView) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { web.load(URLRequest(url: self.url)) }
        }
    }
}
