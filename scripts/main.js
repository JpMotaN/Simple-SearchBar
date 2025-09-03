// Simple Search Bar v0.3.7
// - Keybinding aparece em Configure Controls (registra em init/setup/ready, com guarda).
// - Fallback de atalho configurável (Module Settings) caso o Keybindings não funcione.
// - Resto: busca global, drag de token, nav por teclado, FAB opcional, janela redimensionável,
//          foco no item dentro da ficha, cache de index de compêndios.
// © Jotape - MIT

const MOD = "simple-searchbar";
const LOG = (...a)=>console.log(`[${MOD}]`, ...a);
const WARN = (...a)=>console.warn(`[${MOD}]`, ...a);

// ---------- Cache ----------
const __PACK_INDEX_CACHE = new Map();

// ---------- Settings ----------
Hooks.once("init", () => {
  game.settings.register(MOD, "includeContentDefault", {
    name: game.i18n.localize("D5ESB.Settings.IncludeContentN") || "Include content by default",
    hint: game.i18n.localize("D5ESB.Settings.IncludeContentH") || "When enabled, indexes descriptions and journal pages.",
    scope: "world", config: true, type: Boolean, default: true
  });

  game.settings.register(MOD, "fabPos", {
    name: game.i18n.localize("D5ESB.Settings.FabPosN") || "Floating button position",
    hint: game.i18n.localize("D5ESB.Settings.FabPosH") || "Position is remembered per client (drag the button to move).",
    scope: "client", config: false, type: Object, default: { top: 10, left: 56 }
  });

  game.settings.register(MOD, "showFab", {
    name: "Show floating button",
    hint: "If disabled, only the keyboard shortcut will open the search.",
    scope: "client", config: true, type: Boolean, default: true
  });

  game.settings.register(MOD, "windowState", {
    name: "Window/Layout",
    scope: "client", config: false, type: Object,
    default: { top: 80, left: 80, width: 420, height: 520 }
  });

  // Fallback (caso o Keybindings não apareça)
  game.settings.register(MOD, "enableHotkeyFallback", {
    name: "Enable Fallback Hotkey",
    hint: "Uses a global listener with the hotkey below if the Keybindings list is unavailable.",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(MOD, "customHotkey", {
    name: "Fallback Hotkey",
    hint: "Example: Ctrl+K, Cmd+K, Alt+Space, Shift+F.",
    scope: "client", config: true, type: String, default: "Ctrl+K"
  });

  registerKeybindingSafe("init");
});
Hooks.once("setup", () => registerKeybindingSafe("setup"));
Hooks.once("ready", () => {
  registerKeybindingSafe("ready");
  installFallbackHotkey();
  installFab();
});

// ---------- Keybindings helpers ----------
function registerKeybindingSafe(phase) {
  try {
    if (!game.keybindings?.register) {
      WARN(`Keybindings API not available at ${phase}`);
      return;
    }
    if (registerKeybindingSafe._done) return; // evita duplicar
    game.keybindings.register(MOD, "openSearch", {
      name: "Open Simple Search Bar",
      hint: "Open the search window and focus the input.",
      editable: [
        { key: "KeyK", modifiers: ["CONTROL"] }, // Ctrl+K
        { key: "KeyK", modifiers: ["META"] }     // Cmd+K (macOS)
      ],
      restricted: false,
      reserved: false,
      precedence: foundry?.CONST?.KEYBINDING_PRECEDENCE?.NORMAL ?? 0,
      onDown: () => { openSearch(); return true; }
    });
    registerKeybindingSafe._done = true;
    LOG(`Keybinding "openSearch" registered at ${phase}`);
  } catch (e) {
    WARN(`Keybinding registration failed at ${phase}`, e);
  }
}

// ---------- Fallback Hotkey ----------
let _fallbackInstalled = false;
function installFallbackHotkey() {
  if (_fallbackInstalled) return;
  if (!game.settings.get(MOD, "enableHotkeyFallback")) return;

  const parseHotkey = (s) => {
    const parts = String(s||"").split("+").map(p => p.trim().toLowerCase()).filter(Boolean);
    const want = { ctrl:false, meta:false, alt:false, shift:false, key:null };
    for (const p of parts) {
      if (["ctrl","control","ctl"].includes(p)) want.ctrl = true;
      else if (["cmd","meta","super"].includes(p)) want.meta = true;
      else if (["alt","option"].includes(p)) want.alt = true;
      else if (["shift"].includes(p)) want.shift = true;
      else if (/^f\d{1,2}$/.test(p)) want.key = p.toUpperCase();
      else if (p === "space" || p === "spacebar") want.key = " ";
      else want.key = p.length === 1 ? p : p; // enter, escape etc.
    }
    return want;
  };
  const match = (ev, want) => {
    if (want.ctrl  && !ev.ctrlKey)  return false;
    if (want.meta  && !ev.metaKey)  return false;
    if (want.alt   && !ev.altKey)   return false;
    if (want.shift && !ev.shiftKey) return false;
    const w = (want.key||"").toLowerCase();
    if (!w) return false;
    const k = (ev.key || "").toLowerCase();
    if (/^f\d{1,2}$/.test(w)) return ev.key?.toUpperCase?.() === w.toUpperCase();
    const map = { esc:"escape" };
    const wk = map[w] ?? w;
    return wk === (k === " " ? " " : k);
  };

  const handler = (ev) => {
    const want = parseHotkey(game.settings.get(MOD, "customHotkey"));
    if (match(ev, want)) {
      ev.preventDefault();
      openSearch();
    }
  };
  document.addEventListener("keydown", handler);
  _fallbackInstalled = true;
  LOG(`Fallback hotkey installed (${game.settings.get(MOD, "customHotkey")})`);
}

// ---------- App ----------
class SimpleSearchBar extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "d5e-searchbar",
      title: game.i18n.localize("D5ESB.Title"),
      template: `modules/${MOD}/templates/searchbar.html`,
      popOut: true,
      width: 420,
      height: 520,
      resizable: true,
      minimizable: true,
      classes: ["d5e-searchbar-app"]
    });
  }
  getData() {
    return {
      title: game.i18n.localize("D5ESB.Title"),
      placeholder: game.i18n.localize("D5ESB.Placeholder"),
      includeLabel: game.i18n.localize("D5ESB.IncludeContent"),
      includeDefault: game.settings.get(MOD, "includeContentDefault"),
      hint: game.i18n.localize("D5ESB.TypeMore")
    };
  }
  async render(force=false, options={}) {
    const saved = game.settings.get(MOD, "windowState") || {};
    options = { ...options, left: saved.left ?? 80, top: saved.top ?? 80, width: saved.width ?? 420, height: saved.height ?? 520 };
    return super.render(force, options);
  }
  activateListeners(html) {
    super.activateListeners(html);
    const input   = html.find("#d5e-sb-input");
    const include = html.find("#d5e-sb-include");
    const results = html.find("#d5e-sb-results");

    this._installPersistObservers();

    let sel = -1;
    const list = () => Array.from(results[0].querySelectorAll(".d5e-sb-item"));
    const select = (idx) => {
      const items = list();
      items.forEach((el,i)=>el.classList.toggle("is-selected", i===idx));
      sel = idx;
      if (items[idx]) items[idx].scrollIntoView({block:"nearest"});
    };

    input.on("keydown", (ev) => {
      if (ev.key === "ArrowDown") { ev.preventDefault(); select(Math.min(sel+1, list().length-1)); }
      if (ev.key === "ArrowUp")   { ev.preventDefault(); select(Math.max(sel-1, 0)); }
      if (ev.key === "Enter") {
        ev.preventDefault();
        const node = list()[sel] || list()[0];
        if (node) node.click();
      }
    });

    let t = null;
    input.on("input", () => { clearTimeout(t); t = setTimeout(()=> this.search(input.val().trim(), include.is(":checked")), 180); });
    include.on("change", () => this.search(input.val().trim(), include.is(":checked")));
  }
  _installPersistObservers() {
    const el = this.element?.[0];
    if (!el) return;
    const mo = new MutationObserver(() => {
      const { top, left, width, height } = this.position;
      game.settings.set(MOD, "windowState", { top, left, width, height });
    });
    mo.observe(el, { attributes: true, attributeFilter: ["style"] });
    this._posObserver = mo;
    const ro = new ResizeObserver(() => {
      const { top, left, width, height } = this.position;
      game.settings.set(MOD, "windowState", { top, left, width, height });
    });
    ro.observe(el);
    this._sizeObserver = ro;
  }
  async close(options) {
    try { const { top, left, width, height } = this.position;
      await game.settings.set(MOD, "windowState", { top, left, width, height });
    } catch(e){}
    this._posObserver?.disconnect(); this._sizeObserver?.disconnect();
    return super.close(options);
  }

  async search(q, includeContent) {
    const results = this.element.find("#d5e-sb-results");
    const i18n = game.i18n;
    results.empty();

    if (!q || q.length < 2) {
      results.append(`<div class="d5e-sb-hint">${i18n.localize("D5ESB.TypeMore")}</div>`);
      return;
    }

    const groups = { actorSpells: [], world: [], compendia: [] };
    const fields = ["name", "type"];
    if (includeContent) fields.push("text", "system.description", "system.details", "img");

    try {
      const ql = q.toLowerCase();
      // 1) itens nas fichas (default: spells; troque se quiser genérico)
      for (const actor of game.actors) {
        for (const item of actor.items) {
          if (item.type !== "spell") continue;
          const desc = getProperty(item, "system.description.value") || getProperty(item, "system.description") || "";
          const hay = `${item.name} ${desc}`.toLowerCase();
          if (hay.includes(ql)) {
            groups.actorSpells.push({
              kind: "actorItem", actorId: actor.id, actorType: actor.type || "Actor",
              itemId: item.id, name: item.name, actorName: actor.name, img: item.img, type: item.type
            });
          }
        }
      }

      // 2) mundo
      const pushWorld = (doc, src) => {
        groups.world.push({ kind: "worldDoc", uuid: doc.uuid, name: doc.name, type: doc.documentName?.toLowerCase?.() || src, img: doc.img || doc.texture?.src || "" });
      };
      const like = (s)=> (s||"").toLowerCase().includes(ql);
      for (const a of game.actors)  if (like(a.name)) pushWorld(a,"Actor");
      for (const i of game.items)   if (like(i.name)) pushWorld(i,"Item");
      for (const j of game.journal) if (like(j.name)) pushWorld(j,"JournalEntry");
      for (const t of game.tables)  if (like(t.name)) pushWorld(t,"RollTable");

      // 3) compêndios
      for (const pack of game.packs) {
        const t = pack.documentName;
        if (!["Actor","Item","JournalEntry","RollTable"].includes(t)) continue;
        let index = __PACK_INDEX_CACHE.get(pack.collection);
        if (!index) {
          index = await pack.getIndex({ fields });
          __PACK_INDEX_CACHE.set(pack.collection, index);
        }
        for (const e of index) {
          const haystack = (e.name + " " + (e.text || e["system.description"] || e["system.details"] || "")).toLowerCase();
          if (!haystack.includes(ql)) continue;
          groups.compendia.push({ kind: "packDoc", pack: pack.collection, _id: e._id, name: e.name, type: t.toLowerCase(), img: e.img||e.texture?.src||"" });
        }
      }

      // render
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
      const mkItem = (o, meta, actions=[]) => {
        const el = document.createElement("div");
        el.className = "d5e-sb-item";
        const label = (o.name||"").replace(re, m=>`<mark>${m}</mark>`);
        el.innerHTML = `
          <img class="thumb" src="${o.img||"icons/svg/d20-black.svg"}" alt="" />
          <div class="data">
            <span class="name">${label}</span>
            <span class="meta">${meta}</span>
          </div>
          <div class="actions">${actions.map(a=>`<button data-act="${a.act}">${a.label}</button>`).join("")}</div>
        `;
        return el;
      };

      const frag = document.createDocumentFragment();
      const addGroup = (titleKey, arr, builder) => {
        if (!arr.length) return;
        const h = document.createElement("div");
        h.className = "d5e-sb-group";
        h.innerHTML = `<div class="d5e-sb-group-title">${i18n.localize(titleKey)}</div>`;
        frag.append(h);
        for (const it of arr) frag.append(builder(it));
      };

      addGroup("D5ESB.Groups.ActorSpells", groups.actorSpells, (r) => {
        const actor = game.actors.get(r.actorId);
        const item  = actor?.items?.get(r.itemId);
        const canUse = !!(item && (typeof item.use === "function" || typeof item.roll === "function"));
        const meta = `${r.type} • ${r.actorName} (${r.actorType||"Actor"})`;
        const actions = [
          ...(canUse ? [{ act: "cast", label: i18n.localize("D5ESB.Cast") || "Cast" }] : []),
          { act: "open", label: i18n.localize("D5ESB.Open") || "Open" }
        ];
        const el = mkItem(r, meta, actions);
        el.addEventListener("click", (ev)=> { if (ev.target instanceof HTMLButtonElement) return; this.openActorItem(r, { focus: true }); });
        el.querySelectorAll("button").forEach(b => b.addEventListener("click", (ev)=>{
          ev.stopPropagation();
          const act = b.dataset.act;
          if (act==="cast") this.castActorItem(r);
          if (act==="open") this.openActorItem(r, { focus: true });
        }));
        return el;
      });

      addGroup("D5ESB.Groups.World", groups.world, (r) => {
        const el = mkItem(r, r.type, [{act:"open", label:i18n.localize("D5ESB.Open") || "Open"}]);
        el.addEventListener("click", ()=> this.openByUUID(r.uuid, q));
        el.querySelector("button").addEventListener("click", (ev)=>{ ev.stopPropagation(); this.openByUUID(r.uuid, q); });
        el.draggable = (r.type==="actor");
        if (el.draggable) {
          el.addEventListener("dragstart", ev => {
            ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Actor", uuid: r.uuid }));
          });
          el.title = i18n.localize("D5ESB.Drop") || "Drag to scene";
        }
        return el;
      });

      addGroup("D5ESB.Groups.Compendium", groups.compendia, (r) => {
        const el = mkItem(r, `${r.type} • ${r.pack}`, [{act:"open", label:i18n.localize("D5ESB.Open") || "Open"}]);
        el.addEventListener("click", ()=> this.openFromPack(r, q));
        el.querySelector("button").addEventListener("click", (ev)=>{ ev.stopPropagation(); this.openFromPack(r, q); });
        el.draggable = (r.type==="actor");
        if (el.draggable) {
          el.addEventListener("dragstart", async ev => {
            ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Actor", uuid: `Compendium.${r.pack}.${r._id}` }));
          });
          el.title = i18n.localize("D5ESB.Drop") || "Drag to scene";
        }
        return el;
      });

      if (!frag.childNodes.length) results.append(`<div class="d5e-sb-empty">${i18n.localize("D5ESB.NoResults")}</div>`);
      else results[0].appendChild(frag);

    } catch (err) {
      console.error(err);
      results.append(`<div class="d5e-sb-error">${i18n.localize("D5ESB.ErrSearch")}</div>`);
    }
  }

  async openActorItem(r, { focus=false } = {}) {
    const actor = game.actors.get(r.actorId);
    const item = actor?.items?.get(r.itemId);
    if (!item) return;
    await actor?.sheet?.render(true);
    if (!focus) return item?.sheet?.render(true);
    try {
      const el = actor.sheet?.element?.[0];
      if (!el) return item?.sheet?.render(true);
      const findItemNode = () => el.querySelector(`[data-item-id="${item.id}"]`);
      let node = findItemNode();
      if (!node) {
        const tryTabs = ["spellbook", "features", "inventory", "actions"];
        for (const tab of tryTabs) {
          const nav = el.querySelector(`[data-group="primary"] [data-tab="${tab}"]`);
          if (nav) nav.click();
          await new Promise(r => setTimeout(r, 30));
          node = findItemNode();
          if (node) break;
        }
      }
      if (node) {
        node.scrollIntoView({ block: "center" });
        node.classList.add("d5e-sb-flash");
        setTimeout(()=> node.classList.remove("d5e-sb-flash"), 700);
        return;
      }
      return item?.sheet?.render(true);
    } catch (e) { console.error(e); return item?.sheet?.render(true); }
  }
  async castActorItem(r) {
    const actor = game.actors.get(r.actorId);
    const item = actor?.items?.get(r.itemId);
    if (!item) return;
    try {
      if (typeof item.use === "function") return item.use();
      if (typeof item.roll === "function") return item.roll();
      ui.notifications?.warn("Item can't be used directly.");
    } catch (e) { console.error(e); ui.notifications?.error(game.i18n.localize("D5ESB.ErrOpen")); }
  }
  async openByUUID(uuid, q) {
    try {
      const doc = await fromUuid(uuid);
      if (doc instanceof JournalEntry && doc.pages?.size) {
        const ql = (q||"").toLowerCase();
        const pages = [...doc.pages.values()];
        const page = pages.find(p => String(p.text?.content||"").toLowerCase().includes(ql)) || pages[0];
        return doc.sheet?.render(true, { pageId: page?.id });
      }
      return doc?.sheet?.render(true);
    } catch (e) { console.error(e); ui.notifications?.error(game.i18n.localize("D5ESB.ErrOpen")); }
  }
  async openFromPack(r, q) {
    try {
      const doc = await game.packs.get(r.pack)?.getDocument(r._id);
      if (doc instanceof JournalEntry && doc.pages?.size) {
        const ql = (q||"").toLowerCase();
        const pages = [...doc.pages.values()];
        const page = pages.find(p => String(p.text?.content||"").toLowerCase().includes(ql)) || pages[0];
        return doc.sheet?.render(true, { pageId: page?.id });
      }
      return doc?.sheet?.render(true);
    } catch (e) { console.error(e); ui.notifications?.error(game.i18n.localize("D5ESB.ErrOpen")); }
  }
}

