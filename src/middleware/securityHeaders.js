// Middleware to set security headers that prevent clickjacking and improve basic hardening
// - X-Frame-Options: DENY prevents the site from being framed by any page
// - Content-Security-Policy: default directives to restrict resources
// These can be adjusted via environment variables if needed (e.g., allow certain domains)

module.exports = function securityHeaders(req, res, next) {
  try {
    // X-Frame-Options - legacy but widely supported
    res.setHeader('X-Frame-Options', process.env.X_FRAME_OPTIONS || 'DENY');

    const allowedOrigins = new Set([
      'https://eoi-application.vercel.app',
      'http://localhost:3000'
    ]);

    // const reqOrigin = (req.headers && req.headers.origin) ? String(req.headers.origin).replace(/\/$/, '') : '';
    //
    // if (allowedOrigins.has(reqOrigin)) {
    //   res.setHeader('Access-Control-Allow-Origin', reqOrigin);
    //   // Ensure caches vary per origin
    //   res.setHeader('Vary', 'Origin');
    // } else if (process.env.ACCESS_CONTROL_ALLOW_ORIGIN) {
    //   // fallback to env-configured origin if provided
    //   res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
    //   res.setHeader('Vary', 'Origin');
    // }

    res.setHeader('Access-Control-Allow-Origin', 'https://eoi-application.vercel.app');

    // X-Content-Type-Options
    if (!res.getHeader('X-Content-Type-Options')) res.setHeader('X-Content-Type-Options', process.env.X_CONTENT_TYPE_OPTIONS || 'nosniff');

    // X-XSS-Protection (legacy header) - set to block mode for older browsers
    if (!res.getHeader('X-XSS-Protection')) res.setHeader('X-XSS-Protection', process.env.X_XSS_PROTECTION || '1; mode=block');

    // Referrer-Policy
    if (!res.getHeader('Referrer-Policy')) res.setHeader('Referrer-Policy', process.env.REFERRER_POLICY || 'no-referrer');

    // Content-Security-Policy - sensible default; allow override via FULL_CSP env var
    const defaultCSP = "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none';";
    const csp = process.env.FULL_CSP || defaultCSP;
    const existingCsp = res.getHeader('Content-Security-Policy');
    if (!existingCsp) {
      res.setHeader('Content-Security-Policy', csp);
    } else {
      const existingStr = Array.isArray(existingCsp) ? existingCsp.join('; ') : String(existingCsp);
      if (!/frame-ancestors/i.test(existingStr) && !/default-src/i.test(existingStr)) {
        res.setHeader('Content-Security-Policy', existingStr + '; ' + csp);
      }
    }

    // Strict-Transport-Security - only set when request is secure or explicitly forced by env
    const trustHsts = process.env.FORCE_HSTS === 'true';
    const isSecure = req.secure || (req.headers && req.headers['x-forwarded-proto'] === 'https');
    if ((isSecure || trustHsts) && !res.getHeader('Strict-Transport-Security')) {
      const hsts = process.env.STRICT_TRANSPORT_SECURITY || 'max-age=63072000; includeSubDomains; preload';
      res.setHeader('Strict-Transport-Security', hsts);
    }

    // Additional recommended header: Permissions-Policy can be set by env (optional)
    if (process.env.PERMISSIONS_POLICY && !res.getHeader('Permissions-Policy')) {
      res.setHeader('Permissions-Policy', process.env.PERMISSIONS_POLICY);
    }

  } catch (e) {
    // don't block requests if header setting fails
    console.warn('Failed to set security headers', e && e.message);
  }
  next();
};
