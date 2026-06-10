// =========================================================================
// 1. UČITAVANJE PROSTORNOG OBUHVATA (AOI)
// =========================================================================

var aoi = ee.FeatureCollection("projects/ee-sandraristanovic03/assets/granica");
var aoiGeom = aoi.geometry();

// Inicijalno postavljanje mape
Map.centerObject(aoi, 12);
Map.setOptions('HYBRID');


// =========================================================================
// 2. GLOBALNE KONSTANTE I PODEŠAVANJA
// =========================================================================

var S2_COLLECTION = 'COPERNICUS/S2_HARMONIZED';
var DW_COLLECTION = 'GOOGLE/DYNAMICWORLD/V1';

var FIRST_YEAR = 2016;
var LAST_YEAR = 2024;


// =========================================================================
// 3. POMOĆNE UI FUNKCIJE ZA RUKOVANJE PODACIMA
// =========================================================================

function toNumber(value) {
  return parseInt(value, 10);
}

function pad2(n) {
  n = Number(n);
  return n < 10 ? '0' + n : String(n);
}

function getStartDateString(year, month) {
  return String(year) + '-' + pad2(month) + '-01';
}

function getEndDateString(year, month) {
  year = Number(year);
  month = Number(month);
  if (month === 12) {
    return String(year + 1) + '-01-01';
  }
  return String(year) + '-' + pad2(month + 1) + '-01';
}

function getSeasonStart(year) {
  var startMonth = toNumber(startMonthSelect.getValue());
  return ee.Date(getStartDateString(year, startMonth));
}

function getSeasonEnd(year) {
  var endMonth = toNumber(endMonthSelect.getValue());
  return ee.Date(getEndDateString(year, endMonth));
}


// =========================================================================
// 4. STRUKTURE ZA ZAŠTITU OD GREŠAKA (FALLBACK IMAGES)
// =========================================================================

function emptyS2Image() {
  return ee.Image.constant([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    .rename(['B2', 'B3', 'B4', 'B8', 'B12', 'NDVI', 'NBR', 'SAVI', 'EVI', 'LAI'])
    .updateMask(ee.Image.constant(0))
    .clip(aoiGeom);
}

function emptyProbabilityImage() {
  return ee.Image.constant(0)
    .rename('label')
    .updateMask(ee.Image.constant(0))
    .clip(aoiGeom);
}


// =========================================================================
// 5. RAD SA ATMOSFERSKIM KOREKCIJAMA I MASKIRANJEM OBLAKA
// =========================================================================

function maskS2Clouds(img) {
  var qa = img.select('QA60');
  var cloudBitMask = 1 << 10;
  var cirrusBitMask = 1 << 11;

  var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
    .and(qa.bitwiseAnd(cirrusBitMask).eq(0));

  // Skaliranje Sentinel-2 podataka na realne vrednosti refleksije (0-1)
  var optical = img.select(['B2', 'B3', 'B4', 'B8', 'B12'])
    .divide(10000)
    .updateMask(mask);

  return optical.copyProperties(img, ['system:time_start', 'CLOUDY_PIXEL_PERCENTAGE']);
}


// =========================================================================
// 6. MATEMATIČKO RAČUNANJE SPEKTRALNIH INDEKSA I BIOFIZIČKIH PARAMETARA
// =========================================================================

function addIndices(img) {
  var nir = img.select('B8').toFloat();
  var red = img.select('B4').toFloat();
  var blue = img.select('B2').toFloat();

  // 1. Normalized Difference Vegetation Index
  var ndvi = img.normalizedDifference(['B8', 'B4']).rename('NDVI');
  
  // 2. Normalized Burn Ratio
  var nbr = img.normalizedDifference(['B8', 'B12']).rename('NBR');

  // 3. Soil-Adjusted Vegetation Index (L = 0.5)
  var savi = img.expression(
    '((NIR - RED) / (NIR + RED + L)) * (1 + L)',
    { NIR: nir, RED: red, L: 0.5 }
  ).rename('SAVI');

  // 4. Enhanced Vegetation Index (G=2.5, C1=6, C2=7.5, L=1)
  var evi = img.expression(
    '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))',
    { NIR: nir, RED: red, BLUE: blue }
  ).rename('EVI');

  // 5. Leaf Area Index (Empirijski model zasnovan na EVI indeksu)
  var lai = evi.multiply(3.618).subtract(0.118).rename('LAI');

  return img.addBands([ndvi, nbr, savi, evi, lai]);
}

// Kreiranje bazne kolekcije sa maskiranim oblacima
var s2Base = ee.ImageCollection(S2_COLLECTION)
  .filterBounds(aoiGeom)
  .filterDate('2016-01-01', '2025-01-01')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 70))
  .map(maskS2Clouds);


