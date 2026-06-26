import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { collection, getDocsFromServer, onSnapshot, orderBy, query, type DocumentData } from 'firebase/firestore';

import { db } from '../../backend/lib/firebase.ts';
import { useAuth, type UserRole } from '../app/providers/AuthProvider.tsx';

interface UserEntry {
  id: string;
  email: string;
  displayName?: string;
  role: UserRole;
  disabled?: boolean;
  status?: 'active' | 'inactive' | 'deleted';
  deleted?: boolean;
  createdAt?: Date | null;
}

const emptyForm = {
  email: '',
  password: '',
  displayName: '',
  role: 'viewer' as UserRole,
};

export const UserManagementPanel = () => {
  const {
    createUserWithRole,
    updateUserRole,
    sendPasswordResetForUser,
    resetInactiveUser,
    disableUser,
    deleteUser,
    user,
    role,
  } = useAuth();
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showInactiveUsers, setShowInactiveUsers] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [temporaryResetCredentials, setTemporaryResetCredentials] = useState<{
    email: string;
    displayName: string;
    temporaryPassword: string;
  } | null>(null);

  const isSuperadmin = role === 'superadmin';

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('email'));

    // Forzamos una lectura al servidor al montar para reconciliar el caché offline
    // (IndexedDB) y eliminar "usuarios fantasma" que ya no existen en Firestore.
    getDocsFromServer(q).catch((err) => {
      console.warn('[UserManagementPanel] No se pudo refrescar desde el servidor', err);
    });

    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snapshot) => {
        setFromCache(snapshot.metadata.fromCache);
        const parsed = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data() as DocumentData;
          const status = (
            data.status
              ?? (data.deleted === true ? 'deleted' : (data.disabled === true ? 'inactive' : 'active'))
          ) as 'active' | 'inactive' | 'deleted';

          return {
            id: docSnapshot.id,
            email: data.email ?? 'sin-email',
            displayName: data.displayName,
            role: (data.role ?? 'viewer') as UserRole,
            disabled: data.disabled === true,
            status,
            deleted: data.deleted === true || status === 'deleted',
            createdAt: data.createdAt?.toDate?.() ?? null,
          } satisfies UserEntry;
        });

        setUsers(parsed);
        setError(null);
      },
      (err) => {
        console.error('[UserManagementPanel] onSnapshot error', err);
        setError(err instanceof Error ? err.message : 'No se pudieron cargar los usuarios.');
      },
    );

    return () => unsubscribe();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      setTemporaryResetCredentials(null);
      setIsSubmitting(true);

      if (form.role === 'superadmin' && !isSuperadmin) {
        throw new Error('Solo un superadmin puede crear otro superadmin.');
      }

      const result = await createUserWithRole(form);
      setSuccess(
        result.invitedByEmail
          ? `Se creó la cuenta para ${form.email} y se le envió un correo para que defina su contraseña.`
          : `Se creó la cuenta para ${form.email}.`,
      );
      setForm(emptyForm);
    } catch (err) {
      console.error('[UserManagementPanel] Failed to create user', err);
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/email-already-in-use') {
        setError(`El correo ${form.email} ya tiene una cuenta en Authentication. Para reutilizarlo, bórralo primero en la consola de Firebase → Authentication, y luego vuelve a crearlo aquí.`);
      } else {
        setError('No se pudo crear el usuario. Verifica que el correo sea válido y no exista ya. Si escribiste una contraseña, debe tener al menos 6 caracteres.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRoleChange = async (userId: string, nextRole: UserRole) => {
    try {
      if (nextRole === 'superadmin' && !isSuperadmin) {
        throw new Error('Solo un superadmin puede asignar este rol.');
      }
      await updateUserRole(userId, nextRole);
    } catch (err) {
      console.error('[UserManagementPanel] Failed to update role', err);
      alert('No se pudo actualizar el rol.');
    }
  };

  const handleSendReset = async (email: string) => {
    try {
      setError(null);
      setSuccess(null);
      setTemporaryResetCredentials(null);
      await sendPasswordResetForUser(email);
      setSuccess(`Se envió un correo de restablecimiento a ${email}.`);
    } catch (err) {
      console.error('[UserManagementPanel] Failed to send password reset', err);
      setError('No se pudo enviar el correo de restablecimiento.');
    }
  };

  const handleDisableUser = async (entry: UserEntry) => {
    const confirmed = window.confirm(`¿Seguro que deseas deshabilitar a ${entry.email}?`);
    if (!confirmed) {
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      setTemporaryResetCredentials(null);
      await disableUser(entry.id);
      setSuccess(`Se deshabilitó el acceso de ${entry.email}.`);
    } catch (err) {
      console.error('[UserManagementPanel] Failed to disable user', err);
      setError('No se pudo deshabilitar el usuario.');
    }
  };

  const handleDeleteUser = async (entry: UserEntry) => {
    const confirmed = window.confirm(`¿Seguro que deseas eliminar a ${entry.email}? Esta operación lo dejará sin acceso.`);
    if (!confirmed) {
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      setTemporaryResetCredentials(null);
      await deleteUser(entry.id);
      setSuccess(`Usuario eliminado de la lista: ${entry.email}. Para liberar el correo por completo, bórralo también en la consola → Authentication.`);
    } catch (err) {
      console.error('[UserManagementPanel] Failed to delete user', err);
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'permission-denied') {
        setError('No se pudo eliminar: solo un superadmin puede borrar usuarios y las reglas de Firestore deben permitirlo. Revisa que iniciaste sesión como superadmin.');
      } else {
        setError('No se pudo eliminar el usuario.');
      }
    }
  };

  const handleRefresh = async () => {
    if (isRefreshing) {
      return;
    }
    try {
      setIsRefreshing(true);
      setError(null);
      const q = query(collection(db, 'users'), orderBy('email'));
      await getDocsFromServer(q);
    } catch (err) {
      console.error('[UserManagementPanel] Failed to refresh from server', err);
      setError('No se pudo refrescar desde el servidor. Revisa tu conexión y permisos.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleResetInactiveUser = async (entry: UserEntry) => {
    if (entry.status !== 'inactive') {
      setError('Solo puedes resetear usuarios inactivos.');
      return;
    }

    const proposedName = window.prompt('Nuevo nombre para reutilizar esta cuenta:', entry.displayName ?? '');

    if (proposedName === null) {
      return;
    }

    const normalizedDisplayName = proposedName.trim();
    if (normalizedDisplayName.length === 0) {
      setError('Debes indicar un nombre para reutilizar la cuenta.');
      return;
    }

    try {
      setError(null);
      setSuccess(null);

      const { temporaryPassword } = await resetInactiveUser({
        userId: entry.id,
        email: entry.email,
        displayName: normalizedDisplayName,
      });

      setTemporaryResetCredentials({
        email: entry.email,
        displayName: normalizedDisplayName,
        temporaryPassword,
      });
      setSuccess(`Usuario reactivado: ${entry.email}. Se envió un correo de restablecimiento.`);
    } catch (err) {
      console.error('[UserManagementPanel] Failed to reset inactive user', err);
      setError('No se pudo resetear el usuario inactivo.');
    }
  };

  const handleCopyTemporaryPassword = async () => {
    if (!temporaryResetCredentials) {
      return;
    }

    try {
      await navigator.clipboard.writeText(temporaryResetCredentials.temporaryPassword);
      setSuccess(`Clave temporal copiada para ${temporaryResetCredentials.email}.`);
    } catch (err) {
      console.error('[UserManagementPanel] Failed to copy temporary password', err);
      setError('No se pudo copiar la clave temporal.');
    }
  };

  const nonDeletedUsers = users.filter((entry) => entry.status !== 'deleted' && !entry.deleted);
  const visibleUsers = nonDeletedUsers.filter((entry) => showInactiveUsers || entry.status !== 'inactive');
  const activeUsersCount = nonDeletedUsers.filter((entry) => entry.status !== 'inactive').length;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-gray-900">Crear nuevo usuario</h2>
        <p className="mb-4 text-sm text-gray-500">Define el rol para controlar si podrá administrar el sistema o solo visualizar.</p>
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Por seguridad, Firebase no permite ver contraseñas actuales. Para cambiar una contraseña de otro usuario se envía reset por correo.
        </div>
        {error && <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {success && <div className="mb-3 rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>}
        {temporaryResetCredentials && (
          <div className="mb-3 rounded-md border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-900">
            <div className="font-semibold">Reset de usuario completado</div>
            <div>Correo: {temporaryResetCredentials.email}</div>
            <div>Nombre nuevo: {temporaryResetCredentials.displayName}</div>
            <div className="font-mono">Clave temporal sugerida: {temporaryResetCredentials.temporaryPassword}</div>
            <button
              type="button"
              onClick={handleCopyTemporaryPassword}
              className="mt-2 rounded-md border border-cyan-300 px-2 py-1 text-xs font-semibold text-cyan-800 hover:bg-cyan-100"
            >
              Copiar clave temporal
            </button>
          </div>
        )}
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="new-email">Correo</label>
            <input
              id="new-email"
              type="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="new-password">Contraseña temporal (opcional)</label>
            <input
              id="new-password"
              type="password"
              minLength={6}
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              placeholder="Déjalo vacío para enviar invitación por correo"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
            <p className="mt-1 text-xs text-gray-500">
              Si lo dejas vacío, el usuario recibe un correo para definir su propia contraseña. Si escribes una (mín. 6 caracteres), tú se la comunicas.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="new-name">Nombre</label>
            <input
              id="new-name"
              type="text"
              value={form.displayName}
              onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              placeholder="Ej. Carlos Vocalía"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="new-role">Rol</label>
            <select
              id="new-role"
              value={form.role}
              onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as UserRole }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option value="viewer">Solo visualización</option>
              <option value="admin">Administrador</option>
              <option value="vocalia">Vocalía</option>
              {isSuperadmin && <option value="superadmin">Superadmin</option>}
            </select>
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-indigo-300"
          >
            {isSubmitting ? 'Creando...' : 'Crear usuario'}
          </button>
        </form>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-gray-900">Usuarios registrados</h2>
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showInactiveUsers}
                onChange={(event) => setShowInactiveUsers(event.target.checked)}
              />
              Mostrar inactivos
            </label>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {isRefreshing ? 'Refrescando...' : 'Refrescar'}
            </button>
            <span>{activeUsersCount} usuarios activos</span>
          </div>
        </div>
        {fromCache && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            Mostrando datos guardados en este dispositivo (sin conexión con el servidor). Pulsa “Refrescar” para ver la versión real de Firestore.
          </div>
        )}
        <div className="space-y-3">
          {visibleUsers.length === 0 ? (
            <div className="rounded-md bg-gray-50 p-4 text-sm text-gray-500">Aún no hay usuarios registrados.</div>
          ) : (
            visibleUsers.map((entry) => (
              <div
                key={entry.id}
                className={`rounded-md border px-4 py-3 ${entry.status === 'inactive' ? 'border-gray-200 bg-gray-100 text-gray-500 line-through' : 'border-gray-100 bg-gray-50'}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-gray-900">{entry.displayName || entry.email}</div>
                    <div className="text-xs text-gray-500">{entry.email}</div>
                    {(entry.disabled || entry.status === 'inactive') && (
                      <div className="text-xs font-semibold text-red-600">Cuenta deshabilitada</div>
                    )}
                    {entry.createdAt && (
                      <div className="text-xs text-gray-400">Creado el {entry.createdAt.toLocaleString('es-ES')}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <select
                      value={entry.role}
                      onChange={(event) => handleRoleChange(entry.id, event.target.value as UserRole)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                      disabled={user?.uid === entry.id || entry.status !== 'active' || (!isSuperadmin && entry.role === 'superadmin')}
                    >
                      <option value="viewer">Solo ver</option>
                      <option value="admin">Admin</option>
                      <option value="vocalia">Vocalía</option>
                      {isSuperadmin && <option value="superadmin">Superadmin</option>}
                    </select>
                    {isSuperadmin && entry.status === 'active' && (
                      <button
                        type="button"
                        onClick={() => handleSendReset(entry.email)}
                        className="rounded-md border border-indigo-300 px-2 py-1 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-50"
                      >
                        Cambiar contraseña (reset)
                      </button>
                    )}
                    {isSuperadmin && user?.uid !== entry.id && entry.status === 'inactive' && (
                      <button
                        type="button"
                        onClick={() => handleResetInactiveUser(entry)}
                        className="rounded-md border border-cyan-300 px-2 py-1 text-[10px] font-semibold text-cyan-700 hover:bg-cyan-50"
                      >
                        Resetear usuario
                      </button>
                    )}
                    {isSuperadmin && user?.uid !== entry.id && entry.status === 'active' && (
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(entry)}
                        className="rounded-md border border-red-300 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-50"
                      >
                        Borrar
                      </button>
                    )}
                    {isSuperadmin && user?.uid !== entry.id && entry.status === 'active' && (
                      <button
                        type="button"
                        onClick={() => handleDisableUser(entry)}
                        className="rounded-md border border-amber-300 px-2 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-50"
                      >
                        Bloquear
                      </button>
                    )}
                    {user?.uid === entry.id && (
                      <span className="text-[10px] text-gray-500">No puedes cambiar tu propio rol</span>
                    )}
                  </div>
                </div>
              </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
};
