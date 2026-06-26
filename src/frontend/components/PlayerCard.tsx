import type { Player } from '../../backend/modules/tournament/domain/entities/index.ts';
import { useState } from 'react';
import { DigitalIDCardModal } from './DigitalIDCardModal.tsx';
interface PlayerCardProps {
  player: Player;
  teamName?: string;
}

export const PlayerCard = ({ player, teamName }: PlayerCardProps) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const initials = (player.displayName || player.fullName)
    .split(' ')
    .map((w: string) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="group relative flex w-full flex-col items-center rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all active:border-indigo-300 active:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:w-40"
        title="Ver carnet digital"
      >
        {/* Photo or initials fallback */}
        {player.photoUrl ? (
          <img
            src={player.photoUrl}
            alt={player.displayName || player.fullName}
            className="h-20 w-20 rounded-full object-cover border-2 border-indigo-200"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-indigo-100 text-2xl font-bold text-indigo-600">
            {initials}
          </div>
        )}

        <div className="mt-3 text-center">
          <div className="text-sm font-semibold text-gray-900 leading-tight">
            {player.displayName || player.fullName}
          </div>
          {player.number != null && (
            <div className="mt-0.5 text-xs font-medium text-indigo-600">#{player.number}</div>
          )}
          {teamName && (
            <div className="mt-1 text-[10px] text-gray-500">{teamName}</div>
          )}
        </div>
      </button>

      {/* The Digital ID Card Modal */}
      <DigitalIDCardModal
        player={player}
        teamName={teamName}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
};
