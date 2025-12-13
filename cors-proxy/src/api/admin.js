// Admin panel API endpoints for managing resources
import { verifyJWT } from '../utils/sign_jwt.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Admin');

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

// Helper: Check if user is admin from database
async function isUserAdmin(srn, env) {
    if (!env.USER_DB || !srn) return false;
    
    try {
        const result = await env.USER_DB.prepare(
            'SELECT is_admin FROM users WHERE srn = ? LIMIT 1'
        ).bind(srn).first();
        
        return result && result.is_admin === 1;
    } catch (e) {
        log.error('Failed to check admin status', e);
        return false;
    }
}

// Helper to check if user is authenticated (passphrase OR admin user)
async function isAuthenticated(request, env) {
    try {
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
        
        // If we have a token, check if user is admin
        if (token) {
            const res = await verifyJWT(token, env.JWT_SECRET);
            if (res && res.valid && res.payload) {
                const userSrn = res.payload.sub || res.payload.srn;
                const isAdmin = await isUserAdmin(userSrn, env);
                
                if (isAdmin) {
                    // Admin user, no passphrase needed
                    return res.payload;
                }
            }
        }
        
        // Not an admin user, require passphrase
        if (!verifyPassphrase(request, env)) {
            return null;
        }
        
        // Passphrase valid, return user if we have token
        if (token) {
            const res = await verifyJWT(token, env.JWT_SECRET);
            return (res && res.valid) ? res.payload : { passphraseOnly: true };
        }
        
        return { passphraseOnly: true };
    } catch (e) {
        log.error('Authentication check error', e);
        return null;
    }
}

// GET /api/admin/check-access - Check if user has admin access
export async function checkAdminAccess(request, env) {
    try {
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
        
        if (token) {
            const res = await verifyJWT(token, env.JWT_SECRET);
            if (res && res.valid && res.payload) {
                const userSrn = res.payload.sub || res.payload.srn;
                const isAdmin = await isUserAdmin(userSrn, env);
                
                if (isAdmin) {
                    return new Response(JSON.stringify({ 
                        hasAccess: true, 
                        method: 'user',
                        user: { 
                            srn: userSrn, 
                            name: res.payload.name || res.payload.profile?.name 
                        }
                    }), {
                        status: 200,
                        headers: JSON_HEADERS
                    });
                }
            }
        }
        
        // Not an admin user
        return new Response(JSON.stringify({ 
            hasAccess: false, 
            requiresPassphrase: true 
        }), {
            status: 200,
            headers: JSON_HEADERS
        });
    } catch (e) {
        log.error('Failed to check admin access', e);
        return new Response(JSON.stringify({ 
            hasAccess: false,
            error: 'Failed to check access' 
        }), {
            status: 500,
            headers: JSON_HEADERS
        });
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
        log.error('Failed to verify passphrase', e);
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
        log.error('Failed to get admin resources', e);
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
        
        const base = env.SUPABASE_URL.replace(/\/+$/, '');
        const headers = {
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        };
        
        // Get current resource to check for filename changes
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
        
        const currentResource = resources[0];
        
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
        
        // If filename is being changed, rename the file in storage and update paths
        if (updates.filename && updates.filename !== currentResource.filename) {
            const oldStorageKey = currentResource.storage_key || '';
            const pathParts = oldStorageKey.split('/');
            
            if (pathParts.length > 0 && oldStorageKey) {
                // Replace the last part (filename) with the new filename
                pathParts[pathParts.length - 1] = updates.filename;
                const newStorageKey = pathParts.join('/');
                
                const BUCKET = 'fileStore';
                
                // Move/rename the file in Supabase storage
                const moveUrl = `${base}/storage/v1/object/move`;
                const moveResp = await fetch(moveUrl, {
                    method: 'POST',
                    headers: {
                        ...headers,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        bucketId: BUCKET,
                        sourceKey: oldStorageKey,
                        destinationKey: newStorageKey
                    })
                });
                
                if (!moveResp.ok) {
                    const error = await moveResp.text();
                    throw new Error(`Failed to rename file in storage: ${error}`);
                }
                
                updates.storage_key = newStorageKey;
                
                // Update storage_path if it exists
                if (currentResource.storage_path) {
                    const pathSegments = currentResource.storage_path.split('/');
                    pathSegments[pathSegments.length - 1] = updates.filename;
                    updates.storage_path = pathSegments.join('/');
                }
            }
        }
        
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
            log.warn('Failed to log resource update', e);
        }
        
        return new Response(JSON.stringify({ success: true, resource: updated[0] }), {
            status: 200,
            headers: JSON_HEADERS
        });
    } catch (e) {
        log.error('Failed to update resource', e);
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
                log.warn(`Failed to delete from storage: ${await deleteStorageResp.text()}`);
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
            log.warn('Failed to log resource deletion', e);
        }
        
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: JSON_HEADERS
        });
    } catch (e) {
        log.error('Failed to delete resource', e);
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: JSON_HEADERS
        });
    }
}

