class HeatmapView {
  constructor() {
    this.rasterOverlay = null;
    this.vectorOverlay = null;
    this.boundaryOverlay = null;
    this.currentMode = 'vector'; // Padrão MVSky: Zonas de Manejo Vetoriais
  }

  clear(map) {
    if (!map) return;
    if (this.rasterOverlay) {
      map.removeLayer(this.rasterOverlay);
      this.rasterOverlay = null;
    }
    if (this.vectorOverlay) {
      map.removeLayer(this.vectorOverlay);
      this.vectorOverlay = null;
    }
    if (this.boundaryOverlay) {
      map.removeLayer(this.boundaryOverlay);
      this.boundaryOverlay = null;
    }
  }

  render(map, polygon, computation, mode = this.currentMode) {
    if (!map || !polygon || !computation) return;
    this.clear(map);
    this.currentMode = mode;

    const isRGB = computation.indexType === 'RGB' || computation.index === 'RGB';

    if (!isRGB) {
      if (mode === 'raster') {
        this._renderRasterBicubic(map, polygon, computation);
      } else {
        this._renderVectorZones(map, polygon, computation);
      }
    }

    // Contorno perimetral esmeralda oficial
    this.boundaryOverlay = L.geoJSON(polygon, {
      style: {
        color: '#10b981',
        weight: 2.2,
        fill: false,
        opacity: 0.95
      }
    }).addTo(map);

    this._updateToggleButtonLabel(isRGB);
  }

  toggleMode(map, polygon, computation) {
    const isRGB = computation?.indexType === 'RGB' || computation?.index === 'RGB';
    if (isRGB) return 'rgb';
    const nextMode = this.currentMode === 'raster' ? 'vector' : 'raster';
    this.render(map, polygon, computation, nextMode);
    return nextMode;
  }

  _renderVectorZones(map, polygon, computation) {
    // 1. Se vectorLayer estiver presente na resposta (MVSky nativo: 576 microzonas poligonais)
    if (computation.vectorLayer?.features?.length > 0) {
      this.vectorOverlay = L.geoJSON(computation.vectorLayer, {
        style: (feature) => ({
          fillColor: feature.properties?.color || feature.properties?.fill || '#10b981',
          fillOpacity: 0.85,
          weight: 0.35,
          color: 'rgba(255, 255, 255, 0.4)'
        }),
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {};
          const className = props.className || 'Zona de Manejo';
          const mean = typeof props.mean === 'number' ? props.mean.toFixed(3) : '-';
          const areaHa = typeof props.areaHa === 'number' ? `${props.areaHa.toFixed(2)} ha` : '';
          const rec = props.recommendation ? `<br/><span style="color:#003732;font-size:11px;">${props.recommendation}</span>` : '';
          layer.bindTooltip(`<strong>${className}</strong><br/>Índice Médio: ${mean}<br/>Área: ${areaHa}${rec}`, {
            sticky: true,
            className: 'agro-tooltip'
          });
        }
      }).addTo(map);
      return;
    }

