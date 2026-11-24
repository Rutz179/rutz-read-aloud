/* ======================================================================== *
 * Rutz's Read Aloud — chat read aloud, for a player who'd rather hear the
 * table than read it. Any game system.
 *
 * Each person turns it on for themselves (client settings): the lines are
 * spoken on that computer only, by the browser's own speech (Web Speech API —
 * Windows' voices in the Foundry app; Edge adds its natural "Online" voices).
 * Nobody else hears it, nothing goes through Discord.
 *
 *   lines.mjs    which messages are read, and what is said (typed lines only;
 *                the same line again within 15 s is said once)
 *   voices.mjs   the voices offered, and each character's voice, speed and pitch
 *   speech.mjs   speaking one line after another
 *   window.mjs   the voice window
 * Keys: stop · say the last line again · on/off.
 *
 * This used to be part of Rutz's PF2e HUD ("채팅 읽어 주기"); the choices made
 * there come along the first time (migrate()).
 * ======================================================================== */

import { HUD, MID, setting, synth, t } from "./util.mjs";
import { lineOf } from "./lines.mjs";
import { voiceFor } from "./voices.mjs";
import { say, stop } from "./speech.mjs";
import { VoiceMenu, openVoiceWindow } from "./window.mjs";

let lastSpeaker = null;
let lastLine = null;

function speakLine(line, { now = false } = {}) {
  const mode = setting("speaker", "change");
  const name = line.speaker && (mode === "always" || (mode === "change" && line.speaker !== lastSpeaker)) ? `${line.speaker}, ` : "";
  lastSpeaker = line.speaker;
  lastLine = line;
  const { voice, speed, pitch } = voiceFor(line.key, line.text);
  say(`${name}${line.text}`, { now, voice, speed, pitch });
}

/* The same words from the same speaker again within a few seconds (a macro or two modules posting the same): once. */
const heard = new Map();
const AGAIN_MS = 15000;
function repeated(line) {
  const now = Date.now();
  const sig = `${line.key}|${line.text}`;
  const was = heard.get(sig);
  heard.set(sig, now);
  if (heard.size > 300) for (const [k, at] of heard) if (now - at > AGAIN_MS) heard.delete(k);
  return was !== undefined && now - was < AGAIN_MS;
}

function onChat(message) {
  if (!setting("enabled", false)) return;
  const line = lineOf(message);
  if (line && !repeated(line)) speakLine(line);
}

/* ---------------- settings and keys ---------------- */

function registerSettings() {
  const s = (key, data) => game.settings.register(MID, key, { scope: "client", config: true, name: `RRA.Settings.${key}.Name`, hint: `RRA.Settings.${key}.Hint`, ...data });
  const redraw = () => foundry.applications.instances.get("rra-voice")?.render();
  // On/off: kept for the player (not this browser), so it stays as they left it on any computer and
  // after the browser's data is cleared. It, the speed, the voice list and auto voices are in the
  // window (the button below); Configure Settings keeps only what the window doesn't have.
  s("enabled", { type: Boolean, default: false, scope: "user", config: false, onChange: on => { if (!on) stop(); } });
  s("rate", { type: Number, default: 1.4, range: { min: 0.8, max: 3, step: 0.1 }, config: false });
  s("volume", { type: Number, default: 1, range: { min: 0, max: 1, step: 0.05 } });
  s("speaker", { type: String, default: "change", choices: { change: "RRA.Settings.speaker.Choices.change", always: "RRA.Settings.speaker.Choices.always", never: "RRA.Settings.speaker.Choices.never" } });
  s("whispers", { type: Boolean, default: true });
  s("own", { type: Boolean, default: false });
  s("catchUp", { type: Boolean, default: true });
  s("allVoices", { type: Boolean, default: false, onChange: redraw, config: false });
  s("autoCast", { type: Boolean, default: false, onChange: redraw, config: false });
  game.settings.register(MID, "voice", { scope: "client", config: false, type: String, default: "" });
  // Each character's voice, speed and pitch: this computer's, and the GM's for everyone (voices.mjs).
  game.settings.register(MID, "cast", { scope: "client", config: false, type: Object, default: {} });
  game.settings.register(MID, "castShared", { scope: "world", config: false, type: Object, default: {}, onChange: redraw });
  game.settings.registerMenu(MID, "voiceMenu", {
    name: "RRA.Title", label: "RRA.Open", hint: "RRA.MenuHint", icon: "fa-solid fa-volume-high", type: VoiceMenu, restricted: false
  });
  const key = (name, code, onDown) => game.keybindings.register(MID, name, {
    name: `RRA.Bind.${name}`, editable: [{ key: code, modifiers: ["Alt"] }], onDown, precedence: CONST.KEYBINDING_PRECEDENCE?.NORMAL
  });
  key("stop", "KeyS", () => { if (!setting("enabled", false)) return false; stop(); return true; });
  key("repeat", "KeyR", () => {
    if (!setting("enabled", false) || !lastLine) return false;
    lastSpeaker = null;                          // say who it was again
    speakLine(lastLine, { now: true });
    return true;
  });
  key("toggle", "KeyT", () => {
    const on = !setting("enabled", false);
    game.settings.set(MID, "enabled", on);
    ui.notifications.info(t(on ? "TurnedOn" : "TurnedOff"));
    return true;
  });
}

