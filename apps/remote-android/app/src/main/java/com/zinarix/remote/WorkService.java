package com.zinarix.remote;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * A fixed notification while the AI of the computer works or waits for an approval.
 *
 * Without it Android freezes the app a few seconds after it leaves the screen, and the panel
 * stops noticing approvals and finished answers. With it the panel keeps running (only while
 * there is something to wait for) and the notification has a Stop button.
 */
public class WorkService extends Service {
    static final String ACTION_STOP = "com.zinarix.remote.STOP";
    private static final String CHANNEL = "work";
    private static final int ID = 1000;
    private static WorkService running;

    private boolean busy;
    private int waiting;
    private String folder = "";

    /** Show or update the notification (false: Android did not let it start from the background). */
    static boolean show(Context c, boolean busy, int waiting, String folder) {
        if (running != null) {
            running.update(busy, waiting, folder);
            return true;
        }
        Intent i = new Intent(c, WorkService.class)
                .putExtra("busy", busy)
                .putExtra("waiting", waiting)
                .putExtra("folder", folder);
        try {
            c.startForegroundService(i);
            return true;
        } catch (RuntimeException e) {
            // ForegroundServiceStartNotAllowedException (app in the background): nothing to do.
            return false;
        }
    }

    static void hide(Context c) {
        if (running != null) c.stopService(new Intent(c, WorkService.class));
    }

    static void channel(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, c.getString(R.string.work_channel), NotificationManager.IMPORTANCE_LOW);
        ch.setDescription(c.getString(R.string.work_channel_hint));
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            MainActivity.stopFromNotification();
            if (running == null) stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null) {
            busy = intent.getBooleanExtra("busy", true);
            waiting = intent.getIntExtra("waiting", 0);
            String f = intent.getStringExtra("folder");
            folder = f == null ? "" : f;
        }
        channel(this);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(ID, build());
            running = this;
        } catch (RuntimeException e) {
            stopSelf();
        }
        // If Android ends the app, the panel is gone too: nothing to come back for.
        return START_NOT_STICKY;
    }

    private void update(boolean busy, int waiting, String folder) {
        this.busy = busy;
        this.waiting = waiting;
        this.folder = folder == null ? "" : folder;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(ID, build());
    }

    private Notification build() {
        PendingIntent tap = PendingIntent.getActivity(this, 1,
                new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String text = waiting > 0
                ? getResources().getQuantityString(R.plurals.work_waiting, waiting, waiting)
                : getString(R.string.work_busy);
        Notification.Builder b = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(text)
                .setContentIntent(tap)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_PROGRESS);
        if (!folder.isEmpty()) b.setContentText(folder);
        if (busy && waiting == 0) b.setProgress(0, 0, true);
        if (busy) {
            PendingIntent stop = PendingIntent.getService(this, 2,
                    new Intent(this, WorkService.class).setAction(ACTION_STOP),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            b.addAction(new Notification.Action.Builder((android.graphics.drawable.Icon) null,getString(R.string.stop), stop).build());
        }
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    /** Android 15: a data-sync service may run 6 hours a day at most. */
    @Override
    public void onTimeout(int startId, int fgsType) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (running == this) running = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
