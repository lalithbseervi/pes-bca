// Mobile Navigation Module
(function() {
    'use strict';

    // Inject mobile navigation CSS
    const mobileNavStyles = document.createElement('style');
    mobileNavStyles.textContent = `
        /* Mobile bottom navigation */
        .mobile-nav {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: #1a1a1a;
            border-top: 1px solid #333;
            padding: 8px 0;
            z-index: 999;
            box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.3);
        }

        .mobile-nav-container {
            display: flex;
            justify-content: space-around;
            align-items: center;
            max-width: 100%;
            margin: 0 auto;
        }

        .mobile-nav-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 8px 12px;
            cursor: pointer;
            transition: all 0.2s ease;
            border-radius: 8px;
            flex: 1;
            max-width: 80px;
        }

        .mobile-nav-item:hover,
        .mobile-nav-item.active {
            background: #4a90e2;
        }

        .mobile-nav-item .icon {
            font-size: 1.2rem;
            margin-bottom: 4px;
        }

        .mobile-nav-item .label {
            font-size: 0.7rem;
            color: #e0e0e0;
            text-align: center;
            white-space: nowrap;
        }

        .body {
            padding-bottom: 80px !important;
        }

        .parent-parent {
            margin-bottom: 20px;
        }
    `;
    document.head.appendChild(mobileNavStyles);

    // Inject mobile navigation HTML
    const mobileNav = document.createElement('nav');
    mobileNav.className = 'mobile-nav';
    mobileNav.innerHTML = `
        <div class="mobile-nav-container">
            <div class="mobile-nav-item active" data-subject="all">
                <div class="icon">📚</div>
                <div class="label">All</div>
            </div>
            <div class="mobile-nav-item" data-subject="wd">
                <div class="icon">🌐</div>
                <div class="label">WD</div>
            </div>
            <div class="mobile-nav-item" data-subject="cfp">
                <div class="icon">💻</div>
                <div class="label">CFP</div>
            </div>
            <div class="mobile-nav-item" data-subject="mp">
                <div class="icon">⚙️</div>
                <div class="label">MP</div>
            </div>
            <div class="mobile-nav-item" data-subject="mfca">
                <div class="icon">📊</div>
                <div class="label">MFCA</div>
            </div>
            <div class="mobile-nav-item" data-subject="pce">
                <div class="icon">🎤</div>
                <div class="label">PCE</div>
            </div>
        </div>
    `;
    document.body.appendChild(mobileNav);

    // Initialize mobile navigation functionality
    initializeMobileNav();

    function initializeMobileNav() {
        const navItems = document.querySelectorAll('.mobile-nav-item');
        const allSubjects = {
            'wd': document.getElementById('subject-wd'),
            'cfp': document.getElementById('subject-cfp'),
            'mp': document.getElementById('subject-mp'),
            'mfca': document.getElementById('subject-mfca'),
            'pce': document.getElementById('subject-pce')
        };

        navItems.forEach(item => {
            item.addEventListener('click', function() {
                const subject = this.getAttribute('data-subject');
                
                // Update active state
                navItems.forEach(nav => nav.classList.remove('active'));
                this.classList.add('active');

                // Track with PostHog
                if (window.posthog) {
                    posthog.capture('mobile_nav_clicked', {
                        subject: subject
                    });
                }

                // Show/hide subjects
                if (subject === 'all') {
                    Object.values(allSubjects).forEach(subj => {
                        if (subj) subj.style.display = 'block';
                    });
                } else {
                    Object.values(allSubjects).forEach(subj => {
                        if (subj) subj.style.display = 'none';
                    });
                    
                    if (allSubjects[subject]) {
                        allSubjects[subject].style.display = 'block';
                    }
                }

                // Scroll to top of content
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });
    }
})();