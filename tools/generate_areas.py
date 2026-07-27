import json, math

# ── Site boundary (lat, lng) from OSM ─────────────────────────────
raw = json.load(open("tools/bushywood-boundary.json", encoding="utf-8-sig"))["value"]
boundary = [(p[1], p[0]) for p in raw]

# ── Joseph's hand-edited zone shapes (2026-07-15) ─────────────────
zones = {
 "Main Campfire": [(50.860689,0.236865),(50.860628,0.236823),(50.860637,0.237023),(50.860650,0.237351),(50.860660,0.237456),(50.860736,0.237406),(50.860801,0.237319),(50.860837,0.237272),(50.860878,0.237186),(50.860849,0.237078)],
 "Chapel": [(50.860791,0.237341),(50.860739,0.237409),(50.860653,0.237467),(50.860663,0.237774),(50.860669,0.237909),(50.860749,0.237958),(50.860856,0.237494)],
 "SD Glade": [(50.861132,0.237732),(50.861030,0.237642),(50.860791,0.237789),(50.860744,0.237984),(50.860708,0.238096),(50.860683,0.238192),(50.860667,0.238234),(50.860677,0.238271),(50.861122,0.238463),(50.861152,0.238314),(50.861106,0.238186),(50.861146,0.238049),(50.861155,0.237900)],
 "Village Square": [(50.860591,0.238235),(50.860587,0.238333),(50.860579,0.238530),(50.860566,0.238816),(50.860553,0.238894),(50.860547,0.238986),(50.860736,0.239115),(50.860775,0.238988),(50.860929,0.238978),(50.861041,0.238868),(50.861081,0.238769),(50.861090,0.238582),(50.861118,0.238463)],
 "Arena": [(50.861067,0.239288),(50.860867,0.239388),(50.860818,0.239521),(50.860675,0.239712),(50.860651,0.239840),(50.860839,0.240204),(50.861290,0.239470)],
 "Shops": [(50.860466,0.239553),(50.860584,0.239698),(50.860648,0.239824),(50.860664,0.239755),(50.860673,0.239696),(50.860808,0.239516),(50.860868,0.239384),(50.861059,0.239286),(50.860964,0.239152),(50.860922,0.238992),(50.860773,0.238998),(50.860739,0.239119),(50.860569,0.239018),(50.860541,0.239009),(50.860510,0.239218),(50.860471,0.239346)],
 "Beeches": [(50.860829,0.240204),(50.860728,0.240012),(50.860652,0.239847),(50.860568,0.239692),(50.860461,0.239564),(50.860399,0.240011),(50.860353,0.240240),(50.860303,0.240492),(50.860356,0.240826),(50.860498,0.241007),(50.860547,0.241172),(50.860757,0.240756),(50.860918,0.240428)],
 "RPG Glade": [(50.860253,0.237962),(50.860300,0.238007),(50.860590,0.238211),(50.860668,0.237916),(50.860658,0.237689),(50.860649,0.237414),(50.860594,0.237400),(50.860434,0.237350),(50.860405,0.237412)],
 "Meadow": [(50.860488,0.236850),(50.860455,0.236582),(50.860369,0.236540),(50.860277,0.236518),(50.860275,0.236863),(50.860229,0.236973),(50.860161,0.237194),(50.860396,0.237425),(50.860436,0.237345),(50.860651,0.237416),(50.860643,0.237202),(50.860628,0.236823)],
 "Willows 1": [(50.860043,0.238784),(50.860144,0.238837),(50.860283,0.238880),(50.860383,0.238927),(50.860460,0.238934),(50.860540,0.238965),(50.860565,0.238784),(50.860583,0.238363),(50.860591,0.238219),(50.860234,0.237974),(50.860216,0.238099),(50.859988,0.238747)],
 "Willows 4": [(50.859903,0.237844),(50.860179,0.238000),(50.860255,0.237952),(50.860397,0.237432),(50.860092,0.237147),(50.859825,0.237610)],
 "Willows 5": [(50.859986,0.238744),(50.860052,0.238553),(50.860219,0.238087),(50.860183,0.238003),(50.859853,0.237816),(50.859837,0.237994),(50.859868,0.238263),(50.859780,0.238699)],
 "Willows 2": [(50.859550,0.238526),(50.859782,0.238698),(50.859868,0.238255),(50.859832,0.238008),(50.859839,0.237858),(50.859688,0.237606),(50.859341,0.238400),(50.859387,0.238430)],
 "Birches 1": [(50.860118,0.239553),(50.860287,0.239469),(50.860460,0.239560),(50.860466,0.239347),(50.860504,0.239215),(50.860544,0.238973),(50.860479,0.238945),(50.860375,0.238924),(50.860296,0.238894),(50.860138,0.238844),(50.860041,0.238785)],
 "Birches 2": [(50.860300,0.240469),(50.860394,0.240024),(50.860447,0.239657),(50.860457,0.239568),(50.860388,0.239525),(50.860289,0.239472),(50.860136,0.239545),(50.859993,0.239749)],
 "Birches 3": [(50.859776,0.239246),(50.859947,0.239551),(50.859989,0.239739),(50.860047,0.239650),(50.860119,0.239564),(50.860046,0.238794),(50.860020,0.238754),(50.859781,0.238709),(50.859713,0.238872),(50.859594,0.239036),(50.859656,0.239147)],
 "Oaks 1": [(50.860300,0.240494),(50.860189,0.240232),(50.859806,0.240854),(50.859883,0.240936),(50.860048,0.241061),(50.860298,0.241287),(50.860434,0.241277),(50.860470,0.241191),(50.860549,0.241184),(50.860499,0.241026),(50.860354,0.240830)],
 "Oaks 2": [(50.860190,0.240232),(50.860152,0.240137),(50.860053,0.239909),(50.859987,0.239752),(50.859941,0.239563),(50.859461,0.240337),(50.859558,0.240503),(50.859701,0.240731),(50.859807,0.240852)],
 "Oaks 3": [(50.859942,0.239560),(50.859771,0.239250),(50.859388,0.239912),(50.859368,0.239944),(50.859423,0.239994),(50.859463,0.240118),(50.859424,0.240197),(50.859427,0.240252),(50.859427,0.240320),(50.859457,0.240334)],
 "Oaks 4": [(50.859369,0.239938),(50.859767,0.239254),(50.859655,0.239151),(50.859593,0.239038),(50.859568,0.239065),(50.859567,0.239138),(50.859472,0.239207),(50.859156,0.239557),(50.859167,0.239701),(50.859256,0.239785)],
 "Chestnut": [(50.859346,0.240555),(50.859427,0.240336),(50.859416,0.240280),(50.859421,0.240179),(50.859450,0.240113),(50.859434,0.240063),(50.859381,0.239963),(50.859252,0.239783),(50.859164,0.239704),(50.859155,0.239561),(50.858987,0.239663),(50.858911,0.239781),(50.858750,0.239958),(50.859224,0.240429)],
}

