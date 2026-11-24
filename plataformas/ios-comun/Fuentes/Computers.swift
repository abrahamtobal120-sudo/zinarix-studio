import Foundation

/// The computers this device has opened, newest first (their links and the names the
/// computers gave), so changing from one to another is one tap. Each one keeps its own
/// pairing: the panel of every address has its own web storage.
enum Computers {
    private static let key = "computers"
    private static let limit = 10

    struct Saved {
        let link: Link
        let name: String
        /// The user named it here: the computer's own name does not replace it.
        let custom: Bool

        var title: String { name.isEmpty ? link.label : name }
    }

    static func load() -> [Saved] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return [] }
        var out: [Saved] = []
        for o in list {
            guard let link = Link.parse(o["u"] as? String) else { continue }
            out.append(Saved(link: link, name: o["n"] as? String ?? "", custom: o["c"] as? Bool ?? false))
        }
        return out
    }

    /// The link just opened goes first (it keeps its name).
    static func remember(_ link: Link) {
        var list = load()
        var name = ""
        var custom = false
        if let old = list.first(where: { $0.link == link }) {
            name = old.name
            custom = old.custom
        }
        list.removeAll { $0.link == link }
        list.insert(Saved(link: link, name: name, custom: custom), at: 0)
        write(list)
    }

    /// The name the computer told the panel (its host name).
    static func name(_ link: Link, _ name: String) {
        let n = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        var list = load()
        var changed = false
        for i in list.indices where list[i].link == link && !list[i].custom && list[i].name != n {
            list[i] = Saved(link: link, name: n, custom: false)
            changed = true
        }
        if changed { write(list) }
    }

    /// A name chosen here; empty goes back to the computer's own (sent on the next visit).
    static func rename(_ link: Link, _ name: String) {
        let n = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        var list = load()
        for i in list.indices where list[i].link == link {
            list[i] = Saved(link: link, name: n, custom: !n.isEmpty)
        }
        write(list)
    }

    static func forget(_ link: Link) {
        var list = load()
        list.removeAll { $0.link == link }
        write(list)
    }

    static func forgetAll() {
        UserDefaults.standard.removeObject(forKey: key)
    }

    private static func write(_ list: [Saved]) {
        let out: [[String: Any]] = list.prefix(limit).map { s in
            var o: [String: Any] = ["u": s.link.url.absoluteString, "n": s.name]
            if s.custom { o["c"] = true }
            return o
        }
        if let data = try? JSONSerialization.data(withJSONObject: out) {
            UserDefaults.standard.set(data, forKey: key)
        }
        NotificationCenter.default.post(name: .computersChanged, object: nil)
    }
}

extension Notification.Name {
    /// The saved list changed (every window refreshes its list).
    static let computersChanged = Notification.Name("zx.computersChanged")
}

/// The options of the app (Options screen).
enum Prefs {
    private static let d = UserDefaults.standard

    /// Ask for Face ID / Touch ID / the device code to open the panel.
    static var lock: Bool {
        get { d.bool(forKey: "lock") }
        set { d.set(newValue, forKey: "lock") }
    }

    static var vibrate: Bool {
        get { d.object(forKey: "vibrate") == nil ? true : d.bool(forKey: "vibrate") }
        set { d.set(newValue, forKey: "vibrate") }
    }

    /// Show the list of computers on launch instead of entering the last one.
    static var startList: Bool {
        get { d.bool(forKey: "startList") }
        set { d.set(newValue, forKey: "startList") }
    }

    /// The last thing open was Zinarix on this device (not a computer). iPad only.
    static var local: Bool {
        get { d.object(forKey: "local") == nil ? true : d.bool(forKey: "local") }
        set { d.set(newValue, forKey: "local") }
    }

    static func reset() {
        for k in ["lock", "vibrate", "startList", "local"] { d.removeObject(forKey: k) }
    }
}
