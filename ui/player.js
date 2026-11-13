(async () => {
  const info = await fetch("/preview.json").then((r) => r.json());
  let editRules = info.liveEdits || [];
  let inspectorReady = false;
  let editorView = {zoom:1,x:0,y:0};
  let inspectorEpoch = crypto.randomUUID();
  const invoke = (name, ...args) => window.gamePlayer?.ruffle().callExternalInterface(name, ...args);
  window.islandengineInspectorReady = () => {
    inspectorReady = true;
    setTimeout(() => invoke("islandengineEditRules", editRules), 0);
  };
  window.liveBridge = {
    error: info.inspectorError,
    setPaused: (paused) => {
      const player=window.gamePlayer;
      player?.ruffle()[paused?'suspend':'resume']();
      // Inspect has its own Resume button. Keep Ruffle's paused overlay off the artwork.
      const cover=player?.shadowRoot?.querySelector('#play-button');
      if(paused&&cover)cover.style.display='none';
    },
    setView: (view) => { editorView={zoom:Math.max(.25,Math.min(4,Number(view.zoom)||1)),x:Number(view.x)||0,y:Number(view.y)||0};fit(); },
    get ready() { return inspectorReady && !!info.inspector; },
    snapshot: () => { const state=invoke("islandengineInspect"); return state ? {...state,epoch:inspectorEpoch} : state; },
    edit: (room, path, values, uid) => invoke("islandengineEdit", room, path, values, uid),
    setRules: (rules) => { editRules = rules; return invoke("islandengineEditRules", rules); },
  };
  if (!info.first) throw Error("Build an island before playing it.");
  // The build patches the AS3 Shell back to its original 960 x 640 viewport.
  const width = info.version === "AS2" ? 1136 : 960;
  const height = info.version === "AS2" ? 673 : 640;
  const fit = () => {
    const s = Math.min(innerWidth / width, innerHeight / height) * editorView.zoom,
      p = document.querySelector("#player");
    p.style.width = width + "px";
    p.style.height = height + "px";
    p.style.transform = `scale(${s})`;
    p.style.left = ((innerWidth - width * s) / 2 + editorView.x) + "px";
    p.style.top = ((innerHeight - height * s) / 2 + editorView.y) + "px";
  };
  addEventListener("resize", fit);
  fit();

  const saveKey = "islandengine-room-" + info.project;
  if (info.resume) {
    const saved = localStorage.getItem(saveKey);
    if (
      saved &&
      info.rooms?.includes(saved) &&
      /^[A-Za-z][A-Za-z0-9_]*$/.test(saved)
    ) {
      const prefix = info.first.split(".").slice(0, 3).join(".");
      info.first =
        prefix + "." + saved + "." + saved[0].toUpperCase() + saved.slice(1);
    }
  }
  window.islandengineReady = (room) => {
    document.getElementById("state").textContent = "";
    localStorage.setItem(saveKey, room);
  };
  if (info.version !== "AS2") {
    // AS3 islands open the classic inventory (inventory_shell.swf), which talks to
    // the AS3 game through these page functions. Calls back into the game wait a
    // tick so they never run inside the game's own ExternalInterface call.
    let charData = "";
    const later = (name, ...args) => setTimeout(() => invoke(name, ...args), 0);
    // The classic inventory shows Char.inventory[island]. Each AS3 card is listed
    // as "?set=..&id=..&", so the popup's "items/item<id>.swf" becomes a request
    // for items/item?set=..&id=..&.swf, answered with items/as3/as3card.swf. That
    // card then loads items/as3/spec/<set>/<id>.txt: a picture of the real AS3
    // card, rendered by the game, with click areas over its buttons.
    const cards = new Map(), waiting = new Map();
    const cardKey = (set, id) => set + "/" + id;
    const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    // The patched Shell sends "<width>x<height>:" and base64 ARGB pixels.
    const pixelsToPng = async (pixels) => {
      const size = /^(\d+)x(\d+):/.exec(pixels);
      if (!size) return null;
      const width = Number(size[1]), height = Number(size[2]);
      const argb = fromBase64(pixels.slice(size[0].length));
      if (!width || !height || argb.length < width * height * 4) return null;
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height * 4; i += 4) {
        rgba[i] = argb[i + 1];
        rgba[i + 1] = argb[i + 2];
        rgba[i + 2] = argb[i + 3];
        rgba[i + 3] = argb[i];
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").putImageData(new ImageData(rgba, width, height), 0, 0);
      const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
      return { png: new Uint8Array(await blob.arrayBuffer()), height };
    };
    window.onAS3CardRendered = (set, id, pixels, rects) => {
      const key = cardKey(set, id);
      pixelsToPng(String(pixels || ""))
        .catch(() => null)
        .then((image) => {
          if (image) cards.set(key, { ...image, rects: String(rects || "") });
          waiting.get(key)?.();
          waiting.delete(key);
        });
    };
    // Cards live in data/items/<set>/<id>.xml, where the set is the island's name.
    const renderCards = (set, ids) =>
      Promise.all(
        ids
          .filter((id) => !cards.has(cardKey(set, id)))
          .map(
            (id) =>
              new Promise((done) => {
                waiting.set(cardKey(set, id), done);
                setTimeout(done, 15000);
                invoke("AS3_RenderInventoryCard", set, id);
              }),
          ),
      );
    window.inventoryPrepareCharData = () => {
      setTimeout(async () => {
        let list = {};
        try {
          list = JSON.parse(invoke("islandengineInventory") || "{}") || {};
        } catch {}
        const set = String(list.set || ""), ids = (set && list.cards) || [];
        await renderCards(set, ids);
        let data = {};
        try {
          data = JSON.parse(invoke("AS3_GetCharData") || "{}") || {};
        } catch {}
        // Without a login the classic inventory ignores the character data.
        if (!data.login) data.login = "islandengine";
        data.inventory = Object.assign({}, data.inventory);
        if (list.island)
          data.inventory[list.island] = ids.map(
            (id) => "?set=" + encodeURIComponent(set) + "&id=" + encodeURIComponent(id) + "&",
          );
        charData = JSON.stringify(data);
        invoke("AS3_InventoryShellGo");
      }, 0);
      return true;
    };
    window.inventoryBridge = (kind, a) => {
      if (kind === "close") later("AS3_InventoryClose");
      else if (kind === "say") later("AS3_PlayerSay", String(a));
      else if (kind === "saveLook") later("AS3_ApplyAS2Look", String(a));
      else if (kind === "getCharData") {
        const i = Number(a) || 0;
        return charData.slice(i * 4000, (i + 1) * 4000);
      }
    };
    // A card button runs on the real AS3 card, which closes the inventory itself.
    window.inventoryCardAction = (set, id, button, _gender, value) => {
      later("AS3_InventoryCardAction", String(set), String(id), Number(button), String(value || ""));
      return "stay";
    };
    const cardSpec = (set, id) => {
      const card = cards.get(cardKey(set, id));
      if (!card) return "ok=0";
      const height = card.height;
      const spec = {
        ok: 1,
        a_n: 1,
        a0_id: "cardBack",
        a0_u: "/islandengine-card/" + encodeURIComponent(set) + "/" + encodeURIComponent(id) + ".png",
      };
      // Transparent click areas over the buttons already drawn in the picture. The
      // card is centred on its origin and a button is placed by its top edge.
      const rects = card.rects.split(";").filter(Boolean).map((r) => {
        const [index, box] = r.split(":");
        const [, y] = box.split(",").map(Number);
        return { index: Number(index), y: y - height / 2 };
      });
      spec.b_n = rects.length ? Math.max(...rects.map((r) => r.index)) + 1 : 0;
      for (let i = 0; i < spec.b_n; i++) {
        const r = rects.find((r) => r.index === i);
        if (!r) spec["b" + i + "_hide"] = 1;
        else {
          spec["b" + i + "_y"] = Math.round(r.y) || 1;
          spec["b" + i + "_f"] = "cm:1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0";
        }
      }
      return Object.entries(spec)
        .map(([k, v]) => k + "=" + encodeURIComponent(v))
        .join("&");
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      const at = url.pathname.replace(/^\/game\//, "/");
      let m;
      if (at === "/items/item" && url.searchParams.has("set")) {
        const swf = await realFetch("/items/as3/as3card.swf");
        const response = new Response(await swf.arrayBuffer(), {
          status: swf.status,
          headers: { "Content-Type": "application/x-shockwave-flash" },
        });
        // Ruffle names the movie after response.url; the card reads set and id from it.
        Object.defineProperty(response, "url", { value: url.href });
        return response;
      }
      if ((m = /^\/items\/as3\/spec\/([^/]+)\/(.+)\.txt$/.exec(at)))
        return new Response(cardSpec(decodeURIComponent(m[1]), decodeURIComponent(m[2])), {
          headers: { "Content-Type": "text/plain" },
        });
      if ((m = /^\/islandengine-card\/([^/]+)\/(.+)\.png$/.exec(at))) {
        const card = cards.get(cardKey(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
        return card
          ? new Response(card.png, { headers: { "Content-Type": "image/png" } })
          : new Response("", { status: 404 });
      }
      return realFetch(input, init);
    };
  }
  window.webUseLowMemoryRendering = () => false;
  window.webOnlineConfig = () => ({ accountId: null, csrf: "" });
  window.webRequestSave = () => {};
  window.webOpenPanel = () => {};
  window.RufflePlayer = {
    config: {
      publicPath: "/ruffle/",
      autoplay: "on",
      unmuteOverlay: "visible",
      allowScriptAccess: true,
      quality: "high",
      preferredRenderer: "wgpu-webgl",
      openUrlMode: "deny",
      socketProxy: [],
      urlRewriteRules: [[/^https?:\/\/[^/]+\/(.*)$/, location.origin + "/$1"]],
    },
  };
  const script = document.createElement("script");
  script.src = "/ruffle/ruffle.js";
  document.head.append(script);
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
  });
  if (info.version === "AS2") {
    const { editBridgeSaves } = await import("/legacy-sol.mjs");
    let current;
    const load = async (room, island) => {
      if (
        !/^[A-Za-z][A-Za-z0-9_]*$/.test(room) ||
        island !== info.legacyIsland
      ) {
        document.getElementById("state").textContent =
          "This exit points outside the current island.";
        return false;
      }
      inspectorReady = false;
      inspectorEpoch = crypto.randomUUID();
      if (current) current.remove();
      editBridgeSaves(
        localStorage,
        location.hostname,
        ["Char", "TransitToken", "Backup"],
        (documents) => {
          const character = documents.Char || (documents.Char = {});
          const defaults = {
            gender: 1,
            skinColor: 16764006,
            hairColor: 6697728,
            lineColor: 13408512,
            eyelidsPos: -60,
            eyesFrame: 1,
            lineWidth: 4,
            firstName: "Quiet",
            lastName: "Fox",
            userData: { specialAbilities: [] },
          };
          for (const part of [
            "pants",
            "shirt",
            "hair",
            "mouth",
            "marks",
            "item",
            "pack",
            "facial",
            "overshirt",
            "overpants",
          ])
            defaults[part + "Frame"] = "1";
          for (const key of Object.keys(defaults))
            if (character[key] === undefined || character[key] === null)
              character[key] = defaults[key];
        },
      );
      const player = window.RufflePlayer.newest().createPlayer();
      current = player;
      document.getElementById("player").append(player);
      window.gamePlayer = player;
      await player.ruffle().load({
        url: "/framework.swf",
        base: "/",
        allowScriptAccess: true,
        parameters: {
          desc: room,
          island,
          startup_path: "gameplay",
          state: "return_user_standard",
        },
      });
      document.getElementById("state").textContent = "";
      parent.postMessage({type:"islandengine-player-ready"},location.origin);
      return true;
    };
    window.POSTToBase = (room, island) => {
      load(room, island).catch(
        (e) => (document.getElementById("state").textContent = e.message),
      );
      return true;
    };
    window.dbug = () => {};
    for (const name of [
      "showWrapper",
      "hideWrapper",
      "unhideWrapper",
      "clearWrapper",
      "refreshWrapper",
      "sendTrackingPixels",
      "GATrackEvent",
      "GATrackPageView",
      "loadTrackingPixel",
    ])
      window[name] = () => {};
    window.cookieGetCookie = () => "";
    window.cookieSetCookie = () => {};
    await load(info.first, info.legacyIsland);
    return;
  }
  const player = window.RufflePlayer.newest().createPlayer();
  document.getElementById("player").append(player);
  window.gamePlayer = player;
  await player.ruffle().load({
    url: "/game/ShellLoader.swf",
    base: "/game/",
    parameters: {
      shellURL: location.origin + "/game/Shell.swf?overrideScene=" + info.first,
    },
    allowScriptAccess: true,
  });
  document.getElementById("state").textContent = "";
  parent.postMessage({type:"islandengine-player-ready"},location.origin);
})().catch((e) => {
  document.getElementById("state").textContent = e.message;
  parent.postMessage({type:"islandengine-player-error",message:e.message},location.origin);
});
