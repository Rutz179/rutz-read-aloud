export const MID = "rutz-read-aloud";
export const HUD = "pf2e-kr-hud";

export const t = (key, data) => (data ? game.i18n.format(`RRA.${key}`, data) : game.i18n.localize(`RRA.${key}`));
export const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
export function setting(key, fallback = null) {
  try { return game.settings.get(MID, key); } catch (_) { return fallback; }
}
export const synth = () => globalThis.speechSynthesis ?? null;
export const HANGUL = /[가-힣ㄱ-ㆎ]/;
