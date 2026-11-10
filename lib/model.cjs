const kinds = [
  "art",
  "platform",
  "wall",
  "climb",
  "water",
  "hazard",
  "bounce",
  "movingPlatform",
  "npc",
  "item",
  "door",
  "switch",
  "trigger",
  "custom",
];
const identifier = /^[A-Za-z][A-Za-z0-9_]*$/;
function validate(p) {
  const errors = [];
  if (!p || typeof p !== "object" || Array.isArray(p))
    return ["The island file must contain a JSON object."];
  if (!identifier.test(p.id))
    errors.push(
      "Island ID must start with a letter and contain only letters, numbers and underscores.",
    );
  if (!Array.isArray(p.scenes) || !p.scenes.length)
    return [...errors, "Add at least one room."];
  if (p.scenes.some((s) => !s || typeof s !== "object" || Array.isArray(s)))
    return [...errors, "Each room must be a JSON object."];
  const inventory = new Set();
  if (p.items !== undefined && !Array.isArray(p.items))
    errors.push("Items must be a list.");
  for (const item of Array.isArray(p.items) ? p.items : []) {
    if (!item || typeof item !== "object") {
      errors.push("Each item must be an object.");
      continue;
    }
    if (!identifier.test(item.id) || inventory.has(item.id))
      errors.push("Item IDs must be unique, start with a letter, and use only letters, numbers, or underscores: " + item.id);
    inventory.add(item.id);
    if (item.actions !== undefined && !Array.isArray(item.actions))
      errors.push(item.id + ": actions must be a list");
    validateActions(item.actions, item.id, p.scenes, errors);
    if (
      item.asset &&
      (/(^|[\/\\])\.\.([\/\\]|$)/.test(item.asset) ||
        /^[a-z]+:|^[/\\]/i.test(item.asset))
    )
      errors.push(item.id + ": art path must stay within the library");
  }
  const rooms = new Set();
  for (const s of p.scenes) {
    if (!identifier.test(s.id) || rooms.has(s.id))
      errors.push("Room IDs must be unique, start with a letter, and use only letters, numbers, or underscores: " + s.id);
    rooms.add(s.id);
    if (
      !Number.isFinite(s.width) ||
      !Number.isFinite(s.height) ||
      s.width < 320 ||
      s.height < 240 ||
      s.width > 20000 ||
      s.height > 20000
    )
      errors.push(
        s.id + ": room size must be between 320 × 240 and 20000 × 20000.",
      );
    if (!s.spawn || !Number.isFinite(s.spawn.x) || !Number.isFinite(s.spawn.y))
      errors.push(s.id + ": set a spawn point");
    else if (
      s.spawn.x < 0 ||
      s.spawn.y < 0 ||
      s.spawn.x > s.width ||
      s.spawn.y > s.height
    )
      errors.push(s.id + ": put the spawn point inside the room");
    if (!Array.isArray(s.objects)) {
      errors.push(s.id + ": objects must be a list");
      continue;
    }
    const ids = new Set();
    for (const o of s.objects || []) {
      if (!o || typeof o !== "object" || Array.isArray(o)) {
        errors.push(s.id + ": each object must be a JSON object");
        continue;
      }
      if (!identifier.test(o.id) || ids.has(o.id))
        errors.push(s.id + ": duplicate or invalid object ID " + o.id);
      ids.add(o.id);
      if (!kinds.includes(o.kind)) errors.push(o.id + ": unknown object type");
      for (const k of ["x", "y", "width", "height"])
        if (!Number.isFinite(o[k]))
          errors.push(o.id + ": " + k + " must be a number");
      if (o.width <= 0 || o.height <= 0)
        errors.push(o.id + ": width and height must be greater than zero");
      for (const key of [
        "targetX",
        "targetY",
        "strength",
        "travelX",
        "travelY",
        "speed",
        "rotation",
      ])
        if (o[key] !== undefined && !Number.isFinite(o[key]))
          errors.push(o.id + ": " + key + " must be a number");
      if (o.itemId && !identifier.test(o.itemId))
        errors.push(o.id + ": invalid item ID");
      if (o.kind === "door" && !p.scenes.some((r) => r.id === o.target))
        errors.push(o.id + ": destination room does not exist");
      if (o.actions !== undefined && !Array.isArray(o.actions))
        errors.push(o.id + ": actions must be a list");
      validateActions(o.actions, o.id, p.scenes, errors);
      if (
        o.asset &&
        (/(^|[\/\\])\.\.([\/\\]|$)/.test(o.asset) ||
          /^[a-z]+:|^[/\\]/i.test(o.asset))
      )
        errors.push(o.id + ": asset path must stay within the library");
    }
  }
  if (!rooms.has(p.start)) errors.push("Starting room does not exist.");
  for (const s of p.scenes) {
    if (s.script && !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(s.script))
      errors.push(s.id + ": use a full class name for the room script");
    if (s.width * s.height > 16000000)
      errors.push(
        s.id + ": split rooms larger than 16 million pixels into smaller rooms",
      );
  }
  return errors;
}
const className = (id) => id.charAt(0).toUpperCase() + id.slice(1);
function blank(id = "untitled", title = "Untitled island") {
  return {
    format: 1,
    version: "AS3",
    id,
    title,
    start: "arrival",
    scenes: [
      {
        id: "arrival",
        title: "Arrival",
        width: 1600,
        height: 900,
        background: "#b0d9df",
        spawn: { x: 160, y: 650 },
        objects: [
          {
            id: "ground",
            kind: "platform",
            x: 0,
            y: 760,
            width: 1600,
            height: 140,
            color: "#655b44",
          },
        ],
      },
    ],
    items: [],
    flags: [],
  };
}
module.exports = { kinds, validate, blank, className, identifier };

function validateActions(actions, owner, scenes, errors) {
  for (const a of Array.isArray(actions) ? actions : []) {
    if (
      !a ||
      ![
        "say",
        "flag",
        "give",
        "take",
        "sound",
        "checkpoint",
        "complete",
        "travel",
        "wait",
        "camera",
        "move",
        "custom",
      ].includes(a.type)
    )
      errors.push(owner + ": unknown action");
    if (a?.type === "give" && !identifier.test(a.id || ""))
      errors.push(
        owner +
          ": item ID must start with a letter and use letters, numbers, or underscores",
      );
    if (a?.type === "travel" && !scenes.some((r) => r.id === a.room))
      errors.push(owner + ": action points to a missing room");
    if (
      ["flag", "give", "take", "custom"].includes(a?.type) &&
      (typeof a.id !== "string" || !a.id.trim())
    )
      errors.push(owner + ": " + a.type + " needs an id");
    if (a?.type === "sound" && (typeof a.asset !== "string" || !a.asset.trim()))
      errors.push(owner + ": sound needs an asset filename");
    if (a?.type === "move" && (!Number.isFinite(a.x) || !Number.isFinite(a.y)))
      errors.push(owner + ": move needs numeric x and y positions");
    if (
      a?.type === "wait" &&
      (!Number.isFinite(a.seconds) || a.seconds < 0 || a.seconds > 600)
    )
      errors.push(owner + ": wait must be 0–600 seconds");
  }
}
