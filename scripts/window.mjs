import { MID, esc, setting, synth, t } from "./util.mjs";
import { castOf, defaultVoice, groupOf, groupOrder, voiceFor, voiceLabel, voiceList } from "./voices.mjs";
import { isSpoken, speakerKey } from "./lines.mjs";
import { say, stop } from "./speech.mjs";

/*
 * The voice window: the default voice and speed, and each character's voice. Listed: the party's characters, everyone with a voice, the latest dozen who spoke in chat, and any actor dropped on it. Choices save on this computer at once.
 * The GM can make their choices everyone's default ("모두의 기본으로"); each computer keeps its own where it made one, and its own default where it lacks the GM's voice.
 */

const actorOfKey = key => (key?.startsWith("a:") ? game.actors?.get?.(key.slice(2)) ?? null : null);
const clone = o => structuredClone(o ?? {});

function castRows(extra) {
  const mine = setting("cast", {}) ?? {};
  const shared = setting("castShared", {}) ?? {};
  const out = new Map();
  const add = (key, name, img) => {
    if (!key || out.has(key)) return;
    const a = actorOfKey(key);
    out.set(key, { key, name: a?.name ?? name ?? key.slice(2), img: a?.img ?? img ?? "" });
  };
  for (const a of game.actors?.filter?.(a => a.type === "character" && a.hasPlayerOwner) ?? []) add(`a:${a.id}`, a.name, a.img);
  for (const [k, e] of [...Object.entries(shared), ...Object.entries(mine)]) add(k, e?.name);
  for (const e of extra) add(e.key, e.name, e.img);
  let n = 0;
  for (const m of [...(game.messages?.contents ?? [])].reverse()) {
    if (n >= 12) break;
    if (!isSpoken(m)) continue;
    const k = speakerKey(m);
    if (!k || out.has(k)) continue;
    add(k, m.speaker?.alias || (m.author ?? m.user)?.name);
    n++;
  }
  return [...out.values()];
}

function voiceOptions(selected, first = null) {
  const list = voiceList();
  const all = synth()?.getVoices?.() ?? [];
  // A voice chosen earlier that the list now leaves out still shows, so it isn't lost.
  const kept = selected && !list.some(v => v.name === selected) ? all.find(v => v.name === selected) : null;
  const groups = groupOrder().map(g => [g, list.filter(v => groupOf(v) === g)]).filter(([, l]) => l.length);
  const opt = v => `<option value="${esc(v.name)}" ${v.name === selected ? "selected" : ""}>${esc(voiceLabel(v))}</option>`;
  return (first !== null ? `<option value="">${esc(first)}</option>` : "")
    + (kept ? opt(kept) : "")
    + groups.map(([g, l]) => `<optgroup label="${esc(t(`Group.${g}`))}">${l.map(opt).join("")}</optgroup>`).join("");
}

