const SecurityLevel = {
  PUBLIC: 'public',
  AUTHENTICATED: 'authenticated',
  FINANCIAL: 'financial',
};

const endpoints = {
  // === PUBLIC ===
  'POST /api/v1/auth/login':            { level: 'public' },
  'POST /api/v1/auth/register':         { level: 'public' },
  'POST /api/v1/auth/refresh-token':    { level: 'public' },
  'GET /api/v1/health/detailed':        { level: 'public' },
  'POST /api/v1/health/csp-report':     { level: 'public' },
  'POST /api/v1/mfa/verify':            { level: 'public' },
  'GET /api/v1/mfa/setup':              { level: 'authenticated' },
  'POST /api/v1/mfa/setup':             { level: 'authenticated' },
  'POST /api/v1/mfa/reset':             { level: 'authenticated' },
  'POST /api/v1/mfa/verify-and-enable': { level: 'authenticated' },
  'GET /api/v1/public/*':               { level: 'public' },
  'GET /api-docs/*':                    { level: 'public' },
  'GET /health':                        { level: 'public' },
  'GET /api/v1/blockchain/public-key/:userId': { level: 'public' },
  'GET /api/v1/blockchain/public-key/:userId/history': { level: 'authenticated' },

  // === FINANCIAL ===
  'POST /api/v1/loan/borrow':           { level: 'financial' },
  'POST /api/v1/loan/repay':            { level: 'financial' },
  'POST /api/v1/loan/verify-transaction': { level: 'financial' },
  'POST /api/v1/invest':                { level: 'financial' },
  'POST /api/v1/redeem':                { level: 'financial' },
  'POST /api/v1/credit/generate-proof': { level: 'financial' },
  'POST /api/v1/zk/generate-proof':     { level: 'financial' },
  'POST /api/v1/risk/assess':           { level: 'financial' },
};

function getSecurityLevel(method, path) {
  const exactKey = `${method} ${path}`;
  if (endpoints[exactKey]) return endpoints[exactKey].level;

  for (const [pattern, config] of Object.entries(endpoints)) {
    const [patternMethod, patternPath] = pattern.split(' ');
    if (patternMethod !== method) continue;
    if (matchPath(patternPath, path)) return config.level;
  }

  return 'authenticated';
}

function matchPath(pattern, path) {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, i) =>
    part.startsWith(':') || part === '*' || part === pathParts[i]
  );
}

module.exports = { SecurityLevel, endpoints, getSecurityLevel };