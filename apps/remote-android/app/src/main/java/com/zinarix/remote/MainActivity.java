package com.zinarix.remote;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.app.KeyguardManager;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.drawable.Icon;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.CancellationSignal;
import android.os.SystemClock;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.RecognizerIntent;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Zinarix Remote: the phone panel of Zinarix Studio as an app.
 *
 * The panel itself is the page the computer serves (the same one the browser opens); the app
 * keeps the links of the computers, shows the panel full screen and adds what a browser tab
 * cannot do well: system notifications while the app is in the background (kept awake by
 * {@link WorkService} while the AI works), voice dictation, keeping the screen on, sharing
 * text from other apps to the AI, launcher shortcuts and reconnecting by itself.
 */
public class MainActivity extends Activity {
    static final String PREFS = "zinarix";
    private static final String KEY_LINK = "link";
    private static final String CHANNEL = "zinarix";
    private static final String ALERT = "alert";
    static final String ACTION_NEW_CHAT = "com.zinarix.remote.NEW_CHAT";
    static final String ACTION_DICTATE = "com.zinarix.remote.DICTATE";
    static final String ACTION_STOP_AI = "com.zinarix.remote.STOP_AI";
    /** A home-screen shortcut of one saved computer (extra "u": its link). */
    static final String ACTION_OPEN_PC = "com.zinarix.remote.OPEN_PC";
    private static final int REQ_DICTATE = 1;
    private static final int REQ_NOTIFY = 2;
    private static final int REQ_OPTIONS = 3;
    private static final int REQ_UNLOCK = 4;
    /** How long a hook waits for the panel (loading, the permanent link's hop): 40 × 0.5 s. */
    private static final int HOOK_TRIES = 40;
    private static final long RETRY_MS = 20_000;
    /** A computer that does not answer (an old Wi-Fi address) would keep "Connecting…" for minutes. */
    private static final long LOAD_LIMIT_MS = 15_000;

    private static WeakReference<MainActivity> current = new WeakReference<>(null);

