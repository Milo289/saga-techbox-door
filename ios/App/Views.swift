import SwiftUI
import LocalAuthentication

struct ContentView: View {
    @ObservedObject var model = AppModel.shared
    @Environment(\.scenePhase) private var phase

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if !model.configured {
                OnboardingView(model: model)
            } else if let api = DoorApi.configured() {
                WebContainer(base: api.base, model: model).ignoresSafeArea()
                if model.locked { LockView(model: model) }
            }
            if let t = model.toast {
                VStack { Spacer(); Text(t).font(.subheadline.weight(.semibold)).padding(.horizontal, 18).padding(.vertical, 12)
                    .background(.white, in: Capsule()).foregroundStyle(.black).padding(.bottom, 40) }
                    .transition(.move(edge: .bottom).combined(with: .opacity)).allowsHitTesting(false)
            }
        }
        .animation(.spring(duration: 0.35), value: model.toast)
        .preferredColorScheme(.dark)
        .sheet(isPresented: $model.showSettings) { SettingsView(model: model) }
        .onAppear { if model.configured { Task { await model.unlock() } } }
        .onChange(of: phase) { _, new in
            if new == .background { model.lockNow() }
            if new == .active, model.locked, model.configured { Task { await model.unlock() } }
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
    @State private var server = ""
    @State private var user = ""
    @State private var pass = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Circle().fill(.green).frame(width: 26, height: 26).shadow(color: .green, radius: 14).padding(.top, 60)
                Text("Deur Beheer").font(.largeTitle.bold())
                Text("Jouw eigen beheer-app. Alles wat het hoofdaccount kan, met Face ID, Siri en snelle acties.").foregroundStyle(.secondary)
                field("Adres van de deurserver", "bijv. 192.168.1.50:8080", $server, url: true)
                field("Gebruikersnaam", "admin", $user)
                SecureField("Wachtwoord", text: $pass).textContentType(.password).padding(14).background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                if let error { Text(error).foregroundStyle(.red).font(.subheadline.weight(.semibold)) }
                Button { Task { await connect() } } label: {
                    HStack { if busy { ProgressView().tint(.black) }; Text("Verbinden").font(.headline) }.frame(maxWidth: .infinity).padding(.vertical, 15)
                }.buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black).disabled(busy || server.isEmpty || user.isEmpty || pass.isEmpty)
                Text("Je inlog wordt versleuteld bewaard in de Sleutelhanger van deze iPhone en nergens anders.").font(.footnote).foregroundStyle(.secondary)
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
                Section {
                    Button("Inlog en server vergeten", role: .destructive) { model.forgetEverything() }
                }
                if let message { Text(message).foregroundStyle(.secondary) }
                Section("Over") {
                    LabeledContent("Versie", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1")
                }
            }
            .navigationTitle("Instellingen")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Klaar") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
    }
}
