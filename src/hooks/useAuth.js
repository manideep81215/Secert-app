// Clear persisted auth data on logout
function logout() {
    // Clear localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userId');
    localStorage.removeItem('username');
    localStorage.removeItem('profile');

    // Other logout logic...
}

// Store fresh auth state after login
function login(authResponse) {
    if (authResponse.token) {
        localStorage.setItem('token', authResponse.token);
        localStorage.setItem('refreshToken', authResponse.refreshToken);
        localStorage.setItem('userId', authResponse.userId);
        localStorage.setItem('username', authResponse.username);
        localStorage.setItem('profile', JSON.stringify(authResponse.profile));
    }
    // Handle login errors
}

// Error handling for authentication
function handleAuthError(error) {
    if (error.response) {
        // check if error is due to invalid email/password
        if (error.response.status === 401) {
            console.error('Invalid email/password.');
        }
        // handle other response errors
    } else {
        console.error('Authentication failed:', error.message);
    }
}