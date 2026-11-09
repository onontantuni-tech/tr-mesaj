package com.trtr.mesaj;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/** Sunucudan doğrudan uygulamaya gelen veri mesajları (arama, cevapsız arama, zili sustur). */
public class PushService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage msg) {
        Map<String, String> d = msg.getData();
        String kind = d.get("kind");
        if ("call".equals(kind)) Calls.ring(this, d);
        else if ("callstop".equals(kind)) Calls.stop(this, d.get("call"));
        else if ("missed".equals(kind)) { Calls.stop(this, d.get("call")); Calls.missed(this, d); }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        Calls.prefs(this).edit().putString("ntok", token).remove("nerr").apply();
    }
}
