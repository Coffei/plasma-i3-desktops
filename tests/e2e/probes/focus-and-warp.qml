// Moves focus and the pointer the way the script will: optionally activates
// the window titled `params.activate`, then invokes `params.shortcuts`, KWin's
// own shortcuts, one D-Bus call each.
import QtQuick
import org.kde.kwin
import "params.mjs" as Params

Item {
    id: probe

    function invokeShortcut(shortcut) {
        const call = Qt.createQmlObject('import org.kde.kwin; DBusCall { service: "org.kde.kglobalaccel"; path: "/component/kwin"; dbusInterface: "org.kde.kglobalaccel.Component"; method: "invokeShortcut" }', probe);
        call.arguments = [shortcut];
        call.call();
    }

    Component.onCompleted: {
        const params = Params.params;
        if (params.activate) {
            const window = Array.from(Workspace.stackingOrder).find(w => w.caption === params.activate);
            Workspace.activeWindow = window;
        }
        for (const shortcut of params.shortcuts) {
            invokeShortcut(shortcut);
        }
        console.info("PI3D_PROBE " + JSON.stringify({
            probe: "focus-and-warp",
            done: true
        }));
    }
}