// ---------- Helpers ----------
function openSearch() {
  const app = new SimpleSearchBar();
  app.render(true);
  setTimeout(()=> document.querySelector("#d5e-sb-input")?.focus(), 50);
}

// ---------- FAB ----------
function installFab() {
  if (!game.settings.get(MOD, "showFab")) return;
  const btn = document.createElement("button");
  btn.className = "d5e-sb-fab d5e-top-left";
  btn.innerHTML = `<i class="fas fa-search"></i>`;
  document.body.append(btn);

  const pos = game.settings.get(MOD, "fabPos") || {top:10,left:56};
  btn.style.top = pos.top + "px"; btn.style.left = pos.left + "px";

  let drag = { active:false, x:0, y:0, offX:0, offY:0, id:null };
  let pending = null, rafId = null;
  const applyPos = () => { if (!pending) return; btn.style.left = `${Math.max(8, pending.x)}px`; btn.style.top = `${Math.max(8, pending.y)}px`; pending = null; rafId = null; };
  const onMove = (clientX, clientY) => { const nx = drag.offX + (clientX - drag.x); const ny = drag.offY + (clientY - drag.y);
    pending = { x:nx, y:ny }; if (!rafId) rafId = requestAnimationFrame(applyPos); };

  btn.addEventListener("pointerdown", (e)=>{ if (e.button!==0) return;
    drag.active = true; drag.x = e.clientX; drag.y = e.clientY;
    drag.offX = parseInt(btn.style.left||"56",10); drag.offY = parseInt(btn.style.top||"10",10);
    drag.id = e.pointerId; btn.setPointerCapture(drag.id); document.body.classList.add("d5e-sb-dragging"); });
  btn.addEventListener("pointermove", (e)=>{ if (!drag.active) return; onMove(e.clientX, e.clientY); });
  btn.addEventListener("pointerup", async ()=>{ if (!drag.active) return; drag.active=false; cancelAnimationFrame(rafId); applyPos();
    document.body.classList.remove("d5e-sb-dragging");
    await game.settings.set(MOD, "fabPos", { top: parseInt(btn.style.top,10), left: parseInt(btn.style.left,10) }); });
  btn.addEventListener("click", () => openSearch());
}
