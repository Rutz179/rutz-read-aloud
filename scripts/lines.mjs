import { HUD, MID, setting, t } from "./util.mjs";

/*
 * Which chat messages are read, and what is said: typed lines and emotes only. Rolls, system cards, (( OOC )) and // notes are skipped; Foundry codes ("@UUID[…]{Moonstone}" → "Moonstone", "@Check[…]", "[[/r …]]") never reach the voice; links are "link".
 * A line in a language the player's character doesn't know (Polyglot) is "words you don't understand".
 */

/* Polyglot: a line this player can't understand */

function polyglotUnknown(message) {
  const lang = String(message?.flags?.polyglot?.language ?? "");
  const pg = game.polyglot;
  if (!lang || !pg || !game.modules?.get?.("polyglot")?.active) return false;
  try {
    const isGM = !!game.user?.isGM;
    if (isGM && !pg.settings?.runifyGM) return false;
    if (message.polyglot_force) return false;
    if (pg._isTruespeech?.(lang)) return false;
    if (pg.isLanguageKnown?.(lang)) return false;
    return game.user?.character || isGM ? !pg.isLanguageUnderstood?.(lang) : true;
  } catch (err) {
    console.warn(`${MID} | Polyglot check failed`, err);
    return false;
  }
}

const NOTICE = /<(div|section|article|img|h[1-6])\b|<i\b[^>]*class="[^"]*\bfa-|<p\b[^>]*\bclass\s*=/i;
const CARD_MARKUP = /<(section|header|table|button|form)\b|class="[^"]*\b(chat-card|dice-roll|card-content|item-card|pkh-save-request)\b|data-pf2-check/i;

/** The plain words of a chat message's HTML, without Foundry's codes. */
export function spokenText(html) {
  const div = document.createElement("div");
  div.innerHTML = String(html ?? "");
  for (const el of div.querySelectorAll(".inline-roll, .dice-roll, .action-glyph, i[class*='fa-'], img")) el.remove();
  for (const br of div.querySelectorAll("br")) br.replaceWith(" ");
  for (const p of div.querySelectorAll("p, div, li")) p.append(" ");
  return (div.textContent ?? "")
    .replace(/@(UUID|Compendium|Embed)\[[^\]]*\]\{([^}]*)\}/g, "$2")       // a link with a label: the label
    .replace(/@(UUID|Compendium|Embed)\[([^\]]*)\]/g, (_, __, ref) => ref.split(".").pop())
    .replace(/@(Check|Damage|Template|Localize)\[[^\]]*\](\{([^}]*)\})?/g, "$3")
    .replace(/\[\[[^\]]*\]\](\{([^}]*)\})?/g, "$2")                        // [[/r 1d6]]: only a label
    .replace(/https?:\/\/\S+/g, ` ${t("Link")} `)
    .replace(/(^|\s)@ ?\S+/g, "$1")                                       // @expression keywords, @mentions
    .replace(/[*_~`#>|]+/g, " ")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Who is speaking, as a key for their voice: the actor ("a:<id>" — tokens of
 * one actor share it), else the name shown ("n:<alias>"), else the user.
 */
export function speakerKey(message) {
  const sp = message?.speaker ?? {};
  if (sp.actor) return `a:${sp.actor}`;
  const alias = String(sp.alias ?? "").trim();
  if (alias) return `n:${alias}`;
  const author = message?.author ?? message?.user;
  return author?.id ? `u:${author.id}` : "";
}

/** A card the game system posted (its flags or its own message type). */
function systemCard(message) {
  const flags = message.flags ?? {};
  const sys = String(globalThis.game?.system?.id ?? "").toLowerCase();
  if (sys === "pf2e") {
    const pf2e = flags.pf2e ?? {};
    return !!(pf2e.origin || pf2e.context || pf2e.casting || pf2e.strike || pf2e.appliedDamage);
  }
  if (sys === "coc7" && flags.CoC7?.load) return true;
  const d5 = sys === "dnd5e" ? flags.dnd5e ?? {} : {};
  if (d5.messageType || d5.roll || d5.item || d5.activity || d5.use) return true;   // dnd5e 5.x
  return !!message.type && message.type !== "base";                                 // dnd5e 6.x and others
}

/** Is this a line someone said? Typed talk, emotes, OOC and whispers; never rolls, spell / action / item cards, damage, anything with a flavor line (a typed line never has one), or a module's notice (<div class=…>) in style "other" (a plain whisper in that style is still read). */
export function isSpoken(message) {
  if (!message || message.rolls?.length || message.isRoll) return false;
  const flags = message.flags ?? {};
  if (flags[HUD]?.note || flags["rutz-discord-table"]?.note) return false;                                      // the HUD's shared notes
  if (systemCard(message)) return false;
  const html = String(message.content ?? "");
  if (CARD_MARKUP.test(html)) return false;
  if (String(message.flavor ?? "").trim()) return false;
  const OTHER = globalThis.CONST?.CHAT_MESSAGE_STYLES?.OTHER ?? 0;
  // (Foundry's own inline bits — a roll, a link — don't count: those can be typed.)
  if (Number(message.style ?? OTHER) === OTHER && NOTICE.test(html)) return false;
  return true;
}

/** What this message should sound like here: { key, speaker, text } or null. */
export function lineOf(message) {
  if (!message || message.visible === false || !isSpoken(message)) return null;
  const author = message.author ?? message.user;
  if (author?.id === game.user.id && !setting("own", false)) return null;
  const whisper = message.whisper ?? [];
  if (whisper.length && !setting("whispers", true)) return null;
  const speaker = String(message.speaker?.alias || author?.name || "").trim();
  const key = speakerKey(message);
  if (polyglotUnknown(message)) return { key, speaker, text: t("Unknown") };
  const text = spokenText(message.content);
  if (!text || /^\(\(|^\/\//.test(text)) return null;                    // (( OOC )) and // notes
  return { key, speaker, text };
}