class VoiceWindow extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "rra-voice",
    classes: ["rra-window"],
    window: { title: "RRA.Title", icon: "fa-solid fa-volume-high", resizable: true },
    position: { width: 600, height: "auto" }
  };

  extra = [];

  async _renderHTML() {
    const voices = voiceList();
    const rate = Number(setting("rate", 1.4));
    const mine = setting("cast", {}) ?? {};
    const auto = !!setting("autoCast", false);
    const rows = castRows(this.extra).map(r => {
      const c = castOf(r.key);
      const own = mine[r.key] ?? {};
      const first = c.from === "shared" && c.voice ? t("Cast.FromGm", { voice: voiceLabel((synth()?.getVoices?.() ?? []).find(v => v.name === c.voice) ?? { name: c.voice, lang: "?" }) })
        : auto ? t("Cast.Auto") : t("Cast.Default");
      const pitch = Number(own.pitch ?? c.pitch ?? 1);
      return `<div class="cast-row" data-key="${esc(r.key)}" data-name="${esc(r.name)}">
        ${r.img ? `<img src="${esc(r.img)}" alt="">` : `<span class="noimg"><i class="fa-solid fa-user"></i></span>`}
        <span class="nm" title="${esc(r.name)}">${esc(r.name)}</span>
        <select data-c="voice">${voiceOptions(own.voice ?? "", first)}</select>
        <label class="pitch" data-tooltip="${esc(t("Cast.Pitch"))}"><i class="fa-solid fa-wave-square"></i><input type="range" data-c="pitch" min="0.5" max="1.5" step="0.05" value="${pitch}"><output>${pitch.toFixed(2)}</output></label>
        <button type="button" data-act="cast-test" data-tooltip="${esc(t("Test"))}"><i class="fa-solid fa-play"></i></button>
        <button type="button" data-act="cast-clear" data-tooltip="${esc(t("Cast.Clear"))}"><i class="fa-solid fa-rotate-left"></i></button>
      </div>`;
    }).join("");
    return `<div class="rra">
      ${synth() ? "" : `<p class="hint warn">${esc(t("NoSpeech"))}</p>`}
      <p class="hint">${t("Hint")}</p>
      <label class="row"><input type="checkbox" name="on" ${setting("enabled", false) ? "checked" : ""}> <b>${esc(t("On"))}</b></label>
      <div class="two">
        <div><label class="f">${esc(t("Voice"))}</label>
          <select name="voice">${voices.length ? voiceOptions(defaultVoice()?.name ?? "") : `<option value="">${esc(t("NoVoices"))}</option>`}</select></div>
        <div><label class="f">${esc(t("Rate"))} <output name="rateOut">${rate.toFixed(1)}</output>×</label>
          <input type="range" name="rate" min="0.8" max="3" step="0.1" value="${rate}"></div>
      </div>
      <p class="hint">${t("VoiceHint")}</p>
      <label class="row small"><input type="checkbox" name="allVoices" ${setting("allVoices", false) ? "checked" : ""}> ${esc(t("Settings.allVoices.Name"))}</label>
      <div class="row"><input type="text" name="sample" value="${esc(t("Sample"))}"><button type="button" data-act="test"><i class="fa-solid fa-play"></i> ${esc(t("Test"))}</button><button type="button" data-act="stop" aria-label="${esc(t("Stop"))}"><i class="fa-solid fa-stop"></i></button></div>
      <h3><i class="fa-solid fa-masks-theater"></i> ${esc(t("Cast.Title"))}</h3>
      <p class="hint">${t("Cast.Hint")}</p>
      <label class="row small"><input type="checkbox" name="autoCast" ${auto ? "checked" : ""}> ${esc(t("Settings.autoCast.Name"))}</label>
      <div class="cast">${rows || `<p class="hint">${esc(t("Cast.None"))}</p>`}</div>
      <p class="hint drop"><i class="fa-solid fa-hand-pointer"></i> ${esc(t("Cast.Drop"))}</p>
      ${game.user?.isGM ? `<div class="row share"><button type="button" data-act="share"><i class="fa-solid fa-users"></i> ${esc(t("Cast.Share"))}</button><span class="hint">${esc(t("Cast.ShareHint"))}</span></div>` : ""}
      <p class="hint">${t("Keys")}</p>
    </div>`;
  }

  async _saveRow(row, patch) {
    const key = row.dataset.key;
    const cast = clone(setting("cast", {}));
    const e = { ...(cast[key] ?? {}), ...patch, name: row.dataset.name };
    if (!e.voice && (!e.pitch || Number(e.pitch) === 1)) delete cast[key];
    else cast[key] = e;
    await game.settings.set(MID, "cast", cast);
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    const rate = content.querySelector("[name=rate]");
    rate?.addEventListener("input", () => { content.querySelector("[name=rateOut]").textContent = Number(rate.value).toFixed(1); });
    rate?.addEventListener("change", () => game.settings.set(MID, "rate", Number(rate.value)));
    content.querySelector("[name=voice]")?.addEventListener("change", ev => game.settings.set(MID, "voice", ev.target.value));
    content.querySelector("[name=on]")?.addEventListener("change", ev => game.settings.set(MID, "enabled", ev.target.checked));
    for (const name of ["allVoices", "autoCast"]) {
      content.querySelector(`[name=${name}]`)?.addEventListener("change", async ev => { await game.settings.set(MID, name, ev.target.checked); this.render(); });
    }
    for (const row of content.querySelectorAll(".cast-row")) {
      row.querySelector("[data-c=voice]")?.addEventListener("change", ev => this._saveRow(row, { voice: ev.target.value }));
      const pitch = row.querySelector("[data-c=pitch]");
      pitch?.addEventListener("input", () => { row.querySelector("output").textContent = Number(pitch.value).toFixed(2); });
      pitch?.addEventListener("change", () => this._saveRow(row, { pitch: Number(pitch.value) }));
    }
    // The window's own listeners once: the same content element is drawn into again on every render.
    if (content.dataset.rraWired) return;
    content.dataset.rraWired = "1";
    content.addEventListener("click", async ev => {
      const b = ev.target.closest("button[data-act]");
      if (!b) return;
      const act = b.dataset.act;
      if (act === "stop") return stop();
      if (act === "test") {
        const rate = content.querySelector("[name=rate]");
        await game.settings.set(MID, "rate", Number(rate.value));
        return say(content.querySelector("[name=sample]").value, { now: true });
      }
      const row = b.closest(".cast-row");
      if (act === "cast-test" && row) {
        const line = t("Cast.Sample", { name: row.dataset.name });
        const { voice, pitch } = voiceFor(row.dataset.key, line);
        return say(line, { now: true, voice, pitch });
      }
      if (act === "cast-clear" && row) {
        const cast = clone(setting("cast", {}));
        delete cast[row.dataset.key];
        await game.settings.set(MID, "cast", cast);
        return this.render();
      }
      if (act === "share" && game.user?.isGM) {
        const cast = clone(setting("cast", {}));
        await game.settings.set(MID, "castShared", cast);
        return ui.notifications.info(t("Cast.Shared", { n: Object.keys(cast).length }));
      }
    });
    // An actor dropped on the window joins the list.
    content.addEventListener("dragover", ev => ev.preventDefault());
    content.addEventListener("drop", ev => {
      ev.preventDefault();
      let data = null;
      try { data = foundry.applications?.ux?.TextEditor?.implementation?.getDragEventData?.(ev) ?? JSON.parse(ev.dataTransfer?.getData("text/plain") || "null"); } catch (_) { /* not ours */ }
      if (data?.type !== "Actor") return;
      const actor = (data.uuid && globalThis.fromUuidSync?.(data.uuid)) || game.actors?.get?.(data.id);
      if (!actor?.id) return;
      this.extra.push({ key: `a:${actor.id}`, name: actor.name, img: actor.img });
      this.render();
    });
  }

  /** "sized" once the window has a height of its own (dragged): the character list then fills it instead of stopping at its cap. */
  setPosition(position) {
    const out = super.setPosition(position);
    this.element?.classList.toggle("sized", typeof this.position?.height === "number");
    return out;
  }
}

export function openVoiceWindow() {
  const open = foundry.applications.instances.get("rra-voice");
  if (open) { open.render(); open.bringToFront?.(); return open; }
  return new VoiceWindow().render({ force: true });
}

export class VoiceMenu extends foundry.applications.api.ApplicationV2 {
  render() { openVoiceWindow(); return this; }
}
