/* ========================================
   Firebase configuration for cloud sync.

   These values are public identifiers, not secrets - data access is
   enforced by firestore.rules (a signed-in user can only touch documents
   under their own uid).

   All the sadhana apps share ONE Firebase project, so a single login works
   everywhere. `appId` below is the per-app namespace (the doc id under
   users/{uid}/apps/), and `fields` maps this app's localStorage keys onto
   how each one merges across devices.

   Deliberately NOT synced: sv_krama (today's checklist - a sitting happens
   on one device, not on an account) and sv_kutas (whether the Pancadasi
   kutas are revealed, which stays a per-device choice).

   Blanking apiKey/projectId puts sync back to sleep without touching
   anything else - the app stays fully usable offline.
   ======================================== */

window.SADHANA_SYNC_CONFIG = {
  appId: 'srividya-notes',
  deviceKey: 'sv_device_id',
  fields: [
    { name: 'japa', key: 'sv_japa', merge: 'sadhana' },
    { name: 'days', key: 'sv_days', merge: 'idset'   },
  ],
  firebase: {
    apiKey: 'AIzaSyDjhN4HagHlUt0EvTMJd5T-g5N01Ntv95M',
    authDomain: 'sadhana-apps-hd.firebaseapp.com',
    projectId: 'sadhana-apps-hd',
    storageBucket: 'sadhana-apps-hd.firebasestorage.app',
    messagingSenderId: '555145234754',
    appId: '1:555145234754:web:d3bee0ad4b693b06ba60db',
  },
};
