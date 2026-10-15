import SwiftUI
import AppKit

typealias MacPref = ExtraPref // the keys live with the shared extras

enum CSV {
    static func export(_ requests: [VisitRequest]) {
        func q(_ s: String) -> String { "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm"
        var out = "Tijd,Soort,Naam,Nummer,Onderwerp,Bericht,Antwoord,Status\n"
        for r in requests.sorted(by: { $0.createdAt < $1.createdAt }) {
            out += [f.string(from: r.createdAt), r.typeLabel, r.name, r.nr, r.topic, r.message, r.reply, r.state].map(q).joined(separator: ",") + "\n"
        }
        let panel = NSSavePanel(); panel.nameFieldStringValue = "bezoekers.csv"; panel.allowedContentTypes = [.commaSeparatedText]
        if panel.runModal() == .OK, let url = panel.url { try? out.write(to: url, atomically: true, encoding: .utf8) }
    }
}
