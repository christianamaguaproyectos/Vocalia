import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { createTeamUseCase } from '../../application/use-cases/index.ts';
import type { GroupId } from '../../domain/value-objects/index.ts';
import { APP_CONFIG } from '../../../../../core/config/app-config.ts';
import { useAppDependencies } from '../../../../../frontend/app/providers/AppDependenciesProvider.tsx';
import { resizeImageToBase64 } from '../../../../../frontend/shared/utils/image.ts';
import { useTournament } from '../hooks/index.ts';

interface AdminCreateTeamFormProps {
  tournamentId?: string;
}

export const AdminCreateTeamForm = ({ tournamentId = APP_CONFIG.defaultTournamentId }: AdminCreateTeamFormProps) => {
  const { teamRepository, tournamentRepository } = useAppDependencies();
  const { tournament, isLoading: isTournamentLoading, error: tournamentError } = useTournament(tournamentId);
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [representativeEmails, setRepresentativeEmails] = useState('');
  const [groupId, setGroupId] = useState<GroupId>('A');
  const [crestUrl, setCrestUrl] = useState('');
  const [uploadingCrest, setUploadingCrest] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const createTeam = useMemo(() => createTeamUseCase({ teamRepository, tournamentRepository }), [teamRepository, tournamentRepository]);
  const groupOptions = tournament?.groups ?? [
    { id: 'A' as GroupId, name: 'Grupo A' },
    { id: 'B' as GroupId, name: 'Grupo B' },
  ];

  useEffect(() => {
    if (groupOptions.length === 0) {
      return;
    }

    const hasSelectedGroup = groupOptions.some((group) => group.id === groupId);
    if (!hasSelectedGroup) {
      setGroupId(groupOptions[0].id as GroupId);
    }
  }, [groupId, groupOptions]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    try {
      if (!tournament) {
        throw new Error('El torneo aun no esta disponible');
      }

      setIsSubmitting(true);

      await createTeam({
        tournamentId,
        name,
        shortName: shortName || undefined,
        representativeEmails: representativeEmails
          .split(/[;,\n]/)
          .map((email) => email.trim())
          .filter(Boolean),
        groupId,
        crestUrl: crestUrl || undefined,
      });

      setName('');
      setShortName('');
      setRepresentativeEmails('');
      setCrestUrl('');
      setSuccessMessage('Equipo creado correctamente');
    } catch (error) {
      console.error('[AdminCreateTeamForm] Failed to create team', error);
      setFormError(error instanceof Error ? error.message : 'No se pudo crear el equipo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">Registrar equipo</h2>
        {isTournamentLoading && <p className="text-xs text-gray-500">Cargando configuracion...</p>}
        {tournamentError && <p className="text-xs text-red-500">{tournamentError}</p>}
      </div>

      <div>
        <label htmlFor="team-name" className="block text-sm font-medium text-gray-700">
          Nombre
        </label>
        <input
          id="team-name"
          name="team-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
          placeholder="Ej. Los Invencibles"
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="team-short-name" className="block text-sm font-medium text-gray-700">
            Nombre corto
          </label>
          <input
            id="team-short-name"
            name="team-short-name"
            type="text"
            value={shortName}
            onChange={(event) => setShortName(event.target.value.toUpperCase())}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
            placeholder="Ej. INV"
            maxLength={4}
          />
        </div>

        <div>
          <label htmlFor="team-group" className="block text-sm font-medium text-gray-700">
            Grupo
          </label>
          <select
            id="team-group"
            name="team-group"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value as GroupId)}
            disabled={groupOptions.length === 0}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
          >
            {groupOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="team-representatives" className="block text-sm font-medium text-gray-700">
          Correos de representantes
        </label>
        <textarea
          id="team-representatives"
          name="team-representatives"
          value={representativeEmails}
          onChange={(event) => setRepresentativeEmails(event.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
          placeholder="rep1@club.com; rep2@club.com"
        />
        <p className="mt-1 text-xs text-gray-500">Separa varios correos por coma, punto y coma o salto de línea.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Escudo del equipo (opcional)
        </label>
        <div className="mt-2 flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-gray-300 bg-gray-50 text-gray-400">
            {crestUrl ? (
              <img src={crestUrl} alt="Escudo del equipo" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs">Sin escudo</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              type="file"
              accept="image/*"
              disabled={uploadingCrest}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (!file.type.startsWith('image/')) {
                  alert('Por favor selecciona un archivo de imagen');
                  return;
                }
                if (file.size > 5 * 1024 * 1024) {
                  alert('La imagen no puede superar los 5 MB');
                  return;
                }
                try {
                  setUploadingCrest(true);
                  const base64 = await resizeImageToBase64(file);
                  setCrestUrl(base64);
                } catch (err) {
                  alert('No se pudo cargar la imagen');
                } finally {
                  setUploadingCrest(false);
                }
              }}
              className="text-xs"
            />
            {crestUrl && (
              <button
                type="button"
                onClick={() => setCrestUrl('')}
                className="text-left text-xs font-semibold text-red-600 hover:text-red-700"
              >
                Eliminar escudo
              </button>
            )}
          </div>
        </div>
      </div>

      {formError && <p className="text-sm text-red-500">{formError}</p>}
      {successMessage && <p className="text-sm text-green-600">{successMessage}</p>}

      <button
        type="submit"
        disabled={isSubmitting || isTournamentLoading}
        className="flex w-full justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-400"
      >
        {isSubmitting ? 'Guardando...' : 'Guardar equipo'}
      </button>
    </form>
  );
};
