import { useState } from 'react';

export const PrivacyConsentModal = () => {
  const [open, setOpen] = useState(true);
  const [checked, setChecked] = useState(false);

  const handleAccept = () => {
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">AVISO INFORMATIVO DE PROTECCIÓN DE DATOS PERSONALES</h2>
          <p className="mt-0.5 text-xs text-gray-500">Copa Mazorca de Oro</p>
        </div>

        {/* Body */}
        <div className="max-h-60 overflow-y-auto px-6 py-4 text-sm text-gray-700 leading-relaxed space-y-3">
          <p>
            De conformidad con el derecho a la información transparente establecido en el artículo 12 de la Ley Orgánica de Protección de Datos Personales (LOPDP), te comunicamos de forma directa y clara cómo trataremos tu información personal dentro de este aplicativo:
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>¿Quién es el Responsable?</strong> Comité de Empresa de los Empleados y Trabajadores de Industrial Danec S.A, domiciliada en Av. General Enriquez s/n y Av. De los Shirys. Para cualquier requerimiento, puedes contactar a nuestro Delegado de Protección de Datos (DPD) escribiendo a datospersonales@danec.com.
            </li>
            <li>
              <strong>¿Para qué usamos tus datos y bajo qué justificación legal?</strong> Exclusivamente, trataremos tus datos de identificación: Un nombre y un apellido con la única finalidad de gestionar tu inscripción, organizar los encuentros, llevar estadísticas deportivas y garantizar tu participación en el torneo deportivo. La base legal para este tratamiento es tu consentimiento libre y explícito, al ser esta una actividad corporativa netamente voluntaria.
            </li>
            <li>
              <strong>Consecuencias de negarte o entregar datos falsos:</strong> Proporcionar tu información es fundamental para participar y jugar. Si te niegas a entregar tus datos, o si proporcionas información errónea o falsa (ej. suplantación de identidad), afectará tu participación la ejecución del torneo.
            </li>
            <li>
              <strong>¿Dónde están tus datos y con quién se comparten?</strong> Tu información se almacenará internamente con medidas de seguridad técnicas, administrativas y organizativas. Tus datos solo se compartirán con el equipo organizador del torneo, y el equipo de desarrollador de la aplicación. Bajo ninguna circunstancia tu información será procesada para otras finalidades.
              <br /><br />
              Los terceros deberán tratar la información bajo obligaciones de confidencialidad, seguridad y uso limitado. La normativa interna exige implementar medidas administrativas, técnicas, físicas, organizativas y jurídicas adecuadas, así como acuerdos de confidencialidad y manejo adecuado de datos.
            </li>
            <li>
              <strong>¿Cuánto tiempo los guardamos?</strong> Conservaremos tu información y estadísticas en la aplicación durante el desarrollo del torneo, tras lo cual serán eliminados de forma segura.
            </li>
            <li>
              <strong>¿Qué medidas de seguridad aplicaremos?</strong> El Comité de Empresa de los Empleados y Trabajadores en colaboración con Grupo DANEC aplicará medidas técnicas, organizativas y administrativas razonables para proteger tus datos frente a accesos no autorizados, pérdida, alteración, uso indebido o divulgación no autorizada.
              <br /><br />
              Estas medidas podrán incluir, según corresponda: control de accesos, perfiles autorizados, contraseñas, registros de actividad, limitación de permisos, confidencialidad del equipo organizador y técnico, revisión de accesos, eliminación segura al finalizar el plazo de conservación y restricción de uso para finalidades distintas al torneo.
            </li>
            <li>
              <strong>Tus Derechos:</strong> Tú tienes el control. Puedes revocar tu consentimiento en cualquier momento y solicitar el acceso, rectificación, eliminación u oposición sobre tus datos escribiendo al DPD.
            </li>
          </ul>
        </div>

        {/* Checkbox + button */}
        <div className="border-t border-gray-100 px-6 py-4 space-y-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600 accent-indigo-600"
            />
            <span className="text-sm text-gray-700">
              Al presionar "Aceptar", confirmas que has leído este aviso para que el COMITÉ DE EMPRESA DE LOS EMPLEADOS Y TRABAJADORES DE INDUSTRIAL DANEC S.A trate tus datos personales para los fines deportivos aquí descritos.
            </span>
          </label>
          <button
            onClick={handleAccept}
            disabled={!checked}
            className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
};
