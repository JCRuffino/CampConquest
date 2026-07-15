import json, math

# ── Site boundary (lat, lng) from OSM ─────────────────────────────
raw = json.load(open("tools/bushywood-boundary.json", encoding="utf-8-sig"))["value"]
boundary = [(p[1], p[0]) for p in raw]

# ── Joseph's hand-edited zone shapes (2026-07-15) ─────────────────
zones = {
 "Main Campfire": [(50.860568,0.236834),(50.860653,0.237314),(50.860668,0.237449),(50.860737,0.237393),(50.860839,0.237263),(50.860884,0.237169),(50.860834,0.237052),(50.860788,0.236995),(50.860670,0.236835),(50.860618,0.236823),(50.860594,0.236819)],
 "Chapel": [(50.860826,0.237479),(50.860753,0.237397),(50.860686,0.237447),(50.86066,0.237467),(50.860674,0.237907),(50.860649,0.237976),(50.86066,0.238021),(50.860723,0.237919),(50.86085,0.237593)],
 "SD Glade": [(50.860991,0.237771),(50.860829,0.23768),(50.860705,0.237964),(50.860645,0.238182),(50.860648,0.238193),(50.861118,0.238481),(50.861153,0.238304),(50.861111,0.238186),(50.861143,0.238081),(50.861153,0.237955),(50.86105,0.237826)],
 "Village Square": [(50.860655,0.238198),(50.860584,0.238252),(50.860584,0.238529),(50.860567,0.238812),(50.860561,0.238867),(50.86095,0.239055),(50.861032,0.23902),(50.861143,0.238497)],
 "Arena": [(50.861077,0.239284),(50.860994,0.239197),(50.860976,0.239174),(50.86064,0.239796),(50.860764,0.240046),(50.860813,0.240161),(50.860858,0.240178),(50.86129,0.239465)],
 "Shops": [(50.860472,0.23943),(50.860466,0.239556),(50.860525,0.239621),(50.860611,0.239753),(50.86064,0.239796),(50.861021,0.239083),(50.860564,0.238887),(50.86051,0.239209),(50.860471,0.239342)],
 "Beeches": [(50.860836,0.240211),(50.86064,0.239796),(50.860557,0.239776),(50.860401,0.240017),(50.860357,0.240216),(50.860335,0.240377),(50.860557,0.240856),(50.86078,0.240704),(50.860923,0.240422),(50.860831,0.240256)],
 "RPG Glade": [(50.860199,0.237933),(50.860278,0.237994),(50.860595,0.238222),(50.860601,0.238108),(50.860661,0.237925),(50.86065,0.23748),(50.860645,0.237405),(50.86062,0.237378),(50.86056,0.237276),(50.860509,0.237354),(50.860374,0.237394),(50.860279,0.237695)],
 "Meadow": [(50.860367,0.237404),(50.860419,0.237263),(50.86047,0.237093),(50.860559,0.23683),(50.860486,0.236826),(50.860463,0.236702),(50.860449,0.236587),(50.860392,0.236556),(50.860335,0.236529),(50.860276,0.236547),(50.860278,0.236839),(50.860222,0.236999),(50.86017,0.23719)],
 "Willows 1": [(50.860148,0.238754),(50.860459,0.23879),(50.860556,0.238867),(50.860574,0.238529),(50.860593,0.238222),(50.860537,0.238184),(50.860289,0.23801),(50.860189,0.238057),(50.860069,0.238653)],
 "Willows 4": [(50.859918,0.237821),(50.860149,0.237958),(50.860193,0.237916),(50.860227,0.237834),(50.860366,0.237413),(50.860162,0.23719),(50.860029,0.237484),(50.859958,0.237614),(50.859873,0.237691)],
 "Willows 5": [(50.860021,0.238703),(50.860066,0.238669),(50.860203,0.23799),(50.860202,0.237989),(50.859848,0.237811),(50.859839,0.238),(50.859868,0.238261),(50.859794,0.238642)],
 "Willows 2": [(50.859528,0.238481),(50.859777,0.238691),(50.859858,0.238265),(50.85983,0.237988),(50.859829,0.237834),(50.85947,0.237386),(50.859242,0.238219),(50.859355,0.238309)],
 "Birches 1": [(50.860079,0.23943),(50.860428,0.239466),(50.860508,0.238882),(50.860482,0.23882),(50.860407,0.238784),(50.860124,0.238752),(50.860085,0.238781)],
 "Birches 2": [(50.86035,0.240245),(50.860362,0.24016),(50.860401,0.240007),(50.86053,0.239815),(50.860383,0.239461),(50.860203,0.239443),(50.860027,0.2397)],
 "Birches 3": [(50.859726,0.239464),(50.859828,0.239697),(50.860034,0.23969),(50.860077,0.239626),(50.860085,0.23882),(50.859982,0.238755),(50.859784,0.238721),(50.859606,0.239029)],
 "Oaks 1": [(50.860501,0.240728),(50.860295,0.240259),(50.860177,0.240252),(50.859829,0.24087),(50.859887,0.240932),(50.860054,0.241072),(50.860195,0.241192),(50.860371,0.240988)],
 "Oaks 2": [(50.860204,0.240204),(50.860209,0.239995),(50.860042,0.239724),(50.860001,0.239691),(50.8599,0.239695),(50.859568,0.240225),(50.859545,0.240465),(50.859597,0.240565),(50.859683,0.24072),(50.859834,0.24087)],
 "Oaks 3": [(50.859556,0.240227),(50.85989,0.239709),(50.859829,0.239709),(50.859795,0.239674),(50.859714,0.239468),(50.859416,0.239983),(50.859465,0.240149)],
 "Oaks 4": [(50.859413,0.239979),(50.859718,0.239457),(50.859649,0.239217),(50.859597,0.23904),(50.859569,0.239064),(50.859571,0.239151),(50.859467,0.239207),(50.859417,0.239281),(50.859285,0.23943),(50.859158,0.239556),(50.859164,0.2397),(50.859258,0.239785),(50.859329,0.23989)],
 "Chestnut": [(50.85936,0.239932),(50.859253,0.239789),(50.859164,0.239705),(50.859157,0.239563),(50.858972,0.239677),(50.858785,0.239992),(50.859292,0.240483),(50.859408,0.240291),(50.859424,0.240177),(50.859443,0.240117),(50.859404,0.239981)],
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
