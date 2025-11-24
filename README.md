### Tech Stack & Features

**Frontend**
- Semantic HTML for structure, custom CSS for responsive layouts, and vanilla JavaScript for all UI logic.
- Reusable UI helpers (loading states, toasts, modals) and client-side validation for forms, username sanitization, and password strength checks before hitting the network.

**Firebase Backend**
- Firebase Auth for authentication/session management.
- Cloud Firestore for real-time chat threads, user presence, and message metadata.
- Firebase Storage for optional media uploads in conversations.
- Firebase Security Rules to enforce per-user access control and server-side validation of chat payloads.

**Security**
- SHA-256 hashing via the Web Crypto API before sending passwords to Firebase Auth.
- Dual validation: client-side guards for immediate feedback plus rule-based validation inside Firebase to reject malformed chat data even if the client is bypassed.