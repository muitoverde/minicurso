class StateModel {
  constructor() {
    this.state = {
      session: {
        authenticated: false,
        user: null,
        wallet: null
      },
      properties: [],
      activePropertyId: null,
      fields: [],
      activeFieldId: null,
      selectedIndex: 'NDVI',
      selectedDate: null,
      historicalSeries: [],
      activeComputation: null,
      viewMode: 'vector' // Padrão MVSky: Zonas de Manejo Vetoriais em Alta Qualidade (576 microzonas)
    };
    this.listeners = new Map();
  }

  getState() {
    return { ...this.state };
  }

  setState(updates) {
    const prevState = { ...this.state };
    this.state = { ...this.state, ...updates };

    this.emit('change', { prevState, currentState: this.state, updates });

    if (updates.session !== undefined) {
      this.emit('sessionChange', this.state.session);
    }
    if (updates.properties !== undefined || updates.activePropertyId !== undefined) {
      this.emit('propertiesChange', {
        properties: this.state.properties,
        activePropertyId: this.state.activePropertyId
      });
    }
    if (updates.fields !== undefined || updates.activeFieldId !== undefined) {
      this.emit('fieldsChange', {
        fields: this.state.fields,
        activeFieldId: this.state.activeFieldId
      });
    }
    if (updates.activeComputation !== undefined) {
      this.emit('computationChange', this.state.activeComputation);
    }
    if (updates.selectedIndex !== undefined) {
      this.emit('indexChange', this.state.selectedIndex);
    }
    if (updates.viewMode !== undefined) {
      this.emit('viewModeChange', this.state.viewMode);
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(data);
        } catch (err) {
          console.error(`[stateModel] Erro no listener do evento "${event}":`, err);
        }
      }
    }
  }
}

export const stateModel = new StateModel();
