# Plasma i3 desktops

A KWin script for KDE Plasma 6.7+ (Wayland) that turns virtual desktops into i3-style workspaces: every
workspace lives on one monitor, switching to a workspace takes you to its monitor, and workspaces follow their
monitor across unplug and replug.

Work in progress. The design is in [screen-workspaces-spec.md](screen-workspaces-spec.md).

## Development

```sh
npm install        # Prettier
npm run format     # format before committing
npm test           # unit tests
npm run test:e2e   # end-to-end tests in a nested KWin
```

The end-to-end tests start an isolated `kwin_wayland --virtual` on a private D-Bus. They need
`kwin_wayland`, `dbus-run-session`, `kpackagetool6`, `kwriteconfig6`, `kscreen-doctor`, `gdbus` and Qt's `qml`
runtime (found in PATH or the usual Qt directories, or set `QML_BIN`), and cannot run inside
sandboxes that block Unix sockets. Set `PI3D_KEEP_TMP=1` to keep each test's KWin log.

## License

GPL-3.0-or-later, see [LICENSE](LICENSE).
