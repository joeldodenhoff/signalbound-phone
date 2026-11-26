// Signalbound's phone page: shows the board's screen over Bluetooth and sends
// taps back. The picture format is the firmware's include/phone_codec.h.
"use strict";

const SERVICE = "a7d1f0b0-5b3e-4c1a-9d2e-53424e444c00";
const PICTURE = "a7d1f0b0-5b3e-4c1a-9d2e-53424e444c01";
const INPUT_C = "a7d1f0b0-5b3e-4c1a-9d2e-53424e444c02";
const W = 240, H = 320;
const IN_CODE = 1, IN_TOUCH = 2, IN_RESEND = 3, IN_PING = 4;
const ST_OK = 1, ST_BAD_CODE = 2, ST_ALIVE = 3;
let gpsRecording=false,gpsRows=[],gpsLastAt=0,gpsTruncated=false;
let diagnosticMode=false,wantDiagnostic=false,pendingSample=null,latestHealth={},recordingStoppedByUser=false;
function assistanceText(h){
 const states=["Waiting for Internet Wi-Fi.","Waiting for a verified clock.","Waiting for internal memory for secure download.","Downloading and validating orbit data.","Download checked; waiting for idle time to save it.","Refresh failed; ordinary GPS continues.","Recent cache; refresh not needed yet.","Waiting for an idle Journey or Hearth screen.","Waiting for receiver identification.","Waiting before retrying a failed refresh.","Connecting to saved Wi-Fi, then allowing 15 seconds to settle.","Save credentials for your assigned Hearth or Lantern.","Waiting to hear a saved Hearth or Lantern nearby.","Another network job owns the radio."];
 const age=h.orbitAgeSeconds;
 const cache=!h.orbitBytes?'No saved orbit cache.':age==null?(h.orbitCacheFresh?'Usable cache; exact age not reported.':'Cache age unavailable; verified clock/details needed.'):
  `Cache age: ${Math.floor(age/3600)} h ${Math.floor(age/60)%60} min. ${age<=21600?'Usable for startup assistance.':'Too old to send; refresh needed.'}`;
 const result=["No refresh attempted yet.","Last refresh succeeded.","Last secure download failed.","Last download failed timestamp or packet validation.","Last refresh could not allocate memory.","Network time could not be verified.","Validated orbits are in RAM; SD save is pending."];
 return `${cache}\nRefresh: ${states[h.orbitDownloadState]||'Waiting for status.'}${h.orbitRetrySeconds?'\nRetry in about '+h.orbitRetrySeconds+' seconds.':''}${h.orbitLastResult===undefined?'':'\n'+(result[h.orbitLastResult]||'Result unavailable.')}${h.orbitInternalFree===undefined?'':'\nInternal memory: '+(h.orbitInternalFree/1024).toFixed(1)+' KB free; largest block '+(h.orbitInternalLargest/1024).toFixed(1)+' KB.'}\nReceiver assistance ACKs: ${h.casicCommandsAccepted??"not reported"} accepted / ${h.casicCommandsRejected??"not reported"} rejected.\nOrdinary GPS reception continues while assistance waits.`;
}
function qualityText(h){const reasons=["Accepted for gameplay","No valid receiver position","Last position is stale","Waiting for a current GGA quality report","Receiver reports no fix","Fewer than four satellites used","HDOP unavailable or invalid","HDOP exceeds game limit 5.0","Estimated position; not a measured fix"];return h.gpsQualityReason===undefined?"not reported":`${reasons[h.gpsQualityReason]||"Unknown quality state"}. ${h.ggaRecent?'Receiver used '+h.receiverSatellitesUsed+' satellites; HDOP '+h.receiverHdop:'Current receiver satellite count unavailable'}.`;}
function systemPacket(bytes){
 if(bytes.length!==20 || bytes[3]!==1)return;
 const u16=i=>bytes[i]|bytes[i+1]<<8,u32=i=>(bytes[i]|bytes[i+1]<<8|bytes[i+2]<<16|bytes[i+3]<<24)>>>0;
 const type=bytes[2];let values={};
 if(type===5)values={screen:bytes[4],resetReason:bytes[5],uptimeMs:u32(6),freeHeap:u32(10),minimumHeap:u32(14),averageFrameMs:u16(18)};
 else if(type===6)values={wifiConnected:!!(bytes[4]&1),sdReady:!!(bytes[4]&2),artReady:!!(bytes[4]&4),charging:!!(bytes[4]&8),wifiRssi:bytes[5]>127?bytes[5]-256:bytes[5],largestFreeBlock:u32(6),maximumLoopGapMs:u16(10),loopStackFree:u16(12),artCount:u16(14),droppedWardriveRecords:u16(16),eventDropsRaw:bytes[19],batteryPercent:bytes[18]===255?null:bytes[18]};
 else if(type===7)values={bootId:u32(4).toString(16),firmwareBuild:u32(8).toString(16),uartErrors:u16(12),qualityRejected:u16(14),wifiDisconnects:u16(16),recordedCrashes:u16(18)};
 else if(type===8)values={previousCrash:!!(bytes[4]&1),coreDumpAvailable:!!(bytes[4]&2),crashDumpFromOlderFirmware:!!(bytes[4]&4),backtraceCount:bytes[5],crashPc:u32(6),crashCause:u32(10),crashAddress:u32(14),crashUptimeSeconds:u16(18)};
 else if(type===9)values={backtrace:[u32(4),u32(8),u32(12),u32(16)]};
 else if(type===10)values={receiverVerified:!!(bytes[4]&1),sbasRequested:!!(bytes[4]&2),orbitCacheFresh:!!(bytes[4]&4),motionModelObserved:bytes[5],motionModelRequested:bytes[6],navigationSystems:bytes[7],gpsIntervalMs:u16(8),orbitDownloadState:bytes[10],orbitBytes:u16(11),casicCommandsSent:u16(13),casicCommandsAccepted:u16(15),casicCommandsRejected:u16(17),assistanceDetailsExpected:bytes[19]>=1,performanceDetailsExpected:bytes[19]>=2,qualityDetailsExpected:bytes[19]>=3,connectionDetailsExpected:bytes[19]>=4};
 else if(type===11)values={orbitAgeSeconds:u32(4)===0xFFFFFFFF?null:u32(4),orbitRetrySeconds:u32(8),orbitInternalFree:u32(12),orbitInternalLargest:u16(16)*1024,orbitLastResult:bytes[18]};
 else if(type===14)values={paintedFps:u16(4)/10,loopP95Ms:u16(6),loopP99Ms:u16(8),touchP95Ms:u16(10),paintIntervalP95Ms:u16(12),maximumSampleGapMs:u16(14),pendingArchiveWrites:u16(16),pendingDiagnosticRecords:u16(18)};
 else if(type===15)values={bleIntervalMs:u16(4)*1.25,bleSupervisionMs:u16(6)*10,bleMtu:u16(8),browserBackground:!!bytes[10],bleScanWindowMs:bytes[11],bleDisconnectReason:u16(12),notificationFailures:u16(14),browserLeaseReleases:u16(16),bleConnections:u16(18)};
 else if(type===16)values={comparedDisplayPixels:u32(4),transferredDisplayPixels:u32(8),queuedArchiveWrites:u16(12),failedArchiveWrites:u16(14),savedDiagnosticRecords:u16(16),droppedDiagnosticRecords:u16(18)};
 else if(type===13)values={gpsQualityReason:bytes[4],receiverPositionRecent:!!(bytes[5]&1),ggaRecent:!!(bytes[5]&2),receiverSatellitesUsed:bytes[6],receiverQuality:bytes[7],receiverHdop:u16(8)/100,wifiSessionState:bytes[10],wifiJoinAttempts:bytes[11],wifiDisconnectReason:bytes[12],orbitPersisted:!!(bytes[13]&1),assistanceHttp:(u16(14)<<16)>>16,assistanceTls:(u16(16)<<16)>>16};
 else if(type===12)values={worstFrameMs:u16(4),touchDispatchDelayMs:u16(6),maximumStorageWriteMs:u16(8),fittedCacheHits:u32(10),fittedCacheMisses:u32(14),deferredAnimationGroups:u16(18)};
 else return;
 latestHealth={...latestHealth,...values};
 if(latestHealth.connectionDetailsExpected && latestHealth.eventDropsRaw!==undefined){values.droppedEventRecords=latestHealth.eventDropsRaw;latestHealth.droppedEventRecords=latestHealth.eventDropsRaw;}
 if(gpsRecording && pendingSample){pendingSample.system={...(pendingSample.system||{}),...values};if(type===16 || (type===13 && !latestHealth.connectionDetailsExpected) || (type===12 && !latestHealth.qualityDetailsExpected) || (type===11 && !latestHealth.performanceDetailsExpected) || (type===10 && !values.assistanceDetailsExpected))pendingSample.systemComplete=true;}
 $("system-report").classList.toggle('hide',false);
 linkVersion();
 const h=latestHealth,kb=n=>n===undefined?'waiting':(n/1024).toFixed(1)+' KB';
 $("system-report").textContent=`SYSTEM HEALTH\nFree memory: ${kb(h.freeHeap)} · Lowest: ${kb(h.minimumHeap)}\nLargest block: ${kb(h.largestFreeBlock)}\nAverage frame: ${h.averageFrameMs??'waiting'} ms\nLongest loop gap: ${h.maximumLoopGapMs??'waiting'} ms\nWi-Fi: ${h.wifiConnected===undefined?'waiting':h.wifiConnected?'connected ('+h.wifiRssi+' dBm)':'not connected'}\nSD card: ${h.sdReady===undefined?'waiting':h.sdReady?'ready':'unavailable'}\nArtwork: ${h.artReady===undefined?'waiting':h.artReady?h.artCount+' entries ready':'unavailable'}\nDropped travel records: ${h.droppedWardriveRecords??'waiting'}\nDropped detection log rows (capped at 255): ${h.droppedEventRecords??'not reported'}\nBattery: ${h.batteryPercent==null?'not reported':h.batteryPercent+'%'}\nPrevious crash: ${h.previousCrash===undefined?'waiting':h.previousCrash?'recorded':'none reported'}\nMotion model: ${h.motionModelObserved===255?'unconfirmed':h.motionModelObserved===2?'walking':h.motionModelObserved===3?'driving':h.motionModelObserved??'waiting'}\nSlowest loop work (recent window): ${h.worstFrameMs??'waiting'} ms\nSampled touch dispatch delay: ${h.touchDispatchDelayMs??'waiting'} ms\nLongest saved-data write: ${h.maximumStorageWriteMs??'waiting'} ms\nActor cache: ${h.fittedCacheHits??'waiting'} hits / ${h.fittedCacheMisses??'waiting'} misses\nDeferred animation groups: ${h.deferredAnimationGroups??'waiting'}\nReceiver quality: ${qualityText(h)}\nWi-Fi session: ${["Scanning / no download link held","Joining or obtaining an IP address","Associated; IP obtained","Join/recovery timed out"][h.wifiSessionState]??"not reported"} · Attempts ${h.wifiJoinAttempts??"?"} · Disconnect reason ${h.wifiDisconnectReason??"?"}\nAssistance HTTP/TLS: ${h.assistanceHttp??"not reported"} / ${h.assistanceTls??"not reported"}\nOrbit cache saved on SD: ${h.orbitPersisted===undefined?"not reported":h.orbitPersisted?"yes":"no / pending"}\nSatellite assistance: ${assistanceText(h)}\nPainted FPS (not loop rate): ${h.paintedFps??"not reported"}\nLoop p95/p99: ${h.loopP95Ms??"?"}/${h.loopP99Ms??"?"} ms\nTouch p95: ${h.touchP95Ms??"?"} ms\nBLE interval / timeout / MTU: ${h.bleIntervalMs??"?"} ms / ${h.bleSupervisionMs??"?"} ms / ${h.bleMtu??"?"}\nBLE reason / notification failures: ${h.bleDisconnectReason??"?"} / ${h.notificationFailures??"?"}\nLocal diagnostics saved / dropped: ${h.savedDiagnosticRecords??"?"} / ${h.droppedDiagnosticRecords??"?"}`;
}
function gpsPacket(bytes){
 if(bytes.length!==20 || bytes[3]!==1)return;
 const u16=i=>bytes[i]|bytes[i+1]<<8,flags=bytes[4];gpsLastAt=Date.now();
 const row={time:new Date().toISOString(),traffic:!!(flags&1),receiverReportsFix:!!(flags&2),usableFix:!!(flags&4),source:flags&16?'bench':flags&8?'phone':'module',listed:bytes[5],heard:bytes[6],used:bytes[7],bestSignal:bytes[8],strongSignals:bytes[9],hdop:u16(10)/100,fixAgeSeconds:u16(12)===65535?null:u16(12)/10,uartOverflows:u16(14),badSentences:u16(16),goodSentences:u16(18)};
 pendingSample=row;if(gpsRecording){if(gpsRows.length<18000)gpsRows.push(row);else{gpsTruncated=true;pendingSample=null;}}
 $("gps-report").textContent=`${row.source==='module'?'ATGM336H':row.source+' position — not a module test'}\n${row.usableFix?'Usable fix':row.receiverReportsFix?'Fix reported; quality insufficient or stale':'Searching for a fix'}\nListed: ${row.listed} · Heard: ${row.heard} · Used: ${row.used}\nBest signal: ${row.bestSignal} dB-Hz\nHDOP: ${row.hdop||'unknown'} · Age: ${row.fixAgeSeconds===null?'no fix':row.fixAgeSeconds+' s'}\nUART overflow events: ${row.uartOverflows}\n${gpsRows.length} samples recorded${gpsTruncated?' — log limit reached':''}`;
}

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
  if (y === 0xFFFF) {if(bytes[2]===4){gpsPacket(bytes);return 0;}if(bytes[2]>=5 && bytes[2]<=16 && bytes.length===20){systemPacket(bytes);return 0;}return bytes[2];}
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

