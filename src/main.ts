import 'mapbox-gl/dist/mapbox-gl.css';
import "./style.css";
import mapboxgl from "mapbox-gl";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

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
  // Þegar map buið að loada þá:
  const planeIcon = new Image(30, 30);
  planeIcon.onload = () => map.addImage("plane-icon", planeIcon);
  planeIcon.src = "data:image/svg+xml;base64," + btoa(`
    <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 2 L12 8 L18 9 L12 10 L10 18 L8 10 L2 9 L8 8 Z"
            fill="white" stroke="white" stroke-width="0.5"/>
    </svg>
  `);

  // Empty container for plane position
  map.addSource("flights", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  // Empty container for lines behind plain
  map.addSource("flight-trails", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  // lines style after plain
  map.addLayer({
    id: "flight-trails-layer",
    type: "line",
    source: "flight-trails",
    paint: {
      "line-color": ["get", "color"],
      "line-width": 2,
      "line-opacity": 0.6,
    },
  });

  // glow around aircraft
  map.addLayer({
    id: "flight-glow",
    type: "circle",
    source: "flights",
    paint: {
      "circle-radius": 12,
      "circle-color": ["get", "color"],
      "circle-opacity": 0.2,
      "circle-blur": 0.5,
    },
  });

  // rotate plain by direction
  map.addLayer({
    id: "flight-points",
    type: "symbol",
    source: "flights",
    layout: {
      "icon-image": "plane-icon",
      "icon-size": 0.8,
      "icon-rotate": ["get", "heading"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-opacity": 0.9,
    },
  });

  // callsigns
  map.addLayer({
    id: "flight-labels",
    type: "symbol",
    source: "flights",
    layout: {
      "text-field": ["get", "callsign"],
      "text-size": 20,
      "text-offset": [0, 2],
      "text-anchor": "top",
      "text-allow-overlap": false,
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

// Helper to generate colors for different aircraft
function getColorForAircraft(icao24: string): string {
  const colors = [
    "#00ffff", // cyan
    "#0088ff", // blue
    "#8800ff", // purple
    "#ff00ff", // magenta
    "#00ff88", // teal
    "#ffaa00", // orange
    "#ff0088", // pink
  ];

  // Simple hash to assign consistent color per aircraft
  let hash = 0;
  for (let i = 0; i < icao24.length; i++) {
    hash = icao24.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
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

    // Track flight paths for trails
    const flightPaths = new Map<string, Array<{lon: number, lat: number, time: number}>>();

    // loop animation
    const animationDurationMs = 60_000;
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

      // Update plain paths for trails
      for (const state of currentStates) {
        if (!flightPaths.has(state.icao24)) {
          flightPaths.set(state.icao24, []);
        }
        const path = flightPaths.get(state.icao24)!;

        //add point if new or different from last point
        if (path.length === 0 ||
            path[path.length - 1].lon !== state.lon ||
            path[path.length - 1].lat !== state.lat) {
          path.push({ lon: state.lon, lat: state.lat, time: state.time });

          // Keep trail limited to recent positions (e.g., last 30 points)
          if (path.length > 30) {
            path.shift();
          }
        }
      }

      // Clean up old plains that are no longer visible
      const activeIcao24s = new Set(latestByAircraft.keys());
      for (const icao24 of flightPaths.keys()) {
        if (!activeIcao24s.has(icao24)) {
          flightPaths.delete(icao24);
        }
      }

      //Geojson features for aircraft points
      
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
            color: getColorForAircraft(state.icao24),
          },
        }));

      // geojson features for flight trails

      const trailFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      for (const [icao24, path] of flightPaths.entries()) {
        if (path.length >= 2) {
          trailFeatures.push({
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: path.map(p => [p.lon, p.lat]),
            },
            properties: {
              icao24,
              color: getColorForAircraft(icao24),
            },
          });
        }
      }

      (map.getSource("flights") as mapboxgl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features,
      });

      (map.getSource("flight-trails") as mapboxgl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: trailFeatures,
      });

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
  } catch (error) {
    console.error("Failed to load flight data:", error);
  }
}