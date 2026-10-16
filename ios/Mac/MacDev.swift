import SwiftUI
import AppKit

/// Only in "Deur Dev": tools for building and fault finding — raw data, an API console, the live event log.
struct MacDev: View {
    @ObservedObject var store: DoorStore
    @State private var method = "GET"
    @State private var path = "api/status"
    @State private var bodyText = ""
    @State private var output = ""
    @State private var busy = false
    @State private var part = "view"
    private let parts = ["view", "settings", "me", "requests", "power", "health", "integ", "devices", "sightings", "server", "system"]

    var body: some View {
        TabView {
            console.tabItem { Label("API-console", systemImage: "terminal") }
            data.tabItem { Label("Gegevens", systemImage: "curlybraces") }
            log.tabItem { Label("Gebeurtenissen", systemImage: "waveform.path.ecg") }
            about.tabItem { Label("Verbinding", systemImage: "network") }
            VStack(spacing: 12) { Text("Een overzicht voor de ontwikkelaar: versies, verbinding en de laatste gebeurtenissen. Er staan nooit wachtwoorden of sleutels in.").foregroundStyle(.secondary); ShareLink(item: Diagnostics.report(store), subject: Text("Diagnose Deur Beheer")) { Label("Diagnose delen", systemImage: "stethoscope") }.buttonStyle(.borderedProminent) }.padding(24).tabItem { Label("Diagnose", systemImage: "stethoscope") }
        }.padding(8).navigationTitle("Ontwikkelaar")
    }

    private var console: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Picker("", selection: $method) { Text("GET").tag("GET"); Text("POST").tag("POST") }.pickerStyle(.segmented).frame(width: 140)
                TextField("pad, bijv. api/admin-state", text: $path).textFieldStyle(.roundedBorder).font(.system(.body, design: .monospaced)).onSubmit { send() }
                Button { send() } label: { if busy { ProgressView().controlSize(.small) } else { Text("Versturen") } }.buttonStyle(.borderedProminent).keyboardShortcut(.return, modifiers: .command)
            }
            if method == "POST" {
                Text("Inhoud (JSON)").font(.caption).foregroundStyle(.secondary)
                TextEditor(text: $bodyText).font(.system(.body, design: .monospaced)).frame(height: 90).overlay(RoundedRectangle(cornerRadius: 6).stroke(.quaternary))
            }
            HStack { Text("Antwoord").font(.caption).foregroundStyle(.secondary); Spacer(); Button("Kopiëren") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(output, forType: .string) }.disabled(output.isEmpty) }
            ScrollView { Text(output.isEmpty ? "—" : output).font(.system(.callout, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                .padding(8).background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
        }.padding(14)
    }

    private var data: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("Deel", selection: $part) { ForEach(parts, id: \.self) { Text($0).tag($0) } }.frame(width: 260)
            ScrollView { Text(store.state[part].pretty).font(.system(.callout, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                .padding(8).background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
        }.padding(14)
    }

    private var log: some View {
        VStack(alignment: .leading) {
            HStack { Text("\(store.events.count) regels").foregroundStyle(.secondary); Spacer(); Button("Wissen") { store.clearLog() } }
            List(store.events) { e in HStack(alignment: .top) { Text(e.at.hm).font(.caption.monospacedDigit()).foregroundStyle(.secondary); Text(e.kind).font(.caption.weight(.semibold)).frame(width: 90, alignment: .leading); Text(e.text).font(.system(.callout, design: .monospaced)) } }
            Toggle("Elke aanroep loggen", isOn: Binding(get: { UserDefaults.standard.bool(forKey: Pref.verboseLog) }, set: { UserDefaults.standard.set($0, forKey: Pref.verboseLog) }))
        }.padding(14)
    }

    private var about: some View {
        Form {
            LabeledContent("Server", value: UserDefaults.standard.string(forKey: "serverURL") ?? "—")
            LabeledContent("Verbinding", value: { switch store.connection { case .live: return "live"; case .connecting: return "verbinden…"; case .idle: return "uit"; case .offline(let m): return m } }())
            LabeledContent("Reactietijd", value: store.lastLatencyMs.map { "\($0) ms" } ?? "—")
            LabeledContent("Serverversie", value: store.state.server.version.str.isEmpty ? "—" : store.state.server.version.str)
            LabeledContent("Rechten", value: store.perms.joined(separator: ", "))
            LabeledContent("App", value: "\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?") (\(Build.configuration))")
            LabeledContent("Mac", value: ProcessInfo.processInfo.operatingSystemVersionString)
            Button("Opnieuw verbinden") { store.restart() }
        }.formStyle(.grouped).padding(8)
    }

    private func send() {
        busy = true
        let p = path.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        var body: [String: Any]?
        if method == "POST", !bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            guard let d = bodyText.data(using: .utf8), let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { output = "De inhoud is geen geldige JSON (een object met { })."; busy = false; return }
            body = obj
        }
        Task {
            defer { busy = false }
            do { let t0 = Date(); let out = try await store.call(method, p, body: body); output = "// \(Int(Date().timeIntervalSince(t0) * 1000)) ms\n" + out.pretty }
            catch { output = "Fout: \(error.localizedDescription)" }
        }
    }
}
