# vocab-revision

Static Firebase vocabulary revision app with per-user quiz progress.

## Production setup

1. In Firebase Console, enable Authentication > Email/Password.
2. Create your own admin account through the app sign-up form.
3. Copy that account's Firebase Auth UID.
4. Add the UID to `ADMIN_UIDS` in `firebase-init.js` for the client admin link.
5. In Realtime Database, set `admins/<your UID>` to `true`.
6. Deploy `database.rules.json` to Realtime Database rules.
7. Publish the static files with Firebase Hosting or any static host.
8. Use the Admin panel Learners list to tick `Can import vocabulary` for users who should be allowed to add shared vocab.

Quiz progress and answer history are stored per learner:

```text
users/<uid>/progress
users/<uid>/attempts
users/<uid>/profile
```

Saved vocabulary remains shared at:

```text
vocab
```

Only admins and users listed under `importers/<uid>` can write shared vocabulary:

```text
admins/<uid>
importers/<uid>
```
