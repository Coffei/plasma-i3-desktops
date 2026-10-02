// Runs an isolated nested KWin (virtual backend) with the script installed.
//
// The approach follows HyprKwin's tests/e2e/sandbox.py (GPL-3.0,
// github.com/DGBooth/HyprKwin), reimplemented in Node. Everything lives in a
// temporary directory and on a private D-Bus, and the environment is scrubbed
// of the user's session, so tests never touch the running desktop.

import { execFile, spawn } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { findQtTool } from "../../tools/qt-tool.mjs";
import { FakeInput } from "./fakeinput.mjs";

const execFileAsync = promisify(execFile);

export const SCRIPT_ID = "plasma-i3-desktops";
const DUMP_SHORTCUT = "plasma-i3-desktops: Dump state";
const PROBE_DUMP_SHORTCUT = "pi3d-probe: Dump state";
const STATE_MARKER = "PLASMA_I3_DESKTOPS_STATE ";
const PROBE_MARKER = "PI3D_PROBE ";
const PACKAGE_DIR = resolve(import.meta.dirname, "../../package");
const CODE_DIR = join(PACKAGE_DIR, "contents/code");
const PROBES_DIR = resolve(import.meta.dirname, "probes");
const CLIENT_QML = resolve(import.meta.dirname, "client.qml");
const SOCKET = "wayland-pi3d";
// sun_path is 108 bytes including the terminating null byte.
const MAX_SOCKET_PATH = 107;
const SESSION_VARIABLES = [
  "WAYLAND_DISPLAY",
  "WAYLAND_SOCKET",
  "DISPLAY",
  "XAUTHORITY",
  "DBUS_SESSION_BUS_ADDRESS",
  "SESSION_MANAGER",
  "QT_QPA_PLATFORM",
];

const running = new Set();
process.on("exit", () => {
  for (const kwin of running) {
    kwin.kill("SIGKILL");
  }
});

/**
 * Starts a nested KWin and waits until the script is loaded.
 *
 * `config` maps config file names to `{group: {key: value}}` and is merged
 * over the defaults: per-screen desktops on, 10 desktops, the script enabled
 * and animations off. Debug is on by default, so state dumps include window
 * captions, which is how tests find their windows.
 *
 * With `script: false`, KWin runs without the script, for tests of KWin's own
 * behaviour; state() then comes from a probe instead.
 */
export async function startKwin({
  outputs = 2,
  width = 1920,
  height = 1080,
  perOutputDesktops = true,
  debug = true,
  script = true,
  config = {},
} = {}) {
  const kwin = new Kwin({ outputs, width, height, script });
  try {
    kwin.writeConfig(
      mergeConfig(
        {
          kwinrc: {
            Windows: { PerOutputVirtualDesktops: perOutputDesktops },
            Desktops: { Number: 10, Rows: 1 },
            Plugins: { [`${SCRIPT_ID}Enabled`]: script },
            [`Script-${SCRIPT_ID}`]: { Debug: debug },
          },
          kdeglobals: { KDE: { AnimationDurationFactor: 0 } },
        },
        config,
      ),
    );
    await kwin.installPackage();
    await kwin.start();
  } catch (error) {
    await kwin.stop();
    throw error;
  }
  return kwin;
}

class Kwin {
  constructor({ outputs, width, height, script }) {
    this.scriptRunning = script;
    this.args = [
      "--virtual",
      "--no-lockscreen",
      "--socket",
      SOCKET,
      "--width",
      String(width),
      "--height",
      String(height),
      "--output-count",
      String(outputs),
    ];
    this.base = mkdtempSync(join(tmpdir(), "pi3d-"));
    this.dirs = Object.fromEntries(
      ["config", "data", "runtime", "cache", "state"].map((name) => [name, join(this.base, name)]),
    );
    for (const dir of Object.values(this.dirs)) {
      mkdirSync(dir, { mode: 0o700 });
    }
    if (join(this.dirs.runtime, SOCKET).length > MAX_SOCKET_PATH) {
      throw new Error(
        `Wayland socket path under ${this.base} is too long; set TMPDIR to a shorter path`,
      );
    }
    this.logPath = join(this.base, "kwin.log");
    this.busFile = join(this.base, "bus");
    this.clients = [];
    this.probeCount = 0;
    this.actionRuns = 0;
    this.env = { ...process.env };
    for (const key of SESSION_VARIABLES) {
      delete this.env[key];
    }
    Object.assign(this.env, {
      XDG_CONFIG_HOME: this.dirs.config,
      XDG_DATA_HOME: this.dirs.data,
      XDG_RUNTIME_DIR: this.dirs.runtime,
      XDG_CACHE_HOME: this.dirs.cache,
      XDG_STATE_HOME: this.dirs.state,
      QT_FORCE_STDERR_LOGGING: "1",
      // Lets the tests move the pointer through fake input.
      KWIN_WAYLAND_NO_PERMISSION_CHECKS: "1",
    });
  }

