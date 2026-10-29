import { stateModel } from '../models/stateModel.js';
import { spectralModel } from '../models/spectralModel.js';
import { mapView } from '../views/mapView.js';
import { authModalView } from '../views/authModalView.js';
import { heatmapView } from '../views/heatmapView.js';
import { statsView } from '../views/statsView.js';

class AppController {
  constructor() {
    this.isAnalyzing = false;
  }

  async init() {
    // 1. Inicializa o mapa com Leaflet e ESRI World Imagery
    mapView.init('map');

    // 2. Inicializa o modal de autenticação com login e logout
    authModalView.init(
      async (credentials) => {
        try {
          const res = await spectralModel.login(credentials);
          stateModel.setState({ session: res.session });
          authModalView.close();
          await this.handleSessionUpdate(res.session);
        } catch (err) {
          authModalView.showError(err.message || 'Falha ao autenticar.');
        }
      },
      async () => {
        try {
          const res = await spectralModel.logout();
          stateModel.setState({ session: res.session });
          await this.handleSessionUpdate(res.session);
        } catch (err) {
          console.error('[appController] Erro ao encerrar sessão:', err);
        }
      }
    );

    // 3. Vincula navegação por abas da gaveta lateral
    this._setupTabs();

    // 4. Vincula seletores de índices espectrais e alternância de modos
    this._setupIndicesControls();

    // 5. Vincula modais de Fazenda e Talhão com snippets oficiais
    this._setupPropertyAndFieldModals();

    // 6. Vincula controles de Meus Talhões (Mini Hero Alvo Certo)
    this._setupCamposHeroControls();

    // 7. Consulta o estado inicial da sessão
    try {
      const session = await spectralModel.getSession();
      stateModel.setState({ session });
      await this.handleSessionUpdate(session);
    } catch (err) {
      console.warn('[appController] Erro ao consultar sessão inicial:', err);
    }
  }

  async handleSessionUpdate(session) {
    authModalView.updateHeader(session);
    const guestCard = document.getElementById('guest-invitation');
    const loggedView = document.getElementById('logged-fields-view');
    const tierBadge = document.getElementById('campos-tier-badge');

    if (session && session.authenticated) {
      if (guestCard) guestCard.style.display = 'none';
      if (loggedView) loggedView.style.display = 'block';
      if (tierBadge) tierBadge.textContent = session.wallet?.tier || 'PREMIUM';
      await this.loadProperties();
    } else {
      if (guestCard) guestCard.style.display = 'block';
      if (loggedView) loggedView.style.display = 'none';
      stateModel.setState({ properties: [], fields: [], activeComputation: null, activeFieldId: null });
      statsView.reset();
      heatmapView.clear(mapView.getMap());
    }
  }

  async loadProperties() {
    try {
      const properties = await spectralModel.getProperties();
      const currentActive = stateModel.getState().activePropertyId;
      const activePropertyId = properties.find(p => p.id === currentActive)?.id || properties[0]?.id || null;
      stateModel.setState({ properties, activePropertyId });

      statsView.renderPropertySelector(
        properties,
        activePropertyId,
        async (selectedId) => {
          stateModel.setState({ activePropertyId: selectedId });
          await this.loadFields(selectedId);
        },
        () => this.openPropertyModal()
      );

      if (activePropertyId) {
        await this.loadFields(activePropertyId);
      } else {
        statsView.renderFieldCards([], null, null, () => this.openFieldModal());
      }
    } catch (err) {
      console.error('[appController] Erro ao carregar propriedades:', err);
    }
  }

  async loadFields(propertyId) {
    try {
      const fields = await spectralModel.getFields(propertyId);
      stateModel.setState({ fields });

      statsView.renderFieldCards(
        fields,
        stateModel.getState().activeFieldId,
        async (selectedField) => {
          await this.selectField(selectedField);
        },
        () => this.openFieldModal()
      );

      // Se houver talhões e nenhum selecionado, seleciona o primeiro automaticamente
      if (fields.length > 0 && !stateModel.getState().activeFieldId) {
        await this.selectField(fields[0]);
      }
    } catch (err) {
      console.error('[appController] Erro ao carregar talhões:', err);
    }
  }

