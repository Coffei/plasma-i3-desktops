# Plasma i3 desktops extension — i3-style per-monitor workspaces for KDE Plasma 6.7

A KWin script that turns Plasma's virtual desktops into i3-style workspaces:
every workspace lives on exactly one monitor, switching to a workspace takes you
to its monitor, and workspaces follow their monitor across unplug/replug.

**No tiling.** This script only manages *where* workspaces live and *which
monitor shows which workspace*. Window geometry is left to KWin (and to any
tiling script the user may run alongside later).

---

## 0. Instructions for the implementer

1. **Read this whole document first.** Section 6 records the design decisions;
   all are settled. If implementation shows that one has to change, update this
   spec and confirm with the user first.
2. **Verify every KWin API you use** against the KWin 6.7 sources
   (`invent.kde.org/plasma/kwin`, `src/scripting/`) or the scripting console
   (`Alt+F2` → `wm console`) before relying on it. Section 3 marks which APIs are
   known to work (used by an existing 6.7 script) and which are assumptions.
   Source references (`src/…:line`) point to KWin v6.7.5.
3. Build in the milestones of section 9, in order. Each milestone must be
   usable on its own.
4. Write the end-to-end test harness (section 8) early — multi-monitor and
   hotplug behaviour cannot be verified by unit tests alone.

---

## 1. Goals and non-goals

### Goals
- Each virtual desktop ("workspace") is located on **one** monitor at a time.
- `Switch to workspace N`:
  - if N is located on a monitor (it has windows or is currently shown), focus
    that monitor and show N there;
  - otherwise (N is empty and not shown anywhere), show N on the **current**
    monitor, which makes that its location.
- `Move current workspace to the monitor left/right/up/down`.
- Focus and pointer move together: after every focus change the script makes,
  the pointer is at the centre of the focused window (or of the monitor, if
  the workspace is empty).
- Unplugging a monitor moves its workspaces to a remaining monitor but
  **remembers their home monitor**; replugging moves them back.
- Switches made outside the script (Plasma's pager, Overview, KWin's desktop
  shortcuts) end up like the script's own `Switch to workspace N`.

### Non-goals (for now)
- Tiling, gaps, window layout of any kind.
- X11 (Wayland only — per-output desktops are a Wayland/6.7 feature).
- Activities (assume a single activity; see 6.12).
- A custom panel widget. Plasma's Pager (with "show only current screen") and
  Kara (git main) already display per-screen desktops correctly.

---

## 2. Environment and assumptions

- KDE Plasma **6.7+**, Wayland session.
- `Window Management → Virtual Desktops → "Switch desktop independently for
  each screen"` is **on** (`kwinrc [Windows] PerOutputVirtualDesktops=true`).
  - If it is off, the script must do nothing harmful: log a clear message
    (and ideally show it in the config dialog) and stay inactive. Re-check when
    the option changes (`options.perOutputVirtualDesktopsChanged`).
- 10 virtual desktops are configured (6.10).
- Plasma's model: all desktops exist on all monitors; each monitor has its own
  "current desktop"; a window belongs to one or more desktops and is located on
  one output. A window is visible when its output's current desktop is one of
  its desktops.
- The user will disable Plasma's built-in desktop-switching shortcuts that
  collide with ours (document which in the README).
- Focus policy is *Click to focus* or *Focus follows mouse*. KWin's
  `Switch to Screen` (6.1) does nothing with the "under mouse" policies.

---

## 3. KWin scripting API

Implement as a **QML KWin script** (`X-Plasma-API: declarativescript`,
`main.qml`), not a plain JS script. Reasons: `Timer` for debouncing, `DBusCall`
for invoking KWin shortcuts (pointer warp), and easier state handling. Logic
lives in plain JavaScript ES modules (`.mjs`), imported both by `main.qml` and by
the unit tests. No build step, no TypeScript. Those modules may only use what
KWin's JavaScript engine understands: object spread (`{...x}`) fails to load,
`?.` and `??` work. Every e2e test loads the script, so violations show up
there.