  writeConfig(files) {
    for (const [file, groups] of Object.entries(files)) {
      const text = Object.entries(groups)
        .map(
          ([group, entries]) =>
            `[${group}]\n` +
            Object.entries(entries)
              .map(([key, value]) => `${key}=${value}\n`)
              .join(""),
        )
        .join("\n");
      writeFileSync(join(this.dirs.config, file), text);
    }
  }

  async installPackage() {
    await execFileAsync("kpackagetool6", ["--type=KWin/Script", "--install", PACKAGE_DIR], {
      env: this.env,
    });
  }

  async start() {
    const logFd = openSync(this.logPath, "a");
    const kwinCommand = ["exec", "kwin_wayland", ...this.args].join(" ");
    this.process = spawn(
      "dbus-run-session",
      ["--", "sh", "-c", `echo "$DBUS_SESSION_BUS_ADDRESS" > "${this.busFile}"; ${kwinCommand}`],
      { env: this.env, detached: true, stdio: ["ignore", logFd, logFd] },
    );
    closeSync(logFd);
    running.add(this);

    this.busAddress = await this.waitFor(() => readIfExists(this.busFile).trim(), {
      message: "D-Bus session did not start",
    });
    if (this.scriptRunning) {
      await this.waitUntilScriptRuns();
    } else {
      await this.waitFor(() => this.isScriptLoaded().then(() => this.kwinAnswers), {
        timeout: 10000,
        message: "KWin did not start",
      });
      await this.runProbe("dumper.qml");
      await this.waitFor(() => this.probeMessages().some((m) => m.probe === "dumper"));
    }
  }

  async waitUntilScriptRuns() {
    await this.waitFor(() => this.isScriptLoaded(), {
      timeout: 10000,
      message: "script was not loaded",
    });
    // QML errors are reported right after loading.
    await sleep(300);
    const errors = this.qmlErrors();
    if (errors.length) {
      throw new Error(`QML errors:\n${errors.join("\n")}`);
    }
  }

  /** Stops the script, e.g. to set up a scene it would otherwise react to. */
  async unloadScript() {
    await this.dbus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", SCRIPT_ID);
    await this.waitFor(async () => !(await this.isScriptLoaded()), {
      message: "script was not unloaded",
    });
    this.scriptRunning = false;
  }

  /** Starts the script again; it then rebuilds its state as at startup. */
  async loadScript() {
    await this.dbus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.start");
    await this.waitUntilScriptRuns();
    this.scriptRunning = true;
  }

  /** Calls a D-Bus method on the private bus and returns gdbus' textual result. */
  async dbus(dest, path, method, ...args) {
    const { stdout } = await execFileAsync("gdbus", [
      "call",
      "--address",
      this.busAddress,
      "--dest",
      dest,
      "--object-path",
      path,
      "--method",
      method,
      ...args.map(toGVariant),
    ]);
    return stdout.trim();
  }

  async isScriptLoaded() {
    try {
      const reply = await this.dbus(
        "org.kde.KWin",
        "/Scripting",
        "org.kde.kwin.Scripting.isScriptLoaded",
        SCRIPT_ID,
      );
      this.kwinAnswers = true;
      return reply === "(true,)";
    } catch {
      return false;
    }
  }

  /** Changes a config value of the running KWin; call reconfigure() to apply it. */
  async setConfig(file, group, key, value) {
    await execFileAsync(
      "kwriteconfig6",
      ["--file", file, "--group", group, "--key", key, String(value)],
      { env: this.env },
    );
  }

  async reconfigure() {
    await this.dbus("org.kde.KWin", "/KWin", "org.kde.KWin.reconfigure");
  }

  /** Triggers a KWin shortcut (KWin's own or the script's) by its name. */
  async invokeShortcut(name) {
    await this.dbus(
      "org.kde.kglobalaccel",
      "/component/kwin",
      "org.kde.kglobalaccel.Component.invokeShortcut",
      name,
    );
  }