// PUT /api/admin/resources/:id/file - Replace file while preserving metadata
export async function replaceFile(request, env, ctx) {
    
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
        
        // Get current resource metadata
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
        
        // Parse the multipart form data
        const formData = await request.formData();
        const file = formData.get('file');
        
        if (!file) {
            return new Response(JSON.stringify({ error: 'No file provided' }), {
                status: 400,
                headers: JSON_HEADERS
            });
        }
        
        // Delete old file from storage
        if (resource.storage_key) {
            const BUCKET = 'fileStore';
            const deleteStorageUrl = `${base}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encodeURIComponent(resource.storage_key)}`;
            const deleteStorageResp = await fetch(deleteStorageUrl, {
                method: 'DELETE',
                headers
            });
            
            if (!deleteStorageResp.ok) {
                log.warn(`Failed to delete old file from storage: ${await deleteStorageResp.text()}`);
            }
        }
        
        // Upload new file to same storage location
        const BUCKET = 'fileStore';
        const storageKey = resource.storage_key || `${resource.subject || 'unknown'}/${resource.filename}`;
        const uploadUrl = `${base}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encodeURIComponent(storageKey)}`;
        
        const uploadResp = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': file.type || 'application/octet-stream',
                'x-upsert': 'true'
            },
            body: await file.arrayBuffer()
        });
        
        if (!uploadResp.ok) {
            const error = await uploadResp.text();
            throw new Error(`Storage upload failed: ${error}`);
        }
        
        // Update file size and content_type in metadata
        const updates = {
            size: file.size,
            content_type: file.type || 'application/octet-stream'
        };
        
        const updateUrl = `${base}/rest/v1/fileStore?id=eq.${encodeURIComponent(id)}`;
        const updateResp = await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(updates)
        });
        
        if (!updateResp.ok) {
            throw new Error('Failed to update metadata');
        }
        
        const updated = await updateResp.json();
        
        // Log the replacement
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
                    action: 'replace_file',
                    metadata_id: id,
                    storage_key: storageKey,
                    filename: resource.filename,
                    performed_by: user.email || user.sub || 'admin',
                    details: { old_size: resource.size, new_size: file.size }
                }])
            });
        } catch (e) {
            log.warn('Failed to log file replacement', e);
        }
        
        return new Response(JSON.stringify({ success: true, resource: updated[0] }), {
            status: 200,
            headers: JSON_HEADERS
        });
    } catch (e) {
        log.error('Failed to replace file', e);
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
        log.error('Failed to get filters', e);
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: JSON_HEADERS
        });
    }
}

// GET /api/admin/config - Get all system configurations
export async function getSystemConfig(request, env) {
    const user = await isAuthenticated(request, env);
    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: JSON_HEADERS
        });
    }
    
    try {
        const config = {};
        
        if (env.RATE_LIMIT_KV) {
            // Rate limit config
            const maxRequests = await env.RATE_LIMIT_KV.get('config:max_requests_per_window');
            config.max_requests_per_window = maxRequests ? parseInt(maxRequests) : 10;
            
            // Service worker version
            const swVersion = await env.RATE_LIMIT_KV.get('config:sw_version');
            config.sw_version = swVersion || '';
            
            // Maintenance mode
            const maintenanceMode = await env.RATE_LIMIT_KV.get('config:maintenance_mode');
            config.maintenance_mode = maintenanceMode === 'true';
            
            // Maintenance message
            const maintenanceMsg = await env.RATE_LIMIT_KV.get('config:maintenance_message');
            config.maintenance_message = maintenanceMsg || 'Site is currently under maintenance. Please check back later.';
        }
        
        return new Response(JSON.stringify(config), {
            status: 200,
            headers: JSON_HEADERS
        });
    } catch (e) {
        log.error('Failed to get system config', e);
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: JSON_HEADERS
        });
    }
}

// PUT /api/admin/config - Update system configurations
export async function updateSystemConfig(request, env) {
    const user = await isAuthenticated(request, env);
    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: JSON_HEADERS
        });
    }
    
    try {
        const body = await request.json();
        
        if (!env.RATE_LIMIT_KV) {
            return new Response(JSON.stringify({ error: 'Configuration storage not available' }), {
                status: 500,
                headers: JSON_HEADERS
            });
        }
        
        const updates = [];
        
        // Validate and update max_requests_per_window
        if ('max_requests_per_window' in body) {
            const value = parseInt(body.max_requests_per_window);
            if (isNaN(value) || value < 1 || value > 1000) {
                return new Response(JSON.stringify({ error: 'max_requests_per_window must be between 1 and 1000' }), {
                    status: 400,
                    headers: JSON_HEADERS
                });
            }
            await env.RATE_LIMIT_KV.put('config:max_requests_per_window', value.toString());
            updates.push(`max_requests_per_window=${value}`);
        }
        
        // Update sw_version
        if ('sw_version' in body) {
            const value = body.sw_version.toString().trim();
            if (value.length > 50) {
                return new Response(JSON.stringify({ error: 'sw_version must be 50 characters or less' }), {
                    status: 400,
                    headers: JSON_HEADERS
                });
            }
            await env.RATE_LIMIT_KV.put('config:sw_version', value);
            updates.push(`sw_version=${value}`);
        }
        
        // Update maintenance_mode
        if ('maintenance_mode' in body) {
            const value = body.maintenance_mode === true;
            await env.RATE_LIMIT_KV.put('config:maintenance_mode', value.toString());
            updates.push(`maintenance_mode=${value}`);
        }
        
        // Update maintenance_message
        if ('maintenance_message' in body) {
            const value = body.maintenance_message.toString().trim();
            if (value.length > 500) {
                return new Response(JSON.stringify({ error: 'maintenance_message must be 500 characters or less' }), {
                    status: 400,
                    headers: JSON_HEADERS
                });
            }
            await env.RATE_LIMIT_KV.put('config:maintenance_message', value);
            updates.push(`maintenance_message updated`);
        }
        
        // System config updated successfully
        
        return new Response(JSON.stringify({ 
            success: true,
            updates: updates,
            updated_by: user.sub || user.email
        }), {
            status: 200,
            headers: JSON_HEADERS
        });
    } catch (e) {
        log.error('Failed to update system config', e);
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: JSON_HEADERS
        });
    }
}
