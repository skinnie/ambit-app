pragma Singleton
import QtQuick

// AMBITAPP_SPEC.md, "Device Capabilities": "Never hardcode watch models. Instead expose
// capabilities... The UI should automatically adapt." A page/button just binds to
// `DeviceCapabilities.supportsRoutes` etc., never to `model === "Ambit3"` anywhere.
//
// STATIC PLACEHOLDER FOR NOW, deliberately - these values reflect what this project has
// actually proven for the one reference watch used throughout its research (Ambit3 Peak),
// not live detection. Once the backend bridge (Python HTTP server wrapping tools/*.py) and
// a real DeviceService exist, this object's properties should be set from that connected
// watch's real identity/firmware response instead of these defaults - tracked as its own
// step, not done here.
QtObject {
    property bool supportsRoutes: true
    property bool supportsPOIs: true
    // Display-slot assignment within a sport mode is proven on real Ambit3 hardware
    // (custom_modes_andre.md); full sport-mode *settings* writing (autolap thresholds,
    // sensor pods, intervals, etc.) is not - see unresolved_questions_for_devs.md #1.
    property bool supportsSportModes: true
    property bool supportsApps: true
    property bool supportsNavigation: true
    property bool supportsBluetooth: true
    // Firmware update itself was never built or tested by this project - defaulting to
    // false rather than guessing, until it's real.
    property bool supportsFirmware: false
}