// =========================================================================
// 7. KORISNIČKI INTERFEJS (UI PANEL PODEŠAVANJA)
// =========================================================================

var panel = ui.Panel({
  style: { width: '395px', padding: '15px', backgroundColor: '#FFFFFF' }
});

panel.add(ui.Label({
  value: '🌲 ANALIZA ŠUMA — RTANJ',
  style: { fontSize: '22px', fontWeight: 'bold', color: '#145A32' }
}));

panel.add(ui.Label({
  value: 'Aplikacija za monitoring šumskih ekosistema i detekciju promena pomoću Sentinel-2 i Dynamic World algoritama.',
  style: { fontSize: '12px', margin: '0 0 15px 0', color: '#555555' }
}));

// Selektori za vremenski period
var yearItems = [];
for (var y = FIRST_YEAR; y <= LAST_YEAR; y++) {
  yearItems.push({label: 'Godina ' + y, value: String(y)});
}

var startYearSelect = ui.Select({items: yearItems, value: '2016', style: {stretch: 'horizontal'}});
var endYearSelect = ui.Select({items: yearItems, value: '2024', style: {stretch: 'horizontal'}});

panel.add(ui.Label('📅 Početni vremenski presek:', {fontWeight: 'bold'}));
panel.add(startYearSelect);
panel.add(ui.Label('📅 Krajnji vremenski presek:', {fontWeight: 'bold'}));
panel.add(endYearSelect);

// Selektori za fenološku sezonu
var monthItems = [
  {label: 'Januar', value: '1'}, {label: 'Februar', value: '2'}, {label: 'Mart', value: '3'},
  {label: 'April', value: '4'}, {label: 'Maj', value: '5'}, {label: 'Jun', value: '6'},
  {label: 'Jul', value: '7'}, {label: 'Avgust', value: '8'}, {label: 'Septembar', value: '9'},
  {label: 'Oktobar', value: '10'}, {label: 'Novembar', value: '11'}, {label: 'Decembar', value: '12'}
];

var startMonthSelect = ui.Select({items: monthItems, value: '6', style: {stretch: 'horizontal'}});
var endMonthSelect = ui.Select({items: monthItems, value: '9', style: {stretch: 'horizontal'}});

panel.add(ui.Label('🌱 Početak fenološke sezone:', {fontWeight: 'bold'}));
panel.add(startMonthSelect);
panel.add(ui.Label('🌱 Kraj fenološke sezone:', {fontWeight: 'bold'}));
panel.add(endMonthSelect);

// Selektor indeksa
var indexSelect = ui.Select({
  items: [
    {label: 'NDVI (Zdravstveno stanje vegetacije)', value: 'NDVI'},
    {label: 'NBR (Degradacija i poremećaji pokrivača)', value: 'NBR'},
    {label: 'SAVI (Indeks korigovan za refleksiju tla)', value: 'SAVI'},
    {label: 'LAI (Indeks lisne površine / gustina)', value: 'LAI'}
  ],
  value: 'NDVI',
  style: {stretch: 'horizontal'}
});

panel.add(ui.Label('📊 Izbor spektralnog indikatora:', {fontWeight: 'bold'}));
panel.add(indexSelect);

// PRAG JE UKLONJEN IZ UI-ja (Dynamic World fiksiran na stabilan modni režim klase 'Trees')

// Status bar i statistički paneli
var statusLabel = ui.Label({value: '', style: {color: '#2E86C1', fontWeight: 'bold', margin: '10px 0'}});
panel.add(statusLabel);

var statsPanel = ui.Panel({
  style: { margin: '10px 0', padding: '10px', backgroundColor: '#F8F9F9', border: '1px solid #D5D8DC', borderRadius: '4px' }
});
statsPanel.add(ui.Label({value: '📐 Rezultati prostorne analize', style: {fontWeight: 'bold', fontSize: '14px', color: '#2C3E50'}}));
var statsText = ui.Label('Pokrenite analizu za prikaz statistike.');
statsPanel.add(statsText);
panel.add(statsPanel);

var chartPanel = ui.Panel({style: {margin: '15px 0 0 0'}});
panel.add(chartPanel);

