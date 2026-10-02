// Entry point of the KWin script: connects KWin to the workspace logic.
import QtQuick
import org.kde.kwin

Item {
    id: root

    // The script only makes sense with "Switch desktop independently for each
    // screen"; without it, it must not touch anything.
    readonly property bool active: Options.perOutputVirtualDesktops

    function warnIfInactive() {
        if (!active) {
            console.warn("plasma-i3-desktops: inactive, enable \"Switch desktop independently for each screen\" in System Settings");
        }
    }

    onActiveChanged: warnIfInactive()
    Component.onCompleted: warnIfInactive()
}
