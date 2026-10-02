// A plain test window. Arguments after "--": its title, and optionally a delay
// in ms after which it opens a dialog (a transient window) titled "<title> dialog".
import QtQuick
import QtQuick.Window

Window {
    id: main

    readonly property var args: {
        const all = Qt.application.arguments;
        return all.slice(all.indexOf("--") + 1);
    }

    width: 640
    height: 480
    visible: true
    color: "steelblue"
    title: args[0]

    Timer {
        interval: Number(main.args[1])
        running: main.args.length > 1
        onTriggered: dialog.visible = true
    }

    Window {
        id: dialog

        transientParent: main
        width: 300
        height: 200
        color: "orange"
        title: main.title + " dialog"
    }
}
