// Reports the KWin signals the script reacts to, in the order it receives
// them, as `{probe: "observer", event, ...}`.
import QtQuick
import org.kde.kwin

Item {
    function report(event, data) {
        console.info("PI3D_PROBE " + JSON.stringify(Object.assign({
            probe: "observer",
            event: event
        }, data)));
    }

    Connections {
        target: Workspace

        function onScreensChanged() {
            report("screensChanged", {
                screens: Array.from(Workspace.screens).map(o => o.name)
            });
        }

        function onCurrentDesktopChanged(previous, current, output) {
            report("currentDesktopChanged", {
                previous: previous ? previous.x11DesktopNumber : null,
                current: current.x11DesktopNumber,
                output: output ? output.name : null
            });
        }
    }
}
