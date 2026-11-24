import LocalAuthentication
import UIKit
import WebKit

/// The options of the app itself (the panel has its own settings, kept on the computer).
final class OptionsViewController: UITableViewController {
    /// Called after "Erase everything".
    var onReset: (() -> Void)?

    private struct Row {
        let title: String
        let hint: String?
        let kind: Kind
    }

    private enum Kind {
        case lock, vibrate, sound, start, reset, version
    }

    private let sections: [(String, [Row])] = [
        (T("opt_privacy"), [Row(title: T("opt_lock"), hint: T("opt_lock_hint"), kind: .lock)]),
        (T("opt_alerts"), [
            Row(title: T("opt_vibrate"), hint: T("opt_vibrate_hint"), kind: .vibrate),
            Row(title: T("opt_sound"), hint: nil, kind: .sound),
        ]),
        (T("opt_app"), [
            Row(title: T("opt_start"), hint: T("opt_start_hint"), kind: .start),
            Row(title: T("opt_reset"), hint: nil, kind: .reset),
            Row(title: "\(Variante.nombre) \(Bridge.version)", hint: nil, kind: .version),
        ]),
    ]

    init() {
        super.init(style: .insetGrouped)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = T("options")
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(close))
    }

    @objc private func close() {
        dismiss(animated: true)
    }

    override func numberOfSections(in tableView: UITableView) -> Int { sections.count }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        sections[section].1.count
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        sections[section].0
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let row = sections[indexPath.section].1[indexPath.row]
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.text = row.title
        cell.textLabel?.numberOfLines = 0
        cell.detailTextLabel?.text = row.hint
        cell.detailTextLabel?.numberOfLines = 0
        cell.detailTextLabel?.textColor = .secondaryLabel
        cell.selectionStyle = .none
        switch row.kind {
        case .lock: cell.accessoryView = toggle(Prefs.lock, #selector(lockChanged(_:)))
        case .vibrate: cell.accessoryView = toggle(Prefs.vibrate, #selector(vibrateChanged(_:)))
        case .start: cell.accessoryView = toggle(Prefs.startList, #selector(startChanged(_:)))
        case .sound:
            cell.accessoryType = .disclosureIndicator
            cell.selectionStyle = .default
        case .reset:
            cell.textLabel?.textColor = .systemRed
            cell.selectionStyle = .default
        case .version:
            cell.textLabel?.textColor = .secondaryLabel
        }
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        switch sections[indexPath.section].1[indexPath.row].kind {
        case .sound:
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        case .reset:
            askReset()
        default:
            break
        }
    }

    private func toggle(_ on: Bool, _ action: Selector) -> UISwitch {
        let s = UISwitch()
        s.isOn = on
        s.addTarget(self, action: action, for: .valueChanged)
        return s
    }

    @objc private func lockChanged(_ sender: UISwitch) {
        if sender.isOn, !LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) {
            // No passcode on the device: the lock would let nobody in.
            sender.setOn(false, animated: true)
            let a = UIAlertController(title: T("opt_lock"), message: T("opt_lock_none"), preferredStyle: .alert)
            a.addAction(UIAlertAction(title: T("ok"), style: .default))
            present(a, animated: true)
            return
        }
        Prefs.lock = sender.isOn
    }

    @objc private func vibrateChanged(_ sender: UISwitch) {
        Prefs.vibrate = sender.isOn
    }

    @objc private func startChanged(_ sender: UISwitch) {
        Prefs.startList = sender.isOn
    }

    private func askReset() {
        let a = UIAlertController(title: T("reset_title"), message: T(Variante.independiente ? "reset_text_local" : "reset_text"), preferredStyle: .alert)
        a.addAction(UIAlertAction(title: T("cancel"), style: .cancel))
        a.addAction(UIAlertAction(title: T("opt_reset"), style: .destructive) { [weak self] _ in
            // The pairings live in the web storage of each computer's page.
            WKWebsiteDataStore.default().removeData(
                ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast
            ) {
                Prefs.reset()
                // The app on its own: the API keys and the chats (the project files stay).
                Keys.deleteAll()
                LocalStore.wipe()
                Computers.forgetAll()
                NotificationCenter.default.post(name: .computersChanged, object: nil)
                let done = self?.onReset
                self?.dismiss(animated: true) { done?() }
            }
        })
        present(a, animated: true)
    }
}
