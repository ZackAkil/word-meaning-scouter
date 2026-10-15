/**
 * Reusable Frontend API & reCAPTCHA Client for Scalable Demos.
 */

let cachedSiteKey = null;
let recaptchaScriptPromise = null;

/**
 * Ensures reCAPTCHA Enterprise script is loaded when a siteKey is configured.
 *
 * @param {string} siteKey
 * @returns {Promise<void>}
 */
function ensureRecaptchaScript(siteKey) {
    if (!siteKey || typeof grecaptcha !== 'undefined') {
        return Promise.resolve();
    }
    if (recaptchaScriptPromise) {
        return recaptchaScriptPromise;
    }

    recaptchaScriptPromise = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(siteKey)}`;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => {
            console.warn('ReCAPTCHA script failed to load (Simple Mode fallback).');
            resolve();
        };
        document.head.appendChild(script);
    });

    return recaptchaScriptPromise;
}

/**
 * Checks `/api/status` and caches any configured `recaptcha_site_key`.
 */
export async function checkSecurityStatus() {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.recaptcha_site_key) {
        cachedSiteKey = data.recaptcha_site_key;
        await ensureRecaptchaScript(cachedSiteKey);
    }
    return data;
}

/**
 * Generates a reCAPTCHA Enterprise token for the given action.
 * Gracefully resolves to `null` when running in Simple Mode.
 *
 * @param {string} [siteKey] - Google Cloud reCAPTCHA Enterprise site key
 * @param {string} [action="SUBMIT"] - Action name verified by the backend
 * @returns {Promise<string|null>}
 */
export async function getRecaptchaToken(siteKey, action = 'SUBMIT') {
    const activeKey = siteKey || cachedSiteKey;
    if (!activeKey) {
        return null;
    }

    await ensureRecaptchaScript(activeKey);

    return new Promise((resolve) => {
        if (typeof grecaptcha === 'undefined' || !grecaptcha.enterprise) {
            resolve(null);
            return;
        }

        try {
            grecaptcha.enterprise.ready(async () => {
                try {
                    const token = await grecaptcha.enterprise.execute(activeKey, { action });
                    resolve(token);
                } catch (err) {
                    console.warn('ReCAPTCHA execution failed:', err);
                    resolve(null);
                }
            });
        } catch (err) {
            console.warn('ReCAPTCHA ready failed:', err);
            resolve(null);
        }
    });
}

/**
 * Sends a protected POST request with an automatically attached reCAPTCHA Enterprise token.
 *
 * @param {string} endpoint - API path
 * @param {object} payload - Request body object
 * @param {string} [siteKey] - Google Cloud reCAPTCHA Enterprise site key
 * @param {string} [action="SUBMIT"] - reCAPTCHA action name
 * @returns {Promise<any>}
 */
export async function postProtected(endpoint, payload, siteKey = '', action = 'SUBMIT') {
    const recaptchaToken = await getRecaptchaToken(siteKey, action);

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...payload,
            recaptcha_token: recaptchaToken,
        }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message =
            response.status === 429
                ? 'Rate limit exceeded (429). Please wait a moment and try again.'
                : data.detail || data.error || `Request failed (${response.status})`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }

    return data;
}
