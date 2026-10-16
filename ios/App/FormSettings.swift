import SwiftUI

/// The settings of the visitor form (what must be filled in per button, consent, limits, texts), drawn from the description the server sends.
/// Because the server describes the settings, a new option shows up here without changing the app.
struct FormSettingsView: View {
    @ObservedObject var store: DoorStore
    @State private var groups: [JSON] = []
    @State private var edits: [String: Any] = [:]
    @State private var loading = true
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        Form {
            if loading { HStack { ProgressView(); Text("Laden…").foregroundStyle(.secondary) } }
            if let error { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
            ForEach(Array(groups.enumerated()), id: \.offset) { _, g in
                Section {
                    ForEach(Array(g.fields.array.enumerated()), id: \.offset) { _, f in row(f) }
                } header: { Text(g.title.str) } footer: { if !g.help.str.isEmpty { Text(g.help.str) } }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Bezoekersformulier")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button { Task { await save() } } label: { if saving { ProgressView() } else { Text("Opslaan") } }.disabled(edits.isEmpty || saving) } }
        .task { await load() }
    }

    @ViewBuilder private func row(_ f: JSON) -> some View {
        let key = f.key.str, label = f.label.str
        switch f.type.str {
        case "choice":
            Picker(label, selection: Binding(get: { (edits[key] as? String) ?? f.value.str }, set: { edits[key] = $0 })) {
                ForEach(Array(f.options.array.enumerated()), id: \.offset) { _, o in Text(o[1].str).tag(o[0].str) }
            }
        case "toggle":
            Toggle(label, isOn: Binding(get: { (edits[key] as? Bool) ?? f.value.bool }, set: { edits[key] = $0 }))
        case "number":
            Stepper(value: Binding(get: { (edits[key] as? Int) ?? f.value.int ?? 0 }, set: { edits[key] = $0 }), in: (f.min.int ?? 0)...(f.max.int ?? 1000), step: (f.max.int ?? 1000) > 200 ? 10 : 1) {
                HStack { Text(label); Spacer(); Text("\((edits[key] as? Int) ?? f.value.int ?? 0)").foregroundStyle(.secondary).monospacedDigit() }
            }
        default:
            VStack(alignment: .leading, spacing: 4) {
                Text(label).font(.subheadline)
                TextField("", text: Binding(get: { (edits[key] as? String) ?? f.value.str }, set: { edits[key] = $0 }), axis: .vertical).lineLimit(1...3)
            }
        }
    }

    private func load() async {
        loading = true; defer { loading = false }
        do { groups = try await store.call("GET", "api/form-schema").groups.array; error = nil }
        catch { self.error = store.can("settings") ? error.localizedDescription : "Je account mag deze instellingen niet wijzigen." }
    }

    private func save() async {
        saving = true; defer { saving = false }
        await store.run("Opgeslagen") { _ = try await store.post("api/form-settings", ["values": edits]) }
        edits = [:]
        await load()
    }
}
