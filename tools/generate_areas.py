import json, math

# ── Site boundary (lat, lng) from OSM ─────────────────────────────
raw = json.load(open("tools/bushywood-boundary.json", encoding="utf-8-sig"))["value"]
boundary = [(p[1], p[0]) for p in raw]

# ── Joseph's hand-edited zone shapes (2026-07-15) ─────────────────
zones = {
 "Main Campfire": [(50.860689,0.236865),(50.860628,0.236823),(50.860637,0.237023),(50.860650,0.237351),(50.860660,0.237456),(50.860801,0.237319),(50.860837,0.237272),(50.860878,0.237186),(50.860849,0.237078)],
 "Chapel": [(50.860791,0.237341),(50.860742,0.237414),(50.860659,0.237463),(50.860667,0.237770),(50.860669,0.237909),(50.860749,0.237958),(50.860856,0.237494)],
 "SD Glade": [(50.861106,0.237713),(50.861030,0.237642),(50.860791,0.237789),(50.860744,0.237984),(50.860659,0.238198),(50.860677,0.238271),(50.861234,0.238514),(50.861255,0.238406),(50.861255,0.237900)],
 "Village Square": [(50.860654,0.238261),(50.860618,0.238349),(50.860598,0.238528),(50.860571,0.238816),(50.860569,0.238879),(50.860547,0.238986),(50.860736,0.239115),(50.860775,0.238988),(50.860929,0.238978),(50.861041,0.238868),(50.861264,0.238528)],
 "Arena": [(50.861067,0.239288),(50.860867,0.239388),(50.860818,0.239521),(50.860675,0.239712),(50.860651,0.239840),(50.860839,0.240204),(50.861290,0.239470)],
 "Shops": [(50.860466,0.239553),(50.860584,0.239698),(50.860648,0.239824),(50.860664,0.239755),(50.860673,0.239696),(50.860808,0.239516),(50.860868,0.239384),(50.860850,0.239316),(50.860922,0.238992),(50.860773,0.238998),(50.860739,0.239119),(50.860569,0.239018),(50.860541,0.239009),(50.860510,0.239218),(50.860471,0.239346)],
 "Beeches": [(50.860829,0.240204),(50.860728,0.240012),(50.860652,0.239847),(50.860568,0.239692),(50.860466,0.239584),(50.860403,0.240019),(50.860361,0.240235),(50.860308,0.240486),(50.860356,0.240814),(50.860498,0.241007),(50.860547,0.241172),(50.860757,0.240756),(50.860918,0.240428)],
 "RPG Glade": [(50.860253,0.237962),(50.860286,0.238042),(50.860590,0.238211),(50.860645,0.237968),(50.860570,0.237480),(50.860434,0.237350),(50.860357,0.237378)],
 "Meadow": [(50.860408,0.236375),(50.860325,0.236335),(50.860251,0.236358),(50.860235,0.236390),(50.860108,0.237160),(50.860357,0.237378),(50.860467,0.237338),(50.860503,0.237225),(50.860602,0.236667),(50.860490,0.236419)],
 "Willows 1": [(50.860043,0.238784),(50.860540,0.238965),(50.860565,0.238784),(50.860583,0.238363),(50.860591,0.238219),(50.860298,0.238047),(50.860216,0.238099),(50.859948,0.238734)],
 "Willows 4": [(50.859903,0.237844),(50.860179,0.238000),(50.860255,0.237952),(50.860357,0.237378),(50.860092,0.237147),(50.859825,0.237610)],
 "Willows 5": [(50.859986,0.238744),(50.860109,0.238637),(50.860219,0.238087),(50.860183,0.238003),(50.859853,0.237816),(50.859837,0.237994),(50.859868,0.238263),(50.859780,0.238699)],
 "Willows 2": [(50.859550,0.238526),(50.859782,0.238698),(50.859868,0.238255),(50.859832,0.238008),(50.859839,0.237858),(50.859688,0.237606),(50.859341,0.238400),(50.859387,0.238430)],
 "Birches 1": [(50.860118,0.239553),(50.860287,0.239469),(50.860460,0.239560),(50.860466,0.239347),(50.860504,0.239215),(50.860544,0.238973),(50.860455,0.238935),(50.860296,0.238894),(50.860138,0.238844),(50.860048,0.238820)],
 "Birches 2": [(50.860300,0.240469),(50.860394,0.240024),(50.860447,0.239657),(50.860457,0.239568),(50.860388,0.239525),(50.860289,0.239472),(50.860136,0.239545),(50.859993,0.239749)],
 "Birches 3": [(50.859776,0.239246),(50.859947,0.239551),(50.859989,0.239739),(50.860047,0.239650),(50.860119,0.239564),(50.860046,0.238794),(50.860020,0.238754),(50.859781,0.238709),(50.859713,0.238872),(50.859594,0.239036),(50.859656,0.239147)],
 "Oaks 1": [(50.860278,0.240460),(50.860189,0.240248),(50.859812,0.240856),(50.859883,0.240936),(50.860048,0.241061),(50.860298,0.241287),(50.860434,0.241277),(50.860470,0.241191),(50.860549,0.241184),(50.860499,0.241026),(50.860354,0.240830)],
 "Oaks 2": [(50.860190,0.240232),(50.860152,0.240137),(50.860053,0.239909),(50.859987,0.239752),(50.859941,0.239563),(50.859461,0.240337),(50.859558,0.240503),(50.859701,0.240731),(50.859807,0.240852)],
 "Oaks 3": [(50.859942,0.239560),(50.859773,0.239260),(50.859391,0.239910),(50.859385,0.239922),(50.859435,0.240315),(50.859457,0.240334)],
 "Oaks 4": [(50.859369,0.239938),(50.859767,0.239254),(50.859655,0.239151),(50.859593,0.239038),(50.859568,0.239065),(50.859567,0.239138),(50.859472,0.239207),(50.859156,0.239557),(50.859167,0.239701),(50.859256,0.239785)],
 "Chestnut": [(50.859418,0.240592),(50.859444,0.240383),(50.859418,0.240225),(50.859450,0.240113),(50.859408,0.239983),(50.859389,0.239967),(50.859252,0.239783),(50.859164,0.239704),(50.859155,0.239561),(50.858987,0.239663),(50.858911,0.239781),(50.858750,0.239958),(50.859413,0.240599)],
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
    ("Willows 1","Willows 5"),("Willows 1","Birches 1"),
    ("Willows 4","Willows 5"),
    ("Willows 5","Willows 2"),("Willows 5","Birches 3"),
    ("Birches 1","Birches 2"),("Birches 1","Birches 3"),
    ("Birches 2","Birches 3"),("Birches 2","Oaks 2"),
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

def centroid(poly):
    A = Cx = Cy = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[(i+1) % len(poly)]
        cr = x1*y2 - x2*y1
        A += cr; Cx += (x1+x2)*cr; Cy += (y1+y2)*cr
    A /= 2
    return (Cx/(6*A), Cy/(6*A))

def convex_hull(pts):
    pts = sorted(set(pts))
    if len(pts) <= 2: return pts
    def half(seq):
        out = []
        for p in seq:
            while len(out) >= 2 and (out[-1][0]-out[-2][0])*(p[1]-out[-2][1]) - (out[-1][1]-out[-2][1])*(p[0]-out[-2][0]) <= 0:
                out.pop()
            out.append(p)
        return out
    lo = half(pts); hi = half(pts[::-1])
    return lo[:-1] + hi[:-1]

def clip_edge(subject, p1, p2):
    def inside(p):
        return (p2[0]-p1[0])*(p[1]-p1[1]) - (p2[1]-p1[1])*(p[0]-p1[0]) >= 0
    def inter(a, b):
        dc = (p1[0]-p2[0], p1[1]-p2[1]); dp = (a[0]-b[0], a[1]-b[1])
        n1 = p1[0]*p2[1] - p1[1]*p2[0]; n2 = a[0]*b[1] - a[1]*b[0]
        den = dc[0]*dp[1] - dc[1]*dp[0]
        if den == 0: return a
        return ((n1*dp[0]-n2*dc[0])/den, (n1*dp[1]-n2*dc[1])/den)
    out = []
    for i in range(len(subject)):
        cur, prev = subject[i], subject[i-1]
        if inside(cur):
            if not inside(prev): out.append(inter(prev, cur))
            out.append(cur)
        elif inside(prev):
            out.append(inter(prev, cur))
    return out

def polygon_ccw(poly):
    s = sum((poly[(i+1) % len(poly)][0]-poly[i][0]) * (poly[(i+1) % len(poly)][1]+poly[i][1]) for i in range(len(poly)))
    return poly if s < 0 else poly[::-1]

def clip_convex(subject, convex_clip):
    convex_clip = polygon_ccw(convex_clip)
    out = subject
    for i in range(len(convex_clip)):
        if not out: return []
        out = clip_edge(out, convex_clip[i], convex_clip[(i+1) % len(convex_clip)])
    return out

def bisector_line(a, b, inset):
    mx, my = (a[0]+b[0])/2, (a[1]+b[1])/2
    dx, dy = b[0]-a[0], b[1]-a[1]
    dl = math.hypot(dx, dy) or 1
    ux, uy = dx/dl, dy/dl
    mx -= ux*inset; my -= uy*inset
    ex, ey = -uy, ux
    T = 10000
    p1, p2 = (mx-ex*T, my-ey*T), (mx+ex*T, my+ey*T)
    if (p2[0]-p1[0])*(a[1]-p1[1]) - (p2[1]-p1[1])*(a[0]-p1[0]) < 0:
        p1, p2 = p2, p1
    return p1, p2

GAP = 4.0
def expand_for(name):
    if name == "Shops": return 2.5
    # these zones need extra reach so their linked borders actually meet
    if name in ("Willows 5", "Willows 2", "Birches 2", "Birches 3", "Oaks 2"): return 2.0
    return 1.45

def gap_for(i, j):
    return GAP

# Birches 3 and Oaks 2 are linked but meet diagonally at a four-corner
# where Birches 2 / Oaks 3 pinch between them, so those splits are
# WEIGHTED: the first-named zone gains this many metres from the second
# (both sides clip at the same shifted line — still touching, no overlap)
SHIFT = {
    ("Birches 3", "Oaks 3"):   10.0,
    ("Oaks 2",    "Oaks 3"):   10.0,
    ("Birches 3", "Birches 2"): 10.0,
    ("Oaks 2",    "Birches 2"): 10.0,
    # Shops/Beeches pinch at their four-corner with Arena / Birches 2
    ("Shops",   "Arena"):      5.0,
    ("Beeches", "Arena"):      5.0,
    ("Beeches", "Birches 2"):  5.0,
}

def linked_inset(i, j):
    if (names[i], names[j]) in SHIFT: return -SHIFT[(names[i], names[j])]
    if (names[j], names[i]) in SHIFT: return  SHIFT[(names[j], names[i])]
    return 0.0

seeds = [centroid(p) for p in zs]
cells = []
for i, poly in enumerate(zs):
    c = seeds[i]
    F = expand_for(names[i])
    grown = convex_hull([(c[0]+(x-c[0])*F, c[1]+(y-c[1])*F) for x, y in poly])
    cell = clip_convex(bnd, grown)
    for j in range(len(zs)):
        if i == j or not cell: continue
        inset = linked_inset(i, j) if (i, j) in conn_idx else gap_for(i, j)
        p1, p2 = bisector_line(seeds[i], seeds[j], inset)
        cell = clip_edge(cell, p1, p2)
    if len(cell) < 3:
        print("EMPTY CELL:", names[i]); cell = poly
    cells.append(cell)

# ── Verify: linked pairs touch, unlinked pairs gap, no overlaps ────
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

problems = 0
for i in range(len(cells)):
    for j in range(i+1, len(cells)):
        d = poly_min_dist(cells[i], cells[j])
        linked = (i, j) in conn_idx
        if linked and d > 1.0:
            print(f"WARN linked but gap {d:.1f} m: {names[i]} <-> {names[j]}"); problems += 1
        if not linked and d < 3.0:
            print(f"WARN unlinked but only {d:.1f} m apart: {names[i]} <-> {names[j]}"); problems += 1
print("verification done,", problems, "warnings")

# ── Emit areas.js ─────────────────────────────────────────────────
def fmt(poly, ind):
    pad = " " * ind
    return "\n".join(f"{pad}[{round(p[0],6)}, {round(p[1],6)}]," for p in poly)

out = []
out.append("// ── CAMPSITE AREAS — Bushy Wood Activity Centre ───────────────────")
out.append("// The 21 zones of the Strange Games Festival, based on Joseph's")
out.append("// hand-traced shapes (2026-07-15), adjusted so that LINKED zones")
out.append("// share a border, unlinked neighbours have a clear gap, and nothing")
out.append("// overlaps. Ground belonging to no zone renders as grey hatching.")
out.append("// Re-trace any zone with the in-app Area Editor (Settings, admin only).")
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
