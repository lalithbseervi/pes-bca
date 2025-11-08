// Admin panel API endpoints for managing resources
import { verifyJWT } from '../utils/sign_jwt.js';

// Central CORS is applied in the main worker; only set content type locally.
const JSON_HEADERS = { 'Content-Type': 'application/json' };

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

// POST /api/admin/verify-passphrase - Verify admin passphrase
export async function verifyAdminPassphrase(request, env) {
    
    try {
        const body = await request.json();
        const { passphrase } = body;
        
        if (!passphrase || passphrase !== env.STATUS_ADMIN_PASSPHRASE) {
            return new Response(JSON.stringify({ error: 'Invalid passphrase' }), {
                status: 401,
                headers: JSON_HEADERS
            });
        }
        
        return new Response(JSON.stringify({ valid: true }), {
            status: 200,
            headers: JSON_HEADERS
        });
    } catch (e) {
        console.error('verify passphrase error', e);
        return new Response(JSON.stringify({ error: 'Invalid request' }), {
            status: 400,
            headers: JSON_HEADERS
        });
    }
}

// GET /api/admin/resources - Get all resources with pagination and filtering
export async function getResources(request, env) {
    
    const user = await isAuthenticated(request, env);
    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: JSON_HEADERS
        });
    }
    
    try {
        const url = new URL(request.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const subject = url.searchParams.get('subject');
        const semester = url.searchParams.get('semester');
        const resource_type = url.searchParams.get('resource_type');
        const search = url.searchParams.get('search');
        
        const offset = (page - 1) * limit;
        
        // Build query
        let query = 'select=*&order=created_at.desc';
        
        if (subject) query += `&subject=eq.${encodeURIComponent(subject)}`;
        if (semester) query += `&semester=eq.${encodeURIComponent(semester)}`;
        if (resource_type) query += `&resource_type=eq.${encodeURIComponent(resource_type)}`;
        if (search) {
            query += `&or=(filename.ilike.*${encodeURIComponent(search)}*,link_title.ilike.*${encodeURIComponent(search)}*)`;
        }
        
        query += `&limit=${limit}&offset=${offset}`;
        
        const base = env.SUPABASE_URL.replace(/\/+$/, '');
        const headers = {
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: env.SUPABASE_SERVICE_ROLE_KEY
        };
        
        // Get resources
        const resourcesUrl = `${base}/rest/v1/fileStore?${query}`;
        const resourcesResp = await fetch(resourcesUrl, { headers });
        
        if (!resourcesResp.ok) {
            throw new Error('Failed to fetch resources');
        }
        
        const resources = await resourcesResp.json();
        
        // Get total count for pagination
        let countQuery = 'select=count';
        if (subject) countQuery += `&subject=eq.${encodeURIComponent(subject)}`;
        if (semester) countQuery += `&semester=eq.${encodeURIComponent(semester)}`;
        if (resource_type) countQuery += `&resource_type=eq.${encodeURIComponent(resource_type)}`;
        if (search) {
            countQuery += `&or=(filename.ilike.*${encodeURIComponent(search)}*,link_title.ilike.*${encodeURIComponent(search)}*)`;
        }
        
        const countUrl = `${base}/rest/v1/fileStore?${countQuery}`;
        const countResp = await fetch(countUrl, { 
            headers: { ...headers, 'Prefer': 'count=exact' } 
        });
        
        const countHeader = countResp.headers.get('content-range');
        const total = countHeader ? parseInt(countHeader.split('/')[1]) : 0;
        
        return new Response(JSON.stringify({
            resources,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        }), { status: 200, headers: JSON_HEADERS });
    } catch (e) {
        console.error('get resources error', e);
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: JSON_HEADERS
        });
    }
}

// PATCH /api/admin/resources/:id - Update resource metadata
export async function updateResource(request, env, ctx) {
    
    const user = await isAuthenticated(request, env);
    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: JSON_HEADERS
        });
    }
    
    try {
        const { id } = ctx.params;
        const body = await request.json();
        
        const allowedFields = ['link_title', 'filename', 'subject', 'semester', 'resource_type', 'unit'];
        const updates = {};
        
        for (const field of allowedFields) {
            if (body[field] !== undefined) {
                updates[field] = body[field];
            }
        }
        
        if (Object.keys(updates).length === 0) {
            return new Response(JSON.stringify({ error: 'No valid fields to update' }), {
                status: 400,
                headers: JSON_HEADERS
            });
        }
        
        const base = env.SUPABASE_URL.replace(/\/+$/, '');
        const headers = {
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        };
        
        const updateUrl = `${base}/rest/v1/fileStore?id=eq.${encodeURIComponent(id)}`;
        const updateResp = await fetch(updateUrl, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(updates)
        });
        
        if (!updateResp.ok) {
            const error = await updateResp.text();
            throw new Error(`Update failed: ${error}`);
        }
        
        const updated = await updateResp.json();
        
        // Log the update
        try {
            const logTable = env.FILE_CHANGE_LOG_TABLE || 'file_change_log';
            const logUrl = `${base}/rest/v1/${logTable}`;
            await fetch(logUrl, {
                method: 'POST',
                headers: {
                    ...headers,
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify([{
                    action: 'update',
                    metadata_id: id,
                    performed_by: user.email || user.sub || 'admin',
                    details: updates
                }])
            });
        } catch (e) {
            console.warn('Failed to log update', e);
        }
        
        return new Response(JSON.stringify({ success: true, resource: updated[0] }), {
            status: 200,
            headers: JSON_HEADERS
        });
    } catch (e) {
        console.error('update resource error', e);
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: JSON_HEADERS
        });
    }
}

