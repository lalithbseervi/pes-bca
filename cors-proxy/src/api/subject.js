/**
 * API module for fetching subject resources
 * Returns resources organized by unit and resource_type in hierarchical structure
 */

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
                headers: { 'Content-Type': 'application/json' }
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
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Error fetching subject resources:', error);
        return new Response(JSON.stringify({ 
            error: 'Failed to fetch subject resources',
            details: error.message 
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

/**
 * Organize resources into hierarchical structure
 * Structure: { unit1: { Notes: [...], Slides: [...], ... }, unit2: {...}, all: {...}, ... }
 * Files with unit="all" are shown in a separate "all" section (not duplicated in each unit)
 */
function organizeResources(resources, env) {
    const organized = {};
    const workerUrl = env.WORKER_URL || 'http://localhost:8787';

    // Organize all resources by unit (including "all" as its own unit)
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


        // Build semantic PDF viewer URL:
        // - For unit === 'all': sem-N/subject/resource_type/unit-all/filename
        // - For others:        sem-N/subject/unit-N/filename
        const semester = resource.semester || 'sem-1';
        const semNum = semester.match(/\d+/)?.[0] || '1';
        let filePath;
        const encodedFilename = encodeURIComponent(resource.filename);
        if (unit === 'all') {
            filePath = `sem-${semNum}/${resource.subject}/${type}/unit-all/${encodedFilename}`;
        } else {
            filePath = `sem-${semNum}/${resource.subject}/unit-${unit}/${encodedFilename}`;
        }
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

    // Sort units (1, 2, 3, 4, then "all", then General)
    const sortedUnits = {};
    const unitKeys = Object.keys(organized).sort((a, b) => {
        // Numeric units first (1, 2, 3, 4)
        const numA = parseInt(a);
        const numB = parseInt(b);
        
        if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
        }
        
        // "all" comes after numeric units but before General
        if (a === 'all') return isNaN(numB) && b !== 'General' ? 1 : -1;
        if (b === 'all') return isNaN(numA) && a !== 'General' ? -1 : 1;
        
        // "General" at the end
        if (a === 'General') return 1;
        if (b === 'General') return -1;
        
        return a.localeCompare(b);
    });

    for (const key of unitKeys) {
        sortedUnits[key] = organized[key];
    }

    return sortedUnits;
}
