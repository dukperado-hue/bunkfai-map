/**
 * แผนที่ประกาศบั๊งบึงไฟ (Bun Bang Fai) 77 จังหวัด + กทม.
 * Offline Leaflet app — GIS engine based on the same Earth Engine concept
 * (gee/bunbangfai_regulation_map.js) but computed client-side with no GEE
 * account needed. Works by opening index.html directly (file://).
 *
 * Layers:
 *   - PROVINCES: Thailand ADM-1 boundaries (77 provinces), colored by region;
 *     click a province to view its regulation card.
 *   - AIRPORTS: AIP Thailand 2026-07-09 (43 ARP) with a 10 km Low Height
 *     Zone circle (standard provincial rule) + band-based runway approach
 *     zones (PHZ Band 1 = 0-3 km corridor, Band 2 = 3-8 km fanning at 15°),
 *     the same trapezoid math as the birdheatmap base repo.
 *   - TOOLS: Pin Drop Clearance Check, Glide-Path Trajectory Simulator,
 *     Administrative Response Letter generator, Occurrence Log + Heatmap.
 */

// ---------------------------------------------------------------------------
// Geometry helpers (same math as the Earth Engine script)
// ---------------------------------------------------------------------------

function destPoint(lat, lon, bearingDeg, distKm) {
  var R = 6371.0;
  var brg = bearingDeg * Math.PI / 180;
  var lat1 = lat * Math.PI / 180;
  var lon1 = lon * Math.PI / 180;
  var ang = distKm / R;
  var lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brg));
  var lon2 = lon1 + Math.atan2(
    Math.sin(brg) * Math.sin(ang) * Math.cos(lat1),
    Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2)
  );
  return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
}

