import { setting, synth, t } from "./util.mjs";
import { defaultVoice } from "./voices.mjs";

/* ======================================================================== *
 * Speaking: one line after another, each in its own voice, speed and pitch.
 * Falling behind (a fast scene): the next lines are read faster (setting),
 * and far behind the oldest waiting ones are dropped.
 * ======================================================================== */

const queue = [];
let speaking = false;

/** Long lines in pieces (some browsers stop a long utterance after ~15 s). */
function pieces(text) {
  const out = [];
  let rest = text;
  while (rest.length > 180) {
    const cut = Math.max(rest.lastIndexOf(". ", 180), rest.lastIndexOf("? ", 180), rest.lastIndexOf("! ", 180), rest.lastIndexOf(", ", 180), rest.lastIndexOf(" ", 180));
    const at = cut > 60 ? cut + 1 : 180;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function sayNext() {
  const s = synth();
  if (!s || !queue.length) { speaking = false; return; }
  speaking = true;
  const item = queue.shift();
  const u = new SpeechSynthesisUtterance(item.text);
  const v = item.voice ?? defaultVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = game.i18n.lang === "ko" ? "ko-KR" : "en-US";
  let rate = (Number(setting("rate", 1.4)) || 1.4) * (Number(item.speed) || 1);
  if (setting("catchUp", true) && queue.length >= 2) rate *= Math.min(1.5, 1 + queue.length * 0.1);
  // A voice spoken by a server says nothing at all above 2× (Chrome); keep under it there.
  u.rate = Math.max(0.5, Math.min(v && v.localService === false ? 2 : 4, rate));
  u.pitch = Math.max(0.1, Math.min(2, Number(item.pitch) || 1));
  const vol = Number(setting("volume", 1));
  u.volume = Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 1;
  u.onend = () => sayNext();
  u.onerror = e => {
    // Just after the page loads the browser lets nothing speak until the page is clicked once.
    if (e?.error === "not-allowed") { queue.unshift(item); speaking = false; return waitForClick(); }
    sayNext();
  };
  s.speak(u);
}

/* The browser blocked speech (no click on the page yet): say so once, go on at the first click or key. */
let waiting = false;
function waitForClick() {
  if (waiting) return;
  waiting = true;
  ui.notifications?.info(t("NeedClick"));
  const go = () => {
    waiting = false;
    window.removeEventListener("pointerdown", go, true);
    window.removeEventListener("keydown", go, true);
    if (!speaking) sayNext();
  };
  window.addEventListener("pointerdown", go, true);
  window.addEventListener("keydown", go, true);
}

/** Put words in line to be spoken: { now } clears what waits; { voice, speed, pitch } for this line. */
export function say(text, { now = false, voice = null, speed = 1, pitch = 1 } = {}) {
  if (!text || !synth()) return;
  if (now) { queue.length = 0; synth().cancel(); speaking = false; }
  for (const p of pieces(text)) queue.push({ text: p, voice, speed, pitch });
  while (queue.length > 12) queue.shift();
  if (!speaking) sayNext();
}

export function stop() {
  queue.length = 0;
  speaking = false;
  synth()?.cancel();
}
