pragma Singleton
import QtQuick
import AmbitApp

// AMBITAPP_SPEC.md's QML -> ViewModels -> Services layering: HomePage.qml binds to this,
// never to DeviceService directly. Right now that's a thin pass-through plus one piece of
// real presentation logic (the status text/color) - as Weather/Activities services land in
// later steps, Home's view of them gets added here too, not scattered across HomePage.qml.
QtObject {
    // Real, 2026-08-08 ("home page: instead of ambit it detects an etrex... like on the
    // android version"). Ambit and Garmin are two completely separate device mechanisms
    // (NSP flash protocol vs. plain USB-mass-storage GPX files - see GarminService's own
    // header comment), so Home shows whichever one is actually present rather than trying
    // to merge them into one card. Ambit takes priority if, implausibly, both are connected
    // at once - it's this app's original/primary device, and the two would never really be
    // plugged in together in practice.
    readonly property bool isGarmin: !connected && GarminService.connected
    readonly property bool isAmbit: connected

    // 2026-08-07: switched from DeviceService.navOk to deviceInfoOk - navOk came from a
    // slow, unnecessary full flash read (see DeviceService's own header comment); a
    // deviceInfoOk. checking one small identity command is both faster and just as real a
    // connectivity signal, matching what made the real Android app feel fast.
    readonly property bool connected: DeviceService.backendReachable && DeviceService.deviceInfoOk

    readonly property string connectionStatusText: {
        if (DeviceService.loading) return qsTr("Checking...");
        if (!DeviceService.backendReachable) return qsTr("Backend not running");
        if (!DeviceService.deviceInfoOk) return qsTr("Watch not connected");
        return qsTr("Connected");
    }

    readonly property color connectionStatusColor:
        connected ? Theme.success : (DeviceService.loading ? Theme.mutedText : Theme.error)

    // DeviceService.model is the real internal engineering codename (e.g. "Emu") - the
    // 0x0000 reply itself has no commercial name to give back. Same confirmed codename
    // table history.md documents (and tools/workout_gui.py's own VARIANT_NAMES already
    // uses for the same reason) - not guessed here a second time.
    // 2026-08-08: spacing between "Ambit" and its generation number added on request
    // ("Ambit3 Peak" -> "Ambit 3 Peak") - applied to every Ambit2/Ambit3 entry, not just
    // Emu, for consistency. "Ambit" (Bluebird, the original) has no number, so it's
    // unaffected.
    readonly property var _modelNames: ({
        Bluebird: "Ambit", Duck: "Ambit 2", Colibri: "Ambit 2 S", Greentit: "Ambit 2 R",
        Emu: "Ambit 3 Peak", Finch: "Ambit 3 Sport", Ibisbill: "Ambit 3 Run", Kaka: "Ambit 3 Vertical",
        Jabiru: "Traverse", Loon: "Traverse Alpha",
    })
    readonly property string deviceDisplayName:
        DeviceService.deviceInfoOk
            ? (_modelNames[DeviceService.model] || DeviceService.model)
            : qsTr("Suunto Ambit 3 Peak")  // static fallback - this project's one reference watch

    readonly property string batteryText:
        DeviceService.deviceInfoOk && DeviceService.batteryPercent >= 0
            ? qsTr("%1%").arg(DeviceService.batteryPercent)
            : qsTr("Not available yet")

    readonly property string firmwareText:
        DeviceService.deviceInfoOk && DeviceService.firmwareVersion.length > 0
            ? DeviceService.firmwareVersion
            : qsTr("Not available yet")

    // Added 2026-08-07 alongside firmware downloads (V3_CHANGELOG.md) - André asked for
    // these on Home specifically.
    readonly property string serialText:
        DeviceService.deviceInfoOk && DeviceService.serial.length > 0
            ? DeviceService.serial
            : qsTr("Not available yet")

    readonly property string hardwareText:
        DeviceService.deviceInfoOk && DeviceService.hardwareVersion.length > 0
            ? DeviceService.hardwareVersion
            : qsTr("Not available yet")
}