function haversineKm(a, b) {
  var R = 6371.0;
  var dLat = (b[0] - a[0]) * Math.PI / 180;
  var dLon = (b[1] - a[1]) * Math.PI / 180;
  var la1 = a[0] * Math.PI / 180, la2 = b[0] * Math.PI / 180;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Bearing from a to b in degrees true.
function bearingDeg(a, b) {
  var dLon = (b[1] - a[1]) * Math.PI / 180;
  var la1 = a[0] * Math.PI / 180, la2 = b[0] * Math.PI / 180;
  var y = Math.sin(dLon) * Math.cos(la2);
  var x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

// Point-in-polygon ray-casting (flat approximation, fine at province scale).
function pointInPoly(pt, poly) {
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    var intersect = ((yi > pt[0]) !== (yj > pt[0])) &&
      (pt[1] < (xj - xi) * (pt[0] - yi) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Standard declaration per provincial proclamations: ห้ามจด/ปล่อยวัตถุขึ้นอากาศ
// ในรัศมี 10 กม. จากท่าอากาศยาน เว้นแต่ได้รับอนุญาต — modeled as the LHZ circle.
var LHZ_RADIUS_KM = 10;

var ZONE_STYLE = {
  lhz: { color: '#c1121f', weight: 2, fill: true, fillColor: '#c1121f', fillOpacity: 0.14, dashArray: '6 4' },
  phz1: { color: '#99000d', weight: 1, fill: true, fillColor: '#e31a1c', fillOpacity: 0.7 },
  phz2: { color: '#780000', weight: 1, fill: true, fillColor: '#ff4d6d', fillOpacity: 0.55 }
};

var REGION_COLORS = {
  'ภาคเหนือ': '#7f5539',
  'ภาคกลาง': '#118ab2',
  'ภาคอีสาน': '#e63946',
  'ภาคตะวันออก': '#2a9d8f',
  'ภาคตะวันตก': '#e9c46a',
  'ภาคใต้': '#264653'
};

var REGION_LIST = ['ภาคเหนือ', 'ภาคกลาง', 'ภาคอีสาน', 'ภาคตะวันออก', 'ภาคตะวันตก', 'ภาคใต้'];

// ---------------------------------------------------------------------------
// Map + layers
// ---------------------------------------------------------------------------

var map = L.map('map', { zoomControl: true }).setView([14.5, 101.0], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 18
}).addTo(map);

var provinceLayer = null;
var zoneLayerGroup = L.layerGroup().addTo(map);
var toolLayerGroup = L.layerGroup().addTo(map);
var pinMarker = null;
var selectedProvinceKey = null;
var pinDropMode = false;
var occurrences = [];
var heatLayer = null;

function provinceNameKey(nameEn) {
  if (nameEn === 'Bangkok' || nameEn === 'Krung Thep Mahanakhon') return 'Bangkok Metropolis';
  return nameEn;
}

function loadOccurrences() {
  try {
    var raw = localStorage.getItem('bunkfai_occurrences');
    occurrences = raw ? JSON.parse(raw) : [];
  } catch (e) { occurrences = []; }
}

function saveOccurrences() {
  localStorage.setItem('bunkfai_occurrences', JSON.stringify(occurrences));
}

// ---------------------------------------------------------------------------
// Province layer
// ---------------------------------------------------------------------------

function provinceStyleFn(key) {
  return {
    color: '#555f70',
    weight: 1,
    fillColor: '#999',
    fillOpacity: 0.35
  };
}

function restyleProvinces() {
  provinceLayer.eachLayer(function (layer) {
    var key = provinceNameKey(layer.feature.properties.NAME_1);
    var rec = PROV_REF.find(function (r) { return r.en === key; });
    var region = rec ? rec.region : 'ภาคกลาง';
    var isSelected = key === selectedProvinceKey;
    layer.setStyle({
      color: isSelected ? '#ffd166' : '#555f70',
      weight: isSelected ? 3 : 1,
      fillColor: isSelected ? '#ffd166' : (REGION_COLORS[region] || '#999'),
      fillOpacity: isSelected ? 0.5 : 0.35
    });
  });
}

function buildProvinceLayer() {
  provinceLayer = L.geoJson(PROVINCES, {
    onEachFeature: function (feat, layer) {
      var key = provinceNameKey(feat.properties.NAME_1);
      layer.on('click', function () { selectProvince(key); });
      layer.on('mouseover', function () {
        if (key !== selectedProvinceKey) layer.setStyle({ weight: 2, fillOpacity: 0.55 });
      });
      layer.on('mouseout', function () { restyleProvinces(); });
    }
  }).addTo(map);
  restyleProvinces();
}

// ---------------------------------------------------------------------------
// Airport layer — band-based PHZ (like birdheatmap trapezoid model)
// ---------------------------------------------------------------------------

function drawAirportZones(ap) {
  zoneLayerGroup.clearLayers();
  var lat = ap.lat, lon = ap.lon;
  if (document.getElementById('toggle-lhz').checked) {
    L.circle([lat, lon], { radius: LHZ_RADIUS_KM * 1000, ...ZONE_STYLE.lhz }).addTo(zoneLayerGroup);
  }
  if (document.getElementById('toggle-phz').checked) {
    var bands = (ap.zones && ap.zones.phz_bands) || null;
    if (bands) {
      bands.forEach(function (band) {
        band.rings.forEach(function (ring) {
          L.polygon(ring, band.d1 <= 3 ? ZONE_STYLE.phz1 : ZONE_STYLE.phz2).addTo(zoneLayerGroup);
        });
      });
    } else {
      // Legacy fallback: old simple bowtie
      var brg = ap.rwyBearingDeg;
      for (var sign of [1, -1]) {
        var b = (brg + (sign > 0 ? 0 : 180)) % 360;
        var tip = destPoint(lat, lon, b, 8);
        var tl = destPoint(lat, lon, (b + 105) % 360, 2.5);
        var tr = destPoint(lat, lon, (b + 75) % 360, 2.5);
        L.polygon([[lat, lon], tl, tip, tr], ZONE_STYLE.phz1).addTo(zoneLayerGroup);
      }
    }
  }
  L.circleMarker([lat, lon], { radius: 4, color: '#ffffff', weight: 2, fillColor: '#000000', fillOpacity: 1 })
    .bindTooltip(ap.icao + ' — ' + ap.nameTh, { permanent: false })
    .addTo(zoneLayerGroup);
}

// Cross-track distance from pt to the great-circle axis at bearing brgDeg (km).
function crossTrackKm(ap, pt, brgDeg) {
  var angDist = haversineKm(ap, pt) / 6371.0;
  var initBrg = bearingDeg(ap, pt) * Math.PI / 180;
  var brg = brgDeg * Math.PI / 180;
  var xt = Math.asin(Math.sin(angDist) * Math.sin(initBrg - brg));
  return Math.abs(xt) * 6371.0;
}
// Test whether a point lies inside an airport's LHZ / PHZ bands.
// Returns an array of { icao, zoneType, zoneLabel, distKm, rule } hits,
// ordered by distance.
function checkClearance(pt) {
  var hits = [];
  AIRPORTS.forEach(function (ap) {
    var d = haversineKm(pt, [ap.lat, ap.lon]);
    if (d <= LHZ_RADIUS_KM) {
      hits.push({ icao: ap.icao, nameTh: ap.nameTh, zoneType: 'LHZ',
        zoneLabel: 'เขตห้าม 10 กม. รอบท่าอากาศยาน (LHZ)', distKm: d,
        rule: 'ห้ามจด/ปล่อยวัตถุขึ้นอากาศ เว้นแต่ได้รับอนุญาตจากผู้จัดการ/ผู้ประกอบท่าอากาศยาน' });
    } else {
      var bands = (ap.zones && ap.zones.phz_bands) || [];
      var brg = ap.rwyBearingDeg;
      var hitBand = null;
      bands.forEach(function (band) {
        if (hitBand || d < band.d0 || d > band.d1) return;
        // Project point onto runway axis: angular distance check
        var b1 = brg, b2 = (brg + 180) % 360;
        for (var dir = 0; dir < 2; dir++) {
          var b = dir === 0 ? b1 : b2;
          var relBrg = (((bearingDeg([ap.lat, ap.lon], pt) - b + 540) % 360) - 180);
          if (Math.abs(relBrg) > 90) continue;
          var halfWidthKm = d * Math.tan(band.halfAngleDeg * Math.PI / 180);
          if (band.d1 <= 3 && band.d0 === 0) {
            // Band 1 is a corridor: width tapers w0..w1 with distance
            halfWidthKm = (band.w0 + (band.w1 - band.w0) * d / band.d1) / 2;
          }
          var xt = crossTrackKm([ap.lat, ap.lon], pt, b);
          if (xt < halfWidthKm) { hitBand = band; break; }
        }
      });
      if (hitBand) {
        hits.push({ icao: ap.icao, nameTh: ap.nameTh, zoneType: 'PHZ',
          zoneLabel: hitBand.nameTh, distKm: d,
          rule: 'แนวขึ้น-ลงเครื่องบิน (PHZ) — ห้ามปล่อยวัตถุเด็ดขาด' });
      }
    }
  });
  hits.sort(function (a, b) { return a.distKm - b.distKm; });
  return hits;
}

function findProvince(pt) {
  for (var i = 0; i < PROVINCES.features.length; i++) {
    var f = PROVINCES.features[i];
    var polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    var found = false;
    polys.forEach(function (poly) {
      if (found) return;
      for (var r = 0; r < poly.length; r++) {
        if (pointInPoly(pt, poly[r])) { found = true; return; }
      }
    });
    if (found) return provinceNameKey(f.properties.NAME_1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pin drop mode
// ---------------------------------------------------------------------------

function wirePinDrop() {
  var btn = document.getElementById('pin-drop-btn');
  btn.addEventListener('click', function () {
    pinDropMode = !pinDropMode;
    btn.classList.toggle('active', pinDropMode);
    btn.textContent = pinDropMode ? '✖ ยกเลิกโหมดปักหมุด' : '📍 ปักหมุดตรวจสอบ (Clearance Check)';
    map.getContainer().style.cursor = pinDropMode ? 'crosshair' : '';
    if (!pinDropMode && pinMarker) { pinMarker.remove(); pinMarker = null; }
  });
  map.on('click', function (e) {
    if (!pinDropMode) return;
    runClearanceCheck([e.latlng.lat, e.latlng.lng]);
  });
}

function runClearanceCheck(pt) {
  if (pinMarker) pinMarker.remove();
  lastPin = pt;
  pinMarker = L.circleMarker(pt, { radius: 9, color: '#ffbe0b', weight: 3, fillColor: '#ffbe0b', fillOpacity: 0.9 }).addTo(toolLayerGroup);
  map.setView(pt, Math.max(map.getZoom(), 10));

  var hits = checkClearance(pt);
  var provKey = findProvince(pt);
  var rec = provKey ? PROV_REF.find(function (r) { return r.en === provKey; }) : null;
  var d = provKey ? (PROV_DATA[provKey] || null) : null;

  // Glide-path / trajectory context vs nearest airport
  var nearest = hits.length ? hits[0] : null;
  var simContext = nearest ? simContextFor(nearest, pt) : null;

  var html =
    '<div class="card-province">📍 พิกัดตรวจสอบ</div>' +
    '<div class="card-row"><span class="card-label">ละติจูด</span><span>' + pt[0].toFixed(5) + '</span></div>' +
    '<div class="card-row"><span class="card-label">ลองติจูด</span><span>' + pt[1].toFixed(5) + '</span></div>';
  if (rec && d) {
    html += '<div class="card-row"><span class="card-label">จังหวัด</span><span>' + rec.th + ' (' + rec.region + ')</span></div>';
    html += '<div class="card-row"><span class="card-label">ยื่นขอล่วงหน้า</span><span>' + (d.applyDaysAdvance ? '≥ ' + d.applyDaysAdvance + ' วัน' : 'ตามประกาศจังหวัด') + '</span></div>';
    html += '<div class="card-row"><span class="card-label">ผู้อนุญาต</span><span>' + (d.authority || 'ผู้จัดการ/ผู้ประกอบท่าอากาศยาน') + '</span></div>';
    html += '<div class="card-row"><span class="card-label">เทศกาล</span><span>' + (d.festival || 'ทั่วไป') + '</span></div>';
  } else {
    html += '<div class="card-row"><span class="card-label">จังหวัด</span><span>ไม่สามารถระบุ (นอกผังประเทศ)</span></div>';
  }
  html += '<div class="section-title" style="margin-top:8px">สถานะทางน่านฟ้า</div>';
  if (hits.length === 0) {
    html += '<div class="stat-empty">✅ ไม่ติดเขตปลอดัยทางการเดินอากาศของทุกสนามบิน (อยู่นอก LHZ 10 กม. และ PHZ)</div>';
  } else {
    hits.slice(0, 5).forEach(function (h) {
      html += '<div class="card-row"><span class="card-label">⛔ ' + h.zoneType + ' ' + h.icao + '</span><span>~' + h.distKm.toFixed(1) + ' กม. — ' + h.zoneLabel + '</span></div>';
    });
    html += '<div class="disclaimer">ติดเขต ⛔ = ห้ามจด/ปล่อยวัตถุขึ้นอากาศ เว้นแต่ได้รับอนุญาตจากท่าอากาศยาน</div>';
  }
  if (simContext) {
    html += '<div class="section-title" style="margin-top:8px">บริบทแนวร่อน (3° Glide Slope)</div>';
    html += '<div class="card-row"><span class="card-label">ระดับเครื่องบิน</span><span>~' + simContext.gsAltM + ' ม. TAE ณ ระยะ ' + simContext.distKm.toFixed(1) + ' กม. จาก ' + simContext.icao + '</span></div>';
    html += '<div class="card-row"><span class="card-label">ข้อแนะนำ</span><span>' + simContext.advice + '</span></div>';
  }
  html += '<div class="card-row" style="border:none"><button class="tool-btn" id="letter-from-pin">📄 สร้างร่างหนังสือตอบกลับ</button> ' +
    '<button class="tool-btn" id="log-from-pin">📝 บันทึกเป็นเหตุการณ์</button></div>';
  document.getElementById('regulation-card').innerHTML = html;

  // wire the two new buttons on the pin panel
  setTimeout(function () {
    var bl = document.getElementById('letter-from-pin');
    if (bl) bl.addEventListener('click', function () {
      openLetterModal({ lat: pt[0], lon: pt[1], provKey: provKey, rec: rec, d: d, hits: hits });
    });
    var bo = document.getElementById('log-from-pin');
    if (bo) bo.addEventListener('click', function () {
      openOccurrenceForm(pt, provKey, rec, hits);
    });
  }, 0);
}

// ---------------------------------------------------------------------------
// Glide-path trajectory simulation (conservative physics)
// ---------------------------------------------------------------------------

var BUNFAI_TYPES = {
  // mode 'rocket': black-powder motor with sustained thrust (thrust N, burn s).
  // mode 'khom': buoyancy-driven lantern rising at riseV m/s for burnMin minutes.
  'mun': { label: 'บั้งไฟหมื่น (≈ 30 กก.)', mode: 'rocket', v0: 25, mass: 30, thrust: 620, tburn: 2.4, peakM: 500 },
  'saen': { label: 'บั้งไฟแสน (≈ 120 กก.)', mode: 'rocket', v0: 30, mass: 120, thrust: 2300, tburn: 5.0, peakM: 1100 },
  'lan': { label: 'บั้งไฟล้าน (≈ 1,000 กก.)', mode: 'rocket', v0: 35, mass: 1000, thrust: 19000, tburn: 8.5, peakM: 3000 },
  'plu': { label: 'พลุ / ตะไล', mode: 'rocket', v0: 60, mass: 1, thrust: 62, tburn: 1.2, peakM: 300 },
  'khom': { label: 'โคมลอย / โคมไฟ', mode: 'khom', riseV: 3, burnMin: 45, fallV: 2, peakM: 1500 }
};

// Thrust-phase ballistic simulation for rockets: gravity + quadratic drag,
// mass decreases during motor burn (~65% of initial mass is fuel), then
// free-fall coast with drag. Peak via Euler integration at dt = 5 ms.
function simRocketPeak(t) {
  var g = 9.81, rho = 1.1, cd = 0.7, A = 0.02, dt = 0.005;
  var v = t.v0, z = 0, tt = 0, mass = t.mass;
  var rate = (0.65 * t.mass) / t.tburn; // fuel burn rate kg/s
  var peak = 0;
  while (tt < 600) {
    var drag = 0.5 * rho * cd * A * v * v;
    var a;
    if (tt < t.tburn) {
      a = (t.thrust - drag) / mass - g;
      mass -= rate * dt;
    } else {
      a = -drag / Math.max(mass, 0.05) - g;
    }
    v += a * dt;
    z += v * dt;
    tt += dt;
    if (z > peak) peak = z;
    if (v < 0 && z <= 0) break;
  }
  // Cap at the documented realistic peak for this type (no overestimate)
  return Math.min(peak, t.peakM * 1.1);
}

// Buoyancy-driven rise for khom loy: ~3 m/s rise for up to burnMin minutes,
// capped at the documented realistic ceiling (~1,500 m) since cold air aloft
// and envelope cooling limit altitude.
function simKhomPeak(t) {
  return Math.min(t.riseV * t.burnMin * 60, t.peakM);
}

function simulatePeak(typeKey) {
  var t = BUNFAI_TYPES[typeKey];
  return t.mode === 'khom' ? simKhomPeak(t) : simRocketPeak(t);
}

// Fallout distance: rockets fall nearly vertically with wind drift during descent;
// khom loy float down slowly, drifting kilometers with the wind.
function falloutKm(typeKey) {
  var t = BUNFAI_TYPES[typeKey];
  var peak = simulatePeak(typeKey);
  var wind = 5; // m/s horizontal wind
  if (t.mode === 'khom') return Math.round((peak / (t.fallV * 1000) * wind + t.burnMin * wind / 60) * 10) / 10;
  var fallTime = peak / 15; // descent at ~15 m/s terminal-ish speed
  return fallTime * wind / 1000;
}

function simContextFor(hit, pt) {
  var ap = AIRPORTS.find(function (a) { return a.icao === hit.icao; });
  if (!ap) return null;
  var dKm = hit.distKm;
  var gsAltM = Math.round(dKm * 1000 * Math.tan(3 * Math.PI / 180));
  var advice = null;
  if (hit.zoneType === 'PHZ') advice = 'อยู่ในแนวขึ้น-ลงเครื่องบิน — ระดับเครื่องบินต่ำกว่า ' + gsAltM + ' ม. ท่าอากาศยาน';
  else if (dKm <= 5) advice = 'ใกล้ท่าอากาศยานมาก — ควรตรวจสอบกับหอบังคับการบินก่อนอนุญาตเสมอ';
  else advice = 'นอกแนวร่อนหลัก — ติดต่อท่าอากาศยานเพื่อยืนยันก่อนอนุญาต';
  return { icao: ap.icao, distKm: dKm, gsAltM: gsAltM, advice: advice };
}

function runSimulation() {
  var typeKey = document.getElementById('sim-type').value;
  var t = BUNFAI_TYPES[typeKey];
  var peak = Math.round(simulatePeak(typeKey));
  var fallout = falloutKm(typeKey).toFixed(1);
  var simInfo = t.mode === 'khom'
    ? 'ลอยขึ้น ≈ ' + t.riseV + ' ม./วิ × ' + t.burnMin + ' นาที แล้วลอยลงด้วยลม'
    : 'แรงผลัก ≈ ' + Math.round(t.thrust / t.mass) + ' × น้ำหนัก เผาไหม้ ' + t.tburn + ' วิ (มอเตอร์ถ่านดิน)—แนวทางจาก CAAT และสถิติบั๊งบึงไฟยโสธร';
  var doc = document.getElementById('sim-result');
  doc.innerHTML =
    '<div class="card-row"><span class="card-label">ความสูงสูงสุด (จำลอง)</span><span>≈ ' + peak + ' ม.</span></div>' +
    '<div class="card-row"><span class="card-label">ระยะตก/ล่องลอย (ลม 5 ม./วิ)</span><span>≈ ' + fallout + ' กม.</span></div>' +
    '<div class="card-row"><span class="card-label">โหมดจำลอง</span><span>' + simInfo + '</span></div>' +
    '<div class="card-row"><span class="card-label">แนวร่อน 3° ที่ 3 กม.</span><span>เครื่องบิน ≈ 157 ม. / ที่ 8 กม. ≈ 419 ม.</span></div>' +
    '<div class="card-row"><span class="card-label">เกณฑ์เสี่ยง</span><span>Critical: วิถีทะลุแนวร่อนใน PHZ / High: ใน PHZ 3-8 กม. / Moderate: ใน LHZ / Low: นอกเขต</span></div>';
  // re-evaluate pin if present
  if (pinMarker) {
    var ll = pinMarker.getLatLng();
    runClearanceCheck([ll.lat, ll.lng]);
  }
}

function wireSimulation() {
  var sel = document.getElementById('sim-type');
  Object.keys(BUNFAI_TYPES).forEach(function (k) {
    sel.appendChild(new Option(BUNFAI_TYPES[k].label, k));
  });
  sel.value = 'saen';
  document.getElementById('sim-run').addEventListener('click', runSimulation);
}

// ---------------------------------------------------------------------------
// Petition generator: villagers request permission + notify agencies in one click
// ---------------------------------------------------------------------------

function populatePetitionSelect() {
  var sel = document.getElementById('pet-type');
  var keys = Object.keys(BUNFAI_TYPES);
  keys.forEach(function (k) {
    sel.appendChild(new Option(BUNFAI_TYPES[k].label, k));
  });
}

function renderPetition() {
  var today = new Date();
  var thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var dateStr = today.getDate() + ' ' + thaiMonths[today.getMonth()] + ' ' + (today.getFullYear() + 543);
  var name = document.getElementById('pet-name').value || '[ชื่อ-นามสกุล]';
  var addr = document.getElementById('pet-address').value || '[ที่อยู่บ้าน/หมู่บ้าน-ตำบล-อำเภอ]';
  var eventName = document.getElementById('pet-event').value || '[ชื่อกิจกรรม]';
  var eventDate = document.getElementById('pet-date').value || '[วันที่งาน]';
  var typeKey = document.getElementById('pet-type').value;
  var t = BUNFAI_TYPES[typeKey];
  var useDistrict = document.getElementById('pet-ag-district').checked;
  var useAirport = document.getElementById('pet-ag-airport').checked;
  var usePolice = document.getElementById('pet-ag-police').checked;

  // Auto-fill pin context if a pin was dropped
  var lat = lastPin ? lastPin[0] : null;
  var lon = lastPin ? lastPin[1] : null;
  var hits = lat ? checkClearance([lat, lon]) : [];
  var provKey = lat ? findProvince([lat, lon]) : null;
  var rec = provKey ? PROV_REF.find(function (r) { return r.en === provKey; }) : null;
  var d = provKey ? (PROV_DATA[provKey] || null) : null;
  var simCtx = hits.length ? simContextFor(hits[0], [lat, lon]) : null;
  var peak = Math.round(simulatePeak(typeKey));
  var fallout = falloutKm(typeKey).toFixed(1);

  var amphoeSel = document.getElementById('pet-amphoe');
  var amphoeTh = amphoeSel && amphoeSel.value ? document.querySelector('#pet-amphoe option:checked').text : '';
  // Look up the real district office contact (yellowpages.co.th via amphoe_contacts.js)
  var catm = null;
  if (amphoeSel && amphoeSel.value && provKey) {
    catm = getAmphoeCatm(provKey, amphoeSel.value);
  }
  var officeC = catm ? getAmphoeContact(catm) : null;
  var parts = [];
  var atcC = hits.length && typeof CONTACTS !== 'undefined' && CONTACTS.atc && CONTACTS.atc[hits[0].icao] ? CONTACTS.atc[hits[0].icao] : null;
  if (useDistrict && d) {
    var officeLine = '🏛️ ที่ทำการอำเภอ' + (amphoeTh ? ' ' + amphoeTh : '') + '/องค์กรปกครองส่วนท้องถิ่น — ' + (d.authority || 'ตามประกาศจังหวัด');
    if (officeC && officeC.has_phone) officeLine += ' โทร ' + officeC.phone + (officeC.has_address ? ' (' + officeC.address + ')' : '');
    parts.push(officeLine);
  }
  if (useAirport) parts.push('✈️ ผู้จัดการ/หอบังคับการบิน (ATC)' + (hits.length ? ' ' + hits[0].icao + ' ' + hits[0].nameTh : '') + (atcC ? ' โทร ' + atcC.tel : ''));
  if (usePolice) parts.push('👮 สภ.ตำบล/อำเภอที่เกี่ยวข้อง (รับทราบ) — สายด่วนตำรวจ 191');

  var html =
    '<div style="font-family: \'Sarabun\', \'Tahoma\', sans-serif; padding: 18px; background:#fff; color:#111; max-width: 640px; margin: 0 auto;">' +
    '<h3 style="text-align:center; margin:0 0 16px 0">คำร้องขออนุญาตจด/ปล่อยบั้งไฟ โคมลอย พลุ</h3>' +
    '<div style="text-align:right; font-size:13px; margin-bottom: 14px">ลงวันที่ ' + dateStr + '</div>' +
    '<p style="font-size:13.5px; line-height:1.65; text-align:justify">เรียน ' + (useDistrict && d ? 'นายอำเภอ' + (amphoeTh ? ' ' + amphoeTh : '') + (rec ? ' จังหวัด' + rec.th : '') + '/นายกองค์กรปกครองส่วนท้องถิ่น ' + (amphoeTh ? '' + amphoeTh : (rec ? rec.th : '')) : 'เจ้าหน้าที่ที่เกี่ยวข้อง') + ' (เรียนท่าน) และ/หรือ ผู้จัดการ/หอบังคับการบินท่าอากาศยาน' + (hits.length ? ' ' + hits[0].icao + ' ' + hits[0].nameTh : '') + '</p>' +
    (officeC && officeC.has_phone && useDistrict ? '<p style="font-size:12px; line-height:1.5; margin:3px 0 10px 0; padding:6px 8px; background:#f0f4ff; border:1px solid #c9d6ff; border-radius:4px"><b>📞 ที่อยู่ที่ทำการอำเภอ (สำหรับจัดส่งคำร้อง)</b><br>ที่ทำการอำเภอ' + amphoeTh + ' — โทร ' + officeC.phone + (officeC.fax ? ' / โทรสาร ' + officeC.fax : '') + '<br>' + (officeC.has_address ? officeC.address : '') + '</p>' : '') +
    '<p style="font-size:13.5px; line-height:1.65; text-align:justify">ข้าพเจ้า ' + name + ' อาชีพ/ที่อยู่ ' + addr + ' ขอเรียนมาเพื่อยื่นคำร้องขออนุญาตจด/ปล่อยวัตถุขึ้นอากาศประเภท ' + t.label + ' ในการจัดกิจกรรม ' + eventName + ' ณ วันที่ ' + eventDate + '</p>';
  if (lat !== null) {
    html += '<p style="font-size:13.5px; line-height:1.65; text-align:justify">พิกัดตำแหน่งที่ขอ: ละติจูด ' + lat.toFixed(5) + ' ลองติจูด ' + lon.toFixed(5) +
      (rec ? ' (ท้องที่' + (amphoeTh ? ' อำเภอ' + amphoeTh : '') + ' จังหวัด' + rec.th + ' ' + rec.region + ')' : '') +
      (hits.length ? ' — ตรวจสอบพบว่าอยู่ใน ' + hits[0].zoneLabel + ' ห่างจาก ' + hits[0].icao + ' ' + hits[0].distKm.toFixed(1) + ' กม.' : ' — ตรวจสอบระบบไม่พบว่าอยู่ในเขตปลอดัยทางการเดินอากาศ LHZ 10 กม./PHZ ของสนามบินใด') + '</p>';
  }
  html +=
    '<p style="font-size:13.5px; line-height:1.65; text-align:justify">การจำลองวิถีระบบ: ความสูงสูงสุด ≈ ' + peak + ' ม. ระยะตก/ล่องลอย ≈ ' + fallout + ' กม. (ลม 5 ม./วิ)' +
    (simCtx ? ' — ณ ตำแหน่งนี้ แนวร่อน 3° ของเครื่องบิน ที่ระยะ ' + simCtx.distKm.toFixed(1) + ' กม. ระดับเครื่องบิน ≈ ' + simCtx.gsAltM + ' ม.' : '') + '</p>' +
    '<p style="font-size:13.5px; line-height:1.65; text-align:justify">ข้าพเจ้ารับปากจะปฏิบัติตามเงื่อนไขของประกาศประจำจังหวัด' + (rec ? ' ' + rec.th : '') + ' และพระราชบัญญัติการเดินอากาศ พ.ศ. 2497 มาตรา 59 อย่างเคร่งครัด และรับผิดชอบความเสียหายที่อาจเกิดขึ้นตามประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 420</p>' +
    '<p style="font-size:13.5px; line-height:1.65; text-align:justify">จึงใคร่ขอความกรุณาพิจารณาอนุญาต/รับทราบคำร้องนี้ เพื่อให้การจัดกิจกรรมเป็นไปโดยถูกต้องและปลอดภัย จึงเรียนมาเพื่อโปรดพิจารณา</p>' +
    '<p style="font-size:13.5px; line-height:1.65; text-align:justify">ขอแสดงความเคารพ</p>' +
    '<p style="font-size:13.5px; line-height:1.65; text-align:right">(ลงชื่อ) ' + name + '</p>' +
    '<div class="section-title" style="color:#333">หน่วยงานที่ได้รับแจ้งตามคำร้องนี้</div>' +
    parts.map(function (p) { return '<div style="font-size:12.5px; line-height:1.55; margin:3px 0; color:#222">• ' + p + '</div>'; }).join('') +
    (typeof CONTACTS !== 'undefined' && (atcC || true) ? ('<div class="section-title" style="color:#333; margin-top:10px">สำเนา: ช่องทางติดต่อหน่วยงาน (ข้อมูลสาธารณะ — โปรดตรวจสอบก่อนส่ง)</div>' +
      (atcC ? '<div style="font-size:12px; line-height:1.5; margin:3px 0; padding:6px 8px; background:#f0f4ff; border:1px solid #c9d6ff; border-radius:4px"><b>✈️ ' + atcC.unit + '</b><br>โทร: ' + atcC.tel + (atcC.fax ? ' / โทรสาร: ' + atcC.fax : '') + (atcC.email ? '<br>อีเมล: ' + atcC.email : '') + '<br>ที่อยู่: ' + atcC.address + '</div>' : '<div style="font-size:11.5px; color:#666; margin:3px 0">ไม่พบข้อมูลติดต่อหอบังคับการบินของสนามบินใกล้เคียง — สอบถามสายด่วน 191</div>') +
      (officeC && officeC.has_phone ? '<div style="font-size:12px; line-height:1.5; margin:3px 0; padding:6px 8px; background:#fff3f0; border:1px solid #ffcfc2; border-radius:4px"><b>🏛️ ที่ทำการอำเภอ' + (amphoeTh ? ' ' + amphoeTh : '') + ' (จากสารบบ yellowpages.co.th — ตรวจสอบก่อนใช้)</b><br>โทร: ' + officeC.phone + (officeC.fax ? ' / โทรสาร: ' + officeC.fax : '') + (officeC.has_address ? '<br>ที่อยู่: ' + officeC.address : '') + (officeC.url ? '<br><a href="' + officeC.url + '" target="_blank" style="font-size:11px">แหล่งข้อมูล</a>' : '') + '</div>' : '') +
      (typeof CONTACTS !== 'undefined' && CONTACTS.aerothai ? '<div style="font-size:12px; line-height:1.5; margin:3px 0; padding:6px 8px; background:#f0fff4; border:1px solid #b7e4c7; border-radius:4px"><b>🛰️ สำเนาถึง: บริษัท วิทยุการบินแห่งประเทศไทย จำกัด (AeroThai)</b><br>โทร: ' + CONTACTS.aerothai.tel + ' / โทรสาร: ' + CONTACTS.aerothai.fax + '<br>ที่อยู่: ' + CONTACTS.aerothai.address + '<br>เว็บไซต์: ' + CONTACTS.aerothai.web + '</div>' : '') +
      '<div style="font-size:12px; line-height:1.5; margin:3px 0; padding:6px 8px; background:#fff7e6; border:1px solid #ffe0a3; border-radius:4px"><b>📞 สายด่วน (กรณีฉุกเฉิน/เหตุไม่ปลอดภัย)</b><br>' +
      '• สภ.ท้องที่ที่เกี่ยวข้อง — อำเภอ' + (amphoeTh ? ' ' + amphoeTh : '') + ': ติดต่อผ่านสายด่วน <b>191</b> หรือที่ทำการอำเภอ<br>' +
      (typeof CONTACTS !== 'undefined' && CONTACTS.hotlines ? '• ' + CONTACTS.hotlines.amphoe + '<br>• ' + CONTACTS.hotlines.police + '<br>• ' + CONTACTS.hotlines.policeStation : '• ตำรวจ 191<br>• กรมป้องกันและบรรเทาสาธารณภัย 1784<br>• ศูนย์ดำรงธรรม 1567') +
      '</div>') : '') +
    '<div style="font-size:11px; color:#666; margin-top:12px; border-top:1px solid #ccc; padding-top:6px">เอกสารนี้เป็นร่างอัตโนมัติจากระบบ — ต้องตรวจสอบความถูกต้องกับหน่วยงานปลายทางก่อนใช้เป็นทางการ</div>' +
    '</div>';
  return html;
}

function plainTextPetition() {
  // Plain-text version for clipboard copy (strips innerHTML, reuses data)
  var el = document.createElement('div');
  el.innerHTML = renderPetition();
  return el.innerText.replace(/\n{3,}/g, '\n\n');
}

var lastPin = null;

function openPetitionModal(pt) {
  if (pt) lastPin = pt;
  populatePetitionSelect();
  var pk = pt ? findProvince(pt) : selectedProvinceKey;
  if (pk && document.getElementById('pet-amphoe')) populatePetitionAmphoe(pk);
  var modal = document.getElementById('petition-modal');
  modal.style.display = 'flex';
  var st = document.getElementById('pet-status');
  if (lastPin) {
    var hits = checkClearance(lastPin);
    var provKey = findProvince(lastPin);
    var rec = provKey ? PROV_REF.find(function (r) { return r.en === provKey; }) : null;
    st.textContent = 'พิกัดจากหมุด: ' + lastPin[0].toFixed(5) + ', ' + lastPin[1].toFixed(5) +
      (rec ? ' (' + rec.th + ')' : '') + (hits.length ? ' ⛔ ' + hits[0].zoneLabel + ' ' + hits[0].icao : ' ✅ นอกเขตปลอดัยฯ') +
      ' — กรอกข้อมูลกิจกรรมแล้วกด "📝 สร้างคำร้อง"';
  } else {
    st.textContent = 'ยังไม่มีหมุดพิกัด — ควรดักหมุดตรวจสอบก่อน กรอกข้อมูลกิจกรรมได้เลย';
  }
  document.getElementById('pet-generate').onclick = function () {
    document.getElementById('petition-body').innerHTML = renderPetition();
    var saved = savePermitFromPetition();
    st.textContent = saved
      ? 'สร้างคำร้องแล้ว — บันทึกเข้ารายการ "คำขอที่ส่งแล้ว" แล้ว (สถานะรอยืน) — กด "🖨 พิมพ์/บันทึก PDF" หรือ "📋 คัดลอกข้อความ" เพื่อส่งหน่วยงาน'
      : 'สร้างคำร้องแล้ว — กด "🖨 พิมพ์/บันทึก PDF" หรือ "📋 คัดลอกข้อความ" เพื่อส่งหน่วยงาน';
  };
  document.getElementById('pet-print').onclick = function () {
    var w = window.open('', '_blank');
    w.document.write('<html><head><title>คำร้องขออนุญาตจด/ปล่อยบั้งไฟ</title>' +
      document.querySelector('link[href*="leaflet"]').outerHTML + '</head><body>' +
      document.getElementById('petition-body').innerHTML + '</body></html>');
    w.document.close(); w.focus(); w.print();
  };
  document.getElementById('pet-copy').onclick = function () {
    navigator.clipboard.writeText(plainTextPetition()).then(function () {
      st.textContent = 'คัดลอกข้อความแล้ว — วางในหนังสือ/อีเมล/แชทหน่วยงานได้ทันที';
    });
  };
  document.getElementById('pet-close').onclick = function () { modal.style.display = 'none'; };
}

function wirePetitionButtons() {
  document.getElementById('petition-open').addEventListener('click', function () {
    openPetitionModal(lastPin || null);
  });
}

// ---------------------------------------------------------------------------
// Administrative response letter generator
// ---------------------------------------------------------------------------

function legalBasis(d, inZone) {
  var lines = [];
  lines.push('1. พระราชบัญญัติการเดินอากาศ พ.ศ. 2497 มาตรา 59 กำหนดให้บุคคลใดจะตั้ง วางหรือปล่อยวัตถุอันอาจเป็นอันตรายต่อการเดินอากาศมิได้ เว้นแต่ได้รับอนุญาตจากผู้จัดการหรือผู้ประกอบท่าอากาศยานหรือผู้ที่ได้รับมอบหมาย');
  lines.push('2. มาตรา 113 กำหนดโทษผู้ฝ่าฝืนมาตรานี้ ต้องระวางโทษจำคุกไม่เกินหนึ่งปี หรือปรับไม่เกินสี่หมื่นบาท หรือทั้งจำทั้งปรับ');
  if (d && d.applyDaysAdvance) {
    lines.push('3. ประกาศจังหวัดกำหนดให้ยื่นคำขออนุญาตล่วงหน้าอย่างน้อย ' + d.applyDaysAdvance + ' วัน');
  } else {
    lines.push('3. ประกาศจังหวัดกำหนดให้ยื่นคำขออนุญาตล่วงหน้าตามขั้นตอนที่ระบุไว้ในประกาศฉบับนั้น ๆ');
  }
  if (inZone) {
    lines.push('4. ตำแหน่งที่ขออยู่ในเขตปลอดัยทางการเดินอากาศของท่าอากาศยาน — การอนุญาตต้องได้รับความเห็นชอบจากผู้จัดการท่าอากาศยานก่อน');
  }
  lines.push('5. ตามประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 420 หากการจด/ปล่อยวัตถุเป็นเหตุให้เกิดความเสียหายแก่บุคคลหรือทรัพย์สิน ผู้กระทำต้องรับผิดชดใช้ค่าสินไหมทดแทน (ความรับผิดทางละเมิด)');
  return lines;
}

function renderLetter(cfg) {
  var today = new Date();
  var thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var dateStr = today.getDate() + ' ' + thaiMonths[today.getMonth()] + ' ' + (today.getFullYear() + 543);
  var applicant = document.getElementById('letter-applicant').value || '[ชื่อผู้ยื่นคำขอ/ผู้รับแจ้ง]';
  var eventName = document.getElementById('letter-event').value || '[ชื่อกิจกรรม]';
  var eventDate = document.getElementById('letter-date').value || '[วันที่งาน]';
  var decision = document.getElementById('letter-decision').value; // allow | deny
  var d = cfg.d, rec = cfg.rec, inZone = (cfg.hits.length > 0);
  var bodyLines = [];
  if (decision === 'allow') {
    bodyLines.push('เรื่อง ให้อนุญาตการจด/ปล่อยบั้งไฟ พลุ ตะไล โคมลอย ตามคำขอยื่นลงวันที่ ' + eventDate);
    bodyLines.push('องค์กรปกครองส่วนท้องถิ่นได้พิจารณาคำขอของ ' + applicant + ' เรื่อง ' + eventName + ' ณ ตำแหน่งที่ระบุแล้ว');
    bodyLines.push('การพิจารณาอาศัยฐานอำนาจตามประกาศจังหวัด' + (rec ? ' ' + rec.th : '') + (d && d.title ? ' เรื่อง ' + d.title : '') +
      ' ประกอบพระราชบัญญัติการเดินอากาศ พ.ศ. 2497');
    if (inZone) bodyLines.push('เงื่อนไขสำคัญ: ต้องได้รับความเห็นชอบจากผู้จัดการท่าอากาศยานก่อน เนื่องจากตำแหน่งอยู่ในเขตปลอดัยทางการเดินอากาศ');
    if (d && d.applyDaysAdvance) bodyLines.push('เงื่อนไข: ยื่นขอล่วงหน้า ≥ ' + d.applyDaysAdvance + ' วัน และแจ้งหอบังคับการบินตามที่ประกาศกำหนด');
    bodyLines.push('ผู้อนุญาตมีหน้าที่ควบคุมให้การจด/ปล่อยเป็นไปตามมาตรการปลอดภัยที่กำหนด หากเกิดความเสียหายต่อบุคคลหรือทรัพย์สิน ผู้ขออนุญาตต้องรับผิดตามประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 420');
    bodyLines.push('ด้วยความเคารพ');
  } else {
    bodyLines.push('เรื่อง ไม่ให้อนุญาตการจด/ปล่อยบั้งไฟ พลุ ตะไล โคมลอย');
    bodyLines.push('องค์กรปกครองส่วนท้องถิ่นได้พิจารณาคำขอของ ' + applicant + ' เรื่อง ' + eventName + ' ณ ตำแหน่งที่ระบุแล้ว');
    bodyLines.push('เนื่องจากตำแหน่งที่ขออยู่ในเขตปลอดัยทางการเดินอากาศของท่าอากาศยาน ซึ่งกฎหมายห้ามจด/ปล่อยวัตถุขึ้นอากาศ เว้นแต่ได้รับอนุญาต เว้นแต่ได้รับความเห็นชอบจากผู้จัดการท่าอากาศยานก่อน');
    bodyLines.push('การปฏิเสธนี้เป็นไปตามประกาศจังหวัด' + (rec ? ' ' + rec.th : '') + ' และพระราชบัญญัติการเดินอากาศ พ.ศ. 2497 มาตรา 59');
    bodyLines.push('ผู้ยื่นคำขอมีสิทธิอุทธรณ์คั่งสั่งตามพระราชบัญญัติวิธีปฏิบัติราชการทางปกครอง พ.ศ. 2539 มาตรา 44 ภายใน 15 วันนับแต่วันได้รับการแจ้งคั่งสั่งนี้');
    bodyLines.push('ด้วยความเคารพ');
  }
  var legal = legalBasis(d, inZone);
  var html =
    '<div style="font-family: \'Sarabun\', \'Tahoma\', sans-serif; padding: 18px; background:#fff; color:#111; max-width: 640px; margin: 0 auto;">' +
    '<h3 style="text-align:center; margin:0 0 16px 0">' + (decision === 'allow' ? 'หนังสืออนุญาต' : 'หนังสือไม่ให้อนุญาต') + '</h3>' +
    '<div style="text-align:right; font-size:13px; margin-bottom: 14px">ลงวันที่ ' + dateStr + '</div>' +
    bodyLines.map(function (l) { return '<p style="font-size:13.5px; line-height:1.65; margin:4px 0; text-align:justify">' + l + '</p>'; }).join('') +
    '<div class="section-title" style="color:#333">ฐานอำนาจและข้อกฎหมายอ้างอิง</div>' +
    legal.map(function (l) { return '<div style="font-size:12.5px; line-height:1.55; margin:3px 0; color:#222">' + l + '</div>'; }).join('') +
    '<div style="font-size:11px; color:#666; margin-top:12px; border-top:1px solid #ccc; padding-top:6px">เอกสารนี้เป็นร่างอัตโนมัติจากระบบ — ต้องตรวจสอบกับผู้มีอำนาจและที่ปรึกษากฎหมายก่อนใช้เป็นทางการ</div>' +
    '</div>';
  return html;
}

function openLetterModal(cfg) {
  var modal = document.getElementById('letter-modal');
  modal.style.display = 'flex';
  var sel = document.getElementById('letter-decision');
  sel.innerHTML = '';
  if (cfg.hits.length > 0) {
    sel.appendChild(new Option('ปฏิเสธ (ไม่ให้อนุญาต) — ติดเขตปลอดัยฯ', 'deny'));
    sel.appendChild(new Option('อนุญาตแบบมีเงื่อนไข (ได้ความเห็นชอบท่าอากาศยาน)', 'allow'));
    sel.value = 'deny';
  } else {
    sel.appendChild(new Option('อนุญาตตามเงื่อนไขประกาศจังหวัด', 'allow'));
    sel.appendChild(new Option('ปฏิเสธ', 'deny'));
    sel.value = 'allow';
  }
  sel.onchange = function () { updateLetter(cfg); };
  document.getElementById('letter-regenerate').onclick = function () { updateLetter(cfg); };
  document.getElementById('letter-print').onclick = function () {
    var w = window.open('', '_blank');
    w.document.write('<html><head><title>ร่างหนังสือ</title>' +
      document.querySelector('link[href*="leaflet"]').outerHTML + '</head><body>' +
      document.getElementById('letter-body').innerHTML + '</body></html>');
    w.document.close(); w.focus(); w.print();
  };
  document.getElementById('letter-close').onclick = function () { modal.style.display = 'none'; };
  updateLetter(cfg);
}

function updateLetter(cfg) {
  document.getElementById('letter-body').innerHTML = renderLetter(cfg);
}

function wireLetterButtons() {
  document.getElementById('letter-open').addEventListener('click', function () {
    // generic letter without pin context — prompt for province manually
    var provKey = selectedProvinceKey;
    var rec = provKey ? PROV_REF.find(function (r) { return r.en === provKey; }) : null;
    var d = provKey ? (PROV_DATA[provKey] || null) : null;
    openLetterModal({ lat: null, lon: null, provKey: provKey, rec: rec, d: d, hits: [] });
  });
}

// ---------------------------------------------------------------------------
// Occurrence log + risk heatmap
// ---------------------------------------------------------------------------

function openOccurrenceForm(pt, provKey, rec, hits) {
  var panel = document.getElementById('occurrence-panel');
  var oc = document.getElementById('occurrence-form');
  panel.style.display = 'block';
  if (pt) {
    document.getElementById('occ-lat').value = pt[0].toFixed(5);
    document.getElementById('occ-lon').value = pt[1].toFixed(5);
  }
  oc.dataset.ctx = JSON.stringify({ provKey: provKey, rec: rec, hits: hits });
}

function saveOccurrenceWithTiming() {
  var oc = document.getElementById('occurrence-form');
  var lat = parseFloat(document.getElementById('occ-lat').value);
  var lon = parseFloat(document.getElementById('occ-lon').value);
  if (isNaN(lat) || isNaN(lon)) { alert('กรอกพิกัดให้ถูกต้อง'); return; }
  var kind = document.getElementById('occ-kind').value;
  var note = document.getElementById('occ-note').value;
  var ctx = oc.dataset.ctx ? JSON.parse(oc.dataset.ctx) : {};
  occurrences.push({
    lat: lat, lon: lon, kind: kind,
    date: document.getElementById('occ-date').value || new Date().toISOString().slice(0, 10),
    note: note,
    startAt: document.getElementById('occ-start').value || null,
    endAt: document.getElementById('occ-end').value || null,
    airportNear: (ctx.hits && ctx.hits.length) ? ctx.hits[0].icao + ' (' + ctx.hits[0].zoneType + ' ~' + ctx.hits[0].distKm.toFixed(1) + ' กม.)' : '',
    provTh: ctx.rec ? ctx.rec.th : '',
    ts: Date.now()
  });
  saveOccurrences();
  oc.style.display = 'none';
  document.getElementById('occurrence-panel').style.display = 'none';
  updateHeatmap();
  updateOccurrenceStats();
}

function updateHeatmap() {
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  if (!document.getElementById('toggle-heat').checked || occurrences.length === 0) return;
  var pts = occurrences.map(function (o) { return [o.lat, o.lon, o.kind === 'unauthorized' ? 3 : 1]; });
  var maxVal = Math.max(2, Math.floor(occurrences.length * 0.4));
  heatLayer = L.heatLayer(pts, { radius: 20, blur: 24, maxZoom: 13, max: maxVal }).addTo(map);
}

function updateOccurrenceStats() {
  var el = document.getElementById('occurrence-stats');
  if (occurrences.length === 0) {
    el.innerHTML = '<div class="stat-empty">ยังไม่มีเหตุการณ์บันทึก — ใช้ปุ่ม "📝 บันทึกเป็นเหตุการณ์" บนแผงตรวจสอบ</div>';
    return;
  }
  var byKind = {}, nearAirports = {};
  occurrences.forEach(function (o) {
    byKind[o.kind] = (byKind[o.kind] || 0) + 1;
    if (o.airportNear) nearAirports[o.airportNear.split(' (')[0]] = (nearAirports[o.airportNear.split(' (')[0]] || 0) + 1;
  });
  var html = '<div class="stat-row"><span class="stat-label">รวมเหตุการณ์</span><span class="stat-value">' + occurrences.length + '</span></div>';
  Object.keys(byKind).forEach(function (k) {
    html += '<div class="stat-row"><span class="stat-label">' + (k === 'request' ? 'คำขออนุญาต' : 'ปล่อยไม่ได้รับอนุญาต') + '</span><span class="stat-value">' + byKind[k] + '</span></div>';
  });
  Object.keys(nearAirports).forEach(function (icao) {
    html += '<div class="stat-row"><span class="stat-label">ใกล้ ' + icao + '</span><span class="stat-value">' + nearAirports[icao] + '</span></div>';
  });
  html += '<div class="stat-row"><span class="stat-label"><button class="tool-btn" id="occ-clear">ลบทั้งหมด</button></span><span></span></div>';
  el.innerHTML = html;
  var cl = document.getElementById('occ-clear');
  if (cl) cl.addEventListener('click', function () {
    if (confirm('ลบข้อมูลเหตุการณ์ทั้งหมด?')) {
      occurrences = []; saveOccurrences();
      updateHeatmap(); updateOccurrenceStats();
    }
  });
}

function wireOccurrenceForm() {
  document.getElementById('occ-save').addEventListener('click', function () {
    saveOccurrenceWithTiming();
  });
  document.getElementById('occ-start-now').addEventListener('click', function () {
    var iso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('occ-start').value = iso;
  });
  document.getElementById('occ-end-now').addEventListener('click', function () {
    var iso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('occ-end').value = iso;
  });
  document.getElementById('occ-cancel').addEventListener('click', function () {
    document.getElementById('occurrence-form').style.display = 'none';
    document.getElementById('occurrence-panel').style.display = 'none';
  });
  document.getElementById('toggle-heat').addEventListener('change', updateHeatmap);
}

// ---------------------------------------------------------------------------
// Amphoe (district) system — data from DOPA กรมการปกครอง (AMPHOES in amphoes.js)
// ---------------------------------------------------------------------------

function populateAmphoeSelect(key) {
  var sel = document.getElementById('amphoe-select');
  var list = (window.AMPHOES && AMPHOES[key]) || [];
  sel.innerHTML = '';
  if (list.length === 0) { sel.style.display = 'none'; return; }
  sel.style.display = 'block';
  sel.appendChild(new Option('เลือกอำเภอ/เขต...', ''));
  list.forEach(function (a) { sel.appendChild(new Option(a.th + ' (' + a.en + ')', a.en)); });
  var pet = document.getElementById('pet-amphoe');
  if (pet) { populatePetitionAmphoe(key); }
}

function populatePetitionAmphoe(key) {
  var pet = document.getElementById('pet-amphoe');
  var list = (window.AMPHOES && AMPHOES[key]) || [];
  pet.innerHTML = '';
  if (list.length === 0) { pet.style.display = 'none'; return; }
  pet.style.display = 'block';
  pet.appendChild(new Option('เลือกอำเภอ/เขตที่จด/ปล่อย...', ''));
  list.forEach(function (a) { pet.appendChild(new Option(a.th, a.en)); });
}

function getAmphoeInfo(provKey, amphoeEn) {
  var list = (window.AMPHOES && AMPHOES[provKey]) || [];
  var a = list.find(function (x) { return x.en === amphoeEn; });
  return a || null;
}

function getAmphoeCatm(provKey, amphoeEn) {
  var a = getAmphoeInfo(provKey, amphoeEn);
  return (a && a.catm) ? String(a.catm) : null;
}

function getAmphoeContact(catm) {
  if (!catm || !(window.AMPHOE_CONTACTS && AMPHOE_CONTACTS[catm])) return null;
  return AMPHOE_CONTACTS[catm];
}

function showAmphoeCard(provKey, amphoeEn) {
  var card = document.getElementById('amphoe-card');
  var rec = PROV_REF.find(function (r) { return r.en === provKey; });
  var d = provKey ? (PROV_DATA[provKey] || null) : null;
  var a = getAmphoeInfo(provKey, amphoeEn);
  if (!rec || !a) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  var list = AMPHOES[provKey];
  var html = '<div class="card-province" style="font-size:14px">🏛️ ' + a.th + '<span class="card-region"> — ' + rec.th + ' ' + rec.region + '</span></div>';
  html += '<div class="card-row"><span class="card-label">ท้องที่</span><span>อำเภอ/เขต ' + a.th + ' จังหวัด' + rec.th + ' ' + rec.region + '</span></div>';
  if (d) {
    if (d.authority) html += '<div class="card-row"><span class="card-label">ผู้อนุญาต</span><span>' + d.authority + '</span></div>';
    if (d.permit) html += '<div class="card-row"><span class="card-label">เงื่อนไข</span><span>' + d.permit + '</span></div>';
    if (d.applyDaysAdvance) html += '<div class="card-row"><span class="card-label">ยื่นขอล่วงหน้า</span><span>≥ ' + d.applyDaysAdvance + ' วัน</span></div>';
  }
  html += '<div class="card-row"><span class="card-label">จำนวนอำเภอ</span><span>' + list.length + ' อำเภอ/เขต (ใน' + rec.th + ')</span></div>';
  html += '<div class="card-row"><span class="card-label">ฐานอำนาจ</span><span>พ.ร.บ.การเดินอากาศ พ.ศ. 2497 ม.59 + ประกาศจังหวัด' + rec.th + '</span></div>';
  if (d && d.docPath) html += '<div class="card-row"><span class="card-label">เอกสาร</span><span><a href="' + d.docPath + '" target="_blank" class="card-link">📄 เปิดเอกสารประกาศ PDF</a></span></div>';
  var c = getAmphoeContact(getAmphoeCatm(provKey, amphoeEn));
  if (c) {
    if (c.has_phone) {
      html += '<div class="card-row"><span class="card-label">📞 ที่ทำการอำเภอ</span><span>โทร ' + c.phone + (c.fax ? ' / โทรสาร ' + c.fax : '') + ' — <a href="' + c.url + '" target="_blank" class="card-link">แหล่งข้อมูล</a></span></div>';
    }
    if (c.has_address) html += '<div class="card-row"><span class="card-label">ที่อยู่</span><span>' + c.address + '</span></div>';
    if (!c.has_phone) html += '<div class="card-row"><span class="card-label">📞 ที่ทำการอำเภอ</span><span>ไม่พบเบอร์ในสารบบ — ใช้ศูนย์ดำรงธรรม <b>1567</b></span></div>';
  } else {
    html += '<div class="card-row"><span class="card-label">📞 ที่ทำการอำเภอ</span><span>ไม่พบข้อมูล — ใช้ศูนย์ดำรงธรรม <b>1567</b></span></div>';
  }
  html += '<div class="card-note">การจด/ปล่อยบั๊งบึงไฟ โคมลอย พลุ ในท้องที่อำเภอ/เขตนี้ ให้เป็นไปตามเงื่อนไขของประกาศจังหวัดข้างต้น — ใช้เป็นข้อมูลประกอบการยื่นคำขอกับอำเภอ/อปท.</div>';
  html += '<div class="card-row" style="border:none"><button class="tool-btn" id="petition-from-amphoe">📮 ยื่นคำร้องแจ้งหน่วยงาน (จากอำเภอ/เขตนี้)</button></div>';
  card.innerHTML = html;
  setTimeout(function () {
    var btn = document.getElementById('petition-from-amphoe');
    if (btn) btn.addEventListener('click', function () { openPetitionModal(lastPin || null); });
  }, 0);
}

function wireAmphoe() {
  var sel = document.getElementById('amphoe-select');
  sel.addEventListener('change', function () {
    var key = sel.value;
    if (!key) { document.getElementById('amphoe-card').style.display = 'none'; return; }
    showAmphoeCard(selectedProvinceKey, key);
  });
}

// ---------------------------------------------------------------------------
// Permit requests store + status + permit PDF issuance (Bampen-style)
// ---------------------------------------------------------------------------

var permits = [];

function loadPermits() {
  try {
    var raw = localStorage.getItem('bunkfai_permits');
    permits = raw ? JSON.parse(raw) : [];
  } catch (e) { permits = []; }
}

function savePermits() {
  localStorage.setItem('bunkfai_permits', JSON.stringify(permits));
}

function nextPermitNo() {
  var d = new Date();
  var seq = permits.filter(function (p) { return p.no && p.no.indexOf('BF-' + (d.getFullYear() + 543)) === 0; }).length + 1;
  return 'BF-' + (d.getFullYear() + 543) + '-' + ('000' + seq).slice(-4);
}

function changePermitStatus(id, status) {
  var p = permits.find(function (x) { return x.id === id; });
  if (!p) return;
  p.status = status;
  p.updatedAt = Date.now();
  savePermits();
  renderPermitsList();
  updateOccurrenceStats();
  if (status === 'approved' || status === 'rejected') { document.getElementById('dashboard-body') && renderDashboard(); }
}

function renderPermitCard(p) {
  var prov = PROV_REF.find(function (r) { return r.en === p.provKey; });
  var type = BUNFAI_TYPES[p.typeKey] || { label: '' };
  var stCls = p.status === 'approved' ? 'st-approved' : (p.status === 'rejected' ? 'st-rejected' : 'st-pending');
  var stTxt = p.status === 'approved' ? 'ออนุญาตแล้ว' : (p.status === 'rejected' ? 'ไม่ผ่านการอนุญาต' : 'รอยื่น/รอยินยอม');
  var html = '<div class="permit-card">' +
    '<div class="pc-head"><span><b>' + (prov ? prov.th : '') + '</b> — ' + type.label + (p.amphoeTh ? ' / อำเภอ' + p.amphoeTh : '') + '</span>' +
    '<span class="pc-type">' + p.no + '</span></div>' +
    '<div style="margin:3px 0;color:#555">ผู้ยื่น: ' + (p.name || '—') + (p.event ? ' · กิจกรรม ' + p.event : '') + (p.eventDate ? ' · ' + p.eventDate : '') + '</div>' +
    '<div style="margin:3px 0"><span class="' + stCls + '">' + stTxt + '</span> · สถานะ: <select class="status-select" data-id="' + p.id + '">' +
    '<option value="pending"' + (p.status === 'pending' ? ' selected' : '') + '>รอยื่น/รอยินยอม</option>' +
    '<option value="approved"' + (p.status === 'approved' ? ' selected' : '') + '>ออนุญาตแล้ว</option>' +
    '<option value="rejected"' + (p.status === 'rejected' ? ' selected' : '') + '>ไม่ผ่านการอนุญาต</option></select>' +
    (p.status === 'approved' ? ' <button class="permit-tool-btn" data-permit="' + p.id + '">📄 ออกใบอนุญาต (PDF)</button>' : '') +
    ' <button class="permit-tool-btn" data-del="' + p.id + '">🗑 ลบ</button></div></div>';
  return html;
}

function renderPermitsList() {
  var el = document.getElementById('permits-list');
  if (!el) return;
  if (permits.length === 0) { el.innerHTML = '<div style="color:#666;font-size:12px">ยังไม่มีคำขอที่ส่ง — ใช้ปุ่ม "📮 เขียนคำร้อง" และกด "📝 สร้างคำร้อง" ระบบจะบันทึกอัตโนมัติ</div>'; return; }
  var sorted = permits.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
  el.innerHTML = sorted.map(renderPermitCard).join('');
  el.querySelectorAll('.status-select').forEach(function (s) {
    s.addEventListener('change', function () { changePermitStatus(s.dataset.id, s.value); });
  });
  el.querySelectorAll('[data-permit]').forEach(function (b) {
    b.addEventListener('click', function () { openPermitModal(b.dataset.permit); });
  });
  el.querySelectorAll('[data-del]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (confirm('ลบคำขอนี้?')) {
        permits = permits.filter(function (x) { return x.id !== b.dataset.del; });
        savePermits(); renderPermitsList(); updateOccurrenceStats();
      }
    });
  });
}

function savePermitFromPetition() {
  var name = document.getElementById('pet-name').value || '';
  var provKey = lastPin ? findProvince(lastPin) : selectedProvinceKey;
  if (!name || !provKey) return null;
  var p = {
    id: 'P' + Date.now(),
    no: nextPermitNo(),
    createdAt: Date.now(),
    status: 'pending',
    provKey: provKey,
    amphoeKey: document.getElementById('pet-amphoe') ? document.getElementById('pet-amphoe').value : '',
    amphoeTh: document.getElementById('pet-amphoe') && document.getElementById('pet-amphoe').value
      ? document.querySelector('#pet-amphoe option:checked').text : '',
    name: name,
    address: document.getElementById('pet-address').value || '',
    event: document.getElementById('pet-event').value || '',
    eventDate: document.getElementById('pet-date').value || '',
    typeKey: document.getElementById('pet-type').value,
    lat: lastPin ? lastPin[0] : null,
    lon: lastPin ? lastPin[1] : null,
    agencies: ['district'].concat(document.getElementById('pet-ag-airport').checked ? ['airport'] : [])
      .concat(document.getElementById('pet-ag-police').checked ? ['police'] : [])
  };
  permits.push(p);
  savePermits();
  return p;
}

function openPermitModal(id) {
  var p = permits.find(function (x) { return x.id === id; });
  if (!p) return;
  var prov = PROV_REF.find(function (r) { return r.en === p.provKey; });
  var d = p.provKey ? (PROV_DATA[p.provKey] || null) : null;
  var type = BUNFAI_TYPES[p.typeKey] || { label: '' };
  var dateStr = new Date().getDate() + ' ' + ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'][new Date().getMonth()] + ' ' + (new Date().getFullYear() + 543);
  var peak = (p.lat !== null && p.typeKey) ? Math.round(simulatePeak(p.typeKey)) : '—';
  var html =
    '<div style="font-family:\'Sarabun\',\'Tahoma\',sans-serif;padding:18px;background:#fff;color:#111;max-width:640px;margin:0 auto;">' +
    '<div style="text-align:center;border-bottom:2px solid #2a3a5c;padding-bottom:10px;margin-bottom:12px">' +
    '<div style="font-size:11px;color:#666">ราชอาณาจักรไทย</div>' +
    '<div style="font-size:17px;font-weight:bold;margin:4px 0">ใบอนุญาตจด/ปล่อยวัตถุขึ้นอากาศ</div>' +
    '<div style="font-size:12px">เลขที่ใบอนุญาต ' + p.no + '</div></div>' +
    '<p style="font-size:13px;line-height:1.6;text-align:justify">ออกให้เมื่อวันที่ ' + dateStr + ' แก่ <b>' + (p.name || '—') + '</b> ตามคำร้องขอจด/ปล่อย' +
    (p.event ? ' กิจกรรม "' + p.event + '"' : '') + (p.eventDate ? ' วันที่ ' + p.eventDate : '') + '</p>' +
    '<p style="font-size:13px;line-height:1.6;text-align:justify">ชนิดวัตถุ: ' + type.label +
    (peak !== '—' ? ' — ความสูงสูงสุดตามการจำลองวิถี ≈ ' + peak + ' ม.' : '') + '</p>' +
    '<p style="font-size:13px;line-height:1.6;text-align:justify">พิกัดที่อนุญาต: ' + (p.lat !== null ? 'ละติจูด ' + p.lat.toFixed(5) + ' ลองติจูด ' + p.lon.toFixed(5) : '—') +
    (prov ? ' ท้องที่ ' + (p.amphoeTh ? 'อำเภอ' + p.amphoeTh + ' ' : '') + 'จังหวัด' + prov.th + ' ' + prov.region : '') + '</p>';
  if (d) {
    if (d.permit) html += '<p style="font-size:13px;line-height:1.6;text-align:justify">เงื่อนไขตามประกาศ: ' + d.permit + '</p>';
    if (d.authority) html += '<p style="font-size:13px;line-height:1.6">ผู้อนุญาต: ' + d.authority + '</p>';
  }
  html += '<p style="font-size:13px;line-height:1.6;text-align:justify">ผู้ได้รับใบอนุญาตต้องปฏิบัติตาม พ.ร.บ.การเดินอากาศ พ.ศ. 2497 มาตรา 59 และเงื่อนไขของประกาศจังหวัดอย่างเคร่งครัด หากเกิดความเสียหายต่อบุคคลหรือทรัพย์สิน ให้รับผิดชอบตามประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 420</p>' +
    '<div style="margin-top:24px;text-align:right;font-size:13px">(ลงชื่อ) ________________________<br>ผู้อำนวยการ/ผู้รับอนุญาต<br>วันที่ ' + dateStr + '</div>' +
    '<div style="font-size:10.5px;color:#666;margin-top:10px;border-top:1px solid #ccc;padding-top:6px">เอกสารนี้ออกโดยระบบอัตโนมัติจากคำขอที่ได้รับการอนุญาตแล้วในเครื่อง — ใช้เป็นร่างประกอบสำเนาคำสั่งอนุญาตทางการ</div></div>';
  document.getElementById('permit-body').innerHTML = html;
  document.getElementById('permit-modal').style.display = 'flex';
  document.getElementById('permit-modal').dataset.pid = id;
}

function wirePermits() {
  document.getElementById('permits-open').addEventListener('click', function () {
    renderPermitsList();
    document.getElementById('permits-tab').style.display = 'flex';
  });
  document.getElementById('permits-close').addEventListener('click', function () { document.getElementById('permits-tab').style.display = 'none'; });
  document.getElementById('permit-close').addEventListener('click', function () { document.getElementById('permit-modal').style.display = 'none'; });
  document.getElementById('permit-print').addEventListener('click', function () {
    var pid = document.getElementById('permit-modal').dataset.pid;
    var w = window.open('', '_blank');
    w.document.write('<html><head><title>ใบอนุญาตจด/ปล่อยวัตถุขึ้นอากาศ</title>' +
      document.querySelector('link[href*="leaflet"]').outerHTML + '</head><body>' +
      document.getElementById('permit-body').innerHTML + '</body></html>');
    w.document.close(); w.focus(); w.print();
  });
}

// ---------------------------------------------------------------------------
// Dashboard (Bampen-style summary + season heatmap note)
// ---------------------------------------------------------------------------

function activeLaunches() {
  return occurrences.filter(function (o) { return o.startAt && !o.endAt; });
}

function renderDashboard() {
  var el = document.getElementById('dashboard-body');
  var live = activeLaunches();
  var unauth = occurrences.filter(function (o) { return o.kind === 'unauthorized'; }).length;
  var inZone = occurrences.filter(function (o) { return o.airportNear; }).length;
  var approved = permits.filter(function (p) { return p.status === 'approved'; }).length;
  var rejected = permits.filter(function (p) { return p.status === 'rejected'; }).length;
  var pending = permits.filter(function (p) { return p.status === 'pending'; }).length;
  var byMonth = {};
  occurrences.forEach(function (o) { var m = (o.date || '').slice(0, 7); if (m) byMonth[m] = (byMonth[m] || 0) + 1; });
  var months = Object.keys(byMonth).sort();
  var html = '<div>';
  html += '<div style="margin-bottom:8px">' +
    '<span class="dash-stat">คำขอทั้งหมด <b>' + permits.length + '</b></span>' +
    '<span class="dash-stat">ออนุญาตแล้ว <b>' + approved + '</b></span>' +
    '<span class="dash-stat">รอยื่น <b>' + pending + '</b></span>' +
    '<span class="dash-stat">ไม่ผ่าน <b>' + rejected + '</b></span>' +
    '<span class="dash-stat">เหตุการณ์ทั้งหมด <b>' + occurrences.length + '</b></span>' +
    '<span class="dash-stat">ปล่อยไม่ได้รับอนุญาต <b>' + unauth + '</b></span>' +
    '<span class="dash-stat">ในเขตปลอดัยฯ สนามบิน <b>' + inZone + '</b></span>' +
    '<span class="dash-stat">⏱ <span class="live-launch">กำลังจดอยู่ ' + live.length + ' จุด</span></span>' +
    '</div>';
  if (live.length) {
    html += '<div style="background:#e6f7f5;border:1px solid #2a9d8f;border-radius:4px;padding:6px 10px;margin-bottom:8px;font-size:12px">';
    live.forEach(function (o) {
      html += '• ' + (o.provTh || '') + ' ' + (o.note || '') + ' — เริ่ม ' + o.startAt.replace('T', ' ') + ' <a href="https://www.google.com/maps?q=' + o.lat + ',' + o.lon + '" target="_blank">[ดูตำแหน่ง]</a><br>';
    });
    html += '</div>';
  }
  html += '<div style="font-size:12.5px;margin:8px 0"><b>เหตุการณ์ตามเดือน (เชิงฤดูกาล)</b></div>';
  if (months.length) {
    var maxM = Math.max.apply(null, months.map(function (m) { return byMonth[m]; }));
    months.forEach(function (m) {
      var pct = Math.round((byMonth[m] / maxM) * 100);
      html += '<div style="margin:2px 0;font-size:11.5px">' + m + ' <div style="display:inline-block;width:' + pct + 'px;height:10px;background:#e63946;vertical-align:middle"></div> ' + byMonth[m] + '</div>';
    });
  } else {
    html += '<div style="color:#666">ยังไม่มีข้อมูล — เหตุการณ์ที่บันทึกสะสมจะแสดงเป็นแท่งรายเดือนเพื่อจับตาดูช่วงสูงสุดตามฤดูกาล (ปีใหม่/สงกรานต์/ลอยกระทง)</div>';
  }
  html += '<div style="font-size:12px;margin-top:10px;color:#555">Heatmap จุดเสี่ยงรอบสนามบิน: เปิดใช้ที่สวิตช์ "Heatmap จุดเสี่ยง (จาก Log)" — ข้อมูลนี้ใช้วางแผนลงพื้นที่ทำความเข้าใจกับชุมชนล่วงหน้า</div>';
  html += '</div>';
  el.innerHTML = html;
  document.getElementById('dashboard-tab').style.display = 'flex';
}

function wireDashboard() {
  document.getElementById('dashboard-open').addEventListener('click', function () { renderDashboard(); });
  document.getElementById('dashboard-close').addEventListener('click', function () { document.getElementById('dashboard-tab').style.display = 'none'; });
}

// ---------------------------------------------------------------------------
// Region / province selection
// ---------------------------------------------------------------------------

function buildRegionSelect() {
  var sel = document.getElementById('region-select');
  sel.appendChild(new Option('ทั้งประเทศ (ทุกภาค)', ''));
  REGION_LIST.forEach(function (r) { var o = document.createElement('option'); o.value = r; o.text = r; sel.appendChild(o); });
  sel.addEventListener('change', filterProvinces);
}

function filterProvinces() {
  var region = document.getElementById('region-select').value;
  var list = document.getElementById('province-list');
  list.innerHTML = '';
  PROV_REF.slice()
    .filter(function (r) { return !region || r.region === region; })
    .sort(function (a, b) { return a.th.localeCompare(b.th); })
    .forEach(function (r) {
      var el = document.createElement('div');
      el.className = 'province-item';
      el.dataset.key = r.en;
      el.innerHTML = '<span class="pth">' + r.th + '</span>' +
        '<span class="pen">' + r.en + '</span>';
      el.addEventListener('click', function () { selectProvince(r.en); });
      list.appendChild(el);
    });
  document.getElementById('province-count').textContent = list.children.length + ' จังหวัด';
}

function selectProvince(key) {
  selectedProvinceKey = key;
  var rec = PROV_REF.find(function (r) { return r.en === key; });
  document.getElementById('amphoe-select').style.display = 'none';
  document.getElementById('amphoe-card').style.display = 'none';
  populateAmphoeSelect(key);
  restyleProvinces();
  var layer = provinceLayer.getLayers().find(function (l) {
    return provinceNameKey(l.feature.properties.NAME_1) === key;
  });
  if (layer && rec) {
    map.fitBounds(layer.getBounds(), { maxZoom: 12, padding: [30, 30] });
  }
  showRegulationCard(rec);
  document.querySelectorAll('.province-item').forEach(function (el) {
    el.classList.toggle('active', el.dataset.key === key);
  });
}

function showRegulationCard(rec) {
  var card = document.getElementById('regulation-card');
  if (!rec) { card.innerHTML = '<div class="stat-empty">—</div>'; return; }
  var d = PROV_DATA[rec.en] || null;
  if (!d) {
    card.innerHTML = '<div class="stat-empty">ไม่พบข้อมูลประกาศของจังหวัดนี้</div>';
    return;
  }
  var docBtn = '';
  if (d.docPath) {
    docBtn = '<div class="card-row"><span class="card-label">ที่มา (เอกสาร)</span><span><a href="' + d.docPath + '" target="_blank" class="card-link">📄 เปิดเอกสารประกาศ PDF (เก็บในเว็บไซต์)</a></span></div>';
  }
  card.innerHTML =
    '<div class="card-province">' + rec.th + ' <span class="card-region">' + rec.region + '</span></div>' +
    '<div class="card-title">' + (d.title || '') + '</div>' +
    (d.authority ? '<div class="card-row"><span class="card-label">ผู้อนุญาต</span><span>' + d.authority + '</span></div>' : '') +
    (d.permit ? '<div class="card-row"><span class="card-label">เงื่อนไข</span><span>' + d.permit + '</span></div>' : '') +
    (d.applyDaysAdvance ? '<div class="card-row"><span class="card-label">ยื่นขอล่วงหน้า</span><span>≥ ' + d.applyDaysAdvance + ' วัน</span></div>' : '') +
    (d.airportNotify ? '<div class="card-row"><span class="card-label">เขตปลอดัยฯ / สนามบิน</span><span>' + d.airportNotify + '</span></div>' :
      '<div class="card-row"><span class="card-label">เขตปลอดัยฯ / สนามบิน</span><span>ห้ามจด/ปล่อยวัตถุขึ้นอากาศในรัศมี 10 กม. จากท่าอากาศยาน เว้นแต่ได้รับอนุญาต</span></div>') +
    (d.festival ? '<div class="card-row"><span class="card-label">เทศกาล</span><span>' + d.festival + '</span></div>' : '') +
    (d.special ? '<div class="card-row"><span class="card-label">ข้อกำหนดพิเศษ</span><span>' + d.special + '</span></div>' : '') +
    (d.penalties ? '<div class="card-row"><span class="card-label">บทลงโทษ</span><span>' + d.penalties + '</span></div>' : '') +
    (d.gazetteRef ? '<div class="card-row"><span class="card-label">ราชกิจจานุเบกษา</span><span>' + d.gazetteRef + '</span></div>' : '') +
    (d.sourceUrl ? '<div class="card-row"><span class="card-label">ที่มา (ลิงก์)</span><span><a href="' + d.sourceUrl + '" target="_blank" class="card-link">เปิดแหล่งที่มา</a></span></div>' : '') +
    docBtn +
    '<div class="card-note">อ้างอิง พ.ร.บ.การเดินอากาศ พ.ศ. 2497 และประกาศกระทรวงมหาดไทย — รายละเอียดจริงตามประกาศแต่ละจังหวัดที่แพร่หลายในราชกิจจานุเบกษา</div>' +
    '<div class="card-row" style="border:none"><button class="tool-btn" id="check-this-province">📍 ตรวจสอบพิกัดในจังหวัดนี้</button></div>';
  setTimeout(function () {
    var btn = document.getElementById('check-this-province');
    if (btn) btn.addEventListener('click', function () {
      pinDropMode = true;
      document.getElementById('pin-drop-btn').classList.add('active');
      document.getElementById('pin-drop-btn').textContent = '✖ ยกเลิกโหมดปักหมุด';
      map.getContainer().style.cursor = 'crosshair';
      if (pinMarker) { pinMarker.remove(); pinMarker = null; }
    });
  }, 0);
}

// ---------------------------------------------------------------------------
// Airport list
// ---------------------------------------------------------------------------

function buildAirportList() {
  var list = document.getElementById('airport-list');
  var sorted = AIRPORTS.slice().sort(function (a, b) { return a.icao.localeCompare(b.icao); });
  sorted.forEach(function (ap) {
    var el = document.createElement('div');
    el.className = 'airport-item';
    el.dataset.icao = ap.icao;
    el.innerHTML = '<span class="icao">' + ap.icao + '</span>' +
      '<span class="name">' + ap.nameTh + '</span>' +
      '<span class="prov">' + ap.provinceTh + '</span>';
    el.addEventListener('click', function () { selectAirport(ap); });
    list.appendChild(el);
  });
}

function selectAirport(ap) {
  drawAirportZones(ap);
  map.setView([ap.lat, ap.lon], 11);
  document.querySelectorAll('.airport-item').forEach(function (el) {
    el.classList.toggle('active', el.dataset.icao === ap.icao);
  });
  document.getElementById('current-airport-label').textContent = ap.icao + ' — ' + ap.nameTh;
  var rec = PROV_REF.find(function (r) { return r.en === ap.provinceEn; });
  if (rec) { showRegulationCard(rec); }
}

// ---------------------------------------------------------------------------
// Province search
// ---------------------------------------------------------------------------

function wireSearch() {
  document.getElementById('province-search').addEventListener('input', function (e) {
    var q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.province-item').forEach(function (el) {
      var text = el.textContent.toLowerCase();
      el.style.display = text.indexOf(q) === -1 ? 'none' : '';
    });
  });
}

