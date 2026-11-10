(async () => {
  const results = [];
  const wait = async (fn) => {
    const end = Date.now() + 6000;
    while (!fn()) {
      if (Date.now() > end) throw Error("UI timed out");
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const check = (name, passed) => {
    results.push({ name, passed });
    if (!passed) throw Error(name);
  };
  const choose = async (version) => {
    $("#importIsland").click();
    await wait(() => $("#modal").open);
    check(
      "Copy offers AS2 and AS3",
      Array.from($("#modalBody select").options)
        .map((o) => o.value)
        .join(",") === "AS3,AS2",
    );
    $("#modalBody select").value = version;
    $("#modal").close("ok");
    await wait(
      () => $("#modal").open && $("#modalBody select")?.name === "island",
    );
    $("#modal").close("ok");
    await wait(
      () => project?.version === version && project.mode === "existing",
    );
    await wait(() => $("#roomList button"));
  };
  try {
    await wait(() => project?.id === "uiCheck");
    await choose("AS2");
    check(
      "AS2 copy opens with a room list and editing instructions",
      project.entry === "TrainMain" &&
        $("#roomList").textContent.includes("TrainMain") &&
        !$("#existingHelp").hidden &&
        $("#empty").hidden,
    );
    $("#addRoom").click();
    await wait(() => $("#modal").open);
    $("#modalBody input").value = "NewRoom";
    $("#modal").close("ok");
    await wait(() => $("#roomList").textContent.includes("NewRoom"));
    check(
      "AS2 rooms can be copied without replacing the source",
      (await call("rooms", { project: project.id })).length === 2,
    );
    await choose("AS3");
    check(
      "AS3 copy uses its real name and starting class",
      project.title === "Copy of 24 Carrot" &&
        project.entry === "game.scenes.carrot.mainStreet.MainStreet",
    );
    $("#roomList button").click();
    await wait(() => !$("#codeView").hidden);
    check(
      "AS3 room list opens editable XML",
      file.endsWith("mainStreet/scene.xml") &&
        $("#source").value.includes("<scene"),
    );
    $("#closeCode").click();
    await wait(() => $("#codeView").hidden);
    $("#newProject").click();
    await wait(() => $("#modal").open);
    check(
      "New projects offer an engine choice",
      $("#modalBody select").name === "version",
    );
    $("#modalBody input").value = "Classic project";
    $("#modalBody select").value = "AS2";
    $("#modal").close("ok");
    await wait(
      () =>
        $("#modal").open &&
        $("#modalTitle").textContent === "AS2 starting island",
    );
    $("#modal").close("ok");
    await wait(() => project?.id === "Classicproject");
    check(
      "New AS2 projects keep the selected version",
      project.version === "AS2" && project.title === "Classic project",
    );
  } catch (e) {
    results.push({ name: "Clone UI flow", passed: false, detail: e.stack });
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
