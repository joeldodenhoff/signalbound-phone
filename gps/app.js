// Signalbound GPS Test: an outdoor check of the board's GPS antenna from an
// Android phone over USB-C. It reads the board's console (the module's own
// NMEA sentences, which GPS RAW turns on) and compares two antenna spots.
// It only sends the board's GPS console commands; it never changes anything.
"use strict";
import { serial as usbSerial } from "./serial.js";

const $ = id => document.getElementById(id);
// "#demo" (for checking the page with no board): made-up satellites, and
// every timed part 60 times shorter.
const DEMO = location.hash === "#demo";
const WARM_MS = (DEMO ? 3000 : 3 * 60000), RUN_MS = (DEMO ? 10000 : 10 * 60000), STRONG = 25;
const SAVE_KEY = "sbGpsTest";

// ---- the receiver's state, from its NMEA sentences ----
const SYS = { GP: "GPS", GL: "GLONASS", GA: "Galileo", GB: "BeiDou", BD: "BeiDou", GQ: "QZSS" };
let sats = new Map(), gsvView = {}, antenna = "";
let fix = { q: 0, used: 0, hdop: null, lat: null, lon: null, at: 0 };
let lastData = 0, sentences = 0;

function nmeaOk(s) {
  const star = s.lastIndexOf("*");
  if (s[0] !== "$" || star < 0 || star + 3 > s.length) return false;
  let sum = 0;
  for (let i = 1; i < star; i++) sum ^= s.charCodeAt(i);
  return sum === parseInt(s.substr(star + 1, 2), 16);
}
function coord(v, h) {
  if (!v || !h) return null;
  const dot = v.indexOf("."), il = dot < 0 ? v.length : dot;
  const d = +v.slice(0, il - 2) + +v.slice(il - 2) / 60;
  return h === "S" || h === "W" ? -d : d;
}
function onNmea(s, t) {
  if (!nmeaOk(s)) return;
  sentences++; lastData = t;
  const f = s.slice(1, s.lastIndexOf("*")).split(",");
  const talker = f[0].slice(0, 2), type = f[0].slice(2);
  if (type === "GGA") {
    fix.q = +f[6] || 0; fix.used = +f[7] || 0; fix.hdop = f[8] ? +f[8] : null;
    if (fix.q > 0) { fix.lat = coord(f[2], f[3]); fix.lon = coord(f[4], f[5]); fix.at = t; }
    else fix.at = 0;   // the receiver says no fix now
  } else if (type === "RMC") {
    if (f[2] === "A" && !fix.q) { fix.lat = coord(f[3], f[4]); fix.lon = coord(f[5], f[6]); fix.at = t; }
  } else if (type === "GSV") {
    for (let k = 4; k + 3 < f.length; k += 4) {
      if (!f[k]) continue;
      const sys = SYS[talker] || talker;
      sats.set(sys + " " + f[k], { sys, prn: +f[k], elev: f[k + 1] ? +f[k + 1] : null, az: f[k + 2] ? +f[k + 2] : null, snr: f[k + 3] ? +f[k + 3] : 0, at: t });
    }
    if (+f[2] === +f[1]) gsvView[talker] = { view: +f[3] || 0, at: t };
  } else if (type === "TXT" && f[4]) antenna = f[4];
}

function nowSky(t) {
  const list = [...sats.entries()].filter(([, x]) => t - x.at <= 10000).map(([key, x]) => ({ key, ...x })).sort((a, b) => b.snr - a.snr);
  let view = 0;
  for (const k in gsvView) if (t - gsvView[k].at <= 10000) view += gsvView[k].view;
  const heard = list.filter(x => x.snr > 0).length, strong = list.filter(x => x.snr >= STRONG).length;
  const top = list.slice(0, 4).map(x => x.snr);
  while (top.length < 4) top.push(0);
  const fixed = t - fix.at < 5000;
  return { list, view: Math.max(view, list.length), heard, strong, used: fixed ? fix.used : 0, best: list.length ? list[0].snr : 0,
           top4: top.reduce((a, b) => a + b, 0) / 4, fixed, live: t - lastData < 5000 };
}