connections = [
    ("Main Campfire","Chapel"),("Main Campfire","Meadow"),
    ("Chapel","SD Glade"),("Chapel","RPG Glade"),
    ("SD Glade","Village Square"),
    ("Village Square","Willows 1"),("Village Square","Birches 1"),("Village Square","Shops"),
    ("Arena","Beeches"),("Arena","Shops"),
    ("Beeches","Oaks 1"),("Beeches","Birches 2"),("Beeches","Shops"),
    ("Birches 1","Shops"),
    ("RPG Glade","Meadow"),("RPG Glade","Willows 1"),("RPG Glade","Willows 4"),
    ("Meadow","Willows 4"),
    ("Willows 1","Willows 5"),("Willows 1","Birches 1"),("Willows 1","Birches 3"),
    ("Willows 4","Willows 5"),
    ("Willows 5","Willows 2"),("Willows 5","Birches 3"),
    ("Birches 1","Birches 2"),("Birches 1","Birches 3"),
    ("Birches 2","Birches 3"),("Birches 2","Oaks 2"),("Birches 2","Oaks 1"),
    ("Birches 3","Oaks 2"),("Birches 3","Oaks 3"),("Birches 3","Oaks 4"),
    ("Oaks 1","Oaks 2"),("Oaks 2","Oaks 3"),("Oaks 3","Oaks 4"),
    ("Oaks 4","Chestnut"),("Oaks 3","Chestnut"),
]

names = list(zones.keys())
conn_idx = set()
for a, b in connections:
    conn_idx.add((names.index(a), names.index(b)))
    conn_idx.add((names.index(b), names.index(a)))

LAT0, LNG0 = 50.8600, 0.2390
KX = 111320 * math.cos(math.radians(50.86))
KY = 111320
def plane(p):   return ((p[1]-LNG0)*KX, (p[0]-LAT0)*KY)
def unplane(q): return (q[1]/KY+LAT0, q[0]/KX+LNG0)

zs  = [[plane(p) for p in zones[n]] for n in names]
bnd = [plane(p) for p in boundary]

# ── VALIDATE, DON'T SYNTHESISE ──────────────────────────────────────
# Earlier versions rebuilt every zone from scratch (centroid -> convex
# hull -> Voronoi-bisector clip against every other zone's centroid).
# That guaranteed tidy borders but silently discarded whatever Joseph
# actually traced — concave shapes got flattened to a handful of
# corners, and a big edit to one edge could vanish almost entirely if
# it didn't move the shape's centroid much, while a small edit could
# swing the result a long way. Edits stopped landing predictably.
#
# So: the traced shape IS the shape. No reshaping, no auto-clipping to
# the site boundary. The checks below only ever WARN — they never
# change a coordinate — so Joseph can see exactly what to nudge in the
# Area Editor and re-trace it precisely, on-site if needed.
cells = zs

