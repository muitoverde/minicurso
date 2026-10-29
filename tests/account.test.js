import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { config } from '../src/config.js';
import * as account from '../src/accountController.js';
import { handleAnalyze } from '../src/proxyController.js';

config.FIREBASE_API_KEY = 'test-public-key';
config.MUITOVERDE_API_KEY = 'test-b2b-key';
function invoke(handler, { body, cookie, method = 'GET', args = [] } = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method; req.headers = { cookie };
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = { setHeader: (k, v) => { headers[k] = v; }, writeHead: (status) => { res.status = status; },
      end: raw => resolve({ status: res.status, data: JSON.parse(raw), cookie: headers['Set-Cookie']?.split(';')[0] }) };
    Promise.resolve(handler(req, res, ...args)).catch(reject);
  });
}
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
async function login(email = 'a@example.test', expiresIn = 3600) {
  global.fetch = async (url, options) => {
    if (url.includes('identitytoolkit')) {
      assert.equal(JSON.parse(options.body).password, 'password');
      return reply({ idToken: email, refreshToken: 'refresh', localId: email, email, expiresIn });
    }
    return reply({ data: { accountTier: 'email_sandbox', creditsBalance: 100 } });
  };
  return invoke(account.handleLogin, { method: 'POST', body: { email, password: 'password' } });
}