### Known to work on 6.7 (used by an existing script, HyprKwin)
| API | Use |
|---|---|
| `options.perOutputVirtualDesktops` | detect whether per-screen desktops are on |
| `workspace.currentDesktopForScreen(output)` | which desktop an output shows |
| `workspace.setCurrentDesktopForScreen(desktop, output)` | show a desktop on one output |
| `workspace.screens`, `workspace.screenOrder` | list outputs |
| `output.name`, `output.geometry` | identity and position of an output |
| `workspace.activeScreen` (read) | KWin's idea of the active output |
| `workspace.activeWindow` (read/write) | focus a window |
| `workspace.sendClientToScreen(window, output)` | move a window to another output |
| `workspace.desktops`, `workspace.currentDesktop` | desktop list |
| `window.desktops` (read/write), `window.output`, `window.onAllDesktops` | window placement |
| signals: `workspace.windowAdded`, `workspace.windowActivated`, `workspace.currentDesktopChanged`, `workspace.desktopsChanged`, `workspace.screensChanged`, `window.desktopsChanged`, `window.outputChanged` | change tracking |
| `registerShortcut(...)` (QML: `ShortcutHandler`) | keybindings |
| D-Bus `org.kde.kglobalaccel` `/component/kwin` `org.kde.kglobalaccel.Component.invokeShortcut("MoveMouseToFocus")` | move pointer to the focused window |

### Verified in the KWin v6.7.5 sources (not yet at runtime)
| API | Use |
|---|---|
| `workspace.currentDesktopChanged(previous, current, output)` | fires synchronously for every per-output switch, also on non-active outputs: pager, Overview, KWin shortcuts, our own calls (`src/scripting/workspace_wrapper.h:262`, `src/virtualdesktops.cpp:589`) |
| `output.manufacturer`, `output.model`, `output.serialNumber` | EDID identity (6.6); empty on the virtual backend |
| `workspace.activeScreen` | **read-only**; KWin sets it on every pointer move and every window activation (6.1) |
| `invokeShortcut("Switch to Screen <i>")`, i = 0–7 | focus output `screenOrder[i]`, also when it has no windows; does not move the pointer |
| `invokeShortcut("MoveMouseToCenter")` | move pointer to the centre of the active output |
| `options.perOutputVirtualDesktopsChanged` | per-output desktops toggled |
| `workspace.createDesktop(position, name)`, `workspace.removeDesktop(desktop)` | not used (6.10) |

### KWin behaviour the design depends on (from the sources)
- **`sendClientToScreen` can change the window's desktop.** If the target
  output's current desktop is not one of the window's desktops, KWin replaces
  the source output's current desktop with the target's
  (`src/window.cpp:4670`, called from `sendToOutput`, `:3922`). Either show the
  workspace on the target first (5.3), or set `window.desktops` back afterwards
  (5.4, 5.5).
- **The same code handles user moves.** Dragging a window to another output or
  KWin's "Window to Screen" shortcuts already put the window into the workspace
  shown on the destination (6.8).
- **Unplug:** KWin moves each window to the output nearest its centre and keeps
  its desktops (`src/workspace.cpp:2338`). With 3+ outputs one workspace can
  end up split over two outputs.
- **Replug:** for an output layout it has seen before, KWin restores each
  window's previous output and geometry (`src/placementtracker.cpp:78`), also
  for windows the script moved in the meantime. Desktops are kept.

### Verified at runtime (e2e tests `tests/e2e/kwin-*.test.mjs`)
- **Pointer warp** (`kwin-pointer.test.mjs`): `Switch to Screen <i>` followed
  by `MoveMouseToCenter`, sent as two `DBusCall`s, makes output i active and puts
  the pointer at its centre, also with no windows on it. A window opened
  afterwards lands there. Activating a window and then `MoveMouseToFocus` puts
  the pointer at the window's centre. Without plasmashell (the e2e setup) an
  empty output has no desktop window, so keyboard focus stays on the previous
  window; a real session focuses the desktop window instead (checked by hand,
  below).
