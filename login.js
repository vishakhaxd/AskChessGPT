// Login Page JavaScript
class LoginPageManager {
    constructor() {
        this.currentTab = 'signin';
        this.initializeEventListeners();
        // Removed automatic auth check that was causing redirect
    }

    initializeEventListeners() {
        // Tab switching
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Form submissions
        document.getElementById('signinForm').addEventListener('submit', (e) => {
            this.handleSignIn(e);
        });

        document.getElementById('signupForm').addEventListener('submit', (e) => {
            this.handleSignUp(e);
        });

        // Google sign in
        document.getElementById('googleSignIn').addEventListener('click', () => {
            this.handleGoogleSignIn();
        });

        // Password confirmation validation
        document.getElementById('signup-confirm').addEventListener('input', () => {
            this.validatePasswordMatch();
        });
    }

    // Check if user is already authenticated
    async checkAuthStatus() {
        if (authService.isAuthenticated()) {
            // Redirect to main page if already logged in
            window.location.href = '/index.html';
        }
    }

    // Switch between sign in and sign up tabs
    switchTab(tabName) {
        // Update active tab button
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Show/hide forms
        document.querySelectorAll('.auth-form').forEach(form => {
            form.classList.remove('active');
        });
        
        if (tabName === 'signin') {
            document.getElementById('signinForm').classList.add('active');
        } else {
            document.getElementById('signupForm').classList.add('active');
        }

        this.currentTab = tabName;
        this.clearMessage();
    }

    // Handle sign in form submission
    async handleSignIn(e) {
        e.preventDefault();
        
        const email = document.getElementById('signin-email').value.trim();
        const password = document.getElementById('signin-password').value;

        if (!email || !password) {
            this.showMessage('Please fill in all fields.', 'error');
            return;
        }

        this.showLoading('Signing in...');

        try {
            // Wait for auth service to be available
            let retries = 0;
            while ((!window.authService && !authService) && retries < 20) {
                console.log('Waiting for auth service to be ready...', retries);
                await new Promise(resolve => setTimeout(resolve, 100));
                retries++;
            }
            
            const auth = window.authService || authService;
            if (!auth) {
                throw new Error('Auth service not available');
            }
            
            const result = await auth.signInWithEmail(email, password);
            
            if (result.success) {
                this.showMessage('Signed in successfully! Redirecting...', 'success');
                // AuthService will handle the redirect
            } else {
                this.showMessage(result.error || 'Sign in failed. Please try again.', 'error');
            }
        } catch (error) {
            console.error('Sign in error:', error);
            this.showMessage('An unexpected error occurred. Please try again.', 'error');
        }
    }

    // Handle sign up form submission
    async handleSignUp(e) {
        e.preventDefault();
        
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;
        const confirmPassword = document.getElementById('signup-confirm').value;

        // Validation
        if (!email || !password || !confirmPassword) {
            this.showMessage('Please fill in all fields.', 'error');
            return;
        }

        if (password !== confirmPassword) {
            this.showMessage('Passwords do not match.', 'error');
            return;
        }

        if (password.length < 6) {
            this.showMessage('Password must be at least 6 characters long.', 'error');
            return;
        }

        this.showLoading('Creating account...');

        try {
            // Wait for auth service to be available
            let retries = 0;
            while ((!window.authService && !authService) && retries < 20) {
                console.log('Waiting for auth service to be ready...', retries);
                await new Promise(resolve => setTimeout(resolve, 100));
                retries++;
            }
            
            const auth = window.authService || authService;
            if (!auth) {
                throw new Error('Auth service not available');
            }
            
            const result = await auth.signUpWithEmail(email, password);
            
            if (result.success) {
                if (result.data.user && !result.data.session) {
                    this.showMessage('Please check your email for a confirmation link.', 'success');
                } else {
                    this.showMessage('Account created successfully! Redirecting...', 'success');
                }
            } else {
                this.showMessage(result.error || 'Sign up failed. Please try again.', 'error');
            }
        } catch (error) {
            console.error('Sign up error:', error);
            this.showMessage('An unexpected error occurred. Please try again.', 'error');
        }
    }

    // Handle Google sign in
    async handleGoogleSignIn() {
        this.showLoading('Redirecting to Google...');

        try {
            console.log('Current site URL:', window.location.origin);
            console.log('Current hostname:', window.location.hostname);
            
            // Wait for auth service to be available
            let retries = 0;
            while ((!window.authService && !authService) && retries < 20) {
                console.log('Waiting for auth service to be ready...', retries);
                await new Promise(resolve => setTimeout(resolve, 100));
                retries++;
            }
            
            const auth = window.authService || authService;
            if (!auth) {
                throw new Error('Auth service not available');
            }
            
            console.log('Auth service available, attempting Google sign in...');
            const result = await auth.signInWithGoogle();
            
            if (!result.success) {
                this.showMessage(result.error || 'Google sign in failed. Please try again.', 'error');
            }
            // If successful, the OAuth flow will handle the redirect
        } catch (error) {
            console.error('Google sign in error:', error);
            this.showMessage('Google sign in failed. Please try again.', 'error');
        }
    }

    // Validate password match in real-time
    validatePasswordMatch() {
        const password = document.getElementById('signup-password').value;
        const confirmPassword = document.getElementById('signup-confirm').value;
        const confirmInput = document.getElementById('signup-confirm');

        if (confirmPassword && password !== confirmPassword) {
            confirmInput.setCustomValidity('Passwords do not match');
            confirmInput.classList.add('error');
        } else {
            confirmInput.setCustomValidity('');
            confirmInput.classList.remove('error');
        }
    }

    // Show loading state
    showLoading(message) {
        const messageElement = document.getElementById('authMessage');
        messageElement.innerHTML = `
            <i class="fas fa-spinner fa-spin"></i>
            ${message}
        `;
        messageElement.className = 'auth-message loading';
        messageElement.style.display = 'block';

        // Disable all buttons during loading
        this.toggleButtonsDisabled(true);
    }

    // Show success/error message
    showMessage(message, type = 'info') {
        const messageElement = document.getElementById('authMessage');
        const icon = type === 'error' ? 'fas fa-exclamation-circle' : 
                    type === 'success' ? 'fas fa-check-circle' : 'fas fa-info-circle';
        
        messageElement.innerHTML = `
            <i class="${icon}"></i>
            ${message}
        `;
        messageElement.className = `auth-message ${type}`;
        messageElement.style.display = 'block';

        // Re-enable buttons
        this.toggleButtonsDisabled(false);

        // Auto-hide success messages
        if (type === 'success') {
            setTimeout(() => {
                this.clearMessage();
            }, 3000);
        }
    }

    // Clear message
    clearMessage() {
        const messageElement = document.getElementById('authMessage');
        messageElement.style.display = 'none';
        messageElement.className = 'auth-message';
        this.toggleButtonsDisabled(false);
    }

    // Enable/disable all buttons
    toggleButtonsDisabled(disabled) {
        document.querySelectorAll('.btn').forEach(btn => {
            btn.disabled = disabled;
        });
        
        document.querySelectorAll('input').forEach(input => {
            input.disabled = disabled;
        });
    }
}

// Initialize login page when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new LoginPageManager();
});