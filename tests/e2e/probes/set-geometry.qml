// Moves and resizes the window titled `params.caption` to `params.geometry`.
import QtQuick
import org.kde.kwin
import "params.mjs" as Params

Item {
    Component.onCompleted: {
        const params = Params.params;
        const window = Array.from(Workspace.stackingOrder).find(w => w.caption === params.caption);
        const g = params.geometry;
        window.frameGeometry = Qt.rect(g.x, g.y, g.width, g.height);
    }
}
