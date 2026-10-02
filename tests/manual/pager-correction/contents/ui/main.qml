// Test only, see ../../README.md. The same correction as
// tests/e2e/probes/corrector.qml, switchable at runtime: when a monitor is
// switched to a desktop shown on another monitor, it shows its previous
// desktop again. Config `Deferred` (read on every switch) runs the
// correction after the signal has returned instead of inside it.
import QtQuick
import org.kde.kwin

Item {
    id: corrector

    // desktop id -> name of the output it was last shown on
    property var home: ({})
    property int guard: 0

    function outputNamed(name) {
        return Array.from(Workspace.screens).find(o => o.name === name);
    }

    function correct(previous, current, output) {
        guard++;
        Workspace.setCurrentDesktopForScreen(previous, output);
        Workspace.setCurrentDesktopForScreen(current, outputNamed(home[current.id]));
        guard--;
        console.info("pager-test: kept " + output.name + " on desktop " + previous.x11DesktopNumber + ", desktop " + current.x11DesktopNumber + " stays on " + home[current.id]);
    }

    Connections {
        target: Workspace

        function onCurrentDesktopChanged(previous, current, output) {
            if (corrector.guard > 0) {
                return;
            }
            const homeOutput = corrector.home[current.id];
            if (previous && homeOutput && homeOutput !== output.name && corrector.outputNamed(homeOutput)) {
                if (KWin.readConfig("Deferred", false)) {
                    Qt.callLater(() => corrector.correct(previous, current, output));
                } else {
                    corrector.correct(previous, current, output);
                }
                return;
            }
            corrector.home[current.id] = output.name;
        }
    }

    Component.onCompleted: {
        for (const output of Array.from(Workspace.screens)) {
            home[Workspace.currentDesktopForScreen(output).id] = output.name;
        }
        console.info("pager-test: loaded, deferred: " + KWin.readConfig("Deferred", false));
    }
}
