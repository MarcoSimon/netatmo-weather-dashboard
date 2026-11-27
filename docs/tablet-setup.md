# The tablet on the wall: setup

Everything needed to bring an old Android tablet from a factory state to a
dashboard on the wall, step by step — so that a factory reset or a replacement
device costs an evening rather than a round of research. It is written for
someone who does not otherwise work with Android.

**Menu paths are quoted in German, as they appear on a German device**, and
they differ between manufacturers; where a path is Samsung's (One UI), it says
so. Settings inside the kiosk browser are named as Fully shows them, in
English.

---

## What the tablet needs

| | |
| --- | --- |
| Android | **10 or later** — Chrome has required Android 10 since Chrome 139 (August 2025) |
| Browser engine | **Chrome and Android System WebView ≥ 139**, updated through the Play Store |
| Viewport | **1280×800 CSS pixels at `devicePixelRatio` 1.5**, landscape — what a 10" tablet at 1920×1200 reports; the layout is measured against it |
| RAM | 3 GB is enough for a page that stays open for weeks |
| Kiosk browser | **Fully Kiosk Browser**, and **Fully PLUS** for switching the screen off at night (§3) |

`http://<server>:8080/?diag` shows what the browser makes of the screen —
viewport, `devicePixelRatio`, engine version, mode and time zone. Use it inside
the kiosk browser too: its user agent reports the WebView version, not
Chrome's.

**An old tablet's security patches have usually ended, and that sets the rule
for everything below:** the tablet opens exactly one page on the LAN and is used
for nothing else — no mail, no banking, no other accounts. It is a display,
not a tablet.

**Updating Chrome does not update the kiosk browser's engine.** Since Android
10 the WebView is its own app, *Android System WebView*, and has to be updated
by itself. **The Play Store's search hides the stable one:** it is a system
component, and searching for it offers only the *Dev*, *Beta* and *Canary*
channels — test builds, not for a wall that runs for weeks. Open the listing
directly, in Chrome on the tablet:
<https://play.google.com/store/apps/details?id=com.google.android.webview>.
Chrome hands it to the Play Store, which then shows *Aktualisieren*. **Then
force-stop the kiosk browser** — *Einstellungen → Apps → Fully Kiosk Browser →
Beenden erzwingen* — because a running app keeps the WebView it loaded. Check
with `?diag` afterwards. A tablet that has been in a cupboard for a year may be
several major versions behind; check, do not assume.

**Colours differ between panels.** An ageing backlight loses its blue first,
and two tablets showing the same page side by side can disagree visibly —
screenshots taken on the device carry the exact colours, so the cast arises
after the pixels and cannot be corrected in the page. Judge colours on the
wall they are meant for.

---

## 1. The Google account

**Why a separate one.** The device gets no more security patches, so it should
not carry a personal account. The account exists for one purpose: installing
and updating the kiosk browser, Chrome and WebView from the Play Store.

1. **Create the account on a computer, not on the tablet:**
   <https://accounts.google.com/signup>. On an old Android the sign-up flow
   regularly stalls on verification; in a desktop browser it goes through.
   **Name it after the device's job, not after a person** — no surname, no
   year, no handle used elsewhere, and not the project or the hardware either,
   which would announce a piece of the house inventory wherever the address is
   typed. The address itself should answer "what was this account for?" when
   it turns up in the password manager in two years.
2. **Put the recovery address and phone number on a person, not on the
   tablet.** This account is used a handful of times a year, which makes it
   exactly the one whose password is missing in two years. Store the
   credentials in a password manager.
3. **Remove any old account on the tablet:** *Einstellungen → Konten und
   Sicherung → Konten → [account] → Konto entfernen* (Samsung). Android asks
   for the **screen lock (PIN or pattern)** here — without it the step cannot
   be finished. **Switch the lock off again once the accounts are sorted**
   (§6): it is needed for this step and breaks every unattended restart
   afterwards.
4. **Add the new account:** *Einstellungen → Konten und Sicherung → Konten →
   Konto hinzufügen → Google* (Samsung).
5. **Check the Play Store is using it:** open the Play Store, tap the profile
   picture at the top right, and confirm the new account is the active one.
6. **Give the account no payment method, and skip the dialog that asks for
   one.** Everything this device installs is free, and Play's
   *"Kontoeinrichtung abschließen"* prompt can be dismissed. An account with no
   card on it is the point: if the unpatched tablet is ever taken over, there is
   nothing behind the account to take. Fully PLUS does not change this, because
   its licence is sold outside Play (§3).
