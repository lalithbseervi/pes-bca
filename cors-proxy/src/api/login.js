import { invalidateCachedAuth, verifyCachedCredentials, cacheAuthResult } from "../utils/auth-cache.js";
import { makeCookie } from "../utils/cookies.js";
import { signJWT } from "../utils/sign_jwt.js";

/**
 * Identify username type from login input
 * @param {string} username - The username provided at login
 * @returns {Object} { type: 'srn'|'prn'|'email'|'phone', field: string }
 */
function identifyUsernameType(username) {
  // SRN: PES[1-2]UG[0-9]{2}[A-Z]{2}[0-9]{3}
  const srnPattern = /^PES[1-2]UG\d{2}[A-Z]{2}\d{3}$/i;
  if (srnPattern.test(username)) {
    return { type: 'srn', field: 'srn' };
  }

  // PRN: PES[1-2][0-9]{4}[0-9]{5}
  const prnPattern = /^PES[1-2]\d{9}$/i;
  if (prnPattern.test(username)) {
    return { type: 'prn', field: 'prn' };
  }

  // Email: contains @ symbol
  if (username.includes('@')) {
    return { type: 'email', field: 'email' };
  }

  // Phone: 10 digits
  const phonePattern = /^\d{10}$/;
  if (phonePattern.test(username)) {
    return { type: 'phone', field: 'phone' };
  }

  // Default to SRN if pattern doesn't match
  return { type: 'srn', field: 'srn' };
}

/**
 * Record user login in D1 database for permanent tracking
 * Inserts on first login, updates last_login_at on subsequent logins
 * Identifies username type and updates corresponding field
 */
async function recordUserLogin(username, profile, env) {
  if (!env.USER_DB) {
    console.warn('USER_DB binding not available, skipping user registry');
    return;
  }

  try {
    const now = new Date().toISOString();
    const {
      srn = null,
      name = null,
      prn = null,
      email = null,
      phone = null,
      branch = null,
      semester = null,
      program = null,
    } = profile;

    // Identify username type
    const usernameInfo = identifyUsernameType(username);
    
    // Start with profile values
    let emailValue = email;
    let phoneValue = phone;
    let srnValue = srn;
    let prnValue = prn;

    // Override with username if it matches the login method (ensures the field is populated)
    if (usernameInfo.type === 'email' && !emailValue) {
      emailValue = username;
    } else if (usernameInfo.type === 'phone' && !phoneValue) {
      phoneValue = username;
    } else if (usernameInfo.type === 'prn' && !prnValue) {
      prnValue = username;
    } else if (usernameInfo.type === 'srn' && !srnValue) {
      srnValue = username;
    }

    // Use SRN as primary key (from profile, required)
    const primarySrn = srnValue;
    
    if (!primarySrn) {
      console.warn(`No SRN in profile for user ${username}, cannot record login`);
      return;
    }

    // Log what we're about to insert/update
    console.log(`Recording login: SRN=${primarySrn}, name=${name}, prn=${prnValue}, email=${emailValue}, phone=${phoneValue}, branch=${branch}, semester=${semester}, program=${program}`);

    // Insert or update user record - preserve first_login_at on updates
    const result = await env.USER_DB.prepare(`
      INSERT INTO users (
        srn, name, prn, email, phone, branch, semester, program,
        first_login_at, last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(srn) DO UPDATE SET
        name = excluded.name,
        prn = excluded.prn,
        email = excluded.email,
        phone = excluded.phone,
        branch = excluded.branch,
        semester = excluded.semester,
        program = excluded.program,
        first_login_at = CASE 
          WHEN users.first_login_at > excluded.last_login_at 
          THEN excluded.last_login_at 
          ELSE users.first_login_at 
        END,
        last_login_at = excluded.last_login_at
    `).bind(
      primarySrn, name, prnValue, emailValue, phoneValue, branch, semester, program, now, now
    ).run();

    console.log(`✓ Recorded login for user ${primarySrn} (via ${usernameInfo.type}: ${username}) - Result:`, JSON.stringify(result));
  } catch (error) {
    // Don't fail the login if user tracking fails
    console.error('Failed to record user login:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', JSON.stringify(error));
  }
}