// ---- the test: a warm-up, spot A, move, spot B ----
// stage: idle, warm, runA, move, runB, done
let test = { stage: "idle", labelA: "#1", labelB: "#3", stageAt: 0, runs: [] };
let logLines = [];

function newRun(label) { return { label, startAt: Date.now(), endAt: 0, samples: [], satSnr: {}, firstHeard: null, firstFix: null }; }
function curRun() { return test.stage === "runA" ? test.runs[0] : test.stage === "runB" ? test.runs[1] : null; }

function sample() {
  const t = Date.now(), k = nowSky(t), r = curRun();
  if (!r || !k.live) return;
  const el = (t - r.startAt) / 1000;
  r.samples.push({ s: Math.round(el), view: k.view, heard: k.heard, strong: k.strong, used: k.used, best: k.best, top4: +k.top4.toFixed(1), fixed: k.fixed ? 1 : 0 });
  for (const x of k.list) if (x.snr > 0) { const a = r.satSnr[x.key] || (r.satSnr[x.key] = [0, 0]); a[0] += x.snr; a[1]++; }
  if (k.heard && r.firstHeard == null) r.firstHeard = Math.round(el);
  if (k.fixed && r.firstFix == null) r.firstFix = Math.round(el);
}

function summarize(r) {
  const n = r.samples.length || 1, avg = k => r.samples.reduce((a, x) => a + x[k], 0) / n;
  return { n: r.samples.length, heard: avg("heard"), strong: avg("strong"), top4: avg("top4"), fixedPct: 100 * avg("fixed"),
           best: r.samples.reduce((m, x) => Math.max(m, x.best), 0), firstHeard: r.firstHeard, firstFix: r.firstFix };
}
// The same satellites heard in both: how much stronger on average at B.
function sameSats(a, b) {
  const d = [];
  for (const k in a.satSnr) if (b.satSnr[k]) d.push(b.satSnr[k][0] / b.satSnr[k][1] - a.satSnr[k][0] / a.satSnr[k][1]);
  return d.length ? { n: d.length, diff: d.reduce((x, y) => x + y, 0) / d.length } : null;
}

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(test)); } catch {}
}
function load() {
  try { const t = JSON.parse(localStorage.getItem(SAVE_KEY)); if (t && t.runs) test = t; } catch {}
}

// ---- the serial port ----
let port = null, reading = false, rawTimer = null, wake = null;
const android = /Android/i.test(navigator.userAgent);

async function connect() {
  try {
    if (android || !("serial" in navigator)) {
      if (!("usb" in navigator)) throw new Error("This browser can't reach USB. Use Chrome on the phone.");
      port = await usbSerial.requestPort();
    } else port = await navigator.serial.requestPort();
  } catch (e) {
    if (e && e.name === "NotFoundError") return;   // the chooser was closed
    say("conSay", "Couldn't reach the board: " + (e.message || e), "bad"); return;
  }
  try {
    await port.open({ baudRate: 115200 });
    try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch {}
  } catch (e) { port = null; say("conSay", "Found the board but couldn't open it: " + (e.message || e), "bad"); return; }
  say("conSay", "Connected. Listening to the GPS...", "good");
  $("conBtn").textContent = "Connected";
  $("conBtn").disabled = true;
  ["liveWin", "skyWin", "logWin"].forEach(id => $(id).classList.remove("hidden"));
  if (test.stage !== "done") $("testWin").classList.remove("hidden");
  keepAwake();
  readLoop();
  setTimeout(async () => { await send("GPS STATUS"); await send("GPS RAW"); }, 700);
  rawTimer = setInterval(() => send("GPS RAW"), 55000);   // RAW lasts 60 s on the board
}

async function send(cmd) {
  if (!port || !port.writable) return;
  const w = port.writable.getWriter();
  try { await w.write(new TextEncoder().encode(cmd + "\n")); addLine("> " + cmd); } catch {} finally { w.releaseLock(); }
}