7. **Switch on automatic updates:** Play Store → profile → *Einstellungen →
   Netzwerkeinstellungen → Apps automatisch aktualisieren* → **"Nur über
   WLAN"**. This is what keeps the browser engine from quietly freezing.

**Say no to the Google backup, and to everything next to it.** The sign-in
flow offers a device backup, location history, "usage and diagnostics", the
assistant and personalised ads; all of them off. The backup is the one with a
real argument against it: **Android backs up saved Wi-Fi networks and their
passwords**, which would put the house Wi-Fi into the very account that exists
because this device is not trusted. And there is nothing to save — the device
holds one app, one URL and a dozen switches, all of them in this document.

**From the moment the account is added, Factory Reset Protection hangs on it.**
Whoever resets the tablet later has to sign in with *these* credentials or the
device is locked. That is what makes step 2 load-bearing.

**The section is done when an install works, not when the account shows up.**
A Play Store can show an account and still install nothing. The acceptance test
is the next section's first step: search for Fully and install it.

---

## 2. The kiosk browser

**Fully Kiosk Browser**, the de-facto standard for wall dashboards. It renders
through Android System WebView, so the engine stays current as long as WebView
updates.

| Free | PLUS (paid) |
| --- | --- |
| Launch on Boot | Kiosk Mode (lockdown) |
| Keep Screen On | Remote Administration |
| Fullscreen, no status or navigation bar | Screensaver |
| Auto Reload on Network Reconnect | **Scheduled sleep/wake, screen off timer** |
| Auto Reload after Page Error | Motion detection |
| A screen brightness setting | **The JavaScript interface (`fully.*`)** |

**Learn the way out before switching fullscreen on:** in the free version the
settings are reached by **swiping in from the left screen edge**. Without that,
the first fullscreen page looks like a device with no way back and invites a
reboot.

Fully may offer the first four in its **Quick Start Settings** on first launch;
some devices skip them. The rest sit in three different groups of the full
settings — go by group, not by searching:

| Setting | Where | Value |
| --- | --- | --- |
| Fullscreen Mode | Quick Start Settings | on |
| Show Action Bar | Quick Start Settings | off |
| Show Address Bar | Quick Start Settings | off |
| Kiosk Mode | Quick Start Settings | **off** |
| Start URL | Web Content Settings | `http://<server>:8080/` |
| Auto Reload on Network Reconnect | **Web Auto Reload** | **off** |
| Auto Reload on Screen On | **Web Auto Reload** | **off** |
| Auto Reload after Page Error | **Web Auto Reload** | **30** (seconds; `0` switches it off) |
| Launch on Boot | **Device Management** | on |
| Keep Screen On | **Device Management** | on |

**Kiosk Mode stays off:** lockdown is a PLUS feature and would put a trial
watermark on the wall, and in a household there is nobody to lock out.

**The start URL is the server's LAN address, so pin it in the router.** A DHCP
address that changes turns the wall into an error page with no visible cause.
Every home router can assign a host a fixed address. A `.local` name is no alternative: Android 10 does
not resolve mDNS reliably.

The page reloads itself hourly, and only right after the server has answered
in full: the values and every tile's series, which it fetches for that purpose.
It also recovers from a lost network by itself: it keeps asking every minute
and takes the values back without a reload. Fully's reload settings therefore
add only what the page cannot do for itself: recovering from the browser's own
error page after a power cut, when the server was not yet up. **That is Auto
Reload after Page Error; the other two stay off.** *On Network Reconnect*
reloads the moment the tablet is back on the WLAN, which can come before the
server is reachable: on the first WLAN test it put one of two tablets on
Fully's error page for half a minute, and with it off neither showed one.
*On Screen On* reloads whenever the screen wakes, which flashes white on a
dark wall at night; the page redraws on waking anyway and fetches within a
minute, and values older than 35 minutes are marked stale rather than shown
as current. **Auto Reload after Page Error is a number, not a switch, and `0` is
off** — at `0` the power-cut test (§6) fails on exactly the step it exists to
check. 30 seconds is soon enough that the wall returns within half a minute of
the server, slow enough that retries do not pile up while the host boots.