    private final Handler ui = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private View setup;
    private View failed;
    private View loading;
    private WebView web;
    private EditText input;
    private TextView error;
    private Link link;
    private boolean resumed;
    private boolean loadFailed;
    private boolean working;
    private int lastWaiting;
    private int notifyId = 1;
    private boolean busyNow;
    private int waitingNow;
    private String folderNow = "";
    // The lock (Options): locked until the phone's fingerprint / PIN says so.
    private View locked;
    private boolean isLocked;
    private boolean unlockedOnce;
    private boolean authing;
    /** One of the app's own screens is in front (dictation, options): leaving it is not leaving the app. */
    private boolean inside;
    private long leftAt = -1;
    private ConnectivityManager.NetworkCallback net;
    private final Runnable retryLater = this::retryQuietly;
    private final Runnable tooSlow = () -> {
        if (web == null || loading.getVisibility() != View.VISIBLE) return;
        web.stopLoading();
        loadFailed = true;
        showFailed();
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        current = new WeakReference<>(this);
        setContentView(R.layout.main);
        root = findViewById(R.id.root);
        setup = findViewById(R.id.setup);
        failed = findViewById(R.id.failed);
        loading = findViewById(R.id.loading);
        input = findViewById(R.id.link);
        error = findViewById(R.id.error);
        locked = findViewById(R.id.locked);
        applyOptions();
        insets();
        channel();
        WorkService.channel(this);

        ((Button) findViewById(R.id.connect)).setOnClickListener(v -> connect(input.getText().toString()));
        ((Button) findViewById(R.id.paste)).setOnClickListener(v -> paste());
        ((Button) findViewById(R.id.retry)).setOnClickListener(v -> open());
        ((Button) findViewById(R.id.change)).setOnClickListener(v -> showSetup());
        ((Button) findViewById(R.id.options)).setOnClickListener(v -> openOptions());
        ((Button) findViewById(R.id.unlock)).setOnClickListener(v -> askUnlock());
        ((Button) findViewById(R.id.loading_change)).setOnClickListener(v -> {
            if (web != null) web.stopLoading();
            showSetup();
        });
        input.setOnEditorActionListener((v, id, e) -> {
            if (id == EditorInfo.IME_ACTION_GO || id == EditorInfo.IME_ACTION_DONE) {
                connect(input.getText().toString());
                return true;
            }
            return false;
        });

        link = Link.parse(prefs().getString(KEY_LINK, null));
        // The computer of the first version of the app joins the list.
        if (link != null && Computers.load(prefs()).isEmpty()) Computers.remember(prefs(), link);
        Intent first = getIntent();
        boolean old = first != null && (first.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0;
        if (old || !fromIntent(first)) {
            if (link != null && !Options.startWithList(prefs())) open();
            else showSetup();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        fromIntent(intent);
    }

    /**
     * A link from the QR (camera → "open with Zinarix"), text shared from another app (a
     * Zinarix link, or something for the AI), or a launcher shortcut.
     */
    private boolean fromIntent(Intent intent) {
        if (intent == null || intent.getAction() == null) return false;
        String action = intent.getAction();
        if (ACTION_NEW_CHAT.equals(action) || ACTION_DICTATE.equals(action) || ACTION_STOP_AI.equals(action)) {
            if (link == null) {
                showSetup();
                return true;
            }
            ensureOpen();
            String fn = ACTION_NEW_CHAT.equals(action) ? "__zxNewChat" : ACTION_DICTATE.equals(action) ? "__zxDictate" : "__zxStop";
            hook(fn, null, HOOK_TRIES);
            return true;
        }
        if (ACTION_OPEN_PC.equals(action)) {
            // Only a computer already in the list (any app could send this).
            Computers.Saved s = Computers.find(prefs(), intent.getStringExtra("u"));
            if (s == null) {
                showSetup();
                error.setText(R.string.pc_gone);
                return true;
            }
            save(s.link);
            open();
            return true;
        }
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            Link l = Link.find(intent.getData().toString());
            if (l == null) {
                showSetup();
                error.setText(R.string.bad_link);
                return true;
            }
            save(l);
            open();
            return true;
        }
        if (Intent.ACTION_SEND.equals(action)) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text == null || text.trim().isEmpty()) return false;
            // With a computer already: only a link that is surely of Zinarix changes it; any
            // other text (an article, a note) goes to the message box for the AI.
            Link l = link == null ? Link.find(text) : Link.findRemote(text);
            if (l != null) {
                save(l);
                open();
                return true;
            }
            if (link == null) {
                showSetup();
                error.setText(R.string.share_first);
                return true;
            }
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            String body = text.trim();
            if (subject != null && !subject.trim().isEmpty() && !body.contains(subject.trim()))
                body = subject.trim() + "\n" + body;
            if (body.length() > 20_000) body = body.substring(0, 20_000);
            ensureOpen();
            hook("__zxCompose", JSONObject.quote(body), HOOK_TRIES);
            return true;
        }
        return false;
    }

    /** The panel on screen, without reloading it when it is already there. */
    private void ensureOpen() {
        if (web == null || web.getVisibility() != View.VISIBLE || failed.getVisibility() == View.VISIBLE) open();
    }

    /**
     * Calls a function of the panel (window.__zx…, see phonePage.ts), again every half second
     * until it answers true: the panel may still be loading or on its way from the website.
     */
    private void hook(String fn, String arg, int tries) {
        if (web == null || tries <= 0) return;
        String js = "(function(){var f=window." + fn + ";return f?!!f(" + (arg == null ? "" : arg) + "):false})()";
        web.evaluateJavascript(js, r -> {
            if (!"true".equals(r)) ui.postDelayed(() -> hook(fn, arg, tries - 1), 500);
        });
    }

    /** "Stop" on the fixed notification (see WorkService). */
    static void stopFromNotification() {
        MainActivity a = current.get();
        if (a != null) a.ui.post(() -> a.hook("__zxStop", null, 1));
    }

    private void connect(String text) {
        Link l = Link.find(text);
        if (l == null) {
            error.setText(R.string.bad_link);
            return;
        }
        save(l);
        open();
    }

    private void paste() {
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData clip = cm == null ? null : cm.getPrimaryClip();
        if (clip == null || clip.getItemCount() == 0) {
            error.setText(R.string.clipboard_empty);
            return;
        }
        CharSequence t = clip.getItemAt(0).coerceToText(this);
        input.setText(t);
        connect(t.toString());
    }

    private void save(Link l) {
        // Another computer: the panel of the old one must not stay behind it.
        if (link != null && !Computers.same(link, l) && web != null) {
            web.clearHistory();
            status(false, 0, "");
        }
        link = l;
        prefs().edit().putString(KEY_LINK, l.uri.toString()).apply();
        Computers.remember(prefs(), l);
    }

    private void showSetup() {
        ui.removeCallbacks(tooSlow);
        setup.setVisibility(View.VISIBLE);
        failed.setVisibility(View.GONE);
        loading.setVisibility(View.GONE);
        if (web != null) web.setVisibility(View.GONE);
        watchNet(false);
        error.setText("");
        input.setText("");
        renderSaved();
        keepAwake(false);
    }

    /** The saved computers: tap to open one, hold to forget it. */
    private void renderSaved() {
        LinearLayout box = findViewById(R.id.saved);
        box.removeAllViews();
        List<Computers.Saved> list = Computers.load(prefs());
        int show = list.isEmpty() ? View.GONE : View.VISIBLE;
        findViewById(R.id.saved_title).setVisibility(show);
        findViewById(R.id.saved_hint).setVisibility(show);
        findViewById(R.id.add_title).setVisibility(show);
        for (Computers.Saved s : list) {
            boolean now = Computers.same(s.link, link);
            Button b = new Button(this, null, 0, R.style.Zx_Button);
            b.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
            b.setPadding(dp(16), dp(10), dp(16), dp(10));
            SpannableStringBuilder t = new SpannableStringBuilder(s.title());
            if (now) {
                int a = t.length();
                t.append("  ·  ").append(getString(R.string.saved_now));
                t.setSpan(new ForegroundColorSpan(getColor(R.color.accent)), a, t.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
            // Without a name the title is already the address: the line below only says the kind.
            boolean named = s.name != null && !s.name.isEmpty();
            String sub = s.link.relay ? getString(R.string.kind_anywhere)
                    : s.link.lan ? (named ? getString(R.string.kind_wifi, s.link.label()) : getString(R.string.kind_wifi_plain))
                    : named ? s.link.label() : getString(R.string.kind_internet);
            int a = t.length();
            t.append("\n").append(sub);
            t.setSpan(new ForegroundColorSpan(getColor(R.color.dim)), a, t.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            t.setSpan(new RelativeSizeSpan(0.82f), a, t.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            b.setText(t);
            b.setContentDescription(s.title() + ", " + sub);
            b.setOnClickListener(v -> {
                save(s.link);
                open();
            });
            b.setOnLongClickListener(v -> {
                menu(s);
                return true;
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
            lp.topMargin = dp(8);
            box.addView(b, lp);
        }
    }

    /** Hold a saved computer: open, rename, a home-screen shortcut, forget. */
    private void menu(Computers.Saved s) {
        String[] items = {getString(R.string.pc_open), getString(R.string.pc_rename), getString(R.string.pc_pin), getString(R.string.forget)};
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(s.title())
                .setItems(items, (d, w) -> {
                    if (w == 0) {
                        save(s.link);
                        open();
                    } else if (w == 1) rename(s);
                    else if (w == 2) pin(s);
                    else forget(s);
                })
                .show();
    }

    private void rename(Computers.Saved s) {
        EditText f = new EditText(this);
        f.setSingleLine(true);
        f.setText(s.custom ? s.name : "");
        f.setHint(s.title());
        f.setTextColor(getColor(R.color.text));
        f.setHintTextColor(getColor(R.color.dim));
        f.setFilters(new android.text.InputFilter[] {new android.text.InputFilter.LengthFilter(60)});
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(22), dp(4), dp(22), 0);
        box.addView(f, new LinearLayout.LayoutParams(-1, -2));
        TextView hint = new TextView(this);
        hint.setText(R.string.pc_rename_hint);
        hint.setTextColor(getColor(R.color.dim));
        hint.setTextSize(13);
        box.addView(hint);
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(R.string.pc_rename)
                .setView(box)
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.save, (d, w) -> {
                    // Empty: the computer's own name comes back on the next visit.
                    Computers.rename(prefs(), s.link, f.getText().toString());
                    renderSaved();
                })
                .show();
    }

    private void pin(Computers.Saved s) {
        ShortcutManager sm = getSystemService(ShortcutManager.class);
        if (sm == null || !sm.isRequestPinShortcutSupported()) {
            Toast.makeText(this, R.string.pc_pin_none, Toast.LENGTH_LONG).show();
            return;
        }
        String title = s.title();
        Intent open = new Intent(ACTION_OPEN_PC).setClass(this, MainActivity.class).putExtra("u", s.link.uri.toString());
        ShortcutInfo info = new ShortcutInfo.Builder(this, shortcutId(s.link))
                .setShortLabel(title.length() > 24 ? title.substring(0, 24) : title)
                .setLongLabel(title)
                .setIcon(Icon.createWithResource(this, R.mipmap.ic_launcher))
                .setIntent(open)
                .build();
        try {
            sm.requestPinShortcut(info, null);
        } catch (RuntimeException e) {
            Toast.makeText(this, R.string.pc_pin_none, Toast.LENGTH_LONG).show();
        }
    }

    private static String shortcutId(Link l) {
        return "pc-" + Integer.toHexString(l.uri.toString().hashCode());
    }

    private void forget(Computers.Saved s) {
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(getString(R.string.forget_title, s.title()))
                .setMessage(R.string.forget_text)
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.forget, (d, w) -> {
                    Computers.forget(prefs(), s.link);
                    dropShortcut(s.link);
                    // The pairing of a Wi-Fi / tunnel / own-domain address lives in its own storage.
                    // (The website's storage is shared by every permanent link: that one stays.)
                    if (!s.link.relay) WebStorage.getInstance().deleteOrigin(origin(s.link.uri));
                    if (Computers.same(s.link, link)) {
                        link = null;
                        prefs().edit().remove(KEY_LINK).apply();
                        status(false, 0, "");
                        if (web != null) {
                            web.loadUrl("about:blank");
                            web.clearHistory();
                        }
                    }
                    renderSaved();
                })
                .show();
    }

    private static String origin(Uri u) {
        String o = u.getScheme() + "://" + u.getHost();
        return u.getPort() > 0 ? o + ":" + u.getPort() : o;
    }

    private void open() {
        if (link == null) {
            showSetup();
            return;
        }
        if (web == null) makeWeb();
        setup.setVisibility(View.GONE);
        failed.setVisibility(View.GONE);
        loading.setVisibility(View.VISIBLE);
        web.setVisibility(View.VISIBLE);
        watchNet(false);
        loadFailed = false;
        ui.removeCallbacks(tooSlow);
        ui.postDelayed(tooSlow, LOAD_LIMIT_MS);
        web.loadUrl(link.uri.toString());
    }

    /** The "could not open" screen stays; the panel replaces it as soon as it loads. */
    private void retryQuietly() {
        if (link == null || web == null || failed.getVisibility() != View.VISIBLE) return;
        loadFailed = false;
        web.loadUrl(link.uri.toString());
    }

    private void showFailed() {
        loading.setVisibility(View.GONE);
        TextView why = findViewById(R.id.failed_text);
        why.setText(link != null && link.lan ? R.string.failed_lan : R.string.failed_remote);
        failed.setVisibility(View.VISIBLE);
        if (web != null) web.setVisibility(View.GONE);
        watchNet(true);
    }

    /** While the panel could not open: try again when the network comes back, and every 20 s. */
    private void watchNet(boolean on) {
        ui.removeCallbacks(retryLater);
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        if (net != null && cm != null) {
            try {
                cm.unregisterNetworkCallback(net);
            } catch (RuntimeException ignored) {
                // Already gone.
            }
        }
        net = null;
        if (!on) return;
        if (resumed) ui.postDelayed(retryLater, RETRY_MS);
        if (cm == null) return;
        net = new ConnectivityManager.NetworkCallback() {
            private boolean first = true;

            @Override
            public void onAvailable(Network n) {
                // The first call only says the network that is there now.
                if (first) {
                    first = false;
                    return;
                }
                ui.postDelayed(MainActivity.this::retryQuietly, 1000);
            }
        };
        try {
            cm.registerDefaultNetworkCallback(net);
        } catch (RuntimeException e) {
            net = null;
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void makeWeb() {
        // Debug builds only: chrome://inspect can see the panel (tests drive it this way).
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)
            WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(0xFF131417);
        root.addView(web, 0, new FrameLayout.LayoutParams(-1, -1));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " ZinarixRemote/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.addJavascriptInterface(new Bridge(), "ZinarixNative");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("zinarix-app".equals(u.getScheme())) {
                    if ("setup".equals(u.getHost())) showSetup();
                    return true;
                }
                if (link != null && link.allows(u)) return false;
                external(u);
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap icon) {
                // A redirect the app did not choose (should never happen): stop it.
                if (link != null && !"about:blank".equals(url) && !link.allows(Uri.parse(url))) {
                    view.stopLoading();
                    external(Uri.parse(url));
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                ui.removeCallbacks(tooSlow);
                loading.setVisibility(View.GONE);
                // A quiet retry that worked: the panel replaces the "could not open" screen.
                if (!loadFailed && failed.getVisibility() == View.VISIBLE && !"about:blank".equals(url)) {
                    failed.setVisibility(View.GONE);
                    view.setVisibility(View.VISIBLE);
                    watchNet(false);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (!req.isForMainFrame()) return;
                loadFailed = true;
                showFailed();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // The page's process died (low memory): start a new view instead of crashing.
                root.removeView(view);
                view.destroy();
                web = null;
                status(false, 0, "");
                open();
                return true;
            }
        });
    }

    private void external(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http") && !scheme.equals("mailto")) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException ignored) {
            // No browser: nothing to do.
        }
    }

    /** What the panel (phonePage.ts) may ask of the phone. Nothing here reads or sends data. */
    private final class Bridge {
        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public void notify(String text) {
            runOnUiThread(() -> post(text));
        }

        @JavascriptInterface
        public boolean canNotify() {
            return Build.VERSION.SDK_INT < 33
                    || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public void askNotify() {
            if (Build.VERSION.SDK_INT >= 33 && !canNotify())
                runOnUiThread(() -> requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY));
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (!Options.vibrate(prefs())) return;
            if (v != null && v.hasVibrator())
                v.vibrate(VibrationEffect.createOneShot(Math.max(10, Math.min(ms, 600)), VibrationEffect.DEFAULT_AMPLITUDE));
        }

        @JavascriptInterface
        public void keepAwake(boolean on) {
            runOnUiThread(() -> MainActivity.this.keepAwake(on));
        }

        @JavascriptInterface
        public boolean canDictate() {
            return new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).resolveActivity(getPackageManager()) != null;
        }

        @JavascriptInterface
        public void dictate(String lang) {
            runOnUiThread(() -> {
                String chosen = Options.lang(prefs());
                String l = !chosen.isEmpty() ? chosen : lang == null || lang.isEmpty() ? Locale.getDefault().toLanguageTag() : lang;
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, l);
                try {
                    inside = true;
                    startActivityForResult(i, REQ_DICTATE);
                } catch (ActivityNotFoundException e) {
                    inside = false;
                    dictated(null);
                }
            });
        }

        /** "Change computer": back to the setup screen of the app. */
        @JavascriptInterface
        public void setup() {
            runOnUiThread(MainActivity.this::showSetup);
        }

        /** "App options" in the panel's settings. */
        @JavascriptInterface
        public void options() {
            runOnUiThread(MainActivity.this::openOptions);
        }

        /** The AI works (or waits for approvals): the fixed notification keeps the app awake. */
        @JavascriptInterface
        public void status(boolean busy, int waiting, String folder) {
            runOnUiThread(() -> MainActivity.this.status(busy, waiting, folder));
        }

        /** The computer's name, for the list of saved computers. */
        @JavascriptInterface
        public void computer(String name) {
            runOnUiThread(() -> {
                if (link != null) Computers.name(prefs(), link, name);
            });
        }
    }

    private void status(boolean busy, int waiting, String folder) {
        // Approved (or denied) on the computer: the "asks for approval" alerts are old news.
        if (lastWaiting > 0 && waiting == 0) cancelAlerts();
        lastWaiting = waiting;
        busyNow = busy;
        waitingNow = waiting;
        folderNow = folder == null ? "" : folder;
        working = busy || waiting > 0;
        // With the lock on, the notification does not say the project's folder.
        if (working && Options.fixed(prefs()))
            WorkService.show(this, busy, Math.max(0, waiting), Options.lock(prefs()) ? "" : folderNow);
        else WorkService.hide(this);
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req == REQ_UNLOCK) {
            authing = false;
            if (result == RESULT_OK) unlock();
            return;
        }
        if (req == REQ_OPTIONS) {
            inside = false;
            if (data != null && data.getBooleanExtra(Options.EXTRA_RESET, false)) reset();
            else afterOptions();
            return;
        }
        if (req != REQ_DICTATE) return;
        inside = false;
        String text = null;
        if (result == RESULT_OK && data != null) {
            ArrayList<String> said = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (said != null && !said.isEmpty()) text = said.get(0);
        }
        dictated(text);
    }

    private void dictated(String text) {
        if (web == null) return;
        String arg = text == null ? "null" : JSONObject.quote(text);
        web.evaluateJavascript("window.__zxDictated && window.__zxDictated(" + arg + ")", null);
    }

    private void post(String text) {
        // In front: the panel already shows it (and vibrates). Paused in Options: nothing.
        if (resumed || Options.muted(prefs())) return;
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        PendingIntent tap = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String body = text == null ? "" : text.length() > 300 ? text.substring(0, 300) : text;
        Notification.Builder n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle("Zinarix Studio")
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(tap)
                .setAutoCancel(true);
        if (Options.lock(prefs())) {
            // Locked app: the lock screen only says there is an alert.
            n.setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(new Notification.Builder(this, CHANNEL)
                    .setSmallIcon(R.drawable.ic_notify)
                    .setContentTitle("Zinarix Studio")
                    .setContentText(getString(R.string.pin_alert))
                    .build());
        }
        nm.notify(ALERT, notifyId++ % 50, n.build());
    }

    private void cancelAlerts() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) for (int i = 0; i < 50; i++) nm.cancel(ALERT, i);
    }

    private void channel() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel c = new NotificationChannel(CHANNEL, getString(R.string.channel), NotificationManager.IMPORTANCE_HIGH);
        c.setDescription(getString(R.string.channel_hint));
        nm.createNotificationChannel(c);
    }

    private void keepAwake(boolean on) {
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    /** Android 15 draws apps under the status bar and the keyboard: keep the panel clear of them. */
    private void insets() {
        if (Build.VERSION.SDK_INT < 35) return;
        root.setOnApplyWindowInsetsListener((v, in) -> {
            int types = WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout();
            android.graphics.Insets i = in.getInsets(types);
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        maybeLock();
        // The alerts are seen now (the fixed "working" notification stays).
        cancelAlerts();
        if (failed.getVisibility() == View.VISIBLE) {
            ui.removeCallbacks(retryLater);
            retryQuietly();
        }
    }

    @Override
    protected void onPause() {
        // The page keeps running (it is what notices approvals and finished answers).
        resumed = false;
        ui.removeCallbacks(retryLater);
        super.onPause();
    }

    @Override
    protected void onStop() {
        // Leaving the app (not one of its own screens, not the unlock prompt): the lock counts from here.
        if (!inside && !authing && !isChangingConfigurations()) leftAt = SystemClock.elapsedRealtime();
        super.onStop();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (isLocked) {
            moveTaskToBack(true);
            return;
        }
        if (web != null && web.getVisibility() == View.VISIBLE) {
            // The panel closes its sheet or menu first (see __zxBack in phonePage.ts).
            web.evaluateJavascript("window.__zxBack ? window.__zxBack() : false", r -> {
                if ("true".equals(r)) return;
                if (web != null && web.canGoBack()) web.goBack();
                else moveTaskToBack(true);
            });
            return;
        }
        if (setup.getVisibility() == View.VISIBLE && link != null && web != null) {
            open();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        watchNet(false);
        ui.removeCallbacksAndMessages(null);
        // Without the panel there is nothing to keep awake for.
        if (working) WorkService.hide(this);
        if (web != null) {
            web.destroy();
            web = null;
        }
        if (current.get() == this) current = new WeakReference<>(null);
        super.onDestroy();
    }

    // ---- Options ----

    private void openOptions() {
        inside = true;
        startActivityForResult(new Intent(this, Options.class), REQ_OPTIONS);
    }

    /** Hide from Recents / screenshots, the orientation; no Recents thumbnail while the lock is on. */
    private void applyOptions() {
        SharedPreferences p = prefs();
        if (Options.secure(p)) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        setRequestedOrientation(Options.orientation(p));
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(!Options.lock(p) && !Options.secure(p));
    }

    private void afterOptions() {
        applyOptions();
        // Turned on just now: this visit is already unlocked.
        if (Options.lock(prefs())) unlockedOnce = true;
        // The fixed notification may have been turned on or off.
        status(busyNow, waitingNow, folderNow);
    }

    /** "Erase everything" in Options. */
    private void reset() {
        for (Computers.Saved s : Computers.load(prefs())) dropShortcut(s.link);
        prefs().edit().clear().apply();
        WebStorage.getInstance().deleteAllData();
        CookieManager.getInstance().removeAllCookies(null);
        status(false, 0, "");
        cancelAlerts();
        link = null;
        if (web != null) {
            web.clearCache(true);
            web.loadUrl("about:blank");
            web.clearHistory();
        }
        applyOptions();
        showSetup();
    }

    private void dropShortcut(Link l) {
        ShortcutManager sm = getSystemService(ShortcutManager.class);
        if (sm == null) return;
        try {
            List<String> ids = new ArrayList<>();
            ids.add(shortcutId(l));
            sm.disableShortcuts(ids, getString(R.string.pc_gone));
        } catch (RuntimeException ignored) {
            // Never pinned.
        }
    }

    // ---- Lock ----

    private void maybeLock() {
        if (!Options.lock(prefs())) {
            if (isLocked) unlock();
            return;
        }
        if (authing) return;
        if (isLocked) {
            // Back to a locked app: ask again right away.
            leftAt = -1;
            askUnlock();
            return;
        }
        // Never left since the last check (a dialog, the notification shade): no lock.
        boolean left = leftAt >= 0;
        long away = left ? SystemClock.elapsedRealtime() - leftAt : 0;
        leftAt = -1;
        if (!unlockedOnce || (left && away >= Options.lockAfter(prefs()) * 1000L)) {
            isLocked = true;
            showLock(true);
            askUnlock();
        }
    }

    private void askUnlock() {
        if (authing) return;
        KeyguardManager km = getSystemService(KeyguardManager.class);
        // No screen lock on the phone any more: nothing to ask for (the app must not stay shut).
        if (km == null || !km.isDeviceSecure()) {
            unlock();
            return;
        }
        authing = true;
        if (Build.VERSION.SDK_INT >= 30) {
            BiometricPrompt bp = new BiometricPrompt.Builder(this)
                    .setTitle(getString(R.string.unlock))
                    .setSubtitle(getString(R.string.unlock_reason))
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK
                            | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                    .build();
            bp.authenticate(new CancellationSignal(), getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) {
                    authing = false;
                    unlock();
                }

                @Override
                public void onAuthenticationError(int code, CharSequence msg) {
                    // Cancelled or failed: the lock screen stays, with its Unlock button.
                    authing = false;
                }
            });
            return;
        }
        @SuppressWarnings("deprecation")
        Intent i = km.createConfirmDeviceCredentialIntent(getString(R.string.unlock), getString(R.string.unlock_reason));
        if (i == null) {
            authing = false;
            unlock();
            return;
        }
        try {
            startActivityForResult(i, REQ_UNLOCK);
        } catch (ActivityNotFoundException e) {
            authing = false;
            unlock();
        }
    }

    /** The lock covers everything, also for screen readers (they would read the panel behind it). */
    private void showLock(boolean on) {
        locked.setVisibility(on ? View.VISIBLE : View.GONE);
        for (int i = 0; i < root.getChildCount(); i++) {
            View v = root.getChildAt(i);
            if (v != locked) v.setImportantForAccessibility(on ? View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS : View.IMPORTANT_FOR_ACCESSIBILITY_AUTO);
        }
    }

    private void unlock() {
        isLocked = false;
        unlockedOnce = true;
        leftAt = -1;
        showLock(false);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }
}