async function readLoop() {
  reading = true;
  const dec = new TextDecoder();
  let part = "";
  while (reading && port && port.readable) {
    const reader = port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        part += dec.decode(value, { stream: true });
        const lines = part.split(/\r?\n/);
        part = lines.pop();
        for (const l of lines) if (l) addLine(l);
      }
    } catch (e) {
      say("conSay", "The board disconnected. Plug it back in and tap Connect; the test keeps its place.", "bad");
      break;
    } finally { try { reader.releaseLock(); } catch {} }
  }
  clearInterval(rawTimer); rawTimer = null;
  port = null;
  $("conBtn").textContent = "Connect"; $("conBtn").disabled = false;
}

function addLine(l) {
  const t = Date.now();
  logLines.push(new Date(t).toLocaleTimeString() + "  " + l);
  if (logLines.length > 40000) logLines.splice(0, 5000);
  const m = l.match(/^\[nmea\] (.*)$/);
  if (m) onNmea(m[1].trim(), t); else if (l[0] === "$") onNmea(l.trim(), t);
  const r = curRun();
  if (r) (r.log || (r.log = [])).push(logLines[logLines.length - 1]);
}

async function keepAwake() {
  try { if ("wakeLock" in navigator) wake = await navigator.wakeLock.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && port) keepAwake(); });

