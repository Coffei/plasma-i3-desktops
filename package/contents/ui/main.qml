// Entry point of the KWin script: connects KWin to the workspace logic.
import QtQuick
import org.kde.kwin

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

    onActiveChanged: {
        if (started) {
            reportActivation();
        }
    }
    Component.onCompleted: {
        reportActivation();
        started = true;
    }
}
