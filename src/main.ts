import 'mapbox-gl/dist/mapbox-gl.css';
import "./style.css";
import mapboxgl from "mapbox-gl";

// config
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const ICELAND_BBOX = {
  south: 60.0,
  west: -30.0,
  north: 70.0,
  east: -10.0,
};

// map
const map = new mapboxgl.Map({
  container: "app",
  style: "mapbox://styles/mapbox/dark-v11",
  center: [-18.5, 65.0],
  zoom: 4.5,
  pitch: 30,
  bearing: 0,
});

map.on("load", async () => {
  // Add empty sources and layers for flight points
  map.addSource("flights", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  // outer glow for aircraft
  map.addLayer({
    id: "flight-glow",
    type: "circle",
    source: "flights",
    paint: {
      "circle-radius": 12,
      "circle-color": "#00ffff",
      "circle-opacity": 0.2,
      "circle-blur": 0.5,
    },
  });

  // main aircraft
  map.addLayer({
    id: "flight-points",
    type: "circle",
    source: "flights",
    paint: {
      "circle-radius": 6,
      "circle-color": "#00ffff",
      "circle-opacity": 0.9,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
    },
  });

  // callsigns
  map.addLayer({
    id: "flight-labels",
    type: "symbol",
    source: "flights",
    layout: {
      "text-field": ["get", "callsign"],
      "text-size": 11,
      "text-offset": [0, 1.5],
      "text-anchor": "top",
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#000000",
      "text-halo-width": 1,
    },
  });

  // fetch and ani
  await loadAndAnimateLast24h();
});

// types
interface StateVector {
  time: number;
  icao24: string;
  lat: number;
  lon: number;
  velocity: number;
  heading: number;
  vertrate: number;
  callsign: string;
  onground: boolean;
  alert: boolean;
  spi: boolean;
  squawk: string;
  baroaltitude: number;
  geoaltitude: number;
  lastposupdate: number;
  lastcontact: number;
}

//Main
async function loadAndAnimateLast24h() {
  console.log("Loading flight data from local file...");

  //Load from downlaoded json fiel (need to this update each time they give out a new file)
  const dataFile = '/data/iceland-flights-2025-12-01.json';

  try {
    const response = await fetch(dataFile);
    if (!response.ok) {
      throw new Error(`Failed to load data file: ${response.statusText}`);
    }

    const data = await response.json();
    const allStates: StateVector[] = data.states;

    console.log(`Loaded ${allStates.length} state vectors from ${data.date}`);

    if (allStates.length === 0) {
      console.log("No flight data found");
      return;
    }

    //time sort
    allStates.sort((a, b) => a.time - b.time);

    const minTime = allStates[0].time;
    const maxTime = allStates[allStates.length - 1].time;
    const duration = maxTime - minTime;

    console.log(`Starting animation: ${duration}s of real time compressed to 60s`);

    // loop animation
    const animationDurationMs = 60_000; // 60 seconds for full 24h replay
    let startTime = performance.now();

    function animate(time: number) {
      const elapsed = (time - startTime) % animationDurationMs;
      const progress = elapsed / animationDurationMs;
      const currentTime = minTime + progress * duration;

      // get all state vectors within a time window around current time, 10 minutes
      const timeWindow = 600;
      const currentStates = allStates.filter(
        s => s.time >= currentTime - timeWindow && s.time <= currentTime
      );

      // Group by aircraft to show latest position
      const latestByAircraft = new Map<string, StateVector>();
      for (const state of currentStates) {
        const existing = latestByAircraft.get(state.icao24);
        if (!existing || state.time > existing.time) {
          latestByAircraft.set(state.icao24, state);
        }
      }

      // Create GeoJSON features?
      const features: GeoJSON.Feature<GeoJSON.Point>[] = Array.from(latestByAircraft.values())
        .map(state => ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [state.lon, state.lat],
          },
          properties: {
            callsign: state.callsign,
            velocity: state.velocity,
            heading: state.heading,
            altitude: state.geoaltitude,
            icao24: state.icao24,
          },
        }));

      (map.getSource("flights") as mapboxgl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features,
      });

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
  } catch (error) {
    console.error("Failed to load flight data:", error);
  }
}