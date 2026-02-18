// Supabase Configuration
const SUPABASE_URL = 'https://lplrcwixlwcbfnnbdvld.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwbHJjd2l4bHdjYmZubmJkdmxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM3Njk2OTEsImV4cCI6MjA3OTM0NTY5MX0.-srVo1AmjjRlVVWTI-bIt7xBZqS1mfxnc8ebc-8cHX0';

// Authentication service
class AuthService {
    constructor() {
        console.log('AuthService constructor called');
        this.supabase = null;
        this.currentUser = null;
        this.initPromise = this.init();
    }

    async init() {
        try {
            console.log('AuthService init() called');
            
            // Ensure Supabase is available
            if (typeof supabase === 'undefined') {
                throw new Error('Supabase library not loaded');
            }
            
            if (typeof supabase.createClient === 'undefined') {
                throw new Error('createClient function not available');
            }
            
            // Initialize Supabase client
            this.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log('Supabase client created successfully');
            
            // Check current session with retry
            const { data: { session }, error } = await this.supabase.auth.getSession();
            console.log('Initial session check:', { session, error });
            
            if (session && session.user) {
                this.currentUser = session.user;
                console.log('Found existing session:', this.currentUser);
                // Trigger UI update after DOM is ready
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => {
                        this.onAuthSuccess(this.currentUser);
                    });
                } else {
                    this.onAuthSuccess(this.currentUser);
                }
            }
            
            // Listen for auth changes
            this.supabase.auth.onAuthStateChange((event, session) => {
                console.log('Auth state changed:', event, session);
                
                if (event === 'SIGNED_IN' && session) {
                    this.currentUser = session.user;
                    this.onAuthSuccess(session.user);
                } else if (event === 'SIGNED_OUT') {
                    this.currentUser = null;
                    this.onAuthSignOut();
                } else if (event === 'TOKEN_REFRESHED' && session) {
                    this.currentUser = session.user;
                }
            });
            
            console.log('Auth service initialization completed successfully');
        } catch (error) {
            console.error('Auth service initialization error:', error);
            throw error;
        }
    }

    // Sign in with email and password
    async signInWithEmail(email, password) {
        try {
            await this.initPromise; // Wait for initialization
            if (!this.supabase) {
                throw new Error('Auth service not initialized');
            }
            
            const { data, error } = await this.supabase.auth.signInWithPassword({
                email,
                password
            });

            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Email sign in error:', error);
            return { success: false, error: error.message };
        }
    }

    // Sign up with email and password
    async signUpWithEmail(email, password) {
        try {
            await this.initPromise; // Wait for initialization
            if (!this.supabase) {
                throw new Error('Auth service not initialized');
            }
            
            const { data, error } = await this.supabase.auth.signUp({
                email,
                password
            });

            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Email sign up error:', error);
            return { success: false, error: error.message };
        }
    }

    // Sign in with Google
    async signInWithGoogle() {
        try {
            console.log('Google sign in requested, waiting for auth service...');
            await this.initPromise; // Wait for initialization
            
            if (!this.supabase) {
                console.error('Supabase client not available after initialization');
                throw new Error('Auth service not properly initialized');
            }
            
            console.log('Auth service ready, proceeding with Google sign in...');
            
            // Get the current site URL - force to production URL if needed
            const siteUrl = window.location.hostname === 'askchessgpt.com' 
                ? 'https://askchessgpt.com' 
                : window.location.origin;
                
            console.log('Redirect URL will be:', siteUrl);
                
            const { data, error } = await this.supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: siteUrl
                }
            });

            if (error) throw error;
            
            console.log('Google OAuth initiated successfully');
            return { success: true, data };
        } catch (error) {
            console.error('Google sign in error:', error);
            return { success: false, error: error.message };
        }
    }

    // Sign out
    async signOut() {
        try {
            const { error } = await this.supabase.auth.signOut();
            if (error) throw error;
            
            this.currentUser = null;
            return { success: true };
        } catch (error) {
            console.error('Sign out error:', error);
            return { success: false, error: error.message };
        }
    }

    // Get current user
    getCurrentUser() {
        return this.currentUser;
    }

    // Check if user is authenticated
    isAuthenticated() {
        return this.currentUser !== null;
    }

    // Handle successful authentication
    onAuthSuccess(user) {
        console.log('Authentication successful:', user);
        console.log('User metadata:', user.user_metadata); // Debug log
        
        // Store user data in localStorage for quick access
        localStorage.setItem('user', JSON.stringify({
            id: user.id,
            email: user.email,
            name: user.user_metadata?.name || user.user_metadata?.full_name || user.email,
            avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture
        }));

        // Update UI to show user is logged in (with multiple attempts to ensure DOM is ready)
        const updateUI = () => {
            if (typeof updateUserDisplay === 'function') {
                console.log('Calling updateUserDisplay from auth success');
                updateUserDisplay();
            } else {
                console.log('updateUserDisplay function not available');
            }
        };
        
        // Try immediately and with delays
        updateUI();
        setTimeout(updateUI, 100);
        setTimeout(updateUI, 500);
        setTimeout(updateUI, 1000);

        // Redirect to main game if on login page
        if (window.location.pathname === '/login.html') {
            setTimeout(() => {
                window.location.href = '/index.html';
            }, 1000);
        }
    }

    // Handle sign out
    onAuthSignOut() {
        console.log('User signed out');
        
        // Clear localStorage
        localStorage.removeItem('user');
        
        // Update UI to show login button (with small delay)
        setTimeout(() => {
            if (typeof updateUserDisplay === 'function') {
                updateUserDisplay();
            }
        }, 100);
        
        // Don't automatically redirect - user can stay on main page
    }

    // Optional auth check - does not redirect
    requireAuth() {
        return this.isAuthenticated();
    }

    // Get user display name
    getUserDisplayName() {
        if (!this.currentUser) return 'Guest';
        return this.currentUser.user_metadata?.name || this.currentUser.email || 'User';
    }
}

// Initialize auth service and make it globally available
let authService;

// Wait for Supabase to be available before initializing
async function initializeAuthService() {
    try {
        if (typeof supabase !== 'undefined') {
            console.log('Supabase available, initializing auth service...');
            authService = new AuthService();
            // Make it globally available
            window.authService = authService;
            
            // Wait for initialization to complete
            await authService.initPromise;
            console.log('Auth service fully initialized and ready');
        } else {
            console.log('Waiting for Supabase to load...');
            setTimeout(initializeAuthService, 100);
        }
    } catch (error) {
        console.error('Failed to initialize auth service:', error);
        // Retry after a delay
        setTimeout(initializeAuthService, 500);
    }
}

// Start initialization
initializeAuthService();