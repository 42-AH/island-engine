(async function () {
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, passed: !!ok, detail });
    if (!ok) throw Error(name + ": " + detail);
  };
  const wait = async (fn) => {
    const end = Date.now() + 5000;
    while (!fn()) {
      if (Date.now() > end) throw Error("Timed out waiting for UI");
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const button = (text) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === text,
    );
  const edit = (node, value) => {
    node.value = value;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const errors = [];
  window.addEventListener("error", (e) => errors.push(e.message));
  window.addEventListener("unhandledrejection", (e) =>
    errors.push(String(e.reason)),
  );
  try {
    await wait(
      () =>
        project?.id === "uiCheck" &&
        document.querySelectorAll("#fileList .file").length,
    );
    check(
      "Editor opens a project and draws its room",
      canvas.width > 0 && room.id === "arrival" && !$("#stage").hidden,
    );
    await openCode("src/extra/Rule.as");
    edit($("#source"), "// edited version");
    check(
      "Unsaved source has a visible marker",
      $("#fileName").textContent.endsWith(" •"),
    );
    $("#saveCode").click();
    await wait(() => $("#fileName").textContent === "src/extra/Rule.as");
    check(
      "Save file writes the edited source",
      (await call("read", { project: project.id, file })) ===
        "// edited version",
    );
    let failed = false;
    try {
      await openCode("src/missing.as");
    } catch {
      failed = true;
    }
    check(
      "Failed file open keeps the current file and its text",
      failed &&
        file === "src/extra/Rule.as" &&
        $("#source").value === "// edited version",
    );
    $("#closeCode").click();
    await wait(() => $("#codeView").hidden);
    room = project.scenes[1];
    selected = room.objects[0];
    inspect();
    await openCode("island.json");
    const next = JSON.parse($("#source").value);
    next.title = "Changed in code";
    edit($("#source"), JSON.stringify(next));
    $("#saveCode").click();
    await wait(() => $("#fileName").textContent === "island.json");
    check(
      "Saving island JSON keeps the room and clears stale selections",
      room.id === "second" &&
        selected === null &&
        history.length === 0 &&
        future.length === 0 &&
        $("#projectName").textContent === "Changed in code",
    );
    $("#closeCode").click();
    await wait(() => $("#codeView").hidden);
    selected = room.objects[0];
    inspect();
    button("Edit all properties as JSON…").click();
    await wait(() => $("#modal").open);
    const obj = JSON.parse($("#modalBody textarea").value);
    delete obj.hideWhen;
    edit($("#modalBody textarea"), JSON.stringify(obj));
    $("#modal").close("ok");
    await wait(() => !("hideWhen" in room.objects[0]));
    check(
      "Removing a property in JSON removes it from the object",
      selected === room.objects[0] && !("hideWhen" in selected),
    );
    $("#undo").click();
    check(
      "Undo restores the removed property",
      room.objects[0].hideWhen === "old_flag",
    );
    $("#redo").click();
    check("Redo removes the property again", !("hideWhen" in room.objects[0]));
    selected = room.objects[0];
    inspect();
    const actionInput = $('#inspector [aria-label="Actions as JSON"]');
    edit(actionInput, "{}");
    check(
      "Invalid action JSON does not replace the action list",
      !selected.actions &&
        $("#status").textContent.startsWith("Actions must be a JSON list"),
    );
    button("Edit all properties as JSON…").click();
    await wait(() => $("#modal").open);
    const before = JSON.stringify(selected);
    edit($("#modalBody textarea"), '{"id":"broken"}');
    $("#modal form").requestSubmit();
    await wait(() => $("#modalError").textContent.includes("unknown object type"));
    check(
      "Invalid object edits show the problem in the dialog and preserve the object",
      $("#modal").open && JSON.stringify(selected) === before,
    );
    $("#modal").close("cancel");
    await new Promise((r) => setTimeout(r, 40));
    $("#save").click();
    await wait(() => !dirty);
    check(
      "Canvas edits survive save and reopen",
      !(
        "hideWhen" in
        (await call("open", { id: project.id })).scenes[1].objects[0]
      ),
    );
    check(
      "Editor fits its viewport",
      document.documentElement.scrollWidth <= innerWidth &&
        $("#canvas").getBoundingClientRect().width > 200,
    );
    document.querySelector("#roomList .room.active").click();
    await wait(() => selected === null);
    check("Clicking the room shows room settings", $("#inspector h3").textContent === room.title);
    document.querySelector('[data-tool="npc"]').click();
    check(
      "Placement buttons show the active tool",
      $("#tool").dataset.active === "npc" &&
        document
          .querySelector('[data-tool="npc"]')
          .getAttribute("aria-pressed") === "true",
    );
    room.objects.push({
      id: "guide",
      kind: "npc",
      x: 250,
      y: 650,
      width: 60,
      height: 110,
      text: "Hello.",
    });
    inspect();
    [...document.querySelectorAll(".objectRow")]
      .find((b) => b.textContent.startsWith("guide"))
      .click();
    check("Object list selects a character", selected.id === "guide");
    button("Add action").click();
    const dialogue = document.querySelector(".actionRow textarea");
    edit(dialogue, "The gate is stuck.");
    check(
      "Action fields update both data and JSON",
      selected.actions[0].text === "The gate is stuck." &&
        $('#inspector [aria-label="Actions as JSON"]').value.includes("The gate is stuck."),
    );
    const choice = document.querySelector('[aria-label="Action type"]');
    edit(choice, "complete");
    button("Add action").click();
    check(
      "Finish island uses the runtime action",
      selected.actions[1].type === "complete",
    );
    await save();
    const saved = await call("open", { id: project.id });
    check(
      "Action edits survive reopening",
      saved.scenes[1].objects.find((o) => o.id === "guide").actions[0].text ===
        "The gate is stuck.",
    );
    button("Remove action").click();
    check(
      "Remove action preserves the next action",
      selected.actions.length === 1 && selected.actions[0].type === "complete",
    );
    document.querySelector('[data-tab="items"]').click();
    $("#newItem").click();
    await wait(() => $("#modal").open);
    $("#modalBody input").value = "Brass key";
    $("#modal").close("ok");
    await wait(() => selected?.kind === "inventory");
    const itemId = selected.id;
    check(
      "New item creates a named inventory card",
      project.items.some((i) => i.id === itemId && i.label === "Brass key"),
    );
    button("Place in Second").click();
    check(
      "Item cards can be placed as pickups",
      selected.kind === "item" && selected.itemId === itemId,
    );
    selected = room.objects.find((o) => o.id === "guide");
    inspect();
    const requirement = document.querySelector('[aria-label="Needs item"]');
    edit(requirement, itemId);
    check(
      "Item requirements are chosen by name",
      selected.requiresItem === itemId &&
        [...requirement.options].some((o) => o.textContent === "Brass key"),
    );
    const actionChoice = document.querySelector('[aria-label="Action type"]');
    edit(actionChoice, "give");
    button("Add action").click();
    edit(
      document.querySelector('.actionRow select[aria-label="Item"]'),
      itemId,
    );
    await save();
    const withItems = await call("open", { id: project.id });
    check(
      "Item cards, pickups, and rewards save together",
      withItems.items[0].id === itemId &&
        withItems.scenes[1].objects
          .find((o) => o.id === "guide")
          .actions.some((a) => a.type === "give" && a.id === itemId),
    );
    edit(document.querySelector('[aria-label="Action type"]'), "travel");
    button("Add action").click();
    edit(document.querySelector('[aria-label="Destination room"]'), "arrival");
    check("Travel actions choose rooms by name and use their spawn", selected.actions.at(-1).room === "arrival" && selected.actions.at(-1).x === project.scenes[0].spawn.x);
    edit(document.querySelector('[aria-label="Action type"]'), "flag");
    button("Add action").click();
    const flagRow = [...document.querySelectorAll(".actionRow")].at(-1);
    edit(flagRow.querySelector('[aria-label="Flag"]'), "repaired");
    edit(flagRow.querySelector('[aria-label="Flag value"]'), "false");
    edit(flagRow.querySelector('[aria-label="Only after flag"]'), "started");
    check("Flag clearing and action conditions need no JSON edits", selected.actions.at(-1).value === false && selected.actions.at(-1).requires === "started" && $('#inspector [aria-label="Actions as JSON"]').value.includes('"requires": "started"'));
    edit($("#fileSearch"), "Rule.as");
    await wait(() => $("#fileList").children.length === 1);
    check("Code search finds editable source files", $("#fileList .file").dataset.file === "src/extra/Rule.as");
    edit($("#fileSearch"), "");
    $("#runtimeCode").click();
    await wait(() => file === "src/IslandScene.as" && !$("#codeView").hidden);
    check(
      "Room runtime opens before the first build",
      $("#source").value.includes("onUseItem") &&
        $("#source").value.includes("public function giveItem"),
    );
    edit($("#source"), $("#source").value + "\n// project edit\n");
    await saveCode();
    $("#closeCode").click();
    await wait(() => $("#codeView").hidden);
    $("#runtimeCode").click();
    await wait(() => !$("#codeView").hidden);
    check(
      "Opening runtime keeps custom code",
      $("#source").value.includes("// project edit"),
    );
    check("No browser script errors", errors.length === 0, errors.join("\n"));
  } catch (e) {
    results.push({ name: "UI sequence", passed: false, detail: e.stack });
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
