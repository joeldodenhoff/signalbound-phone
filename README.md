# Signalbound Phone

A web page that shows a Signalbound board's screen on an Android phone over
Bluetooth, and sends taps back: https://joeldodenhoff.github.io/signalbound-phone/

The game and saves stay on the board. The page caches its own files for offline
use. An optional GPS walk recorder holds diagnostic samples in page memory and
downloads them as JSON when STOP AND SAVE LOG is pressed. Save before closing.

**To use it:** on the board, SETTINGS > PHONE LINK > START. Open the page in
Chrome on Android, tap CONNECT, pick Signalbound, and type the code the board
shows.

With the matching GPS walk firmware, open GPS WALK DIAGNOSTICS and press
START WALK LOG. It records satellite counts, signal strength, HDOP, position
age and UART overflow events every two seconds, without coordinates. Keep
Chrome open and the phone unlocked. Reconnection requests diagnostics again;
gaps in the log indicate missing Bluetooth reports, not necessarily GPS loss.
Phone-supplied and bench positions are explicitly marked. Counters saturate
at 65,535; up to 18,000 samples (about ten hours) are retained. A page reload
loses unsaved samples. No diagnostics are uploaded automatically to ChatGPT.

The link is not encrypted: someone nearby with Bluetooth gear could read the
screen. Stop PHONE LINK when you aren't using it.

License: GPL-3.0.
