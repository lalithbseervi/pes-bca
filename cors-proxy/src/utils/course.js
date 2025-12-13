import courseMapping from './course-mapping.json' assert { type: 'json' };

/**
 * Extract course code from user profile based on branch/program
 * Maps branch name to courseCodeId from the mapping
 * @param {Object} profile - User profile object with branch/program field
 * @returns {string|null} - Course code ID (e.g., 'CA', 'CS') or null if not found
 */
export function getCourseCodeFromProfile(profile) {
  if (!profile) return null;

  const branch = profile.branch || profile.program;
  if (!branch) return null;

  // Search for matching course by branch name
  for (const [courseId, courseInfo] of Object.entries(courseMapping)) {
    if (courseInfo.name.toLowerCase() === branch.toLowerCase()) {
      return courseId;
    }
  }

  return null;
}

/**
 * Get full course info from profile
 * @param {Object} profile - User profile object
 * @returns {Object|null} - { courseId, name } or throws error if not found
 */
export function getCourseInfoFromProfile(profile) {
  if (!profile) {
    throw new Error('Profile is required to determine course');
  }

  const courseId = getCourseCodeFromProfile(profile);
  if (!courseId || !courseMapping[courseId]) {
    throw new Error(`Course not found for profile: ${profile.branch || profile.program}`);
  }

  return {
    courseId,
    name: courseMapping[courseId].name
  };
}

/**
 * Validate if a course code exists in mapping
 * @param {string} courseCode - Course code to validate
 * @returns {boolean}
 */
export function isValidCourse(courseCode) {
  return courseCode in courseMapping;
}

/**
 * Get course display name from course ID
 * @param {string} courseId - Course ID (e.g., 'CA')
 * @returns {string|null} - Full course name or null if not found
 */
export function getCourseName(courseId) {
  return courseMapping[courseId]?.name || null;
}

/**
 * Get all available course mappings
 * @returns {Object}
 */
export function getAllCourses() {
  return courseMapping;
}
