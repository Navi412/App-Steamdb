// Límite por defecto del cuerpo de una petición JSON. Da holgura para una
// carátula en base64 (~5 MB de imagen -> ~6,7 MB de texto) sin dejar que
// un cuerpo enorme llene la memoria.
const DEFAULT_BODY_LIMIT = 8 * 1024 * 1024;

function readJsonBody(req, { limit = DEFAULT_BODY_LIMIT } = {}) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > limit) {
        aborted = true;
        req.destroy();
        reject(new Error('cuerpo demasiado grande'));
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (aborted) return;
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('cuerpo JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

module.exports = { readJsonBody, sendJson };
