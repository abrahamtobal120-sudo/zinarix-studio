import LocalAuthentication
import UIKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    /// An alert that arrives while the app is in front is not shown (the panel shows it).
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([])
    }
}

/// One window of the app. iPhone: the list of computers, then the panel on top of it.
/// iPad: Zinarix working on its own (LocalViewController), with a side bar to change to the
/// panel of a computer; every window is its own session, so two chats (or two computers)
/// can be side by side.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate, PanelDelegate, ComputersDelegate, LocalDelegate {
    var window: UIWindow?

    private let list = ComputersViewController()
    private let panel = PanelViewController()
    /// Zinarix on this device (iPad only), made the first time it is shown.
    private var local: LocalViewController?
    private var showingLocal = false
    private var nav: UINavigationController?
    private var split: UISplitViewController?

    private var cover: UIView?
    private var locked = false
    private var authing = false

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        list.delegate = self
        panel.delegate = self

        let w = UIWindow(windowScene: windowScene)
        w.tintColor = UIColor(red: 0.42, green: 0.55, blue: 1.0, alpha: 1)
        if Variante.esIPad {
            let s = UISplitViewController(style: .doubleColumn)
            s.setViewController(list, for: .primary)
            s.setViewController(panel, for: .secondary)
            s.preferredSplitBehavior = .tile
            s.primaryBackgroundStyle = .sidebar
            split = s
            w.rootViewController = s
        } else {
            let n = UINavigationController(rootViewController: list)
            n.navigationBar.prefersLargeTitles = true
            nav = n
            w.rootViewController = n
        }
        window = w
        w.makeKeyAndVisible()

        locked = Prefs.lock
        // A link that opened the app (universal link), else the last computer.
        let opened = connectionOptions.userActivities.compactMap { Link.parse($0.webpageURL?.absoluteString) }.first
        let last = Prefs.startList ? nil : Computers.load().first?.link
        if let link = opened {
            show(link, animated: false)
        } else if Variante.independiente, split != nil, Prefs.local || last == nil {
            showLocal(withList: Prefs.startList)
        } else if let link = last {
            show(link, animated: false)
        } else if let s = split {
            s.preferredDisplayMode = .oneBesideSecondary
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if let link = Link.parse(userActivity.webpageURL?.absoluteString) { show(link, animated: true) }
    }

    // MARK: - Navigation

    private func show(_ link: Link, animated: Bool) {
        panel.open(link)
        Prefs.local = false
        if let s = split {
            if showingLocal {
                s.setViewController(panel, for: .secondary)
                showingLocal = false
            }
            s.preferredDisplayMode = .secondaryOnly
            s.show(.secondary)
        } else if let n = nav, !n.viewControllers.contains(panel) {
            n.pushViewController(panel, animated: animated)
        }
    }

    /// Zinarix on this iPad, without a computer.
    private func showLocal(withList: Bool = false) {
        guard let s = split else { return }
        Prefs.local = true
        let vc = local ?? LocalViewController()
        vc.delegate = self
        local = vc
        if !showingLocal {
            s.setViewController(vc, for: .secondary)
            showingLocal = true
        }
        s.preferredDisplayMode = withList ? .oneBesideSecondary : .secondaryOnly
        s.show(.secondary)
    }

    private func showList() {
        if let s = split {
            s.preferredDisplayMode = .oneBesideSecondary
            s.show(.primary)
        } else {
            panel.close()
            nav?.popToRootViewController(animated: true)
        }
    }

    private func showOptions(from host: UIViewController) {
        let options = OptionsViewController()
        options.onReset = { [weak self] in
            self?.panel.close()
            self?.local?.reset()
            self?.showList()
        }
        let n = UINavigationController(rootViewController: options)
        n.modalPresentationStyle = .formSheet
        (host.presentedViewController ?? host).present(n, animated: true)
    }

    // MARK: - ComputersDelegate / PanelDelegate

    func computers(_ list: ComputersViewController, didPick link: Link) {
        show(link, animated: true)
    }

    func computers(_ list: ComputersViewController, didForget link: Link) {
        if panel.link == link {
            panel.close()
            showList()
        }
    }

    func computersWantsOptions(_ list: ComputersViewController) {
        showOptions(from: window?.rootViewController ?? list)
    }

    func computersWantsLocal(_ list: ComputersViewController) {
        showLocal()
    }

    func localWantsOptions(_ local: LocalViewController) {
        showOptions(from: window?.rootViewController ?? local)
    }

    func panelWantsSetup(_ panel: PanelViewController) {
        showList()
    }

    func panelWantsOptions(_ panel: PanelViewController) {
        showOptions(from: window?.rootViewController ?? panel)
    }

    // MARK: - Lock (Options → "Lock with Face ID or passcode")

    func sceneDidEnterBackground(_ scene: UIScene) {
        if Prefs.lock {
            locked = true
            showCover()
        }
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        if !Prefs.lock {
            locked = false
            hideCover()
            return
        }
        if locked {
            showCover()
            if !authing { unlock() }
        }
    }

    private func showCover() {
        guard cover == nil, let w = window else { return }
        let v = UIView(frame: w.bounds)
        v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        v.backgroundColor = UIColor(red: 0x13 / 255.0, green: 0x14 / 255.0, blue: 0x17 / 255.0, alpha: 1)

        let label = UILabel()
        label.text = T("locked_title")
        label.textColor = .white
        label.font = .preferredFont(forTextStyle: .title3)
        label.textAlignment = .center
        label.numberOfLines = 0
        let button = UIButton(type: .system)
        button.setTitle(T("unlock"), for: .normal)
        button.addTarget(self, action: #selector(unlock), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [label, button])
        stack.axis = .vertical
        stack.spacing = 16
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        v.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: v.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: v.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: v.leadingAnchor, constant: 24),
        ])
        w.addSubview(v)
        w.endEditing(true)
        cover = v
    }

    private func hideCover() {
        cover?.removeFromSuperview()
        cover = nil
    }

    @objc private func unlock() {
        if authing { return }
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else {
            // The passcode of the device was removed: there is nothing to ask for.
            Prefs.lock = false
            locked = false
            hideCover()
            return
        }
        authing = true
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: T("unlock_reason")) { [weak self] ok, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                if ok {
                    self.locked = false
                    self.hideCover()
                }
                // The system sheet going away makes the scene active again: wait for that
                // before allowing another automatic prompt (else a cancel would loop).
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.authing = false }
            }
        }
    }
}
