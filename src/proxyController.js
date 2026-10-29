import { config } from './config.js';

let inMemorySession = {
  authenticated: false,
  apiKey: null,
  user: null,
  wallet: null
};

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function parseJSONBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON: ' + err.message));
      }
    });
    req.on('error', reject);
  });
}

function getEffectiveApiKey() {
  return inMemorySession.apiKey || (config.MUITOVERDE_API_KEY ? String(config.MUITOVERDE_API_KEY).trim() : null);
}

// 1. Rota de Login (Validação Direta via API Muito Verde)
export async function handleLogin(req, res) {
  try {
    const payload = await parseJSONBody(req);
    let keyToUse = payload.apiKey ? String(payload.apiKey).trim() : '';
    keyToUse = keyToUse.replace(/^['"`]|['"`]$/g, '').trim();

    if (!keyToUse) {
      keyToUse = config.MUITOVERDE_API_KEY ? String(config.MUITOVERDE_API_KEY).trim() : '';
      keyToUse = keyToUse.replace(/^['"`]|['"`]$/g, '').trim();
    }

    if (!keyToUse || keyToUse === 'INSIRA_SUA_CHAVE_AQUI') {
      return sendJSON(res, 401, {
        success: false,
        error: 'Chave de API B2B não configurada no .env.local (MUITOVERDE_API_KEY).'
      });
    }

    const checkUrl = `${config.MUITOVERDE_BASE_URL}/api/b2b/v1/apps/me`;
    let response;
    let appData = {};

    try {
      response = await fetch(checkUrl, {
        method: 'GET',
        headers: {
          'X-API-Key': keyToUse,
          'Authorization': `Bearer ${keyToUse}`,
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        const json = await response.json();
        appData = json.data || {};
      } else {
        const errJson = await response.json().catch(() => ({}));
        return sendJSON(res, response.status, {
          success: false,
          error: errJson.error?.message || errJson.message || 'Chave de API não autorizada na Muito Verde.'
        });
      }
    } catch (netErr) {
      console.warn('[proxyController] Consulta externa ao apps/me falhou:', netErr.message);
      return sendJSON(res, 502, {
        success: false,
        error: 'Falha na conexão com a Muito Verde para validar a chave.'
      });
    }

    const isCnpj = appData.accountTier === 'business_cnpj';
    const userEmail = payload.email ? String(payload.email).trim() : '';
    const userName = userEmail ? userEmail.split('@')[0] : (appData.name || 'Produtor Muito Verde');

    inMemorySession = {
      authenticated: true,
      apiKey: keyToUse,
      user: {
        id: appData.appId || 'mv-produtor',
        name: userName,
        email: userEmail || 'produtor@muitoverde.com.br',
        tier: isCnpj ? 'CNPJ' : 'BÁSICO',
        environment: appData.environment || 'sandbox'
      },
      wallet: {
        tier: isCnpj ? 'CNPJ' : 'BÁSICO',
        quota: '—',
        balance: '—',
        credits: appData.creditsBalance ?? 0
      }
    };

    return sendJSON(res, 200, {
      success: true,
      session: {
        authenticated: true,
        user: inMemorySession.user,
        wallet: inMemorySession.wallet
      }
    });
  } catch (err) {
    return sendJSON(res, 500, {
      success: false,
      error: 'Erro interno ao autenticar com a Muito Verde: ' + err.message
    });
  }
}

// 2. Consulta de Sessão
export function handleGetSession(req, res) {
  return sendJSON(res, 200, {
    authenticated: Boolean(inMemorySession.authenticated),
    user: inMemorySession.user || null,
    wallet: inMemorySession.wallet || null
  });
}

// 3. Logout
export function handleLogout(req, res) {
  inMemorySession = {
    authenticated: false,
    apiKey: null,
    user: null,
    wallet: null
  };

  return sendJSON(res, 200, {
    success: true,
    session: {
      authenticated: false,
      user: null,
      wallet: null
    }
  });
}

// 4. Listagem de Propriedades (Fazendas) — 100% via API Muito Verde
export async function handleGetProperties(req, res) {
  const effectiveApiKey = getEffectiveApiKey();

  if (!effectiveApiKey || effectiveApiKey === 'INSIRA_SUA_CHAVE_AQUI') {
    return sendJSON(res, 200, { success: true, properties: [] });
  }

  try {
    const response = await fetch(`${config.MUITOVERDE_BASE_URL}/api/b2b/v1/geo/properties`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-API-Key': effectiveApiKey,
      },
    });

    if (response.ok) {
      const json = await response.json();
      const rawProps = json.data?.properties || json.properties || [];
      const apiProperties = rawProps.map(p => ({
        id: p.id,
        name: p.name,
        municipality: p.municipality || p.locationDescription || p.city || 'Rondônia',
        car: p.carCode || p.idaronCode || p.car || '',
        totalAreaHa: p.totalAreaHa || 0,
        fieldsCount: p.fieldsCount || 0,
      }));
      return sendJSON(res, 200, { success: true, properties: apiProperties });
    }
  } catch (err) {
    console.warn('[proxyController] Consulta de propriedades via API falhou:', err.message);
  }

  return sendJSON(res, 200, { success: true, properties: [] });
}

// 5. Cadastro de Propriedade — Via API Muito Verde de Produção
export async function handleCreateProperty(req, res) {
  try {
    const payload = await parseJSONBody(req);
    const { name, municipality, car } = payload;

    if (!name || !municipality) {
      return sendJSON(res, 400, {
        success: false,
        error: 'Campos "name" e "municipality" são obrigatórios.'
      });
    }

    const effectiveApiKey = getEffectiveApiKey();
    if (!effectiveApiKey || effectiveApiKey === 'INSIRA_SUA_CHAVE_AQUI') {
      return sendJSON(res, 401, {
        success: false,
        error: 'Sessão não autenticada com a Muito Verde.'
      });
    }

    const response = await fetch(`${config.MUITOVERDE_BASE_URL}/api/b2b/v1/geo/properties`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': effectiveApiKey,
      },
      body: JSON.stringify({
        name: name.trim(),
        municipality: municipality.trim(),
        car: (car || '').trim(),
      }),
    });

    const json = await response.json();
    if (!response.ok || json.success === false) {
      return sendJSON(res, response.status, {
        success: false,
        error: json.error?.message || json.error || 'Falha ao salvar propriedade no banco de produção.'
      });
    }

    const createdProp = json.data?.property || json.property || json;
    return sendJSON(res, 201, {
      success: true,
      property: {
        id: createdProp.id,
        name: createdProp.name,
        municipality: createdProp.municipality || municipality,
        car: createdProp.car || car || '',
      }
    });
  } catch (err) {
    return sendJSON(res, 500, {
      success: false,
      error: 'Erro ao cadastrar propriedade na Muito Verde: ' + err.message
    });
  }
}

// 6. Listagem de Talhões — 100% via Banco de Dados de Produção da Muito Verde
export async function handleGetFields(req, res, url) {
  const propertyId = url.searchParams.get('propertyId');
  const effectiveApiKey = getEffectiveApiKey();

  if (!effectiveApiKey || effectiveApiKey === 'INSIRA_SUA_CHAVE_AQUI') {
    return sendJSON(res, 200, { success: true, fields: [] });
  }

  try {
    const response = await fetch(`${config.MUITOVERDE_BASE_URL}/api/b2b/v1/geo/fields`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-API-Key': effectiveApiKey,
      },
    });

    if (response.ok) {
      const json = await response.json();
      const apiFields = json.data?.fields || [];
      const mapped = apiFields.map(f => ({
        id: f.id,
        propertyId: f.propertyId || propertyId || null,
        name: f.name,
        crop: f.crop || 'SAF Agroflorestal',
        areaHectares: f.areaHectares || 0,
        polygon: f.geometry || f.polygon,
        latestNdvi: f.latestNdvi || null,
        latestDate: f.latestCaptureDate || null,
        source: f.source || 'muitoverde_production',
      }));

      const filtered = propertyId ? mapped.filter(f => !f.propertyId || f.propertyId === propertyId) : mapped;
      return sendJSON(res, 200, { success: true, fields: filtered });
    }
  } catch (err) {
    console.warn('[proxyController] Consulta de talhões via API falhou:', err.message);
  }

  return sendJSON(res, 200, { success: true, fields: [] });
}

