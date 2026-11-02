// Signalbound's phone page: shows the board's screen over Bluetooth and sends
// taps back. The picture format is the firmware's include/phone_codec.h.
"use strict";

const SERVICE = "a7d1f0b0-5b3e-4c1a-9d2e-53424e444c00";
const PICTURE = "a7d1f0b0-5b3e-4c1a-9d2e-53424e444c01";
const INPUT_C = "a7d1f0b0-5b3e-4c1a-9d2e-53424e444c02";
const W = 240, H = 320;
const IN_CODE = 1, IN_TOUCH = 2, IN_RESEND = 3;
const ST_OK = 1, ST_BAD_CODE = 2;

// RGB332 as the board's panel shows it (TFT_eSPI's color8to16).
const BLUE = [0, 82, 173, 255];
const RGBA = new Uint32Array(256);
for (let c = 0; c < 256; c++) {
  const r = Math.round(((c >> 5) & 7) * 255 / 7), g = Math.round(((c >> 2) & 7) * 255 / 7), b = BLUE[c & 3];
  RGBA[c] = (255 << 24 | b << 16 | g << 8 | r) >>> 0;
}

const $ = id => document.getElementById(id);
const canvas = $("screen");
const ctx = canvas.getContext("2d");
const image = ctx.createImageData(W, H);
const pixels = new Uint32Array(image.data.buffer);
pixels.fill(0xff000000);
let dirtyTop = H, dirtyBottom = -1;

// One notification: y, x, then PackBits pixels; y 0xFFFF is a status byte.
// Returns the status, or 0 for a picture.
function applyPacket(bytes) {
  if (bytes.length < 3) return 0;
  const y = bytes[0] | bytes[1] << 8;
  if (y === 0xFFFF) return bytes[2];
  if (y >= H) return 0;
  let x = bytes[2], i = 3;
  const base = y * W;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c < 128) {
      for (let k = 0; k <= c && i < bytes.length; k++, x++, i++) if (x < W) pixels[base + x] = RGBA[bytes[i]];
    } else if (c > 128 && i < bytes.length) {
      const v = RGBA[bytes[i++]];
      for (let k = 0; k < 257 - c; k++, x++) if (x < W) pixels[base + x] = v;
    }
  }
  if (y < dirtyTop) dirtyTop = y;
  if (y > dirtyBottom) dirtyBottom = y;
  return 0;
}

function paint() {
  if (dirtyBottom >= dirtyTop) {
    ctx.putImageData(image, 0, 0, 0, dirtyTop, W, dirtyBottom - dirtyTop + 1);
    dirtyTop = H;
    dirtyBottom = -1;
  }
  requestAnimationFrame(paint);
}

let device = null, input = null, wake = null;

// Writes one at a time (Chrome refuses overlapping ones). A finger's newer
// position replaces one still waiting, so a drag can't fall behind.
let writing = false, queued = [], moveWaiting = null;
async function pump() {
  if (writing || !input) return;
  writing = true;
  try {
    for (;;) {
      const next = queued.shift() || moveWaiting;
      if (!next) break;
      if (next === moveWaiting) moveWaiting = null;
      await input.writeValueWithoutResponse(next);
    }
  } catch (e) { queued = []; moveWaiting = null; }
  writing = false;
}
function send(bytes) { queued.push(bytes); pump(); }

function fingerMsg(down, ev) {
  const r = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(W - 1, Math.floor((ev.clientX - r.left) * W / r.width)));
  const y = Math.max(0, Math.min(H - 1, Math.floor((ev.clientY - r.top) * H / r.height)));
  return new Uint8Array([IN_TOUCH, down ? 1 : 0, x & 255, x >> 8, y & 255, y >> 8]);
}
let fingerDown = false;
canvas.addEventListener("pointerdown", ev => { fingerDown = true; canvas.setPointerCapture(ev.pointerId); send(fingerMsg(true, ev)); ev.preventDefault(); });
canvas.addEventListener("pointermove", ev => { if (fingerDown) { moveWaiting = fingerMsg(true, ev); pump(); } });
const lift = ev => { if (fingerDown) { fingerDown = false; moveWaiting = null; send(fingerMsg(false, ev)); } };
canvas.addEventListener("pointerup", lift);
canvas.addEventListener("pointercancel", lift);

function show(which) {
  $("connect").classList.toggle("hide", which !== "connect");
  $("pair").classList.toggle("hide", which !== "pair");
  canvas.style.display = which === "screen" ? "block" : "none";
}

async function keepAwake() {
  try { if ("wakeLock" in navigator) wake = await navigator.wakeLock.request("screen"); } catch (e) {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && canvas.style.display === "block") {
    keepAwake();
    // Android may have held notifications back. The board resends all but black.
    if (input) { pixels.fill(0xff000000); dirtyTop = 0; dirtyBottom = H - 1; send(new Uint8Array([IN_RESEND])); }
  }
});

function onPacket(ev) {
  const v = ev.target.value;
  const st = applyPacket(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  if (st === ST_OK) { pixels.fill(0xff000000); dirtyTop = 0; dirtyBottom = H - 1; show("screen"); keepAwake(); }
  else if (st === ST_BAD_CODE) { $("err2").textContent = "That code didn't match. Check the board's screen."; $("code").value = ""; }
}

function onGone() {
  input = null;
  writing = false; queued = []; moveWaiting = null; fingerDown = false;
  if (wake) { wake.release().catch(() => {}); wake = null; }
  $("err1").textContent = "The board disconnected. Tap CONNECT to go again.";
  show("connect");
}

async function connect() {
  $("err1").textContent = "";
  if (!navigator.bluetooth) { $("err1").textContent = "This browser has no Bluetooth for web pages. Open this page in Chrome on Android."; return; }
  try {
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE] }] });
    device.addEventListener("gattserverdisconnected", onGone);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    const picture = await service.getCharacteristic(PICTURE);
    input = await service.getCharacteristic(INPUT_C);
    picture.addEventListener("characteristicvaluechanged", onPacket);
    await picture.startNotifications();
    $("err2").textContent = "";
    $("code").value = "";
    show("pair");
    $("code").focus();
  } catch (e) {
    if (e.name !== "NotFoundError") $("err1").textContent = "Couldn't connect: " + e.message;   // NotFoundError: the chooser was cancelled
  }
}

function sendCode() {
  const code = $("code").value.trim();
  if (!/^\d{6}$/.test(code)) { $("err2").textContent = "The code is six digits."; return; }
  $("err2").textContent = "";
  const msg = new Uint8Array(7);
  msg[0] = IN_CODE;
  for (let i = 0; i < 6; i++) msg[i + 1] = code.charCodeAt(i);
  send(msg);
}

$("go").addEventListener("click", connect);
$("send").addEventListener("click", sendCode);
$("code").addEventListener("keydown", ev => { if (ev.key === "Enter") sendCode(); });
requestAnimationFrame(paint);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