# ── Verify: linked pairs touch, unlinked pairs gap, nothing crosses
#    itself, nothing overlaps a neighbour, nothing strays off-site ──
def seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx-ax, by-ay
    L2 = dx*dx + dy*dy
    t = 0 if L2 == 0 else max(0, min(1, ((px-ax)*dx + (py-ay)*dy) / L2))
    qx, qy = ax + t*dx, ay + t*dy
    return math.hypot(px-qx, py-qy)

def poly_min_dist(P, Q):
    d = 1e9
    for poly1, poly2 in ((P, Q), (Q, P)):
        for p in poly1:
            for k in range(len(poly2)):
                d = min(d, seg_dist(p, poly2[k], poly2[(k+1) % len(poly2)]))
    return d

def seg_intersect(a1, a2, b1, b2):
    def cross(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    d1 = cross(b1, b2, a1); d2 = cross(b1, b2, a2)
    d3 = cross(a1, a2, b1); d4 = cross(a1, a2, b2)
    return ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
           ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0))

def self_intersects(poly):
    n = len(poly)
    for i in range(n):
        for j in range(i+1, n):
            if abs(i - j) <= 1 or (i == 0 and j == n-1): continue  # adjacent edges share a vertex
            if seg_intersect(poly[i], poly[(i+1) % n], poly[j], poly[(j+1) % n]):
                return True
    return False

def point_in_poly(p, poly):
    x, y = p; inside = False; n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i+1) % n]
        if ((y1 > y) != (y2 > y)) and (x < (x2-x1)*(y-y1)/(y2-y1) + x1):
            inside = not inside
    return inside

def polys_overlap(P, Q):
    n, m = len(P), len(Q)
    for i in range(n):
        for j in range(m):
            if seg_intersect(P[i], P[(i+1) % n], Q[j], Q[(j+1) % m]):
                return True
    return any(point_in_poly(p, Q) for p in P) or any(point_in_poly(q, P) for q in Q)

problems = 0
for i in range(len(cells)):
    if self_intersects(cells[i]):
        print(f"WARN self-intersecting: {names[i]}"); problems += 1
    if any(not point_in_poly(p, bnd) for p in cells[i]):
        print(f"WARN outside the site boundary: {names[i]}"); problems += 1
    for j in range(i+1, len(cells)):
        d = poly_min_dist(cells[i], cells[j])
        linked = (i, j) in conn_idx
        if linked and d > 1.0:
            print(f"WARN linked but gap {d:.1f} m: {names[i]} <-> {names[j]}"); problems += 1
        if not linked and d < 3.0:
            print(f"WARN unlinked but only {d:.1f} m apart: {names[i]} <-> {names[j]}"); problems += 1
        if polys_overlap(cells[i], cells[j]):
            print(f"WARN overlap: {names[i]} <-> {names[j]}"); problems += 1
print("verification done,", problems, "warnings")

# ── Emit areas.js ─────────────────────────────────────────────────
def fmt(poly, ind):
    pad = " " * ind
    return "\n".join(f"{pad}[{round(p[0],6)}, {round(p[1],6)}]," for p in poly)

out = []
out.append("// ── CAMPSITE AREAS — Bushy Wood Activity Centre ───────────────────")
out.append("// The 21 zones of the Strange Games Festival, exactly as Joseph")
out.append("// hand-traced them — the generator validates (checks gaps, overlaps,")
out.append("// self-intersections, the site boundary) but never reshapes what was")
out.append("// traced. So borders may have a small gap or overlap where two")
out.append("// independently-traced zones don't quite line up; re-trace with the")
out.append("// in-app Area Editor (Settings, admin only) to tighten one up, and")
out.append("// check tools/generate_areas.py's own printed warnings after.")
out.append("// Ground belonging to no zone renders as grey hatching.")
out.append("//")
out.append("// Coordinates are [lat, lng]. Challenge text lives in challenges.csv.")
out.append("")
out.append("// The site perimeter, drawn as an outline on the map")
out.append("export const siteBoundary = [")
out.append(fmt([(round(p[0],6), round(p[1],6)) for p in boundary], 2))
out.append("];")
out.append("")
out.append("// ── CONNECTIONS ───────────────────────────────────────────────────")
out.append("// Which zones count as \"next to\" each other (they visibly touch on")
out.append("// the map; separated zones are not connected). Confirmed by Joseph.")
out.append("export const connections = [")
for a, b in connections:
    out.append(f'  ["{a}", "{b}"],')
out.append("];")
out.append("")
out.append("export const areaDefinitions = [")
for name, cell in zip(names, cells):
    out.append("  {")
    out.append(f'    name: "{name}",')
    out.append("    polygon: [")
    out.append(fmt([unplane(p) for p in cell], 6))
    out.append("    ],")
    out.append("  },")
out.append("];")
out.append("")

open("areas.js", "w", encoding="utf-8").write("\n".join(out))
print("areas.js written:", len(cells), "zones,", len(connections), "connections")
