import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { initializeApp, deleteApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  limit,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';

import {
  auth,
  db,
  firebaseConfig,
  firestoreWriteWithTimeout,
  getDocPreferCache,
  getDocsPreferCache,
} from '../../../backend/lib/firebase.ts';

export type UserRole = 'superadmin' | 'admin' | 'viewer' | 'vocalia';

interface UserProfile {
  email: string;
  displayName?: string;
  role: UserRole;
  disabled?: boolean;
  status?: 'active' | 'inactive' | 'deleted';
  deleted?: boolean;
  teamId?: string;
}

interface CreateUserInput {
  email: string;
  password?: string;
  displayName?: string;
  role: UserRole;
  teamId?: string;
}

interface ResetInactiveUserInput {
  userId: string;
  email: string;
  displayName?: string;
}

interface ResetInactiveUserResult {
  temporaryPassword: string;
}

interface AuthContextValue {
  user: User | null;
  role: UserRole | null;
  teamId: string | null;
  loading: boolean;
  authMessage: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  createUserWithRole: (input: CreateUserInput) => Promise<{ invitedByEmail: boolean }>;
  updateUserRole: (userId: string, role: UserRole) => Promise<void>;
  sendPasswordResetForUser: (email: string) => Promise<void>;
  resetInactiveUser: (input: ResetInactiveUserInput) => Promise<ResetInactiveUserResult>;
  disableUser: (userId: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  ensureDefaultSuperadmin: () => Promise<{ created: boolean; email: string }>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const DEFAULT_ROLE: UserRole = 'viewer';
const SUPERADMIN_EMAIL = (import.meta.env.VITE_SUPERADMIN_EMAIL ?? 'superadmin@vocalia.local').trim().toLowerCase();
const SUPERADMIN_PASSWORD = (import.meta.env.VITE_SUPERADMIN_PASSWORD ?? 'admin123').trim();

const USER_ROLES: UserRole[] = ['superadmin', 'admin', 'viewer', 'vocalia'];

const parseUserRole = (value: unknown): UserRole => {
  return typeof value === 'string' && USER_ROLES.includes(value as UserRole)
    ? (value as UserRole)
    : DEFAULT_ROLE;
};

const normalizeEmail = (value: string | null | undefined): string => {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
};

const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';

const generateTemporaryPassword = (length = 12): string => {
  const randomValues = new Uint32Array(length);
  globalThis.crypto.getRandomValues(randomValues);

  return Array.from(randomValues, (value) => TEMP_PASSWORD_CHARS[value % TEMP_PASSWORD_CHARS.length]).join('');
};

const isConfiguredSuperadminEmail = (email: string | null | undefined): boolean => {
  return normalizeEmail(email) === SUPERADMIN_EMAIL;
};

const createInitialProfile = (user: User): UserProfile => ({
  email: user.email ?? '',
  displayName: user.displayName ?? '',
  role: isConfiguredSuperadminEmail(user.email) ? 'superadmin' : DEFAULT_ROLE,
});

const ensureUserDocument = async (user: User) => {
  const ref = doc(db, 'users', user.uid);
  const snapshot = await getDocPreferCache(ref);
  const shouldBeSuperadmin = isConfiguredSuperadminEmail(user.email);

  if (!snapshot.exists()) {
    await firestoreWriteWithTimeout(
      setDoc(ref, { ...createInitialProfile(user), createdAt: serverTimestamp() }, { merge: true }),
    );
    return;
  }

  const currentData = snapshot.data() as UserProfile | undefined;
  if (shouldBeSuperadmin && currentData?.role !== 'superadmin') {
    await firestoreWriteWithTimeout(
      setDoc(
        ref,
        {
          role: 'superadmin',
          disabled: false,
          isSystemSuperadmin: true,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    );
  }
};

const createSecondaryApp = (): FirebaseApp => {
  const name = `admin-${Date.now()}`;
  return initializeApp(firebaseConfig, name);
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  useEffect(() => {
    let profileUnsubscribe: Unsubscribe | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      setUser(firebaseUser);
      setRole(null);

      if (!firebaseUser) {
        profileUnsubscribe?.();
        setTeamId(null);
        setLoading(false);
        return;
      }

      try {
        await ensureUserDocument(firebaseUser);
      } catch (error) {
        console.warn('[AuthProvider] Could not ensure user document (offline?)', error);
      }

      const superadminByEmail = isConfiguredSuperadminEmail(firebaseUser.email);

      const profileRef = doc(db, 'users', firebaseUser.uid);
      profileUnsubscribe?.();
      profileUnsubscribe = onSnapshot(
        profileRef,
        (snapshot) => {
          const data = snapshot.data() as UserProfile | undefined;

          if (data?.disabled === true && !superadminByEmail) {
            setAuthMessage('Cuenta deshabilitada');
            setRole(DEFAULT_ROLE);
            setLoading(false);
            void firebaseSignOut(auth).catch((error) => {
              console.error('[AuthProvider] Failed to sign out disabled user', error);
            });
            return;
          }

          setRole(superadminByEmail ? 'superadmin' : parseUserRole(data?.role));
          setTeamId(data?.teamId ?? null);
          setLoading(false);
        },
        (error) => {
          console.error('[AuthProvider] Error reading user profile', error);
          setRole(superadminByEmail ? 'superadmin' : DEFAULT_ROLE);
          setLoading(false);
        },
      );

      if (superadminByEmail) {
        setRole('superadmin');
        setLoading(false);
      }
    });

    return () => {
      profileUnsubscribe?.();
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    return () => {
      getApps()
        .filter((appInstance) => appInstance.name.startsWith('admin-'))
        .forEach((secondary) => {
          deleteApp(secondary).catch((error) => console.warn('[AuthProvider] Failed to delete secondary app', error));
        });
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    setAuthMessage(null);
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  const createUserWithRole = async ({ email, password, displayName, role: targetRole, teamId: inputTeamId }: CreateUserInput): Promise<{ invitedByEmail: boolean }> => {
    const trimmedPassword = password?.trim() ?? '';
    // Si el admin no escribe una contraseña (o es muy corta), creamos la cuenta
    // con una contraseña temporal aleatoria y enviamos un correo para que el
    // propio usuario defina su contraseña.
    const usingTempPassword = trimmedPassword.length < 6;
    const effectivePassword = usingTempPassword ? generateTemporaryPassword() : trimmedPassword;
    const normalizedEmail = email.trim();

    const secondaryApp = createSecondaryApp();
    try {
      const secondaryAuth = getAuth(secondaryApp);
      const { user: createdUser } = await createUserWithEmailAndPassword(secondaryAuth, normalizedEmail, effectivePassword);

      if (displayName) {
        await updateProfile(createdUser, { displayName: displayName.trim() });
      }

      await firestoreWriteWithTimeout(
        setDoc(
          doc(db, 'users', createdUser.uid),
          {
            email: createdUser.email ?? normalizedEmail,
            displayName: displayName?.trim() ?? createdUser.displayName ?? '',
            role: targetRole,
            teamId: inputTeamId ?? null,
            status: 'active',
            disabled: false,
            deleted: false,
            mustResetPassword: usingTempPassword,
            createdAt: serverTimestamp(),
          },
          { merge: true },
        ),
      );
    } finally {
      await deleteApp(secondaryApp);
    }

    if (usingTempPassword) {
      // Tras definir su contraseña, el correo muestra un botón para volver al login.
      await sendPasswordResetEmail(auth, normalizedEmail, {
        url: `${window.location.origin}/login`,
        handleCodeInApp: false,
      });
    }

    return { invitedByEmail: usingTempPassword };
  };

  const updateUserRole = async (userId: string, nextRole: UserRole) => {
    await firestoreWriteWithTimeout(
      setDoc(doc(db, 'users', userId), { role: nextRole }, { merge: true }),
    );
  };

  const sendPasswordResetForUser = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim(), {
      url: `${window.location.origin}/login`,
      handleCodeInApp: false,
    });
  };

  const resetInactiveUser = async ({ userId, email, displayName }: ResetInactiveUserInput): Promise<ResetInactiveUserResult> => {
    const userRef = doc(db, 'users', userId);
    const snapshot = await getDocPreferCache(userRef);

    if (!snapshot.exists()) {
      throw new Error('El usuario no existe en Firestore.');
    }

    const currentData = snapshot.data() as UserProfile;
    const isDeleted = currentData.status === 'deleted' || currentData.deleted === true;
    const isInactive = currentData.status === 'inactive' || currentData.disabled === true;

    if (isDeleted) {
      throw new Error('No es posible resetear usuarios eliminados.');
    }

    if (!isInactive) {
      throw new Error('Solo se puede resetear usuarios inactivos.');
    }

    const temporaryPassword = generateTemporaryPassword();
    await sendPasswordResetEmail(auth, email.trim());

    const normalizedDisplayName = displayName?.trim();
    await firestoreWriteWithTimeout(
      setDoc(
        userRef,
        {
          displayName: normalizedDisplayName && normalizedDisplayName.length > 0
            ? normalizedDisplayName
            : (currentData.displayName ?? ''),
          status: 'active',
          disabled: false,
          deleted: false,
          reactivatedAt: serverTimestamp(),
          reactivatedBy: user?.uid ?? null,
          mustResetPassword: true,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    );

    return { temporaryPassword };
  };

  const disableUser = async (userId: string) => {
    await firestoreWriteWithTimeout(
      setDoc(
        doc(db, 'users', userId),
        {
          status: 'inactive',
          disabled: true,
          deleted: false,
          disabledAt: serverTimestamp(),
        },
        { merge: true },
      ),
    );
  };

  const deleteUser = async (userId: string) => {
    // No usamos firestoreWriteWithTimeout aquí: ese helper se traga los errores
    // y resuelve a los 1.5s, lo que hacía que la UI dijera "eliminado" aunque el
    // borrado fallara por permisos. Queremos que el error real llegue al panel.
    await deleteDoc(doc(db, 'users', userId));
  };

  const ensureDefaultSuperadmin = async (): Promise<{ created: boolean; email: string }> => {
    if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD) {
      throw new Error('Superadmin defaults are not configured.');
    }

    const secondaryApp = createSecondaryApp();
    let createdUserId: string | null = null;

    try {
      const secondaryAuth = getAuth(secondaryApp);
      const { user: createdUser } = await createUserWithEmailAndPassword(
        secondaryAuth,
        SUPERADMIN_EMAIL,
        SUPERADMIN_PASSWORD,
      );

      createdUserId = createdUser.uid;
      if ((createdUser.displayName ?? '').trim().length === 0) {
        await updateProfile(createdUser, { displayName: 'Super Administrador' });
      }
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === 'string'
        ? (error as { code: string }).code
        : '';

      if (code !== 'auth/email-already-in-use') {
        throw error;
      }
    } finally {
      await deleteApp(secondaryApp);
    }

    if (createdUserId) {
      await firestoreWriteWithTimeout(
        setDoc(
          doc(db, 'users', createdUserId),
          {
            email: SUPERADMIN_EMAIL,
            displayName: 'Super Administrador',
            role: 'superadmin',
            status: 'active',
            disabled: false,
            deleted: false,
            isSystemSuperadmin: true,
            createdAt: serverTimestamp(),
          },
          { merge: true },
        ),
      );

      return { created: true, email: SUPERADMIN_EMAIL };
    }

    const existingProfileQuery = query(
      collection(db, 'users'),
      where('email', '==', SUPERADMIN_EMAIL),
      limit(1),
    );
    const existingProfileSnapshot = await getDocsPreferCache(existingProfileQuery);

    if (!existingProfileSnapshot.empty) {
      const existingDoc = existingProfileSnapshot.docs[0];
      await firestoreWriteWithTimeout(
        setDoc(
          doc(db, 'users', existingDoc.id),
          {
            role: 'superadmin',
            status: 'active',
            disabled: false,
            deleted: false,
            isSystemSuperadmin: true,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        ),
      );
    }

    return { created: false, email: SUPERADMIN_EMAIL };
  };

  const value: AuthContextValue = {
    user,
    role,
    teamId,
    loading,
    authMessage,
    signIn,
    signOut,
    createUserWithRole,
    updateUserRole,
    sendPasswordResetForUser,
    resetInactiveUser,
    disableUser,
    deleteUser,
    ensureDefaultSuperadmin,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
};