// 7. Cadastro de Talhão — 100% Persistido no Banco de Dados da Muito Verde
export async function handleCreateField(req, res) {
  try {
    const payload = await parseJSONBody(req);
    const { propertyId, name, crop, polygon } = payload;

    if (!name || !crop || !polygon) {
      return sendJSON(res, 400, {
        success: false,
        error: 'Campos "name", "crop" e "polygon" são obrigatórios.',
      });
    }

    const effectiveApiKey = getEffectiveApiKey();
    if (!effectiveApiKey || effectiveApiKey === 'INSIRA_SUA_CHAVE_AQUI') {
      return sendJSON(res, 401, {
        success: false,
        error: 'Sessão não autenticada com a Muito Verde.'
      });
    }

    const response = await fetch(`${config.MUITOVERDE_BASE_URL}/api/b2b/v1/geo/fields`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': effectiveApiKey,
      },
      body: JSON.stringify({
        name: name.trim(),
        crop: crop.trim(),
        propertyId: propertyId || undefined,
        polygon,
      }),
    });

    const json = await response.json();
    if (!response.ok || json.success === false) {
      return sendJSON(res, response.status, {
        success: false,
        error: json.error?.message || json.error || 'Falha ao salvar talhão no banco de produção.'
      });
    }

    const createdField = json.data?.field || json.field || json;
    return sendJSON(res, 201, {
      success: true,
      field: {
        id: createdField.id,
        propertyId: createdField.propertyId || propertyId || null,
        name: createdField.name,
        crop: createdField.crop,
        areaHectares: createdField.areaHectares,
        polygon: createdField.geometry || createdField.polygon,
        source: 'muitoverde_production'
      }
    });
  } catch (err) {
    return sendJSON(res, 500, {
      success: false,
      error: 'Erro ao cadastrar talhão na Muito Verde: ' + err.message
    });
  }
}

