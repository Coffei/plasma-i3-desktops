// Entry point of the KWin script: connects KWin to the workspace logic.
import QtQuick
import QtQml.Models
import org.kde.kwin
import "../code/outputs.mjs" as Outputs
import "../code/snapshot.mjs" as Snapshot
import "../code/workspaces.mjs" as Workspaces

Item {
    id: root

    // The script only makes sense with "Switch desktop independently for each
    // screen"; without it, it must not touch anything.
    readonly property bool active: Options.perOutputVirtualDesktops

    // The binding of `active` changes once while the script is created, before
    // Component.onCompleted; only later changes are real.
    property bool started: false

    readonly property int workspaceCount: 10

    // Where workspaces live, see workspaces.mjs.
    property var workspaceModel: Workspaces.emptyModel()

    // Above zero while the script itself changes KWin's state.
    property int applying: 0

    // Read on every use: KWin does not reload a script when its config
    // changes, but picks up new values whenever it re-reads its config.
    function config(key, defaultValue) {
        return KWin.readConfig(key, defaultValue);
    }

    function debug(message) {
        if (config("Debug", false)) {
            console.info("plasma-i3-desktops: " + message);
        }
    }

    function reportActivation() {
        if (active) {
            debug("active");
            const desktops = Workspace.desktops.length;
            if (desktops < workspaceCount) {
                console.warn("plasma-i3-desktops: only " + desktops + " virtual desktops; configure " + workspaceCount + " to use all workspace shortcuts");
            }
        } else {
            console.warn("plasma-i3-desktops: inactive, enable \"Switch desktop independently for each screen\" in System Settings");
        }
    }

    function takeSnapshot() {
        return Snapshot.snapshot(Workspace);
    }

    // Builds the model from KWin's state, as at startup (spec 5.1).
    function rebuild() {
        if (!active) {
            return;
        }
        const result = Workspaces.rebuild(takeSnapshot());
        workspaceModel = result.model;
        apply(result.actions);
        debug("rebuilt: " + describeLocations());
    }

    // Brings the model and KWin back in line after something else changed
    // KWin's state (spec §4). Deferred, so a burst of changes is handled once.
    function scheduleReconcile() {
        if (active && applying === 0) {
            Qt.callLater(root.reconcile);
        }
    }

    function reconcile() {
        if (!active) {
            return;
        }
        const before = describeLocations();
        const result = Workspaces.reconcile(workspaceModel, takeSnapshot());
        workspaceModel = result.model;
        apply(result.actions);
        const after = describeLocations();
        if (after !== before) {
            debug("workspaces now: " + after);
        }
    }

    // Spec 5.2, `Meta+N`.
    function switchToWorkspace(number) {
        if (!active) {
            return;
        }
        reconcile();
        const actions = Workspaces.switchTo(workspaceModel, takeSnapshot(), number);
        debug("switch to workspace " + number + (actions.length ? "" : ": nothing to do"));
        apply(actions);
        reconcile();
    }

    // Spec 5.3, `Meta+Ctrl+arrow`.
    function moveWorkspace(direction) {
        if (!active) {
            return;
        }
        reconcile();
        const result = Workspaces.moveWorkspace(workspaceModel, takeSnapshot(), direction);
        debug("move workspace " + direction + (result.actions.length ? "" : ": nothing to do"));
        workspaceModel = result.model;
        apply(result.actions);
        reconcile();
    }

    // Window signals the model depends on; KWin drops the connections when
    // the window goes away.
    function watch(window) {
        window.desktopsChanged.connect(scheduleReconcile);
        window.outputChanged.connect(scheduleReconcile);
    }

    function apply(actions) {
        applying++;
        try {
            actions.forEach(applyAction);
        } finally {
            applying--;
        }
    }

    function applyAction(action) {
        if (action.type === "show") {
            const desktop = desktopWithId(action.desktop);
            debug("showing workspace " + desktop.x11DesktopNumber + " on " + action.output);
            Workspace.setCurrentDesktopForScreen(desktop, outputNamed(action.output));
        } else if (action.type === "adopt") {
            const desktop = desktopWithId(action.desktop);
            debug("moving window " + action.window + " to workspace " + desktop.x11DesktopNumber);
            windowWithId(action.window).desktops = [desktop];
        } else if (action.type === "sendToOutput") {
            debug("moving window " + action.window + " to " + action.output);
            Workspace.sendClientToScreen(windowWithId(action.window), outputNamed(action.output));
        } else if (action.type === "focusOutput") {
            focusOutput(action.output, action.warp);
        } else if (action.type === "warn") {
            console.warn("plasma-i3-desktops: " + action.text);
        }
    }

    // Scripts cannot focus an output or move the pointer, but KWin's own
    // shortcuts can (spec 6.1). "Switch to Screen" focuses the output's most
    // recently used window of what it shows, or its desktop.
    function focusOutput(name, warp) {
        const index = Array.from(Workspace.screenOrder).findIndex(output => output.name === name);
        if (index < 0 || index > 7) {
            debug("cannot focus " + name + ", KWin only switches to screens 0 to 7");
            return;
        }
        debug("focusing " + name + " and moving the pointer to its " + warp);
        invokeKWinShortcut("Switch to Screen " + index);
        invokeKWinShortcut(warp === "window" ? "MoveMouseToFocus" : "MoveMouseToCenter");
    }

    // Asynchronous; KWin handles calls in the order they were made.
    function invokeKWinShortcut(shortcut) {
        const call = kwinShortcutCall.createObject(root, {
            arguments: [shortcut]
        });
        call.finished.connect(() => call.destroy());
        call.failed.connect(() => {
            console.warn("plasma-i3-desktops: invoking " + shortcut + " failed");
            call.destroy();
        });
        call.call();
    }

    function desktopWithId(id) {
        return Array.from(Workspace.desktops).find(desktop => desktop.id === id);
    }

    function outputNamed(name) {
        return Array.from(Workspace.screens).find(output => output.name === name);
    }

    function windowWithId(id) {
        return Array.from(Workspace.stackingOrder).find(window => String(window.internalId) === id);
    }

    function describeLocations() {
        return Array.from(Workspace.desktops).filter(desktop => workspaceModel.location[desktop.id]).map(desktop => desktop.x11DesktopNumber + " on " + workspaceModel.location[desktop.id]).join(", ");
    }

    function dumpState() {
        const state = Snapshot.snapshot(Workspace, {
            includeTitles: config("Debug", false)
        });
        console.info("PLASMA_I3_DESKTOPS_STATE " + JSON.stringify(Object.assign({
            active: active,
            model: workspaceModel
        }, state)));
    }

    onActiveChanged: {
        if (started) {
            reportActivation();
            workspaceModel = Workspaces.emptyModel();
            rebuild();
        }
    }
    Component.onCompleted: {
        reportActivation();
        Array.from(Workspace.stackingOrder).forEach(watch);
        rebuild();
        started = true;
    }

    Connections {
        target: Workspace

        // Desktop ids survive, but numbering and outputs may have changed.
        function onDesktopsChanged() {
            Qt.callLater(root.rebuild);
        }

        // Until hotplug is handled (milestone 4), start over.
        function onScreensChanged() {
            Qt.callLater(root.rebuild);
        }

        function onWindowAdded(window) {
            root.watch(window);
            root.scheduleReconcile();
        }

        function onWindowRemoved() {
            root.scheduleReconcile();
        }

        // Every switch, the script's own too, is remembered for spec 6.2.
        function onCurrentDesktopChanged(previous, current, output) {
            if (!root.active) {
                return;
            }
            const key = Outputs.outputKey(output, Array.from(Workspace.screens));
            root.workspaceModel = Workspaces.recordSwitch(root.workspaceModel, key, previous ? previous.id : null);
            root.scheduleReconcile();
        }
    }

    Component {
        id: kwinShortcutCall

        DBusCall {
            service: "org.kde.kglobalaccel"
            path: "/component/kwin"
            dbusInterface: "org.kde.kglobalaccel.Component"
            method: "invokeShortcut"
        }
    }

    Instantiator {
        model: root.workspaceCount

        delegate: ShortcutHandler {
            required property int index
            readonly property int number: index + 1

            name: "plasma-i3-desktops: Switch to workspace " + number
            text: "i3 Desktops: Switch to workspace " + number
            sequence: "Meta+" + number % 10
            onActivated: root.switchToWorkspace(number)
        }
    }

    Instantiator {
        model: [
            {
                direction: "left",
                key: "Left",
                where: "on the left"
            },
            {
                direction: "right",
                key: "Right",
                where: "on the right"
            },
            {
                direction: "up",
                key: "Up",
                where: "above"
            },
            {
                direction: "down",
                key: "Down",
                where: "below"
            }
        ]

        delegate: ShortcutHandler {
            required property var modelData

            name: "plasma-i3-desktops: Move workspace to the monitor " + modelData.where
            text: "i3 Desktops: Move workspace to the monitor " + modelData.where
            sequence: "Meta+Ctrl+" + modelData.key
            onActivated: root.moveWorkspace(modelData.direction)
        }
    }

    // For bug reports and the e2e tests; has no default key.
    ShortcutHandler {
        name: "plasma-i3-desktops: Dump state"
        text: "i3 Desktops: Dump state to the journal (debug)"
        sequence: ""
        onActivated: root.dumpState()
    }
}
