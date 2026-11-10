(async () => {
  const results = [];
  const wait = async (fn, ms = 20000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw Error("Art UI timed out"); await new Promise((r) => setTimeout(r, 50)); } };
  const check = (name, passed) => { results.push({ name, passed: !!passed }); if (!passed) throw Error(name); };
  const edit = (node, value) => { node.value = value; node.dispatchEvent(new Event("input", { bubbles: true })); node.dispatchEvent(new Event("change", { bubbles: true })); };
  try {
    await wait(() => $("#libraryInfo").textContent.includes("files"));
    $("#newProject").click(); await wait(() => $("#modal").open);
    $("#modalBody input").value = "Artwork check"; $("#modal").close("ok");
    await wait(() => project?.title === "Artwork check");
    document.querySelector('[data-tool="art"]').click();
    const rect = canvas.getBoundingClientRect();
    const capture = canvas.setPointerCapture; canvas.setPointerCapture = () => {};
    canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: rect.left + 250, clientY: rect.top + 250 }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 })); canvas.setPointerCapture = capture;
    document.querySelector('[data-tab="assets"]').click();
    edit($("#assetType"), "shape"); edit($("#assetSearch"), "game/assets/scenes/carrot/mainStreet");
    await wait(() => $("#assetList .asset"));
    await new Promise((r) => setTimeout(r, 400));
    const asset = $("#assetList .asset");
    check("Installed SWF shapes appear in the asset browser", !!asset && asset.textContent.includes("mainStreet"));
    [...asset.querySelectorAll("button")].find((b) => b.textContent === "Preview").click();
    await wait(() => $("#game").contentDocument?.querySelector("#status")?.textContent === "", 30000);
    const doc = $("#game").contentDocument, view = doc.querySelector("#view").getBoundingClientRect(), art = doc.querySelector("ruffle-player, #content canvas").getBoundingClientRect();
    check("SWF art preview is centered in its viewport", Math.abs(art.x + art.width / 2 - view.x - view.width / 2) < 2 && Math.abs(art.y + art.height / 2 - view.y - view.height / 2) < 2);
    doc.querySelector("#larger").click(); check("Preview zoom works", doc.querySelector("#zoom").textContent === "125%");
    doc.querySelector("#fit").click(); check("Fit restores centered preview", doc.querySelector("#zoom").textContent === "100%");
    await new Promise((r) => setTimeout(r, 500));
    await fetch("/__screenshot", { headers: { "X-Workshop-Token": window.workshopToken } });
    [...asset.querySelectorAll("button")].find((b) => b.textContent === "Use").click();
    await wait(() => selected?.asset && $("#playView").hidden, 30000);
    check("Use extracts a SWF symbol into the project's art", selected.asset.endsWith(".swf") && (await call("files", { project: project.id })).includes("assets/" + selected.asset));
    $("#save").click(); await wait(() => !dirty);
    check("Extracted art survives save and reopen", (await call("open", { id: project.id })).scenes[0].objects.some((o) => o.asset === selected.asset));
  } catch (e) { results.push({ name: "Artwork workflow", passed: false, detail: e.stack }); }
  await fetch("/__done", { method: "POST", headers: { "X-Workshop-Token": window.workshopToken }, body: JSON.stringify(results) });
})();
