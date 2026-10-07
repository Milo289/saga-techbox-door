import SwiftUI

/// "Account en server": change the server address (IP), switch to another account, reconnect, or forget everything.
struct AccountSheet: View {
    @ObservedObject var store: DoorStore
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var server = UserDefaults.standard.string(forKey: "serverURL") ?? ""
    @State private var user = ""
    @State private var pass = ""
    @State private var busy = false
    @State private var message: String?
    @State private var good = false
    @State private var askForget = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Nu") {
                    row("Account", store.state.me.name.string ?? Keychain.load()?.username ?? "—")
                    row("Rol", store.state.me.role.string ?? "—")
                    row("Server", UserDefaults.standard.string(forKey: "serverURL") ?? "—")
                    row("Verbinding", status)
                }

                Section {
                    TextField("bijv. 192.168.1.50:8080", text: $server).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    Button { saveServer() } label: { Label("Opslaan en verbinden", systemImage: "network") }
                } header: { Text("Server of IP wijzigen") } footer: { Text("Het adres van de computer waarop de deurserver draait. Het staat in de instellingen van de app op die computer.") }

                Section {
                    TextField("Gebruikersnaam", text: $user).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Wachtwoord", text: $pass)
                    Button { Task { await switchAccount() } } label: { HStack { if busy { ProgressView() }; Label("Inloggen met dit account", systemImage: "person.crop.circle.badge.checkmark") } }
                        .disabled(busy || user.isEmpty || pass.isEmpty)
                } header: { Text("Ander account") } footer: { Text("Je inlog wordt versleuteld in de Sleutelhanger van dit apparaat bewaard.") }

                if let message {
                    Section { Label(message, systemImage: good ? "checkmark.circle.fill" : "exclamationmark.triangle.fill").foregroundStyle(good ? Palette.open : Palette.busy) }
                }

                Section {
                    Button { store.restart(); message = "Opnieuw verbinden…"; good = true } label: { Label("Opnieuw verbinden", systemImage: "arrow.clockwise") }
                    Button(role: .destructive) { askForget = true } label: { Label("Account en server vergeten", systemImage: "trash") }
                }
            }
            .scrollContentBackground(.hidden).background(Color.black.ignoresSafeArea())
            .navigationTitle("Account en server").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Klaar") { dismiss() } } }
            .confirmationDialog("Account en server vergeten? Je moet daarna opnieuw instellen.", isPresented: $askForget, titleVisibility: .visible) {
                Button("Vergeten", role: .destructive) { store.forget(); model.forgetEverything(); dismiss() }
                Button("Annuleren", role: .cancel) {}
            }
        }.preferredColorScheme(.dark)
    }

    private var status: String {
        switch store.connection { case .live: return "live"; case .connecting: return "verbinden…"; case .idle: return "uit"; case .offline(let m): return m }
    }

    private func row(_ k: String, _ v: String) -> some View { HStack(alignment: .top) { Text(k); Spacer(); Text(v).foregroundStyle(.secondary).multilineTextAlignment(.trailing) } }

    private func saveServer() {
        guard let url = DoorApi.normalize(server) else { message = "Dat adres klopt niet."; good = false; return }
        UserDefaults.standard.set(url.absoluteString, forKey: "serverURL")
        server = url.absoluteString
        store.restart()
        message = "Verbinden met \(url.host ?? server)…"; good = true; Haptics.success()
    }

    private func switchAccount() async {
        busy = true; defer { busy = false }
        guard let base = DoorApi.normalize(server) ?? DoorApi.configured()?.base else { message = "Vul eerst een serveradres in."; good = false; return }
        let name = user.trimmingCharacters(in: .whitespaces).lowercased()
        do {
            _ = try await DoorApi(base: base).login(username: name, password: pass)
            guard Keychain.save(username: name, password: pass) else { message = "Opslaan in de Sleutelhanger mislukte."; good = false; return }
            UserDefaults.standard.set(base.absoluteString, forKey: "serverURL")
            pass = ""
            store.restart()
            message = "Ingelogd als \(name)"; good = true; Haptics.success()
        } catch { message = error.localizedDescription; good = false; Haptics.error() }
    }
}
