(async () => {
  const results = [];
  const wait = async (fn) => {
    let end = Date.now() + 5000;
    while (!fn()) {
      if (Date.now() > end) throw Error("UI timed out");
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const check = (name, passed) => {
    results.push({ name, passed });
    if (!passed) throw Error(name);
  };
  try {
    await wait(() => $("#libraryInfo").textContent.includes("files"));
    check(
      "Empty app shows a clickable New island button",
      !project &&
        !$("#empty").hidden &&
        getComputedStyle($("#empty")).pointerEvents !== "none" &&
        $("#startIsland").getBoundingClientRect().width > 0,
    );
    const create = async () => {
      $("#newProject").click();
      await wait(() => $("#modal").open);
      check(
        "The folder ID is assigned automatically",
        $("#modalBody").querySelectorAll("input").length === 1,
      );
      $("#modalBody input").value = "My first island";
      $("#modal").close("ok");
    };
    $("#startIsland").click();
    await wait(() => $("#modal").open);
    $("#modalBody input").value = "My first island";
    $("#modal").close("ok");
    await wait(() => project?.id === "Myfirstisland");
    check(
      "New island opens with ground and a spawn point",
      room.objects[0].kind === "platform" &&
        room.spawn.x >= 0 &&
        $("#empty").hidden,
    );
    check(
      "New island is saved on disk",
      (await call("open", { id: project.id })).title === "My first island",
    );
    await create();
    await wait(() => project?.id === "Myfirstisland2");
    check(
      "Repeated names get separate project folders",
      (await call("status")).projects.length === 2,
    );
  } catch (e) {
    results.push({ name: "New island flow", passed: false, detail: e.stack });
  }
  await fetch("/__done", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Workshop-Token": window.workshopToken,
    },
    body: JSON.stringify(results),
  });
})();
