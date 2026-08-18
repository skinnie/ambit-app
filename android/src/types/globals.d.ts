// Ambient declarations for runtime globals and untyped modules this app relies on.
//
// tsconfig.json sets "types": ["jest"] and no "lib", so the DOM/base globals that React
// Native actually provides at runtime aren't declared for the type-checker. btoa/atob are
// real RN runtime globals (Hermes/JSC), used by the base64 Basic-auth headers in
// ApiIntervalsIcu / ApiIntervalsIcuGear and by FitExport. Declaring them here fixes
// "Cannot find name 'btoa'" without pulling in the whole DOM lib.
declare function btoa(data: string): string;
declare function atob(data: string): string;

// (react-native-sqlite-storage also ships no types, but declaring it here only shifts the
// error deeper into src/database/db.ts's own usage - left as-is, it needs a real typing pass.)
