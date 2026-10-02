// Entry point of the KWin script: connects KWin to the workspace logic.
import QtQuick
import org.kde.kwin
import "../code/snapshot.mjs" as Snapshot

Item {
    id: root

    // The script only makes sense with "Switch desktop independently for each
    // screen"; without it, it must not touch anything.
    readonly property bool active: Options.perOutputVirtualDesktops

    // The binding of `active` changes once while the script is created, before
    // Component.onCompleted; only later changes are real.
    property bool started: false

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

    function dumpState() {
        const state = Snapshot.snapshot(Workspace, {
            includeTitles: config("Debug", false)
        });
        console.info("PLASMA_I3_DESKTOPS_STATE " + JSON.stringify(Object.assign({
            active: active
        }, state)));
    }

    onActiveChanged: {
        if (started) {
            reportActivation();
        }
    }
    Component.onCompleted: {
        reportActivation();
        started = true;
    }

    // For bug reports and the e2e tests; has no default key.
    ShortcutHandler {
        name: "plasma-i3-desktops: Dump state"
        text: "i3 Desktops: Dump state to the journal (debug)"
        sequence: ""
        onActivated: root.dumpState()
    }
}
