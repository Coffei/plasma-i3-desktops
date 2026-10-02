// Undoes switches made elsewhere the way spec 5.7 does: when an output is
// switched to a desktop that lives on another output, the switched output
// shows its previous desktop again and the desktop's own output shows it.
// With `params.deferred`, the correction runs after the signal has returned.
// Reports `{probe: "corrector", ready}` and `{..., corrected}`.
import QtQuick
import org.kde.kwin
import "params.mjs" as Params

Item {
    id: corrector

    // desktop id -> name of the output it was last shown on
    property var home: ({})
    property int guard: 0

    function report(data) {
        console.info("PI3D_PROBE " + JSON.stringify(Object.assign({
            probe: "corrector"
        }, data)));
    }

    function outputNamed(name) {
        return Array.from(Workspace.screens).find(o => o.name === name);
    }

    function correct(previous, current, output) {
        guard++;
        Workspace.setCurrentDesktopForScreen(previous, output);
        Workspace.setCurrentDesktopForScreen(current, outputNamed(home[current.id]));
        guard--;
        report({
            corrected: current.x11DesktopNumber,
            output: output.name,
            restored: previous.x11DesktopNumber
        });
    }

    Connections {
        target: Workspace

        function onCurrentDesktopChanged(previous, current, output) {
            if (corrector.guard > 0) {
                return;
            }
            const homeOutput = corrector.home[current.id];
            if (previous && homeOutput && homeOutput !== output.name) {
                if (Params.params.deferred) {
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
        report({
            ready: true
        });
    }
}
