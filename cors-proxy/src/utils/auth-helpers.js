import { verifyJWT } from './sign_jwt.js';
import { getCourseCodeFromProfile } from './course.js';
import { createLogger } from './logger.js';

const log = createLogger('AuthHelpers');

/**
 * Resolve course code using fuzzy keyword matching
 * Fallback when exact name match fails
 */
export function resolveCourseByKeyword(profile) {
    const text = String(profile?.program || profile?.branch || '').toLowerCase().trim();
    if (!text) return null;
    
    const keywords = {
        "PS": ["psychology"],
        "SM": ["sports"],
        "PH": ["pharmacy"],
        "BC": ["commerce"],
        "BB": ["business"],
        "AR": ["architecture"],
        "BD": ["design"],
        "AL": ["arts"],
        "BL": ["laws"],
        "BH": ["hotel"],
        "BS": ["sports"],
        "AC": ["acca"],
        "NU": ["nursing"],
        "CN": ["accountancy", "chartered"],
        "IA": ["accounting", "international"],
        "BN": ["analytics"],
        "MB": ["mba"],
        "MD": ["medicine"],
        "CA": ["computer applications"],
        "CS": ["computer science", "engineering"],
        "EC": ["electronics"],
        "EE": ["electrical"],
        "ME": ["mechanical"],
        "BT": ["biotechnology"],
        "CV": ["civil"]
    };
    
    for (const [code, keywordList] of Object.entries(keywords)) {
        for (const keyword of keywordList) {
            if (text.includes(keyword)) {
                return code;
            }
        }
    }
    
    return null;
}

/**
 * Resolve course code from profile using multiple strategies
 */
export function resolveCourseFromProfile(profile) {
    if (!profile) {
        log.info('resolveCourseFromProfile: no profile provided');
        return null;
    }
    
    // 1. Try profile.course if already set (from login handler)
    if (profile.course) {
        log.info('resolveCourseFromProfile: using profile.course', { course: profile.course });
        return profile.course;
    }
    
    // 2. Try exact match from branch/program
    const exactMatch = getCourseCodeFromProfile(profile);
    if (exactMatch) {
        log.info('resolveCourseFromProfile: exact match found', { course: exactMatch });
        return exactMatch;
    }
    
    // 3. Try fuzzy keyword matching
    log.info('resolveCourseFromProfile: trying fuzzy match', { program: profile.program, branch: profile.branch });
    const fuzzyMatch = resolveCourseByKeyword(profile);
    if (fuzzyMatch) {
        log.info('resolveCourseFromProfile: fuzzy match found', { course: fuzzyMatch });
    } else {
        log.warn('resolveCourseFromProfile: no match found', { program: profile.program, branch: profile.branch });
    }
    return fuzzyMatch;
}

/**
 * Extract access token from request headers
 */
export function extractAccessToken(request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
        log.info('Token found in Authorization header');
        return authHeader.split(' ')[1];
    }
    
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
        const parts = cookieHeader.split(';').map(s => s.trim());
        for (const p of parts) {
            if (p.startsWith('access_token=')) {
                log.info('Token found in cookie');
                return p.slice('access_token='.length);
            }
        }
    }
    
    log.info('No access token found in request');
    return null;
}

/**
 * Get authenticated user profile and course from request
 * Returns { valid: boolean, profile: Object|null, course: string|null, error: string|null }
 */
export async function getAuthenticatedUser(request, env) {
    log.info('Starting authentication check');
    const accessToken = extractAccessToken(request);
    
    if (!accessToken) {
        log.warn('Authentication failed: no token found');
        return { valid: false, profile: null, course: null, error: 'no_token' };
    }
    
    log.info('Token extracted, verifying JWT');
    
    try {
        const decoded = await verifyJWT(accessToken, env.JWT_SECRET);
        
        if (!decoded || !decoded.valid) {
            log.warn('JWT verification returned invalid', { decoded });
            return { valid: false, profile: null, course: null, error: 'invalid_token' };
        }
        
        log.info('JWT verified successfully', { type: decoded.payload?.type });
        
        if (decoded.payload?.type !== 'access') {
            log.warn('Wrong token type', { type: decoded.payload?.type });
            return { valid: false, profile: null, course: null, error: 'wrong_token_type' };
        }
        
        const profile = decoded.payload?.profile || null;
        if (!profile) {
            log.warn('No profile found in token payload');
            return { valid: false, profile: null, course: null, error: 'no_profile' };
        }
        
        log.info('Profile extracted from token', { name: profile.name, program: profile.program, branch: profile.branch });
        
        const course = resolveCourseFromProfile(profile);
        if (!course) {
            log.warn('Could not resolve course from profile', { program: profile?.program, branch: profile?.branch, profileCourse: profile?.course });
            return { valid: false, profile, course: null, error: 'no_course' };
        }
        
        log.info('Authentication successful', { course, username: profile.name });
        return { valid: true, profile, course, error: null };
    } catch (e) {
        log.error('JWT verification failed', { error: e.message, stack: e.stack });
        return { valid: false, profile: null, course: null, error: 'verification_failed' };
    }
}
