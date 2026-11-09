package com.trtr.mesaj;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Bildirimdeki "Reddet" düğmesi. */
public class CallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        final String id = i.getStringExtra("id"), key = i.getStringExtra("key");
        Calls.stop(c, id);
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try { Calls.declineBlocking(id, key); } finally { pr.finish(); }
        }).start();
    }
}