// ---- drawing ----
function say(id, text, cls) { const e = $(id); e.textContent = text; e.className = "say" + (cls ? " " + cls : ""); }
function tile(id, v, cls) { const e = $(id); e.textContent = v; e.className = "v" + (cls ? " " + cls : ""); }
function mmss(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

function verdict(k) {
  if (!k.live) return ["", sentences ? "No GPS messages for a few seconds..." : "Waiting for the GPS's messages (they start a few seconds after connecting)."];
  if (/OPEN/.test(antenna)) return ["bad", "The GPS says no antenna is connected. Check the antenna's plug."];
  if (/SHORT/.test(antenna)) return ["bad", "The GPS says the antenna is shorted. Check the antenna's cable."];
  if (k.fixed) return ["good", `Fixed on ${k.used} satellites. Position found.`];
  if (!k.list.length) return ["bad", "It hears no satellites at all. Is the antenna facing the open sky?"];
  if (k.strong >= 4) return ["good", `${k.strong} strong satellites. A fix should come soon if the board stays still.`];
  if (!k.heard) return ["warn", `It knows of ${k.view} satellites but can't hear them yet.`];
  return ["warn", `${k.strong} strong of the 4 or so a fix needs (${k.heard} heard). Give it time, and open sky.`];
}

function drawLive() {
  const k = nowSky(Date.now());
  tile("tFix", k.fixed ? "YES" : "no", k.fixed ? "good" : "bad");
  tile("tView", k.live ? k.view : "-");
  tile("tHeard", k.live ? k.heard : "-", k.live && !k.heard ? "bad" : "");
  tile("tStrong", k.live ? k.strong : "-", k.strong >= 4 ? "good" : k.strong ? "warn" : "bad");
  tile("tUsed", k.live ? k.used : "-", k.used >= 4 ? "good" : "");
  tile("tBest", k.best || "-", k.best >= STRONG ? "good" : k.best ? "warn" : "");
  const [cls, text] = verdict(k);
  say("verdict", text, cls);
  // Sky plot
  let g = "";
  for (const r of [100, 66.7, 33.3]) g += `<circle r="${r}" fill="none" stroke="#393029"/>`;
  g += `<text x="0" y="-103" text-anchor="middle" font-size="11" fill="#f7c35a">N</text>`;
  let placed = 0;
  for (const x of k.list) {
    if (x.elev == null || x.az == null) continue;
    placed++;
    const r = 100 * (90 - Math.max(0, Math.min(90, x.elev))) / 90, a = x.az * Math.PI / 180;
    const cx = (r * Math.sin(a)).toFixed(1), cy = (-r * Math.cos(a)).toFixed(1);
    const c = x.snr >= STRONG ? "#5ae37b" : x.snr > 0 ? "#f7a35a" : "#5a6a86";
    g += `<circle cx="${cx}" cy="${cy}" r="8" fill="${c}"/><text x="${cx}" y="${(+cy + 3.5).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="#081421" font-weight="700">${x.prn}</text>`;
  }
  if (!placed) g += `<text y="4" text-anchor="middle" font-size="10" fill="#adbac6">${k.list.length ? "Directions not known yet" : "No satellites listed"}</text>`;
  $("sky").innerHTML = g;
  $("sats").innerHTML = k.list.slice(0, 14).map(x => `<div class="sat"><span>${x.sys}</span><span>${x.prn}</span>` +
    `<div class="meter"><i class="${x.snr >= STRONG ? "good" : x.snr ? "warn" : ""}" style="width:${Math.max(2, Math.min(100, x.snr * 2))}%"></i></div><span>${x.snr || "-"}</span></div>`).join("");
}

function drawStep() {
  const t = Date.now(), s = test.stage;
  const clock = $("clock"), note = $("clockNote"), btn = $("stepBtn"), skip = $("skipBtn");
  const timed = s === "warm" || s === "runA" || s === "runB";
  clock.classList.toggle("hidden", !timed); note.classList.toggle("hidden", !timed);
  skip.classList.toggle("hidden", !timed); btn.classList.toggle("hidden", timed);
  if (s === "idle") {
    $("stepEyebrow").textContent = "Step 2"; $("stepTitle").textContent = "Get ready";
    if (!$("labA")) $("stepBody").innerHTML = `<ol>
      <li>Go outside, away from walls and trees if you can.</li>
      <li>Put the antenna at the first spot, and set the board the way you'd normally have it. Don't move it during the test.</li>
      <li>Keep the phone a little away from the antenna.</li></ol>
      <div class="row" style="margin-top:10px"><label class="dim">First spot<input type="text" id="labA" value="${test.labelA}"></label>
      <label class="dim">Second spot<input type="text" id="labB" value="${test.labelB}"></label></div>
      <p class="dim">About 23 minutes: 3 to let the GPS settle, 10 at the first spot, then you move the antenna, 10 at the second.</p>`;
    btn.textContent = "Start the test";
  } else if (s === "move") {
    $("stepEyebrow").textContent = "Halfway"; $("stepTitle").textContent = "Move the antenna";
    $("stepBody").innerHTML = `<p>Done with <b>${esc(test.labelA)}</b>.</p><p>Move the antenna to <b>${esc(test.labelB)}</b>. Put the board back exactly where it was, the same way up, then tap the button.</p>`;
    btn.textContent = `Start ${test.labelB}`;
  } else if (timed) {
    const len = s === "warm" ? WARM_MS : RUN_MS, left = len - (t - test.stageAt);
    $("stepEyebrow").textContent = s === "warm" ? "Settling" : `Part ${s === "runA" ? 1 : 2} of 2`; $("stepTitle").textContent = s === "warm" ? "Letting the GPS settle" : `Testing ${s === "runA" ? test.labelA : test.labelB}`;
    $("stepBody").innerHTML = s === "warm" ? `<p>The antenna is at <b>${esc(test.labelA)}</b>. Leave the board still.</p>` : `<p>Leave the board still. The phone screen stays on.</p>`;
    clock.textContent = mmss(left);
    note.textContent = s === "warm" ? "This part isn't scored." : `Part ${s === "runA" ? 1 : 2} of 2. ${port ? "" : "Board not connected: plug it in and tap Connect."}`;
    if (left <= 0) nextStage();
  }
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function nextStage() {
  const s = test.stage, t = Date.now();
  if (s === "idle") {
    test.labelA = ($("labA").value || "#1").trim(); test.labelB = ($("labB").value || "#3").trim();
    test.runs = []; test.stage = "warm"; test.stageAt = t;
  } else if (s === "warm") { test.stage = "runA"; test.stageAt = t; test.runs[0] = newRun(test.labelA); }
  else if (s === "runA") { test.runs[0].endAt = t; test.stage = "move"; }
  else if (s === "move") { test.stage = "runB"; test.stageAt = t; test.runs[1] = newRun(test.labelB); }
  else if (s === "runB") { test.runs[1].endAt = t; test.stage = "done"; showResults(); }
  $("stepBody").innerHTML = "";
  save(); drawStep();
}

function showResults() {
  $("testWin").classList.add("hidden");
  $("resultWin").classList.remove("hidden");
  $("resultBody").innerHTML = resultHtml();
}

function resultText() {
  const [a, b] = test.runs;
  if (!a || !b) return "The test didn't finish.";
  const A = summarize(a), B = summarize(b), same = sameSats(a, b);
  const t = s => s == null ? "never" : s + " s";
  const lines = [
    `Signalbound GPS test, ${new Date(a.startAt).toLocaleString()}`,
    "",
    `                       ${test.labelA.padEnd(10)} ${test.labelB}`,
    `Avg heard              ${A.heard.toFixed(1).padEnd(10)} ${B.heard.toFixed(1)}`,
    `Avg strong (25+)       ${A.strong.toFixed(1).padEnd(10)} ${B.strong.toFixed(1)}`,
    `Avg of 4 best SNR      ${A.top4.toFixed(1).padEnd(10)} ${B.top4.toFixed(1)}`,
    `Best SNR               ${String(A.best).padEnd(10)} ${B.best}`,
    `Time fixed             ${(A.fixedPct.toFixed(0) + "%").padEnd(10)} ${B.fixedPct.toFixed(0)}%`,
    `First fix              ${t(A.firstFix).padEnd(10)} ${t(B.firstFix)}`,
    `Samples                ${String(A.n).padEnd(10)} ${B.n}`,
    same ? `Same satellites (${same.n}): ${test.labelB} was ${same.diff >= 0 ? "+" : ""}${same.diff.toFixed(1)} dB-Hz vs ${test.labelA}` : "No satellite was heard at both spots.",
    "",
    "Verdict: " + winner(A, B, same),
  ];
  return lines.join("\n");
}

function winner(A, B, same) {
  const d = same ? same.diff : B.top4 - A.top4;
  if (Math.abs(d) < 2 && Math.abs(B.strong - A.strong) < 1) return "about the same at both spots.";
  return (d > 0 ? test.labelB : test.labelA) + ` is better, by about ${Math.abs(d).toFixed(1)} dB-Hz.`;
}

function resultHtml() {
  const [a, b] = test.runs;
  if (!a || !b) return "<p>The test didn't finish.</p>";
  const A = summarize(a), B = summarize(b), same = sameSats(a, b);
  const row = (name, x, y, hi = true, f = v => v.toFixed(1)) =>
    `<tr><td>${name}</td><td class="${(hi ? x > y : x < y) ? "win-cell" : ""}">${f(x)}</td><td class="${(hi ? y > x : y < x) ? "win-cell" : ""}">${f(y)}</td></tr>`;
  const t = s => s == null ? "never" : s + " s";
  return `<div class="say good" style="font-weight:600">${esc(winner(A, B, same))}</div>
    <table style="margin-top:10px"><tr><th></th><th>${esc(test.labelA)}</th><th>${esc(test.labelB)}</th></tr>
    ${row("Satellites heard (avg)", A.heard, B.heard)}
    ${row("Strong ones (avg)", A.strong, B.strong)}
    ${row("Signal, 4 best (avg)", A.top4, B.top4)}
    ${row("Time with a fix", A.fixedPct, B.fixedPct, true, v => v.toFixed(0) + "%")}
    <tr><td>First fix after</td><td>${t(A.firstFix)}</td><td>${t(B.firstFix)}</td></tr></table>
    <p class="dim">${same ? `The ${same.n} satellites heard at both spots were ${Math.abs(same.diff).toFixed(1)} dB-Hz ${same.diff >= 0 ? "stronger" : "weaker"} at ${esc(test.labelB)}.` : "No satellite was heard at both spots."}
    A fix needs about 4 satellites at 25 or more. 3 dB-Hz is a real difference; 6 is a big one.</p>`;
}

function reportFile() {
  const parts = [resultText(), "", "== Samples (every 5 s): spot, seconds, view, heard, strong, used, best, avg4, fixed =="];
  for (const r of test.runs) for (const x of r.samples) parts.push([r.label, x.s, x.view, x.heard, x.strong, x.used, x.best, x.top4, x.fixed].join(","));
  for (const r of test.runs) { parts.push("", `== Board messages at ${r.label} ==`); parts.push(...(r.log || [])); }
  const d = new Date(test.runs[0] ? test.runs[0].startAt : Date.now());
  const name = `gps-test-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}.txt`;
  return new File([parts.join("\n") + "\n"], name, { type: "text/plain" });
}

async function share() {
  const f = reportFile();
  try {
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: "GPS test", text: resultText() }); return; }
  } catch (e) { if (e.name === "AbortError") return; }
  download(f);
}
// Everything the board said while this page was open, as a .log to read later.
function boardLogFile() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  const head = [`Signalbound board messages, saved ${d.toLocaleString()}`, `${logLines.length} lines`, ""];
  return new File([head.concat(logLines).join("\n") + "\n"], `signalbound-board-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.log`, { type: "text/plain" });
}
async function shareLog() {
  const f = boardLogFile();
  try {
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: "Board messages" }); return; }
  } catch (e) { if (e.name === "AbortError") return; }
  download(f);
}

