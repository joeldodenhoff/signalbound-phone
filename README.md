# Signalbound Phone and Diagnostic Check

The complete HTTPS site is https://joeldodenhoff.github.io/signalbound-phone/.
Use Chrome on Android. The site needs all of its JavaScript, stylesheet, icon,
font, and offline-worker files; one downloaded HTML file is insufficient.

For normal play: Settings > Phone Link > Start on the board, then Connect to Play
on the phone. Select Signalbound and enter the six-digit code shown on the board.

For a diagnostic walk: Settings > Diagnostic Check > Start on the board, then
Connect for a Diagnostic Check on the phone. This records GPS and system health
without mirroring pictures or sending game taps. It replaces a regular Phone Link
session; the two modes do not run as simultaneous clients.

Keep the page open and phone unlocked. Recording starts after authentication.
Reconnect preserves the in-memory log; an explicit stop stays stopped. Use Stop
and Save Report before closing or reloading. Reports contain GPS quality and
receiver-configuration counters, memory/timing, Wi-Fi health, SD/art readiness,
battery where available, and available crash information. Automatic telemetry
excludes coordinates, SSIDs, MAC addresses, passwords and pairing codes. Optional
notes are included only when you type them. Nothing is uploaded automatically.
Send the saved JSON report to the assistant for analysis. A Bluetooth gap is not
proof of a GPS failure. Android background recording is not guaranteed.

The game and saves remain on the board. Normal mirrored frames can show nearby
addresses; the current link is not encrypted. Stop the connection when finished.

Firmware 0x26112524 adds a separate assistance-details packet (type 11, version 1),
keeping types 4–10 unchanged. Type 10 byte 19 announces that the extra packet is
expected. The page still completes records from earlier firmware without it.
Reports include orbit-cache age (seconds, null if unknown), retry delay, refresh
result, and free/largest INTERNAL memory separately from total heap/PSRAM.
The board and page explain why a refresh is waiting. A fresh cache can help GPS
startup; it is neither a measured position nor a guarantee of a fix.

License: GPL-3.0.
