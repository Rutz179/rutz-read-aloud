import { HANGUL, setting, synth } from "./util.mjs";

/* ======================================================================== *
 * The voices: which ones are offered, and which one reads a line.
 *
 * Edge lists hundreds of voices in every language. The lists here show only
 * the ones that can read Korean (Korean voices and the "Multilingual" ones),
 * American and British English, and Japanese — the rest with the "all
 * languages" setting.
 *
 * Each character can have a voice and a pitch of its own (the voice window):
 *   mine     this computer's choices (setting cast)
 *   shared   the GM's, for everyone (setting castShared) — used where this
 *            computer has that voice and hasn't chosen one itself
 *   auto     (setting autoCast) a character nobody set gets a voice and a
 *            pitch of its own, always the same one for that character
 * A line with Korean in it is never given to a voice that can't read Korean.
 * ======================================================================== */

const SHOWN = ["ko", "en", "ja"];
const langOf = v => String(v?.lang ?? "").toLowerCase().replace("_", "-").slice(0, 2);
const multilingual = v => /multilingual/i.test(String(v?.name ?? ""));
export const natural = v => /natural|online|neural/i.test(String(v?.name ?? ""));
export const readsKorean = v => !!v && (langOf(v) === "ko" || multilingual(v));

// English: American and British only (Edge has a dozen more Englishes); Japanese: Japan.
const REGIONS = { en: ["us", "gb"], ja: ["jp"] };
const regionOf = v => String(v?.lang ?? "").toLowerCase().replace("_", "-").split("-")[1] ?? "";

/** The group a voice is listed under: "ko" · "multi" · "en" · "ja" · "other". */
export function groupOf(v) {
  if (multilingual(v) && langOf(v) !== "ko") return "multi";
  const l = langOf(v);
  if (!SHOWN.includes(l)) return "other";
  const r = REGIONS[l];
  return !r || !regionOf(v) || r.includes(regionOf(v)) ? l : "other";
}

/** The groups in list order: this game's language first. */
export function groupOrder() {
  const ui = (game.i18n?.lang || "ko").slice(0, 2);
  const first = SHOWN.includes(ui) ? [ui] : [];
  return [...first, "multi", ...SHOWN.filter(l => l !== ui), "other"];
}

/** The voices to offer: Korean-capable, English and Japanese (or all), natural ones first in each group. */
export function voiceList({ all = !!setting("allVoices", false) } = {}) {
  const list = synth()?.getVoices?.() ?? [];
  const order = groupOrder();
  return [...list]
    .filter(v => all || groupOf(v) !== "other")
    .sort((a, b) => order.indexOf(groupOf(a)) - order.indexOf(groupOf(b)) || natural(b) - natural(a) || a.name.localeCompare(b.name));
}

/** "SunHi ✦ · ko-KR": shorter than Edge's "Microsoft SunHi Online (Natural) - Korean (Korea)". */
export function voiceLabel(v) {
  const name = String(v.name).replace(/^Microsoft\s+/i, "").replace(/\s+Online\s*\((Natural|Neural)\)/i, "").replace(/\s+-\s+.*$/, "");
  return `${name}${natural(v) ? " ✦" : ""} · ${v.lang}`;
}

const byName = name => (name ? (synth()?.getVoices?.() ?? []).find(v => v.name === name) ?? null : null);

/** The voice chosen for everyone else (the window's first list), or the best one there is. */
export function defaultVoice() {
  return byName(setting("voice", "")) ?? voiceList({ all: false })[0] ?? (synth()?.getVoices?.() ?? [])[0] ?? null;
}

/**
 * A character's settings, field by field: this computer's over the GM's (a
 * pitch set here keeps the GM's voice). → { voice, pitch (null = not set), from: "mine" | "shared" | "" }
 */
export function castOf(key) {
  const mine = (setting("cast", {}) ?? {})[key] ?? {};
  const shared = (setting("castShared", {}) ?? {})[key] ?? {};
  const pitch = Number(mine.pitch ?? shared.pitch);
  return {
    voice: mine.voice || shared.voice || "",
    pitch: Number.isFinite(pitch) && pitch > 0 ? pitch : null,
    from: mine.voice ? "mine" : shared.voice ? "shared" : ""
  };
}

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const PITCHES = [1, 0.9, 1.1, 0.82, 1.18];

/** A voice of its own for a character nobody set (always the same one for that character). */
export function autoVoice(key) {
  const ui = (game.i18n?.lang || "ko").slice(0, 2);
  const pool = voiceList({ all: false }).filter(v => (ui === "ko" ? readsKorean(v) : langOf(v) === ui || multilingual(v)));
  if (!pool.length) return { voice: null, pitch: 1 };
  const h = hash(key);
  return { voice: pool[h % pool.length], pitch: PITCHES[(h >>> 8) % PITCHES.length] };
}

/** The voice and pitch that read this character's line. */
export function voiceFor(key, text = "") {
  const c = key ? castOf(key) : { voice: "", pitch: null, from: "" };
  let voice = byName(c.voice);
  let pitch = c.pitch ?? 1;
  // Nobody chose a voice: one of its own (setting), else the default. A chosen voice this computer lacks: the default.
  if (!c.voice && key && setting("autoCast", false)) { const a = autoVoice(key); voice = a.voice; pitch = c.pitch ?? a.pitch; }
  voice ??= defaultVoice();
  // Korean words for a voice that can't say them: the default voice, or any that can.
  if (HANGUL.test(text) && voice && !readsKorean(voice)) {
    const d = defaultVoice();
    voice = readsKorean(d) ? d : (synth()?.getVoices?.() ?? []).find(readsKorean) ?? voice;
  }
  return { voice, pitch: Math.max(0.5, Math.min(1.5, pitch)) };
}
