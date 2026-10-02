// Dumps KWin's state like the script's "Dump state" shortcut, for tests that
// run KWin without the script. Reports `{probe: "dumper", ready}` once loaded.
import QtQuick
import org.kde.kwin
import "snapshot.mjs" as Snapshot

Item {
    ShortcutHandler {
        name: "pi3d-probe: Dump state"
        text: "Dump state (e2e probe)"
        sequence: ""
        onActivated: {
            const state = Snapshot.snapshot(Workspace, {
                includeTitles: true
            });
            console.info("PLASMA_I3_DESKTOPS_STATE " + JSON.stringify(Object.assign({
                active: null,
                model: null
            }, state)));
        }
    }

    Component.onCompleted: console.info("PI3D_PROBE " + JSON.stringify({
        probe: "dumper",
        ready: true
    }))
}
