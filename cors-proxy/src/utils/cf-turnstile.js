/**
 * Verifies the client-token with cloudflare
 * @param {*} secret 
 * @param {*} token 
 * @param {*} remoteip 
 * @returns 
 */
export async function verifyTurnstile(secret, token, remoteip) {
  const params = new URLSearchParams()
  params.append('secret', secret)
  params.append('response', token)
  if (remoteip) params.append('remoteip', remoteip)

  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  })
  if (!resp.ok) return { success: false }
  return resp.json()
}