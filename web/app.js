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
 *     Zone circle (standard provincial rule) + runway approach zones (PHZ).
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

// Standard declaration per provincial proclamations: ห้ามจด/ปล่อยวัตถุขึ้นอากาศ
// ในรัศมี 10 กม. จากท่าอากาศยาน เว้นแต่ได้รับอนุญาต — modeled as the LHZ circle.
var LHZ_RADIUS_KM = 10;

var ZONE_STYLE = {
  lhz: { color: '#c1121f', weight: 2, fill: true, fillColor: '#c1121f', fillOpacity: 0.14, dashArray: '6 4' },
  phz: { color: '#99000d', weight: 1, fill: true, fillColor: '#e31a1c', fillOpacity: 0.55 }
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
var airportLayer = L.layerGroup().addTo(map);
var selectedProvinceKey = null;

function provinceNameKey(nameEn) {
  if (nameEn === 'Bangkok' || nameEn === 'Krung Thep Mahanakhon') return 'Bangkok Metropolis';
  return nameEn;
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
// Airport layer
// ---------------------------------------------------------------------------

function drawAirportZones(ap) {
  airportLayer.clearLayers();
  var lat = ap.lat, lon = ap.lon;
  L.circle([lat, lon], { radius: LHZ_RADIUS_KM * 1000, ...ZONE_STYLE.lhz }).addTo(airportLayer);
  var brg = ap.rwyBearingDeg;
  if (brg != null) {
    for (var sign of [1, -1]) {
      var b = (brg + (sign > 0 ? 0 : 180)) % 360;
      var tip = destPoint(lat, lon, b, 8);
      var tl = destPoint(lat, lon, (b + 105) % 360, 2.5);
      var tr = destPoint(lat, lon, (b + 75) % 360, 2.5);
      L.polygon([[lat, lon], tl, tip, tr], ZONE_STYLE.phz).addTo(airportLayer);
    }
  }
  L.circleMarker([lat, lon], { radius: 4, color: '#ffffff', weight: 2, fillColor: '#000000', fillOpacity: 1 })
    .bindTooltip(ap.icao + ' — ' + ap.nameTh, { permanent: false })
    .addTo(airportLayer);
}

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
// Region / province selection
// ---------------------------------------------------------------------------

function buildRegionSelect() {
  var sel = document.getElementById('region-select');
  sel.appendChild(new Option('ทั้งประเทศ (ทุกภาค)', ''));
  REGION_LIST.forEach(function (r) { sel.appendChild(new Option(r, r)); });
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
  card.innerHTML =
    '<div class="card-province">' + rec.th + ' <span class="card-region">' + rec.region + '</span></div>' +
    '<div class="card-title">' + (d.title || '') + '</div>' +
    (d.authority ? '<div class="card-row"><span class="card-label">ผู้อนุญาต</span><span>' + d.authority + '</span></div>' : '') +
    (d.permit ? '<div class="card-row"><span class="card-label">เงื่อนไข</span><span>' + d.permit + '</span></div>' : '') +
    (d.applyDaysAdvance ? '<div class="card-row"><span class="card-label">ยื่นขอล่วงหน้า</span><span>≥ ' + d.applyDaysAdvance + ' วัน</span></div>' : '') +
    (d.airportNotify ? '<div class="card-row"><span class="card-label">เขตปลอดัยฯ / สนามบิน</span><span>' + d.airportNotify + '</span></div>' :
      '<div class="card-row"><span class="card-label">เขตปลอดัยฯ / สนามบิน</span><span>ห้ามจุด/ปล่อยวัตถุขึ้นอากาศในรัศมี 10 กม. จากท่าอากาศยาน เว้นแต่ได้รับอนุญาต</span></div>') +
    (d.festival ? '<div class="card-row"><span class="card-label">เทศกาล</span><span>' + d.festival + '</span></div>' : '') +
    (d.special ? '<div class="card-row"><span class="card-label">ข้อกำหนดพิเศษ</span><span>' + d.special + '</span></div>' : '') +
    (d.penalties ? '<div class="card-row"><span class="card-label">บทลงโทษ</span><span>' + d.penalties + '</span></div>' : '') +
    (d.sourceUrl ? '<div class="card-row"><span class="card-label">ที่มา</span><span><a href="' + d.sourceUrl + '" target="_blank" class="card-link">เปิดเอกสารประกาศ</a></span></div>' : '') +
    '<div class="card-note">อ้างอิง พ.ร.บ.การเดินอากาศ พ.ศ. 2497 และประกาศกระทรวงมหาดไทย — รายละเอียดจริงตามประกาศแต่ละจังหวัดที่เผยแพร่ในราชกิจจานุเบกษา</div>';
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
    airportLayer.eachLayer(function (l) {
      if (l instanceof L.Circle) {
        if (e.target.checked) { l.addTo(map); } else { l.removeFrom(map); }
      }
    });
  });
  document.getElementById('toggle-phz').addEventListener('change', function (e) {
    airportLayer.eachLayer(function (l) {
      if (l instanceof L.Polygon) {
        if (e.target.checked) { l.addTo(map); } else { l.removeFrom(map); }
      }
    });
  });
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

buildRegionSelect();
filterProvinces();
buildProvinceLayer();
buildAirportList();
wireSearch();
wireLayerToggles();
buildGeeNote();