**Then check the result with `?diag` inside Fully.** The number that matters
is a viewport height near 800, not 632: the bars are gone and the page has the
full height. A viewport of 1280×799 is arithmetic, not a bug — 799.33 CSS
pixels are 1199 device pixels at `devicePixelRatio` 1.5, and the fraction is
rounded down. The page sizes itself in `vmin` and `cqmin`.

---

## 3. Brightness at night

The wall must not glow in a dark living room. This has two halves. The page
half is built in: from a quarter of an hour *before* sunset the page dims, and
from 22:00 until 06:00 it is black with nothing but the room names, their
temperatures and the airing labels (the times are defaults, see
`.env.example`). `?mode=day|evening|night` pins a rendering for checking.

**The other half is the backlight, which the page cannot reach.** On an IPS
LCD black pixels do not switch off: the backlight shines through them, and a
black page still glows as a grey rectangle in a dark room.

**Android's adaptive brightness is not enough** (*Einstellungen → Anzeige →
Adaptive Helligkeit*): with it on and the room completely dark, a tablet's
panel can sit at its minimum and the black page still glows like a torch. No
brightness value is lower than that minimum, so no brightness setting — in
Android, in Fully, or through its JavaScript interface — can fix it. **The
backlight has to go off**, which needs Fully PLUS.

### What to set

*Power Settings → **Schedule Wakeup and Sleep (PLUS)*** — sleep **22:00**, wake
**06:00**, every day: the same two times as `NIGHT_FROM` and `DAY_FROM` in the
server's `.env`. They live in two places, which is the accepted price.

Fully asks for two things when this is switched on, and both are required:

- **Device Administrator.** An ordinary Android app may not switch the screen
  off; only a device admin can. This permission *is* the feature. **Its side
  effect matters later:** an app holding it cannot be uninstalled. To remove
  Fully, first revoke it under the device's device-administrator settings
  (Samsung: *Einstellungen → Biometrische Daten und Sicherheit → Weitere
  Sicherheitseinstellungen → Geräteadministratoren*; near-stock Android:
  *Einstellungen → Sicherheit → Apps zur Geräteverwaltung*). The activation
  screen opens from inside Fully but is Android's; Fully may be listed twice,
  and only the entry it activated needs to be on.
- **Prevent Device from Sleep**, so Android's doze does not make the morning
  wake-up a lottery. It keeps the processor awake, not the screen. Android
  asks whether Fully may always run in the background — allow it.

*Advanced Web Settings → **Enable JavaScript Interface (PLUS)*** is on as
well. Fully warns that any loaded website then gets far-reaching access to the
device; acceptable here and only here, because the tablet loads exactly one
page from the house's own LAN. **Refuse everything else Android asks for while
these are switched on** — camera, nearby devices, photos and media: an
unpatched device gives no camera, microphone or file access to an app that
runs a page with a JavaScript interface.

### Why the page has a part in it at all

**A schedule fires at its two moments and never between them.** A tap at night
wakes the screen — and it then stays on, because nothing re-arms the evening
transition. Woken at 02:00, the wall would burn until morning, which is the
exact failure the whole feature exists to prevent. *Screen Off Timer* is the
wrong fix: nobody touches the wall by day either, so it would kill the
dashboard during the day.

So the two directions are split:

| Direction | Who | Why |
| --- | --- | --- |
| Off at night, **on in the morning** | Fully's schedule | The critical direction. Runs whether or not the page is healthy. |
| At night, dark **again** after a tap | the page, `fully.turnScreenOff()` | Comfort. If it fails, the wall is merely too bright until morning. |

The page's half of this can still reach into the morning. Fully's wake makes the page visible, which arms the page's timer, so a page that still believed it was night once switched a wall off again right after 06:00. It now checks the clock before switching off. **After a change to the page, check the morning on the wall:** at 06:01 the screen is on and the day rendering shows.

### The licence

**Fully PLUS is bought per device and tied to its Device ID**, so a second
wall needs a second licence. Buy it at
<https://license.fully-kiosk.com/license/single>, not as an in-app purchase,
which would tie the licence to a throwaway Google account; the form asks for
the Device ID (*side menu, right at the bottom*), and the app unlocks itself
once the payment goes through.

**Write the Device ID and the purchase e-mail address into the password
manager now.** A factory reset changes the Device ID and the licence does not
follow by itself; it has to be moved at
<https://license.fully-kiosk.com/license/move>, and that form wants the old
ID — which by then exists only on a device that no longer does.

