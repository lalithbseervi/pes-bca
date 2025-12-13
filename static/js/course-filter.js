/**
 * Course-aware content filtering
 * Hides subjects/semesters that don't belong to the logged-in user's course
 */

import { API_BASE_URL } from './utils.js';

export async function applyCourseFilter() {
  try {
    // Fetch user's course from API
    const res = await fetch(`${API_BASE_URL}/api/subjects`, { credentials: 'include' });
    if (!res.ok) {
      // Not authenticated or error - show all content (default BCA)
      return;
    }

    const data = await res.json();
    if (!data.success || !data.course) {
      return;
    }

    const userCourse = data.course;
    const pageTitle = document.querySelector('h1, .page-title');
    
    // Check if we're on the wrong course homepage
    // If user is PS but on BCA homepage, show message and hide content
    if (pageTitle) {
      const titleText = pageTitle.textContent;
      
      // Detect which course page we're on
      let pageCourse = null;
      if (titleText.includes('BCA')) pageCourse = 'CA';
      else if (titleText.includes('Psychology')) pageCourse = 'PS';
      // Add more course detection as needed
      
      if (pageCourse && pageCourse !== userCourse) {
        // User is on wrong course homepage
        const body = document.querySelector('.body, main');
        if (body) {
          body.innerHTML = `
            <div style="padding: 2rem; text-align: center; max-width: 600px; margin: 2rem auto; background: rgba(31, 41, 55, 0.5); border-radius: 12px; border: 1px solid rgba(255, 193, 7, 0.3);">
              <h2 style="color: #ffc107; margin-bottom: 1rem;">📚 Course Mismatch</h2>
              <p style="color: #d1d5db; margin-bottom: 1.5rem;">
                You're enrolled in <strong>${data.course_name || userCourse}</strong>, but viewing content for a different course.
              </p>
              <p style="color: #9ca3af; font-size: 0.9rem;">
                Please navigate to your course-specific materials or contact support if you need access to multiple courses.
              </p>
            </div>
          `;
        }
      }
    }
  } catch (e) {
    console.error('Course filter error:', e);
    // Don't break the page on errors
  }
}
