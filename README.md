# Plasma i3 desktops

i3-style per-monitor workspaces for KDE Plasma 6.7+ on Wayland, as a KWin script.

> [!WARNING]
> **This project is fully AI-generated.** The code was written by Claude (Anthropic) through Claude
> Code. I provided the requirements and expecyed behavior, but then let AI run wild. I did verify it
> works alright on my machine, but use at your own risk.

Every virtual desktop becomes a workspace that lives on one monitor:

- switching to a workspace takes you to the monitor it lives on;
- workspaces can be moved between monitors, windows included;
- workspaces follow their monitor across unplug and replug.

No tiling: window layout stays with KWin, or with any tiling script running alongside.

## What it provides

- **Switching to workspace by its number** (`Meta+1` … `Meta+9`, `Meta+0` for 10):
  - if the workspace lives on another monitor, the monitor is focused and the workspace is shown there.
    - mouse pointer moves with the focus to the center of the focused window.
  - if workspace is not in use yet it appears on the current monitor and lives there from then on.
  - selecting currently focused workspaces does nothing
- **Moving the current workspace to other monitor** (`Meta+Ctrl+arrow`):
  - workspace is moved with its windows, focus and mouse pointer.
  - the monitor left behind changes to other workspace (LRU or an unused one)
  - with no monitor in that direction nothing happens - no wrap-around.
- **Handling monitor changes**
  - unplugging a monitor moves its workspaces to the focused monitor.
  - plugging a monitor back in restores the workspaces as they were before.
  - monitors are recognised by their EDID data (manufacturer, model, serial number), so a monitor
  keeps its workspaces when it comes back on another connector.
- **Plasma integration**
  - attempts to integrate with plasma native actions. So moving windows to workspaces, changing
    virtual desktops all should work fine.

## Requirements

- KDE Plasma 6.7 or newer, Wayland session (tested with 6.7.5).
- "Switch desktop independently for each screen" turned on. Without it the script stays inactive
  and logs a warning.
- 10 virtual desktops, one per workspace shortcut. With fewer, the shortcuts beyond them do
  nothing.
- Focus policy "Click to focus" or "Focus follows mouse". With "Focus under mouse" and "Focus
  strictly under mouse" the script cannot move focus to another monitor.

## Installation

From a clone of this repository:

```sh
kpackagetool6 --type KWin/Script --install package
```

Then set it up:

1. **Virtual desktops:** in System Settings → Window Management → Virtual Desktops, turn on
   "Switch desktop independently for each screen" and add desktops until there are 10.
2. **Free the default shortcuts.** Plasma already uses them, and a key that another action holds
   is not given to the script. In System Settings → Keyboard → Shortcuts, remove:
   - `Meta+1` … `Meta+9` from "Activate Task Manager Entry 1" … "9";
   - `Meta+Ctrl+Left/Right/Up/Down` from KWin's "Switch One Desktop to the Left/Right/Up/Down".
3. **Enable the script:** in System Settings → Window Management → KWin Scripts, tick
   "i3 Desktops" and apply.
4. If you enabled the script before step 2, assign its keys by hand: search for "i3 Desktops" in
   the Shortcuts page.
5. **Recommended: keys to move windows to a workspace.** KWin's "Window to Desktop 1" … "10" do
   this, and with the script the window goes to the workspace's monitor. They have no keys by
   default; assign them, e.g. `Meta+Shift+1` … `Meta+Shift+0` as in i3. 

Optional: in the Pager widget's settings, "Show only current screen" makes each monitor's Pager
show what that monitor shows. I also use that config in the Task Manager and for Alt-Tab switching,
so all these places only show the current workspace content.

**Updating:** run `kpackagetool6 --type KWin/Script --upgrade package`, then log out and back in;
KWin keeps running the old code until then.

**Removing:** untick the script in KWin Scripts, then run
`kpackagetool6 --type KWin/Script --remove plasma-i3-desktops`.

## Shortcuts

All are in System Settings → Keyboard → Shortcuts, under KWin, named "i3 Desktops: …".