- **Window moves and hotplug** (`kwin-outputs.test.mjs`), with outputs turned
  off and on through `kscreen-doctor`. That stands in for unplugging; DPMS and
  dock bursts are not covered.
  - `sendClientToScreen` to an output showing another desktop moves the window
    to that desktop; showing the window's desktop on the target first keeps it.
  - Unplug: windows move to the nearest remaining output (by their centre) and
    keep their desktops; the remaining output keeps showing its desktop. With
    three outputs, the middle one's windows split between its neighbours. KWin
    emits one `screensChanged` and no `currentDesktopChanged`.
  - Replug: windows go back to their previous output and geometry, also after
    a non-interactive move while the output was away, and keep their desktops.
    The output shows the desktop it showed before unplug, **without** a
    `currentDesktopChanged` signal, so the hotplug handler must read what each
    output shows after `screensChanged`.
  - Virtual outputs have empty manufacturer, model and serial number.
- **Undoing a Plasma switch** (`kwin-desktop-switch.test.mjs`). Correcting
  inside `currentDesktopChanged` gives the right end state and leaves no effect
  running, but scripts connected after ours receive the correction's signal
  before the switch it corrects (`2->1`, then `1->2`), so they end up believing
  the wrong desktop is shown. Deferring the correction with `Qt.callLater`
  keeps the order. KWin's own handlers connect before any script and are not
  affected.

### Checked by hand in a real session (`tests/manual/README.md`)
Plasma 6.7.5, two monitors, *Focus follows mouse*, *Fade Desktop* effect.
- **Pager correction (5.7):** clicking a desktop on monitor A's pager that is
  shown on monitor B left A on its desktop without noticeable flicker, both
  with the deferred and the synchronous correction.
- **Empty monitor (6.1):** `Switch to Screen <i>` moved keyboard focus to the
  empty monitor's desktop. The index is the monitor's position in
  `workspace.screenOrder`, not its position on screen.

---

## 4. Terminology and state model

- **Workspace** = a Plasma virtual desktop. Identified by its desktop `id`
  (stable) and displayed by its position number (1-based).
- **Output** = a monitor, identified by its **output key** (6.6), e.g.
  `HP Inc.|HP U28 4K HDR|1CR2021B9B`, or the connector name (`DP-2`) when EDID
  data is missing or ambiguous. Store keys, never output objects, in state —
  objects die on unplug. Logs show the full name
  (`HP Inc. HP U28 4K HDR 1CR2021B9B`) plus the connector.
- **Focused output** = `workspace.activeScreen`, read when needed, never
  stored (5.9).
- **Managed window** = a window the script cares about (see 5.8 for the
  filter).
- A workspace is **occupied** if at least one managed window has it in
  `window.desktops` (excluding `onAllDesktops` windows).
- A workspace is **shown** on output O if `currentDesktopForScreen(O) === it`.
- A workspace is **mapped** if it is occupied or shown. Only mapped workspaces
  have a location.

### Script state
```
location:  Map<desktopId, outputKey>    // where the workspace lives now
home:      Map<desktopId, outputKey>    // where it wants to live (differs from
                                        // location only after an evacuation)
previous:  Map<outputKey, desktopId>    // what each output showed before its
                                        // current workspace (6.2)
```
There is no `lastShown`: KWin itself shows on a returning output the desktop
it showed before it was unplugged (§3).

### Invariants (enforce after every event)
- **I1** — A workspace is shown on at most one output.
- **I2** — Every connected output shows exactly one workspace.
- **I3** — Every managed, single-desktop window of workspace W is on output
  `location[W]`.
- **I4** — `location[W]` is a connected output for every mapped W.
- **I5** — Unmapped workspaces have no `location` (but see 6.4 about `home`).
- **I6** — A shown workspace is shown at its location: if O shows W, then
  `location[W]` is O. Together with I3, the windows of a shown workspace are on
  the output showing it.

