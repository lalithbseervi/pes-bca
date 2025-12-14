import { createLogger } from '../utils/logger.js'

const log = createLogger('SubjectsConfig')

async function querySupabase(env, query) {
  const base = env.SUPABASE_URL.replace(/\/+$/, '')
  const headers = {
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  }
  
  const resp = await fetch(`${base}/rest/v1/${query}`, { headers })
  
  if (!resp.ok) {
    const errorText = await resp.text()
    log.error(`Supabase query failed: ${query}`, { status: resp.status, error: errorText })
    throw new Error(`Supabase query failed: ${resp.status}`)
  }
  
  return await resp.json()
}



function normalizeSemesterKey(raw) {
  if (!raw) return ''
  let s = String(raw).toLowerCase().trim()
  s = s.replace(/\s+/g, '-')
  s = s.replace(/^semester-?/, 'sem-')
  if (/^\d+$/.test(s)) s = `sem-${s}`
  s = s.replace(/[^a-z0-9\-]+/g, '')
  return s || String(raw)
}
export async function getSubjectsConfig(env, course = null) {
  try {
    let query = `subjects_config?select=*&order=course_id,semester,display_order`
    
    if (course) {
      query += `&course_id=eq.${encodeURIComponent(course)}`
    }
    
    const data = await querySupabase(env, query)
    
    // Transform to the format expected by frontend
    const result = {}
    for (const row of data) {
      const semKey = normalizeSemesterKey(row.semester)
      if (!result[row.course_id]) {
        result[row.course_id] = {}
      }
      if (!result[row.course_id][semKey]) {
        result[row.course_id][semKey] = []
      }
      result[row.course_id][semKey].push({
        id: row.id,
        v: row.subject_code,
        t: row.subject_name,
        display_order: row.display_order ?? 0
      })
    }

    return result
  } catch (e) {
    log.error(`Error fetching subjects: ${e.message}`)
    throw e
  }
}

export async function createSubject(env, courseId, semester, subjectCode, subjectName, displayOrder = 0) {
  try {
    const query = `subjects_config?select=*`
    
    const response = await fetch(
      `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${query}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          course_id: courseId,
          semester: semester,
          subject_code: subjectCode,
          subject_name: subjectName,
          display_order: displayOrder
        })
      }
    )
    
    if (!response.ok) {
      throw new Error(`Failed to create subject: ${response.status}`)
    }
    
    const data = await response.json()
    log.info(`Created subject: ${subjectCode} (${courseId}/${semester})`)
    return data[0]
  } catch (e) {
    log.error(`Error creating subject: ${e.message}`)
    throw e
  }
}

export async function updateSubject(env, id, updates) {
  try {
    const query = `subjects_config?id=eq.${id}&select=*`
    
    const response = await fetch(
      `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${query}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...updates,
          updated_at: new Date().toISOString()
        })
      }
    )
    
    if (!response.ok) {
      throw new Error(`Failed to update subject: ${response.status}`)
    }
    
    const data = await response.json()
    log.info(`Updated subject: ${id}`)
    return data[0]
  } catch (e) {
    log.error(`Error updating subject: ${e.message}`)
    throw e
  }
}

export async function deleteSubject(env, id) {
  try {
    const query = `subjects_config?id=eq.${id}`
    
    const response = await fetch(
      `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${query}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json'
        }
      }
    )
    
    if (!response.ok) {
      throw new Error(`Failed to delete subject: ${response.status}`)
    }
    
    log.info(`Deleted subject: ${id}`)
  } catch (e) {
    log.error(`Error deleting subject: ${e.message}`)
    throw e
  }
}

export async function getAllCourses(env) {
  try {
    const data = await querySupabase(env, `subjects_config?select=course_id&distinct()&order=course_id`)
    return data.map(d => d.course_id)
  } catch (e) {
    log.error(`Error fetching courses: ${e.message}`)
    throw e
  }
}

export async function getAllSemesters(env) {
  try {
    const data = await querySupabase(env, `subjects_config?select=semester&distinct()&order=semester`)
    return data.map(d => d.semester)
  } catch (e) {
    log.error(`Error fetching semesters: ${e.message}`)
    throw e
  }
}
