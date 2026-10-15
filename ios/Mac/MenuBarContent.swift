import SwiftUI
import AppKit

/// The little panel under the menu bar icon: status at a glance, three buttons, the newest visitors.
struct MenuBarContent: View {
    @ObservedObject var store: DoorStore
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !store.hasState {
                Text("Nog niet verbonden").font(.headline)
                Button("Venster openen") { show() }
            } else {
                HStack(spacing: 10) {
                    Circle().fill(Palette.color(store.mode)).frame(width: 14, height: 14)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(store.name): \(store.label)").font(.headline)
                        if let u = store.until { Text("tot \(u.hm)").font(.caption).foregroundStyle(.secondary) }
                        else if !store.message.isEmpty { Text(store.message).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    }
                }
                HStack(spacing: 8) {
                    ForEach(DoorModeKind.allCases) { m in
                        Button { Task { await store.setStatus(m.rawValue) } } label: {
                            Label(m.label, systemImage: m.symbol).frame(maxWidth: .infinity)
                        }.buttonStyle(.borderedProminent).tint(Palette.color(m.rawValue)).controlSize(.regular)
                    }
                }
                if !store.openRequests.isEmpty {
                    Divider()
                    Text("Bezoekers").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(store.openRequests.prefix(4)) { r in
                        HStack(spacing: 8) {
                            Image(systemName: r.symbol).foregroundStyle(Palette.accent).frame(width: 18)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(r.name.isEmpty ? "Iemand" : r.name).font(.subheadline.weight(.semibold))
                                Text(r.summary.isEmpty ? r.typeLabel : r.summary).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                            Text(r.createdAt.ago).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            Divider()
            HStack {
                Button("Venster openen") { show() }
                Spacer()
                Button("Stop") { NSApp.terminate(nil) }.keyboardShortcut("q")
            }
        }
        .padding(14).frame(width: 340)
    }

    private func show() {
        NSApp.activate(ignoringOtherApps: true)
        if NSApp.windows.contains(where: { $0.title == "Deur Beheer" }) { NSApp.windows.first { $0.title == "Deur Beheer" }?.makeKeyAndOrderFront(nil) }
        else { openWindow(id: "main") }
    }
}
