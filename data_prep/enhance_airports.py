"""
Enhances the base AIRPORTS list with:
- home province (Thai name) and English province key (GADM NAME_1)
- safe air navigation zone details (LHZ 10 km + runway approach zone bowtie)
Writes web/data/airports_enhanced.json.
"""
import json
import os
import math

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEBDATA = os.path.join(BASE, "data")
OUT = os.path.join(WEBDATA, "airports_enhanced.json")

# Manual mapping ICAO -> province (GADM NAME_1) based on known ARP locations.
PROVINCE_BY_ICAO = {
    "BTZ": ("ยะลา", "Yala"),
    "VTBD": ("กรุงเทพมหานคร", "Bangkok Metropolis"),
    "VTBK": ("นครปฐม", "Nakhon Pathom"),
    "VTBL": ("ลพบุรี", "Lop Buri"),
    "VTBO": ("ตราด", "Trat"),
    "VTBS": ("สมุทรปราการ", "Samut Prakan"),
    "VTBU": ("ฉบังเทรา", "Chachoengsao"),
    "VTCC": ("เชียงใหม่", "Chiang Mai"),
    "VTCH": ("แม่ฮ่องสอน", "Mae Hong Son"),
    "VTCL": ("ลำปาง", "Lampang"),
    "VTCN": ("น่าน", "Nan"),
    "VTCP": ("แพร่", "Phrae"),
    "VTCT": ("เชียงราย", "Chiang Rai"),
    "VTPB": ("เพชรบูรณ์", "Phetchabun"),
    "VTPH": ("ประจวบคีรีขันธ์", "Prachuap Khiri Khan"),
    "VTPI": ("ลพบุรี", "Lop Buri"),
    "VTPM": ("ตาก", "Tak"),
    "VTPO": ("สุโขทัย", "Sukhothai"),
    "VTPP": ("พิษณุโลก", "Phitsanulok"),
    "VTPT": ("ตาก", "Tak"),
    "VTSB": ("สุราษฎร์ธานี", "Surat Thani"),
    "VTSC": ("นราธิวาส", "Narathiwat"),
    "VTSE": ("ชุมพร", "Chumphon"),
    "VTSF": ("นครศรีธรรมราช", "Nakhon Si Thammarat"),
    "VTSG": ("กระบี่", "Krabi"),
    "VTSH": ("สงขลา", "Songkhla"),
    "VTSK": ("ปัตตานี", "Pattani"),
    "VTSM": ("สุราษฎร์ธานี", "Surat Thani"),
    "VTSN": ("สุราษฎร์ธานี", "Surat Thani"),
    "VTSP": ("ภูเก็ต", "Phuket"),
    "VTSR": ("ระนอง", "Ranong"),
    "VTSS": ("สงขลา", "Songkhla"),
    "VTST": ("ตรัง", "Trang"),
    "VTUD": ("อุดรธานี", "Udon Thani"),
    "VTUI": ("สกลนคร", "Sakon Nakhon"),
    "VTUJ": ("สุรินทร์", "Surin"),
    "VTUK": ("ขอนแก่น", "Khon Kaen"),
    "VTUL": ("เลย", "Loei"),
    "VTUO": ("บุรีรัมย์", "Buri Ram"),
    "VTUQ": ("นครราชสีมา", "Nakhon Ratchasima"),
    "VTUU": ("อุบลราชธานี", "Ubon Ratchathani"),
    "VTUV": ("รอยเอ็ด", "Roi Et"),
    "VTUW": ("นครพนม", "Nakhon Phanom"),
}


def dest_point(lat, lon, bearing_deg, km):
    """Destination point given start lat/lon, bearing (deg), distance (km)."""
    R = 6371.0
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    brg = math.radians(bearing_deg)
    d = km / R
    lat2 = math.asin(
        math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(brg)
    )
    lon2 = lon1 + math.atan2(
        math.sin(brg) * math.sin(d) * math.cos(lat1),
        math.cos(d) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), math.degrees(lon2)


def trapezoid(lat, lon, bearing, d0, d1, w0, w1):
    """Trapezoid band segment along `bearing` from d0->d1 km with half-widths
    w0/2 -> w1/2 (km) perpendicular to the runway axis (band model, like
    birdheatmap)."""
    perp1 = (bearing + 90) % 360
    perp2 = (bearing - 90) % 360
    p0 = dest_point(lat, lon, bearing, d0)
    p1 = dest_point(lat, lon, bearing, d1)
    c0a = dest_point(p0[0], p0[1], perp1, w0 / 2)
    c0b = dest_point(p0[0], p0[1], perp2, w0 / 2)
    c1a = dest_point(p1[0], p1[1], perp1, w1 / 2)
    c1b = dest_point(p1[0], p1[1], perp2, w1 / 2)
    return [(la, lo) for la, lo in [c0a, c1a, c1b, c0b]]