// ---------------------------------------------------------------------------
// Layer toggles
// ---------------------------------------------------------------------------

function wireLayerToggles() {
  document.getElementById('toggle-lhz').addEventListener('change', function (e) {
    if (pinMarker) { /* keep tool layers; zones redraw on select */ }
  });
  document.getElementById('toggle-phz').addEventListener('change', function (e) { /* PHZ checkbox; zones redraw on select */ });
  // Redraw zones of selected airport on toggle
  document.getElementById('toggle-lhz').addEventListener('change', redrawSelected);
  document.getElementById('toggle-phz').addEventListener('change', redrawSelected);
}

var currentAirport = null;

function redrawSelected() {
  if (currentAirport) drawAirportZones(currentAirport);
}

// ---------------------------------------------------------------------------
// GEE note
// ---------------------------------------------------------------------------

function buildGeeNote() {
  var el = document.getElementById('gee-note');
  el.innerHTML = 'วิศวกรรม GIS นี้เทียบเท่า Earth Engine script (ดู gee/bunbangfai_regulation_map.js): ' +
    '<code>PROVINCES</code> = FAO/GAUL level1 คัดให้เหลือเฉพาะ THA และ <code>AIRPORTS</code> = ' +
    'ARP จาก AIP CAAT 2026-07-09 พร้อม buffer(10 กม.) — คำนวณเช่นเดียวกันแต่ทำบนเบราว์เซอร์โดยตรง';
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

loadOccurrences();
loadPermits();
buildRegionSelect();
filterProvinces();
buildProvinceLayer();
buildAirportList();
wireSearch();
wireLayerToggles();
wirePinDrop();
wireSimulation();
wireLetterButtons();
wirePetitionButtons();
wireAmphoe();
wirePermits();
wireDashboard();
wireOccurrenceForm();
updateOccurrenceStats();
updateHeatmap();
buildGeeNote();
if (AIRPORTS.length) selectAirport(AIRPORTS[0]);
