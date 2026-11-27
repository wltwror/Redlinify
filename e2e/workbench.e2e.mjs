import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

async function pickFreePort() {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function buildTempRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "redlinify-e2e-"));
  const design = path.join(root, ".design");
  await fs.mkdir(path.join(design, "views"), { recursive: true });
  await fs.mkdir(path.join(design, "threads"), { recursive: true });
  await fs.mkdir(path.join(design, ".layout"), { recursive: true });
  await fs.mkdir(path.join(design, ".checkpoint"), { recursive: true });

  const archRaw = await fs.readFile(
    path.join(REPO_ROOT, ".design", "views", "architecture.json"),
    "utf8",
  );
  const arch = JSON.parse(archRaw);
  for (const n of arch.nodes) {
    if (n.id === "design_storage") {
      n.locked = false;
    }
  }
  await fs.writeFile(
    path.join(design, "views", "architecture.json"),
    `${JSON.stringify(arch, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(design, ".checkpoint", "architecture.json"),
    `${JSON.stringify(arch, null, 2)}\n`,
    "utf8",
  );

  const fleetEr = {
    id: "fleet_er",
    title: "Fleet ER",
    diagram_type: "er",
    direction: "LR",
    created_by: "agent",
    nodes: [
      {
        id: "vehicles",
        kind: "Entity",
        title: "Vehicles",
        summary: "Physical fleet inventory",
        status: "draft",
        locked: false,
        sections: [],
        fields: [
          { id: "f_id", name: "id", type: "uuid", pk: true, nullable: false },
          {
            id: "f_plate",
            name: "license_plate",
            type: "varchar",
            unique: true,
            nullable: false,
          },
          { id: "f_vin", name: "vin", type: "varchar", nullable: false },
        ],
      },
      {
        id: "customers",
        kind: "Entity",
        title: "Customers",
        status: "approved",
        locked: true,
        sections: [],
        fields: [
          { id: "c_id", name: "id", type: "uuid", pk: true, nullable: false },
          { id: "c_email", name: "email", type: "varchar", nullable: false },
        ],
      },
    ],
    edges: [
      {
        id: "e_lease",
        source: "customers",
        target: "vehicles",
        label: "leases",
        relation_kind: "association",
        source_cardinality: "1",
        target_cardinality: "0..*",
        style: "solid",
        locked: false,
      },
    ],
  };

  await fs.writeFile(
    path.join(design, "views", "fleet_er.json"),
    `${JSON.stringify(fleetEr, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(design, ".checkpoint", "fleet_er.json"),
    `${JSON.stringify(fleetEr, null, 2)}\n`,
    "utf8",
  );

  const ws = {
    version: 1,
    project_name: "RedlinifyE2E",
    tabs: [
      {
        view_id: "architecture",
        title: "System Architecture",
        diagram_type: "general",
        order: 0,
      },
      {
        view_id: "fleet_er",
        title: "Fleet ER",
        diagram_type: "er",
        order: 1,
      },
    ],
    view_requests: [],
  };
  await fs.writeFile(
    path.join(design, "workspace.json"),
    `${JSON.stringify(ws, null, 2)}\n`,
    "utf8",
  );

  return root;
}

async function waitHealth(baseUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${baseUrl}/api/health`);
      if (resp.status === 200) {
        await resp.text();
        return;
      }
    } catch {
      // retry until healthy
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`UI server at ${baseUrl} did not become healthy within ${timeoutMs}ms`);
}

async function getViewport(page) {
  return await page.evaluate(() => {
    const el = document.querySelector(".react-flow__viewport");
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return { x: m.m41, y: m.m42, zoom: m.a };
  });
}

async function findEmptyPanePoint(page) {
  const pt = await page.evaluate(() => {
    const pane = document.querySelector(".react-flow__pane");
    const rect = pane.getBoundingClientRect();
    for (let x = rect.left + 20; x < rect.right - 20; x += 40) {
      for (let y = rect.top + 20; y < rect.bottom - 20; y += 40) {
        const el = document.elementFromPoint(x, y);
        if (el && el.classList.contains("react-flow__pane")) {
          return { x, y };
        }
      }
    }
    return null;
  });
  assert.ok(pt, "Expected to find an empty canvas pane point");
  return pt;
}

async function clickEmptyPane(page) {
  const pt = await findEmptyPanePoint(page);
  await page.mouse.click(pt.x, pt.y);
}

async function dispatchWheel(
  page,
  deltaX,
  deltaY,
  { ctrlKey = false, shiftKey = false } = {},
) {
  await page.evaluate(
    ({ dx, dy, ctrl, shift }) => {
      const pane = document.querySelector(".react-flow__pane");
      pane.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: dx,
          deltaY: dy,
          ctrlKey: ctrl,
          shiftKey: shift,
          clientX: 700,
          clientY: 420,
        }),
      );
    },
    { dx: deltaX, dy: deltaY, ctrl: ctrlKey, shift: shiftKey },
  );
}

async function assertAllNodesInViewport(page, label) {
  const result = await page.evaluate(() => {
    const container = document.querySelector(".react-flow");
    const paneRect = container.getBoundingClientRect();
    const nodes = [...document.querySelectorAll(".react-flow__node")];
    const outside = [];
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      if (
        r.width === 0 ||
        r.height === 0 ||
        r.left < paneRect.left - 8 ||
        r.top < paneRect.top - 8 ||
        r.right > paneRect.right + 8 ||
        r.bottom > paneRect.bottom + 8
      ) {
        outside.push({
          id: n.getAttribute("data-id"),
          nodeRect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          paneRect: {
            left: paneRect.left,
            top: paneRect.top,
            right: paneRect.right,
            bottom: paneRect.bottom,
          },
        });
      }
    }
    return { count: nodes.length, outside };
  });
  assert.ok(result.count > 0, `${label}: expected nodes in viewport`);
  assert.deepEqual(
    result.outside,
    [],
    `${label}: nodes outside viewport: ${JSON.stringify(result.outside)}`,
  );
}

async function main() {
  const tmpRepo = await buildTempRepo();
  const prefsPath = path.join(tmpRepo, "preferences.json");
  const port = await pickFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const cliPath = path.join(REPO_ROOT, "packages", "server", "dist", "cli.js");

  const proc = spawn(
    process.execPath,
    [cliPath, "ui", "--dir", tmpRepo, "--port", String(port), "--host", "127.0.0.1"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, REDLINIFY_PREFERENCES_PATH: prefsPath },
    },
  );

  let serverLogs = "";
  proc.stdout.on("data", (chunk) => {
    serverLogs += chunk.toString();
  });
  proc.stderr.on("data", (chunk) => {
    serverLogs += chunk.toString();
  });

  const errors = [];
  let browser;
  try {
    await waitHealth(baseUrl);
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 860 },
    });
    const page = await ctx.newPage();
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(`console.error: ${msg.text()}`);
      }
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.react-flow__node[data-id="design_storage"]', {
      timeout: 12000,
    });
    await page.waitForTimeout(350);

    // 1. Scroll [Pan | Zoom] bottom-left switch & CanvasDock bottom-center non-overlap check
    const scrollGroup = page.getByRole("group", {
      name: "Scroll wheel behavior",
    });
    const panBtn = scrollGroup.getByRole("button", { name: "Pan" });
    const zoomBtn = scrollGroup.getByRole("button", { name: "Zoom" });
    await scrollGroup.waitFor({ state: "visible", timeout: 4000 });
    assert.equal(await panBtn.getAttribute("aria-pressed"), "true");
    assert.equal(await zoomBtn.getAttribute("aria-pressed"), "false");

    const canvasDock = page.getByRole("toolbar", { name: "Canvas actions" });
    await canvasDock.waitFor({ state: "visible", timeout: 4000 });

    const controlsBox = await page.locator(".react-flow__controls").boundingBox();
    const groupBox = await scrollGroup.boundingBox();
    const dockBox = await canvasDock.boundingBox();
    const minimapBox = await page.locator(".react-flow__minimap").boundingBox();
    assert.ok(controlsBox && groupBox && dockBox && minimapBox);
    assert.ok(
      groupBox.x >= controlsBox.x + controlsBox.width - 0.5,
      `Scroll switch overlaps Controls: ${JSON.stringify({ controlsBox, groupBox })}`,
    );
    assert.ok(
      dockBox.x >= groupBox.x + groupBox.width - 0.5,
      `CanvasDock overlaps Scroll switch: ${JSON.stringify({ groupBox, dockBox })}`,
    );
    assert.ok(
      dockBox.x + dockBox.width <= minimapBox.x + 0.5,
      `CanvasDock overlaps MiniMap: ${JSON.stringify({ dockBox, minimapBox })}`,
    );

    // Verify CanvasDock Add Box & Undo work cleanly
    const initialNodeCount = await page.locator(".react-flow__node").count();
    await canvasDock.getByRole("button", { name: "Add Box" }).click();
    await page.waitForFunction(
      (expected) => document.querySelectorAll(".react-flow__node").length === expected,
      initialNodeCount + 1,
      { timeout: 3000 },
    );
    await canvasDock.getByRole("button", { name: "Undo" }).click();
    await page.waitForFunction(
      (expected) => document.querySelectorAll(".react-flow__node").length === expected,
      initialNodeCount,
      { timeout: 3000 },
    );

    // 2. Pan mode (default): 2D, integer, and fractional wheel deltas pan; pinch zooms
    const v0 = await getViewport(page);
    await page.mouse.move(700, 420);
    await dispatchWheel(page, 40, 80);
    await dispatchWheel(page, 0, 100);
    await dispatchWheel(page, 0, 66.67);
    await page.waitForTimeout(100);
    const v1 = await getViewport(page);
    assert.ok(Math.abs(v1.zoom - v0.zoom) < 1e-4);
    assert.ok(Math.abs(v1.x - v0.x - -40.0) < 2.0);
    assert.ok(Math.abs(v1.y - v0.y - -246.67) < 2.0);

    await dispatchWheel(page, 0, -8, { ctrlKey: true });
    await page.waitForTimeout(100);
    const v2 = await getViewport(page);
    assert.ok(v2.zoom > v1.zoom * 1.06 && v2.zoom < v1.zoom * 1.12);

    // 3. Switch to Zoom mode & verify discrete/fractional/small zoom + global preferences.json persistence
    await zoomBtn.click();
    await page.waitForTimeout(180);
    assert.equal(await zoomBtn.getAttribute("aria-pressed"), "true");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("redlinify-scroll-mode")),
      "zoom",
    );
    const savedPrefs = JSON.parse(await fs.readFile(prefsPath, "utf8"));
    assert.equal(savedPrefs.scroll_mode, "zoom");

    const z0 = await getViewport(page);
    await dispatchWheel(page, 0, -100);
    await page.waitForTimeout(80);
    const z1 = await getViewport(page);
    assert.ok(z1.zoom > z0.zoom * 1.15);

    await dispatchWheel(page, 0, -66.67);
    await page.waitForTimeout(80);
    const z2 = await getViewport(page);
    assert.ok(z2.zoom > z1.zoom * 1.1);

    await dispatchWheel(page, 0, -12);
    await page.waitForTimeout(80);
    const z3 = await getViewport(page);
    assert.ok(z3.zoom > z2.zoom * 1.01);

    await dispatchWheel(page, 40, 0);
    await dispatchWheel(page, 0, 80, { shiftKey: true });
    await page.waitForTimeout(80);
    const z4 = await getViewport(page);
    assert.ok(Math.abs(z4.zoom - z3.zoom) < 1e-4);
    assert.ok(Math.abs(z4.x - z3.x - -120.0) < 2.0);

    // Clear localStorage completely and reload — global server preferences.json must restore Zoom mode
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('.react-flow__node[data-id="design_storage"]', {
      timeout: 12000,
    });
    await page.waitForTimeout(300);
    assert.equal(await zoomBtn.getAttribute("aria-pressed"), "true");
    await panBtn.click();
    await page.waitForTimeout(120);
    assert.equal(await panBtn.getAttribute("aria-pressed"), "true");
    console.log("PASS 1: CanvasDock, Scroll [Pan | Zoom] switch, pinch, and global preferences.json verified.");

    // 4. Canvas drag + keyboard shortcuts + accelerated Arrow hold vs tap
    const panePt = await findEmptyPanePoint(page);
    const d0 = await getViewport(page);
    await page.mouse.move(panePt.x, panePt.y);
    await page.mouse.down();
    await page.mouse.move(panePt.x + 80, panePt.y + 50, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    const d1 = await getViewport(page);
    assert.ok(d1.x > d0.x + 65 && d1.y > d0.y + 35);

    await clickEmptyPane(page);
    await page.waitForTimeout(80);
    await page.keyboard.press("1");
    await page.waitForTimeout(240);
    const k0 = await getViewport(page);
    assert.ok(Math.abs(k0.zoom - 1.0) < 0.05);

    await page.keyboard.press("=");
    await page.waitForTimeout(200);
    const k1 = await getViewport(page);
    assert.ok(k1.zoom > k0.zoom * 1.08);

    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(160);
    const kTap = await getViewport(page);
    const tapDelta = k1.x - kTap.x;
    assert.ok(tapDelta >= 80 && tapDelta <= 130, `tapDelta=${tapDelta}`);

    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(560);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(80);
    const kHold = await getViewport(page);
    const holdDelta = kTap.x - kHold.x;
    assert.ok(holdDelta > 450, `holdDelta=${holdDelta}`);
    console.log("PASS 2: Drag, zoom shortcuts, and Arrow tap/hold acceleration verified.");

    // 5. Tab / Shift+Tab cycling, dialog guard, fuzzy search + Space input guard
    await page.keyboard.press("Tab");
    await page.waitForSelector('.react-flow__node[data-id="vehicles"]', {
      timeout: 5000,
    });
    assert.ok(page.url().includes("#view=fleet_er"));

    await page.keyboard.press("Shift+Tab");
    await page.waitForSelector('.react-flow__node[data-id="design_storage"]', {
      timeout: 5000,
    });
    assert.ok(page.url().includes("#view=architecture"));

    await page.getByRole("button", { name: "Add or request view" }).click();
    await page.waitForSelector('[role="dialog"][aria-label="Add Design View"]', {
      timeout: 3000,
    });
    await page.keyboard.press("Tab");
    await page.waitForTimeout(100);
    assert.ok(page.url().includes("#view=architecture"));
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(150);

    await page.keyboard.press("Control+k");
    const searchInput = page.getByRole("textbox", {
      name: "Search workspace input",
    });
    await searchInput.waitFor({ state: "visible", timeout: 3000 });
    await page.waitForFunction(
      () =>
        document.activeElement?.getAttribute("aria-label") ===
        "Search workspace input",
      { timeout: 2000 },
    );
    await page.keyboard.type("veh lic", { delay: 15 });
    assert.equal(await searchInput.inputValue(), "veh lic");
    await page.waitForTimeout(150);
    assert.equal(
      await page.getByText("Attr: license_plate: varchar").isVisible(),
      true,
    );
    await page.keyboard.press("Enter");
    await page.waitForSelector('.react-flow__node[data-id="vehicles"].selected', {
      timeout: 5000,
    });
    assert.ok(page.url().includes("#view=fleet_er"));

    await clickEmptyPane(page);
    await page.waitForTimeout(150);
    await page.keyboard.press("/");
    await searchInput.waitFor({ state: "visible", timeout: 2000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    assert.equal(await searchInput.count(), 0);
    console.log("PASS 3: Tab cycling, modal guard, fuzzy search, and Space guard verified.");

    // 6. ER attribute clear-to-delete + Ctrl+Z undo + Light/Dark switch
    await page.locator(".react-flow__controls-fitview").first().click();
    await page.waitForTimeout(250);
    const vehiclesNode = page.locator('.react-flow__node[data-id="vehicles"]');
    const vinSpan = vehiclesNode
      .locator("span.font-mono.text-slate-100", { hasText: "vin" })
      .first();
    assert.equal(await vinSpan.isVisible(), true);
    await vinSpan.dblclick();
    const attrInput = vehiclesNode.locator("input").first();
    assert.equal(await attrInput.isVisible(), true);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(350);

    const savedEr = JSON.parse(
      await fs.readFile(path.join(tmpRepo, ".design", "views", "fleet_er.json"), "utf8"),
    );
    const veh = savedEr.nodes.find((n) => n.id === "vehicles");
    assert.deepEqual(
      veh.fields.map((f) => f.name),
      ["id", "license_plate"],
    );

    await clickEmptyPane(page);
    await page.waitForTimeout(100);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(350);
    const savedUndo = JSON.parse(
      await fs.readFile(path.join(tmpRepo, ".design", "views", "fleet_er.json"), "utf8"),
    );
    const vehUndo = savedUndo.nodes.find((n) => n.id === "vehicles");
    assert.deepEqual(
      vehUndo.fields.map((f) => f.name),
      ["id", "license_plate", "vin"],
    );

    // 7. Light theme + Context menu dismissal + right-click drag suppression
    await page.getByRole("button", { name: "Toggle color theme" }).click();
    await page.waitForTimeout(100);
    await page.keyboard.press("Shift+Tab");
    const dsNode = page.locator('.react-flow__node[data-id="design_storage"]');
    await dsNode.waitFor({ state: "visible", timeout: 5000 });
    await page.locator(".react-flow__controls-fitview").first().click();
    await page.waitForTimeout(250);

    await dsNode.click({ button: "right" });
    await page.waitForTimeout(150);
    assert.equal(
      await page.getByRole("button", { name: "Add Entry to…", exact: true }).isVisible(),
      true,
    );
    await page.mouse.move(90, 140);
    await page.mouse.down();
    await page.mouse.move(190, 200, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    assert.equal(
      await page.getByRole("button", { name: "Add Entry to…", exact: true }).count(),
      0,
    );

    await dsNode.click({ button: "right" });
    await page.waitForTimeout(150);
    const box = await dsNode.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + 16);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 45, box.y + 16, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    assert.equal(
      await page.getByRole("button", { name: "Add Entry to…", exact: true }).count(),
      0,
    );

    await dsNode.click({ button: "right" });
    await page.waitForTimeout(150);
    await page.mouse.move(90, 140);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(150);
    assert.equal(
      await page.getByRole("button", { name: "Add Entry to…", exact: true }).count(),
      0,
    );

    await page.mouse.move(140, 180);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(210, 240, { steps: 6 });
    await page.mouse.up({ button: "right" });
    await page.waitForTimeout(200);
    assert.equal(
      await page.getByRole("button", { name: "Add Box here", exact: true }).count(),
      0,
    );
    console.log("PASS 4: ER editing, Undo, Light theme, and context menu guards verified.");

    // 8. General view node shapes: CanvasDock split picker, right-click Change Shape, Inspector switcher, and Undo
    const archBefore = JSON.parse(
      await fs.readFile(path.join(tmpRepo, ".design", "views", "architecture.json"), "utf8"),
    );
    const beforeNodeIds = new Set(archBefore.nodes.map((n) => n.id));

    await page.getByRole("button", { name: "Add shape menu" }).click();
    await page.getByRole("menuitem", { name: "Decision (Rhombus)" }).click();
    await page.waitForSelector('[data-shape="decision"] svg polygon', {
      timeout: 5000,
    });

    const archDecision = JSON.parse(
      await fs.readFile(path.join(tmpRepo, ".design", "views", "architecture.json"), "utf8"),
    );
    const createdDecision = archDecision.nodes.find((n) => !beforeNodeIds.has(n.id));
    assert.ok(createdDecision, "Expected newly added decision node on disk");
    assert.equal(createdDecision.shape, "decision");

    await page.locator(".react-flow__controls-fitview").first().click();
    await page.waitForTimeout(250);
    const addedNodeLoc = page.locator(`.react-flow__node[data-id="${createdDecision.id}"]`);
    await addedNodeLoc.click({ button: "right" });
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "Change Shape…" }).click();
    await page.getByRole("button", { name: "Store (Database)" }).click();
    await page.waitForSelector(
      `.react-flow__node[data-id="${createdDecision.id}"] [data-shape="store"] svg ellipse`,
      { timeout: 5000 },
    );

    const archStore = JSON.parse(
      await fs.readFile(path.join(tmpRepo, ".design", "views", "architecture.json"), "utf8"),
    );
    assert.equal(
      archStore.nodes.find((n) => n.id === createdDecision.id)?.shape,
      "store",
    );

    await page
      .getByRole("group", { name: "Node shape" })
      .getByRole("button", { name: "Terminal" })
      .click();
    await page.waitForSelector(
      `.react-flow__node[data-id="${createdDecision.id}"] [data-shape="terminal"]`,
      { timeout: 5000 },
    );
    const archTerminal = JSON.parse(
      await fs.readFile(path.join(tmpRepo, ".design", "views", "architecture.json"), "utf8"),
    );
    assert.equal(
      archTerminal.nodes.find((n) => n.id === createdDecision.id)?.shape,
      "terminal",
    );

    await clickEmptyPane(page);
    await page.getByRole("button", { name: "Undo" }).click();
    await page.waitForSelector(
      `.react-flow__node[data-id="${createdDecision.id}"] [data-shape="store"]`,
      { timeout: 5000 },
    );
    await page.getByRole("button", { name: "Undo" }).click();
    await page.waitForSelector(
      `.react-flow__node[data-id="${createdDecision.id}"] [data-shape="decision"]`,
      { timeout: 5000 },
    );
    console.log("PASS 5: General view shapes (decision, store, terminal) and undo verified.");

    // 9. LR/TB direction toggle centers viewport on updated ELK layout + no '+1 more' card collapse
    await canvasDock.getByRole("button", { name: "Undo" }).click();
    await page.waitForTimeout(250);
    await dispatchWheel(page, 1800, 1200);
    await page.waitForTimeout(120);

    const toggleDirBtn = canvasDock.getByRole("button", {
      name: /^Toggle layout direction/,
    });
    const dirBefore = await toggleDirBtn.textContent();
    await toggleDirBtn.click();
    await page.waitForFunction(
      (prev) => {
        const btn = document.querySelector(
          '[aria-label="Canvas actions"] button[aria-label^="Toggle layout direction"]',
        );
        return btn && btn.textContent?.trim() !== prev?.trim();
      },
      dirBefore,
      { timeout: 5000 },
    );
    await page.waitForTimeout(450);
    await assertAllNodesInViewport(page, "After first LR/TB toggle");

    const dirMid = await toggleDirBtn.textContent();
    await toggleDirBtn.click();
    await page.waitForFunction(
      (prev) => {
        const btn = document.querySelector(
          '[aria-label="Canvas actions"] button[aria-label^="Toggle layout direction"]',
        );
        return btn && btn.textContent?.trim() !== prev?.trim();
      },
      dirMid,
      { timeout: 5000 },
    );
    await page.waitForTimeout(450);
    await assertAllNodesInViewport(page, "After second LR/TB toggle");

    const countBeforeCollapseBox = await page.locator(".react-flow__node").count();
    await canvasDock.getByRole("button", { name: "Add Box" }).click();
    await page.waitForFunction(
      (expected) => document.querySelectorAll(".react-flow__node").length === expected,
      countBeforeCollapseBox + 1,
      { timeout: 5000 },
    );
    await page.waitForSelector(
      '.react-flow__node.selected [data-section-id="responsibilities"]',
      { timeout: 5000 },
    );
    const collapseNodeId = await page
      .locator(".react-flow__node.selected")
      .first()
      .getAttribute("data-id");
    assert.ok(collapseNodeId, "Expected selected node data-id");
    await page.locator(".react-flow__controls-fitview").first().click();
    await page.waitForTimeout(250);

    const collapseNode = page.locator(`.react-flow__node[data-id="${collapseNodeId}"]`);
    for (let i = 2; i <= 6; i++) {
      await collapseNode.hover();
      const addLineBtn = collapseNode.locator('button[title^="Add line to "]').first();
      await addLineBtn.click({ force: true });
      const entryInput = collapseNode.locator('input[placeholder="New entry..."]');
      await entryInput.waitFor({ state: "visible", timeout: 4000 });
      await entryInput.fill(`step_${i}`);
      await entryInput.press("Enter");
      await collapseNode.getByText(`step_${i}`).waitFor({
        state: "visible",
        timeout: 4000,
      });
    }
    assert.equal(await collapseNode.getByText("step_6").isVisible(), true);
    assert.equal(
      await collapseNode.getByRole("button", { name: "+1 more" }).count(),
      0,
    );

    await collapseNode.hover();
    await collapseNode
      .locator('button[title^="Add line to "]')
      .first()
      .click({ force: true });
    const entry7Input = collapseNode.locator('input[placeholder="New entry..."]');
    await entry7Input.waitFor({ state: "visible", timeout: 4000 });
    await entry7Input.fill("step_7");
    await entry7Input.press("Enter");
    await collapseNode.getByRole("button", { name: "+2 more" }).waitFor({
      state: "visible",
      timeout: 5000,
    });
    assert.equal(await collapseNode.getByText("step_7").count(), 0);
    console.log("PASS 6: Direction toggle fitView centering and non-redundant collapse UX verified.");

    // 10. Dense auto-layout overlap check, overflow tooltips, and elevated scrollable 30-attribute ER card
    const erDetailResp = await fetch(`${baseUrl}/api/views/fleet_er`);
    assert.equal(erDetailResp.status, 200);
    const erDetail = await erDetailResp.json();
    const thirtyFields = [
      {
        id: "f_long",
        name: "col_01_very_long_audit_correlation_identifier_name_with_extra_suffix_to_force_truncation",
        type: "varchar",
        pk: true,
        nullable: false,
        note: "Correlation token across microservices",
      },
      { id: "f_ok", name: "col_02_ok", type: "int", nullable: false },
      ...Array.from({ length: 28 }, (_, idx) => ({
        id: `f_col_${idx + 3}`,
        name: `col_${String(idx + 3).padStart(2, "0")}`,
        type: "text",
        nullable: true,
      })),
    ];
    const nextFleetEr = {
      ...erDetail.view,
      nodes: [
        ...erDetail.view.nodes.map((n) =>
          n.id === "vehicles" ? { ...n, fields: thirtyFields } : n,
        ),
        {
          id: "audit_log",
          kind: "Entity",
          title: "Audit Log",
          status: "draft",
          locked: false,
          sections: [],
          fields: [
            { id: "a_id", name: "id", type: "uuid", pk: true, nullable: false },
          ],
          created_by: "human",
        },
      ],
      edges: [
        ...erDetail.view.edges,
        {
          id: "e_veh_audit",
          source: "vehicles",
          target: "audit_log",
          label: "records",
          relation_kind: "association",
          source_cardinality: "1",
          target_cardinality: "0..*",
          style: "solid",
          locked: false,
          created_by: "human",
        },
      ],
    };
    const putErResp = await fetch(`${baseUrl}/api/views/fleet_er`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        view: nextFleetEr,
        base_hash: erDetail.view_hash,
      }),
    });
    assert.equal(putErResp.status, 200);

    await clickEmptyPane(page);
    await page.keyboard.press("Tab");
    await page.waitForSelector('.react-flow__node[data-id="audit_log"]', {
      timeout: 5000,
    });
    await canvasDock.getByRole("button", { name: "Auto-Layout" }).click();
    await page.waitForTimeout(450);

    const overlapPairs = await page.evaluate(() => {
      const els = [...document.querySelectorAll(".react-flow__node")];
      const boxes = els.map((el) => ({
        id: el.getAttribute("data-id"),
        rect: el.getBoundingClientRect(),
      }));
      const overlaps = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].rect;
          const b = boxes[j].rect;
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 0 && oy > 0) {
            overlaps.push([boxes[i].id, boxes[j].id]);
          }
        }
      }
      return overlaps;
    });
    assert.deepEqual(overlapPairs, [], `Expected zero overlapping nodes, got ${JSON.stringify(overlapPairs)}`);

    await page.locator(".react-flow__controls-fitview").first().click();
    await page.waitForTimeout(250);

    const longCol = vehiclesNode
      .locator("span.font-mono.text-slate-100", {
        hasText:
          "col_01_very_long_audit_correlation_identifier_name_with_extra_suffix_to_force_truncation",
      })
      .first();
    await longCol.hover();
    const tooltipLoc = page.locator('[role="tooltip"]').first();
    await tooltipLoc.waitFor({ state: "visible", timeout: 3000 });
    const tooltipBody = await tooltipLoc.textContent();
    assert.ok(
      tooltipBody?.includes(
        "col_01_very_long_audit_correlation_identifier_name_with_extra_suffix_to_force_truncation",
      ),
      `Unexpected tooltip text: ${tooltipBody}`,
    );
    assert.ok(
      tooltipBody?.includes("Correlation token across microservices"),
      `Expected field note in tooltip, got: ${tooltipBody}`,
    );

    const shortCol = vehiclesNode
      .locator("span.font-mono.text-slate-100", { hasText: "col_02_ok" })
      .first();
    await shortCol.hover();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[role="tooltip"]').count(), 0);

    await vehiclesNode.getByRole("button", { name: "+22 more" }).click();
    await vehiclesNode
      .locator('[data-expanded="true"]')
      .waitFor({ state: "visible", timeout: 4000 });

    const expandedMetrics = await page.evaluate(() => {
      const vehNodeEl = document.querySelector('.react-flow__node[data-id="vehicles"]');
      const auditNodeEl = document.querySelector('.react-flow__node[data-id="audit_log"]');
      const listEl = vehNodeEl?.querySelector("ul");
      const parseZ = (el) => {
        const z = Number.parseInt(getComputedStyle(el).zIndex || "0", 10);
        return Number.isFinite(z) ? z : 0;
      };
      return {
        vehZ: parseZ(vehNodeEl),
        auditZ: parseZ(auditNodeEl),
        scrollHeight: listEl?.scrollHeight ?? 0,
        clientHeight: listEl?.clientHeight ?? 0,
      };
    });
    assert.ok(
      expandedMetrics.vehZ >= 1200 && expandedMetrics.vehZ > expandedMetrics.auditZ,
      `Expected expanded node zIndex >= 1200 and > neighbor (${JSON.stringify(expandedMetrics)})`,
    );
    assert.ok(
      expandedMetrics.clientHeight > 0 &&
        expandedMetrics.clientHeight <= 400 &&
        expandedMetrics.scrollHeight > expandedMetrics.clientHeight,
      `Expected capped scrollable ER attributes list (${JSON.stringify(expandedMetrics)})`,
    );

    const showLessBtn = vehiclesNode.getByRole("button", { name: "Show less" });
    assert.equal(await showLessBtn.isVisible(), true);
    await showLessBtn.click();
    await page.waitForTimeout(150);
    assert.equal(
      await vehiclesNode.locator('[data-expanded="true"]').count(),
      0,
    );
    const collapsedZ = await page.evaluate(() => {
      const vehNodeEl = document.querySelector('.react-flow__node[data-id="vehicles"]');
      const z = Number.parseInt(getComputedStyle(vehNodeEl).zIndex || "0", 10);
      return Number.isFinite(z) ? z : 0;
    });
    assert.ok(collapsedZ < 1200, `Expected collapsed zIndex < 1200, got ${collapsedZ}`);
    console.log("PASS 7: Auto-layout spacing, overflow tooltips, and elevated 30-attribute ER card verified.");

    assert.deepEqual(errors, [], `Browser errors: ${errors.join("; ")}`);
    console.log("PASS 8: Zero console/page errors.");
  } catch (err) {
    console.error("E2E FAILED. UI server logs:\n", serverLogs);
    throw err;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    proc.kill("SIGTERM");
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 3000);
      proc.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
    await fs.rm(tmpRepo, { recursive: true, force: true }).catch(() => {});
  }
}

await main();
