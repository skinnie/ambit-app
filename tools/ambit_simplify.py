"""SuuntoLink's Douglas-Peucker simplification.

Reconstructed from `route_simplifier.js` (the loop) and by fitting on the fixtures
(the metric). The Kotlin/JS module `sttalg.js` that carries the algorithm is
minified; it did not need to be decompiled.

The JS loop:

    tol = 2 m
    while the point count > target:
        mark the points whose gap is <= tol
        if still too many points: tol *= 2, give up beyond 131072 m

On both fixtures, a single pass at 2 m is more than enough (1066 -> 336 and
2911 -> 852, for a target of 1000), and the rebuilt point body is then byte-for-byte
identical to both captures.

What is really established, and what is not:

- The 2 m starting tolerance is **pinned**: 1, 3 and 4 m all give a different body.
  It matches the literal in the JS.
- The projection radius is **not** discriminated: from 6 300 000 to 6 500 000 m the
  result is identical. At that tolerance and with that point spacing, a scale
  variation of a few percent flips no decision. The constant below is therefore
  indicative.
- The metric is **2D**, despite `is3D()` returning true in `route_simplifier.js`:
  the Grand Tour fixture carries altitudes and reproduces exactly without them. So
  section 4.2 of the handoff was right.
"""

import math

START_TOLERANCE_M = 2.0
MAX_TOLERANCE_M = 131072.0
SIMPLIFY_RADIUS_M = 6378100.0  # indicative: not discriminated by the fixtures


def _perpendicular_distance(ax, ay, bx, by, px, py):
    """Distance from the point to the LINE (AB), not clamped to the segment."""
    dx, dy = bx - ax, by - ay
    squared = dx * dx + dy * dy
    if squared == 0.0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / squared
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _project(points, lat_ref, radius):
    cos_ref = math.cos(math.radians(lat_ref))
    return [(radius * cos_ref * math.radians(p[1]), radius * math.radians(p[0]))
            for p in points]


def douglas_peucker(points, tolerance, forced=(), lat_ref=None,
                    radius=SIMPLIFY_RADIUS_M):
    """Kept indices. The indices in `forced` (waypoints) are always kept and split
    the track into segments processed independently."""
    n = len(points)
    if n <= 2:
        return list(range(n))
    if lat_ref is None:
        lat_ref = sum(p[0] for p in points) / n
    xy = _project(points, lat_ref, radius)

    keep = [True] * n
    bounds = [0] + sorted(i for i in set(forced) if 0 < i < n - 1) + [n - 1]
    stack = list(zip(bounds, bounds[1:]))
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        ax, ay = xy[first]
        bx, by = xy[last]
        worst, worst_at = -1.0, -1
        for i in range(first + 1, last):
            px, py = xy[i]
            gap = _perpendicular_distance(ax, ay, bx, by, px, py)
            if gap > worst:
                worst, worst_at = gap, i
        if worst > tolerance:
            stack.append((first, worst_at))
            stack.append((worst_at, last))
        else:
            for i in range(first + 1, last):
                keep[i] = False
    return [i for i in range(n) if keep[i]]


def simplify_route(points, max_points, forced=(), lat_ref=None):
    """Indices kept after the doubling-tolerance loop. Returns None if the route
    cannot be reduced (tolerance ceiling reached)."""
    if len(points) <= max_points:
        return list(range(len(points)))
    tolerance = START_TOLERANCE_M
    while True:
        kept = douglas_peucker(points, tolerance, forced, lat_ref)
        if len(kept) <= max_points:
            return kept
        tolerance *= 2
        if tolerance > MAX_TOLERANCE_M:
            return None