/*
 * From Rutz's PF2e HUD: its "채팅 읽어 주기" choices on this computer (client
 * settings live in this browser's storage) come along once. An older HUD that
 * still reads chat aloud is told to stop, so a line isn't spoken twice.
 */
const OLD = { ttsEnabled: "enabled", ttsRate: "rate", ttsVolume: "volume", ttsSpeaker: "speaker", ttsWhispers: "whispers", ttsOwn: "own", ttsCatchUp: "catchUp", ttsVoice: "voice" };
async function migrate() {
  let store = null;
  try { store = globalThis.localStorage; } catch (_) { /* private window */ }
  if (store && !store.getItem(`${MID}.migrated`)) {
    for (const [from, to] of Object.entries(OLD)) {
      const raw = store.getItem(`${HUD}.${from}`);
      if (raw === null || store.getItem(`${MID}.${to}`) !== null) continue;
      let value;
      try { value = JSON.parse(raw); } catch (_) { value = raw; }
      try { await game.settings.set(MID, to, value); } catch (err) { console.warn(`${MID} | could not bring over ${from}`, err); }
    }
    try { store.setItem(`${MID}.migrated`, "1"); } catch (_) { /* fine */ }
  }
  // The on/off switch was this browser's before: carried over to the player once.
  if (store && !store.getItem(`${MID}.enabledToUser`)) {
    const raw = store.getItem(`${MID}.enabled`);
    if (raw !== null) {
      let on = false;
      try { on = JSON.parse(raw) === true; } catch (_) { on = raw === "true"; }
      try { if (on) await game.settings.set(MID, "enabled", true); } catch (err) { console.warn(`${MID} | on/off carry-over`, err); }
    }
    try { store.setItem(`${MID}.enabledToUser`, "1"); } catch (_) { /* fine */ }
  }
  if (game.pf2eKrHud?.tts) {
    try { if (game.settings.get(HUD, "ttsEnabled")) await game.settings.set(HUD, "ttsEnabled", false); } catch (_) { /* that HUD has no reading */ }
  }
}

Hooks.once("init", registerSettings);
Hooks.once("ready", async () => {
  // The voice list comes in a moment after the page loads.
  try { synth()?.getVoices?.(); if (synth()) synth().onvoiceschanged = () => foundry.applications.instances.get("rra-voice")?.render(); } catch (_) { /* no speech here */ }
  await migrate();
  Hooks.on("createChatMessage", onChat);
  game.rutzReadAloud = { say, stop, open: openVoiceWindow, lineOf, voiceFor };
});
