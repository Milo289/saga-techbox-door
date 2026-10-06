import SwiftUI
import WebKit
import UIKit
import UniformTypeIdentifiers

/// The control panel of the door server, shown in a web view. A small bridge (`window.doorApp`) gives the page
/// the powers of the app: Keychain login, haptics, badge, share sheet for backups, settings.
enum Bridge {
    static let js = """
    (function () {
      var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.door;
      if (!h) return;
      var call = function (name, payload) { return h.postMessage({ name: name, payload: payload || {} }); };
      window.doorApp = {
        isApp: true, platform: 'ios',
        notify: function (title, body) { call('notify', { title: String(title), body: String(body || '') }); },
        report: function (info) { call('report', info || {}); },
        info: function () { return call('info'); },
        openSettings: function () { call('openSettings'); },
        revealData: function () {},
        saveFile: function (name, text) { return call('saveFile', { name: String(name), text: String(text) }); },
        openFile: function () { return call('openFile'); },
        saveLogin: function (u, p) { return call('saveLogin', { username: String(u), password: String(p) }); },
        loadLogin: function () { return call('loadLogin'); },
        clearLogin: function () { return Promise.resolve({ ok: true }); },
        onTrayStatus: function (cb) { window.__doorStatus = cb; },
        haptic: function (kind) { call('haptic', { kind: String(kind || 'light') }); }
      };
    })();
    """
}

struct WebContainer: UIViewRepresentable {
    let base: URL
    @ObservedObject var model: AppModel

    func makeCoordinator() -> Coordinator { Coordinator(model: model, base: base) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsInlineMediaPlayback = true
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(source: Bridge.js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        controller.addScriptMessageHandler(context.coordinator, contentWorld: .page, name: "door")
        config.userContentController = controller

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.contentInsetAdjustmentBehavior = .never   // the page takes care of the notch with env(safe-area-inset-*)
        web.navigationDelegate = context.coordinator
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        web.load(URLRequest(url: base.appendingPathComponent("admin")))
        model.webView = web
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandlerWithReply, UIDocumentPickerDelegate {
        let model: AppModel
        let base: URL
        private var pickContinuation: CheckedContinuation<String?, Never>?

        init(model: AppModel, base: URL) { self.model = model; self.base = base }

        // Only pages of the door server itself may use the bridge (it can hand out the stored login).
        func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
            guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.host == base.host,
                  let body = message.body as? [String: Any], let name = body["name"] as? String else { replyHandler(nil, "niet toegestaan"); return }
            let payload = body["payload"] as? [String: Any] ?? [:]
            Task { @MainActor in await self.handle(name, payload, replyHandler) }
        }

        @MainActor private func handle(_ name: String, _ p: [String: Any], _ reply: @escaping (Any?, String?) -> Void) async {
            switch name {
            case "info":
                let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1"
                reply(["version": v, "platform": "ios", "arch": "", "serverMode": "remote", "lan": [String](), "tray": false, "hotkeys": false,
                       "closeToTray": false, "alwaysOnTop": false, "zoom": 1, "dataDir": ""] as [String: Any], nil)
            case "report":
                model.setBadge(Int(p["open"] as? Double ?? 0))
                reply(nil, nil)
            case "notify":
                model.notifyIfInBackground(title: p["title"] as? String ?? "Deur", body: p["body"] as? String ?? "")
                reply(nil, nil)
            case "haptic":
                switch p["kind"] as? String {
                case "heavy": UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
                case "success": model.haptic(.success)
                case "error": model.haptic(.error)
                default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
                }
                reply(nil, nil)
            case "openSettings":
                model.showSettings = true
                reply(nil, nil)
            case "saveLogin":
                if let u = p["username"] as? String, let pw = p["password"] as? String { reply(["ok": Keychain.save(username: u, password: pw)], nil) } else { reply(["ok": false], nil) }
            case "loadLogin":
                if let c = Keychain.load() { reply(["username": c.username, "password": c.password], nil) } else { reply(nil, nil) }
            case "saveFile":
                reply(await share(name: p["name"] as? String ?? "bestand.json", text: p["text"] as? String ?? ""), nil)
            case "openFile":
                if let text = await pickFile() { reply(["ok": true, "text": text], nil) } else { reply(["ok": false, "canceled": true], nil) }
            default:
                reply(nil, "onbekend")
            }
        }

        // MARK: share sheet (save a backup to Files, AirDrop, …)
        @MainActor private func share(name: String, text: String) async -> [String: Any] {
            let safe = name.replacingOccurrences(of: "/", with: "-")
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe)
            do { try text.write(to: url, atomically: true, encoding: .utf8) } catch { return ["ok": false] }
            guard let top = Coordinator.topController() else { return ["ok": false] }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = top.view
            sheet.popoverPresentationController?.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 0, height: 0)
            top.present(sheet, animated: true)
            return ["ok": true]
        }

        // MARK: pick a backup file to restore
        @MainActor private func pickFile() async -> String? {
            guard let top = Coordinator.topController() else { return nil }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json], asCopy: true)
            picker.delegate = self
            top.present(picker, animated: true)
            return await withCheckedContinuation { pickContinuation = $0 }
        }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            let text = urls.first.flatMap { try? String(contentsOf: $0, encoding: .utf8) }
            pickContinuation?.resume(returning: text); pickContinuation = nil
        }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { pickContinuation?.resume(returning: nil); pickContinuation = nil }

        @MainActor static func topController() -> UIViewController? {
            var top = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first?.rootViewController
            while let next = top?.presentedViewController { top = next }
            return top
        }

        // a failed load (server off, wrong network) shows a retry page instead of a blank screen
        func webView(_ web: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            let html = """
            <meta name=viewport content="width=device-width,initial-scale=1"><body style="margin:0;background:#000;color:#a1a1aa;font:17px -apple-system;display:grid;place-items:center;height:100vh;text-align:center">
            <div><div style="font-size:22px;color:#f5f5f7;font-weight:700;margin-bottom:8px">Geen verbinding</div>De deurserver is niet bereikbaar.<br>Staat je telefoon op het juiste netwerk?<br><br>
            <a href="\(base.absoluteString)/admin" style="color:#30d158;font-weight:600">Opnieuw proberen</a></div>
            """
            web.loadHTMLString(html, baseURL: base)
        }
    }
}