var runButton = ui.Button({
  label: '⚡ POKRENI PROSTORNU ANALIZU',
  style: {stretch: 'horizontal', fontWeight: 'bold', margin: '15px 0'},
  onClick: updateMap
});
panel.add(runButton);


// =========================================================================
// 8. DINAMIČKO KREIRANJE KARTOGRAFSKE LEGENDE
// =========================================================================

var legend = ui.Panel({
  style: { position: 'bottom-left', padding: '12px', backgroundColor: 'white', border: '1px solid #BDC3C7', borderRadius: '5px' }
});

function createGradientLegend(colors, labels) {
  var gradient = ui.Thumbnail({
    image: ee.Image.pixelLonLat().select(0),
    params: { bbox: [0, 0, 1, 0.1], dimensions: '220x12', format: 'png', min: 0, max: 1, palette: colors },
    style: { stretch: 'horizontal', margin: '6px 0' }
  });
  var labelRow = ui.Panel({
    widgets: [ui.Label(labels[0], {fontSize: '11px'}), ui.Label(labels[1], {stretch: 'horizontal', textAlign: 'right', fontSize: '11px'})],
    layout: ui.Panel.Layout.flow('horizontal')
  });
  return ui.Panel([gradient, labelRow]);
}

function updateLegend(index) {
  legend.clear();
  legend.add(ui.Label({value: '🗺️ LEGENDA MAPE', style: {fontWeight: 'bold', fontSize: '14px', color: '#2C3E50'}}));
  legend.add(ui.Label({value: 'Izabrani indeks: ' + index, style: {fontSize: '12px', fontWeight: 'bold', color: '#7F8C8D', margin: '5px 0'}}));

  if (index === 'NDVI') { legend.add(createGradientLegend(['#FFFFFF', '#F4D03F', '#27AE60', '#145A32'], ['Niska vrednost', 'Visoka vrednost'])); }
  if (index === 'NBR') {  legend.add(createGradientLegend(['#E74C3C', '#FFFFFF', '#2ECC71', '#1D8348'], ['Niska vrednost', 'Visoka vrednost'])); }
  if (index === 'SAVI') { legend.add(createGradientLegend(['#FFFFFF', '#F5B041', '#58D68D', '#1E8449'], ['Niska vrednost', 'Visoka vrednost'])); }
  if (index === 'LAI') {  legend.add(createGradientLegend(['#FFFFFF', '#ABEBC6', '#28B463', '#114F2C'], ['Retka krošnja', 'Maksimalan LAI (>5)'])); }

  legend.add(ui.Label({value: 'Trend promene vrednosti indeksa (Diferencijalna mapa)', style: {fontWeight: 'bold', fontSize: '11px', margin: '10px 0 0 0'}}));
  legend.add(createGradientLegend(['#FF0000', '#F4F6F6', '#00FF00'], ['Pad indeksa (Degradacija)', 'Stabilno / Rast']));
  
  legend.add(ui.Label({value: '🔴 Crveno — Pad indeksa na celom terenu', style: {fontSize: '11px', margin: '5px 0 0 0'}}));
  legend.add(ui.Label({value: '🟣 Ljubičasto — Prirast nove šume (Dynamic World)', style: {fontSize: '11px'}}));
}


// =========================================================================
// 9. PROCESIRANJE PODATAKA I KREIRANJE KOMPOZITA
// =========================================================================

function getS2Composite(year) {
  var start = getSeasonStart(year);
  var end = getSeasonEnd(year);
  var collection = s2Base.filterDate(start, end).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50));
  
  var composite = collection.median().clip(aoiGeom);
  var compositeWithIndices = addIndices(composite);
  
  return ee.Image(ee.Algorithms.If(collection.size().gt(0), compositeWithIndices, emptyS2Image()));
}

function getTreeLabelMode(year) {
  var start = getSeasonStart(year);
  var end = getSeasonEnd(year);
  var collection = ee.ImageCollection(DW_COLLECTION)
    .filterBounds(aoiGeom)
    .filterDate(start, end)
    .select('label');
  
  return ee.Image(ee.Algorithms.If(collection.size().gt(0), collection.mode().clip(aoiGeom), emptyProbabilityImage()));
}

function getForestMask(year) {
  var dwMode = getTreeLabelMode(year);
  // Klasa 1 u Dynamic World-u predstavlja zvaničnu stabilnu klasu "Trees" (Šume)
  return dwMode.eq(1).rename('forest').clip(aoiGeom);
}

