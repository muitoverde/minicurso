import { config } from './config.js';
import { getSession, sendJSON, parseJSONBody } from './accountController.js';
export { handleLogin, handleGetSession, handleLogout, handleGetProperties, handleCreateProperty, handleGetFields, handleCreateField } from './accountController.js';

// 8. Análise Espectral Sentinel-2 — Geoprocessamento Orbital Direto na Muito Verde
export async function handleAnalyze(req, res) {
  try {
    const payload = await parseJSONBody(req);
    const inMemorySession = getSession(req);
    if (!inMemorySession) return sendJSON(res, 401, { success: false, error: 'Entre na sua conta Muito Verde.' });
    const effectiveApiKey = config.MUITOVERDE_API_KEY;
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

    if (sanitizedParams.polygon && Array.isArray(sanitizedParams.polygon.coordinates)) {
      sanitizedParams.polygon = {
        type: 'Polygon',
        coordinates: sanitizedParams.polygon.coordinates.map(ring =>
          Array.isArray(ring)
            ? ring.map(pt => [Number(pt[0]), Number(pt[1])])
            : ring
        )
      };
    }

    const idempotencyKey = sanitizedParams.idempotencyKey ||
      req.headers['idempotency-key'] ||
      'mvsky_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    const apiUrl = `${config.MUITOVERDE_BASE_URL}/api/b2b/v1/geo/spectral-index`;
    let response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': effectiveApiKey,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(sanitizedParams)
    });

    if (!response.ok && sanitizedParams.fieldId && sanitizedParams.polygon) {
      const fallbackParams = { ...sanitizedParams };
      delete fallbackParams.fieldId;
      const retryResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': effectiveApiKey,
          'Idempotency-Key': idempotencyKey + '_fb'
        },
        body: JSON.stringify(fallbackParams)
      });
      if (retryResponse.ok) {
        response = retryResponse;
      }
    }

    const responseBody = await response.text();
    let data;
    try {
      data = JSON.parse(responseBody);
    } catch {
      data = { raw: responseBody };
    }

    const balanceAfter = data?.data?.metering?.balanceAfter ?? data?.metering?.balanceAfter;
    if (inMemorySession && balanceAfter !== undefined && balanceAfter !== null) {
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