  async selectField(field) {
    if (!field || this.isAnalyzing) return;
    this.isAnalyzing = true;
    stateModel.setState({ activeFieldId: field.id });

    // Atualiza os cartões na aba de campos
    const { fields } = stateModel.getState();
    statsView.renderFieldCards(
      fields,
      field.id,
      (f) => this.selectField(f),
      () => this.openFieldModal()
    );

    // Ajusta o mapa suavemente na cerca do talhão
    mapView.zoomToField(field.polygon);
    mapView.renderFieldBoundary(field.polygon);

    try {
      await this.executeSpectralAnalysis(field);
    } finally {
      this.isAnalyzing = false;
    }
  }

  async executeSpectralAnalysis(field, requestedDate = null) {
    const { selectedIndex, selectedDate, viewMode, activeComputation: existingComp } = stateModel.getState();
    const dateToUse = requestedDate || selectedDate;

    // Tratamento Óptico Especial: RGB (1:1 Alvo Certo / Sentinel-2 True Color)
    // RGB é visualização óptica sobre o mapa de satélite, não um índice de vegetação biofísico.
    if (selectedIndex === 'RGB') {
      const series = existingComp?.historicalSeries || [];
      const effectiveDate = requestedDate || dateToUse || new Date().toISOString().slice(0, 10);

      const rgbComputation = {
        indexType: 'RGB',
        areaHectares: field.areaHectares || 0,
        captureDate: effectiveDate,
        historicalSeries: series,
        stats: { min: null, max: null, mean: null, stdDev: null }
      };

      stateModel.setState({
        activeComputation: rgbComputation,
        selectedDate: effectiveDate,
        historicalSeries: series
      });

      // Renderiza mapa: limpa raster/vetor e desenha perímetro esmeralda
      heatmapView.render(mapView.getMap(), field.polygon, rgbComputation, 'raster');

      // Atualiza painel de métricas e tabelas com os metadados de Cor Natural
      statsView.update(field, rgbComputation, 'RGB');

      // Mantém histórico e passagens orbitais
      statsView.updateDateSelector(
        series,
        effectiveDate,
        async (newDate) => {
          stateModel.setState({ selectedDate: newDate });
          await this.executeSpectralAnalysis(field, newDate);
        }
      );
      return;
    }

    try {
      const res = await spectralModel.analyze({
        fieldId: field.id,
        polygon: field.polygon,
        indexType: selectedIndex,
        date: dateToUse,
        maxCloudCover: 30
      });

      const computation = res.data?.computation || res.computation || res;
      const series = computation.historicalSeries || [];
      const effectiveDate = requestedDate || computation.captureDate || series[0]?.date || null;

      stateModel.setState({
        activeComputation: computation,
        selectedDate: effectiveDate,
        historicalSeries: series
      });

      // Renderiza a camada biofísica (zonas vetoriais ou raster bicúbico)
      heatmapView.render(mapView.getMap(), field.polygon, computation, viewMode);

      // Atualiza o painel de métricas e tabelas oficiais
      statsView.update(field, computation, selectedIndex);

      // Atualiza o seletor de passagens orbitais e gráfico temporal
      statsView.updateDateSelector(
        series,
        effectiveDate,
        async (newDate) => {
          stateModel.setState({ selectedDate: newDate });
          await this.executeSpectralAnalysis(field, newDate);
        }
      );

      // Sincroniza saldo de créditos pós-cálculo
      const session = await spectralModel.getSession();
      stateModel.setState({ session });
      authModalView.updateHeader(session);
    } catch (err) {
      console.error('[appController] Erro na análise espectral:', err);
      alert('Erro ao calcular índice espectral: ' + err.message);
    }
  }

  _setupTabs() {
    const tabFields = document.getElementById('tab-fields');
    const tabIndices = document.getElementById('tab-indices');

    if (tabFields) tabFields.addEventListener('click', () => this.switchTab('fields'));
    if (tabIndices) tabIndices.addEventListener('click', () => this.switchTab('indices'));
  }

