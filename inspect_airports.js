// inspect AIRPORTS structure — data.js uses global var via eval
var vm = require('vm');
var fs = require('fs');
var ctx = { console: console, window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('./data.js', 'utf8'), ctx);
var AIRPORTS = ctx.AIRPORTS;
console.log('count', AIRPORTS.length);
var a = AIRPORTS[0];
console.log('keys', Object.keys(a));
var out = AIRPORTS.map(function (x) {
  return { icao: x.icao, nameTh: x.nameTh, nameEn: x.nameEn, lat: x.lat, lon: x.lon, rwy: x.rwy, provinceEn: x.provinceEn, provinceTh: x.provinceTh, sizeClass: x.sizeClass, zoneKeys: x.zones ? Object.keys(x.zones) : [] };
});
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync('/home/ubuntu/research/airports_meta.json', JSON.stringify(out, null, 1));
