const firebaseConfig = {
  apiKey: "AIzaSyBkI1wMKA-bZ4euzfYaDRaln_bMBdV0r38",
  authDomain: "vocabs-8c824.firebaseapp.com",
  databaseURL: "https://vocabs-8c824-default-rtdb.firebaseio.com",
  projectId: "vocabs-8c824",
  storageBucket: "vocabs-8c824.firebasestorage.app",
  messagingSenderId: "10848885805",
  appId: "1:10848885805:web:d4900ed0e4e924fc53eca4"
};

const ADMIN_UIDS = [
  "8zSPXgapLjROs2l7Vs525czubDR2"
];

// Initialize Firebase using compat globally
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const database = firebase.database();
const auth = firebase.auth();
