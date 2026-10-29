class MapView {
  constructor() {
    this.map = null;
    this.boundaryLayer = null;
    this.onPolygonDrawnCallback = null;
    this.searchDebounceTimer = null;
    this.drawingPoints = [];
    this.drawingPolyline = null;
    this.isDrawing = false;
  }

  init(containerId = 'map') {
    if (typeof L === 'undefined') {
      console.error('[mapView] Leaflet não carregado.');
      return;
    }

    // Inicializa o mapa centralizado em Ariquemes/RO (IFRO / SIAAGRO 2026)
    this.map = L.map(containerId, {
      zoomControl: false,
      attributionControl: false
    }).setView([-9.946, -62.961], 14);

    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);

    // Camada Satélite ESRI World Imagery
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Esri, Maxar, Earthstar Geographics'
    }).addTo(this.map);

    this._setupSearch();
    this._setupDrawerCollapse();
  }

  getMap() {
    return this.map;
  }

  zoomToField(polygon) {
    if (!this.map || !polygon) return;
    try {
      const geoJsonLayer = L.geoJSON(polygon);
      const bounds = geoJsonLayer.getBounds();
      if (bounds.isValid()) {
        this.map.flyToBounds(bounds, {
          padding: [60, 60],
          maxZoom: 16,
          duration: 1.2
        });
      }
    } catch (err) {
      console.error('[mapView] Erro ao centralizar no talhão:', err);
    }
  }

  renderFieldBoundary(polygon) {
    if (!this.map) return;
    if (this.boundaryLayer) {
      this.map.removeLayer(this.boundaryLayer);
      this.boundaryLayer = null;
    }

    if (!polygon) return;

    this.boundaryLayer = L.geoJSON(polygon, {
      style: {
        color: '#10b981',
        weight: 2.2,
        opacity: 0.95,
        fillColor: '#10b981',
        fillOpacity: 0.05
      }
    }).addTo(this.map);
  }

  // --- Sistema de Demarcação / Desenho Interativo de Talhão (1:1 Alvo Certo) ---

  startDrawing(onComplete) {
    if (!this.map) return;
    this.cancelDrawing();
    this.isDrawing = true;
    this.onPolygonDrawnCallback = onComplete;
    this.drawingPoints = [];
    this.drawingMarkers = [];
    this.map.getContainer().style.cursor = 'crosshair';

    this._showDrawingBanner();

    this.mapClickHandler = (e) => {
      if (!this.isDrawing) return;
      this.addDrawingPoint(e.latlng);
    };

    this.map.on('click', this.mapClickHandler);
  }

  addDrawingPoint(latlng) {
    const isFirst = this.drawingPoints.length === 0;
    this.drawingPoints.push(latlng);

    const marker = L.circleMarker(latlng, {
      radius: isFirst ? 7 : 5,
      color: isFirst ? '#EA580C' : '#10b981',
      fillColor: isFirst ? '#FED7AA' : '#ffffff',
      fillOpacity: 1,
      weight: 2
    }).addTo(this.map);

    if (isFirst) {
      marker.bindTooltip('Clique para fechar o talhão', { permanent: false, direction: 'top' });
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (this.drawingPoints.length >= 3) {
          this.finishDrawing();
        }
      });
    }

    this.drawingMarkers.push(marker);
    this._updateDrawingPreview();
  }

  _updateDrawingPreview() {
    if (this.drawingPolyline) {
      this.map.removeLayer(this.drawingPolyline);
      this.drawingPolyline = null;
    }
    if (this.drawingPolygonPreview) {
      this.map.removeLayer(this.drawingPolygonPreview);
      this.drawingPolygonPreview = null;
    }

    if (this.drawingPoints.length >= 2) {
      this.drawingPolyline = L.polyline(this.drawingPoints, {
        color: '#10b981',
        weight: 2.5,
        dashArray: '5, 5'
      }).addTo(this.map);
    }

    if (this.drawingPoints.length >= 3) {
      this.drawingPolygonPreview = L.polygon(this.drawingPoints, {
        color: '#10b981',
        weight: 2,
        fillColor: '#10b981',
        fillOpacity: 0.15
      }).addTo(this.map);
    }

    const areaHa = this._calculateSphericalArea(this.drawingPoints);
    this._updateDrawingBanner(this.drawingPoints.length, areaHa);
  }

  finishDrawing() {
    if (!this.isDrawing || this.drawingPoints.length < 3) {
      alert('Demarque pelo menos 3 pontos no mapa para formar a área do talhão.');
      return;
    }

    const ring = this.drawingPoints.map(p => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
      ring.push([ring[0][0], ring[0][1]]);
    }

    const geoJsonPolygon = {
      type: 'Polygon',
      coordinates: [ring]
    };

    const areaHa = this._calculateSphericalArea(this.drawingPoints);
    const cb = this.onPolygonDrawnCallback;
    this.cancelDrawing();

    if (cb) {
      cb(geoJsonPolygon, areaHa);
    }
  }

  cancelDrawing() {
    this.isDrawing = false;
    if (this.map) {
      this.map.getContainer().style.cursor = '';
      if (this.mapClickHandler) {
        this.map.off('click', this.mapClickHandler);
        this.mapClickHandler = null;
      }
    }
    if (this.drawingPolyline && this.map) {
      this.map.removeLayer(this.drawingPolyline);
      this.drawingPolyline = null;
    }
    if (this.drawingPolygonPreview && this.map) {
      this.map.removeLayer(this.drawingPolygonPreview);
      this.drawingPolygonPreview = null;
    }
    if (this.drawingMarkers && this.map) {
      this.drawingMarkers.forEach(m => this.map.removeLayer(m));
      this.drawingMarkers = [];
    }
    this.drawingPoints = [];
    this._hideDrawingBanner();
  }

  _calculateSphericalArea(latlngs) {
    if (!latlngs || latlngs.length < 3) return 0;
    const RADIUS = 6378137;
    let total = 0;
    const len = latlngs.length;
    for (let i = 0; i < len; i++) {
      const p1 = latlngs[i];
      const p2 = latlngs[(i + 1) % len];
      const x1 = (p1.lng * Math.PI) / 180;
      const y1 = (p1.lat * Math.PI) / 180;
      const x2 = (p2.lng * Math.PI) / 180;
      const y2 = (p2.lat * Math.PI) / 180;
      total += (x2 - x1) * (2 + Math.sin(y1) + Math.sin(y2));
    }
    const areaSqM = Math.abs((total * RADIUS * RADIUS) / 2);
    return Math.round((areaSqM / 10000) * 100) / 100;
  }

  _showDrawingBanner() {
    const banner = document.getElementById('drawing-banner');
    const finishBtn = document.getElementById('btn-drawing-finish');
    const cancelBtn = document.getElementById('btn-drawing-cancel');

    if (banner) banner.style.display = 'flex';
    if (finishBtn) finishBtn.onclick = () => this.finishDrawing();
    if (cancelBtn) cancelBtn.onclick = () => this.cancelDrawing();
    this._updateDrawingBanner(0, 0);
  }

  _hideDrawingBanner() {
    const banner = document.getElementById('drawing-banner');
    if (banner) banner.style.display = 'none';
  }

  _updateDrawingBanner(count, areaHa) {
    const sub = document.getElementById('drawing-banner-sub');
    if (sub) {
      sub.textContent = `${count} ${count === 1 ? 'vértice demarcado' : 'vértices demarcados'} • ${areaHa.toFixed(2)} ha calculados`;
    }
  }

  _setupDrawerCollapse() {
    const btn = document.getElementById('btn-toggle-drawer');
    const panel = document.getElementById('monitoring-panel');
    const legend = document.getElementById('color-legend');

    if (btn && panel) {
      btn.addEventListener('click', () => {
        panel.classList.toggle('collapsed');
        btn.classList.toggle('drawer-collapsed');
        if (legend) legend.classList.toggle('drawer-collapsed');
      });
    }
  }

  _setupSearch() {
    const input = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear-btn');
    const resultsContainer = document.getElementById('search-results');

    if (!input || !resultsContainer) return;

    input.addEventListener('input', () => {
      const val = input.value.trim();
      if (clearBtn) clearBtn.style.display = val ? 'block' : 'none';

      clearTimeout(this.searchDebounceTimer);
      if (!val) {
        resultsContainer.style.display = 'none';
        resultsContainer.innerHTML = '';
        return;
      }

      // Suporte a coordenadas diretas GPS: "lat, lng"
      const coordsMatch = val.match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
      if (coordsMatch) {
        const lat = parseFloat(coordsMatch[1]);
        const lng = parseFloat(coordsMatch[3]);
        if (!isNaN(lat) && !isNaN(lng)) {
          resultsContainer.innerHTML = `
            <div class="search-item" data-lat="${lat}" data-lng="${lng}">
              Coordenadas GPS: <strong>${lat.toFixed(5)}, ${lng.toFixed(5)}</strong>
            </div>`;
          resultsContainer.style.display = 'block';
          return;
        }
      }

      // Consulta de Municípios via Nominatim (OpenStreetMap Brasil)
      this.searchDebounceTimer = setTimeout(async () => {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=5&q=${encodeURIComponent(val)}`;
          const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
          if (!res.ok) return;
          const data = await res.json();

          if (!data || data.length === 0) {
            resultsContainer.innerHTML = '<div class="search-item" style="color:var(--text-dim);">Nenhum município encontrado.</div>';
            resultsContainer.style.display = 'block';
            return;
          }

          resultsContainer.innerHTML = data.map(item => `
            <div class="search-item" data-lat="${item.lat}" data-lng="${item.lon}">
              ${item.display_name}
            </div>
          `).join('');
          resultsContainer.style.display = 'block';
        } catch (err) {
          console.warn('[mapView] Erro na busca de municípios:', err);
        }
      }, 350);
    });

    resultsContainer.addEventListener('click', (e) => {
      const item = e.target.closest('.search-item');
      if (!item) return;
      const lat = parseFloat(item.getAttribute('data-lat'));
      const lng = parseFloat(item.getAttribute('data-lng'));
      if (!isNaN(lat) && !isNaN(lng) && this.map) {
        this.map.flyTo([lat, lng], 13, { duration: 1.4 });
        resultsContainer.style.display = 'none';
        input.value = item.textContent.trim().split(',')[0];
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.style.display = 'none';
        resultsContainer.style.display = 'none';
        input.focus();
      });
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#map-search-bar')) {
        resultsContainer.style.display = 'none';
      }
    });
  }
}

export const mapView = new MapView();
