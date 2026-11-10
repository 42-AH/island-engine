(async () => {
  const query = new URLSearchParams(location.search),
    path = query.get("path"),
    symbol = query.get("symbol");
  if (!path) throw Error("Choose an asset first.");
  document.querySelector("#name").textContent =
    path + (symbol ? " · symbol " + symbol : "");
  const box = document.querySelector("#content"),
    view = document.querySelector("#view");
  let zoom = 1,
    pan = { x: 0, y: 0 },
    drag;
  const place = () => {
    box.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${zoom})`;
    document.querySelector("#zoom").textContent = Math.round(zoom * 100) + "%";
  };
  document.querySelector("#smaller").onclick = () => {
    zoom = Math.max(0.1, zoom / 1.25);
    place();
  };
  document.querySelector("#larger").onclick = () => {
    zoom = Math.min(10, zoom * 1.25);
    place();
  };
  document.querySelector("#fit").onclick = () => {
    zoom = 1;
    pan = { x: 0, y: 0 };
    place();
  };
  view.onpointerdown = (e) => {
    if (e.button !== 1 && !e.altKey) return;
    drag = { x: e.clientX, y: e.clientY, pan: { ...pan } };
    view.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  view.onpointermove = (e) => {
    if (drag) {
      pan = {
        x: drag.pan.x + e.clientX - drag.x,
        y: drag.pan.y + e.clientY - drag.y,
      };
      place();
    }
  };
  view.onpointerup = () => (drag = null);
  const isSwf = path.toLowerCase().endsWith(".swf");
  const url = isSwf
    ? "/art-preview?path=" +
      encodeURIComponent(path) +
      (symbol ? "&symbol=" + symbol : "")
    : "/library/" + path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(url);
  if (!response.ok) throw Error(await response.text());
  const type = response.headers.get("content-type") || "";
  const blob = await response.blob(),
    local = URL.createObjectURL(blob);
  if (type.startsWith("image/")) {
    const img = new Image();
    img.src = local;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    if (canvas.width * canvas.height <= 16000000) {
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let left = canvas.width,
        top = canvas.height,
        right = -1,
        bottom = -1;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++)
          if (pixels[(y * canvas.width + x) * 4 + 3] > 0) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
      if (right >= left) {
        const crop = ctx.getImageData(
          left,
          top,
          right - left + 1,
          bottom - top + 1,
        );
        canvas.width = crop.width;
        canvas.height = crop.height;
        ctx.putImageData(crop, 0, 0);
      }
    }
    box.append(canvas);
  } else if (type.startsWith("audio/")) {
    const audio = new Audio(local);
    audio.controls = true;
    box.append(audio);
  } else if (isSwf) {
    window.RufflePlayer = {
      config: {
        publicPath: "/ruffle/",
        autoplay: "on",
        allowScriptAccess: false,
        openUrlMode: "deny",
        scale: "showAll",
        salign: "",
        wmode: "transparent",
      },
    };
    const script = document.createElement("script");
    script.src = "/ruffle/ruffle.js";
    const loaded = new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(Error("Could not load the SWF player."));
    });
    document.head.append(script);
    await loaded;
    const player = window.RufflePlayer.newest().createPlayer();
    box.append(player);
    await player.ruffle().load({ url: local, allowScriptAccess: false });
  } else {
    const pre = document.createElement("pre");
    pre.textContent = await blob.text();
    box.append(pre);
  }
  document.querySelector("#status").textContent = "";
})().catch((error) => {
  document.querySelector("#status").textContent = error.message;
});
