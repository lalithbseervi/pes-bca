import { createClient } from '@supabase/supabase-js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('SubjectsConfig')

let supabase = null

function initSupabase(env) {
  if (!supabase) {
    supabase = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY
    )
  }
  return supabase
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
/**
 * Get all subjects config, optionally filtered by course
 */
export async function getSubjectsConfig(env, course = null) {
  try {
    const sb = initSupabase(env)
    let query = sb
      .from('subjects_config')
      .select('*')
      .order('course_id')
      .order('semester')
      .order('display_order')

    if (course) {
      query = query.eq('course_id', course)
    }

    const { data, error } = await query

    if (error) {
      log.error(`Failed to fetch subjects: ${error.message}`)
      throw error
    }

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

/**
 * Create a new subject
 */
export async function createSubject(env, courseId, semester, subjectCode, subjectName, displayOrder = 0) {
  try {
    const sb = initSupabase(env)
    const { data, error } = await sb
      .from('subjects_config')
      .insert({
        course_id: courseId,
        semester: semester,
        subject_code: subjectCode,
        subject_name: subjectName,
        display_order: displayOrder
      })
      .select()

    if (error) {
      log.error(`Failed to create subject: ${error.message}`)
      throw error
    }

    log.info(`Created subject: ${subjectCode} (${courseId}/${semester})`)
    return data[0]
  } catch (e) {
    log.error(`Error creating subject: ${e.message}`)
    throw e
  }
}

/**
 * Update a subject
 */
export async function updateSubject(env, id, updates) {
  try {
    const sb = initSupabase(env)
    const { data, error } = await sb
      .from('subjects_config')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()

    if (error) {
      log.error(`Failed to update subject: ${error.message}`)
      throw error
    }

    log.info(`Updated subject: ${id}`)
    return data[0]
  } catch (e) {
    log.error(`Error updating subject: ${e.message}`)
    throw e
  }
}

/**
 * Delete a subject
 */
export async function deleteSubject(env, id) {
  try {
    const sb = initSupabase(env)
    const { error } = await sb
      .from('subjects_config')
      .delete()
      .eq('id', id)

    if (error) {
      log.error(`Failed to delete subject: ${error.message}`)
      throw error
    }

    log.info(`Deleted subject: ${id}`)
  } catch (e) {
    log.error(`Error deleting subject: ${e.message}`)
    throw e
  }
}

/**
 * Get all unique courses from subjects config
 */
export async function getAllCourses(env) {
  try {
    const sb = initSupabase(env)
    const { data, error } = await sb
      .from('subjects_config')
      .select('course_id', { count: 'exact' })
      .distinct()
      .order('course_id')

    if (error) {
      log.error(`Failed to fetch courses: ${error.message}`)
      throw error
    }

    return data.map(d => d.course_id)
  } catch (e) {
    log.error(`Error fetching courses: ${e.message}`)
    throw e
  }
}

/**
 * Get all unique semesters from subjects config
 */
export async function getAllSemesters(env) {
  try {
    const sb = initSupabase(env)
    const { data, error } = await sb
      .from('subjects_config')
      .select('semester', { count: 'exact' })
      .distinct()
      .order('semester')

    if (error) {
      log.error(`Failed to fetch semesters: ${error.message}`)
      throw error
    }

    return data.map(d => d.semester)
  } catch (e) {
    log.error(`Error fetching semesters: ${e.message}`)
    throw e
  }
}
