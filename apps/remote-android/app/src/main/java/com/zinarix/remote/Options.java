package com.zinarix.remote;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.format.DateFormat;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import java.util.Calendar;
import java.util.Date;
import java.util.function.Consumer;

/**
 * The app's own options (what the panel cannot do): the lock, hiding it from Recents, pausing
 * and shaping the alerts, how it opens, its orientation, the dictation language, erasing it.
 * The panel's own settings (text size, Enter sends, the device name…) stay in the panel.
 */
public class Options extends Activity {
    static final String EXTRA_RESET = "reset";

    // Keys, in the same preferences as the computers (MainActivity.PREFS).
    static final String LOCK = "opt_lock";
    static final String LOCK_AFTER = "opt_lock_after";
    static final String SECURE = "opt_secure";
    static final String MUTE_UNTIL = "opt_mute_until";
    static final String VIBRATE = "opt_vibrate";
    static final String FIXED = "opt_fixed";
    static final String START = "opt_start";
    static final String ORIENT = "opt_orient";
    static final String LANG = "opt_lang";

    private static final int[] AFTER = {0, 60, 300, 1800};
    private static final int[] AFTER_NAMES = {R.string.after_0, R.string.after_60, R.string.after_300, R.string.after_1800};
    private static final String[] ORIENTS = {"auto", "portrait", "landscape"};
    private static final int[] ORIENT_NAMES = {R.string.orient_auto, R.string.orient_portrait, R.string.orient_landscape};
    private static final String[] LANGS = {"", "es-MX", "es-ES", "en-US", "pt-BR", "fr-FR", "de-DE", "it-IT"};
    private static final String[] LANG_NAMES = {null, "Español (México)", "Español (España)", "English (US)",
            "Português (Brasil)", "Français", "Deutsch", "Italiano"};

    // ---- What the rest of the app reads ----

    static boolean lock(SharedPreferences p) {
        return p.getBoolean(LOCK, false);
    }

    static int lockAfter(SharedPreferences p) {
        return p.getInt(LOCK_AFTER, 0);
    }

    static boolean secure(SharedPreferences p) {
        return p.getBoolean(SECURE, false);
    }

    static boolean muted(SharedPreferences p) {
        return System.currentTimeMillis() < p.getLong(MUTE_UNTIL, 0);
    }

    static boolean vibrate(SharedPreferences p) {
        return p.getBoolean(VIBRATE, true);
    }

    static boolean fixed(SharedPreferences p) {
        return p.getBoolean(FIXED, true);
    }

    static boolean startWithList(SharedPreferences p) {
        return "list".equals(p.getString(START, "last"));
    }

    static String lang(SharedPreferences p) {
        return p.getString(LANG, "");
    }

    static int orientation(SharedPreferences p) {
        switch (p.getString(ORIENT, "auto")) {
            case "portrait":
                return ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT;
            case "landscape":
                return ActivityInfo.SCREEN_ORIENTATION_USER_LANDSCAPE;
            default:
                return ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        }
    }

    // ---- The screen ----