---

## 4. Charging

Permanent charging swells the battery, and a swollen battery in a device on the
wall is not a cosmetic problem.

**Try the firmware's own charge limit first, and measure it.** Many tablets
offer one — a fixed ceiling such as 85 %, or a band around 40–60 % while
plugged in — and some do not hold it: one tested tablet charged through to
100 % with its 85 % switch on. Never believe the display
alone. Note the level with the time a few times over a day or two on the
charger: a limit that works lets a full battery run down to its band and then
keeps it there.

**If the firmware does not hold, charging has to be controlled from outside**:
a switchable socket on the LAN, driven by the battery level the kiosk browser
reports (`batteryLevel` and `isPlugged` from Fully's REST API with *Remote
Administration* on, or `fully.getBatteryLevel()` in the page). What protects
the cell is a narrow band around the middle of the charge — roughly 45–75 % —
held by short charges driven by the actual level. A plain timer socket is the
wrong shape: the drain changes with the room's light (below), so a fixed rhythm
either runs the pack deep or keeps it full.

### What one tablet draws

Measured on two tablets, screen on permanently in Fully with Android's
adaptive brightness on: the level from Fully's REST API once a minute, the
power from the socket's own meter. **A** is a 10.5" tablet with a 7,300 mAh
pack (about 27.7 Wh), **B** a 10.1" tablet with a 5,100 mAh pack (about
19.6 Wh, nominal), bought used.

| State | A: battery | A: draw | B: battery | B: draw |
| --- | --- | --- | --- | --- |
| Screen on, by day | 5–7 %/h | about 1.5–2 W | 4.6–8.1 %/h, 6.8 on average | — |
| Screen on, in the evening | about 3.6 %/h | about 1 W | about 4.8 %/h | — |
| Screen off at night (§3) | about 0.7 %/h | about 0.2 W | — | — |
| On power and full, screen on | — | 1.3–3.6 W | — | 1.6–1.7 W |
| Charging from a 20 W charger over USB-A | about 20 %/h up to about 85 %, then tapering | about 10 W at the socket | — | — |
| Charging from a 30 W USB-C PD charger | about 16 %/h | 6.7–6.8 W at the socket | about 26 %/h up to about 85 %, then tapering | about 11 W at the socket |

A dash is a value that was not measured; the draw on battery cannot be read
from the socket.

- **The backlight decides, so plan with the daytime figure.** The same tablet
  drained twice as fast at noon as in the evening, because adaptive brightness
  follows the room. A plan made from an evening measurement ran the pack down
  to 23 % the next day.
- **A 30-point band lasts about four to six hours by day**, so the socket
  switches three or four times a day, each charge about an hour and a half. The
  night costs only a few points.
- **The band lies below the taper**, so the loop never has to recognise a full
  battery.
- **The charger matters.** An old 10 W phone charger delivered for half an hour
  and then nothing, with the socket still on and the tablet reporting itself
  unplugged. Use a decent 15–20 W charger, and never trust the socket's state
  alone: compare it with the power it measures and with what the tablet
  reports.
- **A stronger charger is not necessarily a faster one.** On the same model of
  30 W USB-C PD charger, A took a third less than from a 20 W charger over
  USB-A, and two different cables made no difference, while B took 11 W. What
  a tablet negotiates is its own choice. Read the socket's power after every
  change of charger. A slower charge is no fault, as long as it fills the band
  in time: A charges 30 points in under two hours.
- **The drain does not speed up low down.** B ran from 100 % to 25 % in one day
  at a steady rate, and the lower half drained no faster than the upper. A
  single reading of 24 %/h from two integer levels, taken just after it was
  unplugged, turned out to be wrong by a factor of four. Measure a drain over
  hours, not minutes.
- **A full tablet with its screen off can read 0 W at the socket.** B did so at
  night, below the logger's 1 W threshold for a dead charger (§ *The loop*),
  so the logger warns about a full, sleeping tablet. Read such a warning
  together with the level.
- About three quarters of what the socket counts ends up in the pack — on A.
  On B the same rule gave more than the pack's nominal capacity: at 11 W, the
  screen and the device take a larger share of the charge. The plug cannot
  tell a battery's capacity.

### The socket

Why a Shelly plug and not another is in `docs/design.md` (*Charging socket*).
Set it up in its own web interface or over its RPC API:

