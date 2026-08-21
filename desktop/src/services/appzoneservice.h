#pragma once

#include <QObject>
#include <QQmlEngine>
#include <QString>

// The App Zone (Suunto Apps) builder counterpart to IntervalsService. Where that launches the
// guided-workout builder (tools/workout_gui.py), this launches the App Zone apps builder
// (tools/apps_gui.py) - a self-contained local web server + browser UI where you write App Zone
// script, compile it on the community compiler, and install it onto a sport mode's display field.
// Same "launch this other real app" scope, and the same reason it isn't rendered in-app: an
// embedded browser view would need Qt6::WebEngine just to duplicate the user's own browser.
//
// Distinct from AppsService (the Suunto Apps CATALOG - installing pre-made apps onto a field,
// wired as a dialog from Sport Modes): this is the AUTHORING tool for making new apps, not the
// catalog. Suunto-only (App Zone is an Ambit3 mechanism, no Garmin/Kailash equivalent), gated
// behind its own experimental toggle the same way IntervalsService's menu is.
class AppZoneService : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

public:
    explicit AppZoneService(QObject *parent = nullptr);

    // Starts the App Zone builder detached (it outlives this app, same as a double-clicked app
    // would) - "" on success, a friendly error otherwise. The tool opens its own browser tab
    // once its local server is up, so there's nothing more for this app to do afterward.
    Q_INVOKABLE QString launch();
};