def band_phz(ap):
    """Band-based PHZ: 0-3 km corridor + 3-8 km corridor fanning out with
    half-angle 15 degrees from the runway centreline (both directions)."""
    brg = ap.get("rwyBearingDeg") or 0.0
    lat, lon = ap["lat"], ap["lon"]
    bands = []
    # Band 1: 0-3 km corridor, half-width 0.5 -> 0.9 km
    bands.append({
        "nameTh": "PHZ Band 1 (0-3 กม. จาก ARP)",
        "halfAngleDeg": 0.0,
        "d0": 0, "d1": 3, "w0": 1.0, "w1": 1.8,
        "rings": []})
    # Band 2: 3-8 km corridor, fans out at 15 degrees half-angle
    half = 15.0
    w3 = 2 * 3.0 * math.tan(math.radians(half))  # half-width at 3 km = d*tan(15)
    w8 = 2 * 8.0 * math.tan(math.radians(half))
    bands.append({
        "nameTh": "PHZ Band 2 (3-8 กม. จาก ARP, กางออก 15°)",
        "halfAngleDeg": half,
        "d0": 3, "d1": 8, "w0": w3, "w1": w8,
        "rings": []})
    for band in bands:
        for sign in (1, -1):
            b = brg if sign == 1 else (brg + 180) % 360
            band["rings"].append(trapezoid(lat, lon, b, band["d0"], band["d1"],
                                           band["w0"], band["w1"]))
    return bands


def airport_zones(ap):
    """Build LHZ 10km circle + runway approach bowtie polygons for an airport."""
    brg = ap.get("rwyBearingDeg") or 0.0
    lat, lon = ap["lat"], ap["lon"]
    # Low Height Zone: 10 km circle (Roi Et model + standard 10km rule)
    circle = [dest_point(lat, lon, a, 10.0) for a in range(0, 360, 10)]
    circle.append(circle[0])
    zones = {
        "lhz_10km": {
            "nameTh": "เขตห้าม (10 กม. รอบท่าอากาศยาน)",
            "color": "#e53e3e",
            "ring": [[(la, lo) for la, lo in circle]],
            "rule": "ห้ามจด/ปล่อยวัตถุขึ้นอากาศ เว้นได้รับอนุญาต — ประกาศฉบับมาตรฐาน",
        }
    }
    # Standard approach zone (PHZ-style bowtie): 3km wide at ARP, expanding along RWY
    if ap.get("rwyBearingDeg") is not None:
        # Runway corridor: 8 km along each direction, 2.5 km wide
        for sign in (1, -1):
            b = brg if sign == 1 else (brg + 180) % 360
            tip = dest_point(lat, lon, b, 8.0)
            tl = dest_point(lat, lon, b + 105, 2.5)
            tr = dest_point(lat, lon, b + 75, 2.5)
            zones[f"rwy_{sign:+d}"] = {
                "nameTh": "แนวขึ้น-ลงเครื่องบิน (PHZ)",
                "color": "#dd6b20",
                "ring": [[(lat, lon), tl, tip, tr, (lat, lon)]],
                "rule": "แนวขึ้น/ลงจริง — ห้ามปล่อยวัตถุเด็ดขาด (AOT/ผู้ให้บริการการเดินอากาศ)",
            }
    # Band-based PHZ (new, replaces the single bowtie visually)
    if ap.get("rwyBearingDeg") is not None:
        zones["phz_bands"] = band_phz(ap)
    return zones


def main():
    os.makedirs(WEBDATA, exist_ok=True)
    with open(os.path.join(WEBDATA, "airports.json"), encoding="utf-8") as f:
        airports = json.load(f)
    enhanced = []
    for ap in airports:
        icao = ap["icao"]
        th, en = PROVINCE_BY_ICAO.get(icao, ("ไม่ทราบ", "Unknown"))
        out = dict(ap)
        out["provinceTh"] = th
        out["provinceEn"] = en
        out["zones"] = airport_zones(ap)
        enhanced.append(out)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(enhanced, f, ensure_ascii=False, separators=(",", ":"))
    print("Wrote", OUT, len(enhanced), "airports")


if __name__ == "__main__":
    main()
