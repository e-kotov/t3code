# Mobile notifications

## Direct Android notifications in T3 Code EK

Pair your Android app with a server, then enable **Direct notifications** in
**Settings → Notifications**. Completion, failure, approval and input alerts
arrive through your paired connection, without a T3 Connect account or Google
push service. Tap an alert to open its conversation.

A persistent **T3 direct notifications** notification shows whether the listener
is connected. Its **Stop** action disables listening. If you connect through an
SSH tunnel, keep the tunnel app running too. For screen-off delivery, exclude
both apps from Android battery optimization; delivery still depends on the
phone's power-management settings and network availability.

Reopen T3 after a phone restart or after Android stops its process. The listener
does not save credentials separately or restart itself after process death.
Existing completed conversations do not generate alerts when listening starts.
Alerts stay quiet for the conversation you are currently viewing.

## T3 Connect notifications

In builds configured for T3 Connect, sign in, link your environments, and enable
**Device Notifications** in **Settings → Notifications** to receive alerts when
an agent finishes, fails, needs approval, or asks for input. Your environment
must have agent activity publishing enabled. Tap a notification to open its
thread.

Enable **Live Activity Updates** on iOS, **Agent Live Updates** on Android 16 and newer, or **Ongoing Agent Activity** on older Android versions to follow work without opening the app. Finished results remain visible for up to 15 minutes. You can dismiss an Android activity card without disabling alerts; turn off the same switch to stop future cards.

Android cloud notifications require Android 7.0 or newer and Google Play services. Android 16 and newer can promote ongoing activity to a Live Update, subject to system settings and device support. Other devices show a regular ongoing notification. If Live Updates don't appear on Android 16 or newer, check **Live Update Settings** in T3 Code's **Settings → Notifications**. Android 7's battery-saving modes can delay removal of expired cards.

Notification permission and Android notification channels are controlled in
system Settings. T3 Connect delivery does not require the mobile app to maintain
a connection to your environment. Force-stopping the Android app in system
Settings prevents delivery until you open it again.