test('integração da conta, isolada e sem alterações em produção', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  await t.test('API key sozinha não autentica produtor', async () => {
    const result = await invoke(account.handleLogin, { body: { apiKey: 'key' } });
    assert.equal(result.status, 400);
    assert.equal((await invoke(account.handleGetProperties)).status, 401);
  });
  await t.test('senha inválida não cria sessão', async () => {
    global.fetch = async () => reply({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, 400);
    const r = await invoke(account.handleLogin, { body: { email: 'a@test.com', password: 'wrong' } });
    assert.equal(r.status, 401); assert.equal(r.cookie, undefined);
  });
  const a = await login();
  const b = await login('b@example.test');
  await t.test('sessões independentes, tokens ausentes da resposta', async () => {
    assert.notEqual(a.cookie, b.cookie);
    assert.equal(JSON.stringify(a.data).includes('refreshToken'), false);
    assert.equal((await invoke(account.handleGetSession, { cookie: a.cookie })).data.user.email, 'a@example.test');
    assert.equal((await invoke(account.handleGetSession, { cookie: b.cookie })).data.user.email, 'b@example.test');
  });
  await t.test('listagem usa token do produtor e rotas do Alvo Certo', async () => {
    global.fetch = async (url, options) => {
      assert.ok(url.endsWith('/api/properties'));
      assert.equal(options.headers.Authorization, 'Bearer a@example.test');
      assert.equal(options.headers['X-API-Key'], undefined);
      return reply([{ id: 'p', name: 'Fazenda', location_description: 'RO' }]);
    };
    const r = await invoke(account.handleGetProperties, { cookie: a.cookie });
    assert.equal(r.data.properties[0].municipality, 'RO');
  });
  await t.test('503 permanece erro, nunca lista vazia bem-sucedida', async () => {
    global.fetch = async () => reply({ error: { message: 'Indisponível', code: 'SERVICE_UNAVAILABLE', requestId: 'trace' } }, 503);
    const r = await invoke(account.handleGetProperties, { cookie: a.cookie });
    assert.equal(r.status, 503); assert.equal(r.data.success, false); assert.equal(r.data.requestId, 'trace');
  });
  await t.test('cadastro aceita localização opcional e usa contrato correto', async () => {
    global.fetch = async (url, options) => {
      assert.deepEqual(JSON.parse(options.body), { name: 'Fazenda', location_description: '' });
      return reply({ id: 'p', name: 'Fazenda' }, 201);
    };
    const r = await invoke(account.handleCreateProperty, { cookie: a.cookie, method: 'POST', body: { name: ' Fazenda ' } });
    assert.equal(r.status, 201); assert.equal(r.data.property.id, 'p');
  });
  await t.test('talhões filtrados por fazenda e GeoJSON desserializado', async () => {
    global.fetch = async url => {
      assert.ok(url.endsWith('/api/fields?property_id=p'));
      return reply([{ id: 'f', property_id: 'p', area_hectares: '2.4', geometry: '{"type":"Polygon","coordinates":[]}' }]);
    };
    const r = await invoke(account.handleGetFields, { cookie: a.cookie, args: [new URL('http://localhost/api/fields?propertyId=p')] });
    assert.equal(r.data.fields[0].polygon.type, 'Polygon'); assert.equal(r.data.fields[0].areaHectares, 2.4);
  });
  await t.test('talhão enviado com property_id e geometry', async () => {
    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.property_id, 'p'); assert.equal(body.geometry.type, 'Polygon');
      return reply({ id: 'f', ...body }, 201);
    };
    const r = await invoke(account.handleCreateField, { cookie: a.cookie, method: 'POST', body: { name: 'Talhão', propertyId: 'p', polygon: { type: 'Polygon', coordinates: [] } } });
    assert.equal(r.status, 201); assert.equal(r.data.field.propertyId, 'p');
  });
  await t.test('atualização e exclusão usam rotas individuais autenticadas', async () => {
    for (const resource of ['properties', 'fields']) for (const method of ['PUT', 'DELETE']) {
      global.fetch = async (url, options) => {
        assert.ok(url.endsWith(`/api/${resource}/item`)); assert.equal(options.method, method);
        assert.equal(options.headers.Authorization, 'Bearer a@example.test');
        return reply({ id: 'item', name: 'Alterado' });
      };
      const r = await invoke(account.handleMutation, { cookie: a.cookie, method, body: { name: 'Alterado' }, args: [resource, 'item'] });
      assert.equal(r.status, 200);
    }
  });
  await t.test('token expirado renovado sem expor refresh token ao navegador', async () => {
    const c = await login('c@example.test', 0);
    global.fetch = async (url, options) => {
      if (url.includes('securetoken')) return reply({ id_token: 'renewed', refresh_token: 'next', expires_in: 3600 });
      assert.equal(options.headers.Authorization, 'Bearer renewed'); return reply([]);
    };
    assert.equal((await invoke(account.handleGetProperties, { cookie: c.cookie })).status, 200);
  });
  await t.test('índice continua usando chave B2B e polígono', async () => {
    global.fetch = async (url, options) => {
      assert.ok(url.endsWith('/geo/spectral-index')); assert.equal(options.headers['X-API-Key'], 'test-b2b-key');
      return reply({ data: { computation: { vectorLayer: { features: Array.from({ length: 20 }) } }, metering: { balanceAfter: 95 } } });
    };
    assert.equal((await invoke(handleAnalyze, { cookie: a.cookie, body: { indexType: 'NDVI', polygon: { type: 'Polygon', coordinates: [] } } })).status, 200);
  });
  await t.test('análise RGB retorna camada Sentinel-2 True Color com tileUrl', async () => {
    const r = await invoke(handleAnalyze, { cookie: a.cookie, body: { indexType: 'RGB', polygon: { type: 'Polygon', coordinates: [] } } });
    assert.equal(r.status, 200);
    assert.equal(r.data.data.computation.indexType, 'RGB');
    assert.ok(r.data.data.computation.tileUrl.includes('s2cloudless') || r.data.data.computation.tileUrl.includes('tile'));
  });
  await t.test('malha sintética de 576 blocos é convertida em MVSky ML com zonas agronômicas', async () => {
    global.fetch = async (url) => {
      if (url.includes('/geo/spectral-index')) {
        // Simula backend B2B antigo retornando 576 blocos
        return reply({ data: { computation: { vectorLayer: { features: Array.from({ length: 576 }) } } } });
      }
      if (url.includes('interpolate-ml')) {
        return reply({
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { class: 0, min: 0.1, max: 0.25 }, geometry: { type: 'Polygon', coordinates: [] } }
          ],
          stats: {
            mean: 0.45,
            macroZones: [{ name: 'Crítico', range: '0.10 - 0.25', color: '#8B0000' }]
          },
          imageBase64: 'fake-png'
        });
      }
      return reply({});
    };
    const r = await invoke(handleAnalyze, {
      cookie: a.cookie,
      body: {
        indexType: 'NDRE',
        polygon: { type: 'Polygon', coordinates: [[[-62.9, -9.9], [-62.8, -9.9], [-62.8, -9.8], [-62.9, -9.8], [-62.9, -9.9]]] }
      }
    });
    assert.equal(r.status, 200);
    const comp = r.data.data.computation;
    assert.equal(comp.vectorLayer.features.length, 1);
    assert.equal(comp.vectorLayer.features[0].properties.className, 'Crítico');
    assert.equal(comp.imageBase64, 'fake-png');
  });
  await t.test('logout invalida somente a sessão atual', async () => {
    await invoke(account.handleLogout, { cookie: a.cookie });
    assert.equal((await invoke(account.handleGetProperties, { cookie: a.cookie })).status, 401);
    assert.equal((await invoke(account.handleGetSession, { cookie: b.cookie })).data.authenticated, true);
  });
});
