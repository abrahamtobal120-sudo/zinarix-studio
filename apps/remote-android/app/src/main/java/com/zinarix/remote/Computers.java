package com.zinarix.remote;

import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The computers this phone has opened, newest first (their links and the names the computers
 * gave), so changing from one to another is one tap. Each one keeps its own pairing: the
 * panel of every address has its own storage (and the website one slot per permanent link).
 */
final class Computers {
    private static final String KEY = "computers";
    private static final int MAX = 10;

    static final class Saved {
        final Link link;
        final String name;
        /** The user named it on the phone: the computer's own name does not replace it. */
        final boolean custom;

        Saved(Link link, String name, boolean custom) {
            this.link = link;
            this.name = name;
            this.custom = custom;
        }

        String title() {
            return name == null || name.isEmpty() ? link.label() : name;
        }
    }

    private Computers() {}

    static List<Saved> load(SharedPreferences p) {
        List<Saved> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(p.getString(KEY, "[]"));
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                Link l = o == null ? null : Link.parse(o.optString("u", null));
                if (l != null) out.add(new Saved(l, o.optString("n", ""), o.optBoolean("c", false)));
            }
        } catch (JSONException ignored) {
            // A broken list starts again empty.
        }
        return out;
    }

    /** The link just opened goes first (it keeps its name). */
    static void remember(SharedPreferences p, Link l) {
        List<Saved> list = load(p);
        String name = "";
        boolean custom = false;
        for (int i = list.size() - 1; i >= 0; i--) {
            if (same(list.get(i).link, l)) {
                name = list.get(i).name;
                custom = list.get(i).custom;
                list.remove(i);
            }
        }
        list.add(0, new Saved(l, name, custom));
        write(p, list);
    }

    /** The name the computer told the panel (its host name). */
    static void name(SharedPreferences p, Link l, String name) {
        if (l == null || name == null) return;
        String n = name.trim();
        if (n.length() > 60) n = n.substring(0, 60);
        List<Saved> list = load(p);
        boolean changed = false;
        for (int i = 0; i < list.size(); i++) {
            Saved s = list.get(i);
            if (same(s.link, l) && !s.custom && !n.equals(s.name)) {
                list.set(i, new Saved(s.link, n, false));
                changed = true;
            }
        }
        if (changed) write(p, list);
    }

    /** A name chosen on the phone; empty goes back to the computer's own (sent on the next visit). */
    static void rename(SharedPreferences p, Link l, String name) {
        String n = name == null ? "" : name.trim();
        if (n.length() > 60) n = n.substring(0, 60);
        List<Saved> list = load(p);
        for (int i = 0; i < list.size(); i++)
            if (same(list.get(i).link, l)) list.set(i, new Saved(list.get(i).link, n, !n.isEmpty()));
        write(p, list);
    }

    static Saved find(SharedPreferences p, String uri) {
        if (uri == null) return null;
        for (Saved s : load(p)) if (s.link.uri.toString().equals(uri)) return s;
        return null;
    }

    static void forget(SharedPreferences p, Link l) {
        List<Saved> list = load(p);
        for (int i = list.size() - 1; i >= 0; i--) if (same(list.get(i).link, l)) list.remove(i);
        write(p, list);
    }

    static boolean same(Link a, Link b) {
        return a != null && b != null && a.uri.toString().equals(b.uri.toString());
    }

    private static void write(SharedPreferences p, List<Saved> list) {
        JSONArray a = new JSONArray();
        for (int i = 0; i < list.size() && i < MAX; i++) {
            JSONObject o = new JSONObject();
            try {
                o.put("u", list.get(i).link.uri.toString());
                o.put("n", list.get(i).name == null ? "" : list.get(i).name);
                if (list.get(i).custom) o.put("c", true);
            } catch (JSONException ignored) {
                continue;
            }
            a.put(o);
        }
        p.edit().putString(KEY, a.toString()).apply();
    }
}
