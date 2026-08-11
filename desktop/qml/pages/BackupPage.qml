import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import AmbitApp

// Step 10. Real backup/restore, built on write_nav.py's own `nav --save` / `restore
// PREFIX --write` - "the backup that milestone 4 asked for and never had" (that file's own
// words). "Sport Modes, Settings, Profiles" (the spec's own "Future" list here) aren't
// covered by this mechanism, which only ever touched routes/waypoints - not simulated.
// Garmin backup (real, 2026-08-08) is a genuinely different, simpler mechanism - a plain
// file copy, not this flash-region save/restore - see its own Card below.
PageFlickable {
    id: root
    contentWidth: width
    contentHeight: column.height + Theme.spacingLarge * 2
    clip: true

    Component.onCompleted: {
        BackupService.refresh();
        BackupService.checkFirmware();
    }

    FolderDialog {
        id: garminBackupDialog
        title: qsTr("Choose a backup folder")
        currentFolder: LocalFileService.downloadsLocation
        onAccepted: GarminService.backupToFolder(selectedFolder)
    }

    Column {
        id: column
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Theme.spacingLarge
        width: 480
        spacing: Theme.spacingMedium

        // Real, 2026-08-08 ("when a garmin device is detected, hide backup&restore and
        // existing backups, since those are suunto specific") - this mechanism only ever
        // touches the Ambit3's own flash regions (write_nav.py's nav --save/restore), so it
        // has nothing to do while a Garmin is the connected device.
        Card {
            width: parent.width
            visible: !HomeViewModel.isGarmin
            Column {
                width: parent.width
                spacing: Theme.spacingSmall

                Text { text: qsTr("Backup & Restore"); font.bold: true; color: Theme.text }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                    text: qsTr("Covers Routes and POIs together (the watch's whole " +
                                "navigation database) - Sport Modes, Settings, and Profiles " +
                                "are future, not part of this mechanism.")
                }

                RoundedButton {
                    text: BackupService.loading ? qsTr("Working…") : qsTr("Create backup now")
                    enabled: !BackupService.loading
                    onClicked: BackupService.createBackup()
                }

                Text {
                    visible: BackupService.lastActionText.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: Theme.fontSizeCaption
                    color: BackupService.lastActionOk ? Theme.success : Theme.error
                    text: BackupService.lastActionText
                }
            }
        }

        Card {
            width: parent.width
            visible: !HomeViewModel.isGarmin
            Column {
                width: parent.width
                spacing: Theme.spacingSmall

                Text { text: qsTr("Existing backups"); font.bold: true; color: Theme.text }

                Text {
                    visible: BackupService.backups.length === 0
                    text: qsTr("None yet.")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                }

                Repeater {
                    model: BackupService.backups
                    delegate: Column {
                        width: parent.width
                        spacing: 4
                        Text {
                            text: new Date(modelData.createdAt * 1000)
                                .toLocaleString(Qt.locale(), Locale.ShortFormat)
                            color: Theme.text
                            font.pixelSize: Theme.fontSizeBody
                        }
                        Row {
                            spacing: Theme.spacingSmall
                            // Real request 2026-08-07: "replace the rehearse restore button
                            // with open backup folder" - Restore itself already reports its
                            // own result text below, which was Rehearse's whole purpose;
                            // being able to actually see the saved files is the more useful
                            // second action here.
                            RoundedButton {
                                text: qsTr("Open backup folder")
                                onClicked: LocalFileService.openFolder(LocalFileService.backupsLocation)
                            }
                            RoundedButton {
                                text: qsTr("Restore")
                                onClicked: BackupService.restoreBackup(modelData.prefix, true)
                            }
                        }
                    }
                }
            }
        }

        // --- Firmware backup - added 2026-08-07, see V3_CHANGELOG.md. Also Suunto-specific
        // (its own text says so - "Suunto's own official app") - same reasoning as the two
        // Cards above, hidden for the same real, 2026-08-08 request. ---
        Card {
            width: parent.width
            visible: !HomeViewModel.isGarmin
            Column {
                width: parent.width
                spacing: Theme.spacingSmall

                Text { text: qsTr("Firmware"); font.bold: true; color: Theme.text }

                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: Theme.fontSizeLabel
                    font.bold: true
                    text: qsTr("For backup only - this cannot be used to flash the watch. " +
                                "There is no known way to install firmware over this " +
                                "protocol; the only supported way to update the watch is " +
                                "Suunto's own official app. Saved purely as a local copy in " +
                                "case Suunto's server ever stops serving this version.")
                }

                Text {
                    visible: BackupService.firmwareCheckOk
                    color: Theme.text
                    font.pixelSize: Theme.fontSizeBody
                    text: qsTr("Latest available: %1 (uploaded %2)")
                        .arg(BackupService.firmwareLatestVersion)
                        .arg(BackupService.firmwareUploadDate)
                }
                Text {
                    visible: !BackupService.firmwareCheckOk && !BackupService.firmwareLoading
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                    text: qsTr("Couldn't check for firmware yet.")
                }

                Row {
                    spacing: Theme.spacingSmall
                    RoundedButton {
                        text: BackupService.firmwareLoading ? qsTr("Working…") : qsTr("Check again")
                        enabled: !BackupService.firmwareLoading
                        onClicked: BackupService.checkFirmware()
                    }
                    RoundedButton {
                        text: qsTr("Download for backup")
                        enabled: !BackupService.firmwareLoading && BackupService.firmwareCheckOk
                        onClicked: BackupService.downloadFirmware()
                    }
                }

                Text {
                    visible: BackupService.firmwareActionText.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: Theme.fontSizeCaption
                    color: BackupService.firmwareActionOk ? Theme.success : Theme.error
                    text: BackupService.firmwareActionText
                }
            }
        }

        // --- Garmin backup - real, 2026-08-08 ("backups gpx from Garmin\GPX ... both
        // from internal memory and sdcard to a folder that user should choose, by
        // default Downloads"). Real file copy, not a database export or a re-serialized
        // parse - GarminService.backupToFolder() copies every real .gpx file already
        // sitting in Garmin/GPX on every mounted volume (internal memory and SD card)
        // into one subfolder per volume. No separate Garmin\POI folder exists on real
        // hardware (confirmed against real hardware, GARMIN_USB_IMPORT_SPEC.md) - POI
        // files already live inside the same Garmin/GPX folder as routes, just named
        // "Waypoints*.gpx", so backing up that one real folder covers both. ---
        Card {
            width: parent.width
            visible: HomeViewModel.isGarmin
            Column {
                width: parent.width
                spacing: Theme.spacingSmall

                Text { text: qsTr("Garmin backup"); font.bold: true; color: Theme.text }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                    text: qsTr("Copies every real GPX file from Garmin/GPX on this device " +
                                "- routes and POIs together, since they live in the same " +
                                "real folder on real hardware - from both internal memory " +
                                "and the SD card if one is present.")
                }

                // Real request 2026-08-08: "rename to Create backup now, to match Suunto
                // Backup and restore" - still opens the folder-choose dialog first (a real
                // difference from Suunto's own fixed ~/AmbitAppBackups location), just
                // worded the same way.
                RoundedButton {
                    text: GarminService.backingUp ? qsTr("Working…") : qsTr("Create backup now")
                    enabled: !GarminService.backingUp
                    onClicked: garminBackupDialog.open()
                }

                Text {
                    visible: GarminService.backupResultText.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: Theme.fontSizeCaption
                    color: GarminService.backupOk ? Theme.success : Theme.error
                    text: GarminService.backupResultText
                }
            }
        }
    }
}
