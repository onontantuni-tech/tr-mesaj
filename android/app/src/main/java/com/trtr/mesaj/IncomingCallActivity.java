package com.trtr.mesaj;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.ContextCompat;

/** Kilit ekranının üstünde açılan gelen arama ekranı. Zil sesi bildirimden gelir. */
public class IncomingCallActivity extends Activity {
    private String id, key, url;
    private final Handler h = new Handler(Looper.getMainLooper());
    private boolean registered;
    private final BroadcastReceiver stopRx = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (id != null && id.equals(i.getStringExtra("id"))) finish();
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        if (!load(getIntent())) { finish(); return; }
        ContextCompat.registerReceiver(this, stopRx, new IntentFilter(Calls.ACTION_STOP), ContextCompat.RECEIVER_NOT_EXPORTED);
        registered = true;
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        if (!load(i)) finish();
    }

    private boolean load(Intent i) {
        id = i.getStringExtra("id");
        key = i.getStringExtra("key");
        url = i.getStringExtra("url");
        if (id == null) return false;
        if (Calls.ACTION_ANSWER.equals(i.getAction())) { answer(); return true; }
        long left = i.getLongExtra("until", 0) - System.currentTimeMillis();
        if (left <= 0) return false;
        h.removeCallbacksAndMessages(null);
        h.postDelayed(this::finish, left);
        setContentView(build(i.getStringExtra("name"), i.getStringExtra("body")));
        return true;
    }

    private int dp(float v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private TextView text(String s, float sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s == null ? "" : s);
        t.setTextColor(Color.WHITE);
        t.setTextSize(sp);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private View button(String label, int color, View.OnClickListener on) {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        TextView dot = text("📞", 30, false);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(color);
        dot.setBackground(bg);
        col.addView(dot, new LinearLayout.LayoutParams(dp(76), dp(76)));
        TextView l = text(label, 15, false);
        l.setPadding(0, dp(10), 0, 0);
        col.addView(l);
        col.setOnClickListener(on);
        col.setPadding(dp(28), dp(12), dp(28), dp(12));
        return col;
    }

    private View build(String name, String body) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackground(new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{0xFFA3121C, 0xFF3A0A0E}));
        root.setPadding(dp(24), dp(96), dp(24), dp(72));
        root.addView(text("TR", 18, true));
        TextView n = text(name, 32, true);
        n.setPadding(0, dp(36), 0, dp(10));
        root.addView(n);
        root.addView(text(body, 17, false));
        View space = new View(this);
        root.addView(space, new LinearLayout.LayoutParams(1, 0, 1f));
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER);
        View dec = button("Reddet", 0xFFE53935, v -> decline());
        View acc = button("Aç", 0xFF22C55E, v -> answer());
        row.addView(dec, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(acc, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        root.addView(row, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        return root;
    }

    private void decline() {
        final String i = id, k = key;
        Calls.stop(getApplicationContext(), i);
        new Thread(() -> Calls.declineBlocking(i, k)).start();
        finish();
    }

    private void answer() {
        final Context app = getApplicationContext();
        final Intent open = Calls.launchIntent(app, Calls.answerUrl(url, id));
        Calls.stop(app, id);
        KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && km != null && km.isKeyguardLocked()) {
            km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override public void onDismissSucceeded() { app.startActivity(open); finish(); }
                @Override public void onDismissCancelled() { finish(); }
                @Override public void onDismissError() { app.startActivity(open); finish(); }
            });
        } else {
            startActivity(open);
            finish();
        }
    }

    @Override
    protected void onDestroy() {
        h.removeCallbacksAndMessages(null);
        if (registered) try { unregisterReceiver(stopRx); } catch (Exception ignored) {}
        super.onDestroy();
    }
}