    private SharedPreferences prefs;
    private LinearLayout list;
    private TextView muteSub;
    private TextView batterySub;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE);
        if (secure(prefs)) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
        setRequestedOrientation(orientation(prefs));

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(getColor(R.color.bg));
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(20), dp(16), dp(20), dp(28));
        scroll.addView(list);
        setContentView(scroll);
        if (Build.VERSION.SDK_INT >= 35) {
            scroll.setOnApplyWindowInsetsListener((v, in) -> {
                android.graphics.Insets i = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        setResult(RESULT_OK);
        build();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Back from Android's battery settings.
        if (batterySub != null) batterySub.setText(battery() ? R.string.opt_battery_on : R.string.opt_battery_off);
    }

    private void build() {
        TextView title = text(getString(R.string.opt_title), 22, R.color.text);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        list.addView(title);

        section(R.string.opt_privacy);
        TextView[] afterSub = new TextView[1];
        View[] afterRow = new View[1];
        toggle(R.string.opt_lock, R.string.opt_lock_hint, lock(prefs), (on, sw) -> {
            KeyguardManager km = getSystemService(KeyguardManager.class);
            if (on && (km == null || !km.isDeviceSecure())) {
                sw.setChecked(false);
                info(R.string.opt_lock_none);
                return;
            }
            prefs.edit().putBoolean(LOCK, on).apply();
            afterRow[0].setVisibility(on ? View.VISIBLE : View.GONE);
        });
        afterSub[0] = choice(R.string.opt_lock_after, getString(AFTER_NAMES[indexOf(AFTER, lockAfter(prefs))]), () ->
                pick(R.string.opt_lock_after, names(AFTER_NAMES), indexOf(AFTER, lockAfter(prefs)), i -> {
                    prefs.edit().putInt(LOCK_AFTER, AFTER[i]).apply();
                    afterSub[0].setText(AFTER_NAMES[i]);
                }));
        afterRow[0] = (View) afterSub[0].getParent().getParent();
        afterRow[0].setVisibility(lock(prefs) ? View.VISIBLE : View.GONE);
        toggle(R.string.opt_secure, R.string.opt_secure_hint, secure(prefs), (on, sw) -> {
            prefs.edit().putBoolean(SECURE, on).apply();
            if (on) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
            else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
        });

        section(R.string.opt_alerts);
        muteSub = choice(R.string.opt_mute, muteText(), this::pickMute);
        toggle(R.string.opt_vibrate, R.string.opt_vibrate_hint, vibrate(prefs), (on, sw) -> prefs.edit().putBoolean(VIBRATE, on).apply());
        toggle(R.string.opt_fixed, R.string.opt_fixed_hint, fixed(prefs), (on, sw) -> prefs.edit().putBoolean(FIXED, on).apply());
        choice(R.string.opt_sound, getString(R.string.opt_sound_hint), () -> settings(
                new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())));
        batterySub = choice(R.string.opt_battery, getString(battery() ? R.string.opt_battery_on : R.string.opt_battery_off),
                () -> settings(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)));

        section(R.string.opt_app);
        String[] starts = {"last", "list"};
        int[] startNames = {R.string.start_last, R.string.start_list};
        TextView[] startSub = new TextView[1];
        int st = startWithList(prefs) ? 1 : 0;
        startSub[0] = choice(R.string.opt_start, getString(startNames[st]), () ->
                pick(R.string.opt_start, names(startNames), startWithList(prefs) ? 1 : 0, i -> {
                    prefs.edit().putString(START, starts[i]).apply();
                    startSub[0].setText(startNames[i]);
                }));
        TextView[] orientSub = new TextView[1];
        orientSub[0] = choice(R.string.opt_orient, getString(ORIENT_NAMES[orientIndex()]), () ->
                pick(R.string.opt_orient, names(ORIENT_NAMES), orientIndex(), i -> {
                    prefs.edit().putString(ORIENT, ORIENTS[i]).apply();
                    orientSub[0].setText(ORIENT_NAMES[i]);
                    setRequestedOrientation(orientation(prefs));
                }));
        String[] langNames = LANG_NAMES.clone();
        langNames[0] = getString(R.string.lang_auto);
        TextView[] langSub = new TextView[1];
        langSub[0] = choice(R.string.opt_lang, langNames[langIndex()], () ->
                pick(R.string.opt_lang, langNames, langIndex(), i -> {
                    prefs.edit().putString(LANG, LANGS[i]).apply();
                    langSub[0].setText(langNames[i]);
                }));

        Button reset = new Button(this, null, 0, R.style.Zx_Button);
        reset.setText(R.string.opt_reset);
        reset.setTextColor(getColor(R.color.danger));
        reset.setOnClickListener(v -> confirmReset());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(28);
        list.addView(reset, lp);
        TextView rh = text(getString(R.string.opt_reset_hint), 13, R.color.dim);
        rh.setPadding(0, dp(6), 0, 0);
        list.addView(rh);

        TextView ver = text(getString(R.string.opt_version, BuildConfig.VERSION_NAME), 13, R.color.dim);
        ver.setGravity(Gravity.CENTER);
        ver.setPadding(0, dp(24), 0, 0);
        list.addView(ver);
    }

    // ---- Alerts paused ----

    private String muteText() {
        long until = prefs.getLong(MUTE_UNTIL, 0);
        if (System.currentTimeMillis() >= until) return getString(R.string.mute_off);
        if (until == Long.MAX_VALUE) return getString(R.string.mute_paused);
        Date d = new Date(until);
        boolean today = android.text.format.DateUtils.isToday(until);
        String when = DateFormat.getTimeFormat(this).format(d);
        if (!today) when = DateFormat.getMediumDateFormat(this).format(d) + " " + when;
        return getString(R.string.mute_until, when);
    }

    private void pickMute() {
        boolean on = muted(prefs);
        int[] names = on
                ? new int[] {R.string.mute_resume, R.string.mute_1h, R.string.mute_8h, R.string.mute_morning, R.string.mute_forever}
                : new int[] {R.string.mute_1h, R.string.mute_8h, R.string.mute_morning, R.string.mute_forever};
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(R.string.opt_mute)
                .setItems(names(names), (d, w) -> {
                    int what = names[w];
                    long until;
                    if (what == R.string.mute_resume) until = 0;
                    else if (what == R.string.mute_1h) until = System.currentTimeMillis() + 3_600_000L;
                    else if (what == R.string.mute_8h) until = System.currentTimeMillis() + 8 * 3_600_000L;
                    else if (what == R.string.mute_morning) {
                        Calendar c = Calendar.getInstance();
                        c.add(Calendar.DAY_OF_YEAR, 1);
                        c.set(Calendar.HOUR_OF_DAY, 8);
                        c.set(Calendar.MINUTE, 0);
                        c.set(Calendar.SECOND, 0);
                        c.set(Calendar.MILLISECOND, 0);
                        until = c.getTimeInMillis();
                    } else until = Long.MAX_VALUE;
                    prefs.edit().putLong(MUTE_UNTIL, until).apply();
                    muteSub.setText(muteText());
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    // ---- Battery ----

    private boolean battery() {
        PowerManager pm = getSystemService(PowerManager.class);
        return pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
    }

    private void settings(Intent i) {
        try {
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            try {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
            } catch (ActivityNotFoundException ignored) {
                // No settings app: nothing to do.
            }
        }
    }

    // ---- Erase everything ----

    private void confirmReset() {
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(R.string.reset_title)
                .setMessage(R.string.reset_text)
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.reset, (d, w) -> {
                    // MainActivity erases (it owns the panel and its storage).
                    setResult(RESULT_OK, new Intent().putExtra(EXTRA_RESET, true));
                    finish();
                })
                .show();
    }

    // ---- Rows ----

    private interface Toggled {
        void on(boolean on, Switch sw);
    }

    private void section(int title) {
        TextView t = text(getString(title), 13, R.color.accent);
        t.setTypeface(null, android.graphics.Typeface.BOLD);
        t.setAllCaps(true);
        t.setLetterSpacing(0.06f);
        t.setPadding(0, dp(24), 0, dp(4));
        list.addView(t);
    }

    private void toggle(int title, int hint, boolean on, Toggled change) {
        LinearLayout row = row();
        LinearLayout col = column(getString(title), getString(hint));
        row.addView(col, new LinearLayout.LayoutParams(0, -2, 1));
        Switch sw = new Switch(this);
        sw.setChecked(on);
        sw.setContentDescription(getString(title));
        sw.setOnCheckedChangeListener((b, v) -> change.on(v, sw));
        row.addView(sw);
        row.setOnClickListener(v -> sw.toggle());
        list.addView(row);
    }

    /** A row that opens a choice; returns its second line (the current value). */
    private TextView choice(int title, String value, Runnable tap) {
        LinearLayout row = row();
        LinearLayout col = column(getString(title), value);
        row.addView(col, new LinearLayout.LayoutParams(0, -2, 1));
        row.setOnClickListener(v -> tap.run());
        list.addView(row);
        return (TextView) col.getChildAt(1);
    }

    private void pick(int title, String[] items, int current, Consumer<Integer> chosen) {
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(title)
                .setSingleChoiceItems(items, current, (d, w) -> {
                    chosen.accept(w);
                    d.dismiss();
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void info(int text) {
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setMessage(text)
                .setPositiveButton(android.R.string.ok, null)
                .show();
    }

    private LinearLayout row() {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setMinimumHeight(dp(56));
        r.setPadding(0, dp(10), 0, dp(10));
        r.setBackgroundResource(android.R.drawable.list_selector_background);
        r.setClickable(true);
        r.setFocusable(true);
        return r;
    }

    private LinearLayout column(String title, String sub) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(0, 0, dp(12), 0);
        c.addView(text(title, 16, R.color.text));
        TextView s = text(sub, 13, R.color.dim);
        s.setPadding(0, dp(2), 0, 0);
        c.addView(s);
        return c;
    }

    private TextView text(String t, int sp, int color) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextSize(sp);
        v.setTextColor(getColor(color));
        v.setLineSpacing(0, 1.1f);
        return v;
    }

    private String[] names(int[] ids) {
        String[] out = new String[ids.length];
        for (int i = 0; i < ids.length; i++) out[i] = getString(ids[i]);
        return out;
    }

    private int orientIndex() {
        String o = prefs.getString(ORIENT, "auto");
        for (int i = 0; i < ORIENTS.length; i++) if (ORIENTS[i].equals(o)) return i;
        return 0;
    }

    private int langIndex() {
        String l = lang(prefs);
        for (int i = 0; i < LANGS.length; i++) if (LANGS[i].equals(l)) return i;
        return 0;
    }

    private static int indexOf(int[] a, int v) {
        for (int i = 0; i < a.length; i++) if (a[i] == v) return i;
        return 0;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
