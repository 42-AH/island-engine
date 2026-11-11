(async () => {
  const info = await fetch("/preview.json").then((r) => r.json());
  let editRules = info.liveEdits || [];
  let inspectorReady = false;
  const invoke = (name, ...args) => window.gamePlayer?.ruffle().callExternalInterface(name, ...args);
  window.islandengineInspectorReady = () => {
    inspectorReady = true;
    setTimeout(() => invoke("islandengineEditRules", editRules), 0);
  };
  window.liveBridge = {
    error: info.inspectorError,
    get ready() { return inspectorReady && !!info.inspector; },
    snapshot: () => invoke("islandengineInspect"),
    edit: (room, path, values) => invoke("islandengineEdit", room, path, values),
    setRules: (rules) => { editRules = rules; return invoke("islandengineEditRules", rules); },
  };
  if (!info.first) throw Error("Build an island before playing it.");
  const width = info.version === "AS2" ? 1136 : 960;
  const height = info.version === "AS2" ? 673 : 640;
  const fit = () => {
    const s = Math.min(innerWidth / width, innerHeight / height),
      p = document.querySelector("#player");
    p.style.width = width + "px";
    p.style.height = height + "px";
    p.style.transform = `scale(${s})`;
    p.style.left = (innerWidth - width * s) / 2 + "px";
    p.style.top = (innerHeight - height * s) / 2 + "px";
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
})().catch((e) => (document.getElementById("state").textContent = e.message));