  /** Returns the script's state dump (see snapshot.mjs) plus `active` and `model`. */
  async state() {
    const dumpsBefore = this.stateDumps().length;
    await this.invokeShortcut(this.scriptRunning ? DUMP_SHORTCUT : PROBE_DUMP_SHORTCUT);
    // A line still being written does not parse yet, so keep polling.
    return this.waitFor(
      () => {
        const dumps = this.stateDumps();
        return dumps.length > dumpsBefore ? parseJson(dumps.at(-1)) : undefined;
      },
      { message: "no state dump" },
    );
  }

  /**
   * Opens a test window titled `caption` and returns it from the state dump
   * once KWin manages it.
   */
  async spawnWindow(caption) {
    const logFd = openSync(this.logPath, "a");
    const client = spawn(findQtTool("qml", "QML_BIN"), [CLIENT_QML, "--", caption], {
      env: this.clientEnv(),
      stdio: ["ignore", logFd, logFd],
    });
    closeSync(logFd);
    client.caption = caption;
    this.clients.push(client);
    return this.waitForWindow(caption);
  }

  /** Closes a window opened by spawnWindow() and waits until KWin has let go of it. */
  async closeWindow(caption) {
    this.clients.find((client) => client.caption === caption).kill("SIGTERM");
    await this.waitFor(
      async () => !(await this.state()).windows.some((w) => w.caption === caption && !w.deleted),
      { message: `window "${caption}" did not close` },
    );
  }

  /** Environment for programs that talk to the nested KWin. */
  clientEnv() {
    return {
      ...this.env,
      WAYLAND_DISPLAY: SOCKET,
      QT_QPA_PLATFORM: "wayland",
      DBUS_SESSION_BUS_ADDRESS: this.busAddress,
    };
  }

  /** Moves the pointer by (dx, dy) like a real mouse, see fakeinput.mjs. */
  async movePointer(dx, dy) {
    await (await this.input()).movePointer(dx, dy);
  }

  /** Presses or releases a mouse button (e.g. fakeinput.mjs BTN_LEFT). */
  async pointerButton(code, pressed) {
    await (await this.input()).button(code, pressed);
  }

  /** Presses or releases a key (e.g. fakeinput.mjs KEY_LEFTMETA). */
  async keyboardKey(code, pressed) {
    await (await this.input()).key(code, pressed);
  }

  async input() {
    this.fakeInput ??= await FakeInput.connect(join(this.dirs.runtime, SOCKET));
    return this.fakeInput;
  }

  /** Turns a virtual output off or on, as unplugging or plugging a monitor does. */
  async setOutputEnabled(name, enabled) {
    this.markOutputChange();
    await execFileAsync("kscreen-doctor", [`output.${name}.${enabled ? "enable" : "disable"}`], {
      env: this.clientEnv(),
      timeout: 20000,
    });
  }

  /** Moves a virtual output, e.g. below another one, through output management. */
  async setOutputPosition(name, x, y) {
    this.markOutputChange();
    await execFileAsync("kscreen-doctor", [`output.${name}.position.${x},${y}`], {
      env: this.clientEnv(),
      timeout: 20000,
    });
    await this.waitFor(
      async () => {
        const output = (await this.state()).outputs.find((o) => o.name === name);
        return output.geometry.x === x && output.geometry.y === y;
      },
      { message: `${name} did not move to ${x},${y}` },
    );
  }

  markOutputChange() {
    this.settledBefore ??= this.settledCount();
  }

  settledCount() {
    return this.log().match(/plasma-i3-desktops: outputs settled/g)?.length ?? 0;
  }

  /** Waits until the script has handled the output changes made since the last wait. */
  async waitForOutputsSettled() {
    const before = this.settledBefore ?? this.settledCount();
    await this.waitFor(() => this.settledCount() > before, {
      timeout: 10000,
      message: "outputs did not settle",
    });
    this.settledBefore = undefined;
  }

  /**
   * Makes KWin calls through the actions probe (see probes/actions.qml) and
   * waits until they have been made.
   */
  async act(...actions) {
    const run = ++this.actionRuns;
    const probe = await this.runProbe("actions.qml", { run, actions });
    const result = await this.waitFor(
      () => this.probeMessages().find((m) => m.probe === "actions" && m.run === run),
      { message: "actions probe did not finish" },
    );
    await probe.unload();
    if (result.error) {
      throw new Error(`action failed: ${result.error}`);
    }
  }

