import Foundation

/// Light wrapper around the server's JSON, so the app keeps working when the server gets new fields.
@dynamicMemberLookup
struct JSON {
    let raw: Any?
    init(_ raw: Any?) { self.raw = raw is NSNull ? nil : raw }

    subscript(dynamicMember key: String) -> JSON { JSON((raw as? [String: Any])?[key]) }
    subscript(_ key: String) -> JSON { JSON((raw as? [String: Any])?[key]) }
    subscript(_ index: Int) -> JSON {
        guard let a = raw as? [Any], a.indices.contains(index) else { return JSON(nil) }
        return JSON(a[index])
    }

    var isNull: Bool { raw == nil }
    var string: String? { raw as? String }
    var str: String { (raw as? String) ?? "" }
    var double: Double? { (raw as? NSNumber)?.doubleValue }
    var int: Int? { (raw as? NSNumber)?.intValue }
    var bool: Bool { (raw as? NSNumber)?.boolValue ?? false }
    var array: [JSON] { ((raw as? [Any]) ?? []).map { JSON($0) } }
    var dict: [String: Any] { (raw as? [String: Any]) ?? [:] }
    var strings: [String] { ((raw as? [Any]) ?? []).compactMap { $0 as? String } }
    /// A timestamp in milliseconds (how the server sends times).
    var date: Date? { double.map { Date(timeIntervalSince1970: $0 / 1000) } }

    var pretty: String {
        guard let raw, JSONSerialization.isValidJSONObject(raw),
              let d = try? JSONSerialization.data(withJSONObject: raw, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]),
              let s = String(data: d, encoding: .utf8) else { return raw.map { "\($0)" } ?? "null" }
        return s
    }
}

func ms(_ date: Date) -> Double { (date.timeIntervalSince1970 * 1000).rounded() }
