package com.trtr.mesaj;

import android.Manifest;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * Web uygulamasını (TWA) açar. Açarken bu telefonun bildirim jetonunu adrese ekler (?ntok=);
 * web tarafı jetonu kullanıcının hesabına kaydeder, sunucu aramaları doğrudan bu uygulamaya yollar.
 */
public class TrLauncherActivity extends LauncherActivity {
    private boolean launched;
    private final Handler h = new Handler(Looper.getMainLooper());

    private SharedPreferences prefs() { return Calls.prefs(this); }

    private boolean needNotifPermission() {
        return Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && !prefs().getBoolean("askedNotif", false);
    }

    @Override
    protected boolean shouldLaunchImmediately() {
        return prefs().getString("ntok", null) != null && !needNotifPermission();
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (isFinishing()) return;
        if (shouldLaunchImmediately()) { refreshToken(); return; }
        if (needNotifPermission()) {
            prefs().edit().putBoolean("askedNotif", true).apply();
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7);
        } else {
            waitToken();
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] p, int[] r) {
        super.onRequestPermissionsResult(code, p, r);
        if (code == 7) waitToken();
    }

    private void refreshToken() {
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(t -> {
                if (t.isSuccessful() && t.getResult() != null) prefs().edit().putString("ntok", t.getResult()).remove("nerr").apply();
            });
        } catch (Exception ignored) {}
    }

    private void waitToken() {
        if (prefs().getString("ntok", null) != null) { go(); return; }
        h.postDelayed(this::go, 5000);
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(t -> {
                if (t.isSuccessful() && t.getResult() != null) prefs().edit().putString("ntok", t.getResult()).remove("nerr").apply();
                else prefs().edit().putString("nerr", String.valueOf(t.getException())).apply();
                go();
            });
        } catch (Exception e) {
            prefs().edit().putString("nerr", String.valueOf(e)).apply();
            go();
        }
    }

    private void go() {
        if (launched || isFinishing()) return;
        launched = true;
        h.removeCallbacksAndMessages(null);
        launchTwa();
    }

    @Override
    protected Uri getLaunchingUrl() {
        Uri u = super.getLaunchingUrl();
        if (u == null || !"tr-mesaj.vercel.app".equals(u.getHost())) return u;
        String tok = prefs().getString("ntok", null), err = prefs().getString("nerr", null);
        if (tok != null) return u.buildUpon().appendQueryParameter("ntok", tok).build();
        if (err != null) return u.buildUpon().appendQueryParameter("nerr", err.length() > 180 ? err.substring(0, 180) : err).build();
        return u;
    }
}