  async waitForWindow(caption, predicate = () => true) {
    return this.waitFor(
      async () => (await this.state()).windows.find((w) => w.caption === caption && predicate(w)),
      { timeout: 10000, message: `window "${caption}" did not appear` },
    );
  }

  /**
   * Loads and runs a one-off KWin script from tests/e2e/probes.
   *
   * The probe can `import "params.mjs" as Params` to read `params`, and
   * import the script's modules (e.g. "snapshot.mjs"). Probes report back by
   * logging `PI3D_PROBE <json>`, see probeMessages().
   */
  async runProbe(file, params = {}) {
    const name = `pi3d-probe-${++this.probeCount}`;
    const dir = join(this.base, "probes", name);
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(PROBES_DIR, file), join(dir, "main.qml"));
    for (const module of readdirSync(CODE_DIR)) {
      copyFileSync(join(CODE_DIR, module), join(dir, module));
    }
    writeFileSync(join(dir, "params.mjs"), `export const params = ${JSON.stringify(params)};\n`);
    const reply = await this.dbus(
      "org.kde.KWin",
      "/Scripting",
      "org.kde.kwin.Scripting.loadDeclarativeScript",
      join(dir, "main.qml"),
      name,
    );
    const id = Number(reply.match(/-?\d+/)[0]);
    if (id < 0) {
      throw new Error(`probe ${file} could not be loaded`);
    }
    await this.dbus("org.kde.KWin", `/Scripting/Script${id}`, "org.kde.kwin.Script.run");
    return {
      name,
      unload: () =>
        this.dbus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", name),
    };
  }

  probeMessages() {
    return this.log()
      .split("\n")
      .filter((line) => line.includes(PROBE_MARKER))
      .map((line) => parseJson(line.slice(line.indexOf(PROBE_MARKER) + PROBE_MARKER.length)))
      .filter(Boolean);
  }

  stateDumps() {
    return this.log()
      .split("\n")
      .filter((line) => line.includes(STATE_MARKER))
      .map((line) => line.slice(line.indexOf(STATE_MARKER) + STATE_MARKER.length));
  }

  log() {
    return readIfExists(this.logPath);
  }

  /** Lines reporting QML errors in the script or in a probe. */
  qmlErrors() {
    return this.log()
      .split("\n")
      .filter((line) => line.includes(`${SCRIPT_ID}/contents/`) || line.includes("/probes/"));
  }

  async waitForLog(pattern, options = {}) {
    return this.waitFor(() => pattern.test(this.log()), {
      message: `log did not match ${pattern}`,
      ...options,
    });
  }

  /** Polls `predicate` until it returns a truthy value, and returns that value. */
  async waitFor(predicate, { timeout = 5000, interval = 50, message = "condition not met" } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await predicate();
      if (value) {
        return value;
      }
      if (Date.now() > deadline) {
        throw new Error(`${message} within ${timeout} ms\n--- KWin log ---\n${this.log()}`);
      }
      await sleep(interval);
    }
  }

  /** Signals the whole process group: dbus-run-session, D-Bus and KWin. */
  kill(signal) {
    try {
      process.kill(-this.process.pid, signal);
      return true;
    } catch {
      return false;
    }
  }

  async stop() {
    this.fakeInput?.close();
    for (const client of this.clients) {
      client.kill("SIGKILL");
    }
    if (this.process) {
      this.kill("SIGTERM");
      // dbus-run-session exits first; KWin keeps writing its config while it
      // shuts down, so wait for the whole group before removing the files.
      const deadline = Date.now() + 5000;
      while (this.kill(0)) {
        if (Date.now() > deadline) {
          this.kill("SIGKILL");
        }
        await sleep(50);
      }
      running.delete(this);
    }
    if (!process.env.PI3D_KEEP_TMP) {
      rmSync(this.base, { recursive: true, force: true });
    }
  }
}

function mergeConfig(defaults, overrides) {
  const merged = structuredClone(defaults);
  for (const [file, groups] of Object.entries(overrides)) {
    merged[file] ??= {};
    for (const [group, entries] of Object.entries(groups)) {
      merged[file][group] = { ...merged[file][group], ...entries };
    }
  }
  return merged;
}

function toGVariant(value) {
  if (typeof value === "string") {
    return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  }
  return String(value);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readIfExists(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
