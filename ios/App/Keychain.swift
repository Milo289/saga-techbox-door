import Foundation
import Security 

/// Stores the login in the iOS Keychain (encrypted by the system, only this app can read it, never leaves this device).
enum Keychain {
    static let service = Bundle.main.bundleIdentifier ?? "nl.sagatechbox.beheer" // each app (normal, Dev, Mac) has its own login item, so they never ask each other for permission

    static func save(username: String, password: String) -> Bool {
        delete()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: username,
            kSecValueData as String: Data(password.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        if SecItemAdd(query as CFDictionary, nil) == errSecSuccess { return true }
        #if DEBUG && targetEnvironment(simulator)
        UserDefaults.standard.set([username, password], forKey: "debug.cred") // test builds in the simulator have no signing, so no Keychain
        return true
        #else
        return false
        #endif
    }

    static func load() -> (username: String, password: String)? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnAttributes as String: true,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let dict = item as? [String: Any],
              let account = dict[kSecAttrAccount as String] as? String,
              let data = dict[kSecValueData as String] as? Data,
              let password = String(data: data, encoding: .utf8) else {
            #if DEBUG && targetEnvironment(simulator)
            if let a = UserDefaults.standard.stringArray(forKey: "debug.cred"), a.count == 2 { return (a[0], a[1]) }
            #endif
            return nil
        }
        return (account, password)
    }

    // the long-lived session key, kept apart from the password: with two-step verification the app must not need the code again every time
    private static var tokenService: String { service + ".token" }
    static func saveToken(_ token: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: tokenService]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecAttrAccount as String] = "session"; add[kSecValueData as String] = Data(token.utf8); add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        if SecItemAdd(add as CFDictionary, nil) != errSecSuccess { UserDefaults.standard.set(token, forKey: "debug.token") }
    }
    static func loadToken() -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: tokenService, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        if SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let d = item as? Data, let t = String(data: d, encoding: .utf8) { return t }
        return UserDefaults.standard.string(forKey: "debug.token")
    }
    static func deleteToken() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: tokenService] as CFDictionary)
        UserDefaults.standard.removeObject(forKey: "debug.token")
    }

    static func delete() {
        deleteToken()
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        SecItemDelete(query as CFDictionary)
        #if DEBUG && targetEnvironment(simulator)
        UserDefaults.standard.removeObject(forKey: "debug.cred")
        #endif
    }
}
