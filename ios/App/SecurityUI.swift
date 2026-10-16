import SwiftUI

/// Asked once per server: "do you trust this certificate authority?" (compare the fingerprint with the panel: Beveiliging → https)
struct TrustSheet: View {
    @ObservedObject var store: DoorStore
    let prompt: DoorStore.TrustPrompt

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Nieuwe beveiligde verbinding", systemImage: "lock.shield").font(.title3.weight(.semibold))
            Text("Je maakt voor het eerst verbinding met \(prompt.host) via https. De server gebruikt zijn eigen certificaat. Controleer of deze vingerafdruk gelijk is aan die in het bedieningspaneel (Beveiliging → Beveiligde verbinding):")
                .foregroundStyle(.secondary)
            Text(prompt.fingerprint).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            Text("Klopt het? Dan vertrouwt deze app alleen dit certificaat voor deze server. Klopt het niet, kies dan Annuleren: iemand anders kan zich dan voordoen als je server.").font(.footnote).foregroundStyle(.secondary)
            HStack {
                Button("Annuleren", role: .cancel) { store.declineTrust() }
                Spacer()
                Button("Vertrouwen") { store.acceptTrust() }.buttonStyle(.borderedProminent)
            }
        }
        .padding(24).frame(maxWidth: 480)
        .interactiveDismissDisabled()
    }
}

/// The code from the verification app (or a recovery code) when the account uses two-step verification.
struct CodeSheet: View {
    @ObservedObject var store: DoorStore
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Tweestapsverificatie", systemImage: "lock.shield").font(.title3.weight(.semibold))
            Text("Open je verificatie-app en typ de code van 6 cijfers. Kwijt? Gebruik een herstelcode.").foregroundStyle(.secondary)
            TextField("Code", text: $code)
                .textFieldStyle(.roundedBorder)
                #if os(iOS)
                .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.asciiCapable).textContentType(.oneTimeCode)
                #endif
                .onSubmit { Task { await send() } }
            if let error { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange).font(.footnote) }
            HStack {
                Button("Annuleren", role: .cancel) { store.cancelCode() }
                Spacer()
                Button { Task { await send() } } label: { HStack { if busy { ProgressView().controlSize(.small) }; Text("Bevestigen") } }
                    .buttonStyle(.borderedProminent).disabled(busy || code.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(24).frame(maxWidth: 480)
        .interactiveDismissDisabled()
    }

    private func send() async {
        busy = true; error = nil; defer { busy = false }
        do { try await store.submitCode(code) } catch { self.error = error.localizedDescription; code = "" }
    }
}

extension View {
    /// Shows the two sheets that the connection may need at any moment.
    func securitySheets(_ store: DoorStore) -> some View {
        self
            .sheet(isPresented: Binding(get: { store.needsCode != nil }, set: { _ in })) { CodeSheet(store: store).preferredColorScheme(.dark) }
            .sheet(item: Binding(get: { store.trustPrompt }, set: { _ in })) { p in TrustSheet(store: store, prompt: p).preferredColorScheme(.dark) }
    }
}
