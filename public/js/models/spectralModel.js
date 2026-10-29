class SpectralModel {
  async getSession() {
    const res = await fetch('/api/auth/session');
    if (!res.ok) throw new Error('Falha ao obter sessão');
    return await res.json();
  }

  async login(credentials = {}) {
    const payload = typeof credentials === 'string' ? { apiKey: credentials } : credentials;
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Credenciais inválidas na Muito Verde.');
    }
    return data;
  }

  async logout() {
    const res = await fetch('/api/auth/logout', { method: 'POST' });
    return await res.json();
  }

  async getProperties() {
    const res = await fetch('/api/properties');
    if (!res.ok) throw new Error('Falha ao listar fazendas');
    const data = await res.json();
    return data.properties || [];
  }

  async createProperty(propertyData) {
    const res = await fetch('/api/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(propertyData)
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Falha ao cadastrar propriedade');
    }
    return data.property;
  }

  async getFields(propertyId = '') {
    const url = propertyId ? `/api/fields?propertyId=${encodeURIComponent(propertyId)}` : '/api/fields';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Falha ao listar talhões');
    const data = await res.json();
    return data.fields || [];
  }

  async createField(fieldData) {
    const res = await fetch('/api/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fieldData)
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Falha ao cadastrar talhão');
    }
    return data.field;
  }

  async analyze({ fieldId, polygon, indexType = 'NDVI', date, startDate, endDate, maxCloudCover = 20 }) {
    // REGRA MANDATÓRIA: Nunca envia a chave date. Filtra por startDate e endDate.
    const effectiveStart = startDate || date || new Date().toISOString().split('T')[0];
    const effectiveEnd = endDate || date || effectiveStart;

    const payload = {
      indexType,
      startDate: effectiveStart,
      endDate: effectiveEnd,
      maxCloudCover
    };

    if (polygon) {
      payload.polygon = polygon;
    } else if (fieldId) {
      payload.fieldId = fieldId;
    }

    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error?.message || data.error || 'Erro no geoprocessamento orbital da Muito Verde.');
    }

    const comp = data.data?.computation || data.data || data;

    // Normalização completa preservando metadados biofísicos oficiais
    return {
      ...comp,
      indexType: comp.indexType || indexType,
      stats: comp.stats || comp.statistics || {},
      statistics: comp.stats || comp.statistics || {},
      legend: comp.legend || [],
      spatialGrid: comp.spatialGrid || comp.matrix || null,
      vectorLayer: comp.vectorLayer || null,
      diagnostic: comp.diagnostic || comp.summary || null,
      summary: comp.diagnostic || comp.summary || null,
      historicalSeries: comp.historicalSeries || [],
      bbox: comp.bbox || null,
      areaHectares: comp.areaHectares || comp.stats?.areaHectares || 0,
      cloudCoverPct: comp.cloudCoverPct ?? 0,
      captureDate: comp.captureDate || null,
      metering: data.metering || data.data?.metering || null
    };
  }
}

export const spectralModel = new SpectralModel();
