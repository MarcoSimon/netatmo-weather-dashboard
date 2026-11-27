// The charge loop, running as a script on the Shelly plug that powers the wall
// tablet. Uploaded by `npm run charge:deploy`; this file is the source
// of truth and is never edited on the plug.
//
// Once a minute it asks the kiosk browser for the battery level and switches
// the plug OFF when the level has reached the top of the band. It never
// switches the plug on: the plug's own auto_on timer does that, and so does
// its initial_state after a power cut (both set by the deploy). A dead script,
// an unreachable tablet or a crashed plug therefore all end with the tablet
// charging, never with it running flat. The bottom of the band follows from
// the timer's delay and the drain, not from this script.
//
// Shelly's script engine is a small JavaScript subset: no template literals,
// no arrow functions, no encodeURIComponent. Keep it plain. The kiosk
// browser's URL, password included, is URL-encoded by the deploy and read from
// the plug's key-value store, so no credential lives in this file.

let CHARGE = {
  // Switch off at or above this level, in percent.
  full: 75,
  // How often the level is read. Charging adds about a third of a point a
  // minute, so a minute overshoots the top by at most a point.
  everyMs: 60 * 1000,
  // The KVS key holding the kiosk browser's deviceInfo URL.
  urlKey: "charge_fully_url",
};

let fullyUrl = null;

// The one decision: the plug is on and the tablet reports a level at the top
// of the band or above. Anything the tablet reports that is not a number is no
// reason to act — the plug then stays on, which is the safe side.
function shouldSwitchOff(output, info) {
  if (output !== true || !info) return false;
  let level = info.batteryLevel;
  return typeof level === "number" && level >= CHARGE.full;
}

function switchOn() {
  let status = Shelly.getComponentStatus("switch:0");
  return status ? status.output : null;
}

function onDeviceInfo(result, errorCode, errorMessage) {
  if (errorCode !== 0 || !result || result.code !== 200) {
    print("charge: kiosk browser unreachable: " + (errorCode !== 0 ? errorMessage : result ? result.code : "no answer"));
    return;
  }
  let info = null;
  try {
    info = JSON.parse(result.body);
  } catch (e) {
    print("charge: kiosk browser answered no JSON");
    return;
  }
  // A wrong password is answered with 200 and this body, not with a 401.
  if (info && info.status === "Error") {
    print("charge: kiosk browser refused: " + info.statustext);
    return;
  }
  // Read the output again: it may have changed while the request was out.
  if (!shouldSwitchOff(switchOn(), info)) return;
  print("charge: level " + JSON.stringify(info.batteryLevel) + " %, switching off");
  Shelly.call("Switch.Set", { id: 0, on: false });
}

function check() {
  // Off already: nothing to decide, and no reason to wake the tablet's radio.
  if (fullyUrl === null || switchOn() !== true) return;
  Shelly.call("HTTP.GET", { url: fullyUrl, timeout: 10 }, onDeviceInfo);
}

Shelly.call("KVS.Get", { key: CHARGE.urlKey }, function (result, errorCode, errorMessage) {
  if (errorCode !== 0 || !result || typeof result.value !== "string") {
    // Without the URL the loop cannot read a level, so it never switches off.
    print("charge: no " + CHARGE.urlKey + " in KVS, loop idle: " + errorMessage);
    return;
  }
  fullyUrl = result.value;
  print("charge: running, off at " + JSON.stringify(CHARGE.full) + " %");
  check();
  Timer.set(CHARGE.everyMs, true, check);
});
