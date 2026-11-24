import UIKit

protocol ComputersDelegate: AnyObject {
    func computers(_ list: ComputersViewController, didPick link: Link)
    func computers(_ list: ComputersViewController, didForget link: Link)
    func computersWantsOptions(_ list: ComputersViewController)
}

/// The saved computers and the ways to add one (QR, paste, type). On the iPhone it is the
/// first screen; on the iPad it is the side bar.
final class ComputersViewController: UITableViewController {
    weak var delegate: ComputersDelegate?
    private var saved: [Computers.Saved] = []
    private let adds = ["scan", "paste", "type"]
    private let icons = ["qrcode.viewfinder", "doc.on.clipboard", "keyboard"]

    init() {
        super.init(style: .insetGrouped)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = Variante.nombre
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            image: UIImage(systemName: "gearshape"), style: .plain, target: self, action: #selector(optionsTapped))
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "add")
        NotificationCenter.default.addObserver(self, selector: #selector(reload), name: .computersChanged, object: nil)
        reload()
    }

    @objc private func reload() {
        saved = Computers.load()
        tableView.reloadData()
    }

    @objc private func optionsTapped() {
        delegate?.computersWantsOptions(self)
    }

    // MARK: - Table

    override func numberOfSections(in tableView: UITableView) -> Int { 2 }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        section == 0 ? saved.count : adds.count
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        if section == 0 { return saved.isEmpty ? nil : T("computers") }
        return T("add")
    }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        section == 1 ? T("setup_hint") + "\n\n" + T("tip") : nil
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        if indexPath.section == 0 {
            let cell = tableView.dequeueReusableCell(withIdentifier: "pc") ?? UITableViewCell(style: .subtitle, reuseIdentifier: "pc")
            let s = saved[indexPath.row]
            cell.textLabel?.text = s.title
            let kind = T(s.link.relay ? "kind_anywhere" : s.link.lan ? "kind_wifi" : "kind_internet")
            cell.detailTextLabel?.text = s.link.lan ? "\(kind) · \(s.link.label)" : kind
            cell.detailTextLabel?.textColor = .secondaryLabel
            cell.imageView?.image = UIImage(systemName: "desktopcomputer")
            cell.accessoryType = .disclosureIndicator
            return cell
        }
        let cell = tableView.dequeueReusableCell(withIdentifier: "add", for: indexPath)
        cell.textLabel?.text = T(adds[indexPath.row])
        cell.textLabel?.textColor = view.tintColor
        cell.imageView?.image = UIImage(systemName: icons[indexPath.row])
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if indexPath.section == 0 {
            delegate?.computers(self, didPick: saved[indexPath.row].link)
            return
        }
        switch adds[indexPath.row] {
        case "scan": scan()
        case "paste": paste()
        default: typeLink(text: "")
        }
    }

    override func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard indexPath.section == 0 else { return nil }
        let s = saved[indexPath.row]
        let forget = UIContextualAction(style: .destructive, title: T("forget")) { [weak self] _, _, done in
            self?.forget(s)
            done(true)
        }
        let rename = UIContextualAction(style: .normal, title: T("rename")) { [weak self] _, _, done in
            self?.rename(s)
            done(true)
        }
        return UISwipeActionsConfiguration(actions: [forget, rename])
    }

    // MARK: - Adding

    private func scan() {
        let scanner = ScannerViewController()
        scanner.onFound = { [weak self] link in
            guard let self else { return }
            self.delegate?.computers(self, didPick: link)
        }
        let nav = UINavigationController(rootViewController: scanner)
        nav.modalPresentationStyle = .formSheet
        present(nav, animated: true)
    }

    private func paste() {
        if let link = Link.find(UIPasteboard.general.string) {
            delegate?.computers(self, didPick: link)
        } else {
            typeLink(text: "", note: T("clipboard_empty"))
        }
    }

    private func typeLink(text: String, note: String? = nil) {
        let a = UIAlertController(title: T("link_hint"), message: note, preferredStyle: .alert)
        a.addTextField { f in
            f.text = text
            f.placeholder = "https://…"
            f.keyboardType = .URL
            f.autocapitalizationType = .none
            f.autocorrectionType = .no
            f.clearButtonMode = .whileEditing
        }
        a.addAction(UIAlertAction(title: T("cancel"), style: .cancel))
        a.addAction(UIAlertAction(title: T("connect"), style: .default) { [weak self, weak a] _ in
            guard let self else { return }
            let typed = a?.textFields?.first?.text ?? ""
            if let link = Link.find(typed) ?? Link.parse(typed) {
                self.delegate?.computers(self, didPick: link)
            } else {
                self.typeLink(text: typed, note: T("bad_link"))
            }
        })
        present(a, animated: true)
    }

    private func rename(_ s: Computers.Saved) {
        let a = UIAlertController(title: T("rename"), message: T("rename_hint"), preferredStyle: .alert)
        a.addTextField { f in
            f.text = s.custom ? s.name : ""
            f.placeholder = s.title
        }
        a.addAction(UIAlertAction(title: T("cancel"), style: .cancel))
        a.addAction(UIAlertAction(title: T("save"), style: .default) { [weak a] _ in
            Computers.rename(s.link, a?.textFields?.first?.text ?? "")
        })
        present(a, animated: true)
    }

    private func forget(_ s: Computers.Saved) {
        let a = UIAlertController(title: "\(T("forget")): \(s.title)", message: T("forget_text"), preferredStyle: .alert)
        a.addAction(UIAlertAction(title: T("cancel"), style: .cancel))
        a.addAction(UIAlertAction(title: T("forget"), style: .destructive) { [weak self] _ in
            guard let self else { return }
            Computers.forget(s.link)
            self.delegate?.computers(self, didForget: s.link)
        })
        present(a, animated: true)
    }
}
