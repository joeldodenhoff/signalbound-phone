# Signalbound GPS Test

An outdoor check of a Signalbound board's GPS antenna, from Chrome on an
Android phone with the board on a USB-C cable. Published beside PHONE LINK at
https://joeldodenhoff.github.io/signalbound-phone/gps/ (copy these files to
the signalbound-phone repo's `gps/` folder to publish a change).

It settles for 3 minutes, listens 10 minutes with the antenna at one spot and
10 at another, then compares them (satellites heard, signal strength of the
same satellites, time with a fix) and shares a report: the summary, a sample
every 5 s and the board's messages.

It reads the board's console at 115200 and sends only `GPS STATUS` and
`GPS RAW` (every 55 s, since RAW lasts 60 s). On Android, Chrome reaches the
board's USB serial port through WebUSB with Google's web-serial-polyfill
(`serial.js`, Apache-2.0, unchanged); on a PC it uses Web Serial. Open it once
on Wi-Fi and add it to the home screen: it then works with no signal.
`#demo` on the address shows it with made-up satellites and short timers.