let device = null, input = null, wake = null, picture = null;
const PAGE_BUILD="20261125-smooth32";
let linkGeneration = 0, reconnecting = false, connecting=false, lastCode = "", lastPacketAt = 0;
let linkFailures=0,reconnectAttempts=0,wakeActive=false;
function linkNote(message){const el=$("link-health");if(el)el.textContent=message;}
function linkVersion(){const el=$("page-version");if(el)el.textContent=`Phone page ${PAGE_BUILD} · Firmware ${latestHealth.firmwareBuild||"not yet reported"}${latestHealth.assistanceDetailsExpected!==undefined && !latestHealth.connectionDetailsExpected?" · Older firmware: local log recovery and new link metrics require build32":""}`;}
function deadline(promise,ms){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Bluetooth operation timed out")),ms);})]).finally(()=>clearTimeout(timer));}

// Writes one at a time (Chrome refuses overlapping ones). A finger's newer
// position replaces one still waiting, so a drag can't fall behind.
let writing = false, queued = [], moveWaiting = null;
async function pump() {
  if (writing || !input) return;
  writing = true;
  const generation=linkGeneration, target=input;
  try {
    for (;;) {
      if(generation!==linkGeneration || target!==input)break;
      const next = queued.shift() || moveWaiting;
      if (!next) break;
      if (next === moveWaiting) moveWaiting = null;
      await deadline(target.writeValueWithoutResponse(next),5000);
    }
  } catch (e) { if(generation===linkGeneration){++linkFailures;queued=[];moveWaiting=null;linkNote("A Bluetooth write failed; recovering the connection.");if(device?.gatt.connected)device.gatt.disconnect();else onGone();} }
  if(generation===linkGeneration)writing = false;
}
function send(bytes) {
 if(bytes[0]===IN_PING || bytes[0]===6){queued=queued.filter(p=>p[0]!==bytes[0]);queued.unshift(bytes);}else queued.push(bytes);pump();
}
$("gps-start").addEventListener("click",()=>{
 if(!input){$("gps-report").textContent="Connect to your board first.";return;}
 if(!gpsRecording){gpsRows=[];gpsTruncated=false;}
 recordingStoppedByUser=false;gpsRecording=true;gpsLastAt=0;send(new Uint8Array([5,1]));
 $("gps-report").textContent="Waiting for GPS diagnostics. This needs the matching GPS walk firmware.";
});
$("gps-save").addEventListener("click",()=>{
 recordingStoppedByUser=true;gpsRecording=false;pendingSample=null;if(input)send(new Uint8Array([5,0]));
 const log={format:'signalbound-diagnostic-v2',mode:diagnosticMode?'diagnostic-check':'phone-play-gps',coordinatesIncluded:false,networkIdentifiersIncluded:false,countersSaturateAt:65535,truncated:gpsTruncated,notes:$("report-notes").value.slice(0,2000),phonePageBuild:PAGE_BUILD,linkFailures,reconnectAttempts,screenWakeLock:wakeActive,samples:gpsRows};
 const url=URL.createObjectURL(new Blob([JSON.stringify(log,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='signalbound-diagnostic-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
 $("gps-report").textContent=`Recording stopped. Saved ${gpsRows.length} samples.`;
});
setInterval(()=>{
 if(gpsRecording && (!gpsLastAt || Date.now()-gpsLastAt>7000))$("gps-report").textContent="No recent diagnostic data. Check the Bluetooth connection and matching firmware. This does not establish GPS signal loss.";
},5000);
window.addEventListener('beforeunload',ev=>{if(gpsRecording && gpsRows.length){ev.preventDefault();ev.returnValue='Save your GPS walk log before closing.';}});

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
  const active=which==="screen" || which==="diagnostic";
  $("play-shell").classList.toggle("hide",!active && !gpsRecording && !gpsRows.length);
  $("play-shell").classList.toggle("diagnostic-only",diagnosticMode);
  $("board-view").classList.toggle("hide",diagnosticMode);
  $("gps-tools").classList.toggle("hide",!active && !gpsRecording && !gpsRows.length);
  $("connect").classList.toggle("hide", which !== "connect");
  $("pair").classList.toggle("hide", which !== "pair");
  canvas.style.display = which === "screen" ? "block" : "none";
}

async function keepAwake() {
 try {
  if(!("wakeLock" in navigator)){wakeActive=false;linkNote("Screen wake lock unavailable. Local recording requires matching firmware and a writable SD card.");return;}
  if(wake && !wake.released){wakeActive=true;return;}
  wake=await navigator.wakeLock.request("screen");wakeActive=true;
  wake.addEventListener?.("release",()=>{wakeActive=false;linkNote("Phone screen wake lock released. Matching firmware can keep Diagnostic Check recording on the SD card.");});
  linkNote("Connected. Screen wake lock active; Matching firmware can also keep a local SD diagnostic log.");
 }catch(e){wakeActive=false;linkNote("Could not keep the phone screen awake. Diagnostic Check can continue recording on the board.");}
}
document.addEventListener("visibilitychange", () => {
 if(document.visibilityState!=="visible"){
  if(input){queued=queued.filter(p=>p[0]!==IN_TOUCH);fingerDown=false;moveWaiting=null;send(new Uint8Array([6,0]));}
  linkNote("Page hidden. Bluetooth may pause; matching firmware can continue Diagnostic Check on the SD card.");return;
 }
 if(input && device?.gatt.connected){
  send(new Uint8Array([6,1]));send(new Uint8Array([IN_PING]));keepAwake();
  send(new Uint8Array(diagnosticMode?[5,gpsRecording?1:0]:[IN_RESEND]));
 }else if(device && lastCode)recover();
});

function onPacket(ev) {
  lastPacketAt=Date.now();
  const v = ev.target.value;
  const bytes=new Uint8Array(v.buffer,v.byteOffset,v.byteLength),st = applyPacket(bytes);
  if (st === ST_OK) {
    diagnosticMode=bytes.length>=4 && bytes[3]===1;pendingSample=null;latestHealth={};
    $("diagnostic-title").textContent=diagnosticMode?'Diagnostic Check':'GPS walk diagnostics';
    $("gps-start").textContent=diagnosticMode?'START CHECK':'START WALK LOG';$("gps-save").textContent=diagnosticMode?'STOP AND SAVE REPORT':'STOP AND SAVE LOG';
    pixels.fill(0xff000000);dirtyTop=0;dirtyBottom=H-1;show(diagnosticMode?'diagnostic':'screen');send(new Uint8Array([6,document.visibilityState==="visible"?1:0]));keepAwake();
    if(diagnosticMode){$("gps-tools").open=true;if(!recordingStoppedByUser){if(!gpsRecording){gpsRows=[];gpsTruncated=false;}gpsRecording=true;send(new Uint8Array([5,1]));}else send(new Uint8Array([5,0]));}
    else if(wantDiagnostic){$("gps-tools").open=true;$("gps-report").textContent="The board is in Phone Link mode. Open Settings · Diagnostic Check on the Freenove, start it, then reconnect for a full report.";}
    else if(gpsRecording)send(new Uint8Array([5,1]));
  }
  else if (st === ST_BAD_CODE) { lastCode="";show("pair");$("err2").textContent = "That code didn't match. Check the board's screen."; $("code").value = ""; }
}

function clearLink() {
  linkGeneration++; input=null;writing=false;queued=[];moveWaiting=null;fingerDown=false;
  if(picture){picture.removeEventListener("characteristicvaluechanged",onPacket);picture=null;}
  if(wake){wake.release().catch(()=>{});wake=null;wakeActive=false;}
}
function onGone() {
  clearLink();show("connect");
  $("err1").textContent="Connection interrupted. Reconnecting to your board…";
  if(lastCode && document.visibilityState==="visible")recover();
  else $("err1").textContent="The board disconnected. Tap CONNECT to reconnect.";
}
async function attach(resume) {
 const selected=device,generation=linkGeneration;
 const current=()=>{if(generation!==linkGeneration || selected!==device)throw new Error("Superseded Bluetooth connection");};
 const server=await deadline(selected.gatt.connect(),12000);current();
 const service=await deadline(server.getPrimaryService(SERVICE),10000);current();
 const pic=await deadline(service.getCharacteristic(PICTURE),10000);current();
 const target=await deadline(service.getCharacteristic(INPUT_C),10000);current();
 await deadline(target.writeValueWithoutResponse(new Uint8Array([7])),5000);current();
 pic.addEventListener("characteristicvaluechanged",onPacket);
 try{await deadline(pic.startNotifications(),10000);current();}catch(e){pic.removeEventListener("characteristicvaluechanged",onPacket);throw e;}
 picture=pic;input=target;lastPacketAt=Date.now();
 if(resume && lastCode){$("code").value=lastCode;sendCode();}
 else {$("err2").textContent="";$("code").value="";show("pair");$("code").focus();}
}

async function recover() {
  if(reconnecting || connecting || !device || !lastCode || document.visibilityState!=="visible")return;
  reconnecting=true;
  try {
    for(let attempt=0;attempt<12;attempt++){
      ++reconnectAttempts;linkNote(`Reconnecting, attempt ${attempt+1}. Matching firmware can keep recording on the SD card.`);
      await new Promise(resolve=>setTimeout(resolve,1000*Math.min(30,2**attempt)));
      if(document.visibilityState!=="visible")break;
      try{clearLink();await attach(true);return;}catch(e){clearLink();if(device?.gatt.connected)device.gatt.disconnect();}
    }
    $("err1").textContent="Could not reconnect. Keep the board nearby and tap CONNECT.";
  }finally{reconnecting=false;}
}
async function connect(forceNew=false) {
  $("err1").textContent="";
  if(reconnecting || connecting)return;
  if(!navigator.bluetooth){$("err1").textContent="Open this page in Chrome on Android for Bluetooth phone play.";return;}
  connecting=true;
  try{
    if(forceNew){lastCode="";if(device){device.removeEventListener("gattserverdisconnected",onGone);if(device.gatt.connected)device.gatt.disconnect();}device=null;clearLink();}
    if(device){clearLink();await attach(!!lastCode);return;}
    // A new document has lost its JS BluetoothDevice, but Chrome still knows
    // the user's grant. Reuse it instead of requiring fresh advertisements.
    if(!forceNew && !device && navigator.bluetooth.getDevices){
      try{
        const granted=await navigator.bluetooth.getDevices();let remembered="";
        try{remembered=localStorage.getItem("sbPhoneBoard")||"";}catch(e){}
        const candidates=granted.filter(d=>d.name==="Signalbound");
        device=granted.find(d=>d.id===remembered)||(candidates.length===1?candidates[0]:null);
        if(device){device.addEventListener("gattserverdisconnected",onGone);clearLink();await attach(false);return;}
      }catch(e){clearLink();device=null;}
    }
    if(device)device.removeEventListener("gattserverdisconnected",onGone);
    device=await navigator.bluetooth.requestDevice({filters:[{services:[SERVICE]}]});
    device.addEventListener("gattserverdisconnected",onGone);
    try{localStorage.setItem("sbPhoneBoard",device.id);}catch(e){}
    clearLink();await attach(false);
  }catch(e){clearLink();if(e.name!=="NotFoundError")$("err1").textContent="Couldn't connect: "+e.message;}finally{connecting=false;if(!input && device && lastCode && document.visibilityState==="visible")recover();}
}
// A small heartbeat distinguishes a quiet screen from a stalled connection.
setInterval(()=>{
  if(document.visibilityState!=="visible" || (canvas.style.display!=="block" && !diagnosticMode) || !input)return;
  if(Date.now()-lastPacketAt>20000){if(device?.gatt.connected)device.gatt.disconnect();else onGone();return;}
  send(new Uint8Array([IN_PING]));
},5000);

function sendCode() {
  const code = $("code").value.trim();
  if (!/^\d{6}$/.test(code)) { $("err2").textContent = "The code is six digits."; return; }
  $("err2").textContent = "";
  lastCode=code;
  const msg = new Uint8Array(7);
  msg[0] = IN_CODE;
  for (let i = 0; i < 6; i++) msg[i + 1] = code.charCodeAt(i);
  send(msg);
}

$("go").addEventListener("click",()=>{wantDiagnostic=false;connect(false);});
$("diagnostic-connect").addEventListener("click",()=>{wantDiagnostic=true;connect(false);});
$("choose").addEventListener("click",()=>connect(true));
// Closing/reloading should release GATT immediately. The firmware heartbeat
// lease also frees it if Android kills the document without this callback.
globalThis.addEventListener?.("pagehide",()=>{
  lastCode="";if(device){device.removeEventListener("gattserverdisconnected",onGone);if(device.gatt.connected)device.gatt.disconnect();}clearLink();
});
$("send").addEventListener("click", sendCode);
$("code").addEventListener("keydown", ev => { if (ev.key === "Enter") sendCode(); });
requestAnimationFrame(paint);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

function boardCrc(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let b=0;b<8;++b)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function importBoardLog(text){
 if(text.length>6*1024*1024)throw new Error("Log exceeds the 6 MB import limit");
 const oldRecording=gpsRecording;gpsRecording=true;let loaded=0,skipped=0;const seen=new Set(gpsRows.filter(row=>row.boardBootId!==undefined).map(row=>row.boardBootId+":"+row.boardSequence));
 try{for(const line of text.split(/\r?\n/)){if(!line.trim())continue;let row;try{row=JSON.parse(line);}catch(e){++skipped;continue;}
  if(row.format!=="signalbound-board-diagnostic-v1" || !/^[0-9a-f]{520}$/.test(row.packets||"")){++skipped;continue;}
  const key=row.bootId+":"+row.sequence;
  const bytes=Uint8Array.from(row.packets.match(/../g),h=>parseInt(h,16));if(boardCrc(bytes)!==row.crc32){++skipped;continue;}if(seen.has(key))continue;seen.add(key);
  for(let i=0;i<13;++i)applyPacket(bytes.subarray(i*20,i*20+20));
  if(pendingSample){pendingSample.boardUptimeMs=row.ms;pendingSample.boardSequence=row.sequence;pendingSample.boardBootId=row.bootId;pendingSample.importedFromBoard=true;pendingSample.time=null;}
  ++loaded;
 }}finally{gpsRecording=oldRecording;pendingSample=null;}
 return {loaded,skipped};
}
$("board-log")?.addEventListener("change",async ev=>{try{const file=ev.target.files?.[0];if(!file)return;if(file.size>6*1024*1024)throw new Error("Log exceeds the 6 MB import limit");const result=importBoardLog(await file.text());$("gps-report").textContent=`Imported ${result.loaded} board samples; skipped ${result.skipped} incomplete or damaged rows. Use STOP AND SAVE REPORT to export.`;}catch(e){$("gps-report").textContent=e.message;}});
linkVersion();
