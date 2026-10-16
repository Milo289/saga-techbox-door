import SwiftUI

/// Every setting of the door server in the app (only in the developer apps): the same options as the web panel, drawn from the
/// description the server sends. A new option on the server shows up here without changing the app.
@MainActor final class SettingsDraft: ObservableObject {
    @Published var edits: [String: Any] = [:]
    func value(_ f: JSON) -> Any? { edits[f.key.str] ?? f.value.raw }
    func set(_ f: JSON, _ v: Any?) { edits[f.key.str] = v ?? NSNull() }
}

struct AllSettingsView: View {
    @ObservedObject var store: DoorStore
    @StateObject private var draft = SettingsDraft()
    @State private var groups: [JSON] = []
    @State private var loading = true
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        List {
            if loading { HStack { ProgressView(); Text("Laden…").foregroundStyle(.secondary) } }
            if let error { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
            if !draft.edits.isEmpty {
                Section { Button { Task { await save() } } label: { HStack { if saving { ProgressView() }; Text("\(draft.edits.count) wijziging\(draft.edits.count == 1 ? "" : "en") opslaan").bold() } }.disabled(saving)
                    Button("Wijzigingen weggooien", role: .destructive) { draft.edits = [:] } }
            }
            Section {
                ForEach(Array(groups.enumerated()), id: \.offset) { _, g in
                    NavigationLink { GroupEditor(group: g, draft: draft) } label: {
                        HStack { Text(g.title.str); Spacer(); let n = g.fields.array.filter { draft.edits[$0.key.str] != nil }.count; if n > 0 { Text("\(n)").font(.caption.bold()).padding(.horizontal, 7).padding(.vertical, 2).background(Palette.accent, in: Capsule()).foregroundStyle(.black) } }
                    }
                }
            } footer: { Text("Alles wat het webpaneel ook kan instellen. Alleen in de ontwikkelaarsversie. Wijzigingen worden pas bewaard als je ze opslaat.") }
        }
        .navigationTitle("Serverinstellingen")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        loading = true; defer { loading = false }
        do { groups = try await store.call("GET", "api/settings-schema").groups.array; error = nil }
        catch { self.error = error.localizedDescription }
    }
    private func save() async {
        saving = true; defer { saving = false }
        var values: [String: Any] = [:]
        for (k, v) in draft.edits { values[k] = v is NSNull ? NSNull() : v }
        do { _ = try await store.post("api/settings-schema/save", ["values": values]); draft.edits = [:]; Haptics.success(); store.show("Opgeslagen"); await load() }
        catch { Haptics.error(); self.error = error.localizedDescription }
    }
}

struct GroupEditor: View {
    let group: JSON
    @ObservedObject var draft: SettingsDraft
    var body: some View {
        Form {
            Section { ForEach(Array(group.fields.array.enumerated()), id: \.offset) { _, f in FieldRow(field: f, draft: draft) } }
                footer: { if !group.help.str.isEmpty { Text(group.help.str) } }
        }
        .navigationTitle(group.title.str)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

/// "HH:MM" as a time of day
private func timeOf(_ s: String) -> Date {
    let p = s.split(separator: ":").compactMap { Int($0) }
    return Calendar.current.date(bySettingHour: p.first ?? 9, minute: p.count > 1 ? p[1] : 0, second: 0, of: Date()) ?? Date()
}
private func textOf(_ d: Date) -> String { let c = Calendar.current.dateComponents([.hour, .minute], from: d); return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0) }
private func dateOf(_ s: String) -> Date { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f.date(from: s) ?? Date() }
private func dateText(_ d: Date) -> String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f.string(from: d) }

/// one field of the server's description, with the kind of control it needs
struct FieldRow: View {
    let field: JSON
    @ObservedObject var draft: SettingsDraft

    var body: some View {
        let type = field.type.str, label = field.label.str
        switch type {
        case "records": RecordsEditor(field: field, draft: draft)
        case "dayhours": DayHoursEditor(field: field, draft: draft)
        case "lines":
            VStack(alignment: .leading, spacing: 4) {
                Text(label).font(.subheadline)
                TextEditor(text: Binding(get: { ((draft.value(field) as? [Any]) ?? []).compactMap { $0 as? String }.joined(separator: "\n") }, set: { draft.set(field, $0.components(separatedBy: "\n")) }))
                    .frame(minHeight: 90).font(.callout).scrollContentBackground(.hidden).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
            }
        case "multi":
            VStack(alignment: .leading, spacing: 4) {
                Text(label).font(.subheadline)
                let on = Set(((draft.value(field) as? [Any]) ?? []).map { "\($0)" })
                ForEach(Array(field.options.array.enumerated()), id: \.offset) { _, o in
                    Toggle(o[1].str, isOn: Binding(get: { on.contains(o[0].str) }, set: { v in var s = on; if v { s.insert(o[0].str) } else { s.remove(o[0].str) }; draft.set(field, s.sorted().map { $0 }) }))
                }
            }
        default:
            ScalarEditor(spec: field, label: label, value: Binding(get: { draft.value(field) }, set: { draft.set(field, $0) }))
        }
    }
}

/// text, number, toggle, choice, time, date, colour, password
struct ScalarEditor: View {
    let spec: JSON
    let label: String
    @Binding var value: Any?

    private var str: String { (value as? String) ?? (value.map { "\($0)" } ?? "") }

