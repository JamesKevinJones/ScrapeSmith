import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of WORKSPACE_SCOPES) {
  provider.addScope(scope);
}

// Keep OAuth access token strictly in memory (never localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export function initGoogleAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthNeedsSignIn?: (user: User | null) => void
): () => void {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthNeedsSignIn?.(user);
      }
    } else {
      cachedAccessToken = null;
      onAuthNeedsSignIn?.(null);
    }
  });
}

export async function signInWithGoogle(): Promise<{ user: User; accessToken: string }> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google sign-in completed, but no Workspace access token was returned.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getGoogleAccessToken(): string | null {
  return cachedAccessToken;
}

export function clearGoogleAccessToken(): void {
  cachedAccessToken = null;
}

export async function signOutGoogle(): Promise<void> {
  cachedAccessToken = null;
  await auth.signOut();
}
