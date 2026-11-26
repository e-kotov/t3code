# Mobile notifications

Get push alerts, Live Activities, and home-screen widgets on iOS and Android when agents finish, fail, or need your approval or input.

## Direct Android notifications in T3 Code EK

Pair your Android app with a server, then enable **Direct notifications** in
**Settings → Notifications**. Completion, failure, approval and input alerts
arrive through your paired connection, without a T3 Connect account or Google
push service. Tap an alert to open its conversation.

Subagent completion alerts are off by default. To receive them, enable
**Subagent completion alerts** in the same settings. Subagent approval, input
and failure alerts still come through.

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

The sections below apply to builds configured for T3 Connect.

### Prerequisites

- Sign in to **T3 Connect** on both your phone and host machine (direct/Tailscale connections alone do not deliver background push notifications).
- Enable **Publish agent activity** in **Settings → Sharing & access** on the host.
- Enable **Device Notifications** in **Settings → Notifications** on mobile (Android requires Android 7.0+ and Google Play services).

### Live updates and widgets

- **Live progress**: Enable **Live Activity Updates** (iOS), **Agent Live Updates** (Android 16+, check **Live Update Settings** if missing), or **Ongoing Agent Activity** (older Android). Finished results stay visible for up to 15 minutes.
- **Silent live updates (Android 8+)**: Keep **Ongoing agent activity** on and disable **Agent alerts** in Android system notification settings.
- **iOS widget**: Add the **Agent Activity** widget to your Home Screen or Lock Screen (refreshes when you open T3; marks unfinished work stale after 10 minutes).

### Notes

- Ordinary alerts are muted while the mobile app is in the foreground, though viewing a thread on another device does not silence your phone.
- Force-stopping T3 Code in Android system Settings pauses push delivery until you reopen the app.
