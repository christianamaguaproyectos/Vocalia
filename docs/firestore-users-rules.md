# Firestore Rules for `users`

Use this snippet inside your Firestore rules so a `superadmin` can read and manage all user documents, while regular users can only read their own document.

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() {
      return request.auth != null;
    }

    function userDoc(userId) {
      return get(/databases/$(database)/documents/users/$(userId));
    }

    function isSuperadmin() {
      return isSignedIn()
        && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        && userDoc(request.auth.uid).data.role == 'superadmin';
    }

    match /users/{userId} {
      allow get, list: if isSuperadmin() || (isSignedIn() && request.auth.uid == userId);
      allow create: if isSignedIn() && (request.auth.uid == userId || isSuperadmin());
      allow update: if isSuperadmin() || (isSignedIn() && request.auth.uid == userId);
      allow delete: if isSuperadmin();
    }
  }
}
```

Notes:
- `list` is only allowed for `superadmin`, because the admin panel reads the full users collection.
- `update` already allows `superadmin` to edit other users, including fields used by reset/reuse flows (`displayName`, `status`, `disabled`, `deleted`).
- `delete` is restricted to `superadmin`.
- If you want soft delete only, keep `delete` locked down and let the app update `disabled: true` / `status: 'deleted'` instead.
- To reactivate an inactive account (email reuse), the app performs an `update` to set `status: 'active'` and `disabled: false`.
- If you already have rules for the rest of the app, merge this `match /users/{userId}` block into them instead of replacing everything.
