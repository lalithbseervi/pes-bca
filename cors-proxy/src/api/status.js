// Status page API endpoints
import { verifyJWT } from '../utils/sign_jwt.js';

// Helper to check passphrase
function verifyPassphrase(request, env) {
    const passphrase = request.headers.get('X-Admin-Passphrase');
    if (!passphrase || passphrase !== env.STATUS_ADMIN_PASSPHRASE) {
        return false;
    }
    return true;
}

// Helper to check if user is authenticated AND has valid passphrase
async function isAuthenticated(request, env) {
    try {
        // First check passphrase
        if (!verifyPassphrase(request, env)) {
            return null;
        }
        
        const authHeader = request.headers.get('authorization');
        const cookieHeader = request.headers.get('cookie');
        let token = null;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }
        if (!token && cookieHeader) {
            const parts = cookieHeader.split(';').map(s => s.trim());
            for (const p of parts) {
                if (p.startsWith('access_token=')) {
                    token = p.slice('access_token='.length);
                    break;
                }
            }
        }
        
        if (!token) return null;
        
        const res = await verifyJWT(token, env.JWT_SECRET);
        return (res && res.valid) ? res.payload : null;
    } catch (e) {
        console.error('auth check error', e);
        return null;
    }
}

// Helper function to fetch status data
async function fetchStatusData(env) {
    const base = env.SUPABASE_URL.replace(/\/+$/, '');
    const headers = {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY
    };
    
    // Fetch service components with current status
    const componentsUrl = `${base}/rest/v1/service_components?select=*&order=display_order.asc`;
    const componentsResp = await fetch(componentsUrl, { headers });
    const components = componentsResp.ok ? await componentsResp.json() : [];
    
    // Fetch active incidents (not resolved)
    const activeIncidentsUrl = `${base}/rest/v1/incidents?select=*&status=not.eq.resolved&order=started_at.desc`;
    const activeResp = await fetch(activeIncidentsUrl, { headers });
    const activeIncidents = activeResp.ok ? await activeResp.json() : [];
    
    // Fetch recent incidents (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recentUrl = `${base}/rest/v1/incidents?select=*&started_at=gte.${thirtyDaysAgo}&order=started_at.desc&limit=20`;
    const recentResp = await fetch(recentUrl, { headers });
    const recentIncidents = recentResp.ok ? await recentResp.json() : [];
    
    // For each incident, fetch its updates
    const incidentsWithUpdates = await Promise.all(
        [...activeIncidents, ...recentIncidents].map(async (incident) => {
            const updatesUrl = `${base}/rest/v1/incident_updates?select=*&incident_id=eq.${incident.id}&order=created_at.desc`;
            const updatesResp = await fetch(updatesUrl, { headers });
            const updates = updatesResp.ok ? await updatesResp.json() : [];
            return { ...incident, updates };
        })
    );
    
    // Determine overall status
    let overallStatus = 'operational';
    if (components.some(c => c.status === 'major_outage')) {
        overallStatus = 'major_outage';
    } else if (components.some(c => c.status === 'partial_outage')) {
        overallStatus = 'partial_outage';
    } else if (components.some(c => c.status === 'degraded_performance')) {
        overallStatus = 'degraded_performance';
    } else if (components.some(c => c.status === 'under_maintenance')) {
        overallStatus = 'under_maintenance';
    }
    
    return {
        overall_status: overallStatus,
        components,
        active_incidents: incidentsWithUpdates.filter(i => i.status !== 'resolved'),
        recent_incidents: incidentsWithUpdates.filter(i => i.status === 'resolved')
    };
}

// GET /api/status - Public endpoint for status page
export async function getStatus(request, env) {
    const JSON_HEADERS = { 'Content-Type': 'application/json' };
    
    try {
        const data = await fetchStatusData(env);
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: JSON_HEADERS
        });
    } catch (e) {
        console.error('getStatus error', e);
        return new Response(JSON.stringify({ error: 'failed_to_fetch_status' }), {
            status: 500,
            headers: JSON_HEADERS
        });
    }
}

// GET /api/status/stream - Server-Sent Events endpoint for real-time updates
export async function streamStatus(request, env) {
    const headers = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    };

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Fetch status and write it immediately
    (async () => {
        try {
            const data = await fetchStatusData(env);
            await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

            let lastSentData = JSON.stringify(data);

            // Only send updates when data actually changes
            const intervalId = setInterval(async () => {
                try {
                    const updatedData = await fetchStatusData(env);
                    const serializedData = JSON.stringify(updatedData);
                    if (serializedData !== lastSentData) {
                        await writer.write(encoder.encode(`data: ${serializedData}\n\n`));
                        lastSentData = serializedData;
                    }
                } catch (e) {
                    console.error('SSE update error', e);
                }
            }, 30000); // Check every 30 seconds

            // Ping every 30 seconds to keep connection alive
            const pingId = setInterval(async () => {
                try {
                    await writer.write(encoder.encode(`: ping\n\n`));
                } catch (e) {
                    clearInterval(pingId);
                    clearInterval(intervalId);
                    writer.close().catch(() => {});
                }
            }, 30000);

            // Clean up on disconnect
            request.signal?.addEventListener('abort', () => {
                clearInterval(intervalId);
                clearInterval(pingId);
                writer.close().catch(() => {});
            });
        } catch (e) {
            console.error('SSE stream error', e);
            await writer.close().catch(() => {});
        }
    })();

    return new Response(readable, { headers });
}

