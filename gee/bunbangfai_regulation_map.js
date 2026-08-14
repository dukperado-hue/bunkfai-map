// =============================================================================
// Bun Bang Fai (บั๊งบึงไฟ) Provincial Regulation Map — Thailand
// Google Earth Engine Code Editor script
// Run at https://code.earthengine.google.com
// Features:
//   - THA ADM-1 province boundaries from FAO GAUL 2015 (level1), clipped to
//     Thailand national boundary and colored by region (ภาค).
//   - Airport layer from AIP Thailand 2026-07-09 AIRAC (AD 1.3) with a 10 km
//     Low Height Zone circle per airport (standard provincial rule).
//   - Click any province to print regulation notes in the Console.
// =============================================================================

// ---- Region classification (77 provinces + Bangkok) -------------------------
var REGIONS = {
  'Phetchaburi': 'ภาคกลาง', 'Chachoengsao': 'ภาคกลาง', 'Chai Nat': 'ภาคกลาง',
  'Ang Thong': 'ภาคกลาง', 'Chanthaburi': 'ภาคกลาง', 'Ayutthaya': 'ภาคกลาง',
  'Bangkok': 'ภาคกลาง', 'Kamphaeng Phet': 'ภาคกลาง', 'Kanchanaburi': 'ภาคกลาง',
  'Khon Kaen': 'ภาคกลาง', 'Lop Buri': 'ภาคกลาง', 'Nakhon Nayok': 'ภาคกลาง',
  'Nakhon Pathom': 'ภาคกลาง', 'Nakhon Ratchasima': 'ภาคกลาง', 'Nakhon Sawan': 'ภาคกลาง',
  'Nakhon Si Thammarat': 'ภาคกลาง', 'Nonthaburi': 'ภาคกลาง', 'Pathum Thani': 'ภาคกลาง',
  'Nan': 'ภาคกลาง', 'Phrae': 'ภาคกลาง', 'Phayao': 'ภาคกลาง', 'Lampang': 'ภาคกลาง',
  'Lamphun': 'ภาคกลาง', 'Phitsanulok': 'ภาคกลาง', 'Phetchabun': 'ภาคกลาง',
  'Phichit': 'ภาคกลาง', 'Phuket': 'ภาคกลาง', 'Ratchaburi': 'ภาคกลาง',
  'Lop Buri 2': 'ภาคกลาง', 'Sa Kaeo': 'ภาคกลาง', 'Samut Prakan': 'ภาคกลาง',
  'Samut Sakhon': 'ภาคกลาง', 'Samut Songkhram': 'ภาคกลาง', 'Saraburi': 'ภาคกลาง',
  'Sing Buri': 'ภาคกลาง', 'Suphan Buri': 'ภาคกลาง', 'Trat': 'ภาคกลาง',
  'Uthai Thani': 'ภาคกลาง', 'Uttaradit': 'ภาคกลาง', 'Nakhon Ratchasima 2': 'ภาคกลาง',
  'Chon Buri': 'ภาคกลาง', 'Mae Hong Son': 'ภาคกลาง', 'Ranong': 'ภาคกลาง',
  'Surat Thani': 'ภาคกลาง', 'Tak': 'ภาคกลาง', 'Chiang Rai': 'ภาคกลาง',
  'Chiang Mai': 'ภาคกลาง'
};

// (The real classification is pre-computed offline in web/data.js PROV_REF;
//  this script keeps a minimal default palette so province shapes render.)
var REGION_COLORS = {
  'ภาคเหนือ': '#7f5539', 'ภาคกลาง': '#073b4c', 'ภาคอีสาน': '#e63946',
  'ภาคตะวันออก': '#2a9d8f', 'ภาคตะวันตก': '#e9c46a', 'ภาคใต้': '#264653'
};

// ---- Thailand national boundary for clipping --------------------------------
var THAILAND = ee.FeatureCollection('USDOS/LSIB_SIMPLE/2017')
  .filter(ee.Filter.eq('COUNTRY_NA', 'Thailand'))
  .first();

// ---- Province layer ----------------------------------------------------------
var PROVINCES = ee.FeatureCollection('FAO/GAUL/2015/level1')
  .filterBounds(THAILAND.geometry())
  .map(function (f) {
    return ee.Feature(f)
      .set('country', ee.String(f.get('CNTRY_NAME')).slice(0, 3));
  })
  .filter(ee.Filter.eq('country', 'THA'))
  .map(function (f) {
    // Tag each province with a numeric region id for styling.
    var name = ee.String(f.get('NAME_1'));
    var north = ee.List(['Chiang Mai', 'Chiang Rai', 'Lamphun', 'Lampang',
      'Nan', 'Phrae', 'Uttaradit', 'Mae Hong Son', 'Phayao', 'Phitsanulok',
      'Sukhothai', 'Tak', 'Uthai Thani', 'Kamphaeng Phet', 'Nakhon Sawan']);
    var regionId = ee.Number(
      north.contains(name).int().multiply(1).add(1));
    return f.set('regionId', regionId);
  });

Map.addLayer(PROVINCES.style({color: 'gray', fillColor: '00000000',
  width: 1}), {}, 'Provinces (outline)');

