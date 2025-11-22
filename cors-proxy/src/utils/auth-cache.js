import { hashPassword } from './hashPassword.js'

/**
 * verify the hashed forms of passwords
 * @param {*} env 
 * @param {*} srn 
 * @param {*} password 
 * @returns 
 */
export async function verifyCachedCredentials(env, srn, password) {
  const passwordHash = await hashPassword(password)
  const cacheKey = `auth_cache:${srn}:${passwordHash}`
  const cached = await env.SESSIONS.get(cacheKey)
  console.info('cached profile: ', cached)
  if (cached) {
    return { success: true, profile: JSON.parse(cached), cached: true }
  }
  return { success: false, cached: false }
}

/**
 * if key doesn't already exist, this method will be called
 * it will add the password hash for future use
 * @param {*} env 
 * @param {*} srn 
 * @param {*} password 
 * @param {*} profile 
 */
export async function cacheAuthResult(env, srn, password, profile) {
  const passwordHash = await hashPassword(password)
  const cacheKey = `auth_cache:${srn}:${passwordHash}`
  const cacheTTL = 60 * 60 * 24 * 14 // 14 days
  
  const cachedData = {
    ...profile,
    created_at: new Date().toISOString()
  }
  
  await env.SESSIONS.put(cacheKey, JSON.stringify(cachedData), { expirationTtl: cacheTTL })
}

/**
 * if a user login fails or expires, the password hash will be removed
 * @param {*} env 
 * @param {*} srn 
 */
export async function invalidateCachedAuth(env, srn) {
  const prefix = `auth_cache:${srn}:`
  const list = await env.SESSIONS.list({ prefix })
  const deletePromises = list.keys.map(key => env.SESSIONS.delete(key.name))
  await Promise.all(deletePromises)
}