function getIndexVis(index) {
  if (index === 'NDVI') { return {min: 0, max: 0.85, palette: ['#FFFFFF', '#F4D03F', '#27AE60', '#145A32']}; }
  if (index === 'NBR') {  return {min: 0.1, max: 0.7, palette: ['#E74C3C', '#FFFFFF', '#2ECC71', '#1D8348']}; }
  if (index === 'SAVI') { return {min: 0.05, max: 0.6, palette: ['#FFFFFF', '#F5B041', '#58D68D', '#1E8449']}; }
  if (index === 'LAI') {  return {min: 0, max: 5, palette: ['#FFFFFF', '#ABEBC6', '#28B463', '#114F2C']}; }
  return {min: 0, max: 1};
}


// =========================================================================
// 10. STATISTIČKI PRORAČUNI POVRŠINA (ZONAL STATISTICS)
// =========================================================================

function areaHa(maskImage) {
  var areaImage = ee.Image.pixelArea().divide(10000).multiply(maskImage.unmask(0)).rename('area');
  var result = areaImage.reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: aoiGeom,
    scale: 10,
    maxPixels: 1e13,
    bestEffort: true
  });
  return ee.Number(result.get('area'));
}


// =========================================================================
// 11. KREIRANJE HISTORIJSKOG GRAFIKONA TRENDOVA
// =========================================================================

function makeYearlyChart(index) {
  var startMonth = toNumber(startMonthSelect.getValue());
  var endMonth = toNumber(endMonthSelect.getValue());
  var yearsList = ee.List.sequence(FIRST_YEAR, LAST_YEAR);

  var yearlyCollection = ee.ImageCollection(yearsList.map(function(y) {
    y = ee.Number(y);
    var start = ee.Date.fromYMD(y, startMonth, 1);
    var end = endMonth === 12 ? ee.Date.fromYMD(y.add(1), 1, 1) : ee.Date.fromYMD(y, endMonth + 1, 1);

    var s2Collection = s2Base.filterDate(start, end).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50));
    var composite = s2Collection.median().clip(aoiGeom);
    var yearlyImg = addIndices(composite); 

    var dwCollection = ee.ImageCollection(DW_COLLECTION).filterBounds(aoiGeom).filterDate(start, end).select('label');
    var dwMode = ee.Image(ee.Algorithms.If(dwCollection.size().gt(0), dwCollection.mode().clip(aoiGeom), emptyProbabilityImage()));

    var forestMask = dwMode.eq(1).rename('forest');
    return yearlyImg.updateMask(forestMask).clip(aoiGeom).select(index).set('year', y);
  }));

  return ui.Chart.image.series({
    imageCollection: yearlyCollection,
    region: aoiGeom,
    reducer: ee.Reducer.mean(),
    scale: 30,
    xProperty: 'year'
  })
  .setChartType('LineChart')
  .setOptions({
    title: 'Srednja vrednost ' + index + ' unutar šuma Rtnja (2016–2024)',
    hAxis: {title: 'Godina', format: '####', gridlines: {count: 9}},
    vAxis: {title: index},
    lineWidth: 3,
    pointSize: 6,
    legend: {position: 'none'},
    series: {0: {color: '#145A32'}}
  });
}


// =========================================================================
// 12. GLAVNI IZVRŠNI ALGORITAM (KLASIFIKACIJA ŠUMA I PROMENA)
// =========================================================================

