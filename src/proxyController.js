import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Garante existência da pasta data e do banco local db.json
function ensureDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      const initial = {
        session: {
          authenticated: false,
          apiKey: null,
          user: null,
          wallet: null
        },
        properties: [],
        fields: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error('[proxyController] Erro ao inicializar db.json:', err);
  }
}

ensureDb();

function readDb() {
  try {
    ensureDb();
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[proxyController] Erro ao ler db.json:', err);
    return {
      session: { authenticated: false, apiKey: null, user: null, wallet: null },
      properties: [],
      fields: []
    };
  }
}

function writeDb(data) {
  try {
    ensureDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[proxyController] Erro ao salvar db.json:', err);
  }
}

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

// 1. Rota de Login (Validação Direta via API Muito Verde)
export async function handleLogin(req, res) {
  try {
    const payload = await parseJSONBody(req);
    // Puxa chave do payload ou automaticamente do .env.local (MUITOVERDE_API_KEY)
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
    const db = readDb();
    const userEmail = payload.email ? String(payload.email).trim() : '';
    const userName = userEmail ? userEmail.split('@')[0] : (appData.name || 'Produtor Muito Verde');

    db.session = {
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

    writeDb(db);

    return sendJSON(res, 200, {
      success: true,
      session: {
        authenticated: true,
        user: db.session.user,
        wallet: db.session.wallet
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
  const db = readDb();
  return sendJSON(res, 200, {
    authenticated: Boolean(db.session?.authenticated),
    user: db.session?.user || null,
    wallet: db.session?.wallet || null
  });
}

// 3. Logout
export function handleLogout(req, res) {
  const db = readDb();
  db.session = {
    authenticated: false,
    apiKey: null,
    user: null,
    wallet: null
  };
  writeDb(db);

  return sendJSON(res, 200, {
    success: true,
    session: {
      authenticated: false,
      user: null,
      wallet: null
    }
  });
}

// 4. Listagem de Propriedades (Fazendas)
export function handleGetProperties(req, res) {
  const db = readDb();
  return sendJSON(res, 200, {
    success: true,
    properties: db.properties || []
  });
}

// 5. Cadastro de Propriedade
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

    const db = readDb();
    const newProperty = {
      id: 'prop_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      name: name.trim(),
      municipality: municipality.trim(),
      car: (car || '').trim(),
      createdAt: new Date().toISOString()
    };

    db.properties = db.properties || [];
    db.properties.push(newProperty);
    writeDb(db);

    return sendJSON(res, 201, {
      success: true,
      property: newProperty
    });
  } catch (err) {
    return sendJSON(res, 400, {
      success: false,
      error: err.message
    });
  }
}

// 6. Listagem de Talhões (Campos)
export function handleGetFields(req, res, url) {
  const db = readDb();
  const propertyId = url.searchParams.get('propertyId');
  const allFields = db.fields || [];
  const filtered = propertyId ? allFields.filter(f => f.propertyId === propertyId) : allFields;

  return sendJSON(res, 200, {
    success: true,
    fields: filtered
  });
}

// 7. Cadastro de Talhão
export async function handleCreateField(req, res) {
  try {
    const payload = await parseJSONBody(req);
    const { propertyId, name, crop, polygon } = payload;

    if (!name || !crop || !polygon) {
      return sendJSON(res, 400, {
        success: false,
        error: 'Campos "name", "crop" e "polygon" são obrigatórios.'
      });
    }

    const db = readDb();
    let effectivePropId = propertyId;
    if (!effectivePropId && db.properties?.length > 0) {
      effectivePropId = db.properties[0].id;
    }

    // Calcula área em hectares estimada a partir do polígono se não fornecida
    let calculatedArea = 0;
    try {
      const coords = polygon.coordinates?.[0] || [];
      if (coords.length >= 3) {
        let area = 0;
        for (let i = 0; i < coords.length - 1; i++) {
          area += (coords[i][0] * coords[i + 1][1]) - (coords[i + 1][0] * coords[i][1]);
        }
        area = Math.abs(area) / 2;
        // Conversão aproximada para hectares (~111.32km por grau)
        calculatedArea = Math.round(area * 111320 * 111320 * Math.cos(-9.94 * Math.PI / 180) / 10000 * 10) / 10;
      }
    } catch {}

    const newField = {
      id: 'field_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      propertyId: effectivePropId || null,
      name: name.trim(),
      crop: crop.trim(),
      areaHectares: calculatedArea > 0 ? calculatedArea : 4.8,
      polygon,
      createdAt: new Date().toISOString()
    };

    db.fields = db.fields || [];
    db.fields.push(newField);
    writeDb(db);

    return sendJSON(res, 201, {
      success: true,
      field: newField
    });
  } catch (err) {
    return sendJSON(res, 400, {
      success: false,
      error: err.message
    });
  }
}

// 8. Análise Espectral Sentinel-2 (Proxy Seguro para Muito Verde / MVSky)
export async function handleAnalyze(req, res) {
  try {
    const payload = await parseJSONBody(req);
    const db = readDb();
    const effectiveApiKey = db.session?.apiKey || config.MUITOVERDE_API_KEY;
    if (!effectiveApiKey || effectiveApiKey === 'INSIRA_SUA_CHAVE_AQUI') {
      return sendJSON(res, 401, {
        success: false,
        error: 'Sessão não autenticada. Forneça sua Chave de API da Muito Verde.'
      });
    }

    // Interceptação de índices ópticos/topográficos não suportados no endpoint Zod da B2B API
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

    // Conversão do date para startDate e endDate obrigatórios no schema .strict()
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

    // Se o polígono geométrico estiver presente e o fieldId for local, envia o polígono
    if (sanitizedParams.polygon && sanitizedParams.fieldId && sanitizedParams.fieldId.startsWith('field_')) {
      delete sanitizedParams.fieldId;
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
    if (db.session?.authenticated && balanceAfter !== undefined && balanceAfter !== null) {
      db.session.wallet.credits = balanceAfter;
      writeDb(db);
    }

    return sendJSON(res, response.status, data);
  } catch (err) {
    return sendJSON(res, 500, {
      success: false,
      error: 'Erro ao conectar à API de geoprocessamento da Muito Verde: ' + err.message
    });
  }
}
