import ee
import json
import os
from flask import Flask, jsonify, render_template
from flask_cors import CORS
from asgiref.wsgi import WsgiToAsgi
import uvicorn

# 1. Inicijalizacija Earth Engine biblioteke (Prilagođeno za Render i lokalno)
ee_key_json = os.environ.get("EE_ACCOUNT_KEY")

if ee_key_json:
    # Ako je aplikacija na Renderu, učitavamo ključ iz Environment Variables
    info = json.loads(ee_key_json)
    credentials = ee.ServiceAccountCredentials(info['client_email'], key_data=ee_key_json)
    ee.Initialize(credentials=credentials, project='ee-sandraristanovic03')
else:
    # Ako si pokrenula lokalno na svom računaru, koristi klasičnu prijavu
    ee.Initialize(project='ee-sandraristanovic03')

app = Flask(__name__)
CORS(app)

# AOI (Area of Interest)
aoi = ee.FeatureCollection("projects/ee-sandraristanovic03/assets/granica")
aoi_geom = aoi.geometry()

S2 = 'COPERNICUS/S2_HARMONIZED'
DW = 'GOOGLE/DYNAMICWORLD/V1'


# ----------------------------
# CLOUD MASK + INDICATORS
# ----------------------------
def mask_s2(img):
    qa = img.select("QA60")
    cloud = qa.bitwiseAnd(1 << 10).eq(0)
    cirrus = qa.bitwiseAnd(1 << 11).eq(0)

    mask = cloud.And(cirrus)

    optical = img.select(['B2', 'B3', 'B4', 'B8', 'B12']).divide(10000)
    return optical.updateMask(mask)


def add_indices(img):
    ndvi = img.normalizedDifference(['B8', 'B4']).rename('NDVI')
    nbr = img.normalizedDifference(['B8', 'B12']).rename('NBR')

    savi = img.expression(
        '((NIR-RED)/(NIR+RED+0.5))*(1.5)',
        {'NIR': img.select('B8'), 'RED': img.select('B4')}
    ).rename('SAVI')

    evi = img.expression(
        '2.5*((NIR-RED)/(NIR+6*RED-7.5*BLUE+1))',
        {
            'NIR': img.select('B8'),
            'RED': img.select('B4'),
            'BLUE': img.select('B2')
        }
    ).rename('EVI')

    lai = evi.multiply(3.6).subtract(0.1).rename('LAI')

    return img.addBands([ndvi, nbr, savi, evi, lai])


# ----------------------------
# COMPOSITE FUNKCIJA
# ----------------------------
def get_composite(year):
    start = ee.Date.fromYMD(year, 6, 1)
    end = ee.Date.fromYMD(year, 9, 30)

    col = (ee.ImageCollection(S2)
           .filterBounds(aoi_geom)
           .filterDate(start, end)
           .map(mask_s2))

    img = col.median().clip(aoi_geom)
    return add_indices(img)


# ----------------------------
# FOREST MASK (Dynamic World)
# ----------------------------
def forest_mask(year):
    start = ee.Date.fromYMD(year, 1, 1)
    end = ee.Date.fromYMD(year, 12, 31)

    dw = (ee.ImageCollection(DW)
          .filterBounds(aoi_geom)
          .filterDate(start, end)
          .select('label')
          .mode())

    return dw.eq(1).rename("forest")


# ----------------------------
# DIFFERENCE
# ----------------------------
def difference(start_year, end_year, index):
    start_img = get_composite(start_year)
    end_img = get_composite(end_year)

    return end_img.select(index).subtract(
        start_img.select(index)
    )


# ----------------------------
# RUTA ZA STRANICU (HOME ROUTE)
# ----------------------------
@app.route("/")
def home():
    return render_template("index.html")


# ----------------------------
# API RUTE
# ----------------------------

# 1. Mapa razlike između dve godine
@app.route("/diff/<int:y1>/<int:y2>/<index>")
def diff(y1, y2, index):
    img = difference(y1, y2, index)

    mapid = img.getMapId({
        "min": -0.3,
        "max": 0.3,
        "palette": ["red", "white", "green"]
    })

    if 'tile_fetcher' in mapid:
        nadji_url = mapid['tile_fetcher'].url_format
    else:
        nadji_url = mapid.get('urlFormat') or mapid.get('url')

    return jsonify({'urlFormat': nadji_url})


# 2. Mapa jedne pojedinačne godine (Apsolutni indeks)
@app.route("/single/<int:year>/<index>")
def single_year_map(year, index):
    img = get_composite(year).select(index)

    vis_params = {"min": 0, "max": 0.8, "palette": ["#ece7f2", "#a6bdbb", "#2ca25f"]}

    if index == "NBR":
        vis_params = {"min": -0.2, "max": 0.7, "palette": ["#7a0177", "#f768a1", "#fbb4b9"]}
    elif index == "LAI":
        vis_params = {"min": 0, "max": 4.0, "palette": ["#f7fcb9", "#addd8e", "#31a354"]}

    mapid = img.getMapId(vis_params)

    if 'tile_fetcher' in mapid:
        nadji_url = mapid['tile_fetcher'].url_format
    else:
        nadji_url = mapid.get('urlFormat') or mapid.get('url')

    return jsonify({'urlFormat': nadji_url})


# 3. Statistika šumske površine
@app.route("/stats/<int:year>")
def stats(year):
    f = forest_mask(year)
    area = ee.Image.pixelArea().divide(10000).updateMask(f)

    result = area.reduceRegion(
        reducer=ee.Reducer.sum(),
        geometry=aoi_geom,
        scale=30,
        maxPixels=1e13
    )

    return jsonify(result.getInfo())


# 4. Vremenska serija za grafikon i tabelu (2016 - 2024)
@app.route("/timeseries")
def timeseries():
    godine = range(2016, 2025)
    rezultat = []

    for godina in godine:
        img = get_composite(godina)

        stats = img.select(['NDVI', 'NBR', 'SAVI', 'EVI', 'LAI']).reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=aoi_geom,
            scale=30,
            maxPixels=1e13
        )

        podaci_godina = stats.getInfo()
        podaci_godina['godina'] = godina
        rezultat.append(podaci_godina)

    return jsonify(rezultat)


# ----------------------------
# SERVER RUN
# ----------------------------
asgi_app = WsgiToAsgi(app)

if __name__ == "__main__":
    uvicorn.run("app:asgi_app", host="127.0.0.1", port=8000, reload=True)