Write one `reconcile()` function that, given current KWin state, restores all
invariants with the minimum number of changes, and call it (debounced) after
every relevant signal. Event handlers should mostly update intent (`location`,
`home`) and then call `reconcile()`. Guard against reacting to
our own changes (a re-entrancy counter around every mutation).

---

## 5. Behaviour specification

### 5.1 Startup / script enable
1. Read outputs and what each shows.
2. Rebuild `location` from windows: for each occupied workspace, its location is
   the output holding its managed windows. If its windows are spread over
   several outputs, see 6.8.
3. Shown workspaces that are unoccupied get the output showing them.
4. Fix I1 and I6 (6.3).

No config persistence is needed for this — the window positions *are* the
state. (KWin scripts cannot write their own config without a D-Bus helper.)

### 5.2 Switch to workspace N (`Meta+N` by default)
Let W = desktop N, F = the focused output.
1. If W is mapped and `location[W]` is connected → target T = `location[W]`.
2. Else → T = F, and W gets `location[W] = home[W] = F`.
3. If T does not already show W: `setCurrentDesktopForScreen(W, T)`.
4. If T ≠ F, focus T and warp the pointer (6.1): KWin focuses the most
   recently used window of W on T, and the pointer goes to its centre; if W
   has no visible window there, to T's centre. If T = F, KWin focuses W's most
   recently used window by itself and the pointer stays where it is, like
   i3's `mouse_warping output`.
5. If the workspace T showed before is now unmapped (empty and not shown),
   drop its location.
6. **Same workspace again**: if W is already shown on F, do nothing (optionally
   `back_and_forth` — see 6.9).

### 5.3 Move current workspace to the monitor in direction D
(`Meta+Ctrl+Arrow` by default, see 5.10.)
Let F = the focused output, W = workspace shown on F, T = the neighbour of F in
direction D (6.5). If there is no neighbour, do nothing.
1. T shows W. This must happen before step 2, otherwise KWin moves the windows
   to T's current desktop (§3).
2. Move all managed windows of W from F to T (`sendClientToScreen`),
   minimized ones too. KWin keeps a window that was inside F inside T
   (`moveToArea`, `src/window.cpp:3838`) and moves dialogs along with their
   parent, so nothing needs clamping.
3. `location[W] = home[W] = T` (an explicit move resets home).
4. What F shows afterwards is decided by 6.2; the workspace T showed before
   counts as free once it is hidden and empty. If F would have nothing to show
   (6.10), nothing moves and the script warns.
5. Focus follows the workspace to T and the pointer is warped (6.1): to the
   focused window's centre, or to T's centre if W has no visible window.

### 5.4 Monitor unplugged
Debounce: act only after outputs have been stable for ~750 ms (6.7).
For each disconnected output X:
1. Fallback output Y = the focused output if still connected, else the first
   connected output in `screenOrder`.
2. For every workspace W with `location[W] === X`: `location[W] = Y`, keep
   `home[W] = X`. KWin has already moved the windows to the nearest outputs,
   keeping desktop W (§3). Send the ones not on Y to Y and set their
   `window.desktops` back to `[W]`.
3. Y keeps showing what it showed; evacuated workspaces are hidden on Y until
   the user switches to them.
4. Re-check I1–I6.

### 5.5 Monitor (re)connected
After the debounce, for each newly connected output X:
1. Every workspace W with `home[W] === X` and `location[W] !== X`:
   move its windows back to X, `location[W] = X`. KWin may already have
   restored most of them (§3); move only the rest. KWin may also restore windows
   to X whose workspace now lives elsewhere (moved by 5.3 while X was away);
   send those back to their workspace's location. After every
   `sendClientToScreen`, set `window.desktops` back to the workspace.
2. KWin shows on X what X showed before it was unplugged (§3). If that
   workspace no longer lives on X, X switches per 6.2: its previous workspace,
   else the lowest-numbered one living on X, else a free one.
