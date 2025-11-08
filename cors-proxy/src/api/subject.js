/**
 * API module for fetching subject resources
 * Returns resources organized by unit and resource_type in hierarchical structure
 */

import { getCorsHeaders } from '../utils/cors.js';

/**
 * Get subject resources organized hierarchically
 * @param {Request} request - The request object
 * @param {Object} env - Environment variables
 * @returns {Response} - Subject resources with nested structure
 */
export async function getSubjectResources(request, env) {
    try {
        const url = new URL(request.url);
        const subject = url.searchParams.get('subject');

        if (!subject) {
            return new Response(JSON.stringify({ 
                error: 'Subject parameter is required' 
            }), {
                status: 400,
                headers: getCorsHeaders(request)
            });
        }

        // Optionally fetch subject full name from database (if subjects table exists)
        let subjectName = null;
        try {
            const subjectQuery = `${env.SUPABASE_URL}/rest/v1/subjects?code=eq.${encodeURIComponent(subject)}&select=name`;
            const subjectResponse = await fetch(subjectQuery, {
                headers: {
                    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (subjectResponse.ok) {
                const subjectData = await subjectResponse.json();
                if (subjectData && subjectData.length > 0) {
                    subjectName = subjectData[0].name;
                }
            }
        } catch (e) {
            // Subjects table might not exist yet, continue without it
            console.log('Subjects table not available, using code as fallback');
        }

        // Fetch all resources for this subject from Supabase
        const query = `${env.SUPABASE_URL}/rest/v1/fileStore?subject=eq.${encodeURIComponent(subject)}&order=unit.asc,resource_type.asc,link_title.asc`;
        
        const response = await fetch(query, {
            headers: {
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch resources from Supabase');
        }

        const resources = await response.json();

        // Organize resources by unit -> resource_type
        const organized = organizeResources(resources, env);

        return new Response(JSON.stringify({
            subject: subject,
            subjectName: subjectName, // Full name from database (if available)
            resources: organized,
            total: resources.length
        }), {
            status: 200,
            headers: getCorsHeaders(request)
        });

    } catch (error) {
        console.error('Error fetching subject resources:', error);
        return new Response(JSON.stringify({ 
            error: 'Failed to fetch subject resources',
            details: error.message 
        }), {
            status: 500,
            headers: getCorsHeaders(request)
        });
    }
}

/**
 * Organize resources into hierarchical structure
 * Structure: { unit1: { Notes: [...], Slides: [...], ... }, unit2: {...}, ... }
 */
function organizeResources(resources, env) {
    const organized = {};
    const workerUrl = env.WORKER_URL || 'http://localhost:8787';

    for (const resource of resources) {
        const unit = resource.unit || 'General';
        const type = resource.resource_type || 'Other';

        // Initialize unit if not exists
        if (!organized[unit]) {
            organized[unit] = {};
        }

        // Initialize resource type array if not exists
        if (!organized[unit][type]) {
            organized[unit][type] = [];
        }

        // Build semantic PDF viewer URL: /pdf-viewer?file=sem-N/subject/unit-N/filename&title=...
        const semester = resource.semester || 'sem-1';
        const semNum = semester.match(/\d+/)?.[0] || '1';
        const filePath = `sem-${semNum}/${resource.subject}/unit-${unit}/${resource.filename}`;
        const title = resource.link_title || resource.filename;
        const pdfViewerUrl = `/pdf-viewer?file=${filePath}&title=${encodeURIComponent(title)}`;

        // Add resource to the appropriate array
        organized[unit][type].push({
            id: resource.id,
            title: resource.link_title,
            filename: resource.filename,
            semester: resource.semester,
            subject: resource.subject,
            unit: resource.unit,
            url: pdfViewerUrl,
            size: resource.size,
            contentType: resource.content_type
        });
    }

    // Sort units (Unit-1, Unit-2, etc. before General)
    const sortedUnits = {};
    const unitKeys = Object.keys(organized).sort((a, b) => {
        // Extract numbers from unit names like "Unit-1", "Unit-2"
        const numA = a.match(/\d+/);
        const numB = b.match(/\d+/);
        
        if (numA && numB) {
            return parseInt(numA[0]) - parseInt(numB[0]);
        }
        
        // Put "General" at the end
        if (a === 'General') return 1;
        if (b === 'General') return -1;
        
        return a.localeCompare(b);
    });

    for (const key of unitKeys) {
        sortedUnits[key] = organized[key];
    }

    return sortedUnits;
}
