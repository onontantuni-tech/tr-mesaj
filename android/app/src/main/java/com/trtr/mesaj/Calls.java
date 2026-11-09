package com.trtr.mesaj;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Gelen arama bildirimi: zil, tam ekran arama ekranı, Aç / Reddet. */
final class Calls {
    static final String SITE = "https://tr-mesaj.vercel.app";
    static final String PREFS = "tr";
    static final String ACTION_STOP = "com.trtr.mesaj.CALL_STOP";
    static final String ACTION_ANSWER = "com.trtr.mesaj.ANSWER";
    static final String ACTION_DECLINE = "com.trtr.mesaj.DECLINE";
    static final long RING_MS = 45000;
    private static final String CH_CALL = "calls_v1";
    private static final String CH_MISSED = "missed_v1";
    private static final int NID_CALL = 4101;
    private static final int NID_MISSED = 4102;

    private Calls() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH_CALL) == null) {
            NotificationChannel ch = new NotificationChannel(CH_CALL, "Gelen aramalar", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Sesli ve görüntülü arama geldiğinde çalar");
            ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                    new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0, 800, 500, 800, 500, 800, 500});
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_MISSED) == null) {
            NotificationChannel ch = new NotificationChannel(CH_MISSED, "Cevapsız aramalar", NotificationManager.IMPORTANCE_DEFAULT);
            nm.createNotificationChannel(ch);
        }
    }

    private static boolean wasStopped(Context c, String id) {
        return prefs(c).getString("stopped", "").contains("|" + id + "|");
    }

    private static void markStopped(Context c, String id) {
        String s = prefs(c).getString("stopped", "");
        if (s.contains("|" + id + "|")) return;
        s = s + "|" + id + "|";
        if (s.length() > 1200) s = s.substring(s.length() - 800);
        prefs(c).edit().putString("stopped", s).apply();
    }

    private static long parse(String s, long def) {
        try { return Long.parseLong(s); } catch (Exception e) { return def; }
    }

    static String absUrl(String url) {
        if (url == null || url.isEmpty()) return SITE + "/";
        if (url.startsWith("/")) return SITE + url;
        return url.startsWith(SITE) ? url : SITE + "/";
    }

    /** Aramayı açacak adres: web uygulaması ?call= ile aramayı bulur, acc=1 ile kendiliğinden cevaplar. */
    static String answerUrl(String url, String id) {
        String u = absUrl(url);
        if (id != null && !id.startsWith("test") && u.contains("call=")) u += "&acc=1";
        return u;
    }

    static Intent launchIntent(Context c, String url) {
        return new Intent(c, TrLauncherActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse(url))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    private static Intent callIntent(Context c, Class<?> cls, String action, String id, String name, String body, String url, String key, long until) {
        return new Intent(c, cls).setAction(action).setData(Uri.parse("trcall://" + id))
                .putExtra("id", id).putExtra("name", name).putExtra("body", body)
                .putExtra("url", url).putExtra("key", key).putExtra("until", until);
    }

    static void ring(Context c, Map<String, String> d) {
        String id = d.get("call");
        if (id == null || id.isEmpty() || wasStopped(c, id)) return;
        long now = System.currentTimeMillis();
        long at = parse(d.get("at"), now);
        long left = RING_MS - (now - at);
        if (left > RING_MS) left = RING_MS;
        if (left < 3000) return; // çok geç ulaştı: cevapsız arama bildirimi ayrıca gelir
        String name = d.get("title") == null ? "TR" : d.get("title");
        String body = d.get("body") == null ? "Arama geliyor" : d.get("body");
        String url = d.get("url"), key = d.get("key") == null ? "" : d.get("key");
        long until = now + left;
        channels(c);
        int fl = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent full = PendingIntent.getActivity(c, 1,
                callIntent(c, IncomingCallActivity.class, Intent.ACTION_MAIN, id, name, body, url, key, until)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION), fl);
        PendingIntent answer = PendingIntent.getActivity(c, 2,
                callIntent(c, IncomingCallActivity.class, ACTION_ANSWER, id, name, body, url, key, until)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), fl);
        PendingIntent decline = PendingIntent.getBroadcast(c, 3,
                callIntent(c, CallActionReceiver.class, ACTION_DECLINE, id, name, body, url, key, until), fl);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_CALL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(name).setContentText(body)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true).setAutoCancel(false).setOnlyAlertOnce(false)
                .setColor(0xFFD81E2A).setWhen(at).setShowWhen(true)
                .setTimeoutAfter(left)
                .setFullScreenIntent(full, true).setContentIntent(full)
                .addAction(0, "Reddet", decline)
                .addAction(0, "Aç", answer);
        if (Build.VERSION.SDK_INT < 26) {
            b.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), android.media.AudioManager.STREAM_RING)
                    .setVibrate(new long[]{0, 800, 500, 800, 500, 800, 500});
        }
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // cevaplanana ya da süre dolana kadar çalsın
        try {
            c.getSystemService(NotificationManager.class).notify(id, NID_CALL, n);
        } catch (Exception ignored) {}
    }

    /** Zili sustur, bildirimi ve arama ekranını kapat. */
    static void stop(Context c, String id) {
        if (id == null || id.isEmpty()) return;
        markStopped(c, id);
        try { c.getSystemService(NotificationManager.class).cancel(id, NID_CALL); } catch (Exception ignored) {}
        c.sendBroadcast(new Intent(ACTION_STOP).setPackage(c.getPackageName()).putExtra("id", id));
    }

    static void missed(Context c, Map<String, String> d) {
        String id = d.get("call");
        if (id == null) return;
        channels(c);
        PendingIntent open = PendingIntent.getActivity(c, id.hashCode(), launchIntent(c, absUrl(d.get("url"))),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(c, CH_MISSED)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(d.get("title") == null ? "TR" : d.get("title"))
                .setContentText(d.get("body") == null ? "Cevapsız arama" : d.get("body"))
                .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
                .setColor(0xFFD81E2A).setAutoCancel(true).setContentIntent(open).build();
        try { c.getSystemService(NotificationManager.class).notify(id, NID_MISSED, n); } catch (Exception ignored) {}
    }

    /** Sunucuya "reddedildi" bildir (aramaya özel anahtarla; giriş jetonu gerekmez). Arka plan iş parçacığında çağır. */
    static void declineBlocking(String id, String key) {
        if (id == null || key == null || key.isEmpty()) return;
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(SITE + "/api/notify").openConnection();
            con.setRequestMethod("POST");
            con.setConnectTimeout(8000);
            con.setReadTimeout(8000);
            con.setDoOutput(true);
            con.setRequestProperty("content-type", "application/json");
            byte[] body = ("{\"decline\":\"" + id.replaceAll("[^A-Za-z0-9]", "") + "\",\"key\":\"" + key.replaceAll("[^a-f0-9]", "") + "\"}")
                    .getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = con.getOutputStream()) { os.write(body); }
            con.getResponseCode();
        } catch (Exception ignored) {
        } finally {
            if (con != null) con.disconnect();
        }
    }
}
