import Foundation
import Security

/// Stores the login in the iOS Keychain (encrypted by the system, only this app can read it, never leaves this device).
enum Keychain {
    static let service = "nl.sagatechbox.beheer"

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

    static func delete() {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        SecItemDelete(query as CFDictionary)
        #if DEBUG && targetEnvironment(simulator)
        UserDefaults.standard.removeObject(forKey: "debug.cred")
        #endif
    }
}
