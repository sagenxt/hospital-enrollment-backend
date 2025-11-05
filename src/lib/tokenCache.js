const NodeCache = require('node-cache');

// Default TTL 30 minutes (1800 seconds)
const DEFAULT_TTL = 1800;
const cache = new NodeCache({ stdTTL: DEFAULT_TTL, checkperiod: 120 });

module.exports = {
  // store a revoked jti with optional ttl (seconds)
  setRevoked: (jti, ttl = DEFAULT_TTL) => cache.set(jti, true, ttl),
  // check if a jti is revoked
  isRevoked: (jti) => !!cache.get(jti),
  // expose cache for advanced usage
  cache
};

