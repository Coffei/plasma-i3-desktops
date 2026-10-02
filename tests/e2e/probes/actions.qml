// Runs `params.actions` in order, one KWin call each, then reports
// `{probe: "actions", run, done}` or `{..., error}`. Each action is an object
// whose single key names it, e.g. `{showDesktop: {desktop: 2, output: "Virtual-1"}}`.
// Windows are found by caption, outputs by name, desktops by number.
import QtQuick
import org.kde.kwin
import "params.mjs" as Params

Item {
    id: probe

    function windowTitled(caption) {
        const window = Array.from(Workspace.stackingOrder).find(w => w.caption === caption);
        if (!window) {
            throw new Error("no window titled " + caption);
        }
        return window;
    }

    function outputNamed(name) {
        const output = Array.from(Workspace.screens).find(o => o.name === name);
        if (!output) {
            throw new Error("no output named " + name);
        }
        return output;
    }

    function desktop(number) {
        return Workspace.desktops[number - 1];
    }

    // Asynchronous, like the script's own calls; KWin handles them in order.
    function invokeShortcut(shortcut) {
        const call = Qt.createQmlObject('import org.kde.kwin; DBusCall { service: "org.kde.kglobalaccel"; path: "/component/kwin"; dbusInterface: "org.kde.kglobalaccel.Component"; method: "invokeShortcut" }', probe);
        call.arguments = [shortcut];
        call.call();
    }

    function run(action) {
        if (action.activate !== undefined) {
            Workspace.activeWindow = windowTitled(action.activate);
        } else if (action.shortcut !== undefined) {
            invokeShortcut(action.shortcut);
        } else if (action.showDesktop) {
            Workspace.setCurrentDesktopForScreen(desktop(action.showDesktop.desktop), outputNamed(action.showDesktop.output));
        } else if (action.sendToScreen) {
            Workspace.sendClientToScreen(windowTitled(action.sendToScreen.caption), outputNamed(action.sendToScreen.output));
        } else if (action.setDesktops) {
            windowTitled(action.setDesktops.caption).desktops = action.setDesktops.desktops.map(desktop);
        } else if (action.setGeometry) {
            const g = action.setGeometry.geometry;
            windowTitled(action.setGeometry.caption).frameGeometry = Qt.rect(g.x, g.y, g.width, g.height);
        } else {
            throw new Error("unknown action " + JSON.stringify(action));
        }
    }

    function report(result) {
        console.info("PI3D_PROBE " + JSON.stringify(Object.assign({
            probe: "actions",
            run: Params.params.run
        }, result)));
    }

    Component.onCompleted: {
        try {
            Params.params.actions.forEach(run);
            report({
                done: true
            });
        } catch (error) {
            report({
                error: String(error)
            });
        }
    }
}