| Default | Action |
|---|---|
| `Meta+1` … `Meta+9`, `Meta+0` | Switch to workspace 1 … 10 |
| `Meta+Ctrl+Left/Right/Up/Down` | Move workspace to the monitor on the left / on the right / above / below |
| none | Dump state to the journal (debug), see [Troubleshooting](#troubleshooting) |

Moving a window to workspace N uses KWin's own "Window to Desktop N" (setup step 5).

"Reset to default" in the Shortcuts page clears these keys instead of restoring them, because the
script assigns them without registering them as defaults. Set them again by hand.

## Settings

In System Settings → Window Management → KWin Scripts, the configure button next to "i3 Desktops":

| Setting | Default | |
|---|---|---|
| Wait for monitor changes to settle | 750 ms | Monitors, docks in particular, come and go in bursts. The script acts once they have been stable this long, and ignores its shortcuts meanwhile. |
| Log debug messages to the journal | off | Logs what the script does, including window titles. |

Settings take effect when KWin next reads its configuration: when the script is re-enabled, after
logging in again, or on

```sh
gdbus call --session --dest org.kde.KWin --object-path /KWin --method org.kde.KWin.reconfigure
```

## Known limitations

- Wayland only; X11 is not supported.
- One activity only; activities are not taken into account.
- KWin can only focus the first 8 monitors (its "Switch to Screen 0–7" shortcuts).
- Windows on all desktops, or on several, are left alone and don't tie a workspace to a monitor.
- A window rule that forces a window onto a monitor wins over its workspace's location.
- The script remembers where the workspaces of unplugged monitors belong only while it runs. After
  logging in again or re-enabling the script, they stay where they are.
- If all 10 workspaces are in use, a monitor that needs another one has none to show. A workspace
  move then does nothing, and in other cases the monitor keeps showing a workspace that lives
  elsewhere. Either way the script logs a warning.
- Pager and Overview switches are corrected right after KWin has made them. No flicker showed in
  testing, but other scripts and effects do see the switch.
- With "Focus follows mouse", a window covering the centre of the focused window (e.g. one kept
  above) takes focus once the pointer lands there.
- There is no i3 feature parity. I just implemented what I needed.

## Troubleshooting

1. Look for the script's messages:
   ```sh
   journalctl --user -b | grep -i plasma-i3-desktops
   ```
   Warnings, e.g. about the per-screen setting or too few desktops, show up without debugging.
2. For more detail, turn on "Log debug messages to the journal" (see [Settings](#settings)) and
   repeat what went wrong.
3. Dump the script's state, either with a key assigned to "i3 Desktops: Dump state to the journal
   (debug)", or with:
   ```sh
   gdbus call --session --dest org.kde.kglobalaccel --object-path /component/kwin \
     --method org.kde.kglobalaccel.Component.invokeShortcut "plasma-i3-desktops: Dump state"
   ```
   It is logged as a `PLASMA_I3_DESKTOPS_STATE` line. With debugging on, debug messages and the
   dump include window titles, so check them before you share them.

## How it works

KWin already lets every monitor show its own virtual desktop. The script adds the rule that each
desktop lives on one monitor:

- it reads KWin's state and works out where each workspace lives;
- after every change, whether by the user, the Pager, KWin or a monitor, it moves windows and
  switches desktops until that holds again.

Scripts cannot focus a monitor or move the pointer themselves, so the script invokes KWin's own
"Switch to Screen", "Move Mouse to Focus" and "Move Mouse to Center" shortcuts over D-Bus.

The design, the decisions behind it and the KWin behaviour it relies on are in
[screen-workspaces-spec.md](screen-workspaces-spec.md).

## Development

Project layout:

- `package/`: the KWin script.
  - `contents/ui/main.qml` connects KWin to the logic.
  - `contents/code/*.mjs` is the logic, as plain JavaScript modules without KWin dependencies.
  - `contents/config/` and `contents/ui/config.ui` are the settings.
- `tests/unit/`: tests of the logic, using `node:test`.
- `tests/e2e/`: tests against a nested KWin.
- `tests/manual/`: checks only a real session can do.
- `tools/`: helpers for formatting and finding Qt tools.

Commands (Node.js 22 or newer):

```sh
npm install        # Prettier
npm run format     # Prettier for JS and JSON, qmlformat for QML; run before committing
npm test           # unit tests
npm run test:e2e   # end-to-end tests in a nested KWin
```

The end-to-end tests start an isolated `kwin_wayland --virtual` on a private D-Bus, with
temporary config and runtime directories, so they don't touch your session. They:

- need `kwin_wayland`, `dbus-run-session`, `kpackagetool6`, `kwriteconfig6`, `kscreen-doctor`,
  `gdbus` and Qt's `qml` runtime;
- find Qt tools in `PATH` or the usual Qt directories; `QML_BIN`, `QMLFORMAT` and `UIC` override
  that;
- cannot run inside sandboxes that block Unix sockets;
- need a short `TMPDIR`, because Wayland socket paths are limited to 108 bytes;
- keep each test's KWin log if `PI3D_KEEP_TMP=1` is set.

## License

GPL-3.0-or-later, see [LICENSE](LICENSE).
