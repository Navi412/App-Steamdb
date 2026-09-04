function matchRoute(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (part !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function createRouter() {
  const routes = [];

  function register(method, pattern, handler) {
    routes.push({ method, pattern, handler });
  }

  return {
    get: (pattern, handler) => register('GET', pattern, handler),
    post: (pattern, handler) => register('POST', pattern, handler),
    patch: (pattern, handler) => register('PATCH', pattern, handler),
    put: (pattern, handler) => register('PUT', pattern, handler),
    delete: (pattern, handler) => register('DELETE', pattern, handler),
    async handle(req, res) {
      const { pathname } = new URL(req.url, 'http://localhost');
      for (const route of routes) {
        if (route.method !== req.method) continue;
        const params = matchRoute(route.pattern, pathname);
        if (params) {
          await route.handler(req, res, params);
          return true;
        }
      }
      return false;
    },
  };
}

module.exports = { createRouter };
