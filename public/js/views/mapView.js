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
