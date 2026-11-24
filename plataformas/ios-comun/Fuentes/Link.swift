import Foundation

/// A link of the Zinarix Studio remote, as the computer shows it (Settings → Phone). Same
/// rules as the Android app (apps/remote-android, Link.java):
///
/// - permanent: https://zinarix-studio.vercel.app/p#g=<gist>&k=<key> (the website finds the
///   computer's current tunnel address and goes on to it);
/// - tunnel or own domain: https://host/#k=<key>;
/// - same Wi-Fi: http://192.168.x.x:47390 (private addresses only).
///
/// The app only ever shows pages of the host of the link (plus Cloudflare tunnels for the
/// permanent link); anything else opens in Safari.
struct Link: Equatable {
    static let relayHost = "zinarix-studio.vercel.app"

    let url: URL
    /// Permanent link through the website.
    let relay: Bool
    /// Same Wi-Fi (plain http to a private address).
    let lan: Bool

    static func == (a: Link, b: Link) -> Bool {
        a.url.absoluteString == b.url.absoluteString
    }

    /// The first remote link found in some text (pasted or scanned), or nil.
    static func find(_ text: String?) -> Link? {
        guard let text, let regex = try? NSRegularExpression(pattern: "https?://[^\\s\"'<>]+", options: [.caseInsensitive]) else {
            return nil
        }
        let ns = text as NSString
        for m in regex.matches(in: text, options: [], range: NSRange(location: 0, length: ns.length)) {
            if let l = parse(ns.substring(with: m.range)) { return l }
        }
        return nil
    }

    static func parse(_ raw: String?) -> Link? {
        guard let raw,
              let c = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              let url = c.url
        else { return nil }
        let scheme = (c.scheme ?? "").lowercased()
        let host = (c.host ?? "").lowercased()
        if host.isEmpty || c.user != nil { return nil }
        let frag = c.percentEncodedFragment ?? ""
        if scheme == "https" {
            if host == relayHost {
                let ok = (c.path == "/p" || c.path == "/p.html")
                    && matches(frag, "(?:^|&)g=[0-9a-f]{20,40}(?:&|$)")
                    && matches(frag, "(?:^|&)k=[0-9a-f]{32,}(?:&|$)")
                return ok ? Link(url: url, relay: true, lan: false) : nil
            }
            return Link(url: url, relay: false, lan: false)
        }
        if scheme == "http" && privateIp(host) { return Link(url: url, relay: false, lan: true) }
        return nil
    }

    /// May the app show this page (instead of sending it to Safari)?
    func allows(_ page: URL?) -> Bool {
        guard let page else { return false }
        let scheme = (page.scheme ?? "").lowercased()
        let host = (page.host ?? "").lowercased()
        if relay {
            if scheme != "https" { return false }
            if host == Link.relayHost { return page.path == "/p" || page.path == "/p.html" }
            // The website only ever forwards to a free Cloudflare tunnel (see website/p.js).
            return host.hasSuffix(".trycloudflare.com")
        }
        return scheme == (url.scheme ?? "").lowercased()
            && host == (url.host ?? "").lowercased()
            && page.port == url.port
    }

    /// Short words for the list of computers.
    var label: String {
        if relay { return Link.relayHost + "/p" }
        let host = url.host ?? ""
        if let port = url.port { return "\(host):\(port)" }
        return host
    }

    static func privateIp(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        if parts.count != 4 { return false }
        var n: [Int] = []
        for p in parts {
            guard !p.isEmpty, p.count <= 3, p.allSatisfy({ $0.isASCII && $0.isNumber }), let v = Int(p), v <= 255 else {
                return false
            }
            n.append(v)
        }
        return n[0] == 10
            || (n[0] == 192 && n[1] == 168)
            || (n[0] == 172 && n[1] >= 16 && n[1] <= 31)
            || (n[0] == 100 && n[1] >= 64 && n[1] <= 127) // Tailscale / CGNAT
            || n[0] == 127
    }

    private static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: pattern, options: .regularExpression) != nil
    }
}
