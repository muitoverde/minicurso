import { randomBytes } from 'node:crypto';
import { config } from './config.js';

const sessions = new Map();
const COOKIE = 'mvsky_session';
const MAX_AGE = 8 * 60 * 60;
export function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
export async function parseJSONBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 5 * 1024 * 1024) throw Object.assign(new Error('Arquivo muito grande.'), { status: 413 });
  }
  try { return body ? JSON.parse(body) : {}; }
  catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
}
function sessionId(req) {
  return req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
}
export function getSession(req) {
  const id = sessionId(req);
  const session = sessions.get(id);
  if (session && session.expiresAt > Date.now()) return session;
  sessions.delete(id);
  return null;
}
function publicSession(session) {
  return { authenticated: !!session, user: session?.user || null, wallet: session?.wallet || null };
}
function cookie(res, id, maxAge) {
  res.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.SECURE_COOKIE ? '; Secure' : ''}`);
}
function failure(res, error) {
  return sendJSON(res, error.status || 502, { success: false, error: error.message, code: error.code, requestId: error.requestId });
}
async function requestJSON(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const detail = data.error;
    throw Object.assign(new Error(typeof detail === 'string' ? detail : detail?.message || data.message || `Serviço Muito Verde retornou HTTP ${response.status}.`), {
      status: response.ok ? 502 : response.status, code: detail?.code || data.code, requestId: detail?.requestId,
    });
  }
  return data;
}
export async function handleLogin(req, res) {
  try {
    const { email, password } = await parseJSONBody(req);
    if (!email?.trim() || !password) return sendJSON(res, 400, { success: false, error: 'Informe o e-mail e a senha da sua conta Muito Verde.' });
    if (!config.FIREBASE_API_KEY) return sendJSON(res, 503, { success: false, error: 'Configure FIREBASE_API_KEY do mesmo projeto Firebase usado pelo Alvo Certo.' });
    let auth;
    try {
      auth = await requestJSON(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(config.FIREBASE_API_KEY)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Referer': 'https://www.muitoverde.com.br'
        },
        body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true }),
      });
    } catch (error) {
      if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(error.message)) {
        error.message = 'E-mail ou senha incorretos.'; error.status = 401;
      }
      throw error;
    }
    // A chave B2B identifica o aplicativo de índices, nunca o produtor.
    let app = {};
    if (config.MUITOVERDE_API_KEY) {
      try {
        const result = await requestJSON(`${config.MUITOVERDE_BASE_URL}/api/b2b/v1/apps/me`, { headers: { 'X-API-Key': config.MUITOVERDE_API_KEY } });
        app = result.data || {};
      } catch { /* A indisponibilidade do serviço de índices não impede o acesso à conta. */ }
    }
    for (const [id, s] of sessions) if (s.expiresAt <= Date.now()) sessions.delete(id);
    sessions.delete(sessionId(req));

    let userWalletBalance = 'R$ 0,00';
    let userQuota = '0.0 / 100 ha';
    try {
      const [walletRes, propsRes] = await Promise.all([
        requestJSON(`${config.MUITOVERDE_BASE_URL}/api/wallet/balance`, { headers: { Authorization: `Bearer ${auth.idToken}` } }),
        requestJSON(`${config.MUITOVERDE_BASE_URL}/api/properties`, { headers: { Authorization: `Bearer ${auth.idToken}` } }),
      ]);
      if (walletRes?.data?.available !== undefined) {
        userWalletBalance = `R$ ${Number(walletRes.data.available).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
      }
      const rawProps = Array.isArray(propsRes) ? propsRes : (propsRes.properties || []);
      const totalHa = rawProps.reduce((sum, p) => sum + (Number(p.totalAreaHa) || 0), 0);
      const quotaLimit = app.accountTier === 'business_cnpj' ? 500 : 100;
      userQuota = `${totalHa.toFixed(1)} / ${quotaLimit} ha`;
    } catch { /* fallback não impeditivo */ }

    const id = randomBytes(32).toString('hex');
    const session = {
      idToken: auth.idToken, refreshToken: auth.refreshToken,
      tokenExpiresAt: Date.now() + Number(auth.expiresIn) * 1000,
      expiresAt: Date.now() + MAX_AGE * 1000,
      user: { id: auth.localId, name: auth.displayName || auth.email.split('@')[0], email: auth.email, environment: app.environment },
      wallet: {
        tier: app.accountTier === 'business_cnpj' ? 'CNPJ' : 'BÁSICO',
        quota: userQuota,
        balance: userWalletBalance,
        credits: app.creditsBalance ?? 0
      },
    };
    sessions.set(id, session);
    cookie(res, id, MAX_AGE);
    return sendJSON(res, 200, { success: true, session: publicSession(session) });
  } catch (error) { return failure(res, error); }
}
export function handleGetSession(req, res) { return sendJSON(res, 200, publicSession(getSession(req))); }
export function handleLogout(req, res) {
  sessions.delete(sessionId(req)); cookie(res, '', 0);
  return sendJSON(res, 200, { success: true, session: publicSession(null) });
}
async function accountRequest(req, path, method = 'GET', body) {
  const session = getSession(req);
  if (!session) throw Object.assign(new Error('Entre na sua conta Muito Verde para continuar.'), { status: 401 });
  if (session.tokenExpiresAt < Date.now() + 60000) {
    // Uma única renovação por sessão, mesmo com consultas simultâneas.
    session.refreshing ||= requestJSON(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(config.FIREBASE_API_KEY)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://www.muitoverde.com.br'
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken }).toString(),
    }).then(auth => {
      session.idToken = auth.id_token; session.refreshToken = auth.refresh_token;
      session.tokenExpiresAt = Date.now() + Number(auth.expires_in) * 1000;
    }).catch(error => { sessions.delete(sessionId(req)); throw error; }).finally(() => { delete session.refreshing; });
    await session.refreshing;
  }
  return requestJSON(`${config.MUITOVERDE_BASE_URL}${path}`, {
    method, headers: { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
export function sanitizeGeometryToPolygon(raw) {
  if (!raw) return null;
  let geom = raw;
  if (typeof geom === 'string') {
    try { geom = JSON.parse(geom); } catch { return null; }
  }
  if (!geom) return null;
  if (geom.type === 'Feature') geom = geom.geometry;
  if (geom.type === 'FeatureCollection' && Array.isArray(geom.features) && geom.features[0]) {
    geom = geom.features[0].geometry;
  }
  if (!geom || !geom.coordinates) return null;

  let rawCoords = geom.coordinates;
  if (geom.type === 'MultiPolygon') {
    rawCoords = rawCoords.reduce((best, poly) => {
      const len = Array.isArray(poly?.[0]) ? poly[0].length : 0;
      const bestLen = Array.isArray(best?.[0]) ? best[0].length : 0;
      return len > bestLen ? poly : best;
    }, rawCoords[0]) || [];
  }

  if (!Array.isArray(rawCoords)) return null;
  if (rawCoords.length === 0) {
    return { type: 'Polygon', coordinates: [] };
  }

  const rings = rawCoords.map(ring => {
    if (!Array.isArray(ring)) return [];
    return ring.map(pt => {
      if (Array.isArray(pt)) {
        return [Number(pt[0]), Number(pt[1])];
      }
      if (pt && typeof pt === 'object') {
        const lng = Number(pt.lng ?? pt.lon ?? pt.x);
        const lat = Number(pt.lat ?? pt.y);
        return [lng, lat];
      }
      return null;
    }).filter(pt => Array.isArray(pt) && !isNaN(pt[0]) && !isNaN(pt[1]));
  }).filter(ring => ring.length >= 3);

  if (rings.length === 0) return null;

  for (const ring of rings) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
  }

  return {
    type: 'Polygon',
    coordinates: rings
  };
}

export function mapProperty(p) {
  return { ...p, municipality: p.location_description || p.locationDescription || p.city || '', totalAreaHa: Number(p.total_area_ha || 0) };
}
export function mapField(f) {
  const polygon = sanitizeGeometryToPolygon(f.geometry || f.polygon);
  return { ...f, propertyId: f.property_id || f.propertyId, crop: f.primary_activity_species || f.primary_activity_category || '',
    areaHectares: Number(f.area_hectares || f.areaHectares || 0), polygon, latestNdvi: f.latest_ndvi ?? null, latestDate: f.latest_capture_date ?? null };
}
export async function handleGetProperties(req, res) {
  try {
    const data = await accountRequest(req, '/api/properties');
    return sendJSON(res, 200, { success: true, properties: (Array.isArray(data) ? data : data.properties || []).map(mapProperty) });
  } catch (error) { return failure(res, error); }
}
export async function handleGetFields(req, res, url) {
  try {
    const propertyId = url.searchParams.get('propertyId');
    const data = await accountRequest(req, '/api/fields' + (propertyId ? `?property_id=${encodeURIComponent(propertyId)}` : ''));
    return sendJSON(res, 200, { success: true, fields: (Array.isArray(data) ? data : data.fields || []).map(mapField) });
  } catch (error) { return failure(res, error); }
}
export async function handleMutation(req, res, resource, id) {
  try {
    const method = req.method;
    const payload = method === 'DELETE' ? {} : await parseJSONBody(req);
    if (method !== 'DELETE' && (typeof payload.name !== 'string' || !payload.name.trim())) {
      return sendJSON(res, 400, { success: false, error: 'Informe o nome.' });
    }
    const body = resource === 'properties'
      ? { name: payload.name?.trim(), location_description: payload.municipality?.trim() || '' }
      : { name: payload.name?.trim(), property_id: payload.propertyId, geometry: payload.polygon,
          primary_activity_category: payload.activityCategory || 'AGRICULTURA', primary_activity_species: payload.crop || '' };
    const data = await accountRequest(req, `/api/${resource}${id ? '/' + encodeURIComponent(id) : ''}`, method, method === 'DELETE' ? undefined : body);
    if (method === 'DELETE') return sendJSON(res, 200, { success: true });
    const key = resource === 'properties' ? 'property' : 'field';
    return sendJSON(res, method === 'POST' ? 201 : 200, { success: true, [key]: (key === 'property' ? mapProperty : mapField)(data[key] || data) });
  } catch (error) { return failure(res, error); }
}
export const handleCreateProperty = (req, res) => handleMutation(req, res, 'properties');
export const handleCreateField = (req, res) => handleMutation(req, res, 'fields');
