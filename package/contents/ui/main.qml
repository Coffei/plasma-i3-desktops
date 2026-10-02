// Entry point of the KWin script: connects KWin to the workspace logic.
import QtQuick
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
        } else if (action.type === "warn") {
            console.warn("plasma-i3-desktops: " + action.text);
        }
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

    // For bug reports and the e2e tests; has no default key.
    ShortcutHandler {
        name: "plasma-i3-desktops: Dump state"
        text: "i3 Desktops: Dump state to the journal (debug)"
        sequence: ""
        onActivated: root.dumpState()
    }
}
