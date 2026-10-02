// A plain test window, titled by the last command line argument.
import QtQuick
import QtQuick.Window

Window {
    width: 640
    height: 480
    visible: true
    color: "steelblue"
    title: Qt.application.arguments[Qt.application.arguments.length - 1]
}