3. Any output that was showing a workspace which just left needs a new one (6.2).
4. Brand-new outputs with no history just get a free workspace.
5. Do **not** move focus or the pointer to the new monitor.

### 5.6 New window opened
KWin opens a new window on the active output and on the desktop shown there
(`src/xdgshellwindow.cpp:506-508`). The pointer always follows focus (6.1), so
the active output is the focused output and the script does not redirect new
windows. It only enforces I3:
1. A window that starts on a workspace located on another output (window rule,
   app restoring its session) moves to that output, as in 5.7 "Window to
   Desktop N": whenever the script re-checks its model at runtime, a managed
   window on another output than its workspace's location is sent there and
   given its desktop back. Focus stays where it is.
2. Transient windows (dialogs) follow their parent's output and desktop.

### 5.7 External changes (not made by the script)
- **Plasma switches output O to W** (pager, Overview, KWin's desktop shortcuts,
  screen-edge switching), seen as `currentDesktopChanged(previous, W, O)`
  outside our re-entrancy guard. Treat it as the user asking to go to W (like
  5.2), not as a request to move W:
  - W was unmapped → W is now located on O. KWin's result is already right;
    just record it.
  - W is located on O → nothing to do.
  - W is located on P ≠ O → show `previous` on O again, show W on P, focus P
    and warp the pointer. If `previous` is null (new output), pick per 6.2.

  KWin can't be stopped before the switch, only corrected after it. Defer the
  correction with `Qt.callLater`: correcting inside the handler would leave
  other scripts (e.g. a tiling script running alongside) with the wrong desktop
  (§3). In theory this can show a frame of W on O, or start the desktop switch
  animation; checked by hand, no flicker is noticeable (§3).

  The script's own shortcut stays the main path, because it never shows W on
  the wrong output first.

  KWin-internal switches need no special case. Activating a window switches
  the window's own output to its desktop (`src/activation.cpp:313`), which is
  already W's location. Desktop removal and activity changes trigger a full
  rebuild.
- **User drags a window to another output, or uses "Window to Next Screen"**:
  see 6.8.
