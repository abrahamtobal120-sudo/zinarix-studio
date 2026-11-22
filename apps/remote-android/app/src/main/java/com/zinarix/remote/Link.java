package com.zinarix.remote;

import android.net.Uri;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A link of the Zinarix Studio remote, as the computer shows it (Settings → Phone):
 *
 * <ul>
 *   <li>permanent: https://zinarix-studio.vercel.app/p#g=&lt;gist&gt;&amp;k=&lt;key&gt; (the website finds
 *       the computer's current tunnel address and goes on to it);
 *   <li>tunnel or own domain: https://host/#k=&lt;key&gt;;
 *   <li>same Wi-Fi: http://192.168.x.x:47390 (private addresses only).
 * </ul>
 *
 * The app only ever shows pages of the host of the link (plus Cloudflare tunnels for the
 * permanent link); anything else opens in the phone's browser.
 */
final class Link {
    static final String RELAY_HOST = "zinarix-studio.vercel.app";
    private static final Pattern URL = Pattern.compile("https?://[^\\s\"'<>]+", Pattern.CASE_INSENSITIVE);
    private static final Pattern GIST = Pattern.compile("(?:^|&)g=[0-9a-f]{20,40}(?:&|$)");
    private static final Pattern KEY = Pattern.compile("(?:^|&)k=[0-9a-f]{32,}(?:&|$)");

    final Uri uri;
    /** Permanent link through the website. */
    final boolean relay;
    /** Same Wi-Fi (plain http to a private address). */
    final boolean lan;

    private Link(Uri uri, boolean relay, boolean lan) {
        this.uri = uri;
        this.relay = relay;
        this.lan = lan;
    }

    /** The first remote link found in some text (pasted or shared), or null. */
    static Link find(String text) {
        if (text == null) return null;
        Matcher m = URL.matcher(text.trim());
        while (m.find()) {
            Link l = parse(m.group());
            if (l != null) return l;
        }
        return null;
    }

    /**
     * Like {@link #find} but only links that are surely of Zinarix (the permanent one, the
     * Wi-Fi one, or one with the remote's key): for text shared from other apps, where any
     * https address (an article to ask the AI about) must not replace the computer.
     */
    static Link findRemote(String text) {
        if (text == null) return null;
        Matcher m = URL.matcher(text.trim());
        while (m.find()) {
            Link l = parse(m.group());
            if (l == null) continue;
            String frag = l.uri.getEncodedFragment() == null ? "" : l.uri.getEncodedFragment();
            if (l.relay || l.lan || KEY.matcher(frag).find()) return l;
        }
        return null;
    }

    static Link parse(String raw) {
        if (raw == null) return null;
        Uri u;
        try {
            u = Uri.parse(raw.trim());
        } catch (RuntimeException e) {
            return null;
        }
        String scheme = lower(u.getScheme());
        String host = lower(u.getHost());
        if (host.isEmpty() || u.getUserInfo() != null) return null;
        String frag = u.getEncodedFragment() == null ? "" : u.getEncodedFragment();
        if ("https".equals(scheme)) {
            if (RELAY_HOST.equals(host)) {
                String path = u.getPath() == null ? "" : u.getPath();
                boolean ok = (path.equals("/p") || path.equals("/p.html"))
                        && GIST.matcher(frag).find()
                        && KEY.matcher(frag).find();
                return ok ? new Link(u, true, false) : null;
            }
            return new Link(u, false, false);
        }
        if ("http".equals(scheme) && privateIp(host)) return new Link(u, false, true);
        return null;
    }

    /** May the app show this page (instead of sending it to the browser)? */
    boolean allows(Uri page) {
        if (page == null) return false;
        String scheme = lower(page.getScheme());
        String host = lower(page.getHost());
        if (relay) {
            if (!"https".equals(scheme)) return false;
            if (host.equals(RELAY_HOST)) {
                String path = page.getPath() == null ? "" : page.getPath();
                return path.equals("/p") || path.equals("/p.html");
            }
            // The website only ever forwards to a free Cloudflare tunnel (see website/p.js).
            return host.endsWith(".trycloudflare.com");
        }
        return scheme.equals(lower(uri.getScheme()))
                && host.equals(lower(uri.getHost()))
                && page.getPort() == uri.getPort();
    }

    /** Short words for the setup screen. */
    String label() {
        if (relay) return RELAY_HOST + "/p";
        String host = uri.getHost() == null ? "" : uri.getHost();
        return uri.getPort() > 0 ? host + ":" + uri.getPort() : host;
    }

    static boolean privateIp(String host) {
        String[] p = host.split("\\.");
        if (p.length != 4) return false;
        int[] n = new int[4];
        for (int i = 0; i < 4; i++) {
            if (!p[i].matches("\\d{1,3}")) return false;
            n[i] = Integer.parseInt(p[i]);
            if (n[i] > 255) return false;
        }
        return n[0] == 10
                || (n[0] == 192 && n[1] == 168)
                || (n[0] == 172 && n[1] >= 16 && n[1] <= 31)
                || (n[0] == 100 && n[1] >= 64 && n[1] <= 127) // Tailscale / CGNAT
                || n[0] == 127;
    }

    private static String lower(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT);
    }
}
