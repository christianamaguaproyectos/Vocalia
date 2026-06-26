import { useRef } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { X, FileImage, FileText } from 'lucide-react';
import type { Player } from '../../backend/modules/tournament/domain/entities/index.ts';

interface DigitalIDCardModalProps {
    player: Player;
    teamName?: string;
    isOpen: boolean;
    onClose: () => void;
}

export const DigitalIDCardModal = ({ player, teamName, isOpen, onClose }: DigitalIDCardModalProps) => {
    const cardRef = useRef<HTMLDivElement>(null);

    if (!isOpen) return null;

    const initials = (player.displayName || player.fullName)
        .split(' ')
        .map((w: string) => w[0]?.toUpperCase() ?? '')
        .slice(0, 2)
        .join('');

    const handleDownloadPNG = async () => {
        if (!cardRef.current) return;
        try {
            const canvas = await html2canvas(cardRef.current, { scale: 3, useCORS: true });
            const image = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = image;
            link.download = `carnet-${player.fullName.replace(/\s+/g, '-').toLowerCase()}.png`;
            link.click();
        } catch (err) {
            console.error('Error fetching image for PNG', err);
            alert('Hubo un error al generar la imagen.');
        }
    };

    const handleDownloadPDF = async () => {
        if (!cardRef.current) return;
        try {
            const canvas = await html2canvas(cardRef.current, { scale: 3, useCORS: true });
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4',
            });

            const pdfWidth = pdf.internal.pageSize.getWidth();

            // Calculate margins to center the card on the PDF
            const marginX = (pdfWidth - 90) / 2; // Card width approx 90mm
            const cardHeightMm = (canvas.height * 90) / canvas.width;

            pdf.addImage(imgData, 'PNG', marginX, 20, 90, cardHeightMm);
            pdf.save(`carnet-${player.fullName.replace(/\s+/g, '-').toLowerCase()}.pdf`);
        } catch (err) {
            console.error('Error fetching image for PDF', err);
            alert('Hubo un error al generar el PDF.');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="relative flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">

                {/* Header Actions */}
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3">
                    <h3 className="font-semibold text-gray-800">Carnet Digital</h3>
                    <button
                        onClick={onClose}
                        className="rounded-full p-2 text-gray-500 active:bg-gray-200 active:text-gray-800 transition"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-100/50 flex flex-col items-center">

                    {/* Card Container (The part that gets captured) */}
                    <div
                        ref={cardRef}
                        className="relative flex w-[320px] shrink-0 flex-col items-center overflow-hidden rounded-2xl bg-white shadow-lg border border-gray-200 font-sans"
                        style={{ minHeight: '520px' }}
                    >
                        {/* Background design accents */}
                        <div className="absolute -right-16 -top-16 h-32 w-32 rounded-full bg-blue-100/50 blur-2xl"></div>
                        <div className="absolute -left-16 bottom-32 h-32 w-32 rounded-full bg-indigo-100/50 blur-2xl"></div>

                        {/* Header: DANEC Branding */}
                        <div className="w-full bg-gradient-to-r from-[#003B71] to-[#00529B] p-4 text-center">
                            <h1 className="text-3xl font-black tracking-widest text-white italic drop-shadow-md">DANEC</h1>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-blue-100 mt-1">
                                Deportes y Recreación
                            </p>
                        </div>

                        {/* Player Photo */}
                        <div className="mt-8 flex justify-center w-full z-10">
                            <div className="relative">
                                {player.photoUrl ? (
                                    <img
                                        src={player.photoUrl}
                                        alt={player.displayName || player.fullName}
                                        className="h-40 w-32 rounded-xl object-cover shadow-lg border-4 border-white"
                                    />
                                ) : (
                                    <div className="flex h-40 w-32 items-center justify-center rounded-xl bg-gray-100 shadow-inner border-4 border-white text-4xl font-bold text-gray-400">
                                        {initials}
                                    </div>
                                )}
                                <div className="absolute -bottom-3 -right-3 flex h-10 w-10 items-center justify-center rounded-full bg-yellow-400 shadow-md border-2 border-white">
                                    <span className="text-lg font-black text-[#003B71]">{player.number ?? '-'}</span>
                                </div>
                            </div>
                        </div>

                        {/* Player Info */}
                        <div className="mt-6 flex w-full flex-col px-6 text-center z-10">
                            <h2 className="text-lg font-bold uppercase leading-tight text-gray-900 line-clamp-2">
                                {player.fullName}
                            </h2>
                            <div className="mt-1 text-sm font-semibold tracking-wide text-blue-600 uppercase">
                                JUGADOR
                            </div>


                            {teamName && (
                                <div className="mt-3 flex items-center justify-center gap-2 border-t border-gray-100 pt-3">
                                    <span className="text-xs font-bold text-gray-500 uppercase">Equipo:</span>
                                    <span className="text-sm font-bold text-gray-800">{teamName}</span>
                                </div>
                            )}
                        </div>

                        {/* Spacer */}
                        <div className="flex-1"></div>

                        <div className="mb-6 mt-6 w-full border-t border-gray-100 bg-gray-50 py-4"></div>

                        {/* Footer accent */}
                        <div className="h-2 w-full bg-yellow-400"></div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="flex justify-center gap-3 border-t border-gray-100 bg-white p-4">
                    <button
                        onClick={handleDownloadPNG}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700 transition active:bg-indigo-100"
                    >
                        <FileImage className="h-4 w-4" />
                        Descargar PNG
                    </button>
                    <button
                        onClick={handleDownloadPDF}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#003B71] px-4 py-3 text-sm font-semibold text-white transition active:bg-[#002B52]"
                    >
                        <FileText className="h-4 w-4" />
                        Descargar PDF
                    </button>
                </div>

            </div>
        </div>
    );
};