- **User sends a window to desktop W (Plasma's "Window to Desktop N")**: if W is
  located on another output, move the window there (5.6), focus stays; if W is
  unmapped, W becomes located on the window's current output.
- **Window set to all desktops**: ignore it for location purposes.
- **Desktops added/removed/reordered in System Settings**: rebuild state from
  scratch (as at startup); ids of surviving desktops stay valid.

### 5.8 Which windows are managed
Managed: normal application windows. Ignore: `specialWindow`, desktop, dock,
panels, notifications, OSDs, KRunner, plasmashell, lock screen, popups,
`skipTaskbar` utility windows, windows on all desktops, windows in multiple
(but not all) desktops (6.11), closed windows still running their close
animation (`deleted`). Transients follow their parent (5.6).

### 5.9 Focus
- The focused output is `workspace.activeScreen`. KWin sets it on every pointer
  move (`src/pointer_input.cpp:950`) and on every window activation
  (`src/activation.cpp:266`); on Wayland there is no setting to turn that off.
  The script reads it when needed and keeps no copy.
- So with *Click to focus*, moving the pointer to another monitor without
  clicking makes that monitor current for `Meta+N` on an empty workspace. That
  is where KWin opens the next window anyway, so this is accepted.
- Whenever the script moves focus to another monitor, warp the pointer (6.1).
  This is always on, with no config option. Without it, the next pointer move
  resets the active output, and with *Focus follows mouse* the next window the
  pointer enters on the old monitor takes focus back. Switches on the current
  monitor leave the pointer alone (5.2).

### 5.10 Shortcuts
Register through KWin so they appear in System Settings → Shortcuts.
| Default | Action |
|---|---|
| `Meta+1` … `Meta+9`, `Meta+0` | Switch to workspace 1…10 |
| `Meta+Ctrl+Left/Right/Up/Down` | Move current workspace to monitor in that direction |
| *(optional, milestone 6)* `Meta+Shift+1…0` | Move focused window to workspace N (window follows the workspace's location; focus stays) |
| *(optional)* `Meta+Alt+Left/Right/Up/Down` | Focus monitor in that direction |

Note: Plasma's defaults use `Meta+1…9` for "Activate Task Manager Entry N" and
`Meta+Ctrl+Left/Right/Up/Down` for "Switch One Desktop to the
Left/Right/Up/Down" (`src/virtualdesktops.cpp:773-776`; also `Ctrl+F1…` for
desktop switching). kglobalaccel won't give our action a key that another
action already holds, so the README must say which to unbind before enabling
the script (or to assign ours afterwards in System Settings → Shortcuts). Do
not silently rewrite the user's global shortcuts.
KWin's `ShortcutHandler` assigns keys without registering them as defaults,
so "Reset to default" in System Settings clears them; the README should say
so.

---

## 6. Design decisions

Each item: the problem, the options, and the decision.

### 6.1 Focusing a monitor and moving the pointer — **decided**
Facts from the KWin sources:
- KWin's active output follows every pointer move and every window activation
  (5.9). New windows open there (5.6).
- `workspace.activeScreen` is read-only, and scripts cannot move the pointer
  directly.
- `Switch to Screen <i>` focuses the desktop window of `screenOrder[i]` and
  makes it the active output, even when it has no windows
  (`src/activation.cpp:490`). It does not move the pointer.
- `MoveMouseToFocus` / `MoveMouseToCenter` warp the pointer to the centre of
  the active window / active output (`src/useractions.cpp:1684-1694`). A warp
  updates the active output like a real pointer move.
- With *Focus follows mouse*, desktop windows never take focus on hover
  (`src/window.cpp:2848`), so a pointer on an empty monitor changes nothing.

**Decision:** whenever the script moves focus to another output T, it
invokes `Switch to Screen <index of T in screenOrder>`, which focuses the most
recently used window of what T shows (KWin's per-screen focus chain, also for
a window that lost focus when its workspace was hidden), or T's desktop. Then:
1. W has a visible window on T → `MoveMouseToFocus`.
2. Otherwise → `MoveMouseToCenter`.

Both are `invokeShortcut` calls through `DBusCall`; calls on one connection
arrive in order. This is always on (5.9). KWin only registers
`Switch to Screen 0–7`, so more than 8 outputs are out of scope.

Known limitation: with *Focus follows mouse*, if another window (e.g. a
keep-above one) covers the centre of the focused window, it takes focus after
the focus delay.

### 6.2 What an output shows when its workspace leaves — **decided**
Happens on 5.3 (move), 5.5 (a workspace returning home), and on collisions.
Options: (a) swap — it shows the workspace that was on the other side;
(b) lowest-numbered free workspace (unmapped, not shown anywhere);
(c) the previously shown workspace on that output, if still located there.
**Decision:** (c); else the lowest-numbered hidden workspace living on that
output, so a monitor keeps to its own workspaces; else (b). (a) could become a
separate "swap workspaces between monitors" action later.
If no free workspace exists → 6.10.

### 6.3 Collisions: a workspace ends up shown on two outputs — **decided**
Mostly caused by the pager, Plasma shortcuts or the Overview effect. Those are
handled by 5.7 as "go to W": the workspace stays where it lives and focus moves
there. Remaining collisions (races, startup): the output holding W's windows
keeps it; if W is empty, the focused output keeps it. The other output switches
per 6.2.

### 6.4 Lifetime of `home` for empty workspaces — **decided**
If an evacuated workspace becomes empty while away from home, should it still
return home on replug? It has no windows, so "returning" only matters if it is
shown. **Decision:** clear `location` and `home` when a workspace becomes
unmapped. i3 forgets empty workspaces too.

### 6.5 Direction → neighbour output — **decided**
Use output geometries: candidates are outputs whose centre lies beyond F's edge
in direction D (beyond F's centre is not enough: a bigger monitor beside F can
have its centre lower than F's); pick the one with the largest overlap on the
perpendicular axis, tie-break by distance between centres. No wrap-around: with no candidate, there
is no neighbour. Unit-test this with odd layouts (stacked, L-shape, different
sizes, gaps between outputs).

### 6.6 Output identity — **decided**
Connector names can change between ports/docks (`DP-3` vs `DP-5` on MST docks).
Scripts can read the EDID data `output.manufacturer` (vendor name from hwdata),
`output.model` and `output.serialNumber` (`src/core/output.h:246-272`).
**Decision:** the output key is `manufacturer|model|serialNumber` when the
serial is non-empty and no other connected output has the same key; otherwise
it is the connector name. This covers identical monitors without a real serial
and the virtual test backend, which has empty EDID fields (`Virtual-0`).
Compute it in one function, `outputKey(output, connectedOutputs)`, with unit
tests.

### 6.7 Hotplug timing and races — **decided**
KWin evacuates windows from a lost output itself, docks report outputs in
bursts, and monitors that deep-sleep may disconnect on DPMS.
**Decision:** single debounced `screensChanged` handler (~750 ms,
configurable); compare the *settled* output set with the last known set; never
act on intermediate states. While outputs settle the script does not reconcile
and ignores its own shortcuts; it still records switches for 6.2. Log every
step behind a debug flag.

### 6.8 A workspace's windows on several outputs — **decided**
Happens when the user drags a window to another monitor, uses KWin's "Window
to Screen" shortcuts, or at startup with pre-existing windows.
Options: (a) the window adopts the destination output's current workspace
(i3 behaviour: moving a window to another monitor puts it into the workspace
visible there); (b) pull the window back; (c) allow it and break I3.
**Decision:** (a) for user actions. KWin already does this (§3), so the script
only updates `location`; such windows are never away from their workspace, so
5.6 does not pull them back. At startup, the workspace stays where most of its
windows are and stragglers adopt the workspace shown on their output.

### 6.9 Pressing the shortcut of the already-focused workspace — **decided**
Options: no-op, or `workspace_back_and_forth` (switch to the previous one).
**Decision:** no-op by default, config option for back-and-forth.

### 6.10 Number of workspaces — **decided**
The user configures 10 desktops (README). `Meta+1…9` switch to workspaces 1–9
and `Meta+0` to 10. The script never creates or removes desktops.
- Fewer than 10 desktops: log a warning at startup; `Meta+N` beyond the count
  does nothing.
- No free workspace for 6.2 (all mapped): log a warning and let the output keep
  a shared workspace (break I1 visibly rather than crash).

### 6.11 Windows on several (not all) desktops — **decided**
Rare with per-output desktops. **Decision:** ignore them for location purposes
(never move them), document it.

### 6.12 Activities — **decided**
**Decision:** single activity only, documented. When `currentActivity`
changes, only do a full rebuild.

### 6.13 Script disable / reload — **decided**
On unload, disconnect all signals and leave KWin state as it is (it is valid
Plasma state). On reload, rebuild per 5.1. `home` for currently-unplugged
monitors is lost on reload — acceptable for v1.

---

## 7. Configuration (kcfg, `[Script-plasma-i3-desktops]` in kwinrc)
- `BackAndForth` (bool, default false) — 6.9
- `HotplugDebounceMs` (int, default 750) — 6.7
- `Debug` (bool, default false) — verbose logging to the journal

Avoid KDE-specific list widgets (e.g. `KEditListWidget`) in `config.ui`; they
need Qt Designer plugins that some distros don't install and silently fail to
render. Use plain Qt widgets only.

---

## 8. Testing

### Unit tests (pure logic)
Keep decision logic (reconcile, neighbour search, free-workspace choice,
hotplug planning) in a module with no KWin dependency, taking a plain snapshot
of state and returning a list of actions. Test with Node's built-in `node:test`.

### End-to-end tests (real KWin)
- Run `kwin_wayland --virtual --no-lockscreen --output-count 2` on a private
  D-Bus session with an isolated `XDG_CONFIG_HOME`, `PerOutputVirtualDesktops`
  enabled, and the script installed.
- Drive it via D-Bus: invoke the script's shortcuts through kglobalaccel, read
  state through the KWin scripting console or a debug D-Bus/JSON dump the script
  exposes.
- Spawn simple Wayland test clients (e.g. a tiny Qt or GTK window with a
  distinct app id/title).
- Simulate hotplug by disabling/enabling a virtual output
  (`kscreen-doctor output.<name>.disable` / `.enable`, or KWin's output
  management D-Bus).
- Simulate Plasma switches (there is no pager in the bare compositor) by
  invoking KWin's `Switch to Desktop N`, or from a second, test-only script
  calling `setCurrentDesktopForScreen` (outside our re-entrancy guard).
- Read the pointer position (`workspace.cursorPos`) to check the warp.
- HyprKwin (`github.com/DGBooth/HyprKwin`, `tests/e2e/`) has a working harness
  of exactly this kind. It is GPL-3.0, like this project, so its code may be
  reused; keep its copyright notices.

### Required scenarios
1. Switch to an occupied workspace on the other monitor → focus moves there and
   the pointer is at the centre of the focused window.
2. Switch to an empty workspace → appears on the current monitor.
3. Switch to an empty workspace on the other monitor (shown there) → focus moves
   there and the pointer is at that monitor's centre.
4. Open an app after 3 → it opens on the second monitor.
5. Move workspace left/right/up/down, including with no neighbour.
6. Unplug monitor B with 2 workspaces → both on A, A's view unchanged.
7. Replug B → both back on B, B shows what it showed before.
8. Unplug, close all windows of an evacuated workspace, replug → it does not return (6.4).
9. Plasma switches monitor A to a workspace that lives on monitor B → A keeps
   its workspace, B shows it, focus and pointer are on B (5.7).
10. Drag a window to the other monitor → resolved per 6.8.
11. Rapid unplug/replug burst → one settled outcome, no oscillation.
12. Script reload with windows on several monitors → state rebuilt correctly.
13. `PerOutputVirtualDesktops` off → script inactive, no changes made.
14. Plasma switches a monitor to an empty workspace not shown anywhere → it is
    shown and located there.
15. KWin's `Switch to Desktop N` for a workspace on the other monitor → same
    result as `Meta+N`.
16. With *Focus follows mouse*: switch to a window on the other monitor, then
    nudge the pointer → focus stays on that window.

---

## 9. Milestones

1. **Skeleton** — `metadata.json` (id `plasma-i3-desktops`, license
   `GPL-3.0-or-later`), QML script, config, debug logging, state snapshot dump,
   inactive when per-output desktops are off; e2e harness with test 13.
2. **Core switching** — state model, output key (6.6), startup rebuild,
   `Meta+N` per 5.2, collision handling, focus and pointer warp (6.1); e2e
   tests 1–4, 16.
3. **Move workspace** — directional neighbour search and 5.3.
4. **Hotplug** — 5.4/5.5 with debouncing; e2e tests 6–8, 11.
5. **External changes** — 5.6 and 5.7; e2e tests 9, 10, 14, 15.
6. *(Optional)* Move window to workspace N, focus monitor in direction,
   back-and-forth.
7. **Packaging** — `.kwinscript` build, README (requirements incl. 10 desktops,
   shortcut conflicts to unbind, known limitations).

## 10. Acceptance criteria
- All scenarios in section 8 pass in the e2e harness.
- No invariant violations after any scenario (the test harness checks I1–I6
  after every step).
- No visible flicker beyond a single desktop switch per user action, including
  Plasma switches corrected by 5.7.
- With debug off, the script logs nothing during normal use (do not leak window
  titles to the journal).
