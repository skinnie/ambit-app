#pragma once

#include <QStandardPaths>
#include <QString>

// Real directory both main.cpp's TileNetworkAccessManager (every MapView.qml Image tile)
// and TileCacheService's own QNetworkAccessManager (explicit "download for offline") write
// into - MUST match exactly, or a tile fetched by one and a tile pre-downloaded by the
// other would land in two different caches instead of being the same feature. Pulled into
// its own header rather than duplicated as a literal in both .cpp files for exactly that
// reason - one real invariant, one place it can't drift.
inline QString mapTileCacheDirectory()
{
    return QStandardPaths::writableLocation(QStandardPaths::CacheLocation)
           + QStringLiteral("/tiles");
}
