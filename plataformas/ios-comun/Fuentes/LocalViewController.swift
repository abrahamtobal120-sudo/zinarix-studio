import Security
import UIKit
import WebKit

protocol LocalDelegate: AnyObject {
    func localWantsOptions(_ local: LocalViewController)
}

/// Zinarix on this device, on its own (no computer): the page of `Web/` that ships inside
/// the app (chats, agent, files), with the bridge it needs: the API keys (Keychain), a small
/// store for the chats, the project folder (the app's folder in Files) and the network.
///
/// The page is the app's own code and loads nothing from outside (its CSP forbids it), but
/// it shows what the AI answers, so the bridge still gives it little: it never gets a key
/// back, a key is only sent to the host it was saved for, and files stay inside the folder.
final class LocalViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    weak var delegate: LocalDelegate?

    private var web: WKWebView?
    private let streams = Streams()
    private static let home = URL(string: "\(WebBundle.scheme)://app/index.html")!
    private static let background = UIColor(red: 0x13 / 255.0, green: 0x14 / 255.0, blue: 0x17 / 255.0, alpha: 1)

    override func viewDidLoad() {
        super.viewDidLoad()
        title = Variante.nombre
        view.backgroundColor = LocalViewController.background
        overrideUserInterfaceStyle = .dark
        navigationItem.rightBarButtonItems = [
            UIBarButtonItem(image: UIImage(systemName: "gearshape"), style: .plain, target: self, action: #selector(optionsTapped)),
            UIBarButtonItem(image: UIImage(systemName: "plus.rectangle.on.rectangle"), style: .plain, target: self, action: #selector(newWindowTapped)),
        ]
        streams.onEvent = { [weak self] sid, kind, data in self?.emit(sid, kind, data) }
        makeWeb()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override var keyCommands: [UIKeyCommand]? {
        [UIKeyCommand(title: T("new_window"), action: #selector(newWindowTapped), input: "n", modifierFlags: .command)]
    }

    deinit {
        streams.stop()
    }

    /// After "Erase everything": start again from nothing.
    func reset() {
        streams.cancelAll()
        web?.load(URLRequest(url: LocalViewController.home))
    }

    private func makeWeb() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(WebBundle(), forURLScheme: WebBundle.scheme)
        let content = WKUserContentController()
        content.addScriptMessageHandler(WeakReplyHandler(self), contentWorld: .page, name: "zx")
        config.userContentController = content

        let w = WKWebView(frame: .zero, configuration: config)
        w.navigationDelegate = self
        w.uiDelegate = self
        w.isOpaque = false
        w.backgroundColor = LocalViewController.background
        w.scrollView.backgroundColor = LocalViewController.background
        w.scrollView.contentInsetAdjustmentBehavior = .never
        w.scrollView.bounces = false
        w.scrollView.isScrollEnabled = false
        w.allowsLinkPreview = false
        w.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(w)
        NSLayoutConstraint.activate([
            w.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            w.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            w.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            w.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        web = w
        w.load(URLRequest(url: LocalViewController.home))
    }

    @objc private func optionsTapped() {
        delegate?.localWantsOptions(self)
    }

    @objc private func newWindowTapped() {
        UIApplication.shared.requestSceneSessionActivation(nil, userActivity: nil, options: nil, errorHandler: nil)
    }

    private func external(_ url: URL?) {
        guard let url else { return }
        let scheme = (url.scheme ?? "").lowercased()
        guard scheme == "https" || scheme == "http" || scheme == "mailto" else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    // MARK: - Bridge

    /// An event of a network request, to the page: window.__zxEvent(sid, kind, data).
    private func emit(_ sid: String, _ kind: String, _ data: Any) {
        guard let web,
              let json = try? JSONSerialization.data(withJSONObject: [sid, kind, data]),
              let args = String(data: json, encoding: .utf8)
        else { return }
        web.evaluateJavaScript("window.__zxEvent.apply(null, \(args))", completionHandler: nil)
    }

    fileprivate func handle(_ message: WKScriptMessage, reply: @escaping (Any?, String?) -> Void) {
        // Only the app's own page, never a frame.
        guard message.frameInfo.isMainFrame,
              (message.frameInfo.request.url?.scheme ?? "").lowercased() == WebBundle.scheme,
              let body = message.body as? [String: Any], let op = body["op"] as? String
        else {
            reply(nil, "denied")
            return
        }
        do {
            reply(try run(op, body), nil)
        } catch let fail as Fail {
            reply(nil, fail.text)
        } catch {
            reply(nil, error.localizedDescription)
        }
    }

    private func run(_ op: String, _ body: [String: Any]) throws -> Any {
        func str(_ key: String) -> String { body[key] as? String ?? "" }
        switch op {
        case "keys.list":
            return Keys.list()
        case "keys.set":
            guard !str("key").isEmpty, !str("host").isEmpty else { throw Fail("The key is empty.") }
            try Keys.set(str("id"), key: str("key"), host: str("host"))
        case "keys.del":
            Keys.delete(str("id"))
        case "store.get":
            if let value = try LocalStore.get(str("name")) { return value }
        case "store.set":
            try LocalStore.set(str("name"), str("value"))
        case "store.del":
            try LocalStore.delete(str("name"))
        case "fs.list":
            return try Project.list(str("path"))
        case "fs.read":
            return try Project.read(str("path"))
        case "fs.write":
            try Project.write(str("path"), str("text"))
        case "fs.mkdir":
            try Project.mkdir(str("path"))
        case "fs.remove":
            try Project.remove(str("path"))
        case "http":
            try startRequest(body)
        case "http.abort":
            streams.abort(str("sid"))
        case "ui":
            switch str("action") {
            case "copy": UIPasteboard.general.string = str("value")
            case "options": delegate?.localWantsOptions(self)
            case "window": newWindowTapped()
            default: break
            }
        default:
            throw Fail("Unknown request: \(op)")
        }
        return NSNull()
    }

    /// A request to an AI provider. `{{key}}` in a header becomes the saved key of `keyOf`,
    /// and only when the request goes to the host that key was saved for.
    private func startRequest(_ body: [String: Any]) throws {
        func str(_ key: String) -> String { body[key] as? String ?? "" }
        let sid = str("sid")
        guard !sid.isEmpty, let url = URL(string: str("url")), let host = url.host?.lowercased(), url.user == nil else {
            throw Fail("That address is not valid.")
        }
        let scheme = (url.scheme ?? "").lowercased()
        let own = Link.privateIp(host) || host == "localhost" || host.hasSuffix(".local")
        guard scheme == "https" || (scheme == "http" && own) else {
            throw Fail("Only https addresses are allowed (http only for a server on your own network).")
        }
        var request = URLRequest(url: url)
        request.httpMethod = str("method").isEmpty ? "GET" : str("method").uppercased()
        let target = url.port.map { "\(host):\($0)" } ?? host
        let saved = Keys.get(str("keyOf"))
        for (name, value) in body["headers"] as? [String: String] ?? [:] {
            if value.contains("{{key}}") {
                guard let saved, saved.host.lowercased() == target else { continue }
                request.setValue(value.replacingOccurrences(of: "{{key}}", with: saved.key), forHTTPHeaderField: name)
            } else {
                request.setValue(value, forHTTPHeaderField: name)
            }
        }
        if !str("body").isEmpty { request.httpBody = Data(str("body").utf8) }
        streams.start(sid, request)
    }

    // MARK: - WKNavigationDelegate / WKUIDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        if (url?.scheme ?? "").lowercased() == WebBundle.scheme {
            decisionHandler(.allow)
            return
        }
        // A link in an answer: Safari. The app itself never leaves its own page.
        if navigationAction.navigationType == .linkActivated { external(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        external(navigationAction.request.url)
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        streams.cancelAll()
        webView.load(URLRequest(url: LocalViewController.home))
    }
}

/// The message handler is kept by the web view: it must not keep the screen alive.
private final class WeakReplyHandler: NSObject, WKScriptMessageHandlerWithReply {
    private weak var owner: LocalViewController?

    init(_ owner: LocalViewController) {
        self.owner = owner
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let owner else {
            replyHandler(nil, "closed")
            return
        }
        owner.handle(message, reply: replyHandler)
    }
}

/// An error whose words go to the page as they are.
struct Fail: Error {
    let text: String

    init(_ text: String) {
        self.text = text
    }
}

/// Serves the files of the `Web` folder of the app as zxapp://app/… (a real origin for the
/// page, and a response header with its Content-Security-Policy).
final class WebBundle: NSObject, WKURLSchemeHandler {
    static let scheme = "zxapp"
    private static let types = ["html": "text/html", "js": "text/javascript", "css": "text/css", "png": "image/png", "svg": "image/svg+xml", "json": "application/json"]
    private static let policy = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, let root = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true) else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        let parts = url.path.split(separator: "/").map(String.init)
        var file = root
        for p in parts.isEmpty ? ["index.html"] : parts {
            if p == ".." || p == "." {
                urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
                return
            }
            file.appendPathComponent(p)
        }
        guard let data = try? Data(contentsOf: file) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let type = WebBundle.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let headers = [
            "Content-Type": type.hasPrefix("text/") ? "\(type); charset=utf-8" : type,
            "Content-Length": "\(data.count)",
            "Cache-Control": "no-store",
            "Content-Security-Policy": WebBundle.policy,
            "X-Content-Type-Options": "nosniff",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
            urlSchemeTask.didFailWithError(URLError(.unknown))
            return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

/// The network requests of the page, streamed back piece by piece (the answers of the AI
/// arrive word by word). Events: head (status), chunk (base64), then end or error.
final class Streams: NSObject, URLSessionDataDelegate {
    var onEvent: ((String, String, Any) -> Void)?

    private var session: URLSession?
    private var sids: [Int: String] = [:]
    private var tasks: [String: URLSessionDataTask] = [:]

    func start(_ sid: String, _ request: URLRequest) {
        if session == nil {
            let config = URLSessionConfiguration.ephemeral
            // Seconds without receiving anything (a model thinking for long before it answers).
            config.timeoutIntervalForRequest = 300
            config.httpCookieStorage = nil
            config.urlCache = nil
            session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        }
        guard let task = session?.dataTask(with: request) else { return }
        sids[task.taskIdentifier] = sid
        tasks[sid] = task
        task.resume()
    }

    func abort(_ sid: String) {
        tasks[sid]?.cancel()
    }

    func cancelAll() {
        for task in tasks.values { task.cancel() }
    }

    /// The session keeps its delegate until it is invalidated.
    func stop() {
        onEvent = nil
        session?.invalidateAndCancel()
        session = nil
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if let sid = sids[dataTask.taskIdentifier] {
            onEvent?(sid, "head", (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if let sid = sids[dataTask.taskIdentifier] {
            onEvent?(sid, "chunk", data.base64EncodedString())
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let sid = sids.removeValue(forKey: task.taskIdentifier) else { return }
        tasks[sid] = nil
        if let error {
            onEvent?(sid, "error", error.localizedDescription)
        } else {
            onEvent?(sid, "end", 0)
        }
    }

    /// No redirects: a key must not follow one to another host.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// The API keys, in the Keychain of this device (not in backups, not synced). Each one is
/// saved with the host it belongs to.
enum Keys {
    private static let service = "com.zinarix.studio.keys"

    private static func valid(_ id: String) -> Bool {
        id.range(of: "^[a-z0-9_-]{1,40}$", options: .regularExpression) != nil
    }

    private static func query(_ id: String?) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        if let id { q[kSecAttrAccount as String] = id }
        return q
    }

    static func set(_ id: String, key: String, host: String) throws {
        guard valid(id), let data = try? JSONSerialization.data(withJSONObject: ["k": key, "h": host]) else {
            throw Fail("The key could not be saved.")
        }
        SecItemDelete(query(id) as CFDictionary)
        var add = query(id)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        if SecItemAdd(add as CFDictionary, nil) != errSecSuccess { throw Fail("The key could not be saved.") }
    }

    static func get(_ id: String) -> (key: String, host: String)? {
        guard valid(id) else { return nil }
        var q = query(id)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data,
              let o = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let key = o["k"], let host = o["h"]
        else { return nil }
        return (key, host)
    }

    /// Provider id → the host of its key. The keys themselves never go to the page.
    static func list() -> [String: String] {
        var q = query(nil)
        q[kSecReturnAttributes as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitAll
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let items = out as? [[String: Any]] else { return [:] }
        var hosts: [String: String] = [:]
        for item in items {
            if let id = item[kSecAttrAccount as String] as? String, let saved = get(id) { hosts[id] = saved.host }
        }
        return hosts
    }

    static func delete(_ id: String) {
        if valid(id) { SecItemDelete(query(id) as CFDictionary) }
    }

    static func deleteAll() {
        SecItemDelete(query(nil) as CFDictionary)
    }
}

/// The chats and the settings of the page: one small file per name.
enum LocalStore {
    private static var dir: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Zinarix", isDirectory: true)
    }

    private static func file(_ name: String) throws -> URL {
        guard name.range(of: "^[A-Za-z0-9_-]{1,80}$", options: .regularExpression) != nil else { throw Fail("Bad name.") }
        return dir.appendingPathComponent(name + ".json")
    }

    static func get(_ name: String) throws -> String? {
        let url = try file(name)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ name: String, _ value: String) throws {
        let url = try file(name)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data(value.utf8).write(to: url, options: .atomic)
    }

    static func delete(_ name: String) throws {
        let url = try file(name)
        try? FileManager.default.removeItem(at: url)
    }

    static func wipe() {
        try? FileManager.default.removeItem(at: dir)
    }
}

/// The project folder: the Documents folder of the app, which the Files app shows as
/// "On My iPad → Zinarix Studio". Paths are relative to it and cannot leave it.
enum Project {
    private static var root: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    private static func resolve(_ path: String, allowRoot: Bool = false) throws -> URL {
        var url = root
        var depth = 0
        for part in path.replacingOccurrences(of: "\\", with: "/").split(separator: "/") {
            if part == "." { continue }
            if part == ".." || part.contains("\0") { throw Fail("That path is not inside the project folder.") }
            url.appendPathComponent(String(part))
            depth += 1
        }
        if depth == 0, !allowRoot { throw Fail("A file name is missing.") }
        return url
    }

    static func list(_ path: String) throws -> [[String: Any]] {
        let dir = try resolve(path, allowRoot: true)
        let keys: [URLResourceKey] = [.isDirectoryKey, .fileSizeKey]
        let fm = FileManager.default
        if !fm.fileExists(atPath: dir.path) {
            if dir == root { return [] }
            throw Fail("That folder does not exist.")
        }
        return try fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys, options: []).map { item in
            let values = try? item.resourceValues(forKeys: Set(keys))
            return ["name": item.lastPathComponent, "dir": values?.isDirectory ?? false, "size": values?.fileSize ?? 0]
        }
    }

    static func read(_ path: String) throws -> String {
        let url = try resolve(path)
        guard FileManager.default.fileExists(atPath: url.path) else { throw Fail("That file does not exist.") }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
        if size > 2_000_000 { throw Fail("The file is too big (more than 2 MB).") }
        guard let text = String(data: try Data(contentsOf: url), encoding: .utf8) else { throw Fail("It is not a text file.") }
        return text
    }

    static func write(_ path: String, _ text: String) throws {
        let url = try resolve(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url, options: .atomic)
    }

    static func mkdir(_ path: String) throws {
        try FileManager.default.createDirectory(at: try resolve(path), withIntermediateDirectories: true)
    }

    static func remove(_ path: String) throws {
        try FileManager.default.removeItem(at: try resolve(path))
    }
}