// 8. Análise Espectral Sentinel-2 — Geoprocessamento Orbital Direto na Muito Verde
export async function handleAnalyze(req, res) {
  try {
    const payload = await parseJSONBody(req);
    const effectiveApiKey = getEffectiveApiKey();
    if (!effectiveApiKey || effectiveApiKey === 'INSIRA_SUA_CHAVE_AQUI') {
      return sendJSON(res, 401, {
        success: false,
        error: 'Sessão não autenticada. Forneça sua Chave de API da Muito Verde.'
      });
    }

    if (payload.indexType === 'RGB') {
      const captureDate = payload.date || payload.startDate || new Date().toISOString().slice(0, 10);
      return sendJSON(res, 200, {
        success: true,
        data: {
          computation: {
            indexType: 'RGB',
            captureDate,
            stats: { min: null, max: null, mean: null, stdDev: null },
            areaHectares: payload.areaHectares || 0,
            historicalSeries: []
          }
        }
      });
    }

    if (payload.date) {
      if (!payload.startDate) payload.startDate = payload.date;
      if (!payload.endDate) payload.endDate = payload.date;
      delete payload.date;
    }

    const sanitizedParams = {};
    const allowedKeys = ['fieldId', 'polygon', 'indexType', 'startDate', 'endDate', 'maxCloudCover', 'idempotencyKey'];
    for (const key of allowedKeys) {
      if (payload[key] !== undefined && payload[key] !== null) {
        sanitizedParams[key] = payload[key];
      }
    }

    const idempotencyKey = sanitizedParams.idempotencyKey ||
      req.headers['idempotency-key'] ||
      'mvsky_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    const apiUrl = `${config.MUITOVERDE_BASE_URL}/api/b2b/v1/geo/spectral-index`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': effectiveApiKey,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(sanitizedParams)
    });

    const responseBody = await response.text();
    let data;
    try {
      data = JSON.parse(responseBody);
    } catch {
      data = { raw: responseBody };
    }

    const balanceAfter = data?.data?.metering?.balanceAfter ?? data?.metering?.balanceAfter;
    if (inMemorySession.authenticated && balanceAfter !== undefined && balanceAfter !== null) {
      inMemorySession.wallet.credits = balanceAfter;
    }

    return sendJSON(res, response.status, data);
  } catch (err) {
    return sendJSON(res, 500, {
      success: false,
      error: 'Erro ao conectar à API de geoprocessamento da Muito Verde: ' + err.message
    });
  }
}
