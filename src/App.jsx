import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  MapPin, Search, Loader, X, Layers, AlertTriangle, 
  CheckCircle, ChevronRight, Info, Leaf, Droplets, Sprout,
  TrendingUp, Activity, BarChart3, PieChart, MapPinned, TestTube,
  Menu, ArrowLeft
} from 'lucide-react';

// ✅ CONFIGURATION
const API_ENDPOINT = "https://crop-detection-dcecevhvh5ard2ah.eastus-01.azurewebsites.net/api/analyze_field";
const CURRENT_YEAR = 2022;
const PMTILES_2022 = "pmtiles://https://satelliteimages.blob.core.windows.net/pmt-tiles/crop_2022.pmtiles";

// --- RESOURCE LOADER ---
const loadMapResources = () => {
  return new Promise(async (resolve, reject) => {
    if (window.maplibregl && window.pmtiles) return resolve();

    const loadScript = (src) => new Promise((res, rej) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (src.includes('maplibre') && window.maplibregl) return res();
        if (src.includes('pmtiles') && window.pmtiles) return res();
        existing.addEventListener('load', res);
        existing.addEventListener('error', rej);
        return;
      }
      const s = document.createElement('script'); 
      s.src = src; s.async = true; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });

    const loadStyles = (href) => {
      if (document.querySelector(`link[href="${href}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      document.head.appendChild(link);
    };

    try {
      loadStyles('https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css');
      await Promise.all([
        loadScript('https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js'),
        loadScript('https://unpkg.com/pmtiles@3.0.5/dist/pmtiles.js')
      ]);
      resolve();
    } catch (err) { reject(err); }
  });
};

// --- DATA HELPERS ---
const getTextureClass = (sand, clay) => {
  const s = sand || 0;
  const c = clay || 0;
  if (s + c === 0) return "Unknown";
  if (c >= 40) return "Clay";
  if (s > 45) return "Sandy Loam";
  return "Loam";
};

// ✅ FIX: Robust Health Score (Prevents "0" Score Crash)
const getHealthScore = (soil) => {
  // If soil is missing, return null so we can handle it gracefully
  if (!soil) return null;
  
  // Use backend data OR safe defaults
  const ph = soil.ph || 6.5; 
  const soc = soil.soc || 20; 
  const nitrogen = soil.nitrogen || 2.5;

  let score = 100;
  const issues = [];
  const strengths = [];

  // 1. pH Check
  if (ph < 6.0) { 
      score -= 15; 
      issues.push({ message: `Acidic Soil (pH ${ph.toFixed(1)})`, severity: "medium" }); 
  } else if (ph > 7.5) { 
      score -= 15; 
      issues.push({ message: `Alkaline Soil (pH ${ph.toFixed(1)})`, severity: "medium" }); 
  } else { 
      strengths.push({ message: "pH is in optimal range" }); 
  }

  // 2. SOC Check
  if (soc < 15) { 
      score -= 20; 
      issues.push({ message: "Low organic matter", severity: "high" }); 
  } else { 
      strengths.push({ message: "Good organic matter" }); 
  }

  // 3. Nitrogen Check
  if (nitrogen < 2.0) { 
      score -= 15; 
      issues.push({ message: "Low Nitrogen", severity: "medium" }); 
  }
  
  return { score: Math.max(0, score), issues, strengths };
};

const getFertilizerPlan = (soil) => {
  if (!soil) return [];
  const plan = [];
  const ph = soil.ph || 6.5;
  const nitrogen = soil.nitrogen || 2.5;
  
  if (nitrogen < 2.0) plan.push({ 
      nutrient: "Nitrogen (N)", priority: "HIGH", amount: "80-100 lbs/ac", 
      fertilizer: "Urea (46-0-0)", current: nitrogen.toFixed(2), 
      target: "3.5", timing: "Split application at planting" 
  });
  
  if (ph < 6.0 && ph > 0) plan.push({ 
      nutrient: "pH Adjustment", priority: "HIGH", amount: "2-3 tons/ac", 
      fertilizer: "Ag Limestone", current: ph.toFixed(1), 
      target: "6.5", timing: "Fall application" 
  });
  
  return plan;
};

// --- MAIN COMPONENT ---
const CropDashboard = () => {
  const [address, setAddress] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [fieldData, setFieldData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const mapContainer = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const searchTimeout = useRef(null);
  const popup = useRef(null);
  const mapInitialized = useRef(false);

  // ✅ COMPLETE CROP LOOKUP LIST (Expanded for clarity)
  const CROP_LOOKUP = {
    1: 'Corn', 
    2: 'Cotton', 
    3: 'Rice', 
    4: 'Sorghum', 
    5: 'Soybeans', 
    6: 'Sunflower',
    10: 'Peanuts', 
    11: 'Tobacco', 
    12: 'Sweet Corn', 
    13: 'Pop/Orn Corn', 
    14: 'Mint',
    21: 'Barley', 
    22: 'Durum Wheat', 
    23: 'Spring Wheat', 
    24: 'Winter Wheat', 
    25: 'Other Small Grains', 
    26: 'Dbl Crop WinWht/Soybeans', 
    27: 'Rye', 
    28: 'Oats', 
    29: 'Millet', 
    30: 'Speltz', 
    31: 'Canola', 
    32: 'Flaxseed', 
    33: 'Safflower', 
    34: 'Rape Seed', 
    35: 'Mustard', 
    36: 'Alfalfa', 
    37: 'Other Hay/Non Alfalfa',
    41: 'Sugarbeets', 
    42: 'Dry Beans', 
    43: 'Potatoes', 
    44: 'Other Crops', 
    45: 'Sugarcane', 
    46: 'Sweet Potatoes', 
    47: 'Misc Vegs & Fruits', 
    48: 'Watermelons', 
    49: 'Onions', 
    50: 'Cucumbers', 
    51: 'Chick Peas', 
    52: 'Lentils', 
    53: 'Peas', 
    54: 'Tomatoes', 
    55: 'Caneberries', 
    56: 'Hops', 
    57: 'Herbs', 
    58: 'Clover/Wildflowers', 
    59: 'Sod/Grass Seed', 
    60: 'Switchgrass', 
    61: 'Fallow/Idle Cropland', 
    63: 'Forest', 
    64: 'Shrubland', 
    65: 'Barren', 
    66: 'Cherries', 
    67: 'Peaches', 
    68: 'Apples', 
    69: 'Grapes', 
    70: 'Christmas Trees', 
    71: 'Other Tree Crops', 
    72: 'Citrus', 
    74: 'Pecans', 
    75: 'Almonds', 
    76: 'Walnuts', 
    77: 'Pears', 
    111: 'Open Water', 
    121: 'Developed/Open Space', 
    122: 'Developed/Low Intensity', 
    123: 'Developed/Med Intensity', 
    124: 'Developed/High Intensity', 
    152: 'Shrubland', 
    176: 'Grassland/Pasture', 
    190: 'Woody Wetlands', 
    195: 'Herbaceous Wetlands', 
    204: 'Pistachios', 
    205: 'Triticale', 
    206: 'Carrots', 
    207: 'Asparagus', 
    208: 'Garlic', 
    209: 'Cantaloupes', 
    210: 'Prunes', 
    211: 'Olives', 
    212: 'Oranges', 
    213: 'Honeydew Melons', 
    214: 'Broccoli', 
    216: 'Peppers', 
    217: 'Pomegranates', 
    218: 'Nectarines', 
    219: 'Greens', 
    220: 'Plums', 
    221: 'Strawberries', 
    222: 'Squash', 
    223: 'Apricots', 
    224: 'Vetch', 
    225: 'Dbl Crop WinWht/Corn', 
    226: 'Dbl Crop Oats/Corn', 
    227: 'Lettuce', 
    228: 'Dbl Crop Triticale/Corn', 
    229: 'Pumpkins', 
    230: 'Dbl Crop Lettuce/Durum Wht', 
    231: 'Dbl Crop Lettuce/Cantaloupe', 
    232: 'Dbl Crop Lettuce/Cotton', 
    233: 'Dbl Crop Lettuce/Barley', 
    234: 'Dbl Crop Durum Wht/Sorghum', 
    235: 'Dbl Crop Barley/Sorghum', 
    236: 'Dbl Crop WinWht/Sorghum', 
    237: 'Dbl Crop Barley/Corn', 
    238: 'Dbl Crop WinWht/Cotton', 
    239: 'Dbl Crop Soybeans/Cotton', 
    240: 'Dbl Crop Soybeans/Oats', 
    241: 'Dbl Crop Corn/Soybeans', 
    242: 'Blueberries', 
    243: 'Cabbage', 
    244: 'Cauliflower', 
    245: 'Celery', 
    246: 'Radishes', 
    247: 'Turnips', 
    248: 'Eggplants', 
    249: 'Gourds', 
    250: 'Cranberries', 
    254: 'Dbl Crop Barley/Soybeans'
  };
  
  const cropColors = { 
    '1': '#F4D03F', '5': '#229954', '24': '#A04000', '36': '#2ECC71', 
    '176': '#CDDC39', '61': '#BDBDBD', '66': '#C2185B', '69': '#7B1FA2', 
    '75': '#D7CCC8', '77': '#AED581', '228': '#546E7A', '33': '#FF5722',
    '71': '#BCAAA4', '204': '#009688', '212': '#FF9800', '250': '#C0392B',
    '2': '#FFFFFF', '3': '#00A8E1', '4': '#FF9E0A', '6': '#FFFF00',
    '12': '#F7DC6F', '21': '#D35400', '23': '#A04000', '28': '#8c9eff',
    '37': '#9CCC65', '43': '#FFCC80', '54': '#F44336', '76': '#795548',
    '111': '#4FC3F7', '121': '#ECEFF1', '122': '#CFD8DC', 
    '190': '#7CB342', '195': '#81C784'
  };

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const fetchAnalysisFromAzure = async (lat, lon, cropName, currentProps) => {
    setLoading(true); 
    setShowAnalytics(true);
    if (isMobile) setIsMobileMenuOpen(false);

    try {
      const response = await fetch(`${API_ENDPOINT}?lat=${lat}&lon=${lon}`);
      if (!response.ok) throw new Error(`Server Error: ${response.statusText}`);
      const data = await response.json();
      const history = data.history || {};
      history[CURRENT_YEAR] = { crop: cropName, code: currentProps.CROP_TYPE, acres: currentProps.CSBACRES };
      
      // ✅ FIX: Ensure soil object exists
      const soil = data.soil || { ph: 6.5, soc: 20, nitrogen: 2.5, clay: 25, sand: 35 };
      
      // ✅ FIX: Silt Calculation
      if (soil.silt === undefined) {
        soil.silt = Math.max(0, 100 - (soil.sand || 0) - (soil.clay || 0));
      }

      setFieldData({
        cropName: cropName, 
        county: currentProps.CNTY, 
        acres: currentProps.CSBACRES,
        history: history, 
        soil: soil, 
        recommendations: data.recommendations || [], 
        texture: getTextureClass(soil.sand, soil.clay),
        healthData: getHealthScore(soil), // Using fixed function
        fertilizerPlan: getFertilizerPlan(soil), 
        location: { lat, lon }
      });
    } catch (error) {
      console.error("Analysis Error:", error);
      alert("Analysis failed.");
    } finally { setLoading(false); }
  };

  const handleMapClick = useCallback((e) => {
    if (!map.current) return;
    const features = map.current.queryRenderedFeatures(e.point, { layers: ['visual-layer'] });
    if (!features || !features[0]) return;
    
    const props = features[0].properties;
    const lat = e.lngLat.lat;
    const lon = e.lngLat.lng;
    const cropName = CROP_LOOKUP[props.CROP_TYPE] || "Unknown";
    const acres = props.CSBACRES ? parseFloat(props.CSBACRES).toFixed(2) : "N/A";

    if (popup.current) popup.current.remove();

    const popupContent = document.createElement('div');
    popupContent.style.padding = '16px';
    popupContent.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    popupContent.innerHTML = `
        <h3 style="margin:0 0 12px 0; color:#1e293b; font-size:18px; font-weight:700;">${cropName}</h3>
        <div style="display:flex; flex-direction:column; gap:6px; font-size:13px; color:#64748b; margin-bottom:16px;">
        <div><strong style="color:#475569;">Acres:</strong> ${acres}</div>
        <div><strong style="color:#475569;">County:</strong> ${props.CNTY || 'N/A'}</div>
        </div>
    `;

    const btn = document.createElement('button');
    btn.innerText = "Run Field Analysis";
    btn.style.width = '100%';
    btn.style.padding = '12px 16px';
    btn.style.background = '#1e40af';
    btn.style.color = 'white';
    btn.style.border = 'none';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
    btn.style.fontWeight = '600';
    btn.style.fontSize = '14px';
    
    btn.onclick = (event) => {
        event.preventDefault(); 
        fetchAnalysisFromAzure(lat, lon, cropName, props);
    };

    popupContent.appendChild(btn);

    popup.current = new window.maplibregl.Popup({ closeButton: true, maxWidth: '320px', className: 'custom-popup' })
      .setLngLat(e.lngLat)
      .setDOMContent(popupContent)
      .addTo(map.current);
  }, []);

  const handleAddressChange = (val) => {
    setAddress(val);
    if (val.length < 3) { setShowSuggestions(false); return; }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    setIsSearching(true);
    
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&countrycodes=us&limit=8&addressdetails=1`, { headers: { 'User-Agent': 'CropDashboard/1.0' } });
        const data = await res.json();
        const ranked = Array.isArray(data) ? data.map(item => {
          let score = 0;
          if (item.display_name.toLowerCase().startsWith(val.toLowerCase())) score += 100;
          return { ...item, rankScore: score };
        }).sort((a, b) => b.rankScore - a.rankScore).slice(0, 5) : [];
        setSuggestions(ranked);
        setShowSuggestions(ranked.length > 0);
      } catch(e) { setSuggestions([]); } finally { setIsSearching(false); }
    }, 400);
  };

  const selectSuggestion = (sug) => {
    setAddress(sug.display_name.split(',')[0]); 
    setShowSuggestions(false);
    if (!map.current) return;

    const lat = parseFloat(sug.lat); 
    const lon = parseFloat(sug.lon);
    
    if(marker.current) marker.current.remove();
    marker.current = new window.maplibregl.Marker({ color: '#ef4444' }).setLngLat([lon, lat]).addTo(map.current);
    map.current.flyTo({ center: [lon, lat], zoom: 15, duration: 2000 });
    if (isMobile) setIsMobileMenuOpen(false);
  };

  useEffect(() => {
    let isMounted = true;

    const initMap = async () => {
      if (mapInitialized.current) return;
      try { await loadMapResources(); } catch (e) { return; }
      
      if (!isMounted || !mapContainer.current) return;
      if (!window.maplibregl || !window.pmtiles) return;

      if (!window.maplibregl.config?.REGISTERED_PROTOCOLS?.pmtiles) {
         try {
             const protocol = new window.pmtiles.Protocol();
             window.maplibregl.addProtocol("pmtiles", protocol.tile);
         } catch (e) { console.log("Protocol likely already added"); }
      }

      mapInitialized.current = true;

      map.current = new window.maplibregl.Map({
        container: mapContainer.current,
        center: [-98.5795, 39.8283],
        zoom: 4,
        maxTileCacheSize: isMobile ? 0 : 4, 
        pixelRatio: isMobile ? Math.min(window.devicePixelRatio, 1.5) : window.devicePixelRatio,
        fadeDuration: 0, attributionControl: false,
        style: {
          version: 8,
          sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, volatile: true } },
          layers: [{ id: "osm", type: "raster", source: "osm" }]
        }
      });
      
      map.current.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'top-right');

      map.current.on('load', () => {
        if (!map.current) return;
        
        map.current.addSource("crops2022", { type: "vector", url: PMTILES_2022, maxzoom: 11, promoteId: "CROP_TYPE" });
        map.current.addLayer({
          id: "visual-layer", type: "fill", source: "crops2022", "source-layer": `crops${CURRENT_YEAR}`, 
          paint: { "fill-color": [ "match", ["to-string", ["get", "CROP_TYPE"]], ...Object.entries(cropColors).flat(), "rgba(0, 0, 0, 0)" ], "fill-opacity": 0.75 }
        });
        
        map.current.on('click', handleMapClick); 
        map.current.on('mousemove', 'visual-layer', () => { if (map.current) map.current.getCanvas().style.cursor = 'pointer'; });
        map.current.on('mouseleave', 'visual-layer', () => { if (map.current) map.current.getCanvas().style.cursor = ''; });

        const params = new URLSearchParams(window.location.search);
        const urlAddress = params.get('Address');
        
        if (urlAddress) {
          setAddress(urlAddress); 
          setIsSearching(true);

          fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(urlAddress)}&countrycodes=us&limit=1`, {
            headers: { 'User-Agent': 'CropDashboard/1.0' }
          })
          .then(res => res.json())
          .then(data => {
            if (data && data.length > 0) {
              const bestMatch = data[0];
              const lat = parseFloat(bestMatch.lat); 
              const lon = parseFloat(bestMatch.lon);
              
              if (map.current) {
                if(marker.current) marker.current.remove();
                marker.current = new window.maplibregl.Marker({ color: '#ef4444' }).setLngLat([lon, lat]).addTo(map.current);
                map.current.flyTo({ center: [lon, lat], zoom: 15, duration: 2000 });
              }
            }
          })
          .catch(e => console.error("Auto-zoom API error", e))
          .finally(() => setIsSearching(false));
        }
      });
    };

    initMap();

    return () => {
      isMounted = false;
      if (map.current) { map.current.remove(); map.current = null; mapInitialized.current = false; }
    };
  }, []);

  return (
    <div className="app-root">
      {isMobile && (
        <div className="mobile-header">
           <div className="mh-left"><Layers size={24} color="white" /><span className="mobile-title">CropAnalytics</span></div>
           <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>{isMobileMenuOpen ? <X color="white" /> : <Menu color="white" />}</button>
        </div>
      )}
      <div className={`sidebar ${isMobile ? 'mobile-sidebar' : ''} ${isMobile && !isMobileMenuOpen ? 'hidden' : ''}`}>
        {!isMobile && (
            <div className="sidebar-header"><Layers size={28} strokeWidth={2.5} /><div className="header-text"><h1>Crop & Soil Analytics</h1></div></div>
        )}
        <div className="sidebar-content">
          <div className="search-section">
            <label className="section-label"><MapPin size={14} /><span>Find Location</span></label>
            <div className="search-box">
              <Search className="search-icon" size={18} />
              <input type="text" placeholder="Search..." value={address} onChange={(e) => handleAddressChange(e.target.value)} onFocus={() => suggestions?.length > 0 && setShowSuggestions(true)} />
              {address && !isSearching && (<X className="clear-icon" size={18} onClick={() => { setAddress(''); setShowSuggestions(false); }} />)}
              {isSearching && <Loader className="spin" size={14} />}
            </div>
            {showSuggestions && suggestions?.length > 0 && (
              <div className="suggestions-dropdown">
                {suggestions.map((sug, i) => (
                  <div key={i} className="suggestion-item" onClick={() => selectSuggestion(sug)}>
                    <MapPin size={16} className="sug-icon" />
                    <div className="sug-text">
                      <div className="sug-primary">{sug.display_name.split(',')[0]}</div>
                      <div className="sug-secondary">{sug.display_name.split(',').slice(1, 3).join(',')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="legend-section">
            <label className="section-label"><Layers size={14} /><span>Crop Legend (2022)</span></label>
            <div className="legend-grid">
              {Object.entries(cropColors).map(([code, color]) => (
                <div key={code} className="legend-item"><span className="legend-dot" style={{background: color}}></span><span className="legend-text">{CROP_LOOKUP[code]}</span></div>
              ))}
            </div>
          </div>
        </div>
        <div className="sidebar-footer"><span>Azure Maps • USDA Data • OpenStreetMap</span></div>
      </div>

      <div className="map-wrapper"><div ref={mapContainer} className="map-container" /></div>

      <div className={`drawer ${showAnalytics ? 'open' : ''}`}>
        <button className="close-btn" onClick={() => setShowAnalytics(false)}>{isMobile ? <ArrowLeft size={20} /> : <X size={20} />}</button>
        
        {loading ? (
          <div className="loading-state"><Loader className="spin" size={48} /><p className="loading-title">Analyzing Field</p><span className="loading-subtitle">Fetching soil data...</span></div>
        ) : fieldData ? (
          <div className="drawer-content">
            <div className="drawer-header">
              <div className="header-top"><h2 className="crop-title">{fieldData.cropName}</h2><span className="texture-badge">{fieldData.texture} Soil</span></div>
              <div className="header-meta"><MapPinned size={14} /><span>{fieldData.location.lat.toFixed(4)}°, {fieldData.location.lon.toFixed(4)}°</span><span style={{margin:'0 4px'}}>•</span><span>{fieldData.acres} Acres</span></div>
            </div>

            {/* ✅ FIXED: Soil Health Card with safe check */}
            {fieldData.healthData && fieldData.healthData.score != null && (
              <div className="card health-card">
                <div className="card-title"><Activity size={18} /><span>Soil Health Analysis</span></div>
                <div className="health-content">
                  <div className="health-circle" style={{borderColor: fieldData.healthData.score > 75 ? '#10b981' : fieldData.healthData.score > 50 ? '#f59e0b' : '#ef4444'}}>
                    <span className="health-score">{fieldData.healthData.score.toFixed(0)}</span>
                    <span className="health-label">{fieldData.healthData.score > 75 ? 'Excellent' : fieldData.healthData.score > 50 ? 'Fair' : 'Poor'}</span>
                  </div>
                  <div className="health-details">
                    {fieldData.healthData.strengths?.map((s, i) => (<div key={i} className="health-item success"><CheckCircle size={14} /><span>{s.message}</span></div>))}
                    {fieldData.healthData.issues?.map((issue, i) => (<div key={i} className="health-item warning"><AlertTriangle size={14} /><span>{issue.message}</span></div>))}
                  </div>
                </div>
              </div>
            )}

            {fieldData.soil && (
              <div className="card">
                <div className="card-title"><PieChart size={18} /><span>Soil Composition </span></div>
                <div className="composition-pie">
                  <svg viewBox="0 0 200 200" className="pie-chart">
                    {(() => {
                      const total = (fieldData.soil.sand || 0) + (fieldData.soil.clay || 0) + (fieldData.soil.silt || 0);
                      if (total === 0) return null;
                      
                      let currentAngle = -90;
                      const colors = ['#f59e0b', '#a16207', '#78350f'];
                      return [fieldData.soil.sand, fieldData.soil.silt, fieldData.soil.clay].map((val, i) => {
                        const percent = (val / total) * 100;
                        const angle = (percent / 100) * 360;
                        const endAngle = currentAngle + angle;
                        const x1 = 100 + 80 * Math.cos((currentAngle * Math.PI) / 180);
                        const y1 = 100 + 80 * Math.sin((currentAngle * Math.PI) / 180);
                        const x2 = 100 + 80 * Math.cos((endAngle * Math.PI) / 180);
                        const y2 = 100 + 80 * Math.sin((endAngle * Math.PI) / 180);
                        const largeArc = angle > 180 ? 1 : 0;
                        const path = `M 100 100 L ${x1} ${y1} A 80 80 0 ${largeArc} 1 ${x2} ${y2} Z`;
                        currentAngle = endAngle;
                        return <path key={i} d={path} fill={colors[i]} stroke="white" strokeWidth="1" />;
                      });
                    })()}
                  </svg>
                  <div className="pie-legend">
                    <div className="pie-legend-item"><span className="pie-dot" style={{background: '#f59e0b'}}></span><span>Sand: {fieldData.soil.sand?.toFixed(1) || 0}%</span></div>
                    <div className="pie-legend-item"><span className="pie-dot" style={{background: '#a16207'}}></span><span>Silt: {fieldData.soil.silt?.toFixed(1) || 0}%</span></div>
                    <div className="pie-legend-item"><span className="pie-dot" style={{background: '#78350f'}}></span><span>Clay: {fieldData.soil.clay?.toFixed(1) || 0}%</span></div>
                  </div>
                </div>
                <div className="metrics-grid">
                  <div className="metric-box"><Droplets size={18} className="metric-icon" style={{color: '#3b82f6'}} /><div className="metric-content"><span className="metric-label">pH Level</span><span className="metric-value">{fieldData.soil.ph?.toFixed(1) || '-'}</span></div></div>
                  <div className="metric-box"><Leaf size={18} className="metric-icon" style={{color: '#10b981'}} /><div className="metric-content"><span className="metric-label">Carbon</span><span className="metric-value">{fieldData.soil.soc?.toFixed(1) || '-'} g/kg</span></div></div>
                  <div className="metric-box"><Sprout size={18} className="metric-icon" style={{color: '#f59e0b'}} /><div className="metric-content"><span className="metric-label">Nitrogen</span><span className="metric-value">{fieldData.soil.nitrogen?.toFixed(2) || '-'} g/kg</span></div></div>
                </div>
              </div>
            )}

            {fieldData.fertilizerPlan?.length > 0 && (
              <div className="card">
                <div className="card-title"><TestTube size={18} /><span>Fertilizer Recommendations</span></div>
                <div className="fertilizer-list">
                  {fieldData.fertilizerPlan.map((plan, i) => (
                    <div key={i} className="fertilizer-item">
                      <div className="fert-header"><span className="fert-nutrient">{plan.nutrient}</span><span className={`priority-badge ${plan.priority.toLowerCase()}`}>{plan.priority}</span></div>
                      <div className="fert-details">
                        <div className="fert-row"><span className="fert-label">Current:</span><span className="fert-value">{plan.current}</span></div>
                        <div className="fert-row"><span className="fert-label">Target:</span><span className="fert-value">{plan.target}</span></div>
                      </div>
                      <div className="fert-recommendation"><p><strong>Apply:</strong> {plan.amount} of {plan.fertilizer}</p><p className="fert-timing"><strong>Timing:</strong> {plan.timing}</p></div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {fieldData.recommendations?.length > 0 && (
              <div className="card">
                <div className="card-title"><TrendingUp size={18} /><span>Best Crop Matches</span></div>
                <div className="crop-recommendations">
                  {fieldData.recommendations.slice(0, 5).map((rec, i) => (
                    <div key={i} className="crop-rec-item">
                      <div className="rec-rank">#{i + 1}</div>
                      <div className="rec-info"><span className="rec-name">{rec.name}</span><span className="rec-reason">{rec.reason || 'Suitable for soil conditions'}</span></div>
                      <div className="rec-score" style={{background: rec.score > 80 ? '#dcfce7' : rec.score > 60 ? '#fef3c7' : '#fee2e2', color: rec.score > 80 ? '#166534' : rec.score > 60 ? '#92400e' : '#991b1b'}}>{rec.score.toFixed(0)}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {fieldData.history && Object.keys(fieldData.history).length > 0 && (
              <div className="card">
                <div className="card-title"><Leaf size={18} /><span>Crop Rotation History </span></div>
                <div className="timeline">
                  {Object.entries(fieldData.history).sort(([a], [b]) => parseInt(b) - parseInt(a)).map(([year, info]) => (
                      <div key={year} className="timeline-item">
                        <div className="timeline-year">{year}</div>
                        <div className="timeline-content">
                          <div className="timeline-bar" style={{background: cropColors[info.code] || '#e5e7eb', borderLeft: `4px solid ${cropColors[info.code] ? '#00000033' : '#9ca3af'}`}}>
                            <span className="timeline-crop">{info.crop}</span>{info.acres && (<span className="timeline-acres">{parseFloat(info.acres).toFixed(0)} ac</span>)}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body, html { width: 100%; height: 100%; overflow: hidden; }
        .app-root { display: flex; width: 100vw; height: 100vh; background: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'SF Pro Display', Roboto, sans-serif; }
        .sidebar { width: 340px; height: 100vh; flex-shrink: 0; background: white; z-index: 20; box-shadow: 2px 0 16px rgba(0,0,0,0.08); display: flex; flex-direction: column; transition: transform 0.3s ease; }
        .sidebar-header { padding: 24px 20px; background: linear-gradient(135deg, #1a237e 0%, #283593 100%); color: white; display: flex; align-items: center; gap: 12px; }
        .sidebar-header h1 { font-size: 20px; font-weight: 700; margin: 0; letter-spacing: -0.02em; }
        .sidebar-content { flex: 1; overflow-y: auto; padding: 20px; }
        .search-section { margin-bottom: 24px; }
        .search-section label { display: flex; gap: 6px; align-items: center; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 10px; }
        .search-box { display: flex; align-items: center; gap: 8px; border: 2px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; background: white; transition: all 0.2s; }
        .search-box:focus-within { border-color: #1a237e; box-shadow: 0 0 0 3px rgba(26, 35, 126, 0.1); }
        .search-box input { border: none; background: transparent; flex: 1; outline: none; font-size: 14px; color: #1e293b; }
        .search-box input::placeholder { color: #94a3b8; }
        .search-icon { color: #64748b; flex-shrink: 0; }
        .clear-icon { cursor: pointer; color: #94a3b8; flex-shrink: 0; transition: color 0.2s; }
        .clear-icon:hover { color: #ef4444; }
        .suggestions-dropdown { margin-top: 8px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: white; box-shadow: 0 10px 40px rgba(0,0,0,0.12); max-height: 400px; overflow-y: auto; }
        .suggestion-item { padding: 14px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #f1f5f9; transition: background 0.15s; }
        .suggestion-item:last-child { border-bottom: none; }
        .suggestion-item:hover { background: #f8fafc; }
        .sug-icon { font-size: 20px; flex-shrink: 0; color: #64748b; }
        .sug-text { flex: 1; min-width: 0; }
        .sug-primary { font-size: 14px; font-weight: 500; color: #1e293b; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sug-secondary { font-size: 12px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .legend-section { margin-top: 24px; }
        .legend-section label { display: flex; gap: 6px; align-items: center; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 10px; }
        .legend-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .legend-item { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #475569; padding: 6px 0; }
        .legend-dot { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); }
        .legend-text { font-size: 12px; color: #4b5563; font-weight: 500; }
        .sidebar-footer { padding: 16px 20px; background: #f9fafb; border-top: 1px solid #e5e7eb; display: flex; align-items: center; gap: 8px; font-size: 10px; color: #9ca3af; }
        .map-wrapper { flex: 1; position: relative; }
        .map-container { position: absolute; inset: 0; width: 100%; height: 100%; }
        .drawer { position: absolute; top: 0; right: 0; bottom: 0; width: 420px; background: white; box-shadow: -4px 0 20px rgba(0, 0, 0, 0.1); transform: translateX(100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); z-index: 30; display: flex; flex-direction: column; }
        .drawer.open { transform: translateX(0); }
        .close-btn { left: 16px; right: auto; top: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .drawer-content { padding: 32px 24px; }
        .custom-popup .maplibregl-popup-content { max-width: 260px !important; }
        }
      `}</style>
    </div>
  );
};

export default CropDashboard;