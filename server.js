import http from 'node:http';
import { config } from './src/config.js';
import {
  handleLogin,
  handleGetSession,
  handleLogout,
  handleGetProperties,
  handleCreateProperty,
  handleGetFields,
  handleCreateField,
  handleAnalyze
} from './src/proxyController.js';
import { handleStatic } from './src/staticController.js';

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Idempotency-Key');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;
  const method = req.method;

  if (method === 'POST' && pathname === '/api/auth/login') {
    return handleLogin(req, res);
  }
  if (method === 'GET' && pathname === '/api/auth/session') {
    return handleGetSession(req, res);
  }
  if (method === 'POST' && pathname === '/api/auth/logout') {
    return handleLogout(req, res);
  }
  if (method === 'GET' && pathname === '/api/properties') {
    return handleGetProperties(req, res);
  }
  if (method === 'POST' && pathname === '/api/properties') {
    return handleCreateProperty(req, res);
  }
  if (method === 'GET' && pathname === '/api/fields') {
    return handleGetFields(req, res, url);
  }
  if (method === 'POST' && pathname === '/api/fields') {
    return handleCreateField(req, res);
  }
  if (method === 'POST' && (pathname === '/api/analyze' || pathname === '/api/geo/spectral-index')) {
    return handleAnalyze(req, res);
  }

  return handleStatic(req, res, pathname);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[MVSky Monitor] Porta ${config.PORT} já está em uso.`);
  } else {
    console.error('[MVSky Monitor] Erro no servidor HTTP:', err);
  }
});

server.listen(config.PORT, () => {
  console.log(`[MVSky Monitor] Servidor ativo em http://localhost:${config.PORT}`);
  console.log(`[MVSky Monitor] Base da Muito Verde: ${config.MUITOVERDE_BASE_URL}`);
});