function download(f) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(f); a.download = f.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

$("conBtn").onclick = connect;
$("stepBtn").onclick = nextStage;
$("skipBtn").onclick = () => { if (confirm("End this part now?")) nextStage(); };
$("shareBtn").onclick = share;
$("saveBtn").onclick = () => download(reportFile());
$("logSaveBtn").onclick = () => download(boardLogFile());
$("logShareBtn").onclick = shareLog;
$("againBtn").onclick = () => {
  if (!confirm("Start a new test? Send or save these results first.")) return;
  test = { stage: "idle", labelA: test.labelA, labelB: test.labelB, stageAt: 0, runs: [] };
  save();
  $("resultWin").classList.add("hidden");
  $("stepBody").innerHTML = "";
  if (port) $("testWin").classList.remove("hidden");
  drawStep();
};

load();
if (test.stage === "done") showResults();
setInterval(() => { if (port || sentences) drawLive(); drawStep(); }, 1000);
setInterval(() => { sample(); if (curRun() && curRun().samples.length % 12 === 0) save(); }, DEMO ? 500 : 5000);
setInterval(() => { $("logCount").textContent = `${logLines.length.toLocaleString()} lines kept while this page is open.`; }, 2000);
setInterval(() => { const l = $("log"); if ($("logDetails").open) { l.textContent = logLines.slice(-200).join("\n"); l.scrollTop = l.scrollHeight; } }, 1000);
drawStep();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