1. **A fixed address** in the router, like the server's.
2. **Current firmware**, before testing anything against it.
3. **Cloud, Matter, Bluetooth and the socket's own access point off.** The
   socket needs nothing outside the house and no way in other than the LAN,
   and its app keeps working there.
4. **Authentication on.** The password is yours to choose; the socket has none
   until it is set. The local API then asks for HTTP digest
   authentication (SHA-256), user `admin`. From `curl --digest`, `GET` with
   URL-encoded parameters works (`/rpc/Switch.Set?id=0&on=false`); a `POST`
   from `curl` was refused with *Bad Request*. The project's own client
   (`src/shelly.js`) posts JSON-RPC frames to `/rpc` and is accepted.
5. **`initial_state: on`**, so the socket comes back on after a power cut. Only
   a real power cut counts: a software reboot keeps the last state.
6. **`auto_on` with a delay — the fail-safe.** Whatever switches the socket
   off, it switches itself back on after the delay, so the controller only
   ever switches *off*. The delay has to outlast the band at the fastest
   drain: 30 points at 7 %/h is about four hours, so **4–5 h**. At the fastest
   drain measured on either tablet, 8.1 %/h, 4.5 h takes the band's top of
   75 % to about 39 %. Much longer,
   and a controller that dies at the top of the band leaves the tablet low by
   the afternoon.

In Fully, **Sleep on Power Connect** and **Sleep on Power Disconnect** stay off.
They look made for this and do the opposite: the wall would go dark exactly
when the socket switches.

### The loop

The loop is a script on the socket itself (`shelly/charge.js`), so it runs
around the clock without the server's host. Once a minute it reads the
battery level from the kiosk browser and switches the socket **off at 75 %**.
It never switches it on: the socket's `auto_on` timer does, after 4.5 hours,
so the bottom of the band follows from the drain — about 43 % by day, near
60 % in the evening, and a shallow top-up at night. If the script stops or
the tablet cannot be reached, the socket stays on and the tablet charges to
100 %: the wrong side for the cell, the right side for the wall.

1. In the kiosk browser, **Remote Administration** on with a password (§2),
   and saved. Fully may ask for the microphone and the location then; the loop
   needs neither, so refuse both.
2. `SHELLY_HOST`, `SHELLY_PASSWORD`, `FULLY_HOST` and `FULLY_PASSWORD` in
   `.env` (`.env.example`). **Quote a password that contains `#`**: Node
   cuts an unquoted value there, and the kiosk browser then answers every
   request with *Please login* — with HTTP 200.
3. `npm run charge:deploy`. It sets `initial_state`, `auto_on` and its delay,
   stores the kiosk browser's address and password in the socket's key-value
   store, uploads the script, starts it and enables it at boot. Run it again
   after any change to the script; it replaces the code in place.
4. `npm run -s charge:log >> charge.log 2>&1` on a host that is up, for a
   line per minute with level, plugged, socket and power. Nothing on the
   socket keeps a record. It warns when the socket is on and the tablet does
   not charge two minutes in a row — the dead charger above.

The script's own messages are in the socket's web interface, under the
script's console. Without the loop, a tablet on permanent power at 100 % is a
known, time-limited compromise. Write it down so it does not become the
permanent state by silence.

---

## 5. The wall

- Position with a socket in reach, and a cable route
- Mounted, on power, landscape

---

## 6. The recovery tests

The setup is done when the tablet returns to a fullscreen dashboard **on its
own**, after each of these.

- **Reboot:** switch it off and on, touch nothing, and stop the time. Expect
  one to two minutes from cold to the wall (the home screen, then Fully
  starting by itself, its splash screen, then the dashboard); the number is
  what the power-cut test is judged against.

  **The precondition is the screen lock, and it is easy to lose.** A PIN or
  pattern leaves the device on the lock screen and Fully never starts, so the
  wall never comes back without hands. Set *Sperrbildschirm →
  Bildschirmsperretyp → **Keine***. §1 step 3 needs a lock to remove an old
  account, so the setup itself is what puts one on the device. Nothing on the
  wall is worth a lock: the account holds nothing, and theft is covered by
  Factory Reset Protection. A factory reset or an update can put one back just
  as quietly, so if the wall ever fails to return after a power cut, look here
  first.