function updateMap() {
  Map.layers().reset();
  chartPanel.clear();

  var startYear = toNumber(startYearSelect.getValue());
  var endYear = toNumber(endYearSelect.getValue());
  var startMonth = toNumber(startMonthSelect.getValue());
  var endMonth = toNumber(endMonthSelect.getValue());
  var index = indexSelect.getValue();

  // Validacija korisničkih inputa
  if (endYear <= startYear) {
    statusLabel.setValue('⚠️ Greška: Krajnja godina mora biti veća od početne.');
    statsText.setValue('Korigujte selektore godina.');
    return;
  }
  if (endMonth < startMonth) {
    statusLabel.setValue('⚠️ Greška: Krajnji mesec ne može biti pre početnog.');
    statsText.setValue('Korigujte selektore meseci sezone.');
    return;
  }

  statusLabel.setValue('⏳ Pokrenuta prostorna analiza za period ' + startYear + '–' + endYear + '...');
  statsText.setValue('Izračunavanje statističkih parametara u toku...');

  var indexVis = getIndexVis(index);

  // Generisanje kompozita i maski šume
  var startImg = getS2Composite(startYear);
  var endImg = getS2Composite(endYear);

  var startForestMask = getForestMask(startYear);
  var endForestMask = getForestMask(endYear);

  // Kontinuirani legeri za ceo AOI obuhvat
  var startIndexFull = startImg.select(index).clip(aoiGeom);
  var endIndexFull = endImg.select(index).clip(aoiGeom);

  // --- FENOLOŠKA KLASIFIKACIJA (LISTOPADNO vs. ČETINARSKO) ---
  function fenoKlasifikacija(godina, forestMask) {
    // Analiza zimske stabilnosti vegetacije (decembar prethodne godine - februar tekuće godine)
    var zimskaKolekcija = s2Base.filterDate(String(godina-1) + '-12-01', String(godina) + '-02-28')
                                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40));
    var zimskiMedijan = ee.Image(ee.Algorithms.If(zimskaKolekcija.size().gt(0), zimskaKolekcija.median(), emptyS2Image()));
    var zimskiNdvi = addIndices(zimskiMedijan).select('NDVI');
    
    // Četinari zadržavaju zelenu masu (NDVI >= 0.35) i u zimskom periodu
    var cetinari = zimskiNdvi.gte(0.35).and(forestMask).rename('cetinari');
    var listopadne = zimskiNdvi.lt(0.35).and(forestMask).rename('listopadne');
    
    return {cetinari: cetinari.clip(aoiGeom), listopadne: listopadne.clip(aoiGeom)};
  }

  var startSume = fenoKlasifikacija(startYear, startForestMask);
  var endSume = fenoKlasifikacija(endYear, endForestMask);

  // --- VIZUELIZACIJA SLOJEVA NA KARTI ---
  // Granica je uvek upaljena radi prostorne orijentacije
  Map.addLayer(aoi, {color: '#000000', fillColor: '00000000'}, 'Granica istraživanja (AOI) Rtanj', true);

  // Satelitski snimci prirodnih boja (Isključeni po defaultu - false)
  Map.addLayer(startImg, {bands: ['B4', 'B3', 'B2'], min: 0, max: 0.25}, 'S2 Satelitski RGB (' + startYear + ')', false);
  Map.addLayer(endImg, {bands: ['B4', 'B3', 'B2'], min: 0, max: 0.25}, 'S2 Satelitski RGB (' + endYear + ')', false);

  // Kontinuirani spektralni indeksi za ceo teren (Isključeni po defaultu - false)
  Map.addLayer(startIndexFull, indexVis, index + ' kompletan teren (' + startYear + ')', false);
  Map.addLayer(endIndexFull, indexVis, index + ' kompletan teren (' + endYear + ')', false);

  // Ukupne šumske maske izvedene iz Dynamic World algoritma (Isključene po defaultu - false)
  Map.addLayer(startForestMask.selfMask(), {palette: ['#229954']}, 'Ukupna šumska maska (' + startYear + ')', false);
  Map.addLayer(endForestMask.selfMask(), {palette: ['#117A65']}, 'Ukupna šumska maska (' + endYear + ')', false);

  // Listopadne i četinarske šume sa NOVIJM PALETAMA (Listopadno = Svetlo zelena, Četinari = Tamno zelena)
  Map.addLayer(startSume.listopadne.selfMask(), {palette: ['#90ee90']}, '🍂 Listopadne šume (' + startYear + ')', false);
  Map.addLayer(startSume.cetinari.selfMask(), {palette: ['#006400']}, '🌲 Četinarske šume (' + startYear + ')', false);
  Map.addLayer(endSume.listopadne.selfMask(), {palette: ['#90ee90']}, '🍂 Listopadne šume (' + endYear + ')', false);
  Map.addLayer(endSume.cetinari.selfMask(), {palette: ['#006400']}, '🌲 Četinarske šume (' + endYear + ')', false);

  // Diferencijalna mapa (Jedina ostaje direktno vidljiva jer prikazuje glavnu temu istraživanja - true)
  var indexDifferenceFull = endImg.select(index).subtract(startImg.select(index)).clip(aoiGeom);
  Map.addLayer(indexDifferenceFull, {min: -0.30, max: 0.30, palette: ['#FF0000', '#F4F6F6', '#00FF00']}, 'Diferencijalna mapa: Kompletan trend ' + index + ' (' + startYear + '–' + endYear + ')', true);

  // Detekcija promena i poremećaja šumskog tkiva
  var currentDrop;
  if (index === 'NBR') {
    currentDrop = endImg.select('NBR').subtract(startImg.select('NBR')).lte(-0.10);
  } else if (index === 'LAI') {
    currentDrop = endImg.select('LAI').subtract(startImg.select('LAI')).lte(-1.0);
  } else {
    currentDrop = endImg.select('NDVI').subtract(startImg.select('NDVI')).lte(-0.12);
  }

  var forestDisappeared = startForestMask.and(endForestMask.not());
  var forestLoss = startForestMask.and(forestDisappeared.or(currentDrop)).clip(aoiGeom);
  var forestGain = endForestMask.and(startForestMask.not()).clip(aoiGeom);

  Map.addLayer(forestLoss.selfMask(), {palette: ['#FF1744']}, 'Detektovani gubitak šume (na bazi ' + index + ')', false);
  Map.addLayer(forestGain.selfMask(), {palette: ['#D500F9']}, 'Detektovani prirast šume (Forest Gain)', false);

  // Ažuriranje grafikona u panelu
  var chart = makeYearlyChart(index);
  chartPanel.add(chart);

  // Proračuni zonalne statistike u hektarima (ha)
  var startForestArea = areaHa(startForestMask);
  var endForestArea = areaHa(endForestMask);
  
  var startListopadneArea = areaHa(startSume.listopadne);
  var startCetinariArea = areaHa(startSume.cetinari);
  var endListopadneArea = areaHa(endSume.listopadne);
  var endCetinariArea = areaHa(endSume.cetinari);

  var lossArea = areaHa(forestLoss);
  var gainArea = areaHa(forestGain);
  var netChange = endForestArea.subtract(startForestArea);

  var statsDict = ee.Dictionary({
    startForest: startForestArea, endForest: endForestArea,
    startListopadne: startListopadneArea, startCetinari: startCetinariArea,
    endListopadne: endListopadneArea, endCetinari: endCetinariArea,
    loss: lossArea, gain: gainArea, netChange: netChange
  });

  statsDict.evaluate(function(result) {
    if (!result) {
      statsText.setValue('Došlo je do greške prilikom evalvacije prostornih zona.');
      statusLabel.setValue('⚠️ Analiza neuspešna.');
      return;
    }

    var text =
      '📊 IZVEŠTAJ O PROMENAMA ZA RTANJ\n' +
      '--------------------------------------------------\n' +
      '• Analizirani period: ' + startYear + ' — ' + endYear + '\n' +
      '• Korišćeni indikator: ' + index + '\n\n' +
      '• Ukupna šuma ' + startYear + ': ' + Number(result.startForest).toFixed(2) + ' ha\n' +
      '  └🍂 Listopadne: ' + Number(result.startListopadne).toFixed(2) + ' ha\n' +
      '  └🌲 Četinarske: ' + Number(result.startCetinari).toFixed(2) + ' ha\n\n' +
      '• Ukupna šuma ' + endYear + ': ' + Number(result.endForest).toFixed(2) + ' ha\n' +
      '  └🍂 Listopadne: ' + Number(result.endListopadne).toFixed(2) + ' ha\n' +
      '  └🌲 Četinarske: ' + Number(result.endCetinari).toFixed(2) + ' ha\n\n' +
      '❌ Ukupan gubitak šuma (' + index + ' detekcija): ' + Number(result.loss).toFixed(2) + ' ha\n' +
      '✅ Ukupan prirast šuma: ' + Number(result.gain).toFixed(2) + ' ha\n' +
      '--------------------------------------------------\n' +
      '📈 NETO PROMENA: ' + Number(result.netChange).toFixed(2) + ' ha';

    statsText.setValue(text);
    statusLabel.setValue('✅ Analiza uspešno izvršena!');
  });

  updateLegend(index);
}


// =========================================================================
// 13. AUTOMATSKO RUKOVANJE DOGAĐAJIMA (LISTENERS)
// =========================================================================

startYearSelect.onChange(updateMap);
endYearSelect.onChange(updateMap);
startMonthSelect.onChange(updateMap);
endMonthSelect.onChange(updateMap);
indexSelect.onChange(updateMap);

// Inicijalizacija elemenata na radnoj površini
ui.root.insert(0, panel);
ui.root.add(legend);

// Pokretanje početnog prikaza
updateMap();
Map.centerObject(aoi, 12);


function getLayer(image, visParams) {
  return image.visualize(visParams).getMap();
}



