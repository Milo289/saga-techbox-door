import SwiftUI

struct MacActivity: View {
    @ObservedObject var store: DoorStore
    @State private var scope = 0

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $scope) { Text("Deur").tag(0); Text("Deze app").tag(1) }.pickerStyle(.segmented).padding(14).frame(maxWidth: 320)
            if scope == 0 {
                List(store.history) { h in
                    HStack(alignment: .top) {
                        Text(h.at.whenText).font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: 110, alignment: .leading)
                        Text(h.type).font(.caption.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 1).background(.quaternary, in: Capsule())
                        Text(h.text); Spacer()
                        if !h.by.isEmpty { Text(h.by).font(.caption).foregroundStyle(.secondary) }
                    }
                }.overlay { if store.history.isEmpty { ContentUnavailableView("Geen activiteit", systemImage: "list.bullet.rectangle", description: Text("Of je hebt het recht “Activiteitenlog zien” niet.")) } }
            } else {
                List(store.events) { e in HStack(alignment: .top) { Text(e.at.hm).font(.caption.monospacedDigit()).foregroundStyle(.secondary); Text(e.kind).font(.caption.weight(.semibold)); Text(e.text) } }
            }
        }.navigationTitle("Activiteit")
    }
}