// DELETE /api/admin/resources/:id - Delete resource and its file
export async function deleteResource(request, env, ctx) {
    
    const user = await isAuthenticated(request, env);
    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: JSON_HEADERS
        });
    }
    
    try {
        const { id } = ctx.params;
        
        const base = env.SUPABASE_URL.replace(/\/+$/, '');
        const headers = {
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: env.SUPABASE_SERVICE_ROLE_KEY
        };
        
        // First get the resource to find storage_key
        const getUrl = `${base}/rest/v1/fileStore?select=*&id=eq.${encodeURIComponent(id)}`;
        const getResp = await fetch(getUrl, { headers });
        
        if (!getResp.ok) {
            throw new Error('Resource not found');
        }
        
        const resources = await getResp.json();
        if (!resources || resources.length === 0) {
            return new Response(JSON.stringify({ error: 'Resource not found' }), {
                status: 404,
                headers: JSON_HEADERS
            });
        }
        
        const resource = resources[0];
        
        // Delete from storage
        if (resource.storage_key) {
            const BUCKET = 'fileStore';
            const deleteStorageUrl = `${base}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encodeURIComponent(resource.storage_key)}`;
            const deleteStorageResp = await fetch(deleteStorageUrl, {
                method: 'DELETE',
                headers
            });
            
            if (!deleteStorageResp.ok) {
                console.warn('Failed to delete from storage', await deleteStorageResp.text());
            }
        }
        
        // Delete metadata from database
        const deleteUrl = `${base}/rest/v1/fileStore?id=eq.${encodeURIComponent(id)}`;
        const deleteResp = await fetch(deleteUrl, {
            method: 'DELETE',
            headers
        });
        
        if (!deleteResp.ok) {
            throw new Error('Failed to delete resource metadata');
        }
        
        // Log the deletion
        try {
            const logTable = env.FILE_CHANGE_LOG_TABLE || 'file_change_log';
            const logUrl = `${base}/rest/v1/${logTable}`;
            await fetch(logUrl, {
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify([{
                    action: 'delete',
                    storage_key: resource.storage_key,
                    filename: resource.filename,
                    metadata_id: id,
                    performed_by: user.email || user.sub || 'admin',
                    details: { subject: resource.subject, resource_type: resource.resource_type }
                }])
            });
        } catch (e) {
            console.warn('Failed to log deletion', e);
        }
        
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: JSON_HEADERS
        });
    } catch (e) {
        console.error('delete resource error', e);
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: JSON_HEADERS
        });
    }
}

// GET /api/admin/filters - Get available filter values
export async function getFilters(request, env) {
    
    const user = await isAuthenticated(request, env);
    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: JSON_HEADERS
        });
    }
    
    try {
        const base = env.SUPABASE_URL.replace(/\/+$/, '');
        const headers = {
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: env.SUPABASE_SERVICE_ROLE_KEY
        };
        
        // Get distinct subjects
        const subjectsUrl = `${base}/rest/v1/fileStore?select=subject&order=subject`;
        const subjectsResp = await fetch(subjectsUrl, { headers });
        const subjectsData = await subjectsResp.json();
        const subjects = [...new Set(subjectsData.map(r => r.subject).filter(Boolean))];
        
        // Get distinct semesters
        const semestersUrl = `${base}/rest/v1/fileStore?select=semester&order=semester`;
        const semestersResp = await fetch(semestersUrl, { headers });
        const semestersData = await semestersResp.json();
        const semesters = [...new Set(semestersData.map(r => r.semester).filter(Boolean))];
        
        // Get distinct resource types
        const typesUrl = `${base}/rest/v1/fileStore?select=resource_type&order=resource_type`;
        const typesResp = await fetch(typesUrl, { headers });
        const typesData = await typesResp.json();
        const resource_types = [...new Set(typesData.map(r => r.resource_type).filter(Boolean))];
        
        return new Response(JSON.stringify({ subjects, semesters, resource_types }), {
            status: 200,
            headers: JSON_HEADERS
        });
    } catch (e) {
        console.error('get filters error', e);
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: JSON_HEADERS
        });
    }
}