// POST /api/status/incidents - Create new incident (authenticated)
export async function createIncident(request, env) {
    const JSON_HEADERS = { 'Content-Type': 'application/json' };
    
    const user = await isAuthenticated(request, env);
    if (!user) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: JSON_HEADERS
        });
    }
    
    try {
        const body = await request.json();
        const { title, severity, incident_type, affected_components, initial_message } = body;
        
        if (!title) {
            return new Response(JSON.stringify({ error: 'missing_required_fields' }), {
                status: 400,
                headers: JSON_HEADERS
            });
        }
        
        const base = env.SUPABASE_URL.replace(/\/+$/, '');
        const headers = {
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
        };
        
        // Create incident with default status 'investigating'
        const incidentData = {
            title,
            status: 'investigating', // Default initial status
            severity: severity || 'minor',
            incident_type: incident_type || 'outage',
            affected_components: affected_components || [],
            created_by: user.srn || user.email || 'admin'
        };
        
        const incidentUrl = `${base}/rest/v1/incidents`;
        const incidentResp = await fetch(incidentUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify([incidentData])
        });
        
        if (!incidentResp.ok) {
            const txt = await incidentResp.text();
            throw new Error(`incident creation failed: ${txt}`);
        }
        
        const incidents = await incidentResp.json();
        const incident = incidents[0];
        
        // Create initial update if provided
        if (initial_message) {
            const updateData = {
                incident_id: incident.id,
                status: 'investigating', // Use same default status
                message: initial_message,
                created_by: user.srn || user.email || 'admin'
            };
            
            const updateUrl = `${base}/rest/v1/incident_updates`;
            await fetch(updateUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify([updateData])
            });
        }
        
        return new Response(JSON.stringify({ success: true, incident }), {
            status: 201,
            headers: JSON_HEADERS
        });
    } catch (e) {
        console.error('createIncident error', e);
        return new Response(JSON.stringify({ error: 'failed_to_create_incident' }), {
            status: 500,
            headers: JSON_HEADERS
        });
    }
}

// POST /api/status/incidents/:id/updates - Add update to incident (authenticated)
export async function addIncidentUpdate(request, env, ctx) {
    const JSON_HEADERS = { 'Content-Type': 'application/json' };
    
    const user = await isAuthenticated(request, env);
    if (!user) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: JSON_HEADERS
        });
    }
    
    try {
        const incidentId = ctx?.params?.id || new URL(request.url).pathname.split('/').slice(-2)[0];
        const body = await request.json();
        const { status, message } = body;
        
        if (!status || !message) {
            return new Response(JSON.stringify({ error: 'missing_required_fields' }), {
                status: 400,
                headers: JSON_HEADERS
            });
        }
        
        const base = env.SUPABASE_URL.replace(/\/+$/, '');
        const headers = {
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
        };
        
        // Create update
        const updateData = {
            incident_id: incidentId,
            status,
            message,
            created_by: user.srn || user.email || 'admin'
        };
        
        const updateUrl = `${base}/rest/v1/incident_updates`;
        const updateResp = await fetch(updateUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify([updateData])
        });
        
        if (!updateResp.ok) {
            const txt = await updateResp.text();
            throw new Error(`update creation failed: ${txt}`);
        }
        
        const updates = await updateResp.json();
        
        // Update incident status and resolved_at if status is 'resolved'
        const patchData = { status, updated_at: new Date().toISOString() };
        if (status === 'resolved') {
            patchData.resolved_at = new Date().toISOString();
        }
        
        const incidentUrl = `${base}/rest/v1/incidents?id=eq.${incidentId}`;
        await fetch(incidentUrl, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(patchData)
        });
        
        return new Response(JSON.stringify({ success: true, update: updates[0] }), {
            status: 201,
            headers: JSON_HEADERS
        });
    } catch (e) {
        console.error('addIncidentUpdate error', e);
        return new Response(JSON.stringify({ error: 'failed_to_add_update' }), {
            status: 500,
            headers: JSON_HEADERS
        });
    }
}

// PATCH /api/status/components/:id - Update component status (authenticated)
export async function updateComponentStatus(request, env, ctx) {
    const JSON_HEADERS = { 'Content-Type': 'application/json' };
    
    const user = await isAuthenticated(request, env);
    if (!user) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: JSON_HEADERS
        });
    }
    
    try {
        const componentId = ctx?.params?.id || new URL(request.url).pathname.split('/').pop();
        const body = await request.json();
        const { status } = body;
        
        if (!status) {
            return new Response(JSON.stringify({ error: 'missing_status' }), {
                status: 400,
                headers: JSON_HEADERS
            });
        }
        
        const base = env.SUPABASE_URL.replace(/\/+$/, '');
        const headers = {
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
        };
        
        const url = `${base}/rest/v1/service_components?id=eq.${componentId}`;
        const resp = await fetch(url, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ status, updated_at: new Date().toISOString() })
        });
        
        if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(`component update failed: ${txt}`);
        }
        
        const components = await resp.json();
        
        return new Response(JSON.stringify({ success: true, component: components[0] }), {
            status: 200,
            headers: JSON_HEADERS
        });
    } catch (e) {
        console.error('updateComponentStatus error', e);
        return new Response(JSON.stringify({ error: 'failed_to_update_component' }), {
            status: 500,
            headers: JSON_HEADERS
        });
    }
}