- **WLAN:** the house WLAN goes away for a few minutes and comes back. **Use
  the router, not the tablet's own switch:** a router that restarts after a
  firmware update is the case that actually happens, and it also takes the
  server off the network for a while. The poller loses a cycle to it, which the
  backfill closes by itself.

  1. Note the time and switch the WLAN off at the router.
  2. **Within about two minutes** the page shows *Keine Verbindung zum
     Server – letzte Antwort vor 2 Min.* The page asks every 60 seconds, gives
     up after 10, and shows the line only after two failures in a row; it
     keeps the last values rather than an error screen. If Fully's own error page appears
     instead, that is already a finding.
  3. Wait **three minutes**, long enough for Android to drop the network
     properly, then switch the WLAN back on and start the stopwatch.
  4. **Passed** when the line is gone and the ages are back to minutes, without
     a touch, within about **two minutes**, and without a reload: the page
     takes the values back at its next ask. Fully's error page or a white
     flash means *Auto Reload on Network Reconnect* is still on (§2).
  5. **Keep an eye on it for another quarter of an hour.** A tablet can come
     back on a poor link and start losing most requests 10–15 minutes later:
     the line comes and goes, and the tablet answers few pings. Switching the
     tablet's own WLAN off and on clears it, as does a reboot. Note which
     tablet does this; it is the step to take after every router restart.

  **With a mesh, read the router's mesh view, not its device list.** A router
  with repeaters (a Fritz!Box, for instance) lists every client of a repeater
  as *not connected*, tablets included, while they work. Its mesh overview
  shows which access point each device is on and its link rate, and a poor
  link shows there as a rate far below that of its neighbours.

- **Power cut:** two tests, because the tablet has a battery and a short power
  cut does not switch it off. It keeps running while the router and the server
  go down, so the short case is the WLAN test plus a server that answers late.
  Only a cut that outlasts the battery switches the tablet off.

  **a) Short cut: the server answers after the tablet asks.** This checks
  *Auto Reload after Page Error*.

  1. Stop the server, so the page has nothing to load.
  2. Reboot the tablet and wait until Fully shows its own error page.
  3. Start the server again and start the stopwatch.
  4. **Passed** when the dashboard is back within about **30 seconds**, without
     a touch. The failure to watch for is a tablet that sits on Fully's error
     page and stays there.

  **b) Long cut: the tablet was off and gets power back.** A switched-off
  Android device that is plugged in usually does *not* boot: it shows its
  charging screen and waits for the power button. If this tablet does that, the
  wall does not come back on its own after a cut longer than its battery.

  1. Pull the plug, then switch the tablet off by hand. That is the same state
     as an empty battery, without waiting hours for it to run down.
  2. Plug it back in and touch nothing.
  3. **Passed** when it boots by itself and reaches the dashboard. **Failed**
     when it stops at the charging screen. Write down which: there is rarely a
     setting to fix this without rooting the device — some firmwares offer a
     scheduled power-on, worth a look but not worth counting on — and the
     answer decides whether a long power cut needs someone to press the power
     button.

  **Expect it to fail.** Booting on power is the firmware's decision, not
  Android's, and most tablets wait at the charging screen. **The realistic way
  there is not a long power cut but a plug pulled by accident:** the battery
  carries the wall for hours, nothing looks wrong, and then it is dark until
  someone presses the button. The defence is therefore to keep the battery from
  running out rather than to hope the tablet recovers — a charging socket that
  fails towards *on* (§4), and noticing a pulled plug while the battery still
  has hours left. The dashboard does the second through the JavaScript
  interface: off power at 40 % or less, a line at the foot of the page says
  so.

  Run both by day. Fully switches the screen off at night (§3), and a dark
  screen looks the same whether the test passed or not.

---

## After a factory reset

The short version of everything above: sign in with the tablet's own Google
account (§1), check Play auto-update, update Chrome and Android System WebView,
install Fully, apply the settings in §2 and §3, the charge limit in §4, then the
tests in §6. Nothing on the tablet holds state the dashboard needs — the page,
the database and the token all live on the server.

**Two things do not come back by themselves**, and both belong in the password
manager rather than in this file: the Google account's password, without which
Factory Reset Protection locks the device, and the **Fully PLUS licence**, which
hangs on a Device ID the reset has just changed — move it at
<https://license.fully-kiosk.com/license/move>. And check the screen lock
afterwards: removing an old account in §1 needs one, and a device that keeps it
never returns to the wall on its own (§6).