if (DEMO) {
  const ck = b => { let x = 0; for (const c of b) x ^= c.charCodeAt(0); return "$" + b + "*" + x.toString(16).toUpperCase().padStart(2, "0"); };
  ["liveWin", "skyWin", "logWin", "testWin"].forEach(id => $(id).classList.remove("hidden"));
  setInterval(() => {
    const b = test.stage === "runB" ? 6 : 0, j = () => Math.round(Math.random() * 3);
    addLine("[nmea] " + ck(`GPGSV,2,1,07,02,67,045,${24 + b + j()},05,40,120,${20 + b + j()},12,22,300,${15 + b + j()},15,10,200,,0`));
    addLine("[nmea] " + ck(`GPGSV,2,2,07,18,55,260,${22 + b + j()},24,15,030,${12 + b + j()},29,80,180,${26 + b + j()},0`));
    addLine("[nmea] " + ck(`BDGSV,1,1,02,07,45,150,${21 + b + j()},10,30,330,,0`));
    addLine("[nmea] " + ck(b ? "GNGGA,151200.000,4040.1234,N,07357.5678,W,1,05,1.8,35.0,M,-34.0,M,," : "GNGGA,,,,,,0,00,25.5,,,,,,"));
    addLine("[nmea] $GPTXT,01,01,01,ANTENNA OK*35");
  }, 1000);
}
