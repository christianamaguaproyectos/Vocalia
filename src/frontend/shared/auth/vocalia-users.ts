import { collection, orderBy, query, type DocumentData } from 'firebase/firestore';

import { db, getDocsPreferCache } from '../../../backend/lib/firebase.ts';

export interface VocaliaUser {
  id: string;
  email: string;
  displayName: string;
}

export const listVocaliaUsers = async (): Promise<VocaliaUser[]> => {
  const usersQuery = query(collection(db, 'users'), orderBy('email'));
  const snapshot = await getDocsPreferCache(usersQuery);

  return snapshot.docs
    .map((docSnapshot) => {
      const data = docSnapshot.data() as DocumentData;
      return {
        id: docSnapshot.id,
        email: typeof data.email === 'string' ? data.email.trim().toLowerCase() : '',
        displayName: typeof data.displayName === 'string' ? data.displayName.trim() : '',
        role: typeof data.role === 'string' ? data.role : 'viewer',
      };
    })
    .filter((item) => (item.role === 'vocalia' || item.role === 'superadmin') && item.email.length > 0)
    .map(({ id, email, displayName }) => ({ id, email, displayName }))
    .sort((a, b) => {
      const labelA = a.displayName || a.email;
      const labelB = b.displayName || b.email;
      return labelA.localeCompare(labelB, 'es');
    });
};
