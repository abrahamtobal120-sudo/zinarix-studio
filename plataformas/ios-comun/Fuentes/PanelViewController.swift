import UIKit
import UserNotifications
import WebKit

protocol PanelDelegate: AnyObject {
    /// "Change computer" in the panel, or in the "could not open" screen.
    func panelWantsSetup(_ panel: PanelViewController)
    func panelWantsOptions(_ panel: PanelViewController)
}

/// The panel of one computer: the page Zinarix Studio serves (phonePage.ts on the desktop)
/// inside a web view, with the same `ZinarixNative` bridge the Android app gives it.
final class PanelViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    weak var delegate: PanelDelegate?
    private(set) var link: Link?

    private var web: WKWebView?
    private let spinner = UIActivityIndicatorView(style: .large)
    private let message = UIStackView()
    private let messageTitle = UILabel()
    private let messageText = UILabel()
    private let retryButton = UIButton(type: .system)
    private let changeButton = UIButton(type: .system)
    private var failed = false
    private var retryTimer: Timer?
    private var keepAwake = false

    private static let background = UIColor(red: 0x13 / 255.0, green: 0x14 / 255.0, blue: 0x17 / 255.0, alpha: 1)

    // MARK: - View

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = PanelViewController.background
        overrideUserInterfaceStyle = .dark

        spinner.color = .white
        spinner.hidesWhenStopped = true
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)

        messageTitle.font = .preferredFont(forTextStyle: .title2)
        messageTitle.textColor = .white
        messageTitle.textAlignment = .center
        messageTitle.numberOfLines = 0
        messageText.font = .preferredFont(forTextStyle: .body)
        messageText.textColor = UIColor(white: 0.75, alpha: 1)
        messageText.textAlignment = .center
        messageText.numberOfLines = 0
        retryButton.setTitle(T("retry"), for: .normal)
        retryButton.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        changeButton.setTitle(T("change"), for: .normal)
        changeButton.addTarget(self, action: #selector(changeTapped), for: .touchUpInside)
        message.axis = .vertical
        message.spacing = 14
        message.alignment = .center
        message.translatesAutoresizingMaskIntoConstraints = false
        for v in [messageTitle, messageText, retryButton, changeButton] as [UIView] { message.addArrangedSubview(v) }
        view.addSubview(message)

        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            message.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            message.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            message.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
            message.leadingAnchor.constraint(greaterThanOrEqualTo: view.layoutMarginsGuide.leadingAnchor),
            message.trailingAnchor.constraint(lessThanOrEqualTo: view.layoutMarginsGuide.trailingAnchor),
        ])

        if Variante.esIPad {
            navigationItem.rightBarButtonItems = [
                UIBarButtonItem(image: UIImage(systemName: "gearshape"), style: .plain, target: self, action: #selector(optionsTapped)),
                UIBarButtonItem(image: UIImage(systemName: "arrow.clockwise"), style: .plain, target: self, action: #selector(retryTapped)),
                UIBarButtonItem(image: UIImage(systemName: "plus.rectangle.on.rectangle"), style: .plain, target: self, action: #selector(newWindowTapped)),
            ]
        }

        NotificationCenter.default.addObserver(self, selector: #selector(cameBack), name: UIApplication.willEnterForegroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(namesChanged), name: .computersChanged, object: nil)
        render()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // On the iPhone the panel fills the screen: its own header is the only bar.
        if !Variante.esIPad { navigationController?.setNavigationBarHidden(true, animated: animated) }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if !Variante.esIPad { navigationController?.setNavigationBarHidden(false, animated: animated) }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override var keyCommands: [UIKeyCommand]? {
        var cmds = [UIKeyCommand(title: T("reload"), action: #selector(retryTapped), input: "r", modifierFlags: .command)]
        if Variante.esIPad {
            cmds.append(UIKeyCommand(title: T("new_window"), action: #selector(newWindowTapped), input: "n", modifierFlags: .command))
        }
        return cmds
    }

    deinit {
        retryTimer?.invalidate()
        if keepAwake { UIApplication.shared.isIdleTimerDisabled = false }
    }

    // MARK: - Opening a computer

    func open(_ link: Link) {
        self.link = link
        Computers.remember(link)
        loadViewIfNeeded()
        failed = false
        makeWeb()
        web?.load(URLRequest(url: link.url))
        spinner.startAnimating()
        render()
    }

    /// No computer: the empty screen (iPad) or nothing (iPhone goes back to the list).
    func close() {
        link = nil
        dropWeb()
        failed = false
        if isViewLoaded { render() }
    }

    private func makeWeb() {
        dropWeb()
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.applicationNameForUserAgent = "ZinarixRemote/\(Bridge.version)"
        let content = WKUserContentController()
        content.addUserScript(WKUserScript(source: Bridge.script(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if Variante.esIPad {
            content.addUserScript(WKUserScript(source: Bridge.wideScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        content.add(WeakHandler(self), name: "zx")
        config.userContentController = content

        let w = WKWebView(frame: .zero, configuration: config)
        w.navigationDelegate = self
        w.uiDelegate = self
        w.isOpaque = false
        w.backgroundColor = PanelViewController.background
        w.scrollView.backgroundColor = PanelViewController.background
        w.scrollView.contentInsetAdjustmentBehavior = .never
        w.scrollView.bounces = false
        w.allowsLinkPreview = false
        w.translatesAutoresizingMaskIntoConstraints = false
        view.insertSubview(w, at: 0)
        // iPad: under the bar of the window. iPhone: edge to edge (the page leaves room for
        // the notch with env(safe-area-inset-*)).
        let top = Variante.esIPad ? view.safeAreaLayoutGuide.topAnchor : view.topAnchor
        NSLayoutConstraint.activate([
            w.topAnchor.constraint(equalTo: top),
            w.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            w.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            w.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        web = w
    }

    private func dropWeb() {
        retryTimer?.invalidate()
        retryTimer = nil
        guard let w = web else { return }
        w.configuration.userContentController.removeScriptMessageHandler(forName: "zx")
        w.navigationDelegate = nil
        w.uiDelegate = nil
        w.stopLoading()
        w.removeFromSuperview()
        web = nil
        setKeepAwake(false)
    }

    private func render() {
        let name = link.flatMap { l in Computers.load().first(where: { $0.link == l })?.title }
        title = name ?? Variante.nombre
        web?.isHidden = failed
        if link == nil {
            spinner.stopAnimating()
            message.isHidden = false
            messageTitle.text = T("empty_title")
            messageText.text = T("empty_text")
            retryButton.isHidden = true
            changeButton.isHidden = true
        } else if failed {
            spinner.stopAnimating()
            message.isHidden = false
            messageTitle.text = T("failed_title")
            messageText.text = T(link?.lan == true ? "failed_lan" : "failed_remote") + "\n\n" + T("failed_auto")
            retryButton.isHidden = false
            changeButton.isHidden = false
        } else {
            message.isHidden = true
        }
    }

    private func showFailed() {
        failed = true
        render()
        // Quiet retries: the panel comes back by itself when the computer answers.
        retryTimer?.invalidate()
        retryTimer = Timer.scheduledTimer(withTimeInterval: 6, repeats: true) { [weak self] _ in
            guard let self, self.failed, let link = self.link, self.view.window != nil else { return }
            self.web?.load(URLRequest(url: link.url))
        }
    }

    // MARK: - Actions

    @objc private func retryTapped() {
        guard let link else { return }
        open(link)
    }

    @objc private func changeTapped() {
        delegate?.panelWantsSetup(self)
    }

    @objc private func optionsTapped() {
        delegate?.panelWantsOptions(self)
    }

    @objc private func newWindowTapped() {
        // Another window of the app (another session next to this one, iPad only).
        UIApplication.shared.requestSceneSessionActivation(nil, userActivity: nil, options: nil, errorHandler: nil)
    }

    @objc private func cameBack() {
        if failed, let link { web?.load(URLRequest(url: link.url)) }
    }

    @objc private func namesChanged() {
        if isViewLoaded { render() }
    }

    private func external(_ url: URL) {
        let scheme = (url.scheme ?? "").lowercased()
        guard scheme == "https" || scheme == "http" || scheme == "mailto" else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    private func setKeepAwake(_ on: Bool) {
        if on == keepAwake { return }
        keepAwake = on
        UIApplication.shared.isIdleTimerDisabled = on
    }

    // MARK: - Bridge (what the panel may ask of the device)

    fileprivate func handle(_ message: WKScriptMessage) {
        // Only the page of the computer (never a frame or a page the link does not cover).
        guard message.frameInfo.isMainFrame, let link, link.allows(message.frameInfo.request.url),
              let body = message.body as? [String: Any], let action = body["a"] as? String
        else { return }
        switch action {
        case "notify":
            Notifier.post(body["text"] as? String ?? "")
        case "askNotify":
            Notifier.ask()
        case "vibrate":
            if Prefs.vibrate { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
        case "keepAwake":
            setKeepAwake(body["on"] as? Bool ?? false)
        case "setup":
            delegate?.panelWantsSetup(self)
        case "options":
            delegate?.panelWantsOptions(self)
        case "status":
            Notifier.badge(body["waiting"] as? Int ?? 0)
        case "computer":
            Computers.name(link, body["name"] as? String ?? "")
        default:
            break
        }
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if (url.scheme ?? "").lowercased() == "zinarix-app" {
            if url.host == "setup" { delegate?.panelWantsSetup(self) }
            decisionHandler(.cancel)
            return
        }
        // Frames inside the page follow the page's own rules (its CSP allows none).
        if let frame = navigationAction.targetFrame, !frame.isMainFrame {
            decisionHandler(.allow)
            return
        }
        if let link, link.allows(url) {
            if navigationAction.targetFrame == nil {
                // target=_blank to the same computer: stay in this view.
                webView.load(navigationAction.request)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
            return
        }
        external(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        spinner.stopAnimating()
        if failed {
            failed = false
            retryTimer?.invalidate()
            retryTimer = nil
        }
        render()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadFailed(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadFailed(error)
    }

    private func loadFailed(_ error: Error) {
        // -999: a load replaced by another one (a redirect, a retry). Not a failure.
        if (error as NSError).code == NSURLErrorCancelled { return }
        spinner.stopAnimating()
        if !failed { showFailed() }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // The page's process died (low memory): load it again instead of a blank view.
        if let link { open(link) }
    }

    // MARK: - WKUIDelegate (the page's alert / confirm / prompt)

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: T("alert_title"), message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: T("ok"), style: .default) { _ in completionHandler() })
        show(a) { completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: T("alert_title"), message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: T("cancel"), style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: T("ok"), style: .default) { _ in completionHandler(true) })
        show(a) { completionHandler(false) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: T("alert_title"), message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: T("cancel"), style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: T("ok"), style: .default) { [weak a] _ in completionHandler(a?.textFields?.first?.text ?? "") })
        show(a) { completionHandler(nil) }
    }

    /// WebKit crashes the app when a dialog's answer is never given: if the dialog cannot be
    /// shown (the view is not on screen, another one is up) it is answered right away.
    private func show(_ alert: UIAlertController, otherwise: () -> Void) {
        if view.window != nil, presentedViewController == nil {
            present(alert, animated: true)
        } else {
            otherwise()
        }
    }
}

/// The content controller keeps its handler alive: go through a weak reference so the panel
/// can be freed.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    private weak var panel: PanelViewController?

    init(_ panel: PanelViewController) {
        self.panel = panel
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        panel?.handle(message)
    }
}

/// `window.ZinarixNative`, the object phonePage.ts looks for. Android gives it with
/// addJavascriptInterface; here a script defines it and passes each call to the app.
enum Bridge {
    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    static func script() -> String {
        let v = version.replacingOccurrences(of: "\\", with: "").replacingOccurrences(of: "\"", with: "")
        return """
        (function () {
          if (window.ZinarixNative) return;
          var post = function (m) { try { window.webkit.messageHandlers.zx.postMessage(m); } catch (e) {} };
          window.ZinarixNative = {
            version: function () { return "\(v)"; },
            notify: function (t) { post({ a: 'notify', text: String(t || '') }); },
            canNotify: function () { return true; },
            askNotify: function () { post({ a: 'askNotify' }); },
            vibrate: function (ms) { post({ a: 'vibrate', ms: Number(ms) || 0 }); },
            keepAwake: function (on) { post({ a: 'keepAwake', on: !!on }); },
            // Dictation: the microphone key of the iOS keyboard does it.
            canDictate: function () { return false; },
            dictate: function () {},
            setup: function () { post({ a: 'setup' }); },
            options: function () { post({ a: 'options' }); },
            status: function (busy, waiting, folder) {
              post({ a: 'status', busy: !!busy, waiting: Number(waiting) || 0, folder: String(folder || '') });
            },
            computer: function (name) { post({ a: 'computer', name: String(name || '') }); }
          };
          // Web speech recognition does not work inside an app's web view: hide the page's
          // microphone button (the keyboard has its own).
          try { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; } catch (e) {}
        })();
        """
    }

    /// iPad: the chat keeps a readable width on a wide screen. Set through the style object
    /// (the page's CSP blocks added style sheets, not this).
    static let wideScript = """
    (function () {
      var pad = 'max(14px, calc((100% - 900px) / 2))';
      ['log', 'foot'].forEach(function (id) {
        var e = document.getElementById(id);
        if (e) { e.style.paddingLeft = pad; e.style.paddingRight = pad; }
      });
    })();
    """
}

/// Alerts of the panel ("the AI asks for permission", "the answer is ready") while the app
/// is not in front.
enum Notifier {
    static func ask() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    static func post(_ text: String) {
        // In front: the panel already shows it.
        if text.isEmpty || UIApplication.shared.applicationState == .active { return }
        let content = UNMutableNotificationContent()
        content.title = T("alert_title")
        content.body = Prefs.lock ? "" : text
        content.sound = .default
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }

    /// Actions waiting for approval, on the icon of the app.
    static func badge(_ count: Int) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized else { return }
            DispatchQueue.main.async { UIApplication.shared.applicationIconBadgeNumber = max(0, count) }
        }
    }
}
