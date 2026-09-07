import { prepareDesktopProfile } from './desktop-bootstrap';

// Resolve the profile before importing stores and components that capture
// profile-scoped storage keys at module initialization.
void prepareDesktopProfile().then(() => import('./main-app'));