export async function loginHandler(request, env, ctx) {
  const url = new URL(request.url)
  const JSON_HEADERS = { 'Content-Type': 'application/json' }
  let body;
    
  try { body = await request.json() } catch (e) {
    return new Response(JSON.stringify({ success:false, message:'invalid json' }), { status:400, headers: JSON_HEADERS })
  }

  const { srn, password } = body

  // Check if dummy/guest user is active (fallback when auth service is down)
  if (srn === 'guest' || srn === 'GUEST') {
    try {
      const dummyUser = await env.SESSIONS.get('dummy_user', 'json');
      if (!dummyUser || !dummyUser.active) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'Guest auth not enabled' 
        }), { status: 401, headers: JSON_HEADERS });
      }
      
      if (password !== dummyUser.password) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'Invalid guest credentials' 
        }), { status: 401, headers: JSON_HEADERS });
      }
      
      console.log('Guest login successful (auth service fallback mode)');
      const profile = dummyUser.profile || { name: 'Guest User', branch: 'Guest', semester: '1' };
      
      // Skip user registry for guest logins
      
      const accessTTL = 24 * 60 * 60;
      const refreshTTL = 7 * 24 * 60 * 60;
      const accessJwt = await signJWT({ sub: 'guest', type: 'access', profile }, env.JWT_SECRET, accessTTL);
      const refreshJwt = await signJWT({ sub: 'guest', type: 'refresh', profile }, env.JWT_SECRET, refreshTTL);
      const redirectPath = url.searchParams.get('redirect') || request.headers.get('Referer') || '/';
      
      const headers = new Headers(JSON_HEADERS);
      headers.append('Set-Cookie', makeCookie('access_token', accessJwt, accessTTL, request));
      headers.append('Set-Cookie', makeCookie('refresh_token', refreshJwt, refreshTTL, request));
      
      return new Response(JSON.stringify({ 
        success: true, 
        session: { srn: 'guest', profile, expiresAt: new Date(Date.now() + accessTTL * 1000).toISOString() }, 
        redirect: redirectPath,
        guest_mode: true
      }), { status: 200, headers });
    } catch (e) {
      console.error('Guest auth check failed:', e);
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Guest auth not enabled' 
      }), { status: 401, headers: JSON_HEADERS });
    }
  }

  // Step 1: Check cached credentials first (fast path)
  const cachedAuth = await verifyCachedCredentials(env, srn, password)
      
  let profile
  if (cachedAuth.success) {
    // Cache hit! Use cached profile
    profile = cachedAuth.profile
    console.log(`Cache HIT for ${srn} - fast login`)
  } else {
    console.log(`Cache MISS for ${srn} - calling auth API`)
  
    const authApi = env.AUTH_API
    if (!authApi) {
      return new Response(JSON.stringify({ success:false, message:'invalid config (no AUTH_API given)' }), { status:401, headers: JSON_HEADERS })
    } else {
      try {
        const authResp = await fetch(authApi, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: srn, password, profile: true })
        })

        const contentType = authResp.headers.get('content-type') || ''
        const rawBody = await authResp.text()
        let authResult = {}
        if (contentType.includes('application/json')) {
          try {
            authResult = JSON.parse(rawBody)
          } catch (parseErr) {
            console.warn('Upstream auth JSON parse failed, raw body (trimmed):', rawBody.slice(0,120))
            authResult = {}
          }
        } else {
          console.warn('Upstream auth returned non-JSON body, status:', authResp.status, 'CT:', contentType, 'raw (trimmed):', rawBody.slice(0,120))
        }

        if (!authResp.ok) {
          await invalidateCachedAuth(env, srn)
          const reason = authResult.message || (authResp.status === 404 ? 'auth endpoint not found' : 'invalid credentials')
          return new Response(JSON.stringify({ success:false, message: reason }), { status:401, headers: JSON_HEADERS })
        }

        if (!authResult.profile) {
          await invalidateCachedAuth(env, srn)
          return new Response(JSON.stringify({ success:false, message: authResult.message || 'missing profile in response' }), { status:401, headers: JSON_HEADERS })
        }

        profile = authResult.profile
        await cacheAuthResult(env, srn, password, profile)
        console.log(`Cached credentials for ${srn}`)
      } catch (e) {
        console.error('Auth API fetch error:', e)
        // Fallback: Enable dummy user when auth service is down
        if (env.SESSIONS) {
          try {
            const dummyUser = {
              password: 'guest',
              active: true,
              profile: { name: 'Guest User', branch: 'Guest', semester: '1' },
              activated_at: new Date().toISOString(),
              reason: 'Auth service unavailable'
            }
            await env.SESSIONS.put('dummy_user', JSON.stringify(dummyUser), { expirationTtl: 3600 })
            console.log('Dummy user activated due to auth service failure. Credentials: guest/guest')
            return new Response(JSON.stringify({ 
              success: false,
              message: 'Auth service temporarily unavailable. Please try: username="guest", password="guest"',
              guest_fallback_enabled: true
            }), { status: 503, headers: JSON_HEADERS })
          } catch (kvError) {
            console.error('Failed to activate dummy user:', kvError)
          }
        }
        return new Response(JSON.stringify({ success:false, message:'auth backend error' }), { status:502, headers: JSON_HEADERS })
      }
    }
  }

  // Record user login in permanent registry (background task with ctx.waitUntil)  
  if (ctx && ctx.waitUntil) {
    console.log('Using ctx.waitUntil for background task');
    ctx.waitUntil(
      recordUserLogin(srn, profile, env).then(() => {
      }).catch(err => {
        console.error('Background task: User registry update failed:', err);
        console.error('Background task: Error stack:', err.stack);
      })
    );
  } else {
    console.warn('ctx.waitUntil not available, using fallback');
    // Await it to ensure it completes before response
    await recordUserLogin(srn, profile, env).catch(err => {
      console.error('User registry update failed (no waitUntil):', err);
    });
  }

  // Issue JWT cookies (no KV session storage)
  const accessTTL = 24 * 60 * 60 // 24 hours
  const refreshTTL = 7 * 24 * 60 * 60 // 7 days

  const accessJwt = await signJWT({ sub: srn, type: 'access', profile }, env.JWT_SECRET, accessTTL)
  const refreshJwt = await signJWT({ sub: srn, type: 'refresh', profile }, env.JWT_SECRET, refreshTTL)

  // Determine redirect path
  const redirectPath = url.searchParams.get('redirect') || request.headers.get('Referer') || '/'

  const resBody = { 
    success: true, 
    session: { srn, profile: profile, expiresAt: new Date(Date.now() + accessTTL * 1000).toISOString() }, 
    redirect: redirectPath,
    cached: cachedAuth.success
  }

  // Set both cookies
  const headers = new Headers(JSON_HEADERS)
  headers.append('Set-Cookie', makeCookie('access_token', accessJwt, accessTTL, request))
  headers.append('Set-Cookie', makeCookie('refresh_token', refreshJwt, refreshTTL, request))

  return new Response(JSON.stringify(resBody), { status: 200, headers })
}