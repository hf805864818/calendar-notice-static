export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      return json({ ok: false, error: 'server_error', message: String(err && err.message ? err.message : err) }, 500);
    }
  }
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Admin-Token',
  'Access-Control-Max-Age': '86400'
};

// 兜底激活码：如果 KV 里还没有创建激活码，这个码也可以直接激活。
// 你可以继续增加，例如：'WK-AAAA-BBBB-CCCC'
const DEFAULT_CODES = [
  'WK-RBKB-4FWN-35LE'
];

async function handleRequest(request, env, ctx) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/' || path === '/health') {
    return json({
      ok: true,
      name: 'wechat-card-auth-worker',
      time: Date.now(),
      kv_bound: !!env.AUTH_KV,
      auth_secret_bound: !!env.AUTH_SECRET,
      admin_token_bound: !!env.ADMIN_TOKEN
    });
  }

  if (path === '/api/verify' && request.method === 'POST') {
    return handleVerify(request, env);
  }

  if (path === '/api/status' && request.method === 'POST') {
    return handleStatus(request, env);
  }

  if (path === '/api/admin/free-mode' && request.method === 'POST') {
    return handleAdminFreeMode(request, env);
  }

  if (path === '/api/admin/create-code' && request.method === 'POST') {
    return handleAdminCreateCode(request, env);
  }

  if (path === '/api/admin/disable-code' && request.method === 'POST') {
    return handleAdminDisableCode(request, env);
  }

  if (path === '/api/admin/device' && request.method === 'POST') {
    return handleAdminGetDevice(request, env);
  }

  return json({ ok: false, error: 'not_found' }, 404);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function normalizeDeviceId(deviceId) {
  return String(deviceId || '').trim();
}

function isValidCodeFormat(code) {
  return /^WK-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code);
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifySign(params, authSecret) {
  // 按你的要求：sign 为空时直接放行，不做签名验证。
  const sign = String(params.sign || '').trim();
  if (!sign) return true;

  if (!authSecret) return false;

  const code = normalizeCode(params.code);
  const deviceId = normalizeDeviceId(params.device_id);
  const ts = String(params.ts || '').trim();
  const raw = `${code}|${deviceId}|${ts}|${authSecret}`;
  const expected = await sha256Hex(raw);
  return expected === sign.toLowerCase();
}

function requireKv(env) {
  if (!env.AUTH_KV) {
    throw new Error('KV binding AUTH_KV is missing. Please bind KV namespace as AUTH_KV.');
  }
  return env.AUTH_KV;
}

async function isFreeMode(env) {
  const kv = requireKv(env);
  const value = await kv.get('config:free_mode');
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
}

async function handleVerify(request, env) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'bad_json' }, 400);

  const code = normalizeCode(body.code);
  const deviceId = normalizeDeviceId(body.device_id);
  const ts = Number(body.ts || 0);
  const now = Date.now();

  // 这里只要求 code/device_id/ts，不再强制 sign 必填。
  if (!code || !deviceId || !ts) {
    return json({ ok: false, error: 'missing_params' }, 400);
  }

  if (!isValidCodeFormat(code)) {
    return json({ ok: false, error: 'bad_code_format' }, 400);
  }

  const signOk = await verifySign(body, env.AUTH_SECRET || '');
  if (!signOk) {
    return json({ ok: false, error: 'bad_sign' }, 401);
  }

  const kv = requireKv(env);
  if (await isFreeMode(env)) {
    await kv.put(`log:${deviceId}:${now}`, JSON.stringify({ type: 'free_mode_verify', device_id: deviceId, time: new Date(now).toISOString() }));
    return json({ ok: true, active: true, free_mode: true, device_id: deviceId, code: 'FREE-MODE' });
  }

  const codeKey = `code:${code}`;
  const activationKey = `activation:${deviceId}`;
  const deviceCodeKey = `device_code:${deviceId}`;
  const nowIso = new Date(now).toISOString();

  let codeRecord = null;
  const codeText = await kv.get(codeKey);
  if (codeText) {
    try { codeRecord = JSON.parse(codeText); } catch (e) { codeRecord = null; }
  }

  const isDefaultCode = DEFAULT_CODES.includes(code);

  if (!codeRecord && !isDefaultCode) {
    return json({ ok: false, error: 'code_not_found' }, 404);
  }

  if (codeRecord && codeRecord.disabled) {
    return json({ ok: false, error: 'code_disabled' }, 403);
  }

  const oldActivationText = await kv.get(activationKey);
  if (oldActivationText) {
    try {
      const oldActivation = JSON.parse(oldActivationText);
      if (oldActivation && oldActivation.code === code && oldActivation.active !== false) {
        oldActivation.last_verify_at = nowIso;
        await kv.put(activationKey, JSON.stringify(oldActivation));
        await kv.put(deviceCodeKey, code);
        return json({ ok: true, active: true, reused: true, device_id: deviceId, code });
      }
    } catch (e) {}
  }

  if (codeRecord) {
    const devices = Array.isArray(codeRecord.devices) ? codeRecord.devices : [];
    const maxDevices = Number(codeRecord.max_devices || 1);
    if (!devices.includes(deviceId) && devices.length >= maxDevices) {
      return json({ ok: false, error: 'device_limit_reached' }, 403);
    }
    if (!devices.includes(deviceId)) devices.push(deviceId);
    codeRecord.devices = devices;
    codeRecord.used_count = devices.length;
    codeRecord.updated_at = nowIso;
    await kv.put(codeKey, JSON.stringify(codeRecord));
  } else if (isDefaultCode) {
    codeRecord = {
      code,
      source: 'default_code',
      max_devices: 999999,
      devices: [deviceId],
      created_at: nowIso,
      updated_at: nowIso,
      disabled: false
    };
    await kv.put(codeKey, JSON.stringify(codeRecord));
  }

  const activation = {
    active: true,
    code,
    device_id: deviceId,
    activated_at: nowIso,
    last_verify_at: nowIso,
    ua: request.headers.get('User-Agent') || ''
  };

  await kv.put(activationKey, JSON.stringify(activation));
  await kv.put(deviceCodeKey, code);
  await kv.put(`log:${deviceId}:${now}`, JSON.stringify({ type: 'verify', code, device_id: deviceId, time: nowIso }));

  return json({ ok: true, active: true, device_id: deviceId, code });
}