  switchTab(tabName) {
    const tabFields = document.getElementById('tab-fields');
    const tabIndices = document.getElementById('tab-indices');
    const paneFields = document.getElementById('pane-fields');
    const paneIndices = document.getElementById('pane-indices');

    if (tabName === 'fields') {
      tabFields?.classList.add('active');
      tabIndices?.classList.remove('active');
      paneFields?.classList.add('active');
      paneIndices?.classList.remove('active');
    } else {
      tabIndices?.classList.add('active');
      tabFields?.classList.remove('active');
      paneIndices?.classList.add('active');
      paneFields?.classList.remove('active');
    }
  }

  _setupCamposHeroControls() {
    const toggleViewBtn = document.getElementById('btn-campos-view-mode');
    const addFieldBtn = document.getElementById('btn-campos-add-field');
    const refreshBtn = document.getElementById('btn-campos-refresh');

    if (toggleViewBtn) {
      toggleViewBtn.addEventListener('click', () => {
        const { fields, activeFieldId } = stateModel.getState();
        statsView.toggleCamposViewMode(fields, activeFieldId, (f) => this.selectField(f));
      });
    }

    if (addFieldBtn) {
      addFieldBtn.addEventListener('click', () => this.openFieldModal());
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        const { activePropertyId } = stateModel.getState();
        if (activePropertyId) await this.loadFields(activePropertyId);
      });
    }
  }

  _setupIndicesControls() {
    // Seletor Expandido de Índices (1:1 Alvo Certo)
    const pills = document.querySelectorAll('.index-pill');
    pills.forEach(pill => {
      pill.addEventListener('click', async () => {
        const indexType = pill.getAttribute('data-index');
        pills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        stateModel.setState({ selectedIndex: indexType });

        const { fields, activeFieldId } = stateModel.getState();
        const activeField = fields.find(f => f.id === activeFieldId);
        if (activeField) {
          await this.executeSpectralAnalysis(activeField);
        }
      });
    });

    // Slider de Filtro de Nuvens
    const cloudSlider = document.getElementById('cloud-slider');
    const cloudVal = document.getElementById('cloud-slider-val');
    if (cloudSlider && cloudVal) {
      cloudSlider.addEventListener('input', (e) => {
        cloudVal.textContent = `${e.target.value}%`;
      });
    }

    // Alternância de Modo (Raster Bicúbico vs Zonas de Manejo)
    const toggleBtn = document.getElementById('btn-toggle-view');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const { fields, activeFieldId, activeComputation } = stateModel.getState();
        const activeField = fields.find(f => f.id === activeFieldId);
        if (activeField && activeComputation) {
          const nextMode = heatmapView.toggleMode(mapView.getMap(), activeField.polygon, activeComputation);
          stateModel.setState({ viewMode: nextMode });
        }
      });
    }

    // Botão de Exportação CSV
    const exportBtn = document.getElementById('btn-export-csv');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const { selectedIndex } = stateModel.getState();
        statsView.exportCSV(selectedIndex);
      });
    }

    // Botão de login pelo estado Guest
    const guestLoginBtn = document.getElementById('btn-guest-login');
    if (guestLoginBtn) guestLoginBtn.addEventListener('click', () => authModalView.open('login'));
  }

  _setupPropertyAndFieldModals() {
    // Modal Fazenda (Propriedade)
    const propModal = document.getElementById('property-modal');
    const propClose = document.getElementById('property-modal-close');
    const propForm = document.getElementById('property-form');
    const pasteFarmBtn = document.getElementById('btn-paste-farm-snippet');

    if (propClose) propClose.addEventListener('click', () => this.closePropertyModal());
    if (propModal) {
      propModal.addEventListener('click', (e) => {
        if (e.target === propModal) this.closePropertyModal();
      });
    }

    if (propForm) {
      propForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('prop-name')?.value.trim();
        const municipality = document.getElementById('prop-municipality')?.value.trim();
        const car = document.getElementById('prop-car')?.value.trim();
        const errEl = document.getElementById('prop-error-msg');

        try {
          const newProp = await spectralModel.createProperty({ name, municipality, car });
          this.closePropertyModal();
          propForm.reset();
          await this.loadProperties();
          stateModel.setState({ activePropertyId: newProp.id });
          await this.loadFields(newProp.id);
        } catch (err) {
          if (errEl) {
            errEl.textContent = err.message || 'Erro ao cadastrar propriedade.';
            errEl.style.display = 'block';
          }
        }
      });
    }

    // Modal Talhão (Campo)
    const fieldModal = document.getElementById('field-modal');
    const fieldClose = document.getElementById('field-modal-close');
    const fieldForm = document.getElementById('field-form');
    const pasteFieldBtn = document.getElementById('btn-paste-field-snippet');

    if (fieldClose) fieldClose.addEventListener('click', () => this.closeFieldModal());
    if (fieldModal) {
      fieldModal.addEventListener('click', (e) => {
        if (e.target === fieldModal) this.closeFieldModal();
      });
    }

    if (fieldForm) {
      fieldForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('field-name')?.value.trim();
        const crop = document.getElementById('field-crop')?.value.trim();
        const geoRaw = document.getElementById('field-geojson')?.value.trim();
        const errEl = document.getElementById('field-error-msg');

        let polygon;
        try {
          polygon = JSON.parse(geoRaw);
          if (polygon.type !== 'Polygon' && polygon.geometry?.type === 'Polygon') {
            polygon = polygon.geometry;
          }
        } catch (parseErr) {
          if (errEl) {
            errEl.textContent = 'GeoJSON inválido: ' + parseErr.message;
            errEl.style.display = 'block';
          }
          return;
        }

        try {
          const propSelect = document.getElementById('field-property-select');
          const propertyId = propSelect?.value || stateModel.getState().activePropertyId;

          if (!propertyId) {
            if (errEl) {
              errEl.textContent = 'Cadastre ou selecione uma Fazenda antes de salvar o talhão.';
              errEl.style.display = 'block';
            }
            return;
          }

          const newField = await spectralModel.createField({
            propertyId,
            name,
            crop,
            polygon
          });

          this.closeFieldModal();
          fieldForm.reset();
          await this.loadFields(propertyId);
          await this.selectField(newField);
        } catch (err) {
          if (errEl) {
            errEl.textContent = err.message || 'Erro ao cadastrar talhão.';
            errEl.style.display = 'block';
          }
        }
      });
    }

    const modalNewPropBtn = document.getElementById('btn-modal-new-prop');
    if (modalNewPropBtn) {
      modalNewPropBtn.addEventListener('click', () => {
        this.openPropertyModal();
      });
    }
  }

  openPropertyModal() {
    const modal = document.getElementById('property-modal');
    if (modal) {
      const errEl = document.getElementById('prop-error-msg');
      if (errEl) errEl.style.display = 'none';
      modal.style.display = 'flex';
    }
  }

  closePropertyModal() {
    const modal = document.getElementById('property-modal');
    if (modal) modal.style.display = 'none';
  }

  openFieldModal() {
    const modal = document.getElementById('field-modal');
    if (modal) {
      const errEl = document.getElementById('field-error-msg');
      if (errEl) errEl.style.display = 'none';

      const propSelect = document.getElementById('field-property-select');
      const { properties, activePropertyId } = stateModel.getState();
      if (propSelect) {
        if (!properties || properties.length === 0) {
          propSelect.innerHTML = '<option value="">Nenhuma fazenda cadastrada — clique em + Nova Fazenda</option>';
        } else {
          propSelect.innerHTML = properties.map(p =>
            `<option value="${p.id}" ${p.id === activePropertyId ? 'selected' : ''}>${p.name}</option>`
          ).join('');
        }
      }

      modal.style.display = 'flex';
    }
  }

  closeFieldModal() {
    const modal = document.getElementById('field-modal');
    if (modal) modal.style.display = 'none';
  }
}

export const appController = new AppController();