    // 2. Se vectorLayer não estiver presente, gera as zonas vetoriais a partir do spatialGrid ou legend
    const synthesizedLayer = this._synthesizeVectorZones(polygon, computation);
    if (synthesizedLayer) {
      this.vectorOverlay = L.geoJSON(synthesizedLayer, {
        style: (feature) => ({
          fillColor: feature.properties?.color || '#10b981',
          fillOpacity: 0.85,
          weight: 0,
          stroke: false
        }),
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {};
          layer.bindTooltip(`<strong>${props.className}</strong><br/>Índice: ${props.range}<br/>Agronomia: ${props.agronomicMeaning || ''}`, {
            sticky: true,
            className: 'agro-tooltip'
          });
        }
      }).addTo(map);
    } else {
      // Fallback para raster se não for possível sintetizar
      this._renderRasterBicubic(map, polygon, computation);
    }
  }

  _synthesizeVectorZones(polygon, computation) {
    const grid = computation.spatialGrid;
    const legend = computation.legend;
    if (!grid?.values || !Array.isArray(grid.values)) return null;

    const bbox = this._extractBBox(polygon, computation);
    const rows = grid.rows || grid.values.length;
    const cols = grid.cols || (Array.isArray(grid.values[0]) ? grid.values[0].length : 12);
    const dLat = (bbox.maxLat - bbox.minLat) / rows;
    const dLng = (bbox.maxLng - bbox.minLng) / cols;

    const defaultLegend = [
      { min: -0.2, max: 0.25, label: 'Solo Exposto / Crítico', colorHex: '#d73027' },
      { min: 0.25, max: 0.5, label: 'Vigor Moderado / Alerta', colorHex: '#fdae61' },
      { min: 0.5, max: 0.7, label: 'Bom Vigor Vegetativo', colorHex: '#a6d96a' },
      { min: 0.7, max: 1.0, label: 'Dossel Denso / Excelente', colorHex: '#1a9850' }
    ];
    const rules = (Array.isArray(legend) && legend.length > 0) ? legend : defaultLegend;

    const features = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = Array.isArray(grid.values[r]) ? grid.values[r][c] : grid.values[r * cols + c];
        if (val === null || val === undefined || isNaN(val)) continue;

        const rule = rules.find(ru => val >= ru.min && val <= ru.max) || rules[rules.length - 1];
        const cellMinLat = bbox.maxLat - (r + 1) * dLat;
        const cellMaxLat = bbox.maxLat - r * dLat;
        const cellMinLng = bbox.minLng + c * dLng;
        const cellMaxLng = bbox.minLng + (c + 1) * dLng;

        features.push({
          type: 'Feature',
          properties: {
            className: rule.label,
            color: rule.colorHex,
            mean: val,
            range: `${rule.min} - ${rule.max}`,
            agronomicMeaning: rule.agronomicMeaning || ''
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [cellMinLng, cellMinLat],
              [cellMaxLng, cellMinLat],
              [cellMaxLng, cellMaxLat],
              [cellMinLng, cellMaxLat],
              [cellMinLng, cellMinLat]
            ]]
          }
        });
      }
    }

    return { type: 'FeatureCollection', features };
  }

  _renderRasterBicubic(map, polygon, computation) {
    // Se a resposta MVSky tiver vectorLayer (alta qualidade com centenas de polígonos), usa-o como renderização principal
    if (computation.vectorLayer?.features?.length > 0) {
      return this._renderVectorZones(map, polygon, computation);
    }

    const grid = computation.spatialGrid;
    if (!grid || !grid.values) {
      return this._renderVectorZones(map, polygon, computation);
    }

    const rows = grid.rows || (Array.isArray(grid.values) ? grid.values.length : 12);
    const cols = grid.cols || (Array.isArray(grid.values[0]) ? grid.values[0].length : 12);
    const values = grid.values;

    // Canvas 1: Escala original da matriz
    const canvas1 = document.createElement('canvas');
    canvas1.width = cols;
    canvas1.height = rows;
    const ctx1 = canvas1.getContext('2d');
    const imgData = ctx1.createImageData(cols, rows);

    const normMin = Array.isArray(computation.legend) && computation.legend.length > 0 ? computation.legend[0].min : -0.2;
    const normMax = Array.isArray(computation.legend) && computation.legend.length > 0 ? computation.legend[computation.legend.length - 1].max : 1.0;
    const normRange = (normMax - normMin) || 1.0;

    const palette = [
      '#4a0000', '#7a0e0e', '#a81c1c', '#c72c2c', '#d9482b',
      '#e06c3a', '#e48f3e', '#e6b43d', '#d9cf59', '#e0e68c',
      '#c2db67', '#a6cf4e', '#94bf47', '#73ab3d', '#549836',
      '#3b8a34', '#2a7c36', '#1b6b33', '#0e552d', '#003732'
    ];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const pixelIdx = (r * cols + c) * 4;
        const rawVal = Array.isArray(values[r]) ? values[r][c] : values[r * cols + c];

        if (rawVal === null || rawVal === undefined || isNaN(rawVal)) {
          imgData.data[pixelIdx + 3] = 0; // Alpha 0 fora da cerca
          continue;
        }

        const t = Math.max(0, Math.min(1, (rawVal - normMin) / normRange));
        const colorIdx = Math.min(19, Math.floor(t * 20));
        const hex = palette[colorIdx].replace('#', '');
        const bigint = parseInt(hex, 16);

        imgData.data[pixelIdx] = (bigint >> 16) & 255;
        imgData.data[pixelIdx + 1] = (bigint >> 8) & 255;
        imgData.data[pixelIdx + 2] = bigint & 255;
        imgData.data[pixelIdx + 3] = 230; // 90% opacidade
      }
    }
    ctx1.putImageData(imgData, 0, 0);

    // Canvas 2: Display de Alta Resolução 512x512 com recorte estrito por GPU
    const canvas2 = document.createElement('canvas');
    canvas2.width = 512;
    canvas2.height = 512;
    const ctx2 = canvas2.getContext('2d');

    const bbox = this._extractBBox(polygon, computation);
    const { minLng, maxLng, minLat, maxLat } = bbox;

    const rings = this._extractRings(polygon);

    ctx2.save();
    ctx2.beginPath();
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const [lng, lat] = ring[i];
        const x = ((lng - minLng) / (maxLng - minLng)) * 512;
        const y = ((maxLat - lat) / (maxLat - minLat)) * 512;
        if (i === 0) ctx2.moveTo(x, y);
        else ctx2.lineTo(x, y);
      }
    }
    ctx2.closePath();
    ctx2.clip();

    ctx2.imageSmoothingEnabled = true;
    ctx2.imageSmoothingQuality = 'high';
    ctx2.drawImage(canvas1, 0, 0, 512, 512);
    ctx2.restore();

    const leafletBounds = [
      [minLat, minLng],
      [maxLat, maxLng]
    ];

    this.rasterOverlay = L.imageOverlay(canvas2.toDataURL(), leafletBounds, {
      opacity: 0.85,
      interactive: false
    }).addTo(map);
  }

  _extractRings(polygon) {
    if (polygon.type === 'Feature') {
      return this._extractRings(polygon.geometry);
    }
    if (polygon.type === 'Polygon') {
      return polygon.coordinates || [];
    }
    if (polygon.type === 'MultiPolygon') {
      return (polygon.coordinates || []).flat();
    }
    if (Array.isArray(polygon)) {
      return Array.isArray(polygon[0][0]) ? polygon : [polygon];
    }
    return [];
  }

  _extractBBox(polygon, computation) {
    if (computation?.bbox && Array.isArray(computation.bbox) && computation.bbox.length === 4) {
      return {
        minLng: computation.bbox[0],
        minLat: computation.bbox[1],
        maxLng: computation.bbox[2],
        maxLat: computation.bbox[3]
      };
    }
    const rings = this._extractRings(polygon);
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    return { minLng, maxLng, minLat, maxLat };
  }

  _updateToggleButtonLabel(isRGB = false) {
    const btn = document.getElementById('btn-toggle-view');
    if (!btn) return;
    if (isRGB) {
      btn.textContent = 'Visão Óptica Natural (RGB)';
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.style.cursor = 'default';
    } else {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.textContent = this.currentMode === 'raster' ? 'Ver Zonas de Manejo' : 'Ver Raster Contínuo';
    }
  }
}

export const heatmapView = new HeatmapView();
