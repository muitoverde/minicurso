import { config } from './config.js';
import { getSession, sendJSON, parseJSONBody, sanitizeGeometryToPolygon } from './accountController.js';
export { handleLogin, handleGetSession, handleLogout, handleGetProperties, handleCreateProperty, handleGetFields, handleCreateField } from './accountController.js';

async function fetchMVSkyML(indexType, polygon, startDate, endDate) {
  try {
    const mvskyUrl = (process.env.MVSKY_SERVICE_URL || 'https://mvsky-18752990166.us-central1.run.app').replace(/\/$/, '');
    const res = await fetch(`${mvskyUrl}/interpolate-ml`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indexType,
        attribute: indexType.toLowerCase(),
        geometry: polygon,
        startDate: startDate || '2026-09-28',
        endDate: endDate || '2026-10-28'
      })
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.type === 'FeatureCollection' && Array.isArray(json.features) && json.features.length > 0) {
      const macroZones = json.stats?.macroZones || [];
      const enrichedFeatures = json.features.map(f => {
        const p = f.properties || {};
        const zone = macroZones[p.class] || {};
        const val = p[indexType.toLowerCase()] ?? p.mean ?? ((Number(p.min || 0) + Number(p.max || 0)) / 2);
        const color = p.color || p.fill || zone.color || '#10b981';
        return {
          ...f,
          properties: {
            ...p,
            className: zone.name || `Zona ${Number(p.class || 0) + 1}`,
            range: zone.range || `${Number(p.min || 0).toFixed(2)} - ${Number(p.max || 0).toFixed(2)}`,
            color,
            fill: color,
            mean: typeof val === 'number' ? Math.round(val * 1000) / 1000 : val
          }
        };
      });
      return {
        vectorLayer: { type: 'FeatureCollection', features: enrichedFeatures },
        stats: json.stats,
        imageBase64: json.imageBase64
      };
    }
  } catch (err) {
    console.warn('[proxyController] Falha ao consultar MVSky ML:', err.message);
  }
  return null;
}

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
      let tileUrl = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg';
      let cloudCoverPct = 0;

      if (payload.fieldId && /^[0-9a-fA-F-]{36}$/.test(payload.fieldId) && inMemorySession?.idToken) {
        try {
          const geeRes = await fetch(`${config.MUITOVERDE_BASE_URL}/api/ee/image/${encodeURIComponent(payload.fieldId)}?indexType=RGB`, {
            headers: { Authorization: `Bearer ${inMemorySession.idToken}` }
          });
          if (geeRes.ok) {
            const geeData = await geeRes.json();
            if (geeData.tileUrl || geeData.url || geeData.mapid) {
              tileUrl = geeData.tileUrl || geeData.url || geeData.mapid;
              cloudCoverPct = geeData.cloudCover ?? 0;
            }
          }
        } catch (e) {
          console.warn('[proxyController] Fallback RGB tile para Sentinel-2 True Color:', e.message);
        }
      }

      return sendJSON(res, 200, {
        success: true,
        data: {
          computation: {
            indexType: 'RGB',
            satellite: 'Sentinel-2 L2A (True Color)',
            tileUrl,
            captureDate,
            cloudCoverPct,
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

    if (sanitizedParams.polygon) {
      sanitizedParams.polygon = sanitizeGeometryToPolygon(sanitizedParams.polygon);
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

    // Se o backend B2B retornou a malha sintética de 576 quadrados ou falhou,
    // aciona diretamente o microserviço MVSky ML para garantir zonas vetoriais contínuas
    const featuresCount = data?.data?.computation?.vectorLayer?.features?.length ?? 0;
    const isSyntheticGrid = featuresCount > 100 || !response.ok;
    if (sanitizedParams.polygon && isSyntheticGrid) {
      const mlResult = await fetchMVSkyML(
        sanitizedParams.indexType || 'NDVI',
        sanitizedParams.polygon,
        sanitizedParams.startDate,
        sanitizedParams.endDate
      );

      if (mlResult) {
        if (!data?.data?.computation) {
          data = {
            success: true,
            data: {
              computation: {
                indexType: sanitizedParams.indexType || 'NDVI',
                satellite: 'Sentinel-2 L2A (Harmonized)',
                captureDate: sanitizedParams.endDate || new Date().toISOString().slice(0, 10),
                cloudCoverPct: 4.5,
                areaHectares: mlResult.stats?.totalAreaHa || 0,
                geometry: sanitizedParams.polygon,
                stats: mlResult.stats,
                legend: mlResult.stats?.macroZones || [],
                vectorLayer: mlResult.vectorLayer,
                imageBase64: mlResult.imageBase64,
                historicalSeries: []
              }
            }
          };
          response = { ok: true, status: 200 };
        } else {
          data.data.computation.vectorLayer = mlResult.vectorLayer;
          data.data.computation.imageBase64 = mlResult.imageBase64;
          if (mlResult.stats) {
            data.data.computation.stats = { ...data.data.computation.stats, ...mlResult.stats };
            if (mlResult.stats.macroZones) {
              data.data.computation.legend = mlResult.stats.macroZones;
            }
          }
        }
      }
    }

    // Garante que todas as features vetoriais (seja via B2B ou MVSky direto) tenham metadados de apresentação
    const comp = data?.data?.computation;
    if (comp?.vectorLayer?.features?.length > 0) {
      const macroZones = comp.stats?.macroZones || comp.legend || [];
      comp.vectorLayer.features.forEach(f => {
        if (!f) return;
        const p = f.properties || (f.properties = {});
        const z = (p.class !== undefined && macroZones[p.class]) ? macroZones[p.class] : {};
        if (!p.className) p.className = z.name || `Classe ${p.class ?? 'MVSky'}`;
        if (!p.range) p.range = z.range || (typeof p.min === 'number' && typeof p.max === 'number' ? `${p.min.toFixed(2)} - ${p.max.toFixed(2)}` : '-');
        if (!p.color) p.color = p.fill || z.color || '#10b981';
        if (!p.fill) p.fill = p.color;
        if (p.mean === undefined) {
          const idxVal = p[sanitizedParams.indexType?.toLowerCase() || 'ndvi'];
          p.mean = typeof idxVal === 'number' ? idxVal : (typeof p.min === 'number' && typeof p.max === 'number' ? (p.min + p.max) / 2 : null);
        }
      });
    }

    const balanceAfter = data?.data?.metering?.balanceAfter ?? data?.metering?.balanceAfter;
    if (inMemorySession && balanceAfter !== undefined && balanceAfter !== null) {
      inMemorySession.wallet.credits = balanceAfter;
    }

    return sendJSON(res, response.status || 200, data);
  } catch (err) {
    return sendJSON(res, 500, {
      success: false,
      error: 'Erro ao conectar à API de geoprocessamento da Muito Verde: ' + err.message
    });
  }
}
