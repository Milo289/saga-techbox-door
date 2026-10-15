import Foundation
import Darwin

/// Finds door servers on the same wifi without typing an address: a small broadcast question, answers from every server.
enum Discovery {
    struct Found: Identifiable, Hashable {
        var id: String { "\(host):\(port)" }
        let name: String
        let host: String
        let port: Int
        let version: String
        var url: String { "http://\(host):\(port)" }
    }

    static func find(timeout: TimeInterval = 1.8, port: UInt16 = 41234, address: String = "255.255.255.255") async -> [Found] {
        await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async { cont.resume(returning: scan(timeout: timeout, port: port, address: address)) }
        }
    }

    private static func scan(timeout: TimeInterval, port: UInt16, address: String) -> [Found] {
        let fd = socket(AF_INET, SOCK_DGRAM, 0)
        guard fd >= 0 else { return [] }
        defer { close(fd) }
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &yes, socklen_t(MemoryLayout<Int32>.size))
        var tv = timeval(tv_sec: 0, tv_usec: 200_000)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        var dest = sockaddr_in()
        dest.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        dest.sin_family = sa_family_t(AF_INET)
        dest.sin_port = port.bigEndian
        inet_pton(AF_INET, address, &dest.sin_addr)
        let question = Array("SAGA-DOOR?".utf8)
        _ = withUnsafePointer(to: &dest) { p in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) { sendto(fd, question, question.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }

        var found: [String: Found] = [:]
        let end = Date().addingTimeInterval(timeout)
        var buf = [UInt8](repeating: 0, count: 2048)
        while Date() < end {
            var from = sockaddr_in()
            var len = socklen_t(MemoryLayout<sockaddr_in>.size)
            let n = withUnsafeMutablePointer(to: &from) { p in
                p.withMemoryRebound(to: sockaddr.self, capacity: 1) { recvfrom(fd, &buf, buf.count, 0, $0, &len) }
            }
            if n <= 0 { continue }
            guard let obj = try? JSONSerialization.jsonObject(with: Data(buf[0..<n])) as? [String: Any],
                  obj["app"] as? String == "saga-techbox-door", let p = (obj["port"] as? NSNumber)?.intValue, p > 0 else { continue }
            var ip = from.sin_addr
            var text = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            inet_ntop(AF_INET, &ip, &text, socklen_t(INET_ADDRSTRLEN))
            let host = String(cString: text)
            found["\(host):\(p)"] = Found(name: (obj["name"] as? String) ?? "Deurserver", host: host, port: p, version: (obj["version"] as? String) ?? "")
        }
        return Array(found.values).sorted { $0.name < $1.name }
    }
}