    var body: some View {
        switch spec.type.str {
        case "toggle": Toggle(label, isOn: Binding(get: { (value as? Bool) ?? ((value as? NSNumber)?.boolValue ?? false) }, set: { value = $0 }))
        case "number":
            Stepper(value: Binding(get: { (value as? NSNumber)?.intValue ?? (value as? Int) ?? spec.min.int ?? 0 }, set: { value = $0 }), in: (spec.min.int ?? 0)...(spec.max.int ?? 1000), step: (spec.max.int ?? 1000) > 200 ? 10 : 1) {
                HStack { Text(label); Spacer(); Text(str.isEmpty ? "0" : "\((value as? NSNumber)?.intValue ?? 0)").foregroundStyle(.secondary).monospacedDigit() }
            }
        case "choice":
            Picker(label, selection: Binding(get: { str }, set: { value = $0 })) {
                ForEach(Array(spec.options.array.enumerated()), id: \.offset) { _, o in Text(o[1].str).tag(o[0].str) }
            }
        case "time":
            HStack {
                Text(label)
                Spacer()
                if str.isEmpty { Button("Instellen") { value = "09:00" }.buttonStyle(.borderless) }
                else {
                    DatePicker("", selection: Binding(get: { timeOf(str) }, set: { value = textOf($0) }), displayedComponents: .hourAndMinute).labelsHidden()
                    if spec.required.bool != true { Button { value = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.borderless).foregroundStyle(.secondary) }
                }
            }
        case "date":
            HStack {
                Text(label)
                Spacer()
                if str.isEmpty { Button("Kies een datum") { value = dateText(Date()) }.buttonStyle(.borderless) }
                else {
                    DatePicker("", selection: Binding(get: { dateOf(str) }, set: { value = dateText($0) }), displayedComponents: .date).labelsHidden()
                    Button { value = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.borderless).foregroundStyle(.secondary)
                }
            }
        case "color":
            HStack {
                Text(label)
                Spacer()
                if str.isEmpty { Text("standaard").font(.caption).foregroundStyle(.secondary) }
                ColorPicker("", selection: Binding(get: { Color(hex: str) ?? Palette.accent }, set: { value = $0.hexString }), supportsOpacity: false).labelsHidden()
                if !str.isEmpty { Button { value = "" } label: { Image(systemName: "arrow.uturn.backward.circle") }.buttonStyle(.borderless).foregroundStyle(.secondary) }
            }
        case "password":
            VStack(alignment: .leading, spacing: 4) {
                Text(label).font(.subheadline)
                SecureField("", text: Binding(get: { str }, set: { value = $0 })).autocorrectionDisabledCompat()
            }
        default:
            VStack(alignment: .leading, spacing: 4) {
                Text(label).font(.subheadline)
                TextField(spec.placeholder.str, text: Binding(get: { str }, set: { value = String($0.prefix(spec.max.int ?? 200)) }), axis: .vertical).lineLimit(1...3).autocorrectionDisabledCompat()
            }
        }
    }
}

/// "Other times on this day": like the rest of the week, own times, or closed
struct DayHoursEditor: View {
    let field: JSON
    @ObservedObject var draft: SettingsDraft
    private var current: [String: Any]? { draft.value(field) as? [String: Any] }
    private var mode: String { guard let c = current else { return "normal" }; return (c["off"] as? Bool) == true ? "off" : "own" }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Picker(field.label.str, selection: Binding(get: { mode }, set: { m in
                switch m { case "normal": draft.set(field, nil); case "off": draft.set(field, ["off": true]); default: draft.set(field, ["from": "09:00", "to": "17:00"]) }
            })) { Text("Zoals de rest").tag("normal"); Text("Eigen tijden").tag("own"); Text("Gesloten").tag("off") }
            if mode == "own", let c = current {
                HStack {
                    DatePicker("Van", selection: Binding(get: { timeOf(c["from"] as? String ?? "09:00") }, set: { draft.set(field, ["from": textOf($0), "to": c["to"] as? String ?? "17:00"]) }), displayedComponents: .hourAndMinute)
                    DatePicker("Tot", selection: Binding(get: { timeOf(c["to"] as? String ?? "17:00") }, set: { draft.set(field, ["from": c["from"] as? String ?? "09:00", "to": textOf($0)]) }), displayedComponents: .hourAndMinute)
                }
            }
        }
    }
}

/// A list of rows (extra buttons, breaks, holidays, rules), each row made of small fields
struct RecordsEditor: View {
    let field: JSON
    @ObservedObject var draft: SettingsDraft
    private var rows: [[String: Any]] { ((draft.value(field) as? [Any]) ?? []).compactMap { $0 as? [String: Any] } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(field.label.str).font(.subheadline.weight(.semibold))
            ForEach(Array(rows.enumerated()), id: \.offset) { i, _ in
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(field.columns.array.enumerated()), id: \.offset) { _, c in
                        ScalarEditor(spec: c, label: c.label.str, value: Binding(get: { rows[i][c.key.str] }, set: { v in var r = rows; r[i][c.key.str] = v ?? ""; draft.set(field, r) }))
                    }
                    Button("Verwijderen", role: .destructive) { var r = rows; r.remove(at: i); draft.set(field, r) }.buttonStyle(.borderless).font(.caption)
                }
                .padding(10).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
            }
            Button { var r = rows; r.append(field.blank.dict); draft.set(field, r) } label: { Label(field.addLabel.str.isEmpty ? "Toevoegen" : field.addLabel.str, systemImage: "plus") }.buttonStyle(.borderless)
        }
    }
}
