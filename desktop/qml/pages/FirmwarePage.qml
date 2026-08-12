import QtQuick
import QtQuick.Controls
import AmbitApp

// Firmware page - the GUI over the standalone flasher (tools/firmware_write.py) and its
// download step (firmware_check.py), see FIRMWARE_FLASHER_DESIGN.md. Suunto-only. Talks to
// the local backend with plain XMLHttpRequest (like HomePage's fun-fact fetch), streaming
// the flasher's --json events (/api/firmware/flash) so the ~10-minute flash shows live
// progress. The reassuring phrases during the wait are a hard-coded OFFLINE list.
PageFlickable {
    id: root
    contentWidth: width
    contentHeight: column.height + Theme.spacingLarge * 2
    clip: true

    readonly property string api: "http://127.0.0.1:8766"

    // loading | idle (up to date) | update | recover | flashing | done | error
    property string mode: "loading"
    property var info: ({})
    property var known: []
    property string selectedSerial: ""
    property string phase: ""
    property real percent: -1          // <0 = indeterminate (busy)
    property string doneFw: ""
    property string errorText: ""
    property int _consumed: 0

    // Offline reassurance shown while the flash runs - no network, on purpose.
    readonly property var phrases: [
        qsTr("Don't worry, your watch will be soon ready for new adventures! Grab your favourite drink and enjoy this quiet time!"),
        qsTr("Good things take time — your watch is getting a fresh start. ☕"),
        qsTr("Hang tight! We're teaching your watch some new tricks."),
        qsTr("Perfect moment to stretch your legs — your watch is doing its thing."),
        qsTr("Almost there in watch-time. These seasoned adventurers like to take it slow. ⛰️"),
        qsTr("Keep the cable steady and relax — your watch has got this."),
        qsTr("Firmware flowing… your next summit is getting a little closer. ✨")
    ]
    property string phrase: phrases[0]

    Component.onCompleted: checkFirmware()

    Timer {
        id: phraseTimer
        interval: 12000; repeat: true; running: false
        property int i: 0
        onTriggered: { i = (i + 1) % root.phrases.length; root.phrase = root.phrases[i]; }
    }

    // ---- backend calls -------------------------------------------------------

    function checkFirmware() {
        root.mode = "loading";
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE)
                return;
            let d = null;
            try { d = JSON.parse(xhr.responseText); } catch (e) {}
            if (!d) { root.mode = "error"; root.errorText = qsTr("Couldn't reach the app backend."); return; }
            root.info = d;
            if (d.model === "BSL") {
                // A bricked/interrupted watch can't name itself - go to recovery.
                loadKnown();
                root.mode = "recover";
            } else if (d.ok === false) {
                root.mode = "error";
                root.errorText = d.error || qsTr("No watch connected.");
            } else if (d.current_firmware && d.latest_firmware_version
                       && d.current_firmware !== d.latest_firmware_version) {
                root.mode = "update";
            } else {
                root.mode = "idle";
            }
        };
        xhr.open("GET", api + "/api/firmware");
        xhr.send();
    }

    function loadKnown() {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE)
                return;
            let d = null;
            try { d = JSON.parse(xhr.responseText); } catch (e) {}
            root.known = (d && d.watches) ? d.watches : [];
            if (root.known.length > 0)
                root.selectedSerial = root.known[0].serial;
        };
        xhr.open("GET", api + "/api/firmware/known");
        xhr.send();
    }

    // Download the right image, then flash. `spec` is null to use the connected watch, or
    // {model, hw, product} to recover a specific known watch that's currently in BSL.
    function downloadThenFlash(spec, expectModel) {
        root.mode = "flashing"; root.phase = qsTr("Downloading firmware…"); root.percent = -1;
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE)
                return;
            let d = null;
            try { d = JSON.parse(xhr.responseText); } catch (e) {}
            if (!d || !d.ok || !d.path) {
                root.mode = "error";
                root.errorText = (d && d.error) || qsTr("Firmware download failed.");
                return;
            }
            startFlash(d.path, expectModel);
        };
        xhr.open("POST", api + "/api/firmware/download");
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(JSON.stringify(spec ? { model: spec.model, hw: spec.hw } : {}));
    }

    function startFlash(file, expectModel) {
        root.phase = qsTr("Starting…"); root.percent = -1; root._consumed = 0;
        phraseTimer.i = 0; root.phrase = root.phrases[0]; phraseTimer.start();
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (xhr.readyState >= XMLHttpRequest.LOADING) {
                const text = xhr.responseText;
                let nl;
                while ((nl = text.indexOf("\n", root._consumed)) !== -1) {
                    const line = text.substring(root._consumed, nl).trim();
                    root._consumed = nl + 1;
                    if (line.length)
                        handleEvent(line);
                }
            }
            if (xhr.readyState === XMLHttpRequest.DONE) {
                phraseTimer.stop();
                if (root.mode === "flashing") {   // stream ended without done/error
                    root.mode = "error";
                    root.errorText = qsTr("The flash ended unexpectedly. Your watch is safe in "
                                          + "recovery mode — you can try again.");
                }
            }
        };
        xhr.open("POST", api + "/api/firmware/flash");
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(JSON.stringify({ file: file, expect_model: expectModel }));
    }

    function handleEvent(line) {
        let ev = null;
        try { ev = JSON.parse(line); } catch (e) { return; }
        switch (ev.phase) {
        case "connected":     root.phase = qsTr("Connected to your watch."); break;
        case "enter_bsl":     root.phase = qsTr("Entering recovery mode…"); break;
        case "transfer_mode":
        case "header":        root.phase = qsTr("Preparing…"); break;
        case "erase":         root.phase = qsTr("Erasing flash — this takes about a minute…"); root.percent = -1; break;
        case "streaming":     root.phase = qsTr("Writing firmware…"); root.percent = ev.percent; break;
        case "streamed":      root.phase = qsTr("Verifying…"); root.percent = 100; break;
        case "restart":       root.phase = qsTr("Little cable hiccup — retrying. Keep it still…"); root.percent = -1; break;
        case "commit":        root.phase = qsTr("Writing the final image…"); root.percent = -1; break;
        case "rebooting":     root.phase = qsTr("Rebooting your watch…"); root.percent = -1; break;
        case "done":          root.mode = "done"; root.doneFw = ev.fw || ""; break;
        case "error":         root.mode = "error"; root.errorText = ev.message || qsTr("The flash failed."); break;
        }
    }

    // ---- UI -------------------------------------------------------------------

    Column {
        id: column
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Theme.spacingLarge
        width: 520
        spacing: Theme.spacingMedium

        Text {
            text: qsTr("Firmware")
            color: Theme.text
            font.pixelSize: Theme.fontSizeTitle
            font.bold: true
        }

        // --- Loading ---
        Card {
            width: parent.width
            visible: root.mode === "loading"
            Row {
                spacing: Theme.spacingSmall
                LoadingPill {}
                Text { text: qsTr("Checking your watch…"); color: Theme.mutedText
                       anchors.verticalCenter: parent.verticalCenter }
            }
        }

        // --- Up to date / reinstall ---
        Card {
            width: parent.width
            visible: root.mode === "idle"
            Column {
                width: parent.width; spacing: Theme.spacingSmall
                Text { text: qsTr("Your watch is up to date"); font.bold: true; color: Theme.text
                       font.pixelSize: Theme.fontSizeBodyLarge }
                Text {
                    width: parent.width; wrapMode: Text.WordWrap; color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                    text: (root.info.product || root.info.model || qsTr("Watch"))
                          + " — " + qsTr("firmware ") + (root.info.current_firmware || "?")
                }
                RoundedButton {
                    text: qsTr("Reinstall firmware")
                    onClicked: confirm.show(qsTr("Reinstall the current firmware?"),
                                            null, root.info.model)
                }
            }
        }

        // --- Update available ---
        Card {
            width: parent.width
            visible: root.mode === "update"
            Column {
                width: parent.width; spacing: Theme.spacingSmall
                Text { text: qsTr("Firmware update available"); font.bold: true
                       color: Theme.text; font.pixelSize: Theme.fontSizeBodyLarge }
                Text {
                    width: parent.width; wrapMode: Text.WordWrap; color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                    text: (root.info.product || root.info.model || qsTr("Watch")) + "\n"
                          + qsTr("Current: ") + (root.info.current_firmware || "?") + "  →  "
                          + qsTr("Latest: ") + (root.info.latest_firmware_version || "?")
                }
                RoundedButton {
                    text: qsTr("Update firmware")
                    onClicked: confirm.show(qsTr("Update to ")
                               + (root.info.latest_firmware_version || "") + "?",
                               null, root.info.model)
                }
            }
        }

        // --- Recovery (watch in BSL) ---
        Card {
            width: parent.width
            visible: root.mode === "recover"
            Column {
                width: parent.width; spacing: Theme.spacingSmall
                Row {
                    spacing: Theme.spacingSmall
                    Text { text: Icons.warningAmber; font.family: Icons.fontFamily
                           color: Theme.warning; font.pixelSize: Theme.fontSizeTitle }
                    Text { text: qsTr("Watch in recovery mode"); font.bold: true
                           color: Theme.text; font.pixelSize: Theme.fontSizeBodyLarge
                           anchors.verticalCenter: parent.verticalCenter }
                }
                Text {
                    width: parent.width; wrapMode: Text.WordWrap; color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                    text: qsTr("This watch is in its bootloader after an interrupted update. "
                               + "It can't tell us its model, so pick which watch to restore "
                               + "from the ones you've connected before.")
                }

                // Known watches -> pick one to recover
                RoundedComboBox {
                    id: watchPicker
                    width: parent.width
                    visible: root.known.length > 0
                    model: root.known.map(function(w) {
                        return (w.product || w.codename) + "  ·  " + qsTr("serial ") + w.serial;
                    })
                    onCurrentIndexChanged: if (root.known[currentIndex])
                                               root.selectedSerial = root.known[currentIndex].serial
                }
                RoundedButton {
                    visible: root.known.length > 0
                    text: qsTr("Recover this watch")
                    onClicked: {
                        const w = root.known[watchPicker.currentIndex];
                        if (w) confirm.show(qsTr("Restore ") + (w.product || w.codename)
                                            + qsTr(" to its latest firmware?"),
                                            { model: w.codename, hw: w.hw_version }, w.codename);
                    }
                }

                // No known watches -> the friendly SuuntoLink message.
                Text {
                    width: parent.width; wrapMode: Text.WordWrap
                    visible: root.known.length === 0
                    color: Theme.text; font.pixelSize: Theme.fontSizeBody
                    text: qsTr("We can't recognise this watch yet. If it was never connected "
                               + "to this app, recover it once with SuuntoLink — after that "
                               + "we'll remember it.\n\nDon't worry, your watch will be soon "
                               + "ready for new adventures! Grab your favourite drink and "
                               + "enjoy this quiet time! 🧭")
                }
            }
        }

        // --- Inline confirm (keeps us clear of any Dialog quirks) ---
        Card {
            id: confirm
            width: parent.width
            visible: false
            property string question: ""
            property var spec: null
            property string expectModel: ""
            function show(q, s, em) { question = q; spec = s; expectModel = em || ""; visible = true; }
            Column {
                width: parent.width; spacing: Theme.spacingSmall
                Text { text: confirm.question; font.bold: true; color: Theme.text
                       width: parent.width; wrapMode: Text.WordWrap }
                Text {
                    width: parent.width; wrapMode: Text.WordWrap; color: Theme.warning
                    font.pixelSize: Theme.fontSizeLabel
                    text: qsTr("This takes about 10 minutes. Keep the watch connected and "
                               + "don't unplug or move the cable until it's done.")
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedButton {
                        text: qsTr("Start")
                        onClicked: { confirm.visible = false;
                                     root.downloadThenFlash(confirm.spec, confirm.expectModel); }
                    }
                    RoundedButton {
                        text: qsTr("Cancel"); flat: true
                        onClicked: confirm.visible = false
                    }
                }
            }
        }

        // --- Flashing (live progress + offline phrases) ---
        Card {
            width: parent.width
            visible: root.mode === "flashing"
            Column {
                width: parent.width; spacing: Theme.spacingMedium
                Text { text: qsTr("Updating your watch"); font.bold: true; color: Theme.text
                       font.pixelSize: Theme.fontSizeBodyLarge }
                Text { text: root.phase; color: Theme.mutedText
                       font.pixelSize: Theme.fontSizeLabel; width: parent.width
                       wrapMode: Text.WordWrap }

                // rounded progress bar (indeterminate when percent < 0)
                Rectangle {
                    width: parent.width; height: 10; radius: 5
                    color: Theme.background
                    Rectangle {
                        height: parent.height; radius: parent.radius; color: Theme.accent
                        width: root.percent >= 0 ? parent.width * root.percent / 100 : parent.width * 0.3
                        Behavior on width { NumberAnimation { duration: 200 } }
                        SequentialAnimation on x {
                            running: root.percent < 0; loops: Animation.Infinite
                            NumberAnimation { from: 0; to: parent.parent.width * 0.7; duration: 1100; easing.type: Easing.InOutQuad }
                            NumberAnimation { from: parent.parent.width * 0.7; to: 0; duration: 1100; easing.type: Easing.InOutQuad }
                        }
                    }
                }
                Text {
                    visible: root.percent >= 0
                    text: Math.round(root.percent) + "%"
                    color: Theme.mutedText; font.pixelSize: Theme.fontSizeCaption
                }

                Rectangle { width: parent.width; height: 1; color: Theme.background }

                Text {
                    width: parent.width; wrapMode: Text.WordWrap
                    color: Theme.text; font.pixelSize: Theme.fontSizeBody
                    text: root.phrase
                    Behavior on text { /* no-op; text set by timer */ }
                }
                Text {
                    width: parent.width; wrapMode: Text.WordWrap
                    color: Theme.warning; font.pixelSize: Theme.fontSizeCaption
                    text: qsTr("Please keep the watch connected and the cable still.")
                }
            }
        }

        // --- Done ---
        Card {
            width: parent.width
            visible: root.mode === "done"
            Column {
                width: parent.width; spacing: Theme.spacingSmall
                Row {
                    spacing: Theme.spacingSmall
                    Text { text: Icons.checkCircle; font.family: Icons.fontFamily
                           color: Theme.success; font.pixelSize: Theme.fontSizeTitle }
                    Text { text: qsTr("All done!"); font.bold: true; color: Theme.text
                           font.pixelSize: Theme.fontSizeBodyLarge
                           anchors.verticalCenter: parent.verticalCenter }
                }
                Text {
                    width: parent.width; wrapMode: Text.WordWrap; color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                    text: qsTr("Your watch is back and ready for new adventures")
                          + (root.doneFw ? " — " + qsTr("firmware ") + root.doneFw : "") + "."
                }
                RoundedButton { text: qsTr("Done"); onClicked: root.checkFirmware() }
            }
        }

        // --- Error ---
        Card {
            width: parent.width
            visible: root.mode === "error"
            Column {
                width: parent.width; spacing: Theme.spacingSmall
                Row {
                    spacing: Theme.spacingSmall
                    Text { text: Icons.error; font.family: Icons.fontFamily
                           color: Theme.error; font.pixelSize: Theme.fontSizeTitle }
                    Text { text: qsTr("Something went wrong"); font.bold: true; color: Theme.text
                           font.pixelSize: Theme.fontSizeBodyLarge
                           anchors.verticalCenter: parent.verticalCenter }
                }
                Text { width: parent.width; wrapMode: Text.WordWrap; color: Theme.mutedText
                       font.pixelSize: Theme.fontSizeLabel; text: root.errorText }
                RoundedButton { text: qsTr("Try again"); onClicked: root.checkFirmware() }
            }
        }
    }
}
