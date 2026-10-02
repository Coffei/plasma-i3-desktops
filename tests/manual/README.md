# Manual checks

Things only a real Plasma session can show.

## Pager correction flicker (`pager-correction/`)

Spec 5.7 undoes a pager or Overview switch to a workspace that lives on another monitor. The e2e
tests show the end state is right; this checks whether the switch visibly flickers before it is
undone. Needs two monitors and "Switch desktop independently for each screen".

1. Install and enable the test script:
   ```sh
   kpackagetool6 -t KWin/Script -i tests/manual/pager-correction
   kwriteconfig6 --file kwinrc --group Plugins --key plasma-i3-desktops-pager-testEnabled true
   gdbus call --session --dest org.kde.KWin --object-path /KWin --method org.kde.KWin.reconfigure
   ```
2. Show desktop 1 on monitor A and desktop 2 on monitor B. Put a window on each, so a switch is
   visible.
3. On A's pager, click desktop 2. A should stay on desktop 1 and B on desktop 2. Watch A for a
   flash of desktop 2 or the start of a slide.
4. Repeat from the Overview (`Meta+W`) on monitor A.
5. Switch to the deferred variant and repeat 3 and 4:
   ```sh
   kwriteconfig6 --file kwinrc --group Script-plasma-i3-desktops-pager-test --key Deferred true
   gdbus call --session --dest org.kde.KWin --object-path /KWin --method org.kde.KWin.reconfigure
   ```
6. Report what you saw for both variants. `journalctl --user -b | grep pager-test` shows what the
   script did.
7. Remove it:
   ```sh
   kwriteconfig6 --file kwinrc --group Plugins --key plasma-i3-desktops-pager-testEnabled false
   gdbus call --session --dest org.kde.KWin --object-path /KWin --method org.kde.KWin.reconfigure
   kpackagetool6 -t KWin/Script -r plasma-i3-desktops-pager-test
   ```

KWin caches a script's QML until you log out, so a changed version of the script only takes
effect after logging in again.

## Keyboard focus on an empty monitor

Spec 6.1 focuses a monitor without windows through KWin's `Switch to Screen` shortcut. In the e2e
setup there is no plasmashell, so keyboard focus stays on the previous window; this checks that a
real session moves it to the empty monitor's desktop.

1. Leave monitor B without windows and open a terminal on monitor A.
2. In the terminal, run this with B's index. It is B's position in KWin's screen order (0 or 1),
   which need not match left to right; try both if unsure, the pointer does not move:
   ```sh
   gdbus call --session --dest org.kde.kglobalaccel --object-path /component/kwin \
     --method org.kde.kglobalaccel.Component.invokeShortcut "Switch to Screen 1"
   ```
3. Type a few letters without touching the mouse. If they do not appear in the terminal (or
   KRunner opens on B), focus moved to B's desktop. Report which happened.
