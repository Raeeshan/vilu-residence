/**
 * Firebase initialization for React Native Firebase (RNFB).
 *
 * Unlike the web SDK (firebase.initializeApp({...}) with an explicit config
 * object, as vilu-unified.html/vilu-agency-portal.html already do), RNFB's
 * native modules auto-initialize from the native config files:
 *   - android/app/google-services.json
 *   - ios/GoogleService-Info.plist
 * downloaded from the Firebase console for the SAME "vilu-residence"
 * project the web apps already use (project id confirmed from the web
 * client config: projectId "vilu-residence"). No JS-side apiKey/appId
 * object is required or constructed here — this file exists to provide
 * ONE typed access point (`auth()`, `firestore()`, `functions()`) so the
 * rest of the app never imports @react-native-firebase/* directly.
 *
 * IMPORTANT (see mobile/README.md "Firebase project setup"): the iOS and
 * Android apps for both bundle ids (com.viluresidence.staff,
 * com.viluresidence.agency) must be registered in the Firebase console
 * for this SAME existing project before `google-services.json`/
 * `GoogleService-Info.plist` exist to download. That registration is an
 * ADDITIVE step (new app entries under the existing project) and was
 * deliberately NOT performed automatically in this phase — no production
 * backend configuration was changed to build this foundation.
 */
import authModule from '@react-native-firebase/auth';
import firestoreModule from '@react-native-firebase/firestore';
import { firebase } from '@react-native-firebase/functions';

// us-central1 matches every existing onCall() region in functions-core/index.js.
const FUNCTIONS_REGION = 'us-central1';

export function getFirebaseAuth() {
  return authModule();
}

export function getFirestore() {
  return firestoreModule();
}

export function getFunctions() {
  // Region is set via app().functions(region), not a second argument to the
  // default export — see @react-native-firebase/functions's own doc example.
  return firebase.app().functions(FUNCTIONS_REGION);
}