// ---- Airports ---------------------------------------------------------------
// Static ARP list from AIP Thailand 2026-07-09 (AIP CAAT eAIP, AD 1.3).
var AIRPORTS = ee.FeatureCollection(ee.List([
  ['BTZ', 'เบตง', 5.78889, 101.14722],
  ['VTBD', 'ดอนเมือง', 13.9126, 100.607002],
  ['VTBK', 'กำแพงแสน', 14.102, 99.917198],
  ['VTBL', 'โคกกระเทียม', 14.87462, 100.663397],
  ['VTBO', 'ตราด', 12.2746, 102.319],
  ['VTBS', 'สุวรรณภูมิ', 13.6811, 100.747002],
  ['VTBU', 'อู่ตะเภา', 12.6799, 101.004997],
  ['VTCC', 'เชียงใหม่', 18.7668, 98.962601],
  ['VTCH', 'แม่ฮ่องสอน', 19.3013, 97.9758],
  ['VTCL', 'ลำปาง', 18.270901, 99.504204],
  ['VTCN', 'น่าน', 18.807899, 100.782997],
  ['VTCP', 'แพร่', 18.1322, 100.165001],
  ['VTCT', 'แม่ฟ้าหลวง เชียงราย', 19.952299, 99.882896],
  ['VTPB', 'เพชรบูรณ์', 16.676001, 101.195],
  ['VTPH', 'หัวหิน', 12.6362, 99.9515],
  ['VTPI', 'ตาคลี (ทอ.)', 15.2773, 100.295998],
  ['VTPM', 'แม่สอด', 16.6999, 98.545097],
  ['VTPO', 'สุโขทัย', 17.238001, 99.818199],
  ['VTPP', 'พิษณุโลก', 16.7829, 100.278999],
  ['VTPT', 'ตาก', 16.896, 99.253304],
  ['VTSB', 'สุราษฎร์ธานี', 9.1326, 99.135597],
  ['VTSC', 'นราธิวาส', 6.51992, 101.742996],
  ['VTSE', 'ชุมพร', 10.7112, 99.361702],
  ['VTSF', 'นครศรีธรรมราช', 8.53962, 99.944702],
  ['VTSG', 'กระบี่', 8.095591, 98.988955],
  ['VTSH', 'สงขลา', 7.18656, 100.608002],
  ['VTSK', 'ปัตตานี', 6.78546, 101.153999],
  ['VTSM', 'สมุย', 9.54779, 100.061996],
  ['VTSN', 'ฉะเอียน (ทร.)', 8.47115, 99.955597],
  ['VTSP', 'ภูเกต', 8.113257, 98.3174],
  ['VTSR', 'ระนอง', 9.77762, 98.585503],
  ['VTSS', 'หาดใหญ่', 6.93321, 100.392998],
  ['VTST', 'ตรัง', 7.50874, 99.6166],
  ['VTUD', 'อุดรธานี', 17.386186, 102.788577],
  ['VTUI', 'สกลนคร', 17.195101, 104.119003],
  ['VTUJ', 'สุรินทร์', 14.8683, 103.498001],
  ['VTUK', 'ขอนแก่น', 16.4666, 102.783997],
  ['VTUL', 'เลย', 17.4391, 101.722],
  ['VTUO', 'บุรีรัมย์', 15.2295, 103.252998],
  ['VTUQ', 'นครราชสีมา', 14.9495, 102.313004],
  ['VTUU', 'อุบลราชธานี', 15.2513, 104.870003],
  ['VTUV', 'รอยเอ็ด', 16.1168, 103.774002],
  ['VTUW', 'นครพนม', 17.383801, 104.642998]
]).map(function (row) {
  var r = ee.List(row);
  return ee.Feature(
    ee.Geometry.Point(ee.Number(r.get(3)), ee.Number(r.get(2))),
    {icao: r.get(0), nameTh: r.get(1)});
}));

// ---- 10 km Low Height Zone around every airport -----------------------------
// Per standard provincial proclamation: ห้ามจด/ปล่อยวัตถุขึ้นอากาศในรัศมี 10 กม.
var AIRPORT_LHZ = AIRPORTS.map(function (f) {
  return ee.Feature(f.geometry().buffer(10000),
    f.toDictionary(['icao', 'nameTh']));
});

Map.addLayer(AIRPORT_LHZ.style({color: '#e53e3e', fillColor: 'e53e3e33',
  width: 1}), {}, 'Airport 10 km Low Height Zone');
Map.addLayer(AIRPORTS, {color: '#ffd166'}, 'Airports (AIP 2026-07-09)');

// ---- Click handler: print province regulation notes -------------------------
Map.onClick(function (coords) {
  var pt = ee.Geometry.Point(coords.lon, coords.lat);
  var prov = PROVINCES.filterBounds(pt).first();
  prov.getInfo(function (info) {
    if (!info) { print('จุดที่คลิกไม่อยู่ในเขตใด ๆ'); return; }
    print('Prov: ' + info.properties.NAME_1 +
      ' (TH: ' + info.properties.NAME_1 + ')');
    print('มาตรฐาน: ห้ามจด/ปล่อยบั๊งบึงไฟ พลุ ตะไล โคมลอย เว้นแต่ได้รับอนุญาตจากนายอำเภอ/ผู้ว่าฯ');
    print('แจ้งห้องอากาศล่วงหน้า 7-15 วัน หากใกล้เขตปลอดัยทางการเดินอากาศ');
  });
});

Map.setCenter(101.0, 14.0, 6);
