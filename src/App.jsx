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
  if (!sand || !clay) return "Unknown";
  if (clay >= 40) return "Clay";
  if (sand > 45) return "Sandy Loam";
  return "Loam";
};

const getHealthScore = (soil) => {
  if (!soil) return { score: 0, issues: [], strengths: [] };
  let score = 100;
  const issues = [];
  const strengths = [];
  if (soil.ph < 6.0) { score -= 15; issues.push({ message: `Acidic Soil (pH ${soil.ph.toFixed(1)})`, severity: "medium" }); } 
  else if (soil.ph > 7.5) { score -= 15; issues.push({ message: `Alkaline Soil (pH ${soil.ph.toFixed(1)})`, severity: "medium" }); } 
  else { strengths.push({ message: "pH is in optimal range" }); }
  if (soil.soc < 15) { score -= 20; issues.push({ message: "Low organic matter", severity: "high" }); } else { strengths.push({ message: "Good organic matter" }); }
  if (soil.nitrogen < 2.0) { score -= 15; issues.push({ message: "Low Nitrogen", severity: "medium" }); }
  return { score: Math.max(0, score), issues, strengths };
};

const getFertilizerPlan = (soil) => {
  if (!soil) return [];
  const plan = [];
  if (soil.nitrogen < 2.0) plan.push({ nutrient: "Nitrogen (N)", priority: "HIGH", amount: "80-100 lbs/ac", fertilizer: "Urea (46-0-0)", current: soil.nitrogen.toFixed(2), target: "3.5", timing: "Split application at planting" });
  if (soil.ph < 6.0) plan.push({ nutrient: "pH Adjustment", priority: "HIGH", amount: "2-3 tons/ac", fertilizer: "Ag Limestone", current: soil.ph.toFixed(1), target: "6.5", timing: "Fall application" });
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

  // ✅ UPDATED CROP LIST (Includes Orchards)
  const CROP_LOOKUP = { 
    1: 'Corn', 
    4: 'Sorghum', 
    5: 'Soybeans', 
    24: 'Winter Wheat', 
    36: 'Alfalfa', 
    43: 'Potatoes', 
    61: 'Fallow', 
    176: 'Grassland',
    204: 'Pistachios', 
    212: 'Oranges', 
    75: 'Almonds',
    // New Orchard Crops
    66: 'Cherries',
    67: 'Peaches',
    68: 'Apples',
    69: 'Grapes',
    76: 'Walnuts',
    77: 'Pears',
    223: 'Apricots'
  };
  
  // ✅ UPDATED COLORS (Distinct colors for orchards)
  const cropColors = { 
    '1': '#F4D03F',   // Corn
    '5': '#229954',   // Soybeans
    '24': '#A04000',  // Wheat
    '36': '#2ECC71',  // Alfalfa
    '176': '#CDDC39', // Grassland
    '43': '#FFCC80',  // Potatoes
    '75': '#D7CCC8',  // Almonds
    '61': '#BDBDBD',  // Fallow
    // Orchards
    '66': '#C2185B',  // Cherries (Pink)
    '67': '#FFAB91',  // Peaches (Peach)
    '68': '#D32F2F',  // Apples (Red)
    '69': '#7B1FA2',  // Grapes (Purple)
    '76': '#795548',  // Walnuts (Brown)
    '77': '#AED581',  // Pears (Light Green)
    '223': '#FFCA28'  // Apricots (Yellow-Orange)
  };

  // --- 1. RESIZE LISTENER ---
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // --- 2. CORE FUNCTIONS ---
  const fetchAnalysisFromAzure = async (lat, lon, cropName, currentProps) => {
    setLoading(true); setShowAnalytics(true);
    if (isMobile) setIsMobileMenuOpen(false);

    try {
      const response = await fetch(`${API_ENDPOINT}?lat=${lat}&lon=${lon}`);
      if (!response.ok) throw new Error(`Server Error: ${response.statusText}`);
      const data = await response.json();
      const history = data.history || {};
      history[CURRENT_YEAR] = { crop: cropName, code: currentProps.CROP_TYPE, acres: currentProps.CSBACRES };
      
      setFieldData({
        cropName: cropName, county: currentProps.CNTY, acres: currentProps.CSBACRES,
        history: history, soil: data.soil, recommendations: data.recommendations || [], 
        texture: getTextureClass(data.soil?.sand, data.soil?.clay),
        healthData: getHealthScore(data.soil), fertilizerPlan: getFertilizerPlan(data.soil), location: { lat, lon }
      });
    } catch (error) {
      console.error("Analysis Error:", error);
      alert("Analysis failed.");
    } finally { setLoading(false); }
  };

  const handleMapClick = useCallback((e) => {
    if (!map.current) return;
    if (!e.features || !e.features[0]) return;
    
    const props = e.features[0].properties;
    const lat = e.lngLat.lat;
    const lon = e.lngLat.lng;
    const cropName = CROP_LOOKUP[props.CROP_TYPE] || "Unknown";
    const acres = props.CSBACRES ? parseFloat(props.CSBACRES).toFixed(2) : "N/A";

    if (popup.current) popup.current.remove();

    popup.current = new window.maplibregl.Popup({ closeButton: true, maxWidth: '320px', className: 'custom-popup' })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="padding:16px; font-family:system-ui, -apple-system, sans-serif;">
          <h3 style="margin:0 0 12px 0; color:#1e293b; font-size:18px; font-weight:700;">${cropName}</h3>
          <div style="display:flex; flex-direction:column; gap:6px; font-size:13px; color:#64748b; margin-bottom:16px;">
            <div><strong style="color:#475569;">Acres:</strong> ${acres}</div>
            <div><strong style="color:#475569;">County:</strong> ${props.CNTY || 'N/A'}</div>
          </div>
          <button id="analyze-btn" style="width:100%; padding:12px 16px; background:#1e40af; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600; font-size:14px;">Run Field Analysis</button>
        </div>
      `)
      .addTo(map.current);
    
    requestAnimationFrame(() => {
        const btn = document.getElementById('analyze-btn');
        if(btn) btn.onclick = (event) => { event.preventDefault(); fetchAnalysisFromAzure(lat, lon, cropName, props); };
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // --- 3. MAP INITIALIZATION ---
  useEffect(() => {
    let isMounted = true;

    const initMap = async () => {
      if (mapInitialized.current) return;
      try { await loadMapResources(); } catch (e) { return; }
      
      if (!isMounted || !mapContainer.current) return;
      if (!window.maplibregl || !window.pmtiles) return;

      if (!window.maplibregl.config?.REGISTERED_PROTOCOLS?.pmtiles) {
         const protocol = new window.pmtiles.Protocol();
         window.maplibregl.addProtocol("pmtiles", protocol.tile);
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
        
        map.current.on('click', 'visual-layer', handleMapClick);
        map.current.on('mousemove', 'visual-layer', () => { if (map.current) map.current.getCanvas().style.cursor = 'pointer'; });
        map.current.on('mouseleave', 'visual-layer', () => { if (map.current) map.current.getCanvas().style.cursor = ''; });

        // ✅ AUTO-ZOOM (Wait for map readiness)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

            {fieldData.healthData && (
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
                      const total = fieldData.soil.sand + fieldData.soil.clay + fieldData.soil.silt;
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
                    <div className="pie-legend-item"><span className="pie-dot" style={{background: '#f59e0b'}}></span><span>Sand: {fieldData.soil.sand.toFixed(1)}%</span></div>
                    <div className="pie-legend-item"><span className="pie-dot" style={{background: '#a16207'}}></span><span>Silt: {fieldData.soil.silt.toFixed(1)}%</span></div>
                    <div className="pie-legend-item"><span className="pie-dot" style={{background: '#78350f'}}></span><span>Clay: {fieldData.soil.clay.toFixed(1)}%</span></div>
                  </div>
                </div>
                <div className="metrics-grid">
                  <div className="metric-box"><Droplets size={18} className="metric-icon" style={{color: '#3b82f6'}} /><div className="metric-content"><span className="metric-label">pH Level</span><span className="metric-value">{fieldData.soil.ph.toFixed(1)}</span></div></div>
                  <div className="metric-box"><Leaf size={18} className="metric-icon" style={{color: '#10b981'}} /><div className="metric-content"><span className="metric-label">Carbon</span><span className="metric-value">{fieldData.soil.soc.toFixed(1)} g/kg</span></div></div>
                  <div className="metric-box"><Sprout size={18} className="metric-icon" style={{color: '#f59e0b'}} /><div className="metric-content"><span className="metric-label">Nitrogen</span><span className="metric-value">{fieldData.soil.nitrogen.toFixed(2)} g/kg</span></div></div>
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
        .close-btn { position: absolute; top: 16px; right: 16px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: white; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; color: #6b7280; z-index: 10; transition: all 0.2s; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); }
        .close-btn:hover { background: #f9fafb; border-color: #d1d5db; color: #374151; }
        .loading-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 40px; }
        .loading-title { font-size: 16px; font-weight: 600; color: #1f2937; }
        .loading-subtitle { font-size: 13px; color: #9ca3af; }
        .spin { animation: spin 1s linear infinite; color: #3b82f6; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .drawer-content { padding: 60px 24px 24px; overflow-y: auto; }
        .drawer-header { margin-bottom: 24px; }
        .header-top { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
        .crop-title { font-size: 26px; font-weight: 700; color: #111827; letter-spacing: -0.02em; }
        .texture-badge { padding: 4px 12px; background: #f3f4f6; border-radius: 6px; font-size: 12px; font-weight: 600; color: #6b7280; }
        .header-meta { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #9ca3af; }
        .card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
        .card-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px; }
        .health-card { background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-color: #bae6fd; }
        .health-content { display: flex; gap: 20px; }
        .health-circle { width: 100px; height: 100px; border-radius: 50%; border: 6px solid; display: flex; flex-direction: column; align-items: center; justify-content: center; flex-shrink: 0; background: white; }
        .health-score { font-size: 32px; font-weight: 800; color: #111827; line-height: 1; }
        .health-label { font-size: 11px; color: #6b7280; font-weight: 600; margin-top: 4px; }
        .health-details { flex: 1; display: flex; flex-direction: column; gap: 8px; }
        .health-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 6px; font-size: 12px; line-height: 1.4; }
        .health-item.success { background: #d1fae5; color: #065f46; }
        .health-item.warning { background: #fef3c7; color: #92400e; }
        .metrics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .metric-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; }
        .metric-icon { flex-shrink: 0; }
        .metric-content { display: flex; flex-direction: column; gap: 4px; }
        .metric-label { font-size: 11px; color: #9ca3af; font-weight: 500; }
        .metric-value { font-size: 18px; font-weight: 700; color: #111827; }
        .fertilizer-list { display: flex; flex-direction: column; gap: 16px; }
        .fertilizer-item { padding: 16px; background: #fefce8; border: 1px solid #fde68a; border-radius: 8px; }
        .fert-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .fert-nutrient { font-size: 15px; font-weight: 700; color: #78350f; }
        .priority-badge { padding: 4px 10px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        .priority-badge.high { background: #fee2e2; color: #991b1b; }
        .priority-badge.medium { background: #fed7aa; color: #9a3412; }
        .fert-details { display: flex; gap: 16px; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px dashed #fde68a; }
        .fert-row { display: flex; flex-direction: column; gap: 2px; }
        .fert-label { font-size: 10px; color: #b45309; text-transform: uppercase; font-weight: 600; }
        .fert-value { font-size: 13px; font-weight: 700; color: #78350f; }
        .fert-recommendation { font-size: 13px; color: #92400e; line-height: 1.5; }
        .fert-timing { font-size: 12px; font-style: italic; color: #b45309; margin-top: 4px; }
        .crop-recommendations { display: flex; flex-direction: column; gap: 10px; }
        .crop-rec-item { display: flex; align-items: center; gap: 12px; padding: 12px; background: #f9fafb; border-radius: 8px; border: 1px solid #f3f4f6; }
        .rec-rank { width: 24px; height: 24px; background: #1a237e; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
        .rec-info { flex: 1; display: flex; flex-direction: column; }
        .rec-name { font-size: 14px; font-weight: 600; color: #1f2937; }
        .rec-reason { font-size: 11px; color: #6b7280; }
        .rec-score { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; }
        .timeline { display: flex; flex-direction: column; gap: 8px; }
        .timeline-item { display: flex; align-items: center; gap: 12px; }
        .timeline-year { width: 36px; font-size: 12px; font-weight: 600; color: #9ca3af; flex-shrink: 0; }
        .timeline-content { flex: 1; }
        .timeline-bar { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-radius: 6px; font-size: 13px; font-weight: 500; color: #1f2937; }
        .timeline-acres { font-size: 11px; font-weight: 400; opacity: 0.7; }
        .composition-pie { display: flex; gap: 20px; align-items: center; justify-content: center; margin-bottom: 20px; }
        .pie-chart { width: 120px; height: 120px; flex-shrink: 0; transform: rotate(-90deg); }
        .pie-legend { display: flex; flex-direction: column; gap: 6px; }
        .pie-legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #4b5563; font-weight: 500; }
        .pie-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .mobile-header { display: none; }
        @media (max-width: 768px) {
            .app-root { flex-direction: column; }
            .mobile-header { display: flex; position: absolute; top: 0; left: 0; right: 0; height: 60px; background: linear-gradient(135deg, #1a237e 0%, #283593 100%); z-index: 50; align-items: center; justify-content: space-between; padding: 0 16px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); }
            .mobile-header button { background: none; border: none; cursor: pointer; color: white; display: flex; }
            .mh-left { display: flex; align-items: center; gap: 10px; }
            .mobile-title { color: white; font-weight: 700; font-size: 18px; }
            .sidebar { position: absolute; top: 60px; left: 0; width: 100%; bottom: 0; transform: translateX(0); border-right: none; }
            .sidebar.hidden { display: none; }
            .mobile-sidebar { z-index: 40; }
            .map-wrapper { position: absolute; top: 60px; left: 0; right: 0; bottom: 0; }
            .drawer { width: 100%; height: 85%; top: auto; bottom: 0; transform: translateY(100%); border-radius: 16px 16px 0 0; box-shadow: 0 -4px 20px rgba(0,0,0,0.15); }
            .drawer.open { transform: translateY(0); }
            .close-btn { left: 16px; right: auto; top: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            .drawer-content { padding: 32px 24px; }
            .custom-popup .maplibregl-popup-content { max-width: 260px !important; }
        }
      `}</style>
    </div>
  );
};

export default CropDashboard;