async function handleStatus(request, env) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'bad_json' }, 400);

  const deviceId = normalizeDeviceId(body.device_id);
  if (!deviceId) return json({ ok: false, error: 'missing_device_id' }, 400);

  const kv = requireKv(env);
  if (await isFreeMode(env)) {
    return json({ ok: true, active: true, free_mode: true, device_id: deviceId, code: 'FREE-MODE' });
  }

  const activationText = await kv.get(`activation:${deviceId}`);
  if (!activationText) {
    return json({ ok: true, active: false, device_id: deviceId });
  }

  let activation = null;
  try { activation = JSON.parse(activationText); } catch (e) {}
  if (!activation || activation.active === false) {
    return json({ ok: true, active: false, device_id: deviceId });
  }

  return json({
    ok: true,
    active: true,
    device_id: deviceId,
    code: activation.code || '',
    activated_at: activation.activated_at || ''
  });
}

function getAdminTokenFromRequest(request) {
  const headerToken = request.headers.get('X-Admin-Token') || '';
  const auth = request.headers.get('Authorization') || '';
  if (headerToken) return headerToken.trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

function isAdmin(request, adminToken) {
  if (!adminToken) return false;
  const token = getAdminTokenFromRequest(request);
  return token && token === adminToken;
}

async function handleAdminFreeMode(request, env) {
  if (!isAdmin(request, env.ADMIN_TOKEN || '')) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'bad_json' }, 400);

  const enabled = body.enabled === true || body.enabled === 'true' || body.enabled === 1 || body.enabled === '1' || body.enabled === 'on';
  const kv = requireKv(env);
  await kv.put('config:free_mode', enabled ? 'true' : 'false');

  return json({ ok: true, free_mode: enabled });
}

async function handleAdminCreateCode(request, env) {
  if (!isAdmin(request, env.ADMIN_TOKEN || '')) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'bad_json' }, 400);

  const code = normalizeCode(body.code || generateCode());
  const maxDevices = Math.max(1, Number(body.max_devices || 1));
  if (!isValidCodeFormat(code)) {
    return json({ ok: false, error: 'bad_code_format' }, 400);
  }

  const kv = requireKv(env);
  const nowIso = new Date().toISOString();
  const record = {
    code,
    max_devices: maxDevices,
    devices: [],
    used_count: 0,
    disabled: false,
    note: String(body.note || ''),
    created_at: nowIso,
    updated_at: nowIso
  };

  await kv.put(`code:${code}`, JSON.stringify(record));
  return json({ ok: true, code, record });
}

async function handleAdminDisableCode(request, env) {
  if (!isAdmin(request, env.ADMIN_TOKEN || '')) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await readJson(request);
  const code = normalizeCode(body && body.code);
  if (!code) return json({ ok: false, error: 'missing_code' }, 400);

  const kv = requireKv(env);
  const key = `code:${code}`;
  const text = await kv.get(key);
  if (!text) return json({ ok: false, error: 'code_not_found' }, 404);

  let record = JSON.parse(text);
  record.disabled = true;
  record.updated_at = new Date().toISOString();
  await kv.put(key, JSON.stringify(record));
  return json({ ok: true, code, disabled: true });
}

async function handleAdminGetDevice(request, env) {
  if (!isAdmin(request, env.ADMIN_TOKEN || '')) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await readJson(request);
  const deviceId = normalizeDeviceId(body && body.device_id);
  if (!deviceId) return json({ ok: false, error: 'missing_device_id' }, 400);

  const kv = requireKv(env);
  const activationText = await kv.get(`activation:${deviceId}`);
  let activation = null;
  if (activationText) {
    try { activation = JSON.parse(activationText); } catch (e) {}
  }
  return json({ ok: true, device_id: deviceId, activation });
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function part() {
    let s = '';
    for (let i = 0; i < 4; i++) {
      s += chars[Math.floor(Math.random() * chars.length)];
    }
    return s;
  }
  return `WK-${part()}-${part()}-${part()}`;
}
